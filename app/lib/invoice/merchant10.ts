// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant10.ts
// MERCHANT 10 — "Dense Tabular Grid" style. Strict black & white.
// The entire invoice — header fields, addresses, line items, totals,
// signature — lives inside ONE continuous bordered grid, like a
// spreadsheet export. Small font, thin uniform borders throughout,
// no whitespace-heavy sections — the densest of all templates.
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
export function buildInvoiceHTMLMerchant10(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const td = (v: any, align = 'left', extra = '') => `<td style="border:1px solid #000;padding:3px 5px;text-align:${align};font-size:7.3pt;${extra}">${v}</td>`;
    const th = (v: any, colspan = 1) => `<th colspan="${colspan}" style="border:1px solid #000;padding:3px 5px;background:#e8e8e8;font-size:6.8pt;text-align:center;">${v}</th>`;

    const rowsHTML = lines.map((l: any, i: number) => `
      <tr>
        ${td(i + 1, 'center')}
        ${td(esc(l.description || 'Item'))}
        ${td(cleanNum(l.unitPrice).toFixed(2), 'right')}
        ${td(l.qty, 'center')}
        ${td(l.net.toFixed(2), 'right')}
        ${td(`${gst.rate}%`, 'center')}
        ${td(l.taxType, 'center')}
        ${td(l.taxAmt.toFixed(2), 'right')}
        ${td(l.lineTotal.toFixed(2), 'right', 'font-weight:700;')}
      </tr>`).join('');

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:26px;max-width:100px;object-fit:contain;filter:grayscale(1);vertical-align:middle;" alt="logo">`
        : `<b>${esc(f.coName)}</b>`;

    return `<div style="background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;padding:14px;font-size:7.5pt;">
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      ${th('COMPANY', 3)}${th('TAX INVOICE', 3)}${th('INVOICE DETAILS', 3)}
    </tr>
    <tr>
      <td colspan="3" style="border:1px solid #000;padding:6px;vertical-align:top;">
        ${logoBlockHTML}<br>
        <b>${esc(f.coName)}</b><br>
        ${splitAddrCommaLines(f.coAddr, 40).map(l => `${esc(l)}<br>`).join('')}
        ${f.coPan ? `PAN: ${esc(f.coPan)}<br>` : ''}${f.coGst ? `GSTIN: ${esc(f.coGst)}<br>` : ''}${f.coCin ? `CIN: ${esc(f.coCin)}` : ''}
      </td>
      <td colspan="3" style="border:1px solid #000;padding:6px;text-align:center;vertical-align:middle;">
        <div style="font-size:13pt;font-weight:800;">TAX INVOICE</div>
        <div style="font-size:6.8pt;color:#444;">Original for Recipient</div>
      </td>
      <td colspan="3" style="border:1px solid #000;padding:6px;vertical-align:top;">
        <b>Invoice No.</b> ${esc(invNum)}<br>
        <b>Invoice Date</b> ${esc(f.invDate)}<br>
        <b>Order Date</b> ${esc(f.orderDate)}
      </td>
    </tr>
    <tr>
      ${th('BILLING ADDRESS', 4)}${th('SHIPPING ADDRESS', 5)}
    </tr>
    <tr>
      <td colspan="4" style="border:1px solid #000;padding:6px;vertical-align:top;">
        <b>${esc(f.merchantName)}</b><br>
        ${splitAddrCommaLines(f.fullBillAddr).map(l => `${esc(l)}<br>`).join('')}
      </td>
      <td colspan="5" style="border:1px solid #000;padding:6px;vertical-align:top;">
        <b>${esc(f.shipName)}</b><br>
        ${splitAddrCommaLines(f.fullShipAddr).map(l => `${esc(l)}<br>`).join('')}
      </td>
    </tr>
    <tr>
      ${th('SI.No')}${th('Description')}${th('Unit Price')}${th('QTY')}${th('Net Amount')}${th('Tax Rate')}${th('Tax Type')}${th('Tax Amount')}${th('Total')}
    </tr>
    ${rowsHTML}
    <tr>
      <td colspan="7" style="border:1px solid #000;padding:5px;font-weight:700;text-align:center;background:#f0f0f0;">GRAND TOTAL</td>
      <td style="border:1px solid #000;padding:5px;font-weight:700;text-align:right;background:#f0f0f0;">${totalTax.toFixed(2)}</td>
      <td style="border:1px solid #000;padding:5px;font-weight:700;text-align:right;background:#f0f0f0;">${totalAmt.toFixed(2)}</td>
    </tr>
    <tr>
      <td colspan="9" style="border:1px solid #000;padding:6px;font-weight:700;">Amount in Words: ${numWords(Math.round(totalAmt))}</td>
    </tr>
    <tr>
      <td colspan="5" style="border:1px solid #000;padding:6px;height:44px;vertical-align:bottom;">Prepared By</td>
      <td colspan="4" style="border:1px solid #000;padding:6px;height:44px;vertical-align:bottom;text-align:right;">Authorized Signatory</td>
    </tr>
  </table>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant10(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 10, R = 200;
    let y = 10;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    doc.setDrawColor(0); doc.setLineWidth(0.25);
    const thirdW = (R - L) / 3;

    // Row 1: company / title / invoice details (24mm tall)
    const rowH1 = 26;
    doc.rect(L, y, thirdW, rowH1); doc.rect(L + thirdW, y, thirdW, rowH1); doc.rect(L + thirdW * 2, y, thirdW, rowH1);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }
    doc.setTextColor(0, 0, 0);
    let cy = y + 4;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            doc.addImage(logoSrc, imgType, L + 2, cy - 2, 26, 8, undefined, 'FAST');
            cy += 8;
        } catch (e) { /* ignore */ }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text(f.coName, L + 2, cy); cy += 3.4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 38);
    doc.text(coAddrLines, L + 2, cy); cy += coAddrLines.length * 2.8;
    if (f.coPan) { doc.text(`PAN: ${f.coPan}`, L + 2, cy); cy += 2.8; }
    if (f.coGst) { doc.text(`GSTIN: ${f.coGst}`, L + 2, cy); cy += 2.8; }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('TAX INVOICE', L + thirdW + thirdW / 2, y + 11, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text('Original for Recipient', L + thirdW + thirdW / 2, y + 15, { align: 'center' });

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
    doc.text('Invoice No.', L + thirdW * 2 + 2, y + 5);
    doc.text('Invoice Date', L + thirdW * 2 + 2, y + 12);
    doc.text('Order Date', L + thirdW * 2 + 2, y + 19);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(invNum, L + thirdW * 2 + 2, y + 8.5);
    doc.text(f.invDate || '-', L + thirdW * 2 + 2, y + 15.5);
    doc.text(f.orderDate || '-', L + thirdW * 2 + 2, y + 22.5);

    y += rowH1;

    // Row 2: addresses
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    const rowH2 = Math.max(billLines.length, shipLines.length) * 3.2 + 10;
    const halfW = (R - L) / 2;
    doc.rect(L, y, halfW, rowH2); doc.rect(L + halfW, y, halfW, rowH2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text(f.merchantName || '-', L + 2, y + 5);
    doc.text(f.shipName || '-', L + halfW + 2, y + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    billLines.forEach((ln, i) => doc.text(ln, L + 2, y + 9.5 + i * 3.2));
    shipLines.forEach((ln, i) => doc.text(ln, L + halfW + 2, y + 9.5 + i * 3.2));
    y += rowH2;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total']],
        body: lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)]),
        foot: [[{ content: 'GRAND TOTAL', colSpan: 7, styles: { halign: 'center' } }, fmtNum(totalTax), fmtNum(totalAmt)]],
        margin: { left: L, right: 10 },
        styles: { font: 'helvetica', fontSize: 6.3, cellPadding: 1.6, textColor: 0, valign: 'middle', lineColor: 0, lineWidth: 0.2 },
        headStyles: { fillColor: [232, 232, 232], textColor: 0, fontStyle: 'bold', fontSize: 6.3 },
        footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', fontSize: 6.8 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 11 }, 1: { halign: 'left', cellWidth: 46 },
            2: { halign: 'right', cellWidth: 20 }, 3: { halign: 'center', cellWidth: 11 },
            4: { halign: 'right', cellWidth: 22 }, 5: { halign: 'center', cellWidth: 15 },
            6: { halign: 'center', cellWidth: 17 }, 7: { halign: 'right', cellWidth: 22 },
            8: { halign: 'right', cellWidth: 22 },
        },
    });
    y = (doc as any).lastAutoTable.finalY;

    doc.rect(L, y, R - L, 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text(`Amount in Words: ${numWords(Math.round(totalAmt))}`, L + 2, y + 5.2);
    y += 8;

    doc.rect(L, y, halfW, 16); doc.rect(L + halfW, y, halfW, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('Prepared By', L + 2, y + 13);
    doc.text('Authorized Signatory', R - 2, y + 13, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant10(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const PAGE_W = 9360;
    const itemWidths = [700, 2260, 1100, 700, 1200, 900, 1000, 1200, 1300];
    const fmtNum = (n: any) => cleanNum(n).toFixed(2);

    let body = '';
    body += wTableTheme(
        wTRTheme(['COMPANY', 'TAX INVOICE', 'INVOICE DETAILS'], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { bold: true, size: 6.8, align: 'center', shade: 'E8E8E8' }) +
        wTRTheme(
            [
                [f.coName, ...splitAddrCommaLines(f.coAddr, 40), f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : '', f.coCin ? `CIN: ${f.coCin}` : ''].filter(Boolean).join('\n'),
                'TAX INVOICE\nOriginal for Recipient',
                `Invoice No.: ${invNum}\nInvoice Date: ${f.invDate}\nOrder Date: ${f.orderDate}`,
            ],
            [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 7.3, align: 'center' }
        ),
        PAGE_W
    );
    body += wTableTheme(
        wTRTheme(['BILLING ADDRESS', 'SHIPPING ADDRESS'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 6.8, align: 'center', shade: 'E8E8E8' }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 7.5 }
        ),
        PAGE_W
    );
    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total'], itemWidths, { bold: true, size: 6.5, align: 'center', shade: 'E8E8E8' }) +
        lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)], itemWidths, { size: 6.5, align: 'center' })).join('') +
        wTRTheme(['GRAND TOTAL', '', '', '', '', '', '', fmtNum(totalTax), fmtNum(totalAmt)], itemWidths, { bold: true, size: 7, align: 'center', shade: 'F0F0F0' }) +
        wTRTheme([`Amount in Words: ${numWords(Math.round(totalAmt))}`], [PAGE_W], { bold: true, size: 7.5 }),
        PAGE_W
    );
    body += wTableTheme(
        wTRTheme(['Prepared By', 'Authorized Signatory'], [PAGE_W / 2, PAGE_W / 2], { size: 8, align: 'right' }),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}