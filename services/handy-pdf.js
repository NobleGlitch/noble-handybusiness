"use strict";
// Handy invoice PDF renderer — streams a cream-and-hearth-orange branded PDF.
// Used by both public-download route and Danny's dashboard button.

const PDFDocument = require("pdfkit");

// Palette (matches dashboard.html)
const CREAM = "#FAF6EF";
const CREAM_2 = "#F3EEE4";
const INK = "#2A2622";
const INK_SOFT = "#6A6560";
const HAIR = "#E4DED2";
const ORANGE = "#E8955A";
const ORANGE_INK = "#B96B33";
const BLUE = "#3B6E8F";
const BLUE_INK = "#29506A";
const SAGE = "#6B9F72";

/**
 * Streams a PDF for the given invoice.
 * @param {object} invoice — hydrated invoice row (with line_items array, customer, business fields)
 * @param {object} user — handy_users row (business_name, business_phone, business_email, paypal_me, venmo, cashapp)
 * @param {object} res — Express response
 * @param {object[]} photos — optional array of {data_url, caption} for a photos page
 */
function renderInvoicePdf(invoice, user, res, photos) {
  const filename = "invoice-" + (invoice.invoice_number || invoice.id) + ".pdf";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="' + filename + '"');

  const doc = new PDFDocument({ size: "LETTER", margin: 50, info: {
    Title: "Invoice " + (invoice.invoice_number || ""),
    Author: user.business_name || "Handyman",
    Subject: "Invoice for " + (invoice.customer_name || "customer"),
  }});
  doc.pipe(res);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const M = 50;
  const contentW = pageW - M * 2;

  // ── HEADER BAND (cream background, hearth-orange accent stripe) ──
  doc.save();
  doc.rect(0, 0, pageW, 108).fill(CREAM);
  doc.rect(0, 0, pageW, 6).fill(ORANGE);
  doc.restore();

  // Business name (large, brand)
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK)
    .text(user.business_name || "Handyman Services", M, 24);

  // Business contact block (right side)
  const rightX = pageW - M - 220;
  doc.font("Helvetica").fontSize(9).fillColor(INK_SOFT);
  let ry = 26;
  if (user.business_phone) { doc.text(user.business_phone, rightX, ry, { width: 220, align: "right" }); ry += 12; }
  if (user.business_email) { doc.text(user.business_email, rightX, ry, { width: 220, align: "right" }); ry += 12; }
  ry += 4;
  // Handyman-exemption disclaimer (per Danny's license posture)
  doc.font("Helvetica-Oblique").fontSize(7).fillColor(INK_SOFT)
    .text("AZ Handyman Exemption · A.R.S. § 32-1121(A)(14) · projects under $1,000", rightX, ry, { width: 220, align: "right" });

  // Sub-line under business name: INVOICE label + number
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ORANGE_INK)
    .text("INVOICE " + (invoice.invoice_number || ""), M, 60);
  doc.font("Helvetica").fontSize(9).fillColor(INK_SOFT)
    .text("Created " + fmtDate(invoice.created_at) + (invoice.due_date ? "   ·   Due " + invoice.due_date : ""), M, 76);

  // ── BILL-TO + JOB (two columns) ──
  let y = 130;
  const colW = (contentW - 20) / 2;
  labelKey(doc, "BILL TO", M, y);
  labelKey(doc, "JOB", M + colW + 20, y);
  y += 14;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(invoice.customer_name || "Customer", M, y, { width: colW });
  doc.font("Helvetica").fontSize(10).fillColor(INK_SOFT);
  const addrLine = [invoice.address, invoice.city, invoice.state, invoice.zip].filter(Boolean).join(", ");
  if (addrLine) doc.text(addrLine, M, y + 14, { width: colW });
  if (invoice.customer_phone) doc.text(invoice.customer_phone, M, y + 28, { width: colW });
  if (invoice.customer_email) doc.text(invoice.customer_email, M, y + 42, { width: colW });

  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK)
    .text(invoice.job_title || "—", M + colW + 20, y, { width: colW });
  if (invoice.notes) {
    doc.font("Helvetica").fontSize(9).fillColor(INK_SOFT)
      .text(invoice.notes.slice(0, 400), M + colW + 20, y + 16, { width: colW });
  }

  y += 70;
  doc.moveTo(M, y).lineTo(pageW - M, y).strokeColor(HAIR).lineWidth(1).stroke();
  y += 14;

  // ── LINE ITEMS TABLE ──
  const cols = { date: M, desc: M + 70, qty: M + 300, rate: M + 370, amt: M + 450 };
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK_SOFT);
  doc.text("DATE", cols.date, y);
  doc.text("DESCRIPTION", cols.desc, y);
  doc.text("QTY", cols.qty, y, { width: 60, align: "right" });
  doc.text("RATE", cols.rate, y, { width: 70, align: "right" });
  doc.text("AMOUNT", cols.amt, y, { width: contentW - (cols.amt - M), align: "right" });
  y += 12;
  doc.moveTo(M, y).lineTo(pageW - M, y).strokeColor(HAIR).lineWidth(0.5).stroke();
  y += 8;

  doc.font("Helvetica").fontSize(10).fillColor(INK);
  const items = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  for (const it of items) {
    // Wrap description at fixed width; measure needed row height
    const descW = cols.qty - cols.desc - 10;
    const descH = doc.heightOfString(it.description || "", { width: descW });
    const rowH = Math.max(14, descH + 4);
    if (y + rowH > pageH - 220) { doc.addPage(); y = M; }
    doc.fillColor(INK_SOFT).fontSize(9).text(it.date || "", cols.date, y, { width: 60 });
    doc.fillColor(INK).fontSize(10).text(it.description || "", cols.desc, y, { width: descW });
    doc.text(it.qty + " " + (it.unit || ""), cols.qty, y, { width: 60, align: "right" });
    doc.text("$" + fmtMoney(it.unit_price), cols.rate, y, { width: 70, align: "right" });
    doc.font("Helvetica-Bold").text("$" + fmtMoney(it.subtotal), cols.amt, y, { width: contentW - (cols.amt - M), align: "right" });
    doc.font("Helvetica");
    y += rowH;
    doc.moveTo(M, y).lineTo(pageW - M, y).strokeColor("#F3EEE4").lineWidth(0.5).stroke();
    y += 4;
  }

  // ── TOTALS BLOCK ──
  y += 12;
  if (y > pageH - 200) { doc.addPage(); y = M; }
  const totBoxX = pageW - M - 240;
  const totBoxW = 240;
  doc.roundedRect(totBoxX, y, totBoxW, 78, 6).fill(CREAM_2);
  doc.fillColor(INK_SOFT).font("Helvetica").fontSize(10);
  doc.text("Subtotal", totBoxX + 14, y + 12);
  doc.fillColor(INK).text("$" + fmtMoney(invoice.subtotal), totBoxX + 14, y + 12, { width: totBoxW - 28, align: "right" });
  if (invoice.tax_pct) {
    doc.fillColor(INK_SOFT).text("Tax (" + invoice.tax_pct + "%)", totBoxX + 14, y + 28);
    doc.fillColor(INK).text("$" + fmtMoney(invoice.tax), totBoxX + 14, y + 28, { width: totBoxW - 28, align: "right" });
  }
  doc.moveTo(totBoxX + 14, y + 48).lineTo(totBoxX + totBoxW - 14, y + 48).strokeColor(HAIR).lineWidth(0.5).stroke();
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK);
  doc.text("Total due", totBoxX + 14, y + 54);
  doc.fillColor(ORANGE_INK).text("$" + fmtMoney(invoice.total), totBoxX + 14, y + 54, { width: totBoxW - 28, align: "right" });
  y += 92;

  // ── HOW TO PAY (blue block) ──
  const payLines = [];
  if (user.paypal_me) payLines.push("PayPal:  " + user.paypal_me);
  if (user.venmo) payLines.push("Venmo:   " + user.venmo);
  if (user.cashapp) payLines.push("Cash App: " + user.cashapp);
  if (payLines.length === 0) payLines.push("Contact for payment options.");
  const payBoxH = 32 + payLines.length * 14;
  if (y + payBoxH > pageH - 100) { doc.addPage(); y = M; }
  doc.roundedRect(M, y, contentW, payBoxH, 6).fill(BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(11).text("How to pay", M + 14, y + 12);
  doc.font("Helvetica").fontSize(10);
  let py = y + 30;
  for (const line of payLines) { doc.text(line, M + 14, py); py += 14; }
  y += payBoxH + 14;

  // ── SIGNATURE (if signed) ──
  if (invoice.signature_data_url && invoice.signer_name) {
    if (y + 100 > pageH - 60) { doc.addPage(); y = M; }
    doc.fillColor(INK_SOFT).font("Helvetica-Bold").fontSize(9).text("SIGNED & ACCEPTED", M, y);
    y += 12;
    try {
      const m = /^data:([^;]+);base64,(.+)$/.exec(invoice.signature_data_url);
      if (m) {
        const buf = Buffer.from(m[2], "base64");
        doc.image(buf, M, y, { fit: [200, 60] });
      }
    } catch (_e) {}
    y += 64;
    doc.font("Helvetica").fontSize(9).fillColor(INK_SOFT)
      .text(invoice.signer_name + "   ·   signed " + (invoice.signed_at ? invoice.signed_at.replace("T", " ").split(".")[0] : ""), M, y);
    y += 12;
  }

  // ── FOOTER ──
  doc.font("Helvetica").fontSize(8).fillColor(INK_SOFT)
    .text("Thanks for the work — " + (user.business_name || "your handyman"), M, pageH - 40, { width: contentW, align: "center" });

  // ── PHOTOS PAGE (if attached) ──
  if (Array.isArray(photos) && photos.length > 0) {
    const validPhotos = photos.filter(p => p && p.data_url && /^data:image\//.test(p.data_url));
    if (validPhotos.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text("Job photos", M, M);
      doc.font("Helvetica").fontSize(9).fillColor(INK_SOFT).text(validPhotos.length + " photo" + (validPhotos.length === 1 ? "" : "s") + " from the job.", M, M + 22);
      let px = M, py2 = M + 50;
      const photoW = (contentW - 12) / 2;
      const photoH = 190;
      let col = 0;
      for (const p of validPhotos.slice(0, 12)) {
        if (py2 + photoH + 20 > pageH - M) { doc.addPage(); py2 = M; col = 0; px = M; }
        try {
          const m = /^data:([^;]+);base64,(.+)$/.exec(p.data_url);
          if (m) {
            const buf = Buffer.from(m[2], "base64");
            doc.rect(px, py2, photoW, photoH).fill(CREAM_2);
            doc.image(buf, px, py2, { fit: [photoW, photoH], align: "center", valign: "center" });
            if (p.caption) {
              doc.font("Helvetica").fontSize(8).fillColor(INK_SOFT)
                .text(String(p.caption).slice(0, 80), px, py2 + photoH + 2, { width: photoW });
            }
          }
        } catch (_e) {}
        col++;
        if (col % 2 === 0) { px = M; py2 += photoH + 20; }
        else { px = M + photoW + 12; }
      }
    }
  }

  doc.end();
}

function fmtMoney(n) {
  return (+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return "";
  try { return String(s).slice(0, 10); } catch (_e) { return ""; }
}
function labelKey(doc, text, x, y) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#6A6560").text(text, x, y, { characterSpacing: 1 });
}

module.exports = { renderInvoicePdf };
