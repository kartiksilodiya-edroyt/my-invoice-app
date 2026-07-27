// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant6.ts
// MERCHANT 6 — "Corner Tab" style. Strict black & white. Invoice
// number sits in a stamped/boxed tab at the top-right corner, a
// single thin rule under the masthead (no double/heavy rules),
// underline-only totals (no boxed totals card) — distinct from
// every prior template's header treatment.
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
export function buildInvoiceHTMLMerchant6(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:40px;max-width:160px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:19px;font-weight:800;">${esc(f.coName)}</span>`;

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <tr>
        <td style="padding:6px 4px;border-bottom:1px solid #000;text-align:center;">${i + 1}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #000;">${esc(l.description || 'Item')}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #000;text-align:right;">${cleanNum(l.unitPrice).toFixed(2)}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #000;text-align:center;">${l.qty}</td>
        <td style="padding:6px 4px;border-bottom:1px solid #000;text-align:right;">${cleanNum(l.total).toFixed(2)}</td>
      </tr>`).join('');

    const totalsRows = gst.isSame
        ? `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>Base Amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;padding:2px 0;"><span>CGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.cgst)}</span></div>
       <div style="display:flex;justify-content:space-between;padding:2px 0;"><span>SGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.sgst)}</span></div>`
        : `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>Base Amount</span><span>${fmtINR(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;padding:2px 0;"><span>IGST @ ${gst.rate}%</span><span>${fmtINR(gst.igst)}</span></div>`;

    return `<div style="background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;padding:22px 26px;font-size:8.5pt;line-height:1.45;position:relative;">

  <div style="position:absolute;top:22px;right:26px;border:1.5px solid #000;padding:6px 14px;text-align:center;">
    <div style="font-size:6.5pt;letter-spacing:1px;text-transform:uppercase;">Invoice No.</div>
    <div style="font-size:11pt;font-weight:800;">${esc(invNum)}</div>
  </div>

  <div style="max-width:60%;">
    ${logoBlockHTML}
    <div style="font-size:14pt;font-weight:800;margin-top:8px;">Tax Invoice</div>
    <div style="font-size:7.5pt;color:#333;">Original for Recipient</div>
  </div>

  <div style="border-top:1px solid #000;margin-top:14px;padding-top:8px;display:flex;justify-content:space-between;font-size:8pt;">
    <div><b>Invoice Date:</b> ${esc(f.invDate)}</div>
    <div><b>Order Date:</b> ${esc(f.orderDate)}</div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:8pt;">
    <div style="flex:1;max-width:48%;">
      <div style="font-size:7pt;letter-spacing:1px;text-transform:uppercase;color:#555;">Billed To</div>
      <div style="font-weight:700;">${esc(f.merchantName)}</div>
      ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
    <div style="flex:1;max-width:48%;">
      <div style="font-size:7pt;letter-spacing:1px;text-transform:uppercase;color:#555;">Shipped To</div>
      <div style="font-weight:700;">${esc(f.shipName)}</div>
      ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:8pt;table-layout:fixed;">
    <colgroup><col style="width:8%;"><col style="width:47%;"><col style="width:15%;"><col style="width:10%;"><col style="width:20%;"></colgroup>
    <thead>
      <tr style="border-bottom:2px solid #000;">
        <th style="padding:6px 4px;">#</th>
        <th style="padding:6px 4px;text-align:left;">Description</th>
        <th style="padding:6px 4px;text-align:right;">Rate</th>
        <th style="padding:6px 4px;">Qty</th>
        <th style="padding:6px 4px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-top:8px;">
    <div style="min-width:230px;font-size:8pt;">
      ${totalsRows}
      <div style="border-top:2px solid #000;margin-top:5px;padding-top:5px;display:flex;justify-content:space-between;font-size:11pt;font-weight:800;">
        <span>Total</span><span>${fmtINR(gst.total)}</span>
      </div>
    </div>
  </div>

  <div style="margin-top:14px;font-size:8pt;">
    Amount in Words: <b>${words}</b>
  </div>

  <div style="border-top:1px solid #000;margin-top:24px;padding-top:8px;display:flex;justify-content:space-between;font-size:7.5pt;color:#333;">
    <div>
      <b>${esc(f.coName)}</b><br>
      ${splitAddrCommaLines(f.coAddr, 55).map(l => `${esc(l)}<br>`).join('')}
      ${f.coPan ? `PAN: ${esc(f.coPan)} ` : ''}${f.coGst ? `&nbsp; GSTIN: ${esc(f.coGst)}` : ''}${f.coCin ? `<br>CIN: ${esc(f.coCin)}` : ''}
    </div>
    <div style="text-align:right;align-self:flex-end;">
      <div style="border-top:1px solid #000;padding-top:3px;min-width:130px;">Authorized Signatory</div>
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant6(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 16, R = 194;
    let y = 16;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

    doc.setDrawColor(0); doc.setLineWidth(0.4);
    doc.rect(R - 42, y - 2, 42, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text('INVOICE NO.', R - 21, y + 3, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(invNum, R - 21, y + 10, { align: 'center' });

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
            doc.addImage(logoSrc, imgType, L, y, 40, 13, undefined, 'FAST');
            y += 17;
        } catch (e) { doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(f.coName, L, y + 6); y += 12; }
    } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(f.coName, L, y + 6); y += 12;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Tax Invoice', L, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text('Original for Recipient', L, y); y += 6;

    doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 5;
    doc.setFontSize(8);
    doc.text(`Invoice Date: ${f.invDate || '-'}`, L, y);
    doc.text(`Order Date: ${f.orderDate || '-'}`, R, y, { align: 'right' });
    y += 10;

    const halfW = (R - L - 6) / 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
    doc.setTextColor(85, 85, 85);
    doc.text('BILLED TO', L, y);
    doc.text('SHIPPED TO', L + halfW + 6, y);
    doc.setTextColor(0, 0, 0);
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', L, y);
    doc.text(f.shipName || '-', L + halfW + 6, y);
    y += 3.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    billLines.forEach((ln, i) => doc.text(ln, L, y + i * 3.6));
    shipLines.forEach((ln, i) => doc.text(ln, L + halfW + 6, y + i * 3.6));
    y += Math.max(billLines.length, shipLines.length) * 3.6 + 8;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['#', 'Description', 'Rate', 'Qty', 'Amount']],
        body: gst.lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.total)]),
        margin: { left: L, right: 16 },
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, textColor: 0, lineColor: 0, lineWidth: { bottom: 0.25 } },
        headStyles: { fontStyle: 'bold', lineWidth: { bottom: 0.6 } },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 92 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 32 } },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    const totalsX = R - 55;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Base Amount', totalsX, y); doc.text(fmtRs(gst.base), R, y, { align: 'right' }); y += 4.5;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.cgst), R, y, { align: 'right' }); y += 4.5;
        doc.text(`SGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.sgst), R, y, { align: 'right' }); y += 4.5;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, totalsX, y); doc.text(fmtRs(gst.igst), R, y, { align: 'right' }); y += 4.5;
    }
    doc.setLineWidth(0.6); doc.line(totalsX, y, R, y); y += 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Total', totalsX, y); doc.text(fmtRs(gst.total), R, y, { align: 'right' }); y += 10;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Amount in Words: ${numWords(Math.round(gst.total))}`, L, y);
    y += 16;

    doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 5;
    doc.setFontSize(7.5); doc.setTextColor(50, 50, 50);
    doc.setFont('helvetica', 'bold'); doc.text(f.coName, L, y); y += 4;
    doc.setFont('helvetica', 'normal');
    const coAddrLines = splitAddrCommaLines(f.coAddr, 55);
    doc.text(coAddrLines, L, y); y += coAddrLines.length * 3.4;
    const idLine = [f.coPan ? `PAN: ${f.coPan}` : '', f.coGst ? `GSTIN: ${f.coGst}` : ''].filter(Boolean).join('   ');
    if (idLine) doc.text(idLine, L, y);
    if (f.coCin) doc.text(`CIN: ${f.coCin}`, L, y + 3.6);

    doc.setDrawColor(0); doc.setTextColor(0, 0, 0);
    doc.line(R - 40, y - 2, R, y - 2);
    doc.setFontSize(7.8);
    doc.text('Authorized Signatory', R, y + 3, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant6(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;
    const itemWidths = [900, 4560, 1500, 900, 1500];

    let body = '';
    body += wPTheme(`Invoice No.: ${invNum}`, { bold: true, size: 10, align: 'right' });
    body += wPTheme(f.coName, { bold: true, size: 15 });
    body += wPTheme('Tax Invoice', { bold: true, size: 12 });
    body += wPTheme('Original for Recipient', { size: 7.5 });
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([`Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 2, PAGE_W / 2], { size: 8 }),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['BILLED TO', 'SHIPPED TO'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7 }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
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
    body += wPTheme(`Base Amount: ${fmtRs(gst.base)}`, { size: 8.5, align: 'right' });
    if (gst.isSame) {
        body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtRs(gst.cgst)}`, { size: 8.5, align: 'right' });
        body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtRs(gst.sgst)}`, { size: 8.5, align: 'right' });
    } else {
        body += wPTheme(`IGST @ ${gst.rate}%: ${fmtRs(gst.igst)}`, { size: 8.5, align: 'right' });
    }
    body += wPTheme(`Total: ${fmtRs(gst.total)}`, { bold: true, size: 12, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 8 });
    body += wPTheme('');
    body += wPTheme(f.coName, { bold: true, size: 8 });
    body += wPTheme(splitAddrCommaLines(f.coAddr, 55).join('\n'), { size: 7.5 });
    if (f.coPan) body += wPTheme(`PAN: ${f.coPan}`, { size: 7.5 });
    if (f.coGst) body += wPTheme(`GSTIN: ${f.coGst}`, { size: 7.5 });
    if (f.coCin) body += wPTheme(`CIN: ${f.coCin}`, { size: 7.5 });
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 7.8, align: 'right' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}