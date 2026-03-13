const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

// Login POST
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('admin/login', { error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  req.session.userName = user.name || user.email;
  res.redirect('/admin');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// All routes below require auth
router.use(requireAuth);

// Dashboard
router.get('/', async (req, res) => {
  const menuCount = await db.get('SELECT COUNT(*) as count FROM menu_items');
  const giftCardCount = await db.get("SELECT COUNT(*) as count FROM gift_cards WHERE status != 'pending'");
  const activeGiftCards = await db.get("SELECT COUNT(*) as count FROM gift_cards WHERE status = 'active'");
  res.render('admin/dashboard', {
    userName: req.session.userName,
    menuCount: parseInt(menuCount.count),
    giftCardCount: parseInt(giftCardCount.count),
    activeGiftCards: parseInt(activeGiftCards.count),
  });
});

// Menu management
router.get('/menu', async (req, res) => {
  const settings = {};
  const rows = await db.all('SELECT key, value FROM site_settings');
  for (const row of rows) settings[row.key] = row.value;
  const items = await db.all("SELECT * FROM menu_items ORDER BY CASE WHEN category = 'pizza' THEN 0 WHEN category = 'dessert' THEN 1 ELSE 2 END, sort_order, id");
  res.render('admin/menu', { items, settings });
});

// Allergen management
router.get('/allergens', async (req, res) => {
  const menuItems = await db.all('SELECT * FROM menu_items ORDER BY sort_order, id');
  const allergens = await db.all('SELECT * FROM allergens ORDER BY sort_order, id');

  // Build matrix
  const allValues = await db.all('SELECT * FROM menu_allergens');
  const valueMap = {};
  for (const v of allValues) {
    if (!valueMap[v.menu_item_id]) valueMap[v.menu_item_id] = {};
    valueMap[v.menu_item_id][v.allergen_id] = v.value;
  }

  res.render('admin/allergens', { menuItems, allergens, valueMap });
});

// Hours management
router.get('/hours', async (req, res) => {
  const hours = await db.all('SELECT * FROM opening_hours ORDER BY sort_order');
  res.render('admin/hours', { hours });
});

// Settings
router.get('/settings', async (req, res) => {
  const settings = await db.all('SELECT * FROM site_settings ORDER BY key');
  res.render('admin/settings', { settings });
});

// Gift cards list
router.get('/gift-cards', async (req, res) => {
  const status = req.query.status || 'all';
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const perPage = 20;
  const offset = (page - 1) * perPage;

  let where = "WHERE status != 'pending'";
  const params = [];
  let paramIdx = 1;

  if (status !== 'all') {
    where += ` AND status = $${paramIdx++}`;
    params.push(status);
  }
  if (search) {
    where += ` AND (code ILIKE $${paramIdx} OR purchaser_email ILIKE $${paramIdx} OR recipient_email ILIKE $${paramIdx})`;
    params.push('%' + search + '%');
    paramIdx++;
  }

  const countResult = await db.get(`SELECT COUNT(*) as count FROM gift_cards ${where}`, params);
  const total = parseInt(countResult.count);
  const totalPages = Math.ceil(total / perPage);

  const cards = await db.all(
    `SELECT * FROM gift_cards ${where} ORDER BY purchased_at DESC NULLS LAST LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  res.render('admin/gift-cards', { cards, status, search, page, totalPages, total });
});

// Gift card redeem page
router.get('/redeem', async (req, res) => {
  const code = req.query.code || '';
  let card = null;
  let transactions = [];

  if (code) {
    card = await db.get('SELECT * FROM gift_cards WHERE code = $1', [code]);
    if (card) {
      transactions = await db.all(
        'SELECT * FROM gift_card_transactions WHERE gift_card_id = $1 ORDER BY created_at DESC',
        [card.id]
      );
    }
  }

  res.render('admin/redeem', { code, card, transactions });
});

// Gift card import page
router.get('/import', async (req, res) => {
  res.render('admin/import');
});

module.exports = router;
