const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { sendGiftCardEmail, sendPurchaserReceipt } = require('../services/email');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// All API routes require auth
router.use(requireAuth);

// ── Menu Items ──────────────────────────────────────────

// POST /api/menu — Create
router.post('/menu', async (req, res) => {
  const { name, tag, price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const maxOrder = await db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM menu_items');
  await db.run(
    'INSERT INTO menu_items (name, tag, price, sort_order) VALUES ($1, $2, $3, $4)',
    [name, tag || null, price || null, maxOrder.next]
  );
  res.json({ success: true });
});

// PUT /api/menu/:id — Update
router.put('/menu/:id', async (req, res) => {
  const { name, tag, price, sort_order, visible } = req.body;
  const item = await db.get('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
  if (tag !== undefined) { updates.push(`tag = $${idx++}`); params.push(tag || null); }
  if (price !== undefined) { updates.push(`price = $${idx++}`); params.push(price || null); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); params.push(sort_order); }
  if (visible !== undefined) { updates.push(`visible = $${idx++}`); params.push(visible); }

  if (updates.length === 0) return res.json({ success: true });

  updates.push(`updated_at = NOW()`);
  params.push(req.params.id);
  await db.run(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = $${idx}`, params);
  res.json({ success: true });
});

// DELETE /api/menu/:id
router.delete('/menu/:id', async (req, res) => {
  await db.run('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ── Opening Hours ───────────────────────────────────────

// POST /api/hours — Create
router.post('/hours', async (req, res) => {
  const { label, times } = req.body;
  if (!label || !times) return res.status(400).json({ error: 'Label and times required' });
  const maxOrder = await db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM opening_hours');
  await db.run('INSERT INTO opening_hours (label, times, sort_order) VALUES ($1, $2, $3)', [label, times, maxOrder.next]);
  res.json({ success: true });
});

// PUT /api/hours/:id
router.put('/hours/:id', async (req, res) => {
  const { label, times, sort_order } = req.body;
  const hour = await db.get('SELECT id FROM opening_hours WHERE id = $1', [req.params.id]);
  if (!hour) return res.status(404).json({ error: 'Not found' });

  await db.run(
    'UPDATE opening_hours SET label = COALESCE($1, label), times = COALESCE($2, times), sort_order = COALESCE($3, sort_order), updated_at = NOW() WHERE id = $4',
    [label, times, sort_order, req.params.id]
  );
  res.json({ success: true });
});

// DELETE /api/hours/:id
router.delete('/hours/:id', async (req, res) => {
  await db.run('DELETE FROM opening_hours WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ── Allergen Values ─────────────────────────────────────

// POST /api/allergens/value — Set a single cell
router.post('/allergens/value', async (req, res) => {
  const { menuItemId, allergenId, value } = req.body;
  if (!menuItemId || !allergenId) return res.status(400).json({ error: 'Missing IDs' });

  if (!value || value === '') {
    await db.run('DELETE FROM menu_allergens WHERE menu_item_id = $1 AND allergen_id = $2', [menuItemId, allergenId]);
  } else {
    await db.run(
      `INSERT INTO menu_allergens (menu_item_id, allergen_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (menu_item_id, allergen_id) DO UPDATE SET value = $3`,
      [menuItemId, allergenId, value]
    );
  }
  res.json({ success: true });
});

// ── Site Settings ───────────────────────────────────────

// POST /api/settings/:key
router.post('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  const setting = await db.get('SELECT key FROM site_settings WHERE key = $1', [key]);
  if (!setting) {
    // Create new setting
    await db.run('INSERT INTO site_settings (key, value) VALUES ($1, $2)', [key, value]);
  } else {
    await db.run('UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = $2', [value, key]);
  }
  res.json({ success: true, key, value });
});

// ── Gift Card Resend Emails ─────────────────────────────

// POST /api/gift-cards/:id/resend-purchaser
router.post('/gift-cards/:id/resend-purchaser', async (req, res) => {
  const card = await db.get('SELECT * FROM gift_cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Gift card not found' });
  if (card.status === 'pending') return res.status(400).json({ error: 'Gift card is still pending' });

  const email = req.body.email || card.purchaser_email;
  try {
    await sendPurchaserReceipt(card, email);
    res.json({ success: true, sentTo: email });
  } catch (err) {
    console.error('Failed to resend purchaser receipt:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// POST /api/gift-cards/:id/resend-recipient
router.post('/gift-cards/:id/resend-recipient', async (req, res) => {
  const card = await db.get('SELECT * FROM gift_cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Gift card not found' });
  if (card.status === 'pending') return res.status(400).json({ error: 'Gift card is still pending' });

  const email = req.body.email || (card.send_to === 'friend' ? card.recipient_email : card.purchaser_email);
  try {
    await sendGiftCardEmail(card, email);
    res.json({ success: true, sentTo: email });
  } catch (err) {
    console.error('Failed to resend gift card email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ── Gift Card Redemption ────────────────────────────────

// POST /api/gift-cards/:code/redeem
router.post('/gift-cards/:code/redeem', async (req, res) => {
  const { code } = req.params;
  const { amount } = req.body;

  const card = await db.get('SELECT * FROM gift_cards WHERE code = $1', [code]);
  if (!card) return res.status(404).json({ error: 'Gift card not found' });
  if (card.status !== 'active' && card.status !== 'expired') {
    return res.status(400).json({ error: `Gift card is ${card.status}` });
  }
  if (card.balance <= 0) return res.status(400).json({ error: 'Gift card has no remaining balance' });

  // Auto-mark as expired if past expiry
  if (card.status === 'active' && card.expires_at && new Date(card.expires_at) < new Date()) {
    await db.run("UPDATE gift_cards SET status = 'expired' WHERE id = $1", [card.id]);
  }

  const redeemAmount = parseInt(amount);
  if (isNaN(redeemAmount) || redeemAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (redeemAmount > card.balance) return res.status(400).json({ error: `Amount exceeds balance of \u00A3${(card.balance / 100).toFixed(2)}` });

  const newBalance = card.balance - redeemAmount;
  const newStatus = newBalance === 0 ? 'redeemed' : card.status;

  await db.run('UPDATE gift_cards SET balance = $1, status = $2 WHERE id = $3', [newBalance, newStatus, card.id]);
  await db.run(
    'INSERT INTO gift_card_transactions (gift_card_id, amount, type, redeemed_by_user_id) VALUES ($1, $2, $3, $4)',
    [card.id, redeemAmount, 'redemption', req.session.userId]
  );

  res.json({
    success: true,
    newBalance,
    newStatus,
    redeemed: redeemAmount,
    balanceFormatted: `\u00A3${(newBalance / 100).toFixed(2)}`
  });
});

// ── CSV Import ──────────────────────────────────────────

// POST /api/gift-cards/import
router.post('/gift-cards/import', upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = req.file.buffer.toString('utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      try {
        const code = (row['GIFT CODE'] || '').trim();
        if (!code) { skipped++; continue; }

        const existing = await db.get('SELECT id FROM gift_cards WHERE code = $1', [code]);
        if (existing) { skipped++; errors.push(`Row ${i + 2}: Code ${code} already exists`); continue; }

        const initialStr = (row['INITIAL VALUE'] || '0').replace(/[^0-9.]/g, '');
        const remainingStr = (row['REMAINING VALUE'] || '0').replace(/[^0-9.]/g, '');
        const initialAmount = Math.round(parseFloat(initialStr) * 100);
        const balance = Math.round(parseFloat(remainingStr) * 100);

        const usage = (row['USAGE'] || '').toUpperCase();
        const status = usage === 'DEPLETED' ? 'redeemed' : 'active';

        const purchasedAt = row['PURCHASE DATE'] || new Date().toISOString();
        const purchaseDate = new Date(purchasedAt);
        const expiresAt = new Date(purchaseDate.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

        const result = await db.query(
          `INSERT INTO gift_cards (code, initial_amount, balance, currency, status, purchaser_email, recipient_email, purchased_at, expires_at)
           VALUES ($1, $2, $3, 'GBP', $4, $5, $6, $7, $8) RETURNING id`,
          [code, initialAmount, balance, status, (row['PURCHASER EMAIL'] || '').trim(), (row['RECIPIENT EMAIL'] || '').trim(), purchasedAt, expiresAt]
        );

        const newId = result.rows[0].id;
        await db.run(
          `INSERT INTO gift_card_transactions (gift_card_id, amount, type, note) VALUES ($1, $2, 'import', $3)`,
          [newId, initialAmount, `Imported from CSV row ${i + 2}`]
        );
        imported++;
      } catch (err) {
        skipped++;
        errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    res.json({ success: true, imported, skipped, total: records.length, errors: errors.slice(0, 20) });
  } catch (err) {
    res.status(400).json({ error: `Failed to parse CSV: ${err.message}` });
  }
});

// ── CSV Export ───────────────────────────────────────────

// GET /api/gift-cards/export
router.get('/gift-cards/export', async (req, res) => {
  try {
    const cards = await db.all(`
      SELECT code, initial_amount, balance, currency, status,
             purchaser_email, purchaser_name, recipient_email, recipient_name,
             send_to, purchased_at, expires_at
      FROM gift_cards
      WHERE status != 'pending'
      ORDER BY purchased_at DESC
    `);

    const header = 'GIFT CODE,INITIAL VALUE,REMAINING VALUE,STATUS,PURCHASER EMAIL,PURCHASER NAME,RECIPIENT EMAIL,RECIPIENT NAME,PURCHASE DATE,EXPIRES';
    const rows = cards.map(c => {
      const initial = (c.initial_amount / 100).toFixed(2) + ' GBP';
      const remaining = (c.balance / 100).toFixed(2) + ' GBP';
      const purchased = c.purchased_at ? new Date(c.purchased_at).toISOString() : '';
      const expires = c.expires_at ? new Date(c.expires_at).toISOString() : '';
      return [
        `"${c.code}"`, `"${initial}"`, `"${remaining}"`, `"${c.status}"`,
        `"${c.purchaser_email || ''}"`, `"${(c.purchaser_name || '').replace(/"/g, '""')}"`,
        `"${c.recipient_email || ''}"`, `"${(c.recipient_name || '').replace(/"/g, '""')}"`,
        `"${purchased}"`, `"${expires}"`
      ].join(',');
    });

    const csv = header + '\n' + rows.join('\n');
    const filename = `pala-gift-cards-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[EXPORT] Error:', err);
    res.status(500).json({ error: 'Failed to export gift cards' });
  }
});

module.exports = router;
