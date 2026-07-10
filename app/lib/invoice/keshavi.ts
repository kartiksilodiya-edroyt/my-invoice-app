import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
  esc, cleanNum, fmtINR, numWords, parseDate,
  pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

function extractFields(row: any, profile: any, company: any) {
  const co = company || {};
  const p = profile || {};
  const formatAddr = (a: any, c: any, s: any, p: any) => [a, c, s, p].filter(Boolean).join(', ');

  const merchantName = row['_billName'] || p.name || '';
  const merchantGST = row['_billGST'] || p.gst || '';
  const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
  const fullBillAddr = formatAddr(bill.address, bill.city, bill.state, bill.pin);

  // Shipping — falls back to billing if no separate ship data exists
  const shipName = row['_shipName'] || merchantName;
  const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
  const fullShipAddr = formatAddr(ship.address, ship.city, ship.state, ship.pin);

  const isProfile = !!p.name;
  const coName = isProfile ? p.name : (co.name || '');
  const coAddr = isProfile ? formatAddr(p.address, p.city, p.state, p.pin) : formatAddr(co.address, co.city, co.state, co.pin);
  const coCin = isProfile ? (p.cin || '') : (co.cin || '');
  const coGst = isProfile ? (p.gst || '') : (co.gst || '');
  const orderDate = parseDate(row['Transaction Date']);
  const logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);
  return { merchantName, merchantGST, fullBillAddr, shipName, fullShipAddr, coName, coAddr, coCin, coGst, orderDate, logoSrc };
}
// Splits a comma-separated address into grouped lines (default: 2 parts per line)
// e.g. "A, B, C, D, E, F, G, H" → ["A, B,", "C, D,", "E, F,", "G, H"]
function splitAddrLines(addr: string, perLine = 2): string[] {
  if (!addr) return [];
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += perLine) {
    const chunk = parts.slice(i, i + perLine);
    const isLast = i + perLine >= parts.length;
    lines.push(chunk.join(', ') + (isLast ? '' : ','));
  }
  return lines;
}

export function buildInvoiceHTMLKeshavi(row: any, profile: any, invNum: string, company: any) {
  if (row['_invNum']) invNum = row['_invNum'];
  const f = extractFields(row, profile, company);
  const gst = getGSTInfo(row, profile, company);
  const words = numWords(gst.total);

  const logoBlockHTML = f.logoSrc
    ? `<img src="${f.logoSrc}" style="max-height:38px;max-width:160px;object-fit:contain;" alt="logo">`
    : `<div style="font-size:15px;font-weight:800;color:#111;">${esc(f.coName)}</div>`;

  const shipFromLines = splitAddrLines(f.coAddr, 2);

  const taxHead = gst.isSame ? `<th>SGST ₹</th><th>CGST ₹</th>` : `<th>IGST ₹</th>`;

const rowsHTML = gst.lines.map((item: any, idx: number) => {
  const amount = item.base; // already GST-inclusive
  const unitPrice = item.qty ? amount / item.qty : amount;
  return `<tr>
    <td style="padding:8px 6px;text-align:center;">${idx + 1}</td>
    <td style="padding:8px 6px;">${esc(item.description || 'Item')}</td>
    <td style="padding:8px 6px;text-align:right;">${fmtINR(unitPrice).replace('Rs. ', '')}</td>
    <td style="padding:8px 6px;text-align:center;">${item.qty}</td>
    <td style="padding:8px 6px;text-align:right;font-weight:700;">${fmtINR(amount).replace('Rs. ', '')}</td>
  </tr>`;
}).join('');

  return `<div style="background:#ffffff;color:#111;border:1px solid #999;font-family:'Helvetica Neue',Arial,sans-serif;padding:24px 28px;">
  <div style="text-align:center;font-size:15px;font-weight:800;margin-bottom:14px;">Tax Invoice</div>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
    <div style="font-size:10.5px;line-height:1.7;max-width:65%;">
      <div>Sold By: <b>${esc(f.coName)}</b>,</div>
      ${f.coAddr ? `<div>Address : ${esc(f.coAddr)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      ${logoBlockHTML}
      <div style="border:1px solid #999;padding:5px 10px;font-size:10px;margin-top:8px;">Invoice Number # ${esc(invNum)}</div>
    </div>
  </div>

  <hr style="border:none;border-top:1px solid #999;margin:12px 0;">

  <div style="display:flex;justify-content:space-between;gap:16px;font-size:10.5px;line-height:1.7;margin-bottom:6px;">
    <div style="min-width:150px;">
      <div>Order Date: ${esc(f.orderDate)}</div>
      <div>Invoice Date: ${esc(f.orderDate)}</div>
      ${f.coCin ? `<div>CIN: ${esc(f.coCin)}</div>` : ''}
       ${f.coGst ? `<div><b>GSTIN</b> - ${esc(f.coGst)}</div>` : ''}
    </div>
    <div style="flex:1;max-width:230px;">
      <div style="font-weight:700;">Billing Address</div>
      <div>${esc(f.merchantName)}</div>
      <div>${esc(f.fullBillAddr)}</div>
      ${f.merchantGST ? `<div><b>GSTIN:</b> ${esc(f.merchantGST)}</div>` : ''}
    </div>
    <div style="flex:1;max-width:230px;border-left:1px solid #ccc;padding-left:14px;">
      <div style="font-weight:700;">Shipping Address</div>
      <div>${esc(f.shipName)}</div>
      <div>${esc(f.fullShipAddr)}</div>
    </div>
  </div>

<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:14px;">
  <thead><tr style="background:#f0f0f0;border-bottom:1px solid #999;">
    <th style="padding:8px 6px;width:50px;">Sl. No</th>
    <th style="padding:8px 6px;text-align:left;">Description</th>
    <th style="padding:8px 6px;">Unit Price</th>
    <th style="padding:8px 6px;">QTY</th>
    <th style="padding:8px 6px;">Amount</th>
  </tr></thead>
  <tbody>${rowsHTML}</tbody>
  <tfoot>
    <tr style="background:#f7f7f7;font-weight:700;border-top:1px solid #999;">
      <td colSpan="4" style="padding:8px 6px;text-align:right;">TOTAL:</td>
      <td style="padding:8px 6px;text-align:right;">${fmtINR(gst.total).replace('Rs. ', '')}</td>
    </tr>
  </tfoot>
</table>

<table style="margin-left:auto;width:260px;border-collapse:collapse;font-size:10.5px;margin-bottom:14px;">
  <tbody>
    <tr><td style="padding:5px 8px;">Base Amount</td><td style="padding:5px 8px;text-align:right;">${fmtINR(gst.base)}</td></tr>
    ${gst.isSame
      ? `<tr><td style="padding:5px 8px;">CGST @ ${gst.rate / 2}%</td><td style="padding:5px 8px;text-align:right;">${fmtINR(gst.cgst)}</td></tr>
         <tr><td style="padding:5px 8px;">SGST @ ${gst.rate / 2}%</td><td style="padding:5px 8px;text-align:right;">${fmtINR(gst.sgst)}</td></tr>`
      : `<tr><td style="padding:5px 8px;">IGST @ ${gst.rate}%</td><td style="padding:5px 8px;text-align:right;">${fmtINR(gst.igst)}</td></tr>`
    }
    <tr style="border-top:2px solid #111;"><td style="padding:6px 8px;font-weight:800;font-size:12px;">Total</td><td style="padding:6px 8px;text-align:right;font-weight:800;font-size:12px;">${fmtINR(gst.total)}</td></tr>
  </tbody>
</table>

<div style="font-size:10px;background:#f9f9f9;border:1px solid #ddd;padding:8px 12px;border-radius:4px;margin-bottom:8px;">Amount in Words: ${esc(words)}</div>
<div style="font-size:11px;font-weight:800;color:#111;margin-bottom:20px;">From ${esc(f.coName)}</div>

  <div style="display:flex;justify-content:flex-end;">
    <div style="text-align:center;min-width:180px;">
      <div style="font-weight:700;font-size:11px;margin-bottom:34px;">For ${esc(f.coName)}</div>
      <div style="border-top:1px solid #333;padding-top:4px;font-size:10px;">Authorized Signatory</div>
    </div>
  </div>
</div>`;
}


export async function buildPDFKeshavi(row: any, profile: any, invNum: string, company: any) {
  const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 14, R = 196, W = 182;
  let y = 16;

  // Safe text helper — handles strings AND string[] (multi-line), guards NaN coords
  const T = (text: any, x: any, y2: any, opts?: any) => {
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y2) ? y2 : 0;
    if (Array.isArray(text)) {
      if (!text.length) return;
      doc.text(text, safeX, safeY, opts);
      return;
    }
    const safeText = (text === undefined || text === null || text === '') ? '' : String(text);
    if (!safeText) return;
    doc.text(safeText, safeX, safeY, opts);
  };

  const f = extractFields(row, profile, company);
  const gst = getGSTInfo(row, profile, company);
  const words = numWords(gst.total);
  const fmtNum = (n: any) => {
    const v = cleanNum(n);
    return Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
  };

  let logoSrc = f.logoSrc;
  if (logoSrc && !logoSrc.startsWith('data:')) {
    const dataUrl = await urlToDataURL(logoSrc);
    if (dataUrl) logoSrc = dataUrl;
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  T('Tax Invoice', 105, y, { align: 'center' });
  y += 10;

  const maxLogoW = 36, maxLogoH = 14;
  const logoTopY = 8;
  let logoBottomY = logoTopY;
  if (logoSrc && logoSrc.startsWith('data:')) {
    try {
      const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
      const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
      let drawW = maxLogoW, drawH = maxLogoH;
      try {
        const props = doc.getImageProperties(logoSrc);
        const ratio = props?.width / props?.height;
        if (Number.isFinite(ratio) && ratio > 0) {
          if (maxLogoW / ratio <= maxLogoH) { drawW = maxLogoW; drawH = maxLogoW / ratio; }
          else { drawH = maxLogoH; drawW = maxLogoH * ratio; }
        }
      } catch (e) { /* keep fixed box */ }
      if (Number.isFinite(drawW) && Number.isFinite(drawH) && drawW > 0 && drawH > 0) {
        doc.addImage(logoSrc, imgType, R - drawW, logoTopY, drawW, drawH, undefined, 'FAST');
        logoBottomY = logoTopY + drawH;
      }
    } catch (e) { /* ignore */ }
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  T(`Sold By: ${f.coName},`, L, y);
  y += 5;

  // Address — single wrapped paragraph, same font/size as "Sold By"
  // Width capped at 115mm so it never runs under the Invoice Number box (which starts at R-60 = 136mm)
  if (f.coAddr) {
    const addrLines = doc.splitTextToSize(`Address : ${f.coAddr}`, 115);
    T(addrLines, L, y);
    y += addrLines.length * 4.2;
  }
  

  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.2);
  const boxY = Math.max(24, logoBottomY + 3);
  doc.rect(R - 60, boxY, 60, 8);
  doc.setFontSize(8);
  T(`Invoice Number # ${invNum}`, R - 57, boxY + 5);

  y = Math.max(y, boxY + 8) + 4;
  doc.line(L, y, R, y);
  y += 7;

  const colStartY = y;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  T(`Order Date: ${f.orderDate}`, L, y); y += 4.5;
  T(`Invoice Date: ${f.orderDate}`, L, y); y += 4.5;
  if (f.coCin) { T(`CIN: ${f.coCin}`, L, y); y += 4.5; }
  if (f.coGst) { T(`GSTIN - ${f.coGst}`, L, y); y += 5; }

  // Billing (middle) and Shipping (right) — side by side
  const billX = L + 65;
  const shipX = L + 128;
  const colW = 58;

  let by = colStartY;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  T('Billing Address', billX, by);
  T('Shipping Address', shipX, by);
  by += 4.5;

  doc.setFont('helvetica', 'normal');
  T(f.merchantName || '-', billX, by);
  T(f.shipName || '-', shipX, by);
  by += 4.5;

  const bLines = doc.splitTextToSize(f.fullBillAddr || '-', colW);
  const sLines = doc.splitTextToSize(f.fullShipAddr || '-', colW);
  T(bLines, billX, by);
  T(sLines, shipX, by);
  by += Math.max(bLines.length, sLines.length) * 4.2;

//  if (f.merchantGST) { T(`GSTIN: ${f.merchantGST}`, billX, by); by += 4.5; }

  y = Math.max(y, by) + 3;

const head = [['Sl. No', 'Description', 'Unit Price', 'QTY', 'Amount']];

const bodyRows = gst.lines.map((l: any, idx: number) => {
  const amount = l.base; // already GST-inclusive — do NOT add tax again
  const unitPrice = l.qty ? amount / l.qty : amount;
  return [String(idx + 1), l.description || 'Item', fmtNum(unitPrice), String(l.qty), fmtNum(amount)];
});

autoTable(doc, {
  startY: y,
  head, body: bodyRows,
  foot: [['', '', '', 'TOTAL:', fmtNum(gst.total)]],
  margin: { left: L, right: 14 },
  styles: {
    fontSize: 8,
    cellPadding: 4,
    textColor: 20,
    lineWidth: 0, // no borders anywhere by default
    overflow: 'linebreak',
  },
  headStyles: {
    fillColor: [240, 240, 240],
    textColor: 0,
    fontStyle: 'bold',
    lineColor: [150, 150, 150],
    lineWidth: { top: 0, left: 0, right: 0, bottom: 0.3 }, // only bottom line under header
  },
  footStyles: {
    fillColor: [247, 247, 247],
    textColor: 0,
    fontStyle: 'bold',
    lineColor: [150, 150, 150],
    lineWidth: { top: 0.3, left: 0, right: 0, bottom: 0 }, // only top line above TOTAL
  },
  bodyStyles: {
    lineWidth: 0, // item rows fully borderless
  },
  columnStyles: { 0: { halign: 'center' }, 1: { halign: 'left' } },
  didParseCell: function (data: any) { if (data.column.index > 1) data.cell.styles.halign = 'right'; },
});
y = (doc as any).lastAutoTable.finalY + 8;

// Base / GST / Total summary block, right-aligned
const boxW = 70, boxR = R, boxL = R - boxW;
doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
T('Base Amount', boxL, y); T(fmtNum(gst.base), boxR, y, { align: 'right' }); y += 5;
if (gst.isSame) {
  T(`CGST @ ${gst.rate / 2}%`, boxL, y); T(fmtNum(gst.cgst), boxR, y, { align: 'right' }); y += 5;
  T(`SGST @ ${gst.rate / 2}%`, boxL, y); T(fmtNum(gst.sgst), boxR, y, { align: 'right' }); y += 5;
} else {
  T(`IGST @ ${gst.rate}%`, boxL, y); T(fmtNum(gst.igst), boxR, y, { align: 'right' }); y += 5;
}
doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.4);
doc.line(boxL, y, boxR, y);
y += 5;
doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
T('Total', boxL, y); T(`Rs. ${fmtNum(gst.total)}`, boxR, y, { align: 'right' });
y += 9;


doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
const wl = doc.splitTextToSize(`Amount in Words: ${words || ''}`, W - 8);
const boxH = wl.length * 4.2 + 6;

doc.setFillColor(247, 247, 247);   // slightly darker fill
doc.setDrawColor(150, 150, 150);   // visible mid-grey border
doc.setLineWidth(0.3);             // thick enough to render
doc.rect(L, y, W, boxH, 'FD');     // plain rect — more reliable than roundedRect
T(wl, L + 4, y + 5.5);
y += boxH + 8;

doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
doc.setTextColor(0, 0, 0);
T(`From ${f.coName}`, L, y);
y += 10;

  // Footer / signature block — cleaner fixed spacing
  doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.4);
doc.line(R - 55, y, R, y);
  y += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  T(`For ${f.coName}`, R, y, { align: 'right' });
  y += 14;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  T('Authorized Signatory', R, y, { align: 'right' });

  return doc.output('blob');
}

export async function buildDOCXKeshavi(row: any, profile: any, invNum: string, company: any) {
  const f = extractFields(row, profile, company);
  const gst = getGSTInfo(row, profile, company);
  const words = numWords(gst.total);

  const PAGE_W = 9360;
  const taxCols = gst.isSame
    ? ['Description', 'Qty', 'SGST', 'CGST', 'Total']
    : ['Description', 'Qty','IGST', 'Total'];
  const colWidths = gst.isSame ? [3120, 1040, 1560, 1160, 1160, 1320] : [3600, 1200, 1800, 1360, 1400];

  const shipFromLines = splitAddrLines(f.coAddr, 2);

  let body = '';
  body += wPTheme('Tax Invoice', { bold: true, size: 14, align: 'center' });
  body += wPTheme('');
  body += wPTheme(`Sold By: ${f.coName},`, { size: 9 });
  if (shipFromLines.length) {
    body += wPTheme(`Address:\n${shipFromLines.join('\n')}`, { size: 8 });
  }
  if (f.coGst) body += wPTheme(`GSTIN - ${f.coGst}`, { size: 9 });
  body += wPTheme(`Invoice Number # ${invNum}`, { size: 9, align: 'right' });
  body += wPTheme('');

  body += wTableTheme(
    wTRTheme(
      [
        [`Order Date: ${f.orderDate}`, `Invoice Date: ${f.orderDate}`, f.coCin ? `CIN: ${f.coCin}` : ''].filter(Boolean).join('\n'),
        ['Billing Address', f.merchantName, f.fullBillAddr, f.merchantGST ? `GSTIN: ${f.merchantGST}` : ''].filter(Boolean).join('\n'),
        ['Shipping Address', f.shipName, f.fullShipAddr].filter(Boolean).join('\n'),
      ],
      [PAGE_W * 0.34, PAGE_W * 0.33, PAGE_W * 0.33], { size: 8 }
    ),
    PAGE_W
  );
  body += wPTheme('');

  body += wTableTheme(
    wTRTheme(taxCols, colWidths, { bold: true, size: 8, align: 'center' }) +
    gst.lines.map((l: any) => {
      const lineTax = l.base * gst.rate / 100;
      const half = lineTax / 2;
      return wTRTheme(
        gst.isSame
          ? [l.description || 'Item', String(l.qty), fmtINR(l.base), fmtINR(half), fmtINR(half), fmtINR(l.base + lineTax)]
          : [l.description || 'Item', String(l.qty), fmtINR(l.base), fmtINR(lineTax), fmtINR(l.base + lineTax)],
        colWidths, { size: 8, align: 'center' }
      );
    }).join(''),
    PAGE_W
  );
  body += wPTheme('');

  body += wPTheme(`Grand Total: ${fmtINR(gst.total)}`, { bold: true, size: 12, align: 'right' });
  body += wPTheme(words, { size: 9, align: 'right', italic: true });
  body += wPTheme('');
  body += wPTheme('');
  body += wPTheme(`For ${f.coName}`, { bold: true, size: 10, align: 'right' });
  body += wPTheme('');
  body += wPTheme('Authorized Signatory', { size: 9, align: 'right' });

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}