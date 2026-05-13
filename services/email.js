const { Resend } = require('resend');
const { generateGiftCardPDF } = require('./pdf');

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const fromEmail = process.env.RESEND_FROM_EMAIL || 'Pala Pizza <ciao@palapizza.co.uk>';

function emailHeader() {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F5F3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F3;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#F7F5F3;overflow:hidden;">
        <tr><td style="padding:30px 40px 20px;text-align:center;">
          <h1 style="color:#1a1a1a;font-size:18px;letter-spacing:4px;margin:0;">PALA PIZZA</h1>
          <p style="color:#5a5a5a;font-size:11px;letter-spacing:2px;margin:5px 0 0;">PIZZA AL TAGLIO &middot; LEITH, EDINBURGH</p>
        </td></tr>
        <tr><td style="padding:0 60px;"><hr style="border:none;border-top:1px solid rgba(0,0,0,0.1);margin:0;"></td></tr>`;
}

function emailFooter() {
  return `
        <tr><td style="padding:20px 40px 30px;text-align:center;border-top:1px solid rgba(0,0,0,0.08);">
          <p style="color:#999;font-size:11px;letter-spacing:1px;margin:0 0 5px;">7 Jane Street, Leith, Edinburgh</p>
          <p style="color:#bbb;font-size:11px;margin:0;">palapizza.co.uk</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendGiftCardEmail(giftCard, overrideEmail) {
  const amountStr = `\u00A3${(giftCard.initial_amount / 100).toFixed(0)}`;
  const expiryDate = giftCard.expires_at
    ? new Date(giftCard.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '12 months from purchase';

  const toEmail = overrideEmail || (giftCard.send_to === 'friend' ? giftCard.recipient_email : giftCard.purchaser_email);
  const toName = giftCard.send_to === 'friend' ? giftCard.recipient_name : giftCard.purchaser_name;
  const isFriend = giftCard.send_to === 'friend';

  let subject, greeting, closingText;

  if (isFriend) {
    subject = `You've received a ${amountStr} Pala Pizza gift card!`;
    greeting = `${giftCard.purchaser_name} has sent you a ${amountStr} gift card to Pala Pizza!`;
    closingText = 'Present this code when you visit Pala Pizza to redeem your gift card. It can be used for anything on our menu.';
  } else {
    subject = `Your ${amountStr} Pala Pizza Gift Card`;
    greeting = `Here's your ${amountStr} Pala Pizza gift card. We've attached a version you can print and give in person.`;
    closingText = 'Present this card when you visit Pala Pizza. It can be used for anything on our menu.';
  }

  const html = emailHeader() + `
        <tr><td style="padding:30px 40px;">
          <p style="color:#1a1a1a;font-size:15px;line-height:1.6;margin:0 0 15px;">Hi${toName ? ' ' + toName : ''},</p>
          <p style="color:#1a1a1a;font-size:15px;line-height:1.6;margin:0 0 25px;">${greeting}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.08);border-radius:6px;margin-bottom:25px;">
            <tr><td style="padding:25px;text-align:center;">
              <p style="color:#636845;font-size:36px;font-weight:bold;margin:0 0 8px;">${amountStr}</p>
              <p style="color:#1a1a1a;font-size:20px;font-family:monospace;letter-spacing:3px;margin:0 0 12px;">${giftCard.code}</p>
              <p style="color:#999;font-size:12px;margin:0;">Valid until ${expiryDate}</p>
            </td></tr>
          </table>

          ${isFriend && giftCard.personal_message ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.02);border-left:3px solid #636845;border-radius:0 4px 4px 0;margin-bottom:20px;">
            <tr><td style="padding:15px 20px;">
              <p style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Personal Message</p>
              <p style="color:#1a1a1a;font-size:14px;font-style:italic;line-height:1.5;margin:0;">"${escapeHtml(giftCard.personal_message)}"</p>
            </td></tr>
          </table>` : ''}

          <p style="color:#5a5a5a;font-size:13px;line-height:1.6;margin:0;">
            ${closingText}
          </p>
        </td></tr>` + emailFooter();

  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping gift card email to', toEmail);
    return { skipped: true };
  }

  const emailOptions = {
    from: fromEmail,
    to: [toEmail],
    subject: subject,
    html: html,
  };

  if (!isFriend) {
    const pdf = await generateGiftCardPDF(giftCard);
    emailOptions.attachments = [{
      filename: `PalaPizza-GiftCard-${giftCard.code}.pdf`,
      content: pdf.toString('base64'),
      contentType: 'application/pdf',
    }];
  }

  const result = await resend.emails.send(emailOptions);
  console.log(`Gift card email sent to ${toEmail}:`, result);
  return result;
}

async function sendPurchaserReceipt(giftCard, overrideEmail) {
  const amountStr = `\u00A3${(giftCard.initial_amount / 100).toFixed(0)}`;
  const toEmail = overrideEmail || giftCard.purchaser_email;
  const toName = giftCard.purchaser_name;
  const purchaseDate = giftCard.purchased_at
    ? new Date(giftCard.purchased_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const expiryDate = giftCard.expires_at
    ? new Date(giftCard.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '12 months from purchase';

  const html = emailHeader() + `
        <tr><td style="padding:30px 40px;">
          <p style="color:#1a1a1a;font-size:15px;line-height:1.6;margin:0 0 15px;">Hi${toName ? ' ' + toName : ''},</p>
          <p style="color:#1a1a1a;font-size:15px;line-height:1.6;margin:0 0 10px;">Thanks for your purchase!</p>
          <p style="color:#1a1a1a;font-size:15px;line-height:1.6;margin:0 0 25px;">We've sent a ${amountStr} gift card to <strong>${giftCard.recipient_name}</strong> at <strong>${giftCard.recipient_email}</strong>.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.08);border-radius:6px;margin-bottom:25px;">
            <tr><td style="padding:20px 25px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#999;font-size:13px;padding:6px 0;">Amount</td>
                  <td style="color:#1a1a1a;font-size:13px;font-weight:bold;padding:6px 0;text-align:right;">${amountStr}</td>
                </tr>
                <tr>
                  <td style="color:#999;font-size:13px;padding:6px 0;">Sent to</td>
                  <td style="color:#1a1a1a;font-size:13px;padding:6px 0;text-align:right;">${giftCard.recipient_name}</td>
                </tr>
                <tr>
                  <td style="color:#999;font-size:13px;padding:6px 0;">Date</td>
                  <td style="color:#1a1a1a;font-size:13px;padding:6px 0;text-align:right;">${purchaseDate}</td>
                </tr>
                <tr>
                  <td style="color:#999;font-size:13px;padding:6px 0;">Valid Until</td>
                  <td style="color:#1a1a1a;font-size:13px;padding:6px 0;text-align:right;">${expiryDate}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <p style="color:#5a5a5a;font-size:13px;line-height:1.6;margin:0;">
            This is your purchase receipt. If you have any questions, pop in or email us at ciao@palapizza.co.uk.
          </p>
        </td></tr>` + emailFooter();

  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping receipt email to', toEmail);
    return { skipped: true };
  }

  const result = await resend.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject: `Your Pala Pizza Gift Card Receipt - ${amountStr}`,
    html: html,
  });

  console.log(`Purchase receipt sent to ${toEmail}:`, result);
  return result;
}

module.exports = { sendGiftCardEmail, sendPurchaserReceipt };
