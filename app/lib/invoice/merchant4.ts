// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant4.ts
// MERCHANT 4 — "Sidebar" style. Strict black & white. Fixed
// narrow left column (logo + Sold By info, PAN/GST/CIN) separated
// by a vertical rule from the main right column (invoice meta,
// addresses, items, totals). Minimal, generous whitespace, small-
// caps section labels — distinct from the boxed/ledger/slip styles.
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
const fmtRs = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // PDF-safe

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

function withLineTax(gst: any) {
    return gst.lines.map((l: any) => {
        const enteredAmt = cleanNum(l.base);
        const net = parseFloat((enteredAmt / (1 + gst.rate / 100)).toFixed(2));
        const taxAmt = parseFloat((enteredAmt - net).toFixed(2));
        return { ...l, net, taxAmt, taxType: gst.isSame ? 'CGST+SGST' : 'IGST', lineTotal: enteredAmt };
    });
}

/* ═══════════════════════════════ HTML ═══════════════════════════════ */
export function buildInvoiceHTMLMerchant4(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-width:120px;max-height:40px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:16px;font-weight:800;">${esc(f.coName)}</span>`;

    const cell = (v: any, align = 'center') => `<td style="padding:5px 3px;border-bottom:1px solid #ccc;text-align:${align};">${v}</td>`;
    const rowsHTML = lines.map((l: any, i: number) => `
      <tr>
        ${cell(i + 1)}
        ${cell(esc(l.description || 'Item'), 'left')}
        ${cell(cleanNum(l.unitPrice).toFixed(2))}
        ${cell(l.qty)}
        ${cell(l.net.toFixed(2))}
        ${cell(`${gst.rate}%`)}
        ${cell(l.taxType)}
        ${cell(l.taxAmt.toFixed(2))}
        ${cell(l.lineTotal.toFixed(2))}
      </tr>`).join('');

    return `<div style="background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:8.3pt;line-height:1.5;">
  <div style="display:flex;">
    <div style="width:150px;flex-shrink:0;border-right:1px solid #000;padding:20px 14px 20px 0;">
      <div style="margin-bottom:12px;">${logoBlockHTML}</div>
      <div style="font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:2px;">Sold By</div>
      <div style="font-weight:700;font-size:8.5pt;margin-bottom:4px;">${esc(f.coName)}</div>
      ${splitAddrCommaLines(f.coAddr).map(l => `<div style="font-size:7.5pt;">${esc(l)}</div>`).join('')}
      <div style="height:8px;"></div>
      ${f.coPan ? `<div style="font-size:7.3pt;"><b>PAN</b><br>${esc(f.coPan)}</div>` : ''}
      ${f.coGst ? `<div style="font-size:7.3pt;margin-top:4px;"><b>GSTIN</b><br>${esc(f.coGst)}</div>` : ''}
      ${f.coCin ? `<div style="font-size:7.3pt;margin-top:4px;"><b>CIN</b><br>${esc(f.coCin)}</div>` : ''}
    </div>

    <div style="flex:1;padding:20px 0 20px 18px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:15pt;font-weight:800;letter-spacing:.5px;">Tax Invoice</div>
          <div style="font-size:7.5pt;color:#555;">Original for Recipient</div>
        </div>
        <div style="text-align:right;font-size:7.8pt;line-height:1.7;">
          <div><b>Invoice No.</b> ${esc(invNum)}</div>
          <div><b>Invoice Date</b> ${esc(f.invDate)}</div>
          <div><b>Order Date</b> ${esc(f.orderDate)}</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:7.8pt;">
        <div style="flex:1;max-width:48%;">
          <div style="font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:2px;">Billing Address</div>
          <div style="font-weight:700;">${esc(f.merchantName)}</div>
          ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
        </div>
        <div style="flex:1;max-width:48%;">
          <div style="font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:2px;">Shipping Address</div>
          <div style="font-weight:700;">${esc(f.shipName)}</div>
          ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:7.5pt;table-layout:fixed;">
        <colgroup><col style="width:7%;"><col style="width:22%;"><col style="width:11%;"><col style="width:7%;"><col style="width:12%;"><col style="width:9%;"><col style="width:11%;"><col style="width:11%;"><col style="width:10%;"></colgroup>
        <thead>
          <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;">
            <th style="padding:5px 3px;">SI.No</th><th style="padding:5px 3px;text-align:left;">Description</th>
            <th style="padding:5px 3px;">Unit Price</th><th style="padding:5px 3px;">QTY</th>
            <th style="padding:5px 3px;">Net Amount</th><th style="padding:5px 3px;">Tax Rate</th>
            <th style="padding:5px 3px;">Tax Type</th><th style="padding:5px 3px;">Tax Amount</th>
            <th style="padding:5px 3px;">Total</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:6px;">
        <table style="font-size:8pt;min-width:200px;">
          <tr><td style="padding:2px 0;">Tax Amount</td><td style="padding:2px 0;text-align:right;">${fmtINR(totalTax)}</td></tr>
          <tr><td colspan="2"><div style="border-top:1.5px solid #000;margin:4px 0;"></div></td></tr>
          <tr><td style="padding:2px 0;font-weight:700;font-size:10pt;">Total</td><td style="padding:2px 0;text-align:right;font-weight:700;font-size:10pt;">${fmtINR(totalAmt)}</td></tr>
        </table>
      </div>

      <div style="margin-top:12px;font-size:7.8pt;border-top:1px solid #ddd;padding-top:8px;">
        Amount in Words: <b>${numWords(Math.round(totalAmt))}</b>
      </div>

      <div style="margin-top:30px;text-align:right;font-size:7.8pt;">
        <div style="border-top:1px solid #000;display:inline-block;min-width:150px;padding-top:4px;">Authorized Signatory</div>
      </div>
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant4(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const sidebarR = 55, contentL = 60, R = 196;
    let y = 16;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(sidebarR, 10, sidebarR, 280);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }
    doc.setTextColor(0, 0, 0);
    let sy = y;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            doc.addImage(logoSrc, imgType, 12, sy, 36, 12, undefined, 'FAST');
            sy += 16;
        } catch (e) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(f.coName, 12, sy); sy += 6; }
    } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(f.coName, 12, sy); sy += 6;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text('SOLD BY', 12, sy); sy += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    const nameLines = doc.splitTextToSize(f.coName, 40);
    doc.text(nameLines, 12, sy); sy += nameLines.length * 3.8 + 1;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 32);
    doc.text(coAddrLines, 12, sy); sy += coAddrLines.length * 3.4 + 4;
    if (f.coPan) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text('PAN', 12, sy); sy += 3.2; doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(f.coPan, 12, sy); sy += 4.5; }
    if (f.coGst) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text('GSTIN', 12, sy); sy += 3.2; doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(f.coGst, 12, sy); sy += 4.5; }
    if (f.coCin) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text('CIN', 12, sy); sy += 3.2; doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(f.coCin, 12, sy); sy += 4.5; }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('Tax Invoice', contentL, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text('Original for Recipient', contentL, y + 8);

    let ry = y;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
    doc.text(`Invoice No.: ${invNum}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Invoice Date: ${f.invDate || '-'}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Order Date: ${f.orderDate || '-'}`, R, ry, { align: 'right' }); ry += 4;

    y = Math.max(y + 14, ry + 4);

    const halfW = (R - contentL - 4) / 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
    doc.setTextColor(85, 85, 85);
    doc.text('BILLING ADDRESS', contentL, y);
    doc.text('SHIPPING ADDRESS', contentL + halfW + 4, y);
    doc.setTextColor(0, 0, 0);
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8);
    doc.text(f.merchantName || '-', contentL, y);
    doc.text(f.shipName || '-', contentL + halfW + 4, y);
    y += 3.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    const billLines = splitAddrCommaLines(f.fullBillAddr, 40);
    const shipLines = splitAddrCommaLines(f.fullShipAddr, 40);
    billLines.forEach((ln, i) => doc.text(ln, contentL, y + i * 3.5));
    shipLines.forEach((ln, i) => doc.text(ln, contentL + halfW + 4, y + i * 3.5));
    y += Math.max(billLines.length, shipLines.length) * 3.5 + 6;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total']],
        body: lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)]),
        margin: { left: contentL, right: 14 },
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 6.5, cellPadding: 2, textColor: 0, lineColor: 200, lineWidth: { bottom: 0.2 } },
        headStyles: { fontStyle: 'bold', lineWidth: { top: 0.4, bottom: 0.4 } },
        columnStyles: {
            0: { halign: 'center', cellWidth: 10 }, 1: { halign: 'left', cellWidth: 34 },
            2: { halign: 'center', cellWidth: 16 }, 3: { halign: 'center', cellWidth: 10 },
            4: { halign: 'center', cellWidth: 17 }, 5: { halign: 'center', cellWidth: 13 },
            6: { halign: 'center', cellWidth: 16 }, 7: { halign: 'center', cellWidth: 16 },
            8: { halign: 'center', cellWidth: 15 },
        },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    const totalsX = R - 45;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Tax Amount', totalsX, y); doc.text(fmtRs(totalTax), R, y, { align: 'right' }); y += 4.5;
    doc.setLineWidth(0.4); doc.line(totalsX, y, R, y); y += 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Total', totalsX, y); doc.text(fmtRs(totalAmt), R, y, { align: 'right' }); y += 9;

    doc.setDrawColor(220); doc.line(contentL, y, R, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
    const wl = doc.splitTextToSize(`Amount in Words: ${numWords(Math.round(totalAmt))}`, R - contentL);
    doc.text(wl, contentL, y);

    const ph = doc.internal.pageSize.height;
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(R - 45, ph - 18, R, ph - 18);
    doc.setFontSize(7.8);
    doc.text('Authorized Signatory', R, ph - 13, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant4(row: any, profile: any, invNum: string, company: any) {
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
        wTRTheme(
            [
                ['SOLD BY', f.coName, ...splitAddrCommaLines(f.coAddr, 32), f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : '', f.coCin ? `CIN: ${f.coCin}` : ''].filter(Boolean).join('\n'),
                [
                    'Tax Invoice — Original for Recipient',
                    `Invoice No.: ${invNum}`,
                    `Invoice Date: ${f.invDate}`,
                    `Order Date: ${f.orderDate}`,
                ].join('\n'),
            ],
            [PAGE_W * 0.25, PAGE_W * 0.75], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['BILLING ADDRESS', 'SHIPPING ADDRESS'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7.3 }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 7.8 }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total'], itemWidths, { bold: true, size: 6.5, align: 'center' }) +
        lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)], itemWidths, { size: 6.5, align: 'center' })).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(`Tax Amount: ${fmtRs(totalTax)}`, { size: 8.5, align: 'right' });
    body += wPTheme(`Total: ${fmtRs(totalAmt)}`, { bold: true, size: 11, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(totalAmt))}`, { size: 8 });
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 8, align: 'right' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}