const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

function generateGiftCardPDF(giftCard) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const olive = '#636845';
      const cream = '#FAF8F5';
      const mid = '#5a5a5a';
      const pageWidth = 595.28;
      const contentWidth = pageWidth - 120;

      // Background
      doc.rect(0, 0, pageWidth, 841.89).fill(cream);

      // Logo text (using Helvetica as fallback — Cabin not available in PDFKit)
      doc.fontSize(16).fill(olive).font('Helvetica-Bold');
      doc.text('PALA PIZZA', 60, 60, { align: 'center', width: contentWidth });

      doc.fontSize(9).fill(mid).font('Helvetica');
      doc.text('PIZZA AL TAGLIO \u2022 LEITH, EDINBURGH', 60, 82, { align: 'center', width: contentWidth });

      // Olive divider
      doc.moveTo(180, 110).lineTo(pageWidth - 180, 110).lineWidth(1).stroke(olive);

      // Gift Card Box
      const boxTop = 150;
      const boxHeight = 320;

      doc.roundedRect(80, boxTop, pageWidth - 160, boxHeight, 4)
        .lineWidth(1.5)
        .stroke(olive);

      // "GIFT CARD" label
      doc.fontSize(12).fill(olive).font('Helvetica');
      doc.text('GIFT CARD', 60, boxTop + 30, { align: 'center', width: contentWidth });

      // Amount
      const amountStr = '\u00A3' + (giftCard.initial_amount / 100).toFixed(0);
      doc.fontSize(72).fill(olive).font('Helvetica-Bold');
      doc.text(amountStr, 60, boxTop + 55, { align: 'center', width: contentWidth });

      // Divider inside box
      doc.moveTo(160, boxTop + 150).lineTo(pageWidth - 160, boxTop + 150).lineWidth(0.5).stroke(olive);

      // Code
      doc.fontSize(28).fill('#1a1a1a').font('Courier-Bold');
      doc.text(giftCard.code, 60, boxTop + 170, { align: 'center', width: contentWidth, characterSpacing: 4 });

      // Divider
      doc.moveTo(160, boxTop + 215).lineTo(pageWidth - 160, boxTop + 215).lineWidth(0.5).stroke(olive);

      // Expiry
      const expiryDate = giftCard.expires_at
        ? new Date(giftCard.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '12 months from purchase';

      doc.fontSize(10).fill(mid).font('Helvetica');
      doc.text('Valid until ' + expiryDate, 60, boxTop + 230, { align: 'center', width: contentWidth });

      // Recipient name if available
      if (giftCard.recipient_name && giftCard.send_to !== 'self') {
        doc.fontSize(11).fill(olive).font('Helvetica');
        doc.text('For ' + giftCard.recipient_name, 60, boxTop + 260, { align: 'center', width: contentWidth });
      }

      // Personal message if available
      if (giftCard.personal_message) {
        doc.fontSize(10).fill(mid).font('Helvetica-Oblique');
        doc.text('"' + giftCard.personal_message + '"', 100, boxTop + 280, {
          align: 'center',
          width: contentWidth - 40,
        });
      }

      // Footer
      const footerY = boxTop + boxHeight + 40;

      doc.fontSize(11).fill(olive).font('Helvetica-Bold');
      doc.text('Redeem in person at Pala Pizza', 60, footerY, { align: 'center', width: contentWidth });

      doc.fontSize(9).fill(mid).font('Helvetica');
      doc.text('7 Jane Street, Leith, Edinburgh', 60, footerY + 18, { align: 'center', width: contentWidth });
      doc.text('palapizza.co.uk', 60, footerY + 33, { align: 'center', width: contentWidth });

      doc.fontSize(8).fill('#999999').font('Helvetica');
      doc.text('Present this card when you visit. Can be used for anything on our menu.', 60, footerY + 60, { align: 'center', width: contentWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateGiftCardPDF };
