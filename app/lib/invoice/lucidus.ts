// ═══════════════════════════════════════════════════════════════
// lib/invoice/lucidus.ts
// Standalone Lucidus template — structurally different from the
// default/agastron/modern family (separate Sold By / Bill To /
// Ship To cards, slimmer product table with tax rolled into a
// summary block instead of shown per-line). Reuses the same
// data-extraction helpers (getGSTInfo, pickAddressBlock, etc.) and
// the wPTheme/wTCTheme/wTRTheme/wTableTheme OOXML helpers already
// exported from builders.ts — nothing in builders.ts or gst.ts is
// modified.
//
// COLOR PASS v2 (this version): removed ALL solid fill blocks —
// no green banner, no black banner either. Pure letterhead look:
// white background, black ink text, thin black/gray rule lines for
// structure (header underline, table head over/under-rules, row
// dividers, total rule, footer rule). Table header went from a
// solid filled bar to a plain ruled row. Totals box went from a
// shaded box to a top-ruled line. Footer went from a shaded strip
// to a plain top-ruled line. No layout-width/data/logic changes —
// getGSTInfo()/getProductLines() contract is unchanged.
//
// NOTE: getGSTInfo()/getProductLines() only ever read `qty` and
// `amount` off each row._products[i] — hsn/rate/discount never reach
// the engine (discount is already netted into `amount` by the editor
// before save). HSN below is read positionally from row._products,
// which is safe because getProductLines() returns row._products
// verbatim (same order) whenever it's present.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
  esc, cleanNum, fmtINR, numWords, parseDate, wrapAddressLines,
  pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme, buildItemsTableHTML, buildTotalsHTML, drawItemsTablePDF, drawTotalsPDF, buildItemsTableDOCX } from './builder';

// Pure black / white / gray — no fills, only ink text and thin rule lines.
const INK_HEX = '#1A1A1A';                              // primary text, headings, rule lines
const INK_RGB: [number, number, number] = [26, 26, 26];
const MUTED_HEX = '#666666';                            // secondary text (dates, footer meta)
const MUTED_RGB: [number, number, number] = [102, 102, 102];
const BORDER_HEX = '#E0E0E0';                           // card borders
const ROW_BORDER_HEX = '#EEEEEE';                       // table row dividers (HTML)
const ROW_BORDER_RGB: [number, number, number] = [230, 230, 230]; // table row dividers (PDF)

/* ═══════════════════════════════════════════════
   LUCIDUS TEMPLATE — HTML
═══════════════════════════════════════════════ */
export function buildInvoiceHTMLLucidus(row: any, profile: any, invNum: string, company: any) {
  const co = company || {};
  const p = profile || {};
  if (row['_invNum']) invNum = row['_invNum'];

  const merchantName = row['_billName'] || p.name || '';
  const merchantGST = row['_billGST'] || p.gst || '';
  const merchantPAN = row['_billPAN'] || p.pan || '';
  const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [bill.address, bill.city, bill.state, bill.pin].filter(Boolean).join(', ');

  const shipName = row['_shipName'] || merchantName;
  const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
  const fullShipAddr = [ship.address, ship.city, ship.state, ship.pin].filter(Boolean).join(', ');

  const gst = getGSTInfo(row, profile, company);
  const words = numWords(gst.total);
  const txDate = parseDate(row['Transaction Date']);
  const invDate = txDate;

  const isProfile = !!p.name;
  const coName = isProfile ? p.name : (co.name || '');
  const coAddr = isProfile ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = isProfile ? (p.pan || '') : (co.pan || '');
  const coGst = isProfile ? (p.gst || '') : (co.gst || '');
  const coCin = isProfile ? (p.cin || '') : (co.cin || '');
  const logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);

  const products = Array.isArray(row._products) ? row._products : [];

  const totalsRows = gst.isSame
    ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#555;padding:6px 0;"><span>Base amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:12px;color:#555;padding:6px 0;"><span>CGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.cgst)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:12px;color:#555;padding:6px 0;"><span>SGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.sgst)}</span></div>`
    : `<div style="display:flex;justify-content:space-between;font-size:12px;color:#555;padding:6px 0;"><span>Base amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:12px;color:#555;padding:6px 0;"><span>IGST @ ${gst.rate}%</span><span>${fmtINR(gst.igst)}</span></div>`;

  const rowsHTML = gst.lines.map((item: any, i: number) => {
    const hsn = esc(products[i]?.hsn || '');
    return `<tr style="border-bottom:1px solid ${ROW_BORDER_HEX};">
      <td style="padding:13px 10px;font-size:11.5px;color:#222;">${esc(item.description || 'Item')}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;">${hsn}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;text-align:right;">${item.qty}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;text-align:right;">${fmtINR(item.unitPrice)}</td>
      <td style="padding:13px 10px;font-size:12px;font-weight:700;color:#222;text-align:right;">${fmtINR(item.base)}</td>
    </tr>`;
  }).join('');

  const logoBlockHTML = logoSrc
    ? `<img src="${logoSrc}" style="max-height:44px;max-width:170px;object-fit:contain;" alt="logo">`
    : `<div style="color:${INK_HEX};font-size:21px;font-weight:900;letter-spacing:1px;">${esc(coName)}</div>`;

  return `<div style="background:#ffffff;border:1px solid ${BORDER_HEX};font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="padding:28px 32px 20px;border-bottom:2px solid ${INK_HEX};display:flex;justify-content:space-between;align-items:flex-start;">
    <div>${logoBlockHTML}</div>
    <div style="text-align:right;">
      <div style="color:${INK_HEX};font-size:14px;font-weight:700;letter-spacing:0.5px;">TAX INVOICE</div>
      <div style="color:${MUTED_HEX};font-size:11.5px;margin-top:8px;">Invoice ${esc(invNum)}</div>
      <div style="color:${MUTED_HEX};font-size:11.5px;margin-top:3px;">Date ${esc(invDate)}</div>
    </div>
  </div>
  <div style="padding:28px 32px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
      <div style="border:1px solid ${BORDER_HEX};padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${INK_HEX};margin-bottom:8px;">SOLD BY</div>
        <div style="font-size:12.5px;font-weight:700;color:#222;">${esc(coName)}</div>
        ${coAddr ? `<div style="font-size:11px;color:#555;line-height:1.7;margin-top:5px;">${wrapAddressLines(coAddr)}</div>` : ''}
        <div style="font-size:10px;color:#777;margin-top:10px;">${[coGst ? `GST ${esc(coGst)}` : '', coPan ? `PAN ${esc(coPan)}` : ''].filter(Boolean).join(' &middot; ')}</div>
        ${coCin ? `<div style="font-size:10px;color:#777;margin-top:2px;">CIN ${esc(coCin)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="border:1px solid ${BORDER_HEX};padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${INK_HEX};margin-bottom:6px;">BILL TO</div>
          <div style="font-size:12px;font-weight:700;color:#222;">${esc(merchantName)}</div>
          ${fullBillAddr ? `<div style="font-size:11px;color:#666;line-height:1.6;margin-top:3px;">${wrapAddressLines(fullBillAddr)}</div>` : ''}
        </div>
        <div style="border:1px solid ${BORDER_HEX};padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${INK_HEX};margin-bottom:6px;">SHIP TO</div>
          <div style="font-size:12px;font-weight:700;color:#222;">${esc(shipName)}</div>
          <div style="font-size:11px;color:#666;line-height:1.6;margin-top:3px;">${fullShipAddr ? wrapAddressLines(fullShipAddr) : 'Same as billing address'}</div>
        </div>
      </div>
    </div>


    ${buildItemsTableHTML(gst)}

    ${buildTotalsHTML(gst)}
    <div style="font-size:10.5px;color:#888;margin-top:10px;font-style:italic;text-align:right;">${esc(words)}</div>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:48px;">
      <div style="font-size:10px;color:#888;">This is a computer-generated invoice.</div>
      <div style="text-align:right;">
        <div style="border-bottom:1px solid ${INK_HEX};width:160px;height:38px;"></div>
        ${coName ? `<div style="font-size:11px;font-weight:700;color:#222;margin-top:6px;">For ${esc(coName)}</div>` : ''}
        <div style="font-size:10px;color:#888;margin-top:2px;">${esc(co.signatory || 'Authorised Signatory')}</div>
        <div style="font-size:10px;color:#888;">${esc(co.designation || 'Director')}</div>
      </div>
    </div>
  </div>
  <div style="padding:14px 32px;border-top:1px solid ${BORDER_HEX};display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span style="font-size:10px;color:${MUTED_HEX};">${coGst ? `GST ${esc(coGst)}` : ''}</span>
    <span style="font-size:10px;color:${MUTED_HEX};">${coPan ? `PAN ${esc(coPan)}` : ''}</span>
    <span style="font-size:10px;color:${MUTED_HEX};">${coCin ? `CIN ${esc(coCin)}` : ''}</span>
  </div>
</div>`;
}

/* ═══════════════════════════════════════════════
   LUCIDUS TEMPLATE — PDF
═══════════════════════════════════════════════ */
export async function buildPDFLucidus(row: any, profile: any, invNum: string, company: any) {
  const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 14, R = 196, W = 182;
  let y = 0;

  const co = company || {};
  const p = profile || {};
  const gst = getGSTInfo(row, profile, company);
  const products = Array.isArray(row._products) ? row._products : [];

  const merchantName = row['_billName'] || p.name || '';
  const merchantGST = row['_billGST'] || p.gst || '';
  const merchantPAN = row['_billPAN'] || p.pan || '';
  const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [bill.address, bill.city, bill.state, bill.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
  const fullShipAddr = [ship.address, ship.city, ship.state, ship.pin].filter(Boolean).join(', ');
  const isProfile = !!p.name;
  const coName = isProfile ? p.name : (co.name || '');
  const coAddr = isProfile ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = isProfile ? (p.pan || '') : (co.pan || '');
  const coGst = isProfile ? (p.gst || '') : (co.gst || '');
  const coCin = isProfile ? (p.cin || '') : (co.cin || '');
  const words = numWords(gst.total);
  const txDate = parseDate(row['Transaction Date']);
  const invDate = txDate;

  const fmtINRPdf = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatNumOnly = (n: any) => cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);
  if (logoSrc && !logoSrc.startsWith('data:')) {
    const dataUrl = await urlToDataURL(logoSrc);
    if (dataUrl) logoSrc = dataUrl;
  }

  // ── Header (no fill — logo/name left, label right, ruled underline) ──
  doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2]);
  if (logoSrc && logoSrc.startsWith('data:')) {
    try {
      const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
      const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(logoSrc, imgType, L, 8, 42, 16, undefined, 'FAST');
    } catch (e) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      doc.text(coName, L, 19);
    }
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(coName, L, 19);
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('TAX INVOICE', R, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2]);
  doc.text(`Invoice ${invNum}`, R, 19, { align: 'right' });
  doc.text(`Date ${invDate}`, R, 25, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  const HEADER_RULE_Y = 32;
  doc.setDrawColor(INK_RGB[0], INK_RGB[1], INK_RGB[2]); doc.setLineWidth(0.7);
  doc.line(L, HEADER_RULE_Y, R, HEADER_RULE_Y);

  y = HEADER_RULE_Y + 16;

// ── Sold by / Bill to / Ship to cards ──
  const cardW = 87, gapX = 8, billX = L + cardW + gapX;
  const cardGapY = 6, pad = 6;
  const LINE_H = 4.6;

  // measure wrapped lines FIRST, before drawing any boxes
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const sLines = coAddr ? doc.splitTextToSize(coAddr, cardW - pad * 2) : [];
  const bLines = fullBillAddr ? doc.splitTextToSize(fullBillAddr, cardW - pad * 2) : [];
  const shLines = fullShipAddr ? doc.splitTextToSize(fullShipAddr, cardW - pad * 2) : ['Same as billing address'];

  const billH = Math.max(26, 18 + bLines.length * LINE_H + 6);
  const shipH = Math.max(28, 18 + shLines.length * LINE_H + 6);
  const soldContentH = 18 + sLines.length * LINE_H + 16;
  const soldH = Math.max(soldContentH, billH + cardGapY + shipH);

  doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.2);
  doc.rect(L, y, cardW, soldH);
  doc.rect(billX, y, cardW, billH);
  doc.rect(billX, y + billH + cardGapY, cardW, shipH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2]);
  doc.text('SOLD BY', L + pad, y + 10);
  doc.text('BILL TO', billX + pad, y + 10);
  doc.text('SHIP TO', billX + pad, y + billH + cardGapY + 10);
  doc.setTextColor(0, 0, 0);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(coName || '-', L + pad, y + 18);
  doc.text(merchantName || '-', billX + pad, y + 18);
  doc.text(shipName || '-', billX + pad, y + billH + cardGapY + 18);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  if (sLines.length) doc.text(sLines, L + pad, y + 25, { lineHeightFactor: 1.5 });
  if (bLines.length) doc.text(bLines, billX + pad, y + 25, { lineHeightFactor: 1.5 });
  doc.text(shLines, billX + pad, y + billH + cardGapY + 25, { lineHeightFactor: 1.5 });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  const metaBits = [coGst ? `GST ${coGst}` : '', coPan ? `PAN ${coPan}` : ''].filter(Boolean).join('   |   ');
  if (metaBits) doc.text(metaBits, L + pad, y + soldH - 7);

  y += soldH + 14;



  // ── Product table (ruled, no fill) ──
  y = drawItemsTablePDF(doc, gst, y, L, R) + 12;

  y = drawTotalsPDF(doc, gst, y, R) + 5;

  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
  const wl = doc.splitTextToSize(words, R - (R - 50) + 40);
  doc.text(wl, R - 50, y); y += wl.length * 4.5 + 8;

  // ── Signature ──
  const ph = doc.internal.pageSize.height;
  doc.setDrawColor(INK_RGB[0], INK_RGB[1], INK_RGB[2]); doc.setLineWidth(0.3);
  doc.line(R - 44, ph - 34, R, ph - 34);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(`For ${coName}`, R, ph - 28, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(co.signatory || 'Authorised Signatory', R, ph - 23.5, { align: 'right' });
  doc.text(co.designation || 'Director', R, ph - 19, { align: 'right' });

  // ── Footer (ruled, no fill) ──
  doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.3);
  doc.line(14, ph - 14, R, ph - 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2]);
  const footBits = [coGst ? `GST ${coGst}` : '', coPan ? `PAN ${coPan}` : '', coCin ? `CIN ${coCin}` : ''].filter(Boolean).join('     ');
  doc.text(footBits, 105, ph - 8, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  return doc.output('blob');
}

/* ═══════════════════════════════════════════════
   LUCIDUS TEMPLATE — DOCX
   (reuses wPTheme/wTRTheme/wTableTheme already exported from builders.ts)
═══════════════════════════════════════════════ */
export async function buildDOCXLucidus(row: any, profile: any, invNum: string, company: any) {
  const co = company || {}; const p = profile || {};
  const gst = getGSTInfo(row, profile, company);
  const products = Array.isArray(row._products) ? row._products : [];
  const merchantName = row['_billName'] || p.name || '';
  const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [bill.address, bill.city, bill.state, bill.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
  const fullShipAddr = [ship.address, ship.city, ship.state, ship.pin].filter(Boolean).join(', ');
  const isProfile = !!p.name;
  const coName = isProfile ? p.name : (co.name || '');
  const coAddr = isProfile ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = isProfile ? (p.pan || '') : (co.pan || '');
  const coGst = isProfile ? (p.gst || '') : (co.gst || '');
  const coCin = isProfile ? (p.cin || '') : (co.cin || '');
  const words = numWords(gst.total);
  const txDate = parseDate(row['Transaction Date']);
  const invDate = txDate;
  const billGST = row['_billGST'] || p.gst || '';
  const billPAN = row['_billPAN'] || p.pan || '';
  const FOOTER_TEXT = '666666';

  const PAGE_W = 9360;
  const halfW = [PAGE_W / 2, PAGE_W / 2];
  const itemWidths = [4200, 1560, 1200, 1200, 1200];

  let body = '';
  body += wTableTheme(
    wTRTheme([coName, 'TAX INVOICE'], halfW, { bold: true, size: 14 }),
    PAGE_W
  );
  body += wPTheme(`Invoice ${invNum}   |   Date ${invDate}`, { size: 9, align: 'right' });
  body += wPTheme('');

  body += wTableTheme(
    wTRTheme(['SOLD BY', 'BILL TO / SHIP TO'], halfW, { bold: true, size: 8 }) +
    wTRTheme(
      [
        [coName, coAddr, coGst ? `GST: ${coGst}` : '', coPan ? `PAN: ${coPan}` : ''].filter(Boolean).join('\n'),
        [`Bill to: ${merchantName}`, fullBillAddr, billGST ? `GST: ${billGST}` : '', billPAN ? `PAN: ${billPAN}` : '', '', `Ship to: ${shipName}`, fullShipAddr || 'Same as billing address'].filter(Boolean).join('\n'),
      ],
      halfW, { size: 9 }
    ),
    PAGE_W
  );
  body += wPTheme('');

  body += buildItemsTableDOCX(gst);
  body += wPTheme('');

  body += wPTheme(`Base amount: ${fmtINR(gst.base)}`, { size: 9, align: 'right' });
  if (gst.isSame) {
    body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 9, align: 'right' });
    body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 9, align: 'right' });
  } else {
    body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 9, align: 'right' });
  }
  body += wTableTheme(wTRTheme(['Total', fmtINR(gst.total)], halfW, { bold: true, size: 12, align: 'right' }), PAGE_W);
  body += wPTheme('');
  body += wPTheme(words, { size: 9, align: 'right' });
  body += wPTheme('');

  body += wPTheme(`For ${coName}`, { bold: true, size: 10, align: 'right' });
  body += wPTheme(co.signatory || 'Authorised Signatory', { size: 9, align: 'right' });
  body += wPTheme(co.designation || 'Director', { size: 9, align: 'right' });
  body += wPTheme('');
  body += wPTheme([coGst ? `GST ${coGst}` : '', coPan ? `PAN ${coPan}` : '', coCin ? `CIN ${coCin}` : ''].filter(Boolean).join('   |   '), { size: 8, color: FOOTER_TEXT });

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}