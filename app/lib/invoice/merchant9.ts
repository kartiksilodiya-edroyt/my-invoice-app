// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant9.ts
// MERCHANT 9 — "Minimalist Underline" style. Strict black & white.
// No boxes, no table borders, no fills anywhere — every visual
// separator is a thin underline beneath a label. Extremely generous
// whitespace, small-caps section tags, modern SaaS-invoice feel.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

const fmtRs = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function splitAddrCommaLines(addr: string, maxLineLen = 46): string[] {
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
export function buildInvoiceHTMLMerchant9(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const words = numWords(Math.round(gst.total));

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:32px;max-width:130px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:15px;font-weight:600;">${esc(f.coName)}</span>`;

    const label = (t: string) => `<div style="font-size:6.8pt;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:4px;">${t}</div>`;

    const rowsHTML = gst.lines.map((l: any, i: number) => `
      <tr>
        <td style="padding:9px 4px;color:#888;font-size:7.5pt;">${i + 1}</td>
        <td style="padding:9px 4px;">${esc(l.description || 'Item')}</td>
        <td style="padding:9px 4px;text-align:right;color:#555;">${cleanNum(l.unitPrice).toFixed(2)}</td>
        <td style="padding:9px 4px;text-align:center;color:#555;">${l.qty}</td>
        <td style="padding:9px 4px;text-align:right;font-weight:600;">${cleanNum(l.total).toFixed(2)}</td>
      </tr>`).join('');

    const totalsRows = gst.isSame
        ? `<div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;padding:3px 0;"><span>Base Amount</span><span>${fmtRs(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;padding:3px 0;"><span>CGST @ ${gst.rate / 2}%</span><span>${fmtRs(gst.cgst)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;padding:3px 0;"><span>SGST @ ${gst.rate / 2}%</span><span>${fmtRs(gst.sgst)}</span></div>`
        : `<div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;padding:3px 0;"><span>Base Amount</span><span>${fmtRs(gst.base)}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;padding:3px 0;"><span>IGST @ ${gst.rate}%</span><span>${fmtRs(gst.igst)}</span></div>`;

    return `<div style="background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;padding:32px 36px;font-size:8.5pt;line-height:1.6;">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div>${logoBlockHTML}</div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:300;letter-spacing:1px;">Invoice</div>
      <div style="font-size:7.5pt;color:#888;">${esc(invNum)}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:36px;">
    <div>
      ${label('Billed To')}
      <div style="font-weight:600;">${esc(f.merchantName)}</div>
      ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div style="color:#555;font-size:8pt;">${esc(l)}</div>`).join('')}
    </div>
    <div>
      ${label('Shipped To')}
      <div style="font-weight:600;">${esc(f.shipName)}</div>
      ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div style="color:#555;font-size:8pt;">${esc(l)}</div>`).join('')}
    </div>
    <div style="text-align:right;">
      ${label('Dates')}
      <div style="font-size:8pt;color:#555;">Invoice &nbsp; ${esc(f.invDate)}</div>
      <div style="font-size:8pt;color:#555;">Order &nbsp;&nbsp;&nbsp;&nbsp; ${esc(f.orderDate)}</div>
    </div>
  </div>

  <div style="height:1px;background:#000;margin:30px 0 0 0;"></div>

  <table style="width:100%;border-collapse:collapse;font-size:8.3pt;">
    <thead>
      <tr>
        <th style="text-align:left;padding-bottom:6px;padding-top:12px;font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#888;font-weight:400;">#</th>
        <th style="text-align:left;padding-bottom:6px;padding-top:12px;font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#888;font-weight:400;">Description</th>
        <th style="text-align:right;padding-bottom:6px;padding-top:12px;font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#888;font-weight:400;">Rate</th>
        <th style="text-align:center;padding-bottom:6px;padding-top:12px;font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#888;font-weight:400;">Qty</th>
        <th style="text-align:right;padding-bottom:6px;padding-top:12px;font-size:6.8pt;letter-spacing:1px;text-transform:uppercase;color:#888;font-weight:400;">Amount</th>
      </tr>
    </thead>
    <tbody style="border-top:1px solid #ddd;">${rowsHTML}</tbody>
  </table>

  <div style="height:1px;background:#ddd;"></div>

  <div style="display:flex;justify-content:flex-end;margin-top:14px;">
    <div style="min-width:220px;">
      ${totalsRows}
      <div style="height:1px;background:#000;margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:15pt;font-weight:300;">
        <span>Total</span><span>${fmtRs(gst.total)}</span>
      </div>
    </div>
  </div>

  <div style="margin-top:24px;font-size:7.8pt;color:#888;">Amount in Words &nbsp;·&nbsp; ${words}</div>

  <div style="margin-top:60px;display:flex;justify-content:space-between;font-size:7.5pt;color:#888;">
    <div>
      <div style="color:#111;font-weight:600;">${esc(f.coName)}</div>
      ${splitAddrCommaLines(f.coAddr, 55).map(l => `<div>${esc(l)}</div>`).join('')}
      <div style="margin-top:4px;">
        ${f.coPan ? `PAN ${esc(f.coPan)}` : ''}${f.coPan && f.coGst ? ' &nbsp;·&nbsp; ' : ''}${f.coGst ? `GSTIN ${esc(f.coGst)}` : ''}
      </div>
      ${f.coCin ? `<div>CIN ${esc(f.coCin)}</div>` : ''}
    </div>
    <div style="text-align:right;align-self:flex-end;">
      <div style="height:1px;background:#000;width:130px;margin-bottom:4px;"></div>
      Authorized Signatory
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant9(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 22, R = 188;
    let y = 22;
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
            doc.addImage(logoSrc, imgType, L, y - 5, 34, 11, undefined, 'FAST');
        } catch (e) { doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.text(f.coName, L, y); }
    } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.text(f.coName, L, y);
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(19);
    doc.text('Invoice', R, y - 2, { align: 'right' });
    doc.setFontSize(7.5); doc.setTextColor(130, 130, 130);
    doc.text(invNum, R, y + 3, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 20;

    const colW = (R - L - 12) / 3;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(140, 140, 140);
    doc.text('BILLED TO', L, y);
    doc.text('SHIPPED TO', L + colW + 6, y);
    doc.text('DATES', R, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 4.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text(f.merchantName || '-', L, y);
    doc.text(f.shipName || '-', L + colW + 6, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(90, 90, 90);
    doc.text(`Invoice  ${f.invDate || '-'}`, R, y, { align: 'right' });
    y += 3.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    billLines.forEach((ln, i) => doc.text(ln, L, y + i * 3.6));
    shipLines.forEach((ln, i) => doc.text(ln, L + colW + 6, y + i * 3.6));
    doc.text(`Order  ${f.orderDate || '-'}`, R, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += Math.max(billLines.length, shipLines.length) * 3.6 + 14;

    doc.setDrawColor(0); doc.setLineWidth(0.35);
    doc.line(L, y, R, y); y += 8;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(140, 140, 140);
    doc.text('#', L, y); doc.text('DESCRIPTION', L + 10, y);
    doc.text('RATE', L + 120, y, { align: 'right' });
    doc.text('QTY', L + 138, y, { align: 'center' });
    doc.text('AMOUNT', R, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 2;
    doc.setDrawColor(220); doc.setLineWidth(0.2); doc.line(L, y, R, y);
    y += 7;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3);
    gst.lines.forEach((l: any, i: number) => {
        doc.setTextColor(140, 140, 140);
        doc.text(String(i + 1), L, y);
        doc.setTextColor(0, 0, 0);
        const descLines = doc.splitTextToSize(l.description || 'Item', 100);
        doc.text(descLines, L + 10, y);
        doc.setTextColor(90, 90, 90);
        doc.text(cleanNum(l.unitPrice).toFixed(2), L + 120, y, { align: 'right' });
        doc.text(String(l.qty), L + 138, y, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.text(cleanNum(l.total).toFixed(2), R, y, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        y += Math.max(descLines.length, 1) * 5.2;
    });

    doc.setDrawColor(220); doc.line(L, y, R, y); y += 8;

    const totalsX = R - 55;
    doc.setTextColor(90, 90, 90); doc.setFontSize(8);
    doc.text('Base Amount', totalsX, y); doc.text(fmtRs(gst.base), R, y, { align: 'right' }); y += 4.8;
    if (gst.isSame) {
        doc.text(`CGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.cgst), R, y, { align: 'right' }); y += 4.8;
        doc.text(`SGST @ ${gst.rate / 2}%`, totalsX, y); doc.text(fmtRs(gst.sgst), R, y, { align: 'right' }); y += 4.8;
    } else {
        doc.text(`IGST @ ${gst.rate}%`, totalsX, y); doc.text(fmtRs(gst.igst), R, y, { align: 'right' }); y += 4.8;
    }
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0); doc.setLineWidth(0.35); doc.line(totalsX, y, R, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(16);
    doc.text('Total', totalsX, y); doc.text(fmtRs(gst.total), R, y, { align: 'right' }); y += 12;

    doc.setFontSize(7.8); doc.setTextColor(140, 140, 140);
    doc.text(`Amount in Words  ·  ${numWords(Math.round(gst.total))}`, L, y);
    y += 28;

    doc.setTextColor(140, 140, 140); doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text(f.coName, L, y); y += 4;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 140, 140);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 55);
    doc.text(coAddrLines, L, y); y += coAddrLines.length * 3.4;
    const idLine = [f.coPan ? `PAN ${f.coPan}` : '', f.coGst ? `GSTIN ${f.coGst}` : ''].filter(Boolean).join('   ·   ');
    if (idLine) { doc.text(idLine, L, y); y += 3.6; }
    if (f.coCin) doc.text(`CIN ${f.coCin}`, L, y);

    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(R - 40, y - 3, R, y - 3);
    doc.setTextColor(90, 90, 90);
    doc.text('Authorized Signatory', R, y + 2, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant9(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const PAGE_W = 9360;
    const itemWidths = [900, 4560, 1500, 900, 1500];

    let body = '';
    body += wTableTheme(wTRTheme([f.coName, `Invoice\n${invNum}`], [PAGE_W / 2, PAGE_W / 2], { size: 12, align: 'right' }), PAGE_W);
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['BILLED TO', 'SHIPPED TO', 'DATES'], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 6.8, color: '888888' }) +
        wTRTheme(
            [
                [f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'),
                [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n'),
                `Invoice  ${f.invDate}\nOrder  ${f.orderDate}`,
            ],
            [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme(['#', 'Description', 'Rate', 'Qty', 'Amount'], itemWidths, { bold: true, size: 7, align: 'center' }) +
        gst.lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', cleanNum(l.unitPrice).toFixed(2), String(l.qty), cleanNum(l.total).toFixed(2)], itemWidths, { size: 8, align: 'center' })).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(`Base Amount: ${fmtRs(gst.base)}`, { size: 8, align: 'right' });
    if (gst.isSame) {
        body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtRs(gst.cgst)}`, { size: 8, align: 'right' });
        body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtRs(gst.sgst)}`, { size: 8, align: 'right' });
    } else {
        body += wPTheme(`IGST @ ${gst.rate}%: ${fmtRs(gst.igst)}`, { size: 8, align: 'right' });
    }
    body += wPTheme(`Total: ${fmtRs(gst.total)}`, { size: 16, align: 'right' });
    body += wPTheme('');
    body += wPTheme(`Amount in Words · ${numWords(Math.round(gst.total))}`, { size: 7.8, color: '888888' });
    body += wPTheme('');
    body += wPTheme(f.coName, { bold: true, size: 8 });
    body += wPTheme(splitAddrCommaLines(f.coAddr, 55).join('\n'), { size: 7.5, color: '888888' });
    const idLine = [f.coPan ? `PAN ${f.coPan}` : '', f.coGst ? `GSTIN ${f.coGst}` : ''].filter(Boolean).join('   ·   ');
    if (idLine) body += wPTheme(idLine, { size: 7.5, color: '888888' });
    if (f.coCin) body += wPTheme(`CIN ${f.coCin}`, { size: 7.5, color: '888888' });
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 7.5, align: 'right', color: '888888' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}