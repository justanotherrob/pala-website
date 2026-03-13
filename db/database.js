const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const db = {
  query: (sql, params = []) => pool.query(sql, params),
  get: async (sql, params = []) => {
    const { rows } = await pool.query(sql, params);
    return rows[0] || null;
  },
  all: async (sql, params = []) => {
    const { rows } = await pool.query(sql, params);
    return rows;
  },
  run: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result;
  },
  pool,
};

async function initDatabase() {
  await pool.query(`
    -- Users (admin accounts)
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Menu items
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT,
      price INTEGER,
      sort_order INTEGER DEFAULT 0,
      visible BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Allergens list
    CREATE TABLE IF NOT EXISTS allergens (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    -- Menu item allergen matrix
    CREATE TABLE IF NOT EXISTS menu_allergens (
      id SERIAL PRIMARY KEY,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      allergen_id INTEGER NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
      value TEXT NOT NULL DEFAULT '',
      UNIQUE(menu_item_id, allergen_id)
    );

    -- Opening hours
    CREATE TABLE IF NOT EXISTS opening_hours (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      times TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Site settings (key-value)
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      label TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Gift cards
    CREATE TABLE IF NOT EXISTS gift_cards (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      initial_amount INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL DEFAULT 'pending',
      purchaser_email TEXT,
      purchaser_name TEXT,
      recipient_email TEXT,
      recipient_name TEXT,
      send_to TEXT DEFAULT 'self',
      personal_message TEXT,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      purchased_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Gift card transactions
    CREATE TABLE IF NOT EXISTS gift_card_transactions (
      id SERIAL PRIMARY KEY,
      gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id),
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      redeemed_by_user_id INTEGER REFERENCES users(id),
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
    CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
    CREATE INDEX IF NOT EXISTS idx_gift_cards_stripe ON gift_cards(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_order ON menu_items(sort_order);
    CREATE INDEX IF NOT EXISTS idx_menu_allergens_item ON menu_allergens(menu_item_id);
  `);

  // Seed default allergens if empty
  const allergenCount = await db.get('SELECT COUNT(*) as count FROM allergens');
  if (parseInt(allergenCount.count) === 0) {
    const defaultAllergens = [
      'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Peanuts',
      'Soybeans', 'Milk', 'Nuts', 'Celery', 'Mustard',
      'Sesame', 'Sulphites', 'Lupin', 'Molluscs'
    ];
    for (let i = 0; i < defaultAllergens.length; i++) {
      await pool.query(
        'INSERT INTO allergens (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [defaultAllergens[i], i]
      );
    }
  }

  // Seed default opening hours if empty
  const hoursCount = await db.get('SELECT COUNT(*) as count FROM opening_hours');
  if (parseInt(hoursCount.count) === 0) {
    const defaultHours = [
      { label: 'Thursday & Friday', times: '4 – 8pm', sort_order: 0 },
      { label: 'Saturday', times: '2 – 8pm', sort_order: 1 },
      { label: 'Sunday', times: '2 – 6pm', sort_order: 2 },
    ];
    for (const h of defaultHours) {
      await pool.query(
        'INSERT INTO opening_hours (label, times, sort_order) VALUES ($1, $2, $3)',
        [h.label, h.times, h.sort_order]
      );
    }
  }

  // Seed site settings if empty
  const settingsCount = await db.get('SELECT COUNT(*) as count FROM site_settings');
  if (parseInt(settingsCount.count) === 0) {
    const defaults = [
      { key: 'site_name', value: 'Pala Pizza', label: 'Site Name' },
      { key: 'tagline', value: 'Leith, Edinburgh', label: 'Tagline' },
      { key: 'hero_title', value: 'Pizza <em>al Taglio</em><br>Romana', label: 'Hero Title (HTML allowed)' },
      { key: 'hero_subtitle', value: 'Baked crisp. Cut to order. Roman-style pizza by the slice from our kitchen on Jane Street.', label: 'Hero Subtitle' },
      { key: 'about_text', value: 'Pizza al taglio — Roman-style pizza baked in long trays, crisp on the outside, light and airy within. We make ours fresh at 7 Jane Street using slow-fermented dough and seasonal toppings. Walk in, pick your slice, and we cut it to order.', label: 'About Text' },
      { key: 'address', value: '7 Jane Street, Leith, Edinburgh', label: 'Address' },
      { key: 'address_line1', value: '7 Jane Street', label: 'Address Line 1' },
      { key: 'address_line2', value: 'Leith, Edinburgh', label: 'Address Line 2' },
      { key: 'maps_url', value: 'https://maps.app.goo.gl/refCJDhQGju6NiAx9', label: 'Google Maps URL' },
      { key: 'instagram_url', value: 'https://instagram.com/pala.edin', label: 'Instagram URL' },
      { key: 'instagram_handle', value: '@pala.edin', label: 'Instagram Handle' },
      { key: 'email_address', value: 'ciao@palapizza.co.uk', label: 'Contact Email' },
      { key: 'email_subject', value: 'Website order/Query', label: 'Contact Email Subject' },
      { key: 'gift_cards_enabled', value: 'true', label: 'Gift Cards Enabled' },
    ];
    for (const s of defaults) {
      await pool.query(
        'INSERT INTO site_settings (key, value, label) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
        [s.key, s.value, s.label]
      );
    }
  }

  console.log('Database initialized');
}

module.exports = db;
module.exports.initDatabase = initDatabase;
