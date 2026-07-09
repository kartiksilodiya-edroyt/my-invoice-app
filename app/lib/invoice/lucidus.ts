// ═══════════════════════════════════════════════════════════════
// lib/invoice/lucidus.ts
// Standalone Lucidus template — structurally different from the
// default/agastron/modern family (green banner header, separate
// Sold By / Bill To / Ship To cards, slimmer product table with tax
// rolled into a summary block instead of shown per-line). Reuses the
// same data-extraction helpers (getGSTInfo, pickAddressBlock, etc.)
// and the wPTheme/wTCTheme/wTRTheme/wTableTheme OOXML helpers already
// exported from builders.ts — nothing in builders.ts or gst.ts is
// modified.
//
// SPACING PASS (this version): the PDF (and the HTML preview, which
// shares the same visual language) felt cramped — banner too short,
// cards touching each other, table rows tight, totals block squeezed
// right under the table. All of that is loosened up below: taller
// banner, bigger gaps between cards/sections, more cell padding in
// the product table, roomier totals block and signature area. Layout
// math only — no data/logic changes, so getGSTInfo()/getProductLines()
// contract described below is unchanged.
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
import { wPTheme, wTRTheme, wTableTheme } from './builder';

const ACCENT_HEX = '#0F6E56';
const ACCENT_RGB: [number, number, number] = [15, 110, 86];
const TINT_HEX = '#EAF3DE';
const TINT_RGB: [number, number, number] = [234, 243, 222];
const DARK_TEXT_HEX = '#173404';

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
    return `<tr style="background:${i % 2 === 0 ? TINT_HEX : '#ffffff'};">
      <td style="padding:13px 10px;font-size:11.5px;color:#222;">${esc(item.description || 'Item')}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;">${hsn}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;text-align:right;">${item.qty}</td>
      <td style="padding:13px 6px;font-size:11.5px;color:#555;text-align:right;">${fmtINR(item.unitPrice)}</td>
      <td style="padding:13px 10px;font-size:12px;font-weight:700;color:#222;text-align:right;">${fmtINR(item.base)}</td>
    </tr>`;
  }).join('');

  const logoBlockHTML = logoSrc
    ? `<img src="${logoSrc}" style="max-height:44px;max-width:170px;object-fit:contain;" alt="logo">`
    : `<div style="color:#ffffff;font-size:21px;font-weight:900;letter-spacing:1px;">${esc(coName)}</div>`;

  return `<div style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e2e2;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="background:${ACCENT_HEX};padding:28px 32px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>${logoBlockHTML}</div>
    <div style="text-align:right;">
      <div style="color:#ffffff;font-size:14px;font-weight:700;">Tax Invoice</div>
      <div style="color:${TINT_HEX};font-size:11.5px;margin-top:8px;">Invoice ${esc(invNum)}</div>
      <div style="color:${TINT_HEX};font-size:11.5px;margin-top:3px;">Date ${esc(invDate)}</div>
    </div>
  </div>
  <div style="padding:32px 32px 28px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
      <div style="border:1px solid #e2e2e2;border-radius:8px;padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${ACCENT_HEX};margin-bottom:8px;">SOLD BY</div>
        <div style="font-size:12.5px;font-weight:700;color:#222;">${esc(coName)}</div>
        ${coAddr ? `<div style="font-size:11px;color:#555;line-height:1.7;margin-top:5px;">${wrapAddressLines(coAddr)}</div>` : ''}
        <div style="font-size:10px;color:#777;margin-top:10px;">${[coGst ? `GST ${esc(coGst)}` : '', coPan ? `PAN ${esc(coPan)}` : ''].filter(Boolean).join(' &middot; ')}</div>
        ${coCin ? `<div style="font-size:10px;color:#777;margin-top:2px;">CIN ${esc(coCin)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="border:1px solid #e2e2e2;border-radius:8px;padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${ACCENT_HEX};margin-bottom:6px;">BILL TO</div>
          <div style="font-size:12px;font-weight:700;color:#222;">${esc(merchantName)}</div>
          ${fullBillAddr ? `<div style="font-size:11px;color:#666;line-height:1.6;margin-top:3px;">${wrapAddressLines(fullBillAddr)}</div>` : ''}
        </div>
        <div style="border:1px solid #e2e2e2;border-radius:8px;padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${ACCENT_HEX};margin-bottom:6px;">SHIP TO</div>
          <div style="font-size:12px;font-weight:700;color:#222;">${esc(shipName)}</div>
          <div style="font-size:11px;color:#666;line-height:1.6;margin-top:3px;">${fullShipAddr ? wrapAddressLines(fullShipAddr) : 'Same as billing address'}</div>
        </div>
      </div>
    </div>


    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:22px;">
      <colgroup><col/><col style="width:70px;"/><col style="width:48px;"/><col style="width:82px;"/><col style="width:96px;"/></colgroup>
      <thead><tr style="background:${ACCENT_HEX};">
        <th style="text-align:left;color:#ffffff;font-size:11px;font-weight:700;padding:12px 10px;">Item</th>
        <th style="text-align:left;color:#ffffff;font-size:11px;font-weight:700;padding:12px 6px;">HSN</th>
        <th style="text-align:right;color:#ffffff;font-size:11px;font-weight:700;padding:12px 6px;">Qty</th>
        <th style="text-align:right;color:#ffffff;font-size:11px;font-weight:700;padding:12px 6px;">Rate</th>
        <th style="text-align:right;color:#ffffff;font-size:11px;font-weight:700;padding:12px 10px;">Amount</th>
      </tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;">
      <div style="width:290px;">
        ${totalsRows}
        <div style="background:${TINT_HEX};border-radius:6px;padding:12px 14px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;font-weight:700;color:${DARK_TEXT_HEX};">Total</span>
          <span style="font-size:16px;font-weight:700;color:${DARK_TEXT_HEX};">${fmtINR(gst.total)}</span>
        </div>
        <div style="font-size:10.5px;color:#888;margin-top:10px;font-style:italic;">${esc(words)}</div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:48px;">
      <div style="font-size:10px;color:#888;">This is a computer-generated invoice.</div>
      <div style="text-align:right;">
        <div style="border-bottom:1px solid ${ACCENT_HEX};width:160px;height:38px;"></div>
        ${coName ? `<div style="font-size:11px;font-weight:700;color:#222;margin-top:6px;">For ${esc(coName)}</div>` : ''}
        <div style="font-size:10px;color:#888;margin-top:2px;">${esc(co.signatory || 'Authorised Signatory')}</div>
        <div style="font-size:10px;color:#888;">${esc(co.designation || 'Director')}</div>
      </div>
    </div>
  </div>
  <div style="background:${TINT_HEX};padding:14px 32px;border-top:1px solid #e2e2e2;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span style="font-size:10px;color:#3B6D11;">${coGst ? `GST ${esc(coGst)}` : ''}</span>
    <span style="font-size:10px;color:#3B6D11;">${coPan ? `PAN ${esc(coPan)}` : ''}</span>
    <span style="font-size:10px;color:#3B6D11;">${coCin ? `CIN ${esc(coCin)}` : ''}</span>
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

  // ── Header banner ── (taller: 30 → 36)
  const BANNER_H = 36;
  doc.setFillColor(ACCENT_RGB[0], ACCENT_RGB[1], ACCENT_RGB[2]);
  doc.rect(0, 0, 210, BANNER_H, 'F');
  if (logoSrc && logoSrc.startsWith('data:')) {
    try {
      const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
      const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(logoSrc, imgType, L, 10, 42, 16, undefined, 'FAST');
    } catch (e) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
      doc.text(coName, L, 21);
    }
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
    doc.text(coName, L, 21);
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text('Tax Invoice', R, 14, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Invoice ${invNum}`, R, 21, { align: 'right' });
  doc.text(`Date ${invDate}`, R, 27, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  y = BANNER_H + 14; // was 40 (30+10) → now ~50, more breathing room below the banner

// ── Sold by / Bill to / Ship to cards ── (wider, more spacious, no tax strip)
  const cardW = 87, gapX = 8, billX = L + cardW + gapX; // 87+8+87 = 182 = full content width
  const cardGapY = 6, pad = 6;
  const LINE_H = 4.6; // a bit more line spacing than before

  // measure wrapped lines FIRST, before drawing any boxes
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const sLines = coAddr ? doc.splitTextToSize(coAddr, cardW - pad * 2) : [];
  const bLines = fullBillAddr ? doc.splitTextToSize(fullBillAddr, cardW - pad * 2) : [];
  const shLines = fullShipAddr ? doc.splitTextToSize(fullShipAddr, cardW - pad * 2) : ['Same as billing address'];

  // header + name + address lines + generous bottom padding, with roomier minimums
  const billH = Math.max(26, 18 + bLines.length * LINE_H + 6);
  const shipH = Math.max(28, 18 + shLines.length * LINE_H + 6);
  const soldContentH = 18 + sLines.length * LINE_H + 16; // extra room for the GST/PAN line at the bottom
  const soldH = Math.max(soldContentH, billH + cardGapY + shipH); // keep left card aligned with right stack

  doc.setDrawColor(226, 226, 226); doc.setLineWidth(0.2);
  doc.rect(L, y, cardW, soldH);
  doc.rect(billX, y, cardW, billH);
  doc.rect(billX, y + billH + cardGapY, cardW, shipH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.setTextColor(ACCENT_RGB[0], ACCENT_RGB[1], ACCENT_RGB[2]);
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

  y += soldH + 14; // clear gap straight into the product table, no tax strip in between



  // ── Product table ── (more cell padding, slightly bigger type)
  const colAligns = ['left', 'left', 'right', 'right', 'right'];
  autoTable(doc, {
    startY: y,
    head: [['Item', 'HSN', 'Qty', 'Rate', 'Amount']],
    body: gst.lines.map((l: any, idx: number) => [
      l.description || 'Item', products[idx]?.hsn || '', String(l.qty), formatNumOnly(l.unitPrice), formatNumOnly(l.base),
    ]),
    margin: { left: L, right: 14 },
    styles: { fontSize: 8.5, overflow: 'linebreak', cellPadding: 5, textColor: 30, valign: 'middle' },
    headStyles: { fillColor: ACCENT_RGB, textColor: 255, fontStyle: 'bold', cellPadding: 5 },
    alternateRowStyles: { fillColor: TINT_RGB },
    columnStyles: { 0: { cellWidth: 76 }, 1: { cellWidth: 24 }, 2: { cellWidth: 20 }, 3: { cellWidth: 28 }, 4: { cellWidth: 34 } },
    didParseCell: function (data: any) { data.cell.styles.halign = colAligns[data.column.index]; },
  });
  y = (doc as any).lastAutoTable.finalY + 12; // was +8

  // ── Totals block ── (taller rows, bigger total box)
  const boxX = R - 74, boxW = 74;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (gst.isSame) {
    doc.text('Base amount', boxX, y); doc.text(fmtINRPdf(gst.base), R, y, { align: 'right' }); y += 6;
    doc.text(`CGST @ ${gst.rate / 2}%`, boxX, y); doc.text(fmtINRPdf(gst.cgst), R, y, { align: 'right' }); y += 6;
    doc.text(`SGST @ ${gst.rate / 2}%`, boxX, y); doc.text(fmtINRPdf(gst.sgst), R, y, { align: 'right' }); y += 6;
  } else {
    doc.text('Base amount', boxX, y); doc.text(fmtINRPdf(gst.base), R, y, { align: 'right' }); y += 6;
    doc.text(`IGST @ ${gst.rate}%`, boxX, y); doc.text(fmtINRPdf(gst.igst), R, y, { align: 'right' }); y += 6;
  }
  y += 2;
  doc.setFillColor(TINT_RGB[0], TINT_RGB[1], TINT_RGB[2]);
  doc.rect(boxX, y, boxW, 11, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.setTextColor(ACCENT_RGB[0], ACCENT_RGB[1], ACCENT_RGB[2]);
  doc.text('Total', boxX + 4, y + 7.3); doc.text(fmtINRPdf(gst.total), R - 3, y + 7.3, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 17; // was 13

  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
  const wl = doc.splitTextToSize(words, W - 4);
  doc.text(wl, boxX, y); y += wl.length * 4.5 + 8;

  // ── Signature ── (a little more room above the footer strip)
  const ph = doc.internal.pageSize.height;
  doc.setDrawColor(ACCENT_RGB[0], ACCENT_RGB[1], ACCENT_RGB[2]); doc.setLineWidth(0.3);
  doc.line(R - 44, ph - 34, R, ph - 34);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(`For ${coName}`, R, ph - 28, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(co.signatory || 'Authorised Signatory', R, ph - 23.5, { align: 'right' });
  doc.text(co.designation || 'Director', R, ph - 19, { align: 'right' });

  // ── Footer strip ── (taller)
  doc.setFillColor(TINT_RGB[0], TINT_RGB[1], TINT_RGB[2]);
  doc.rect(0, ph - 12, 210, 12, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.setTextColor(59, 109, 17);
  const footBits = [coGst ? `GST ${coGst}` : '', coPan ? `PAN ${coPan}` : '', coCin ? `CIN ${coCin}` : ''].filter(Boolean).join('     ');
  doc.text(footBits, 105, ph - 6, { align: 'center' });
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
  const ACCENT = '0F6E56';
  const TINT = 'EAF3DE';

  const PAGE_W = 9360;
  const halfW = [PAGE_W / 2, PAGE_W / 2];
  const itemWidths = [4200, 1560, 1200, 1200, 1200];

  let body = '';
  body += wTableTheme(
    wTRTheme([coName, 'TAX INVOICE'], halfW, { bold: true, size: 14, color: 'FFFFFF', shade: ACCENT }),
    PAGE_W
  );
  body += wPTheme(`Invoice ${invNum}   |   Date ${invDate}`, { size: 9, align: 'right' });
  body += wPTheme('');

  body += wTableTheme(
    wTRTheme(['SOLD BY', 'BILL TO / SHIP TO'], halfW, { bold: true, size: 8, color: ACCENT }) +
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

  body += wTableTheme(
    wTRTheme(['Item', 'HSN', 'Qty', 'Rate', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center', color: 'FFFFFF', shade: ACCENT }) +
    gst.lines.map((l: any, idx: number) => wTRTheme(
      [l.description || 'Item', products[idx]?.hsn || '', String(l.qty), fmtINR(l.unitPrice), fmtINR(l.base)],
      itemWidths, { size: 8, align: 'center' }
    )).join(''),
    PAGE_W
  );
  body += wPTheme('');

  body += wPTheme(`Base amount: ${fmtINR(gst.base)}`, { size: 9, align: 'right' });
  if (gst.isSame) {
    body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 9, align: 'right' });
    body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 9, align: 'right' });
  } else {
    body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 9, align: 'right' });
  }
  body += wTableTheme(wTRTheme(['Total', fmtINR(gst.total)], halfW, { bold: true, size: 12, align: 'right', color: ACCENT, shade: TINT }), PAGE_W);
  body += wPTheme('');
  body += wPTheme(words, { size: 9, align: 'right' });
  body += wPTheme('');

  body += wPTheme(`For ${coName}`, { bold: true, size: 10, align: 'right' });
  body += wPTheme(co.signatory || 'Authorised Signatory', { size: 9, align: 'right' });
  body += wPTheme(co.designation || 'Director', { size: 9, align: 'right' });
  body += wPTheme('');
  body += wPTheme([coGst ? `GST ${coGst}` : '', coPan ? `PAN ${coPan}` : '', coCin ? `CIN ${coCin}` : ''].filter(Boolean).join('   |   '), { size: 8, color: '3B6D11' });

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
} 