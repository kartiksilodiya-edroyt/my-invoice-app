// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant1.ts
// MERCHANT 1 — "Ledger" style. Strict black & white. No boxed
// table grid — sections separated by horizontal rules only, like
// a classic accounting ledger. Totals shown as a Base/GST breakdown
// block (not per-line tax columns) under the item table.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';

import { wPTheme, wTRTheme, wTableTheme } from './builder';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';

const fmtINR = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function splitAddrCommaLines(addr: string, maxLineLen = 55): string[] {
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

/* ═══════════════════════════════ HTML ═══════════════════════════════ */
export function buildInvoiceHTMLMerchant1(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:42px;max-width:160px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:20px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${esc(f.coName)}</span>`;

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <tr>
        <td style="padding:6px 4px;border-bottom:1px solid #ccc;text-align:center;">${i + 1}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #ccc;">${esc(l.description || 'Item')}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #ccc;text-align:right;">${cleanNum(l.unitPrice).toFixed(2)}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #ccc;text-align:center;">${l.qty}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #ccc;text-align:right;">${cleanNum(l.total).toFixed(2)}</td>
      </tr>`).join('');

    const totalsRows = gst.isSame
        ? `<tr><td style="padding:2px 0;">Base Amount</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.base)}</td></tr>
           <tr><td style="padding:2px 0;">CGST @ ${gst.rate / 2}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.cgst)}</td></tr>
           <tr><td style="padding:2px 0;">SGST @ ${gst.rate / 2}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.sgst)}</td></tr>`
        : `<tr><td style="padding:2px 0;">Base Amount</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.base)}</td></tr>
           <tr><td style="padding:2px 0;">IGST @ ${gst.rate}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.igst)}</td></tr>`;

    return `<div style="background:#fff;color:#000;font-family:'Georgia','Times New Roman',serif;padding:22px 26px;font-size:8.5pt;line-height:1.5;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:10px;">
    <div>${logoBlockHTML}<div style="font-size:8.5pt;margin-top:4px;">Tax Invoice &nbsp;•&nbsp; Original for Recipient</div></div>
    <div style="text-align:right;font-size:8pt;line-height:1.7;">
      <div><b>Invoice No.</b> ${esc(invNum)}</div>
      <div><b>Invoice Date</b> ${esc(f.invDate)}</div>
      <div><b>Order Date</b> ${esc(f.orderDate)}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:8pt;">
    <div style="flex:1;max-width:48%;">
      <div style="text-transform:uppercase;letter-spacing:1px;font-size:7.5pt;border-bottom:1px solid #000;margin-bottom:4px;">Bill To</div>
      <div><b>${esc(f.merchantName)}</b></div>
      ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
    <div style="flex:1;max-width:48%;text-align:right;">
      <div style="text-transform:uppercase;letter-spacing:1px;font-size:7.5pt;border-bottom:1px solid #000;margin-bottom:4px;">Ship To</div>
      <div><b>${esc(f.shipName)}</b></div>
      ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:8pt;table-layout:fixed;">
    <colgroup><col style="width:8%;"><col style="width:50%;"><col style="width:14%;"><col style="width:10%;"><col style="width:18%;"></colgroup>
    <thead><tr style="border-top:2px solid #000;border-bottom:1px solid #000;">
      <th style="padding:6px 4px;text-align:center;">#</th>
      <th style="padding:6px 4px;text-align:left;">Description</th>
      <th style="padding:6px 4px;text-align:right;">Rate</th>
      <th style="padding:6px 4px;text-align:center;">Qty</th>
      <th style="padding:6px 4px;text-align:right;">Amount</th>
    </tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-top:8px;">
    <table style="font-size:8pt;min-width:220px;">
      ${totalsRows}
      <tr><td colspan="2"><div style="border-top:1.5px solid #000;margin:4px 0;"></div></td></tr>
      <tr><td style="padding:2px 0;font-weight:700;font-size:9.5pt;">Total</td><td style="padding:2px 0;text-align:right;font-weight:700;font-size:9.5pt;">${fmtINR(gst.total)}</td></tr>
    </table>
  </div>

  <div style="margin-top:14px;font-size:8pt;border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;">
    Amount in Words: <b>${words}</b>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:26px;font-size:7.8pt;">
    <div>
      <div style="font-size:7pt;letter-spacing:1px;text-transform:uppercase;">Sold By</div>
      <div><b>${esc(f.coName)}</b></div>
      ${splitAddrCommaLines(f.coAddr).map(l => `<div>${esc(l)}</div>`).join('')}
      ${f.coPan ? `<div>PAN: ${esc(f.coPan)}</div>` : ''}
      ${f.coGst ? `<div>GSTIN: ${esc(f.coGst)}</div>` : ''}
      ${f.coCin ? `<div>CIN: ${esc(f.coCin)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div style="height:36px;"></div>
      <div style="border-top:1px solid #000;padding-top:4px;min-width:150px;display:inline-block;">Authorized Signatory</div>
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant1(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 16, R = 194;
    let y = 18;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

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
            doc.addImage(logoSrc, imgType, L, y - 6, 45, 14, undefined, 'FAST');
        } catch (e) { doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(f.coName, L, y); }
    } else {
        doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(f.coName, L, y);
    }
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text('Tax Invoice  •  Original for Recipient', L, y + 10);

    let ry = y - 6;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text(`Invoice No. ${invNum}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Invoice Date ${f.invDate || '-'}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Order Date ${f.orderDate || '-'}`, R, ry, { align: 'right' }); ry += 4;

    y += 14;
    doc.setDrawColor(0); doc.setLineWidth(0.5);
    doc.line(L, y, R, y);
    y += 8;

    doc.setFont('times', 'italic'); doc.setFontSize(7.5);
    doc.text('BILL TO', L, y);
    doc.text('SHIP TO', R, y, { align: 'right' });
    y += 1.5;
    doc.setLineWidth(0.2);
    doc.line(L, y, L + 80, y);
    doc.line(R - 80, y, R, y);
    y += 5;

    doc.setFont('times', 'bold'); doc.setFontSize(8.5);
    doc.text(f.merchantName || '-', L, y);
    doc.text(f.shipName || '-', R, y, { align: 'right' });
    y += 4;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    billLines.forEach((ln, i) => doc.text(ln, L, y + i * 3.8));
    shipLines.forEach((ln, i) => doc.text(ln, R, y + i * 3.8, { align: 'right' }));
    y += Math.max(billLines.length, shipLines.length) * 3.8 + 6;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['#', 'Description', 'Rate', 'Qty', 'Amount']],
        body: gst.lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.total)]),
        margin: { left: L, right: 16 },
        theme: 'plain',
        styles: { font: 'times', fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, textColor: 0, lineColor: 200, lineWidth: { bottom: 0.2 } },
        headStyles: { fontStyle: 'bold', lineWidth: { top: 0.5, bottom: 0.3 } },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 90 }, 2: { halign: 'center', cellWidth: 26 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 34 } },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    const totalsX = R - 55;
    doc.setFont('times', 'normal'); doc.setFontSize(8.5);
    doc.text('Base Amount', totalsX, y); doc.text(fmtINR(gst.base), R, y, { align: 'right' }); y += 4.5;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtINR(gst.cgst), R, y, { align: 'right' }); y += 4.5;
        doc.text(`SGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtINR(gst.sgst), R, y, { align: 'right' }); y += 4.5;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, totalsX, y); doc.text(fmtINR(gst.igst), R, y, { align: 'right' }); y += 4.5;
    }
    doc.setLineWidth(0.4); doc.line(totalsX, y, R, y); y += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(11);
    doc.text('Total', totalsX, y); doc.text(fmtINR(gst.total), R, y, { align: 'right' }); y += 10;

    doc.setDrawColor(150);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(L, y, R, y); y += 5;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text(`Amount in Words: ${numWords(Math.round(gst.total))}`, L, y); y += 4;
    doc.line(L, y, R, y);
    doc.setLineDashPattern([], 0);
    y += 14;

    doc.setFont('times', 'italic'); doc.setFontSize(7);
    doc.text('SOLD BY', L, y); y += 4;
    doc.setFont('times', 'bold'); doc.setFontSize(8.5);
    doc.text(f.coName || '', L, y); y += 4;
    doc.setFont('times', 'normal'); doc.setFontSize(7.8);
    const coAddrLines = splitAddrCommaLines(f.coAddr);
    doc.text(coAddrLines, L, y); y += coAddrLines.length * 3.6;
    if (f.coPan) { doc.text(`PAN: ${f.coPan}`, L, y); y += 3.6; }
    if (f.coGst) { doc.text(`GSTIN: ${f.coGst}`, L, y); y += 3.6; }
    if (f.coCin) { doc.text(`CIN: ${f.coCin}`, L, y); y += 3.6; }

    const ph = doc.internal.pageSize.height;
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(R - 50, ph - 18, R, ph - 18);
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text('Authorized Signatory', R, ph - 13, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant1(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;
    const itemWidths = [900, 4560, 1500, 900, 1500];

    let body = '';
    body += wPTheme(f.coName, { bold: true, size: 15 });
    body += wPTheme('Tax Invoice  •  Original for Recipient', { size: 8 });
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([`Invoice No.: ${invNum}`, `Invoice Date: ${f.invDate}`], [PAGE_W / 2, PAGE_W / 2], { size: 8 }) +
        wTRTheme([`Order Date: ${f.orderDate}`, ''], [PAGE_W / 2, PAGE_W / 2], { size: 8 }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['BILL TO', 'SHIP TO'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7.5 }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['#', 'Description', 'Rate', 'Qty', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center' }) +
        gst.lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', fmtINR(l.unitPrice), String(l.qty), fmtINR(l.total)], itemWidths, { size: 8, align: 'center' })).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(`Base Amount: ${fmtINR(gst.base)}`, { size: 8.5, align: 'right' });
    if (gst.isSame) {
        body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 8.5, align: 'right' });
        body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 8.5, align: 'right' });
    } else {
        body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 8.5, align: 'right' });
    }
    body += wPTheme(`Total: ${fmtINR(gst.total)}`, { bold: true, size: 11, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 8 });
    body += wPTheme('');
    body += wPTheme('SOLD BY', { bold: true, size: 7 });
    body += wPTheme(f.coName, { bold: true, size: 9 });
    body += wPTheme(splitAddrCommaLines(f.coAddr).join('\n'), { size: 7.8 });
    if (f.coPan) body += wPTheme(`PAN: ${f.coPan}`, { size: 7.8 });
    if (f.coGst) body += wPTheme(`GSTIN: ${f.coGst}`, { size: 7.8 });
    if (f.coCin) body += wPTheme(`CIN: ${f.coCin}`, { size: 7.8 });
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 8, align: 'right' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}