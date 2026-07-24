// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant5.ts
// MERCHANT 5 — "Formal Letterhead / Statement" style. Strict
// black & white. Centered masthead with double rule, item table
// styled like a bank statement (row-separator lines only, no grid),
// boxed totals card, and a dual "For Seller / For Buyer" signature
// block — the most formal/traditional of all the templates so far.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

const fmtINR = (n: any) => '₹' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRs = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // PDF-safe

function splitAddrCommaLines(addr: string, maxLineLen = 50): string[] {
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
export function buildInvoiceHTMLMerchant5(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:46px;max-width:180px;object-fit:contain;filter:grayscale(1);margin-bottom:6px;" alt="logo">`
        : '';

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <tr>
        <td style="padding:7px 4px;border-bottom:1px solid #e0e0e0;text-align:center;">${i + 1}</td>
        <td style="padding:7px 4px;border-bottom:1px solid #e0e0e0;">${esc(l.description || 'Item')}</td>
        <td style="padding:7px 4px;border-bottom:1px solid #e0e0e0;text-align:right;">${cleanNum(l.unitPrice).toFixed(2)}</td>
        <td style="padding:7px 4px;border-bottom:1px solid #e0e0e0;text-align:center;">${l.qty}</td>
        <td style="padding:7px 4px;border-bottom:1px solid #e0e0e0;text-align:right;">${cleanNum(l.total).toFixed(2)}</td>
      </tr>`).join('');

    const totalsRows = gst.isSame
        ? `<tr><td style="padding:3px 10px;">Base Amount</td><td style="padding:3px 10px;text-align:right;">${fmtINR(gst.base)}</td></tr>
       <tr><td style="padding:3px 10px;">CGST @ ${gst.rate / 2}%</td><td style="padding:3px 10px;text-align:right;">${fmtINR(gst.cgst)}</td></tr>
       <tr><td style="padding:3px 10px;">SGST @ ${gst.rate / 2}%</td><td style="padding:3px 10px;text-align:right;">${fmtINR(gst.sgst)}</td></tr>`
        : `<tr><td style="padding:3px 10px;">Base Amount</td><td style="padding:3px 10px;text-align:right;">${fmtINR(gst.base)}</td></tr>
       <tr><td style="padding:3px 10px;">IGST @ ${gst.rate}%</td><td style="padding:3px 10px;text-align:right;">${fmtINR(gst.igst)}</td></tr>`;

    return `<div style="background:#fff;color:#000;font-family:'Georgia','Times New Roman',serif;padding:24px 30px;font-size:8.5pt;line-height:1.5;">

  <div style="text-align:center;">
    ${logoBlockHTML}
    <div style="font-size:14pt;font-weight:700;letter-spacing:1px;">${esc(f.coName)}</div>
    ${splitAddrCommaLines(f.coAddr, 70).map(l => `<div style="font-size:7.8pt;color:#333;">${esc(l)}</div>`).join('')}
    <div style="font-size:7.5pt;color:#555;margin-top:4px;">
      ${f.coGst ? `GSTIN: ${esc(f.coGst)}` : ''}${f.coGst && f.coPan ? ' &nbsp;•&nbsp; ' : ''}${f.coPan ? `PAN: ${esc(f.coPan)}` : ''}
    </div>
  </div>

  <div style="border-top:2px solid #000;margin-top:12px;"></div>
  <div style="border-top:1px solid #000;margin-top:2px;margin-bottom:14px;"></div>

  <div style="text-align:center;font-size:11pt;font-weight:700;letter-spacing:2px;margin-bottom:10px;">TAX INVOICE</div>

  <table style="width:100%;font-size:8pt;margin-bottom:14px;">
    <tr>
      <td style="width:33%;"><b>Invoice No.</b><br>${esc(invNum)}</td>
      <td style="width:33%;text-align:center;"><b>Invoice Date</b><br>${esc(f.invDate)}</td>
      <td style="width:34%;text-align:right;"><b>Order Date</b><br>${esc(f.orderDate)}</td>
    </tr>
  </table>

  <table style="width:100%;font-size:8pt;margin-bottom:14px;">
    <tr>
      <td style="width:50%;vertical-align:top;">
        <div style="font-weight:700;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:4px;">Billed To</div>
        <div><b>${esc(f.merchantName)}</b></div>
        ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
      </td>
      <td style="width:50%;vertical-align:top;padding-left:14px;">
        <div style="font-weight:700;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:4px;">Shipped To</div>
        <div><b>${esc(f.shipName)}</b></div>
        ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;font-size:8pt;">
    <thead>
      <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;">
        <th style="padding:6px 4px;">Sl.</th>
        <th style="padding:6px 4px;text-align:left;">Particulars</th>
        <th style="padding:6px 4px;text-align:right;">Rate</th>
        <th style="padding:6px 4px;">Qty</th>
        <th style="padding:6px 4px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-top:10px;">
    <table style="font-size:8pt;border:1px solid #000;min-width:230px;">
      ${totalsRows}
      <tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid #000;"></div></td></tr>
      <tr><td style="padding:5px 10px;font-weight:700;font-size:10pt;">Grand Total</td><td style="padding:5px 10px;text-align:right;font-weight:700;font-size:10pt;">${fmtINR(gst.total)}</td></tr>
    </table>
  </div>

  <div style="margin-top:14px;font-size:8pt;font-style:italic;">
    Amount in Words: ${words}
  </div>

  <table style="width:100%;font-size:8pt;margin-top:44px;">
    <tr>
      <td style="width:50%;text-align:center;">
        <div style="border-top:1px solid #000;padding-top:5px;display:inline-block;min-width:160px;">For ${esc(f.coName)}</div>
        <div style="font-size:7.3pt;color:#555;">Authorized Signatory</div>
      </td>
      <td style="width:50%;text-align:center;">
        <div style="border-top:1px solid #000;padding-top:5px;display:inline-block;min-width:160px;">Receiver's Signature</div>
        <div style="font-size:7.3pt;color:#555;">For ${esc(f.merchantName)}</div>
      </td>
    </tr>
  </table>

</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant5(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 18, R = 192;
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
            const props = doc.getImageProperties(logoSrc);
            const ratio = props?.width / props?.height || 3;
            const drawH = 14, drawW = Math.min(drawH * ratio, 60);
            doc.addImage(logoSrc, imgType, 105 - drawW / 2, y, drawW, drawH, undefined, 'FAST');
            y += drawH + 4;
        } catch (e) { /* ignore */ }
    }
    doc.setFont('times', 'bold'); doc.setFontSize(14);
    doc.text(f.coName, 105, y, { align: 'center' }); y += 5;
    doc.setFont('times', 'normal'); doc.setFontSize(7.8);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 70);
    coAddrLines.forEach(ln => { doc.text(ln, 105, y, { align: 'center' }); y += 3.6; });
    const idLine = [f.coGst ? `GSTIN: ${f.coGst}` : '', f.coPan ? `PAN: ${f.coPan}` : ''].filter(Boolean).join('   •   ');
    if (idLine) { doc.setFontSize(7.5); doc.text(idLine, 105, y, { align: 'center' }); y += 5; }

    doc.setLineWidth(0.6); doc.line(L, y, R, y); y += 1.2;
    doc.setLineWidth(0.25); doc.line(L, y, R, y); y += 8;

    doc.setFont('times', 'bold'); doc.setFontSize(12);
    doc.text('T A X   I N V O I C E', 105, y, { align: 'center' }); y += 8;

    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text(`Invoice No.\n${invNum}`, L, y);
    doc.text(`Invoice Date\n${f.invDate || '-'}`, 105, y, { align: 'center' });
    doc.text(`Order Date\n${f.orderDate || '-'}`, R, y, { align: 'right' });
    y += 10;

    const halfW = (R - L - 6) / 2;
    doc.setFont('times', 'bold'); doc.setFontSize(8);
    doc.text('Billed To', L, y);
    doc.text('Shipped To', L + halfW + 6, y);
    doc.setLineWidth(0.2);
    doc.line(L, y + 1.3, L + halfW, y + 1.3);
    doc.line(L + halfW + 6, y + 1.3, R, y + 1.3);
    y += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(8.5);
    doc.text(f.merchantName || '-', L, y);
    doc.text(f.shipName || '-', L + halfW + 6, y);
    y += 3.8;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    billLines.forEach((ln, i) => doc.text(ln, L, y + i * 3.8));
    shipLines.forEach((ln, i) => doc.text(ln, L + halfW + 6, y + i * 3.8));
    y += Math.max(billLines.length, shipLines.length) * 3.8 + 6;

    doc.setLineWidth(0.4); doc.line(L, y, R, y);
    y += 1.5; doc.setLineWidth(0.4); doc.line(L, y, R, y);
    y += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(8);
    doc.text('Sl.', L, y);
    doc.text('Particulars', L + 12, y);
    doc.text('Rate', L + 118, y, { align: 'right' });
    doc.text('Qty', L + 132, y, { align: 'center' });
    doc.text('Amount', R, y, { align: 'right' });
    y += 2;
    doc.setLineWidth(0.3); doc.line(L, y, R, y);
    y += 5;

    doc.setFont('times', 'normal'); doc.setFontSize(8);
    gst.lines.forEach((l: any, i: number) => {
        doc.text(String(i + 1), L, y);
        const descLines = doc.splitTextToSize(l.description || 'Item', 95);
        doc.text(descLines, L + 12, y);
        doc.text(cleanNum(l.unitPrice).toFixed(2), L + 118, y, { align: 'right' });
        doc.text(String(l.qty), L + 132, y, { align: 'center' });
        doc.text(cleanNum(l.total).toFixed(2), R, y, { align: 'right' });
        y += Math.max(descLines.length, 1) * 4.2;
        doc.setDrawColor(220); doc.setLineWidth(0.15); doc.line(L, y - 1.5, R, y - 1.5);
    });
    y += 4;

    const totalsX = R - 55;
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.rect(totalsX - 5, y - 4, 60, gst.isSame ? 26 : 20);
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text('Base Amount', totalsX, y); doc.text(fmtRs(gst.base), R, y, { align: 'right' }); y += 4.5;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.cgst), R, y, { align: 'right' }); y += 4.5;
        doc.text(`SGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.sgst), R, y, { align: 'right' }); y += 4.5;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, totalsX, y); doc.text(fmtRs(gst.igst), R, y, { align: 'right' }); y += 4.5;
    }
    doc.setLineWidth(0.3); doc.line(totalsX - 5, y, totalsX + 55, y); y += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(10);
    doc.text('Grand Total', totalsX, y); doc.text(fmtRs(gst.total), R, y, { align: 'right' }); y += 12;

    doc.setFont('times', 'italic'); doc.setFontSize(8);
    doc.text(`Amount in Words: ${numWords(Math.round(gst.total))}`, L, y);
    y += 30;

    const sigW = (R - L) / 2;
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(L + 10, y, L + sigW - 10, y);
    doc.line(L + sigW + 10, y, R - 10, y);
    y += 5;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text(`For ${f.coName}`, L + sigW / 2, y, { align: 'center' });
    doc.text(`Receiver's Signature`, L + sigW + sigW / 2, y, { align: 'center' });
    y += 4;
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text('Authorized Signatory', L + sigW / 2, y, { align: 'center' });
    doc.text(`For ${f.merchantName}`, L + sigW + sigW / 2, y, { align: 'center' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant5(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;
    const itemWidths = [900, 4560, 1500, 900, 1500];

    let body = '';
    body += wPTheme(f.coName, { bold: true, size: 14, align: 'center' });
    body += wPTheme(splitAddrCommaLines(f.coAddr, 70).join('\n'), { size: 8, align: 'center' });
    const idLine = [f.coGst ? `GSTIN: ${f.coGst}` : '', f.coPan ? `PAN: ${f.coPan}` : ''].filter(Boolean).join('   •   ');
    if (idLine) body += wPTheme(idLine, { size: 7.5, align: 'center' });
    body += wPTheme('');
    body += wPTheme('T A X   I N V O I C E', { bold: true, size: 12, align: 'center' });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme([`Invoice No.: ${invNum}`, `Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 8 }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['Billed To', 'Shipped To'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 8 }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['Sl.', 'Particulars', 'Rate', 'Qty', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center' }) +
        gst.lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', cleanNum(l.unitPrice).toFixed(2), String(l.qty), cleanNum(l.total).toFixed(2)], itemWidths, { size: 8, align: 'center' })).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(`Base Amount: ${fmtRs(gst.base)}`, { size: 8.5, align: 'right' });
    if (gst.isSame) {
        body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtRs(gst.cgst)}`, { size: 8.5, align: 'right' });
        body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtRs(gst.sgst)}`, { size: 8.5, align: 'right' });
    } else {
        body += wPTheme(`IGST @ ${gst.rate}%: ${fmtRs(gst.igst)}`, { size: 8.5, align: 'right' });
    }
    body += wPTheme(`Grand Total: ${fmtRs(gst.total)}`, { bold: true, size: 12, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 8 });
    body += wPTheme('');
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme([`For ${f.coName}`, `Receiver's Signature`], [PAGE_W / 2, PAGE_W / 2], { align: 'center', size: 8 }) +
        wTRTheme(['Authorized Signatory', `For ${f.merchantName}`], [PAGE_W / 2, PAGE_W / 2], { align: 'center', size: 7 }),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}