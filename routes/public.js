const express = require('express');
const db = require('../db/database');
const router = express.Router();

// Helper to load all site settings as an object
async function getSettings() {
  const rows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

// Home page
router.get('/', async (req, res) => {
  try {
    const settings = await getSettings();
    const hours = await db.all('SELECT * FROM opening_hours ORDER BY sort_order');
    const menuItems = await db.all("SELECT * FROM menu_items WHERE visible = true ORDER BY CASE WHEN category = 'pizza' THEN 0 WHEN category = 'dessert' THEN 1 ELSE 2 END, sort_order, id");
    const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

    res.render('index', { settings, hours, menuItems, stripeKey });
  } catch (err) {
    console.error('Error loading home:', err);
    res.status(500).send('Something went wrong');
  }
});

// Allergens page
router.get('/allergens', async (req, res) => {
  try {
    const settings = await getSettings();
    const menuItems = await db.all('SELECT * FROM menu_items WHERE visible = true ORDER BY sort_order, id');
    const allergens = await db.all('SELECT * FROM allergens ORDER BY sort_order, id');

    // Build allergen matrix
    const matrix = [];
    for (const item of menuItems) {
      const allergenValues = await db.all(
        'SELECT allergen_id, value FROM menu_allergens WHERE menu_item_id = $1',
        [item.id]
      );
      const valueMap = {};
      for (const av of allergenValues) valueMap[av.allergen_id] = av.value;
      matrix.push({
        name: item.name,
        values: allergens.map(a => valueMap[a.id] || ''),
      });
    }

    res.render('allergens', { settings, allergens, matrix });
  } catch (err) {
    console.error('Error loading allergens:', err);
    res.status(500).send('Something went wrong');
  }
});

// Gift cards page
router.get('/gift-cards', async (req, res) => {
  try {
    const settings = await getSettings();
    const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    res.render('gift-cards', { settings, stripeKey });
  } catch (err) {
    console.error('Error loading gift cards:', err);
    res.status(500).send('Something went wrong');
  }
});

// Gift cards success (fallback return URL)
router.get('/gift-cards/success', async (req, res) => {
  try {
    const settings = await getSettings();
    const sessionId = req.query.session_id;
    let card = null;
    if (sessionId) {
      card = await db.get(
        'SELECT status, initial_amount, recipient_email, recipient_name, purchaser_email, send_to FROM gift_cards WHERE stripe_session_id = $1',
        [sessionId]
      );
    }
    res.render('gift-cards-success', { settings, card });
  } catch (err) {
    console.error('Error loading gift cards success:', err);
    res.status(500).send('Something went wrong');
  }
});

// API: menu items (public, for any AJAX needs)
router.get('/api/menu', async (req, res) => {
  try {
    const items = await db.all('SELECT name, tag, price FROM menu_items WHERE visible = true ORDER BY sort_order, id');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

// API: allergens (public)
router.get('/api/allergens', async (req, res) => {
  try {
    const menuItems = await db.all('SELECT * FROM menu_items WHERE visible = true ORDER BY sort_order, id');
    const allergens = await db.all('SELECT * FROM allergens ORDER BY sort_order, id');
    const allValues = await db.all('SELECT * FROM menu_allergens');

    const valueMap = {};
    for (const v of allValues) {
      if (!valueMap[v.menu_item_id]) valueMap[v.menu_item_id] = {};
      valueMap[v.menu_item_id][v.allergen_id] = v.value;
    }

    res.json({
      dishes: menuItems.map(i => i.name),
      allergens: allergens.map(a => ({
        name: a.name,
        values: menuItems.map(i => (valueMap[i.id] && valueMap[i.id][a.id]) || ''),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load allergens' });
  }
});

module.exports = router;
module.exports.getSettings = getSettings;
