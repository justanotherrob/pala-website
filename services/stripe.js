const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const db = require('../db/database');
const { sendGiftCardEmail, sendPurchaserReceipt } = require('./email');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateUniqueCode() {
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    const existing = db.get('SELECT id FROM gift_cards WHERE code = ?', [code]);
    if (!existing) return code;
    attempts++;
  } while (attempts < 100);
  throw new Error('Could not generate unique gift card code');
}

async function createCheckoutSession({ amount, purchaserName, purchaserEmail, recipientName, recipientEmail, sendTo, personalMessage }) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'gbp',
        product_data: {
          name: `Pala Pizza Gift Card £${(amount / 100).toFixed(0)}`,
          description: 'Redeemable at Pala Pizza, Leith, Edinburgh',
        },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    customer_email: purchaserEmail,
    mode: 'payment',
    return_url: `${baseUrl}/gift-cards/success?session_id={CHECKOUT_SESSION_ID}`,
    metadata: {
      type: 'gift_card',
      purchaser_name: purchaserName,
      purchaser_email: purchaserEmail,
      recipient_name: recipientName || purchaserName,
      recipient_email: recipientEmail || purchaserEmail,
      send_to: sendTo,
      personal_message: (personalMessage || '').substring(0, 300),
    },
  });

  db.run(`
    INSERT INTO gift_cards (code, initial_amount, balance, status, purchaser_email, purchaser_name, recipient_email, recipient_name, send_to, personal_message, stripe_session_id, expires_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'PENDING-' + session.id.slice(-12),
    amount, amount,
    purchaserEmail, purchaserName,
    recipientEmail || purchaserEmail,
    recipientName || purchaserName,
    sendTo,
    personalMessage || null,
    session.id,
    expiresAt
  ]);

  return session;
}

async function handleWebhook(event) {
  console.log('[STRIPE] handleWebhook called, event type:', event.type);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('[STRIPE] Session ID:', session.id);

    if (session.metadata?.type !== 'gift_card') {
      console.log('[STRIPE] Not a gift card payment, skipping');
      return;
    }

    const card = db.get('SELECT * FROM gift_cards WHERE stripe_session_id = ?', [session.id]);
    if (!card) {
      console.error('[STRIPE] Gift card not found for session:', session.id);
      return;
    }

    if (card.status !== 'pending') {
      console.log('[STRIPE] Card already processed, skipping');
      return;
    }

    const code = generateUniqueCode();
    const now = new Date().toISOString();

    db.run(
      "UPDATE gift_cards SET code = ?, status = 'active', stripe_payment_intent = ?, purchased_at = ? WHERE id = ?",
      [code, session.payment_intent, now, card.id]
    );
    console.log('[STRIPE] Card activated with code:', code);

    db.run(
      "INSERT INTO gift_card_transactions (gift_card_id, amount, type, note) VALUES (?, ?, 'purchase', 'Stripe payment')",
      [card.id, card.initial_amount]
    );

    try {
      const updatedCard = db.get('SELECT * FROM gift_cards WHERE id = ?', [card.id]);
      await sendGiftCardEmail(updatedCard);
      console.log('[STRIPE] Gift card email sent');
      if (updatedCard.send_to === 'friend') {
        await sendPurchaserReceipt(updatedCard);
        console.log('[STRIPE] Purchaser receipt sent');
      }
    } catch (err) {
      console.error('[STRIPE] Failed to send gift card email:', err);
    }
  }
}

module.exports = { createCheckoutSession, handleWebhook };
