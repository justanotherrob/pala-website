require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const db = require('./db/database');
const { initDatabase } = require('./db/database');
const { handleWebhook } = require('./services/stripe');
const { createCheckoutSession } = require('./services/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy (needed for secure cookies)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Stripe Webhook (MUST be before body-parser) ─────────
app.post('/webhook/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  console.log('[WEBHOOK] Received webhook request');
  if (!stripe) {
    console.error('[WEBHOOK] Stripe not configured');
    return res.status(503).send('Stripe not configured');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('[WEBHOOK] Event verified:', event.type, event.id);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification FAILED:', err.message);
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    await handleWebhook(event);
    console.log('[WEBHOOK] Handler completed successfully');
  } catch (err) {
    console.error('[WEBHOOK] Handler error:', err);
  }

  res.json({ received: true });
});

// ── Security ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Middleware ───────────────────────────────────────────
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session store (SQLite)
const sessionDbPath = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'sessions.db')
  : path.join(__dirname, 'data', 'sessions.db');
fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
const sessionDb = new Database(sessionDbPath);

app.use(session({
  store: new SqliteStore({
    client: sessionDb,
    expired: { clear: true, intervalMs: 24 * 60 * 60 * 1000 },
  }),
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev-secret-change-me'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Static files (cache images/css/js for 7 days)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
}));

// ── Routes ──────────────────────────────────────────────
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// ── Gift Card Checkout (public) ─────────────────────────
app.post('/gift-cards/checkout', checkoutLimiter, async (req, res) => {
  try {
    const { amount, purchaserName, purchaserEmail, recipientName, recipientEmail, sendTo, personalMessage } = req.body;
    console.log('[CHECKOUT] Request:', { amount, purchaserName, purchaserEmail, sendTo });

    // Check if gift cards are enabled
    const gcSetting = db.get("SELECT value FROM site_settings WHERE key = ?", ['gift_cards_enabled']);
    if (!gcSetting || gcSetting.value !== 'true') {
      return res.status(403).json({ error: 'Gift cards are not currently available.' });
    }

    if (!stripe) {
      return res.status(503).json({ error: 'Payment system is not configured. Please try again later.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!purchaserName || !purchaserEmail) {
      return res.status(400).json({ error: 'Please enter your name and email.' });
    }

    if (!emailRegex.test(purchaserEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const amountPence = parseInt(amount);
    if (isNaN(amountPence) || amountPence < 1500 || amountPence > 15000) {
      return res.status(400).json({ error: 'Amount must be between £15 and £150' });
    }

    if (sendTo === 'friend' && (!recipientName || !recipientEmail)) {
      return res.status(400).json({ error: 'Please enter recipient details.' });
    }

    if (sendTo === 'friend' && recipientEmail && !emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Please enter a valid recipient email address.' });
    }

    const session = await createCheckoutSession({
      amount: amountPence,
      purchaserName,
      purchaserEmail,
      recipientName: sendTo === 'friend' ? recipientName : null,
      recipientEmail: sendTo === 'friend' ? recipientEmail : null,
      sendTo: sendTo || 'self',
      personalMessage: sendTo === 'friend' ? (personalMessage || '').substring(0, 300) : null,
    });

    console.log('[CHECKOUT] Session created:', session.id);
    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('[CHECKOUT] Error:', err.message);
    const userMessage = err.type === 'StripeInvalidRequestError'
      ? 'There was a problem with the payment setup. Please try again.'
      : 'Something went wrong. Please try again.';
    res.status(500).json({ error: userMessage });
  }
});

// ── Gift Card Status Polling (public) ───────────────────
app.get('/gift-cards/status', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });

  const card = db.get(
    'SELECT status, initial_amount, recipient_email, recipient_name, purchaser_email, send_to FROM gift_cards WHERE stripe_session_id = ?',
    [sessionId]
  );
  if (!card) return res.json({ status: 'not_found' });

  res.json({
    status: card.status,
    amount: card.status === 'active' ? (card.initial_amount / 100).toFixed(2) : null,
    sendTo: card.send_to,
    recipientName: card.recipient_name,
    emailSentTo: card.status === 'active' ? (card.send_to === 'friend' ? card.recipient_email : card.purchaser_email) : null,
  });
});

// ── Version check ───────────────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({ version: 'v1-pala-pizza', deployed: new Date().toISOString() });
});

// ── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).redirect('/');
});

// ── Error Handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong');
});

// ── Cleanup: stale pending gift cards ───────────────────
function cleanupPendingGiftCards() {
  try {
    const result = db.run(
      "DELETE FROM gift_cards WHERE status = 'pending' AND created_at < datetime('now', '-24 hours')"
    );
    const count = result.changes || 0;
    if (count > 0) {
      console.log(`[CLEANUP] Removed ${count} abandoned pending gift card(s)`);
    }
  } catch (err) {
    console.error('[CLEANUP] Error:', err.message);
  }
}

// ── Auto-seed admin user on startup ─────────────────────
async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('[SEED] ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping auto-seed');
    return;
  }
  try {
    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      console.log(`[SEED] Admin user already exists: ${email}`);
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    db.run('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', [email, hash, 'Admin']);
    console.log(`[SEED] Admin user created: ${email}`);
  } catch (err) {
    console.error('[SEED] Error:', err.message);
  }
}

// ── Start ───────────────────────────────────────────────
async function start() {
  initDatabase();
  await seedAdmin();

  cleanupPendingGiftCards();
  setInterval(cleanupPendingGiftCards, 24 * 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\n  Pala Pizza running at http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
