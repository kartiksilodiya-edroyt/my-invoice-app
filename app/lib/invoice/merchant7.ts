// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant7.ts
// MERCHANT 7 — "Card Panels" style. Strict grayscale (no color,
// only black/white/gray shades). Each section renders as a soft
// rounded-corner panel with a light-gray fill (HTML/DOCX shading
// only — never a hue), distinct from every bordered/ruled template
// so far.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

const fmtRs = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function splitAddrCommaLines(addr: string, maxLineLen = 44): string[] {
    if (!addr) return [];
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    return parts.reduce((acc: string[], part: string) => {
        const last = acc[acc.length - 1];
        if (last && (last.length + part.length) < maxLineLen) acc[acc.length - 1] = last + ', ' + part;
        else acc.push(part);
        return acc;
    }, [] as string[]);
}

function extractFields(row: any, profile: any, company: any) {
    const co = company || {};
    const p = profile || {};
    const formatAddr = (a: any, c: any, s: any, pin: any) => [a, c, s, pin].filter(Boolean).join(', ');
    const merchantName = row['_billName'] || p.name || '';
    const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
    const fullBillAddr = formatAddr(bill.address, bill.city, bill.state, bill.pin);
    const shipName = row['_shipName'] || merchantName;
    const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
    const fullShipAddr = formatAddr(ship.address, ship.city, ship.state, ship.pin);
    const isProfile = !!p.name;
    const coName = isProfile ? p.name : (co.name || '');
    const coAddr = isProfile ? formatAddr(p.address, p.city, p.state, p.pin) : formatAddr(co.address, co.city, co.state, co.pin);
    const coPan = isProfile ? (p.pan || '') : (co.pan || '');
    const coGst = isProfile ? (p.gst || '') : (co.gst || '');
    const coCin = isProfile ? (p.cin || '') : (co.cin || '');
    const orderDate = parseDate(row['Transaction Date']);
    const invDate = row['_invDate'] ? parseDate(row['_invDate']) : orderDate;
    const logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);
    return { merchantName, fullBillAddr, shipName, fullShipAddr, coName, coAddr, coPan, coGst, coCin, orderDate, invDate, logoSrc };
}

function withLineTax(gst: any) {
    return gst.lines.map((l: any) => {
        const enteredAmt = cleanNum(l.base);
        const net = parseFloat((enteredAmt / (1 + gst.rate / 100)).toFixed(2));
        const taxAmt = parseFloat((enteredAmt - net).toFixed(2));
        return { ...l, net, taxAmt, taxType: gst.isSame ? 'CGST+SGST' : 'IGST', lineTotal: enteredAmt };
    });
}

/* ═══════════════════════════════ HTML ═══════════════════════════════ */
export function buildInvoiceHTMLMerchant7(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:38px;max-width:150px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:18px;font-weight:800;">${esc(f.coName)}</span>`;

    const panel = (inner: string, extra = '') => `<div style="background:#f4f4f4;border-radius:10px;padding:14px 16px;margin-bottom:10px;${extra}">${inner}</div>`;

    const cell = (v: any, align = 'center') => `<td style="padding:6px 4px;text-align:${align};">${v}</td>`;
    const rowsHTML = lines.map((l: any, i: number) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#ececec'};">
        ${cell(i + 1)}${cell(esc(l.description || 'Item'), 'left')}${cell(cleanNum(l.unitPrice).toFixed(2))}
        ${cell(l.qty)}${cell(l.net.toFixed(2))}${cell(`${gst.rate}%`)}${cell(l.taxType)}
        ${cell(l.taxAmt.toFixed(2))}${cell(l.lineTotal.toFixed(2))}
      </tr>`).join('');

    return `<div style="background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;padding:18px;font-size:8.3pt;">

  ${panel(`
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>${logoBlockHTML}</div>
      <div style="text-align:right;">
        <div style="font-size:14pt;font-weight:800;">TAX INVOICE</div>
        <div style="font-size:7.3pt;color:#555;">Original for Recipient</div>
      </div>
    </div>
  `)}

  ${panel(`
    <div style="display:flex;justify-content:space-between;font-size:8pt;">
      <div><b>Invoice No.</b><br>${esc(invNum)}</div>
      <div><b>Invoice Date</b><br>${esc(f.invDate)}</div>
      <div><b>Order Date</b><br>${esc(f.orderDate)}</div>
    </div>
  `)}

  <div style="display:flex;gap:10px;">
    <div style="flex:1;">
      ${panel(`
        <div style="font-size:7pt;letter-spacing:.5px;text-transform:uppercase;color:#666;margin-bottom:3px;">Billing Address</div>
        <div style="font-weight:700;">${esc(f.merchantName)}</div>
        ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div style="font-size:7.8pt;">${esc(l)}</div>`).join('')}
      `, 'height:100%;box-sizing:border-box;')}
    </div>
    <div style="flex:1;">
      ${panel(`
        <div style="font-size:7pt;letter-spacing:.5px;text-transform:uppercase;color:#666;margin-bottom:3px;">Shipping Address</div>
        <div style="font-weight:700;">${esc(f.shipName)}</div>
        ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div style="font-size:7.8pt;">${esc(l)}</div>`).join('')}
      `, 'height:100%;box-sizing:border-box;')}
    </div>
  </div>

  <div style="background:#f4f4f4;border-radius:10px;padding:4px;margin-top:10px;overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;font-size:7.6pt;">
      <thead>
        <tr style="background:#222;color:#fff;">
          <th style="padding:7px 4px;border-radius:8px 0 0 0;">SI.No</th><th style="padding:7px 4px;text-align:left;">Description</th>
          <th style="padding:7px 4px;">Unit Price</th><th style="padding:7px 4px;">QTY</th><th style="padding:7px 4px;">Net Amount</th>
          <th style="padding:7px 4px;">Tax Rate</th><th style="padding:7px 4px;">Tax Type</th><th style="padding:7px 4px;">Tax Amount</th>
          <th style="padding:7px 4px;border-radius:0 8px 0 0;">Total</th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot>
        <tr style="background:#222;color:#fff;font-weight:700;">
          <td colspan="7" style="padding:7px;text-align:center;border-radius:0 0 0 8px;">GRAND TOTAL</td>
          <td style="padding:7px;text-align:center;">${totalTax.toFixed(2)}</td>
          <td style="padding:7px;text-align:center;border-radius:0 0 8px 0;">${totalAmt.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  ${panel(`<b>Amount in Words:</b> ${numWords(Math.round(totalAmt))}`, 'margin-top:10px;')}

  <div style="display:flex;gap:10px;">
    <div style="flex:1.4;">
      ${panel(`
        <div style="font-size:7pt;letter-spacing:.5px;text-transform:uppercase;color:#666;margin-bottom:2px;">Sold By</div>
        <div style="font-weight:700;">${esc(f.coName)}</div>
        ${splitAddrCommaLines(f.coAddr, 55).map(l => `<div style="font-size:7.6pt;">${esc(l)}</div>`).join('')}
      `)}
    </div>
    <div style="flex:1;">
      ${panel(`
        ${f.coPan ? `<div style="font-size:7.6pt;"><b>PAN:</b> ${esc(f.coPan)}</div>` : ''}
        ${f.coGst ? `<div style="font-size:7.6pt;"><b>GSTIN:</b> ${esc(f.coGst)}</div>` : ''}
        ${f.coCin ? `<div style="font-size:7.6pt;"><b>CIN:</b> ${esc(f.coCin)}</div>` : ''}
      `)}
    </div>
  </div>

</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant7(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 12, R = 198;
    let y = 14;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const panelFill = (yy: number, h: number) => { doc.setFillColor(244, 244, 244); doc.roundedRect(L, yy, R - L, h, 3, 3, 'F'); };

    panelFill(y, 20);
    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }
    doc.setTextColor(0, 0, 0);
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            doc.addImage(logoSrc, imgType, L + 5, y + 4, 38, 12, undefined, 'FAST');
        } catch (e) { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(f.coName, L + 5, y + 12); }
    } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(f.coName, L + 5, y + 12);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('TAX INVOICE', R - 5, y + 9, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('Original for Recipient', R - 5, y + 14, { align: 'right' });
    y += 24;

    panelFill(y, 15);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text('INVOICE NO.', L + 5, y + 5); doc.text('INVOICE DATE', 90, y + 5); doc.text('ORDER DATE', R - 5, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(invNum, L + 5, y + 11); doc.text(f.invDate || '-', 90, y + 11); doc.text(f.orderDate || '-', R - 5, y + 11, { align: 'right' });
    y += 19;

    const halfW = (R - L - 4) / 2;
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    const addrH = Math.max(billLines.length, shipLines.length) * 3.5 + 13;
    doc.setFillColor(244, 244, 244); doc.roundedRect(L, y, halfW, addrH, 3, 3, 'F'); doc.roundedRect(L + halfW + 4, y, halfW, addrH, 3, 3, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(90, 90, 90);
    doc.text('BILLING ADDRESS', L + 4, y + 5); doc.text('SHIPPING ADDRESS', L + halfW + 8, y + 5);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', L + 4, y + 10); doc.text(f.shipName || '-', L + halfW + 8, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
    billLines.forEach((ln, i) => doc.text(ln, L + 4, y + 14.5 + i * 3.5));
    shipLines.forEach((ln, i) => doc.text(ln, L + halfW + 8, y + 14.5 + i * 3.5));
    y += addrH + 4;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total']],
        body: lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)]),
        foot: [[{ content: 'GRAND TOTAL', colSpan: 7, styles: { halign: 'center' } }, fmtNum(totalTax), fmtNum(totalAmt)]],
        margin: { left: L, right: 12 },
        styles: { font: 'helvetica', fontSize: 6.6, cellPadding: 2, textColor: 20, valign: 'middle', lineColor: 255, lineWidth: 0 },
        headStyles: { fillColor: [34, 34, 34], textColor: 255, fontStyle: 'bold', fontSize: 6.6 },
        footStyles: { fillColor: [34, 34, 34], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [236, 236, 236] },
        columnStyles: {
            0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 42 },
            2: { halign: 'center', cellWidth: 20 }, 3: { halign: 'center', cellWidth: 12 },
            4: { halign: 'center', cellWidth: 22 }, 5: { halign: 'center', cellWidth: 16 },
            6: { halign: 'center', cellWidth: 18 }, 7: { halign: 'center', cellWidth: 22 },
            8: { halign: 'center', cellWidth: 22 },
        },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    doc.setFillColor(244, 244, 244); doc.roundedRect(L, y, R - L, 10, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(`Amount in Words: ${numWords(Math.round(totalAmt))}`, L + 5, y + 6.5);
    y += 14;

    const soldW = (R - L) * 0.6 - 2;
    const panW = (R - L) * 0.4 - 2;
    doc.setFillColor(244, 244, 244);
    doc.roundedRect(L, y, soldW, 26, 3, 3, 'F');
    doc.roundedRect(L + soldW + 4, y, panW, 26, 3, 3, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(90, 90, 90);
    doc.text('SOLD BY', L + 4, y + 5);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(f.coName || '', L + 4, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 55);
    doc.text(coAddrLines, L + 4, y + 14.5);

    let py = y + 6;
    doc.setFontSize(7.6);
    if (f.coPan) { doc.text(`PAN: ${f.coPan}`, L + soldW + 8, py); py += 4.5; }
    if (f.coGst) { doc.text(`GSTIN: ${f.coGst}`, L + soldW + 8, py); py += 4.5; }
    if (f.coCin) { doc.text(`CIN: ${f.coCin}`, L + soldW + 8, py); py += 4.5; }

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant7(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const PAGE_W = 9360;
    const itemWidths = [700, 2260, 1100, 700, 1200, 900, 1000, 1200, 1300];
    const fmtNum = (n: any) => cleanNum(n).toFixed(2);

    let body = '';
    body += wTableTheme(wTRTheme([f.coName, 'TAX INVOICE'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 12, shade: 'F4F4F4' }), PAGE_W);
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([`Invoice No.: ${invNum}`, `Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 8, shade: 'F4F4F4' }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['BILLING ADDRESS', 'SHIPPING ADDRESS'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7, shade: 'F4F4F4' }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 8, shade: 'F4F4F4' }
        ),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total'], itemWidths, { bold: true, size: 6.5, align: 'center', shade: '222222', color: 'FFFFFF' }) +
        lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)], itemWidths, { size: 6.5, align: 'center', shade: i % 2 === 0 ? 'FFFFFF' : 'ECECEC' })).join('') +
        wTRTheme(['GRAND TOTAL', '', '', '', '', '', '', fmtNum(totalTax), fmtNum(totalAmt)], itemWidths, { bold: true, size: 7, align: 'center', shade: '222222', color: 'FFFFFF' }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(wTRTheme([`Amount in Words: ${numWords(Math.round(totalAmt))}`], [PAGE_W], { bold: true, size: 8, shade: 'F4F4F4' }), PAGE_W);
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(
            [
                ['SOLD BY', f.coName, ...splitAddrCommaLines(f.coAddr, 55)].join('\n'),
                [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : '', f.coCin ? `CIN: ${f.coCin}` : ''].filter(Boolean).join('\n'),
            ],
            [PAGE_W * 0.6, PAGE_W * 0.4], { size: 8, shade: 'F4F4F4' }
        ),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}