const express = require('express');
const db = require('../db/database');
const cache = require('../services/cache');
const router = express.Router();

// Helper to load all site settings as an object
function getSettings() {
  const hit = cache.get('settings');
  if (hit) return hit;
  const rows = db.all('SELECT key, value FROM site_settings');
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  cache.set('settings', settings);
  return settings;
}

// Home page
router.get('/', async (req, res) => {
  try {
    const settings = getSettings();
    const hours = cache.cached('hours', () =>
      db.all('SELECT * FROM opening_hours ORDER BY sort_order')
    )();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const lookaheadDays = parseInt(settings.temp_hours_days) || 7;
    const maxDate = new Date(new Date(today + 'T00:00:00').getTime() + lookaheadDays * 86400000)
      .toLocaleDateString('en-CA');
    const tempHours = cache.cached('temp-hours', () => {
      const rows = db.all(
        'SELECT * FROM temporary_hours WHERE date >= ? AND date <= ? ORDER BY date ASC',
        [today, maxDate]
      );
      return rows.map(r => ({
        ...r,
        dateFormatted: new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short'
        })
      }));
    }, 10 * 60 * 1000)();
    const menuItems = cache.cached('menu', () =>
      db.all("SELECT * FROM menu_items WHERE visible = 1 ORDER BY CASE WHEN category = 'pizza' THEN 0 WHEN category = 'dessert' THEN 1 ELSE 2 END, sort_order, id")
    )();
    const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

    res.render('index', { settings, hours, tempHours, menuItems, stripeKey });
  } catch (err) {
    console.error('Error loading home:', err);
    res.status(500).send('Something went wrong');
  }
});

// Allergens page
router.get('/allergens', async (req, res) => {
  try {
    const settings = getSettings();
    const { allergens, matrix } = cache.cached('allergen-matrix', () => {
      const menuItems = db.all('SELECT * FROM menu_items WHERE visible = 1 ORDER BY sort_order, id');
      const allergens = db.all('SELECT * FROM allergens ORDER BY sort_order, id');
      const allValues = db.all('SELECT menu_item_id, allergen_id, value FROM menu_allergens');

      const valueMap = {};
      for (const v of allValues) {
        if (!valueMap[v.menu_item_id]) valueMap[v.menu_item_id] = {};
        valueMap[v.menu_item_id][v.allergen_id] = v.value;
      }

      const matrix = menuItems.map(item => ({
        name: item.name,
        values: allergens.map(a => (valueMap[item.id] && valueMap[item.id][a.id]) || ''),
      }));

      return { allergens, matrix };
    })();

    res.render('allergens', { settings, allergens, matrix });
  } catch (err) {
    console.error('Error loading allergens:', err);
    res.status(500).send('Something went wrong');
  }
});

// Gift cards page
router.get('/gift-cards', async (req, res) => {
  try {
    const settings = getSettings();
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
    const settings = getSettings();
    const sessionId = req.query.session_id;
    let card = null;
    if (sessionId) {
      card = db.get(
        'SELECT status, initial_amount, recipient_email, recipient_name, purchaser_email, send_to FROM gift_cards WHERE stripe_session_id = ?',
        [sessionId]
      );
    }
    res.render('gift-cards-success', { settings, card });
  } catch (err) {
    console.error('Error loading gift cards success:', err);
    res.status(500).send('Something went wrong');
  }
});

// Privacy policy
router.get('/privacy', async (req, res) => {
  try {
    const settings = getSettings();
    res.render('privacy', { settings });
  } catch (err) {
    console.error('Error loading privacy policy:', err);
    res.status(500).send('Something went wrong');
  }
});

// API: menu items (public, for any AJAX needs)
router.get('/api/menu', async (req, res) => {
  try {
    const items = cache.cached('api-menu', () =>
      db.all('SELECT name, tag, price FROM menu_items WHERE visible = 1 ORDER BY sort_order, id')
    )();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

// API: allergens (public)
router.get('/api/allergens', async (req, res) => {
  try {
    const data = cache.cached('api-allergens', () => {
      const menuItems = db.all('SELECT * FROM menu_items WHERE visible = 1 ORDER BY sort_order, id');
      const allergens = db.all('SELECT * FROM allergens ORDER BY sort_order, id');
      const allValues = db.all('SELECT * FROM menu_allergens');

      const valueMap = {};
      for (const v of allValues) {
        if (!valueMap[v.menu_item_id]) valueMap[v.menu_item_id] = {};
        valueMap[v.menu_item_id][v.allergen_id] = v.value;
      }

      return {
        dishes: menuItems.map(i => i.name),
        allergens: allergens.map(a => ({
          name: a.name,
          values: menuItems.map(i => (valueMap[i.id] && valueMap[i.id][a.id]) || ''),
        })),
      };
    })();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load allergens' });
  }
});

module.exports = router;
module.exports.getSettings = getSettings;
