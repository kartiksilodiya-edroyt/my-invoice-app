// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant3.ts
// MERCHANT 3 — "Compact Slip" style. Strict black & white. No
// table borders at all — dotted rules between sections, condensed
// receipt-like feel, right-aligned masthead, monospace-ish item
// list with tab-aligned numeric columns.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';

// Courier New (both browser and jsPDF's built-in "courier" font) lacks a
// ₹ glyph — it renders as a broken superscript mark. "Rs." is safe.
const fmtINR = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { wPTheme, wTRTheme, wTableTheme } from './builder';

function splitAddrCommaLines(addr: string, maxLineLen = 48): string[] {
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
export function buildInvoiceHTMLMerchant3(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:36px;max-width:140px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:17px;font-weight:800;letter-spacing:.5px;">${esc(f.coName)}</span>`;

    const dot = `<div style="border-top:1px dotted #000;margin:10px 0;"></div>`;

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:8pt;">
        <div style="flex:1;padding-right:8px;">${i + 1}. ${esc(l.description || 'Item')} <span style="color:#555;">(x${l.qty} @ ${cleanNum(l.unitPrice).toFixed(2)})</span></div>
        <div style="white-space:nowrap;font-weight:700;">${cleanNum(l.total).toFixed(2)}</div>
      </div>`).join('');

    const totalsRows = gst.isSame
        ? `<div style="display:flex;justify-content:space-between;font-size:8pt;padding:1px 0;"><span>Base Amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;padding:1px 0;"><span>CGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.cgst)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;padding:1px 0;"><span>SGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.sgst)}</span></div>`
        : `<div style="display:flex;justify-content:space-between;font-size:8pt;padding:1px 0;"><span>Base Amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;padding:1px 0;"><span>IGST @ ${gst.rate}%</span><span>${fmtINR(gst.igst)}</span></div>`;

    return `<div style="background:#fff;color:#000;font-family:'Courier New',monospace;padding:20px 24px;font-size:8.5pt;max-width:520px;margin:0 auto;">
  <div style="text-align:center;">
    ${logoBlockHTML}
    <div style="font-size:12pt;font-weight:800;letter-spacing:3px;margin-top:6px;">TAX INVOICE</div>
    <div style="font-size:7.5pt;">(Original for Recipient)</div>
  </div>
  ${dot}
  <div style="display:flex;justify-content:space-between;font-size:8pt;">
    <div>Invoice No.<br><b>${esc(invNum)}</b></div>
    <div style="text-align:center;">Invoice Date<br><b>${esc(f.invDate)}</b></div>
    <div style="text-align:right;">Order Date<br><b>${esc(f.orderDate)}</b></div>
  </div>
  ${dot}
  <div style="font-size:8pt;">
    <div><b>BILL TO</b></div>
    <div>${esc(f.merchantName)}</div>
    ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
  </div>
  <div style="font-size:8pt;margin-top:8px;">
    <div><b>SHIP TO</b></div>
    <div>${esc(f.shipName)}</div>
    ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
  </div>
  ${dot}
  ${rowsHTML}
  ${dot}
  ${totalsRows}
  <div style="border-top:1px solid #000;margin-top:5px;padding-top:5px;display:flex;justify-content:space-between;font-size:11pt;font-weight:800;">
    <span>TOTAL</span><span>${fmtINR(gst.total)}</span>
  </div>
  ${dot}
  <div style="font-size:7.8pt;">Amount in Words: <b>${words}</b></div>
  ${dot}
  <div style="font-size:7.5pt;text-align:center;">
    <div><b>${esc(f.coName)}</b></div>
    ${splitAddrCommaLines(f.coAddr, 60).map(l => `<div>${esc(l)}</div>`).join('')}
    <div style="margin-top:4px;">
      ${f.coPan ? `PAN: ${esc(f.coPan)} &nbsp;|&nbsp; ` : ''}${f.coGst ? `GSTIN: ${esc(f.coGst)}` : ''}
    </div>
    ${f.coCin ? `<div>CIN: ${esc(f.coCin)}</div>` : ''}
  </div>
  ${dot}
  <div style="text-align:center;font-size:7.5pt;">Thank you for your business</div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant3(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 60, R = 150; // narrow, centered "slip" column
    let y = 18;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }
    doc.setTextColor(0, 0, 0);
    doc.setFont('courier', 'bold'); doc.setFontSize(9);
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            doc.addImage(logoSrc, imgType, 90, y - 6, 30, 10, undefined, 'FAST');
            y += 8;
        } catch (e) { doc.text(f.coName, 105, y, { align: 'center' }); }
    } else {
        doc.text(f.coName, 105, y, { align: 'center' });
    }
    y += 6;
    doc.setFont('courier', 'bold'); doc.setFontSize(13);
    doc.text('T A X   I N V O I C E', 105, y, { align: 'center' });
    y += 4.5;
    doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
    doc.text('(Original for Recipient)', 105, y, { align: 'center' });
    y += 4;

    const dotLine = (yy: number) => { doc.setLineDashPattern([0.7, 0.7], 0); doc.setLineWidth(0.2); doc.line(L, yy, R, yy); doc.setLineDashPattern([], 0); };
    dotLine(y); y += 6;

    doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
    doc.text('Invoice No.', L, y);
    doc.text('Invoice Date', 105, y, { align: 'center' });
    doc.text('Order Date', R, y, { align: 'right' });
    y += 4;
    doc.setFont('courier', 'bold'); doc.setFontSize(8);
    doc.text(invNum, L, y);
    doc.text(f.invDate || '-', 105, y, { align: 'center' });
    doc.text(f.orderDate || '-', R, y, { align: 'right' });
    y += 6;
    dotLine(y); y += 6;

    doc.setFont('courier', 'bold'); doc.setFontSize(7.5);
    doc.text('BILL TO', L, y); y += 4;
    doc.setFont('courier', 'normal'); doc.setFontSize(7.8);
    doc.text(f.merchantName || '-', L, y); y += 3.6;
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    doc.text(billLines, L, y); y += billLines.length * 3.6 + 4;

    doc.setFont('courier', 'bold'); doc.setFontSize(7.5);
    doc.text('SHIP TO', L, y); y += 4;
    doc.setFont('courier', 'normal'); doc.setFontSize(7.8);
    doc.text(f.shipName || '-', L, y); y += 3.6;
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    doc.text(shipLines, L, y); y += shipLines.length * 3.6 + 4;

    dotLine(y); y += 6;

    doc.setFont('courier', 'normal'); doc.setFontSize(7.8);
    gst.lines.forEach((l: any, i: number) => {
        const desc = `${i + 1}. ${l.description || 'Item'} (x${l.qty} @ ${cleanNum(l.unitPrice).toFixed(2)})`;
        const wrapped = doc.splitTextToSize(desc, 62);
        doc.text(wrapped, L, y);
        doc.setFont('courier', 'bold');
        doc.text(cleanNum(l.total).toFixed(2), R, y, { align: 'right' });
        doc.setFont('courier', 'normal');
        y += wrapped.length * 3.6 + 1.5;
    });
    dotLine(y); y += 6;

    doc.setFont('courier', 'normal'); doc.setFontSize(8);
    doc.text('Base Amount', L, y); doc.text(fmtINR(gst.base), R, y, { align: 'right' }); y += 4.2;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, L, y); doc.text(fmtINR(gst.cgst), R, y, { align: 'right' }); y += 4.2;
        doc.text(`SGST @ ${gst.rate / 2}%`, L, y); doc.text(fmtINR(gst.sgst), R, y, { align: 'right' }); y += 4.2;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, L, y); doc.text(fmtINR(gst.igst), R, y, { align: 'right' }); y += 4.2;
    }
    doc.setLineWidth(0.5); doc.line(L, y, R, y); y += 5;
    doc.setFont('courier', 'bold'); doc.setFontSize(11);
    doc.text('TOTAL', L, y); doc.text(fmtINR(gst.total), R, y, { align: 'right' }); y += 8;

    dotLine(y); y += 5;
    doc.setFont('courier', 'normal'); doc.setFontSize(7.8);
    const wl = doc.splitTextToSize(`Amount in Words: ${numWords(Math.round(gst.total))}`, R - L);
    doc.text(wl, L, y); y += wl.length * 3.6 + 4;

    dotLine(y); y += 6;
    doc.setFont('courier', 'bold'); doc.setFontSize(7.8);
    doc.text(f.coName || '', 105, y, { align: 'center' }); y += 4;
    doc.setFont('courier', 'normal'); doc.setFontSize(7.2);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 60);
    coAddrLines.forEach((ln, i) => doc.text(ln, 105, y + i * 3.4, { align: 'center' }));
    y += coAddrLines.length * 3.4 + 2;
    const idLine = [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : ''].filter(Boolean).join('   |   ');
    if (idLine) { doc.text(idLine, 105, y, { align: 'center' }); y += 3.6; }
    if (f.coCin) { doc.text(`CIN: ${f.coCin}`, 105, y, { align: 'center' }); y += 3.6; }

    y += 3;
    dotLine(y); y += 5;
    doc.setFont('courier', 'italic'); doc.setFontSize(7.5);
    doc.text('Thank you for your business', 105, y, { align: 'center' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant3(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;

    let body = '';
    body += wPTheme(f.coName, { bold: true, size: 11, align: 'center' });
    body += wPTheme('T A X   I N V O I C E', { bold: true, size: 14, align: 'center' });
    body += wPTheme('(Original for Recipient)', { size: 8, align: 'center' });
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([`Invoice No.: ${invNum}`, `Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 8 }),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme('BILL TO', { bold: true, size: 7.8 });
    body += wPTheme([f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), { size: 8 });
    body += wPTheme('');
    body += wPTheme('SHIP TO', { bold: true, size: 7.8 });
    body += wPTheme([f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n'), { size: 8 });
    body += wPTheme('');
    gst.lines.forEach((l: any, i: number) => {
        body += wPTheme(`${i + 1}. ${l.description || 'Item'} (x${l.qty} @ ${cleanNum(l.unitPrice).toFixed(2)}) — ${cleanNum(l.total).toFixed(2)}`, { size: 8 });
    });
    body += wPTheme('');
    body += wPTheme(`Base Amount: ${fmtINR(gst.base)}`, { size: 8.5, align: 'right' });
    if (gst.isSame) {
        body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 8.5, align: 'right' });
        body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 8.5, align: 'right' });
    } else {
        body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 8.5, align: 'right' });
    }
    body += wPTheme(`TOTAL: ${fmtINR(gst.total)}`, { bold: true, size: 12, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 8 });
    body += wPTheme('');
    body += wPTheme(f.coName, { bold: true, size: 9, align: 'center' });
    body += wPTheme(splitAddrCommaLines(f.coAddr, 60).join('\n'), { size: 7.5, align: 'center' });
    const idLine = [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : ''].filter(Boolean).join('   |   ');
    if (idLine) body += wPTheme(idLine, { size: 7.5, align: 'center' });
    if (f.coCin) body += wPTheme(`CIN: ${f.coCin}`, { size: 7.5, align: 'center' });
    body += wPTheme('');
    body += wPTheme('Thank you for your business', { size: 7.5, align: 'center' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}