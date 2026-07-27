// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant8.ts
// MERCHANT 8 — "Newspaper Column" style. Strict black & white.
// Editorial masthead (large serif title, thick top rule, thin rule
// below), content split into two columns by a vertical rule (like
// a newspaper page), item table spans full width beneath.
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

const fmtINR = (n: any) => '₹' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRs = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function splitAddrCommaLines(addr: string, maxLineLen = 40): string[] {
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
export function buildInvoiceHTMLMerchant8(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:34px;max-width:130px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : '';

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <tr>
        <td style="padding:6px 4px;border-bottom:1px solid #999;text-align:center;">${i + 1}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #999;">${esc(l.description || 'Item')}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #999;text-align:right;">${cleanNum(l.unitPrice).toFixed(2)}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #999;text-align:center;">${l.qty}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #999;text-align:right;">${cleanNum(l.total).toFixed(2)}</td>
      </tr>`).join('');

    const totalsRows = gst.isSame
        ? `<tr><td style="padding:2px 0;">Base Amount</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.base)}</td></tr>
       <tr><td style="padding:2px 0;">CGST @ ${gst.rate / 2}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.cgst)}</td></tr>
       <tr><td style="padding:2px 0;">SGST @ ${gst.rate / 2}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.sgst)}</td></tr>`
        : `<tr><td style="padding:2px 0;">Base Amount</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.base)}</td></tr>
       <tr><td style="padding:2px 0;">IGST @ ${gst.rate}%</td><td style="padding:2px 0;text-align:right;">${fmtINR(gst.igst)}</td></tr>`;

    return `<div style="background:#fff;color:#000;font-family:'Georgia','Times New Roman',serif;padding:22px 26px;font-size:8.3pt;line-height:1.45;">

  <div style="text-align:center;border-top:4px solid #000;border-bottom:1px solid #000;padding:10px 0;">
    ${logoBlockHTML}
    <div style="font-size:24px;font-weight:800;letter-spacing:4px;">TAX INVOICE</div>
    <div style="font-size:7.5pt;letter-spacing:1px;color:#444;">ORIGINAL FOR RECIPIENT &nbsp;—&nbsp; ISSUE NO. ${esc(invNum)}</div>
  </div>

  <div style="display:flex;justify-content:space-between;font-size:7.8pt;margin-top:8px;padding-bottom:8px;border-bottom:1px solid #000;">
    <div>Invoice Date: <b>${esc(f.invDate)}</b></div>
    <div>Order Date: <b>${esc(f.orderDate)}</b></div>
  </div>

  <div style="display:flex;margin-top:14px;">
    <div style="flex:1;padding-right:14px;font-size:8pt;">
      <div style="font-weight:700;text-transform:uppercase;font-size:7.5pt;border-bottom:2px solid #000;padding-bottom:2px;margin-bottom:5px;">Bill To</div>
      <div style="font-weight:700;">${esc(f.merchantName)}</div>
      ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
      <div style="height:10px;"></div>
      <div style="font-weight:700;text-transform:uppercase;font-size:7.5pt;border-bottom:2px solid #000;padding-bottom:2px;margin-bottom:5px;">Ship To</div>
      <div style="font-weight:700;">${esc(f.shipName)}</div>
      ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
    <div style="width:1px;background:#000;"></div>
    <div style="flex:1;padding-left:14px;font-size:8pt;">
      <div style="font-weight:700;text-transform:uppercase;font-size:7.5pt;border-bottom:2px solid #000;padding-bottom:2px;margin-bottom:5px;">Amount Due</div>
      ${totalsRows.replace(/<tr>/g, '<div style="display:flex;justify-content:space-between;">').replace(/<\/tr>/g, '</div>').replace(/<td[^>]*>/g, '<span>').replace(/<\/td>/g, '</span>')}
      <div style="border-top:2px solid #000;margin-top:6px;padding-top:5px;display:flex;justify-content:space-between;font-size:12pt;font-weight:800;">
        <span>Total</span><span>${fmtINR(gst.total)}</span>
      </div>
      <div style="margin-top:10px;font-size:7.5pt;font-style:italic;">Amount in Words: ${words}</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:8pt;">
    <thead><tr style="border-top:2px solid #000;border-bottom:1px solid #000;">
      <th style="padding:6px 4px;">#</th>
      <th style="padding:6px 4px;text-align:left;">Description</th>
      <th style="padding:6px 4px;text-align:right;">Rate</th>
      <th style="padding:6px 4px;">Qty</th>
      <th style="padding:6px 4px;text-align:right;">Amount</th>
    </tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div style="display:flex;justify-content:space-between;margin-top:26px;padding-top:8px;border-top:4px solid #000;font-size:7.5pt;">
    <div>
      <b>${esc(f.coName)}</b><br>
      ${splitAddrCommaLines(f.coAddr, 60).map(l => `${esc(l)}<br>`).join('')}
      ${f.coPan ? `PAN: ${esc(f.coPan)} &nbsp; ` : ''}${f.coGst ? `GSTIN: ${esc(f.coGst)}` : ''}${f.coCin ? `<br>CIN: ${esc(f.coCin)}` : ''}
    </div>
    <div style="text-align:right;align-self:flex-end;">
      <div style="border-top:1px solid #000;padding-top:3px;min-width:140px;">Authorized Signatory</div>
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant8(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 16, R = 194;
    let y = 16;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

    doc.setDrawColor(0); doc.setLineWidth(1.2); doc.line(L, y, R, y); y += 6;

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
            doc.addImage(logoSrc, imgType, 105 - 15, y, 30, 10, undefined, 'FAST');
            y += 13;
        } catch (e) { /* ignore */ }
    }
    doc.setFont('times', 'bold'); doc.setFontSize(22);
    doc.text('T A X   I N V O I C E', 105, y, { align: 'center' }); y += 5;
    doc.setFont('times', 'normal'); doc.setFontSize(7.5);
    doc.text(`ORIGINAL FOR RECIPIENT  —  ISSUE NO. ${invNum}`, 105, y, { align: 'center' }); y += 4;
    doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 6;

    doc.setFontSize(7.8);
    doc.text(`Invoice Date: ${f.invDate || '-'}`, L, y);
    doc.text(`Order Date: ${f.orderDate || '-'}`, R, y, { align: 'right' });
    y += 3;
    doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 8;

    const midX = 105;
    const colW = midX - L - 6;
    doc.setLineWidth(0.2); doc.line(midX, y - 2, midX, y + 55);

    let ly = y;
    doc.setFont('times', 'bold'); doc.setFontSize(7.5);
    doc.text('BILL TO', L, ly);
    doc.setLineWidth(0.5); doc.line(L, ly + 1.3, L + colW, ly + 1.3);
    ly += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', L, ly); ly += 3.8;
    doc.setFont('times', 'normal'); doc.setFontSize(7.8);
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    doc.text(billLines, L, ly); ly += billLines.length * 3.6 + 6;

    doc.setFont('times', 'bold'); doc.setFontSize(7.5);
    doc.text('SHIP TO', L, ly);
    doc.setLineWidth(0.5); doc.line(L, ly + 1.3, L + colW, ly + 1.3);
    ly += 5;
    doc.setFont('times', 'bold'); doc.setFontSize(8);
    doc.text(f.shipName || '-', L, ly); ly += 3.8;
    doc.setFont('times', 'normal'); doc.setFontSize(7.8);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    doc.text(shipLines, L, ly); ly += shipLines.length * 3.6;

    let ry = y;
    doc.setFont('times', 'bold'); doc.setFontSize(7.5);
    doc.text('AMOUNT DUE', midX + 6, ry);
    doc.setLineWidth(0.5); doc.line(midX + 6, ry + 1.3, R, ry + 1.3);
    ry += 6;
    doc.setFont('times', 'normal'); doc.setFontSize(8);
    doc.text('Base Amount', midX + 6, ry); doc.text(fmtRs(gst.base), R, ry, { align: 'right' }); ry += 4.5;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, midX + 6, ry); doc.text(fmtRs(gst.cgst), R, ry, { align: 'right' }); ry += 4.5;
        doc.text(`SGST @ ${gst.rate / 2}%`, midX + 6, ry); doc.text(fmtRs(gst.sgst), R, ry, { align: 'right' }); ry += 4.5;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, midX + 6, ry); doc.text(fmtRs(gst.igst), R, ry, { align: 'right' }); ry += 4.5;
    }
    doc.setLineWidth(0.5); doc.line(midX + 6, ry, R, ry); ry += 6;
    doc.setFont('times', 'bold'); doc.setFontSize(12);
    doc.text('Total', midX + 6, ry); doc.text(fmtRs(gst.total), R, ry, { align: 'right' }); ry += 10;
    doc.setFont('times', 'italic'); doc.setFontSize(7.5);
    const wl = doc.splitTextToSize(`Amount in Words: ${numWords(Math.round(gst.total))}`, R - midX - 6);
    doc.text(wl, midX + 6, ry); ry += wl.length * 3.6;

    y = Math.max(ly, ry) + 10;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['#', 'Description', 'Rate', 'Qty', 'Amount']],
        body: gst.lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.total)]),
        margin: { left: L, right: 16 },
        theme: 'plain',
        styles: { font: 'times', fontSize: 8, cellPadding: 2.2, textColor: 0, lineColor: 150, lineWidth: { bottom: 0.2 } },
        headStyles: { fontStyle: 'bold', lineWidth: { top: 0.6, bottom: 0.3 } },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 92 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 32 } },
    });
    y = (doc as any).lastAutoTable.finalY + 12;

    doc.setLineWidth(1.2); doc.line(L, y, R, y); y += 6;
    doc.setFont('times', 'bold'); doc.setFontSize(8);
    doc.text(f.coName, L, y); y += 4;
    doc.setFont('times', 'normal'); doc.setFontSize(7.5);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 60);
    doc.text(coAddrLines, L, y); y += coAddrLines.length * 3.4;
    const idLine = [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : ''].filter(Boolean).join('   ');
    if (idLine) { doc.text(idLine, L, y); y += 3.6; }
    if (f.coCin) doc.text(`CIN: ${f.coCin}`, L, y);

    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(R - 45, y - 8, R, y - 8);
    doc.setFontSize(7.5);
    doc.text('Authorized Signatory', R, y - 4, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant8(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;
    const itemWidths = [900, 4560, 1500, 900, 1500];

    let body = '';
    body += wPTheme('T A X   I N V O I C E', { bold: true, size: 22, align: 'center' });
    body += wPTheme(`ORIGINAL FOR RECIPIENT — ISSUE NO. ${invNum}`, { size: 7.5, align: 'center' });
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([`Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 2, PAGE_W / 2], { size: 8 }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['BILL TO', 'AMOUNT DUE'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7.5 }) +
        wTRTheme(
            [
                [f.merchantName, ...splitAddrCommaLines(f.fullBillAddr), '', 'SHIP TO', f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n'),
                [
                    `Base Amount: ${fmtRs(gst.base)}`,
                    gst.isSame ? `CGST @ ${gst.rate / 2}%: ${fmtRs(gst.cgst)}` : `IGST @ ${gst.rate}%: ${fmtRs(gst.igst)}`,
                    gst.isSame ? `SGST @ ${gst.rate / 2}%: ${fmtRs(gst.sgst)}` : '',
                    `Total: ${fmtRs(gst.total)}`,
                    '',
                    `Amount in Words: ${numWords(Math.round(gst.total))}`,
                ].filter(Boolean).join('\n'),
            ],
            [PAGE_W / 2, PAGE_W / 2], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['#', 'Description', 'Rate', 'Qty', 'Amount'], itemWidths, { bold: true, size: 8, align: 'center' }) +
        gst.lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', cleanNum(l.unitPrice).toFixed(2), String(l.qty), cleanNum(l.total).toFixed(2)], itemWidths, { size: 8, align: 'center' })).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(f.coName, { bold: true, size: 9 });
    body += wPTheme(splitAddrCommaLines(f.coAddr, 60).join('\n'), { size: 7.5 });
    const idLine = [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : ''].filter(Boolean).join('   ');
    if (idLine) body += wPTheme(idLine, { size: 7.5 });
    if (f.coCin) body += wPTheme(`CIN: ${f.coCin}`, { size: 7.5 });
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 7.5, align: 'right' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}