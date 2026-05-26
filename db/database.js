const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'pala.db');

// Ensure directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

// Performance and safety pragmas
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Convert JS booleans to 1/0 for SQLite
function convertParams(params) {
  return params.map(p => (p === true ? 1 : p === false ? 0 : p));
}

const db = {
  get: (sql, params = []) => {
    return sqlite.prepare(sql).get(...convertParams(params)) || null;
  },
  all: (sql, params = []) => {
    return sqlite.prepare(sql).all(...convertParams(params));
  },
  run: (sql, params = []) => {
    const result = sqlite.prepare(sql).run(...convertParams(params));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  },
  exec: (sql) => sqlite.exec(sql),
};

function initDatabase() {
  sqlite.exec(`
    -- Users (admin accounts)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Menu items
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tag TEXT,
      price INTEGER,
      category TEXT NOT NULL DEFAULT 'pizza',
      sort_order INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Allergens list
    CREATE TABLE IF NOT EXISTS allergens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    -- Menu item allergen matrix
    CREATE TABLE IF NOT EXISTS menu_allergens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      allergen_id INTEGER NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
      value TEXT NOT NULL DEFAULT '',
      UNIQUE(menu_item_id, allergen_id)
    );

    -- Opening hours
    CREATE TABLE IF NOT EXISTS opening_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      times TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Temporary opening hours (date-specific overrides)
    CREATE TABLE IF NOT EXISTS temporary_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      label TEXT NOT NULL,
      times TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_temporary_hours_date ON temporary_hours(date);

    -- Site settings (key-value)
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      label TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Gift cards
    CREATE TABLE IF NOT EXISTS gift_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      purchased_at DATETIME,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Gift card transactions
    CREATE TABLE IF NOT EXISTS gift_card_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id),
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      redeemed_by_user_id INTEGER REFERENCES users(id),
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
    CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
    CREATE INDEX IF NOT EXISTS idx_gift_cards_stripe ON gift_cards(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_order ON menu_items(sort_order);
    CREATE INDEX IF NOT EXISTS idx_menu_allergens_item ON menu_allergens(menu_item_id);
  `);

  // Seed default allergens if empty
  const allergenCount = db.get('SELECT COUNT(*) as count FROM allergens');
  if (parseInt(allergenCount.count) === 0) {
    const defaultAllergens = [
      'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Peanuts',
      'Soybeans', 'Milk', 'Nuts', 'Celery', 'Mustard',
      'Sesame', 'Sulphites', 'Lupin', 'Molluscs'
    ];
    const stmt = sqlite.prepare('INSERT OR IGNORE INTO allergens (name, sort_order) VALUES (?, ?)');
    for (let i = 0; i < defaultAllergens.length; i++) {
      stmt.run(defaultAllergens[i], i);
    }
  }

  // Seed default opening hours if empty
  const hoursCount = db.get('SELECT COUNT(*) as count FROM opening_hours');
  if (parseInt(hoursCount.count) === 0) {
    const defaultHours = [
      { label: 'Thursday & Friday', times: '4 – 8pm', sort_order: 0 },
      { label: 'Saturday', times: '2 – 8pm', sort_order: 1 },
      { label: 'Sunday', times: '2 – 6pm', sort_order: 2 },
    ];
    const stmt = sqlite.prepare('INSERT INTO opening_hours (label, times, sort_order) VALUES (?, ?, ?)');
    for (const h of defaultHours) {
      stmt.run(h.label, h.times, h.sort_order);
    }
  }

  // Seed site settings if empty
  const settingsCount = db.get('SELECT COUNT(*) as count FROM site_settings');
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
      { key: 'pizza_price_label', value: '£6 / SLICE', label: 'Pizza Price Label (shown once below all slices)' },
    ];
    const stmt = sqlite.prepare('INSERT OR IGNORE INTO site_settings (key, value, label) VALUES (?, ?, ?)');
    for (const s of defaults) {
      stmt.run(s.key, s.value, s.label);
    }
  }

  // Ensure pizza_price_label exists (for existing databases)
  sqlite.prepare(
    "INSERT OR IGNORE INTO site_settings (key, value, label) VALUES ('pizza_price_label', '£6 / SLICE', 'Pizza Price Label (shown once below all slices)')"
  ).run();

  // Ensure announcement settings exist (for existing databases)
  const announcementDefaults = [
    { key: 'banner_enabled', value: 'false', label: 'Banner Enabled' },
    { key: 'banner_text', value: '', label: 'Banner Text' },
    { key: 'popup_enabled', value: 'false', label: 'Popup Enabled' },
    { key: 'popup_title', value: '', label: 'Popup Title' },
    { key: 'popup_text', value: '', label: 'Popup Text' },
  ];
  const settingsStmt = sqlite.prepare('INSERT OR IGNORE INTO site_settings (key, value, label) VALUES (?, ?, ?)');
  for (const s of announcementDefaults) {
    settingsStmt.run(s.key, s.value, s.label);
  }

  console.log('Database initialized');
}

module.exports = db;
module.exports.initDatabase = initDatabase;
