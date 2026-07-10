// ═══════════════════════════════════════════════════════════════
// lib/invoice/builders.ts
// Verbatim extraction of INVOICE HTML BUILDER, BUILD PDF, BUILD DOCX,
// and the Phase-1 themed variants from invoice-app.ts. No layout,
// GST, or formatting logic changed — every function just takes
// `company` as an explicit final argument instead of reading
// S.company via closure.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
  esc, cleanNum, fmtINR, numWords, parseDate, wrapAddressLines,
  pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';

/* ═══════════════════════════════════════════════
   SHARED ITEMS TABLE — used by every template
═══════════════════════════════════════════════ */
export function buildItemsTableHTML(gst: any) {
  const theme = AGASTRON_THEME;
  return `<table class="inv-table" style="font-family:${theme.fontFamily};">
    <thead><tr>
      <th style="width:10%;background:${theme.headerBgHex};">SI.No</th><th style="width:44%;background:${theme.headerBgHex};">Description</th><th style="width:15%;background:${theme.headerBgHex};">Unit Price</th><th style="width:10%;background:${theme.headerBgHex};">QTY</th>
      <th style="width:21%;background:${theme.headerBgHex};">Amount</th>
    </tr></thead>
 <tbody>
${gst.lines.map((item: any, index: number) => {
  const unitPrice = item.unitPrice != null ? item.unitPrice : (item.qty ? item.base / item.qty : item.base);
  return `
<tr>
<td>${index + 1}</td>
<td><b>${esc(item.description || 'Item')}</b></td>
<td>${fmtINR(unitPrice)}</td>
<td>${item.qty}</td>
<td>${fmtINR(item.base)}</td>
</tr>
`;
}).join('')}
</tbody><tfoot><tr>
      <td colspan="4" style="font-weight:700;background:${theme.totalBgHex};">TOTAL:</td>
      <td style="font-weight:800;background:${theme.totalBgHex};">${fmtINR(gst.total)}</td>
    </tr></tfoot>
  </table>`;
}

export function drawItemsTablePDF(doc: any, gst: any, startY: number, L = 14, R = 196) {
  const theme = AGASTRON_THEME;
  const formatNumOnly = (n: any) => cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const colAligns = ['center', 'left', 'right', 'center', 'right'];

  // Proportions taken from Agastron's original 18/88/30/18/28 (sum 182),
  // scaled to whatever L→R width the caller actually uses, so the table
  // ALWAYS ends exactly at R — same edge the totals block aligns to.
  const totalW = R - L;
  const baseWidths = [18, 88, 30, 18, 28];
  const baseSum = 182;
  const colWidths = baseWidths.map(w => (w / baseSum) * totalW);
  const pageW = doc.internal.pageSize.getWidth();

  autoTable(doc, {
    startY,
    head: [['Sl. No', 'Description', 'Unit Price', 'QTY', 'Amount']],
    body: gst.lines.map((l: any, idx: number) => {
      const unitPrice = l.unitPrice != null ? l.unitPrice : (l.qty ? l.base / l.qty : l.base);
      return [String(idx + 1), l.description || 'Item', formatNumOnly(unitPrice), String(l.qty), formatNumOnly(l.total != null ? l.total : l.base)];
    }),
    foot: [['', '', '', 'TOTAL:', formatNumOnly(gst.total)]],
    margin: { left: L, right: pageW - R },
    styles: { font: 'helvetica', fontSize: 8, overflow: 'linebreak', cellPadding: 3, textColor: 30, valign: 'middle' },
    headStyles: { fillColor: theme.headerBgRGB, textColor: 30, fontStyle: 'bold' },
    footStyles: { fillColor: theme.totalBgRGB, textColor: 30, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: colWidths[0] }, 1: { cellWidth: colWidths[1] }, 2: { cellWidth: colWidths[2] },
      3: { cellWidth: colWidths[3] }, 4: { cellWidth: colWidths[4] },
    },
    didParseCell: function (data: any) { data.cell.styles.halign = colAligns[data.column.index]; }
  });
  return (doc as any).lastAutoTable.finalY;
}

export function buildItemsTableDOCX(gst: any) {
  const theme = AGASTRON_THEME;
  const PAGE_W = 9360;
  const itemWidths = [900, 4560, 1500, 900, 1500];
  const headerShade = theme.headerBgHex.replace('#', '').toUpperCase();
  const totalShade = theme.totalBgHex.replace('#', '').toUpperCase();

  return wTableTheme(
    wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center', shade: headerShade }) +
    gst.lines.map((l: any, idx: number) => {
      const unitPrice = l.unitPrice != null ? l.unitPrice : (l.qty ? l.base / l.qty : l.base);
      return wTRTheme([String(idx + 1), l.description || 'Item', fmtINR(unitPrice), String(l.qty), fmtINR(l.total != null ? l.total : l.base)], itemWidths, { size: 8, align: 'center' });
    }).join('') +
    wTRTheme(['', '', '', 'TOTAL:', fmtINR(gst.total)], itemWidths, { bold: true, size: 8, align: 'right', shade: totalShade }),
    PAGE_W
  );
}
export function buildTotalsHTML(gst: any) {
  const totalsRows = gst.isSame
    ? `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>CGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.cgst)}</td></tr>
     <tr><td>SGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.sgst)}</td></tr>`
    : `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>IGST @ ${gst.rate}%</td><td>${fmtINR(gst.igst)}</td></tr>`;

  return `<div style="display:flex;justify-content:flex-end;">
    <table class="inv-totals">
      ${totalsRows}
      <tr class="total-final"><td><b>Total</b></td><td><b>${fmtINR(gst.total)}</b></td></tr>
    </table>
  </div>`;
}
export function drawTotalsPDF(doc: any, gst: any, startY: number, R = 196) {
  const T = (text: any, x: any, y: any, opts?: any) => doc.text(String(text), x, y, opts);
  const fmtINRPdf = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalsLabelX = R - 50, totalsValX = R;
  let y = startY;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  T('Base Amount', totalsLabelX, y); T(fmtINRPdf(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
  if (gst.isSame) {
    T(`CGST @ ${gst.rate / 2}%`, totalsLabelX, y); T(fmtINRPdf(gst.cgst), totalsValX, y, { align: 'right' }); y += 4.5;
    T(`SGST @ ${gst.rate / 2}%`, totalsLabelX, y); T(fmtINRPdf(gst.sgst), totalsValX, y, { align: 'right' }); y += 4.5;
  } else {
    T(`IGST @ ${gst.rate}%`, totalsLabelX, y); T(fmtINRPdf(gst.igst), totalsValX, y, { align: 'right' }); y += 4.5;
  }
  doc.setDrawColor(20); doc.setLineWidth(0.4); doc.line(totalsLabelX, y, totalsValX, y); y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  T('Total', totalsLabelX, y); T(fmtINRPdf(gst.total), totalsValX, y, { align: 'right' });
  return y + 7;
}

/* ═══════════════════════════════════════════════
   DEFAULT TEMPLATE — HTML
═══════════════════════════════════════════════ */
export function buildInvoiceHTML(row: any, profile: any, invNum: string, company: any) {
  const co = company || {};
  const p = profile || {};
  if (row['_invNum']) invNum = row['_invNum'];

  const merchantName = row['_billName'] || p.name || '';
  const merchantGST = row['_billGST'] || p.gst || '';
  const merchantPAN = row['_billPAN'] || p.pan || '';
  const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const merchantAddr = bill.address, merchantCity = bill.city, merchantState = bill.state, merchantPin = bill.pin;
  const fullBillAddr = [merchantAddr, merchantCity, merchantState, merchantPin].filter(Boolean).join(', ');

  const shipName = row['_shipName'] || merchantName;
  const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], merchantAddr, merchantCity, merchantState, merchantPin);
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

  const totalsRows = gst.isSame
    ? `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>CGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.cgst)}</td></tr>
     <tr><td>SGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.sgst)}</td></tr>`
    : `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>IGST @ ${gst.rate}%</td><td>${fmtINR(gst.igst)}</td></tr>`;

  return `<div class="inv-paper">
  <div class="inv-top">
    <div class="inv-title-block"><h2>Tax Invoice</h2><p>(Original for Recipient)</p></div>
    <div class="inv-logo">
      ${logoSrc ? `<img src="${logoSrc}" style="max-height:52px;max-width:180px;object-fit:contain;" alt="logo">` : `<span style="font-size:22px;font-weight:900;">${esc(coName)}</span>`}
    </div>
  </div>
  <hr class="inv-rule">
  <div class="inv-meta">
    <div><b>Invoice Number:</b> ${esc(invNum)}</div>
    <div><b>Invoice Date:</b> ${esc(invDate)}</div>
    <div><b>Transaction Date:</b> ${esc(txDate)}</div>
  </div>
  <div class="inv-addr-stack">
    <div class="inv-addr-block">
      <div class="inv-addr-label">Billing Address</div>
      <div class="inv-addr-body">
        <b>${esc(merchantName)}</b><br>
        ${fullBillAddr ? wrapAddressLines(fullBillAddr) + '<br>' : ''}
        ${merchantGST ? `<b>GST: ${esc(merchantGST)}</b><br>` : ''}
        ${merchantPAN ? `<b>PAN: ${esc(merchantPAN)}</b><br>` : ''}
      </div>
    </div>
    <div class="inv-addr-block ship">
      <div class="inv-addr-label">Shipping Address:</div>
      <div class="inv-addr-body"><b>${esc(shipName)}</b><br>${fullShipAddr ? wrapAddressLines(fullShipAddr) : '—'}</div>
    </div>
  </div>
<table class="inv-table">
    <thead><tr>
      <th style="width:10%;">SI.No</th><th style="width:44%;">Description</th><th style="width:15%;">Unit Price</th><th style="width:10%;">QTY</th>
      <th style="width:21%;">Amount</th>
    </tr></thead>
 <tbody>
${gst.lines.map((item: any, index: number) => `
<tr>
<td>${index + 1}</td>
<td><b>${esc(item.description)}</b></td>
<td>${fmtINR(item.unitPrice)}</td>
<td>${item.qty}</td>
<td>${fmtINR(item.base)}</td>
</tr>
`).join('')}
</tbody><tfoot><tr>
      <td colspan="4" style="font-weight:700;background:#f2f2f2;">TOTAL:</td>
      <td style="font-weight:800;background:#f2f2f2;">${fmtINR(gst.total)}</td>
    </tr></tfoot>
  </table>
  <div style="display:flex;justify-content:flex-end;">
    <table class="inv-totals">
      ${totalsRows}
      <tr class="total-final"><td><b>Total</b></td><td><b>${fmtINR(gst.total)}</b></td></tr>
    </table>
  </div>
  <div class="inv-words"><b>Amount in Words:</b> ${esc(words)}</div>
  ${coName ? `<div class="inv-from">From ${esc(coName)}</div>` : ''}
  <hr class="inv-rule-light">
  <div class="inv-footer">
    <div class="inv-sold-by">
      <div style="font-size:9px;color:#777;margin-bottom:3px;">SOLD BY</div>
      <div class="co-name">${esc(coName)}</div>
      ${coAddr ? `<div>${wrapAddressLines(coAddr)}</div>` : ''}
      ${coPan ? `<div><b>PAN No: ${esc(coPan)}</b></div>` : ''}
      ${coGst ? `<div><b>GST Registration No: ${esc(coGst)}</b></div>` : ''}
      ${coCin ? `<div><b>CIN No:</b> ${esc(coCin)}</div>` : ''}
    </div>
    <div class="inv-sign">
      <div class="sig-line"></div>
      ${coName ? `<div class="sig-name">For ${esc(coName)}</div>` : ''}
      <div style="color:#888;">${esc(co.signatory || 'Authorised Signatory')}</div>
      <div>${esc(co.designation || 'Director')}</div>
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════════════════════
   DEFAULT TEMPLATE — PDF
═══════════════════════════════════════════════ */
export async function buildPDF(row: any, profile: any, invNum: string, company: any) {
  const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 14, R = 196, W = 182;
  let y = 16;
  const co = company || {};
  const p = profile || {};
  const gst = getGSTInfo(row, profile, company);

  const merchantName = row['_billName'] || p.name || '';
  const billBlockPdf = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [billBlockPdf.address, billBlockPdf.city, billBlockPdf.state, billBlockPdf.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const shipBlockPdf = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], billBlockPdf.address, billBlockPdf.city, billBlockPdf.state, billBlockPdf.pin);
  const fullShipAddr = [shipBlockPdf.address, shipBlockPdf.city, shipBlockPdf.state, shipBlockPdf.pin].filter(Boolean).join(', ');
  const coName = p.name ? p.name : (co.name || '');
  const coAddr = p.name ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = p.pan ? p.pan : (co.pan || '');
  const coGst = p.gst ? p.gst : (co.gst || '');
  const coCin = p.cin ? p.cin : (co.cin || '');
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

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Tax Invoice', L, y);
  if (logoSrc && logoSrc.startsWith('data:')) {
    try {
      const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
      const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(logoSrc, imgType, R - 45, y - 9, 45, 16, undefined, 'FAST');
    } catch (e) { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(coName, R, y, { align: 'right' }); }
  } else if (coName) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(coName, R, y, { align: 'right' });
  }
  y += 5; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text('(Original for Recipient)', L, y);
  y += 3; doc.setDrawColor(40); doc.setLineWidth(0.5); doc.line(L, y, R, y); y += 5;

  [`Invoice Number: ${invNum}`, `Invoice Date: ${invDate}`, `Transaction Date: ${txDate}`]
    .forEach(l => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(l, R, y, { align: 'right' }); y += 4.5; });
  y += 3;

  const blockX = L, blockWidth = 80;
  const shipBlockRightX = R, shipBlockWidth = 80;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('BILLING ADDRESS', blockX, y);
  let shipY = y;
  doc.text('SHIPPING ADDRESS:', shipBlockRightX, shipY, { align: 'right' });
  y += 5; shipY += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(merchantName || '—', blockX, y);
  doc.text(shipName || '—', shipBlockRightX, shipY, { align: 'right' });
  y += 4.5; shipY += 4.5;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  let billLines: string[] = [], shipLines: string[] = [];
  if (fullBillAddr) billLines = doc.splitTextToSize(fullBillAddr, blockWidth);
  if (fullShipAddr) shipLines = doc.splitTextToSize(fullShipAddr, shipBlockWidth);
  if (billLines.length) doc.text(billLines, blockX, y);
  shipLines.forEach((line, idx) => doc.text(line, shipBlockRightX, shipY + idx * 4, { align: 'right' }));
  y += billLines.length * 4; shipY += shipLines.length * 4;

  const billGST = row['_billGST'] || p.gst || '';
  const billPAN = row['_billPAN'] || p.pan || '';
  if (billGST) { doc.setFont('helvetica', 'bold'); doc.text(`GST: ${billGST}`, blockX, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (billPAN) { doc.setFont('helvetica', 'bold'); doc.text(`PAN: ${billPAN}`, blockX, y); doc.setFont('helvetica', 'normal'); y += 4; }

  y = Math.max(y, shipY) + 6;

  const colAligns = ['center', 'left', 'right', 'center', 'right'];
  autoTable(doc,{
    startY: y,
    head: [['Sl. No', 'Description', 'Unit Price', 'QTY', 'Amount']],
    body: gst.lines.map((l: any, idx: number) => [String(idx + 1), l.description || 'Settlement Pay', formatNumOnly(l.unitPrice), String(l.qty), formatNumOnly(l.total)]),
    foot: [['', '', '', 'TOTAL:', formatNumOnly(gst.total)]],
    margin: { left: L, right: 14 },
    styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 3, textColor: 30, valign: 'middle' },
    headStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 88 }, 2: { cellWidth: 30 }, 3: { cellWidth: 18 }, 4: { cellWidth: 28 } },
    didParseCell: function (data: any) { data.cell.styles.halign = colAligns[data.column.index]; }
  });
  y = (doc as any).lastAutoTable.finalY + 6;
  const totalsLabelX = R - 50, totalsValX = R;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  if (gst.isSame) {
    doc.text('Base Amount', totalsLabelX, y); doc.text(fmtINRPdf(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`CGST @ ${gst.rate / 2}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.cgst), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`SGST @ ${gst.rate / 2}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.sgst), totalsValX, y, { align: 'right' }); y += 4.5;
  } else {
    doc.text('Base Amount', totalsLabelX, y); doc.text(fmtINRPdf(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`IGST @ ${gst.rate}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.igst), totalsValX, y, { align: 'right' }); y += 4.5;
  }
  doc.setDrawColor(20); doc.setLineWidth(0.4); doc.line(totalsLabelX, y, totalsValX, y); y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Total', totalsLabelX, y); doc.text(fmtINRPdf(gst.total), totalsValX, y, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const wl = doc.splitTextToSize(`Amount in Words: ${words}`, W - 4);
  doc.setFillColor(249, 249, 249); doc.setDrawColor(221);
  doc.rect(L, y - 4, W, wl.length * 4.5 + 5, 'FD');
  doc.text(wl, L + 2, y); y += wl.length * 4.5 + 6;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`From ${coName}`, L, y); y += 7;
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('SOLD BY', L, y); y += 5;
  doc.text(coName, L, y); y += 4.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  if (coAddr) { const ls = doc.splitTextToSize(coAddr, 110); doc.text(ls, L, y); y += ls.length * 4; }
  if (coPan) { doc.setFont('helvetica', 'bold'); doc.text(`PAN No: ${coPan}`, L, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (coGst) { doc.setFont('helvetica', 'bold'); doc.text(`GST Registration No: ${coGst}`, L, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (coCin) { doc.text(`CIN No: ${coCin}`, L, y); y += 4; }

  const ph = doc.internal.pageSize.height;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`For ${coName}`, R, ph - 20, { align: 'right' });
  doc.setDrawColor(50); doc.setLineWidth(0.3);
  doc.line(R - 40, ph - 16, R, ph - 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(co.signatory || 'Authorised Signatory', R, ph - 12, { align: 'right' });
  doc.text(co.designation || 'Director', R, ph - 7, { align: 'right' });
  return doc.output('blob');
}

/* ═══════════════════════════════════════════════
   DEFAULT TEMPLATE — DOCX
═══════════════════════════════════════════════ */
export function wP(t: any, opts: any = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const sz = opts.size ? `<w:sz w:val="${opts.size * 2}"/>` : '';
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const ppr = align ? `<w:pPr>${align}</w:pPr>` : '';
  const rpr = (bold || sz) ? `<w:rPr>${bold}${sz}</w:rPr>` : '';
  const eX = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(t ?? '').split('\n').map(line => `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${eX(line)}</w:t></w:r></w:p>`).join('');
}
export function wTC(text: any, widthTw: number, opts: any = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTw}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${wP(text, opts)}</w:tc>`;
}
export function wTR(cells: any[], widths: number[], opts: any = {}) {
  return `<w:tr>${cells.map((c, i) => wTC(c, widths[i] || widths[widths.length - 1], opts)).join('')}</w:tr>`;
}
export function wTable(rows: string, totalWidthTw: number) {
  const b = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders>`;
  const layout = `<w:tblLayout w:type="fixed"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidthTw}" w:type="dxa"/>${layout}${b}</w:tblPr>${rows}</w:tbl>`;
}

export async function buildDOCX(row: any, profile: any, invNum: string, company: any) {
  const co = company || {}; const p = profile || {};
  const gst = getGSTInfo(row, profile, company);
  const merchantName = row['_billName'] || p.name || '';
  const billBlockDocx = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [billBlockDocx.address, billBlockDocx.city, billBlockDocx.state, billBlockDocx.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const shipBlockDocx = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], billBlockDocx.address, billBlockDocx.city, billBlockDocx.state, billBlockDocx.pin);
  const fullShipAddr = [shipBlockDocx.address, shipBlockDocx.city, shipBlockDocx.state, shipBlockDocx.pin].filter(Boolean).join(', ');
  const coName = p.name ? p.name : (co.name || '');
  const coAddr = p.name ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = p.pan ? p.pan : (co.pan || '');
  const coGst = p.gst ? p.gst : (co.gst || '');
  const coCin = p.cin ? p.cin : (co.cin || '');
  const words = numWords(gst.total);
  const txDate = parseDate(row['Transaction Date']);
  const invDate = txDate;
  const billGST = row['_billGST'] || p.gst || ''; const billPAN = row['_billPAN'] || p.pan || '';

  const PAGE_W = 9360;
  const halfW = [PAGE_W / 2, PAGE_W / 2];
  const itemWidths = [900, 4560, 1500, 900, 1500];

  let body = '';
  body += wP('Tax Invoice', { bold: true, size: 14 }); body += wP('(Original for Recipient)', { size: 9 }); body += wP('');
  body += wP(coName, { bold: true, size: 13, align: 'right' }); body += wP('');
  body += wTable(
    wTR([`Invoice Number: ${invNum}`, `Invoice Date: ${invDate}`], halfW, { size: 9 }) +
    wTR([`Transaction Date: ${txDate}`, ''], halfW, { size: 9 }),
    PAGE_W
  );
  body += wP('');
  body += wTable(
    wTR(['BILLING ADDRESS', 'SHIPPING ADDRESS:'], halfW, { bold: true, size: 8 }) +
    wTR([merchantName, shipName], halfW, { bold: true, size: 9 }) +
    wTR(
      [[fullBillAddr, billGST ? `GST: ${billGST}` : '', billPAN ? `PAN: ${billPAN}` : ''].filter(Boolean).join('\n'), fullShipAddr],
      halfW, { size: 9 }
    ),
    PAGE_W
  );
  body += wP('');
  body += wTable(
    wTR(['SI.No', 'Description', 'Unit Price', 'QTY', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center' }) +
    gst.lines.map((l: any, idx: number) => wTR([String(idx + 1), l.description || 'Settlement Pay', fmtINR(l.unitPrice), String(l.qty), fmtINR(l.total)], itemWidths, { size: 8, align: 'center' })).join('') +
    wTR(['', '', '', 'TOTAL:', fmtINR(gst.total)], itemWidths, { bold: true, size: 8, align: 'right' }),
    PAGE_W
  );
  body += wP('');
  body += wP(`Base Amount: ${fmtINR(gst.base)}`, { size: 9, align: 'right' });
  if (gst.isSame) { body += wP(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 9, align: 'right' }); body += wP(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 9, align: 'right' }); }
  else { body += wP(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 9, align: 'right' }); }
  body += wP(`Total: ${fmtINR(gst.total)}`, { bold: true, size: 11, align: 'right' });
  body += wP(''); body += wP(`Amount in Words: ${words}`, { size: 9 }); body += wP(`From ${coName}`, { bold: true, size: 10 });
  body += wP(''); body += wP('SOLD BY', { bold: true, size: 9 }); body += wP(coName, { bold: true, size: 10 });
  if (coAddr) body += wP(coAddr, { size: 9 }); if (coPan) body += wP(`PAN No: ${coPan}`, { bold: true, size: 9 });
  if (coGst) body += wP(`GST Registration No: ${coGst}`, { bold: true, size: 9 }); if (coCin) body += wP(`CIN No: ${coCin}`, { size: 9 });
  body += wP(''); body += wP(`For ${coName}`, { bold: true, size: 10, align: 'right' });
  body += wP(co.signatory || 'Authorised Signatory', { size: 9, align: 'right' }); body += wP(co.designation || 'Director', { size: 9, align: 'right' });

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ═══════════════════════════════════════════════
   PHASE 1 — THEMED TEMPLATES (Agastron, Modern)
═══════════════════════════════════════════════ */
export type InvoiceTheme = {
  key: string;
  label: string;
  accentHex: string;
  accentRGB: [number, number, number];
  headerBgHex: string;
  headerBgRGB: [number, number, number];
  totalBgHex: string;
  totalBgRGB: [number, number, number];
  logoPosition: 'left' | 'right' | 'center';
  fontFamily: string;
};

export const AGASTRON_THEME: InvoiceTheme = {
  key: 'agastron', label: 'Agastron',
  accentHex: '#0f3d5c', accentRGB: [15, 61, 92],
  headerBgHex: '#eef4f8', headerBgRGB: [238, 244, 248],
  totalBgHex: '#dce8f0', totalBgRGB: [220, 232, 240],
  logoPosition: 'left', fontFamily: "'Georgia', 'Times New Roman', serif",
};

export const MODERN_THEME: InvoiceTheme = {
  key: 'modern', label: 'Modern',
  accentHex: '#0d7a5f', accentRGB: [13, 122, 95],
  headerBgHex: '#eafaf4', headerBgRGB: [234, 250, 244],
  totalBgHex: '#d5f2e6', totalBgRGB: [213, 242, 230],
  logoPosition: 'center', fontFamily: "'Helvetica Neue', Arial, sans-serif",
};

export function buildInvoiceHTMLThemed(row: any, profile: any, invNum: string, theme: InvoiceTheme, company: any) {
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

  const totalsRows = gst.isSame
    ? `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>CGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.cgst)}</td></tr>
     <tr><td>SGST @ ${gst.rate / 2}%</td><td>${fmtINR(gst.sgst)}</td></tr>`
    : `<tr><td>Base Amount</td><td>${fmtINR(gst.base)}</td></tr>
     <tr><td>IGST @ ${gst.rate}%</td><td>${fmtINR(gst.igst)}</td></tr>`;

  const logoBlockHTML = logoSrc
    ? `<img src="${logoSrc}" style="max-height:52px;max-width:180px;object-fit:contain;" alt="logo">`
    : `<span style="font-size:22px;font-weight:900;color:${theme.accentHex};">${esc(coName)}</span>`;

  const headerHTML = theme.logoPosition === 'left'
    ? `<div class="inv-top"><div class="inv-logo" style="justify-content:flex-start;text-align:left;">${logoBlockHTML}</div><div class="inv-title-block" style="text-align:right;"><h2 style="color:${theme.accentHex};">Tax Invoice</h2><p>(Original for Recipient)</p></div></div>`
    : theme.logoPosition === 'center'
      ? `<div class="inv-top" style="flex-direction:column;align-items:center;text-align:center;"><div class="inv-logo" style="justify-content:center;max-width:none;margin-bottom:6px;">${logoBlockHTML}</div><div class="inv-title-block"><h2 style="color:${theme.accentHex};">Tax Invoice</h2><p>(Original for Recipient)</p></div></div>`
      : `<div class="inv-top"><div class="inv-title-block"><h2 style="color:${theme.accentHex};">Tax Invoice</h2><p>(Original for Recipient)</p></div><div class="inv-logo">${logoBlockHTML}</div></div>`;

  return `<div class="inv-paper" style="border-top:6px solid ${theme.accentHex};font-family:${theme.fontFamily};">
  ${headerHTML}
  <hr class="inv-rule" style="border-top-color:${theme.accentHex};">
  <div class="inv-meta">
    <div><b>Invoice Number:</b> ${esc(invNum)}</div>
    <div><b>Invoice Date:</b> ${esc(invDate)}</div>
    <div><b>Transaction Date:</b> ${esc(txDate)}</div>
  </div>
  <div class="inv-addr-stack">
    <div class="inv-addr-block">
      <div class="inv-addr-label">Billing Address</div>
      <div class="inv-addr-body">
        <b>${esc(merchantName)}</b><br>
        ${fullBillAddr ? wrapAddressLines(fullBillAddr) + '<br>' : ''}
        ${merchantGST ? `<b>GST: ${esc(merchantGST)}</b><br>` : ''}
        ${merchantPAN ? `<b>PAN: ${esc(merchantPAN)}</b><br>` : ''}
      </div>
    </div>
    <div class="inv-addr-block ship">
      <div class="inv-addr-label">Shipping Address:</div>
      <div class="inv-addr-body"><b>${esc(shipName)}</b><br>${fullShipAddr ? wrapAddressLines(fullShipAddr) : '—'}</div>
    </div>
  </div>
<table class="inv-table">
    <thead><tr>
      <th style="width:10%;background:${theme.headerBgHex};">SI.No</th><th style="width:44%;background:${theme.headerBgHex};">Description</th><th style="width:15%;background:${theme.headerBgHex};">Unit Price</th><th style="width:10%;background:${theme.headerBgHex};">QTY</th>
      <th style="width:21%;background:${theme.headerBgHex};">Amount</th>
    </tr></thead>
 <tbody>
${gst.lines.map((item: any, index: number) => `
<tr>
<td>${index + 1}</td>
<td><b>${esc(item.description)}</b></td>
<td>${fmtINR(item.unitPrice)}</td>
<td>${item.qty}</td>
<td>${fmtINR(item.base)}</td>
</tr>
`).join('')}
</tbody><tfoot><tr>
      <td colspan="4" style="font-weight:700;background:${theme.totalBgHex};">TOTAL:</td>
      <td style="font-weight:800;background:${theme.totalBgHex};">${fmtINR(gst.total)}</td>
    </tr></tfoot>
  </table>
  <div style="display:flex;justify-content:flex-end;">
    <table class="inv-totals">
      ${totalsRows}
      <tr class="total-final"><td style="border-top:2px solid ${theme.accentHex};"><b>Total</b></td><td style="border-top:2px solid ${theme.accentHex};"><b>${fmtINR(gst.total)}</b></td></tr>
    </table>
  </div>
  <div class="inv-words"><b>Amount in Words:</b> ${esc(words)}</div>
  ${coName ? `<div class="inv-from" style="border-left:4px solid ${theme.accentHex};">From ${esc(coName)}</div>` : ''}
  <hr class="inv-rule-light">
  <div class="inv-footer">
    <div class="inv-sold-by">
      <div style="font-size:9px;color:#777;margin-bottom:3px;">SOLD BY</div>
      <div class="co-name" style="color:${theme.accentHex};">${esc(coName)}</div>
      ${coAddr ? `<div>${wrapAddressLines(coAddr)}</div>` : ''}
      ${coPan ? `<div><b>PAN No: ${esc(coPan)}</b></div>` : ''}
      ${coGst ? `<div><b>GST Registration No: ${esc(coGst)}</b></div>` : ''}
      ${coCin ? `<div><b>CIN No:</b> ${esc(coCin)}</div>` : ''}
    </div>
    <div class="inv-sign">
      <div class="sig-line" style="border-bottom-color:${theme.accentHex};"></div>
      ${coName ? `<div class="sig-name">For ${esc(coName)}</div>` : ''}
      <div style="color:#888;">${esc(co.signatory || 'Authorised Signatory')}</div>
      <div>${esc(co.designation || 'Director')}</div>
    </div>
  </div>
</div>`;
}

export async function buildPDFThemed(row: any, profile: any, invNum: string, theme: InvoiceTheme, company: any) {
  const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 14, R = 196, W = 182;
  let y = 16;
  const co = company || {};
  const p = profile || {};
  const gst = getGSTInfo(row, profile, company);

  const merchantName = row['_billName'] || p.name || '';
  const billBlockPdf = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [billBlockPdf.address, billBlockPdf.city, billBlockPdf.state, billBlockPdf.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const shipBlockPdf = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], billBlockPdf.address, billBlockPdf.city, billBlockPdf.state, billBlockPdf.pin);
  const fullShipAddr = [shipBlockPdf.address, shipBlockPdf.city, shipBlockPdf.state, shipBlockPdf.pin].filter(Boolean).join(', ');
  const coName = p.name ? p.name : (co.name || '');
  const coAddr = p.name ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = p.pan ? p.pan : (co.pan || '');
  const coGst = p.gst ? p.gst : (co.gst || '');
  const coCin = p.cin ? p.cin : (co.cin || '');
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

  doc.setFillColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]);
  doc.rect(0, 0, 210, 3, 'F');

  const drawLogoOrName = (x: number, align: 'left' | 'right' | 'center') => {
    if (logoSrc && logoSrc.startsWith('data:')) {
      try {
        const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
        const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
        const imgX = align === 'right' ? x - 45 : align === 'center' ? x - 22.5 : x;
        doc.addImage(logoSrc, imgType, imgX, y - 9, 45, 16, undefined, 'FAST');
        return;
      } catch (e) { /* fall through to name */ }
    }
    if (coName) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.setTextColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]);
      doc.text(coName, x, y, { align });
      doc.setTextColor(0, 0, 0);
    }
  };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.setTextColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]);
  if (theme.logoPosition === 'left') {
    drawLogoOrName(L, 'left');
    doc.text('Tax Invoice', R, y, { align: 'right' });
  } else if (theme.logoPosition === 'center') {
    drawLogoOrName(105, 'center');
    doc.text('Tax Invoice', 105, y + 12, { align: 'center' });
    y += 8;
  } else {
    doc.text('Tax Invoice', L, y);
    drawLogoOrName(R, 'right');
  }
  doc.setTextColor(0, 0, 0);

  y += 5; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text('(Original for Recipient)', L, y);
  y += 3; doc.setDrawColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]); doc.setLineWidth(0.5); doc.line(L, y, R, y); y += 5;
  doc.setDrawColor(40);

  [`Invoice Number: ${invNum}`, `Invoice Date: ${invDate}`, `Transaction Date: ${txDate}`]
    .forEach(l => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(l, R, y, { align: 'right' }); y += 4.5; });
  y += 3;

  const blockX = L, blockWidth = 80;
  const shipBlockRightX = R, shipBlockWidth = 80;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('BILLING ADDRESS', blockX, y);
  let shipY = y;
  doc.text('SHIPPING ADDRESS:', shipBlockRightX, shipY, { align: 'right' });
  y += 5; shipY += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(merchantName || '—', blockX, y);
  doc.text(shipName || '—', shipBlockRightX, shipY, { align: 'right' });
  y += 4.5; shipY += 4.5;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  let billLines: string[] = [], shipLines: string[] = [];
  if (fullBillAddr) billLines = doc.splitTextToSize(fullBillAddr, blockWidth);
  if (fullShipAddr) shipLines = doc.splitTextToSize(fullShipAddr, shipBlockWidth);
  if (billLines.length) doc.text(billLines, blockX, y);
  shipLines.forEach((line, idx) => doc.text(line, shipBlockRightX, shipY + idx * 4, { align: 'right' }));
  y += billLines.length * 4; shipY += shipLines.length * 4;

  const billGST = row['_billGST'] || p.gst || '';
  const billPAN = row['_billPAN'] || p.pan || '';
  if (billGST) { doc.setFont('helvetica', 'bold'); doc.text(`GST: ${billGST}`, blockX, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (billPAN) { doc.setFont('helvetica', 'bold'); doc.text(`PAN: ${billPAN}`, blockX, y); doc.setFont('helvetica', 'normal'); y += 4; }

  y = Math.max(y, shipY) + 6;

  const colAligns = ['center', 'left', 'right', 'center', 'right'];
  doc.autoTable({
    startY: y,
    head: [['Sl. No', 'Description', 'Unit Price', 'QTY', 'Amount']],
    body: gst.lines.map((l: any, idx: number) => [String(idx + 1), l.description || 'Settlement Pay', formatNumOnly(l.unitPrice), String(l.qty), formatNumOnly(l.total)]),
    foot: [['', '', '', 'TOTAL:', formatNumOnly(gst.total)]],
    margin: { left: L, right: 14 },
    styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 3, textColor: 30, valign: 'middle' },
    headStyles: { fillColor: theme.headerBgRGB, textColor: 30, fontStyle: 'bold' },
    footStyles: { fillColor: theme.totalBgRGB, textColor: 30, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 88 }, 2: { cellWidth: 30 }, 3: { cellWidth: 18 }, 4: { cellWidth: 28 } },
    didParseCell: function (data: any) { data.cell.styles.halign = colAligns[data.column.index]; }
  });
  y = (doc as any).lastAutoTable.finalY + 6;
  const totalsLabelX = R - 50, totalsValX = R;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  if (gst.isSame) {
    doc.text('Base Amount', totalsLabelX, y); doc.text(fmtINRPdf(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`CGST @ ${gst.rate / 2}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.cgst), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`SGST @ ${gst.rate / 2}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.sgst), totalsValX, y, { align: 'right' }); y += 4.5;
  } else {
    doc.text('Base Amount', totalsLabelX, y); doc.text(fmtINRPdf(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
    doc.text(`IGST @ ${gst.rate}%`, totalsLabelX, y); doc.text(fmtINRPdf(gst.igst), totalsValX, y, { align: 'right' }); y += 4.5;
  }
  doc.setDrawColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]); doc.setLineWidth(0.4); doc.line(totalsLabelX, y, totalsValX, y); y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.setTextColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]);
  doc.text('Total', totalsLabelX, y); doc.text(fmtINRPdf(gst.total), totalsValX, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 7;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const wl = doc.splitTextToSize(`Amount in Words: ${words}`, W - 4);
  doc.setFillColor(249, 249, 249); doc.setDrawColor(221);
  doc.rect(L, y - 4, W, wl.length * 4.5 + 5, 'FD');
  doc.text(wl, L + 2, y); y += wl.length * 4.5 + 6;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`From ${coName}`, L, y); y += 7;
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('SOLD BY', L, y); y += 5;
  doc.setTextColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]);
  doc.text(coName, L, y); doc.setTextColor(0, 0, 0); y += 4.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  if (coAddr) { const ls = doc.splitTextToSize(coAddr, 110); doc.text(ls, L, y); y += ls.length * 4; }
  if (coPan) { doc.setFont('helvetica', 'bold'); doc.text(`PAN No: ${coPan}`, L, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (coGst) { doc.setFont('helvetica', 'bold'); doc.text(`GST Registration No: ${coGst}`, L, y); doc.setFont('helvetica', 'normal'); y += 4; }
  if (coCin) { doc.text(`CIN No: ${coCin}`, L, y); y += 4; }

  const ph = doc.internal.pageSize.height;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`For ${coName}`, R, ph - 20, { align: 'right' });
  doc.setDrawColor(theme.accentRGB[0], theme.accentRGB[1], theme.accentRGB[2]); doc.setLineWidth(0.3);
  doc.line(R - 40, ph - 16, R, ph - 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(co.signatory || 'Authorised Signatory', R, ph - 12, { align: 'right' });
  doc.text(co.designation || 'Director', R, ph - 7, { align: 'right' });
  return doc.output('blob');
}

export function wPTheme(t: any, opts: any = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const sz = opts.size ? `<w:sz w:val="${opts.size * 2}"/>` : '';
  const color = opts.color ? `<w:color w:val="${opts.color}"/>` : '';
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const ppr = align ? `<w:pPr>${align}</w:pPr>` : '';
  const rpr = (bold || sz || color) ? `<w:rPr>${bold}${sz}${color}</w:rPr>` : '';
  const eX = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(t ?? '').split('\n').map(line => `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${eX(line)}</w:t></w:r></w:p>`).join('');
}
export function wTCTheme(text: any, widthTw: number, opts: any = {}) {
  const shd = opts.shade ? `<w:shd w:val="clear" w:fill="${opts.shade}"/>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTw}" w:type="dxa"/><w:vAlign w:val="center"/>${shd}</w:tcPr>${wPTheme(text, opts)}</w:tc>`;
}
export function wTRTheme(cells: any[], widths: number[], opts: any = {}) {
  return `<w:tr>${cells.map((c, i) => wTCTheme(c, widths[i] || widths[widths.length - 1], opts)).join('')}</w:tr>`;
}
export function wTableTheme(rows: string, totalWidthTw: number) {
  const b = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders>`;
  const layout = `<w:tblLayout w:type="fixed"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidthTw}" w:type="dxa"/>${layout}${b}</w:tblPr>${rows}</w:tbl>`;
}

export async function buildDOCXThemed(row: any, profile: any, invNum: string, theme: InvoiceTheme, company: any) {
  const co = company || {}; const p = profile || {};
  const gst = getGSTInfo(row, profile, company);
  const merchantName = row['_billName'] || p.name || '';
  const billBlockDocx = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = [billBlockDocx.address, billBlockDocx.city, billBlockDocx.state, billBlockDocx.pin].filter(Boolean).join(', ');
  const shipName = row['_shipName'] || merchantName;
  const shipBlockDocx = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], billBlockDocx.address, billBlockDocx.city, billBlockDocx.state, billBlockDocx.pin);
  const fullShipAddr = [shipBlockDocx.address, shipBlockDocx.city, shipBlockDocx.state, shipBlockDocx.pin].filter(Boolean).join(', ');
  const coName = p.name ? p.name : (co.name || '');
  const coAddr = p.name ? [p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') : [co.address, co.city, co.state, co.pin].filter(Boolean).join(', ');
  const coPan = p.pan ? p.pan : (co.pan || '');
  const coGst = p.gst ? p.gst : (co.gst || '');
  const coCin = p.cin ? p.cin : (co.cin || '');
  const words = numWords(gst.total);
  const txDate = parseDate(row['Transaction Date']);
  const invDate = txDate;
  const billGST = row['_billGST'] || p.gst || ''; const billPAN = row['_billPAN'] || p.pan || '';
  const accentColor = theme.accentHex.replace('#', '').toUpperCase();
  const headerShade = theme.headerBgHex.replace('#', '').toUpperCase();
  const totalShade = theme.totalBgHex.replace('#', '').toUpperCase();

  const PAGE_W = 9360;
  const halfW = [PAGE_W / 2, PAGE_W / 2];
  const itemWidths = [900, 4560, 1500, 900, 1500];

  let body = '';
  body += wPTheme('Tax Invoice', { bold: true, size: 14, color: accentColor });
  body += wPTheme('(Original for Recipient)', { size: 9 }); body += wPTheme('');
  body += wPTheme(coName, { bold: true, size: 13, align: 'right', color: accentColor }); body += wPTheme('');
  body += wTableTheme(
    wTRTheme([`Invoice Number: ${invNum}`, `Invoice Date: ${invDate}`], halfW, { size: 9 }) +
    wTRTheme([`Transaction Date: ${txDate}`, ''], halfW, { size: 9 }),
    PAGE_W
  );
  body += wPTheme('');
  body += wTableTheme(
    wTRTheme(['BILLING ADDRESS', 'SHIPPING ADDRESS:'], halfW, { bold: true, size: 8 }) +
    wTRTheme([merchantName, shipName], halfW, { bold: true, size: 9 }) +
    wTRTheme(
      [[fullBillAddr, billGST ? `GST: ${billGST}` : '', billPAN ? `PAN: ${billPAN}` : ''].filter(Boolean).join('\n'), fullShipAddr],
      halfW, { size: 9 }
    ),
    PAGE_W
  );
  body += wPTheme('');
  body += wTableTheme(
    wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center', shade: headerShade }) +
    gst.lines.map((l: any, idx: number) => wTRTheme([String(idx + 1), l.description || 'Settlement Pay', fmtINR(l.unitPrice), String(l.qty), fmtINR(l.total)], itemWidths, { size: 8, align: 'center' })).join('') +
    wTRTheme(['', '', '', 'TOTAL:', fmtINR(gst.total)], itemWidths, { bold: true, size: 8, align: 'right', shade: totalShade }),
    PAGE_W
  );
  body += wPTheme('');
  body += wPTheme(`Base Amount: ${fmtINR(gst.base)}`, { size: 9, align: 'right' });
  if (gst.isSame) { body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 9, align: 'right' }); body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 9, align: 'right' }); }
  else { body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 9, align: 'right' }); }
  body += wPTheme(`Total: ${fmtINR(gst.total)}`, { bold: true, size: 11, align: 'right', color: accentColor });
  body += wPTheme(''); body += wPTheme(`Amount in Words: ${words}`, { size: 9 }); body += wPTheme(`From ${coName}`, { bold: true, size: 10 });
  body += wPTheme(''); body += wPTheme('SOLD BY', { bold: true, size: 9 }); body += wPTheme(coName, { bold: true, size: 10, color: accentColor });
  if (coAddr) body += wPTheme(coAddr, { size: 9 }); if (coPan) body += wPTheme(`PAN No: ${coPan}`, { bold: true, size: 9 });
  if (coGst) body += wPTheme(`GST Registration No: ${coGst}`, { bold: true, size: 9 }); if (coCin) body += wPTheme(`CIN No: ${coCin}`, { size: 9 });
  body += wPTheme(''); body += wPTheme(`For ${coName}`, { bold: true, size: 10, align: 'right' });
  body += wPTheme(co.signatory || 'Authorised Signatory', { size: 9, align: 'right' }); body += wPTheme(co.designation || 'Director', { size: 9, align: 'right' });

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}