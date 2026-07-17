// ═══════════════════════════════════════════════════════════════
// lib/invoice/paybuzz.ts
// PAYBUZZ template — strict black & white (no accent colors).
// Layout: Tax Invoice title (left) + logo (right) header, invoice
// meta right-aligned under logo, Billing/Shipping side-by-side,
// 9-column item table w/ TOTAL row inside the table, Amount in
// Words strip, "From {company}" strip, then a Sold-By footer with
// PAN/GST/CIN on the right.
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

function splitAddrCommaLines(addr: string, maxLineLen = 50): string[] {
    if (!addr) return [];
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    return parts.reduce((acc: string[], part: string) => {
        const last = acc[acc.length - 1];
        if (last && (last.length + part.length) < maxLineLen) {
            acc[acc.length - 1] = last + ', ' + part;
        } else {
            acc.push(part);
        }
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

    return {
        merchantName, fullBillAddr, shipName, fullShipAddr,
        coName, coAddr, coPan, coGst, coCin,
        orderDate, invDate, logoSrc,
    };
}

// gst.lines[].base is the tax-inclusive entered amount per line;
// reverse-split into net + tax, same convention as calcGST.
function withLineTax(gst: any) {
    return gst.lines.map((l: any) => {
        const enteredAmt = cleanNum(l.base);
        const net = parseFloat((enteredAmt / (1 + gst.rate / 100)).toFixed(2));
        const taxAmt = parseFloat((enteredAmt - net).toFixed(2));
        return {
            ...l,
            net,
            taxAmt,
            taxType: gst.isSame ? 'CGST+SGST' : 'IGST',
            lineTotal: enteredAmt,
        };
    });
}

/* ═══════════════════════════════ HTML ═══════════════════════════════ */
export function buildInvoiceHTMLPaybuzz(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);

    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:40px;max-width:170px;object-fit:contain;" alt="logo">`
        : `<span style="font-size:20px;font-weight:800;letter-spacing:.5px;">${esc(f.coName)}</span>`;

    const cellBase = 'border:1px solid #000;padding:5px;';
    const td = (val: any, align: string, bold = false) => `<td style="${cellBase}text-align:${align};${bold ? 'font-weight:700;' : ''}">${val}</td>`;
    const rowsHTML = lines.map((l: any, i: number) => `
      <tr>
        ${td(i + 1, 'center')}
        ${td(esc(l.description || 'Item'), 'left')}
        ${td(cleanNum(l.unitPrice).toFixed(2), 'center')}
        ${td(l.qty, 'center')}
        ${td(l.net.toFixed(2), 'center')}
        ${td(`${gst.rate}%`, 'center')}
        ${td(l.taxType, 'center')}
        ${td(l.taxAmt.toFixed(2), 'center')}
        ${td(l.lineTotal.toFixed(2), 'center', true)}
      </tr>`).join('');

    return `<div style="
background:#fff;
color:#000;
font-family:Arial,Helvetica,sans-serif;
padding:20px 24px;
font-size:8.5pt;
line-height:1.45;
">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="font-size:15pt;font-weight:800;">Tax Invoice</div>
      <div style="font-size:8.5pt;">(Original for Recipient)</div>
    </div>
    <div style="text-align:right;">
      <div style="margin-bottom:6px;">${logoBlockHTML}</div>
      <div style="font-size:8pt;line-height:1.6;">
        <div><b>Invoice Number:</b> ${esc(invNum)}</div>
        <div><b>Invoice Date:</b> ${esc(f.invDate)}</div>
        <div><b>Order Date:</b> ${esc(f.orderDate)}</div>
      </div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:8pt;">
    <div style="flex:1;max-width:48%;">
      <div style="font-weight:700;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:4px;">Billing Address</div>
      <div>${esc(f.merchantName)}</div>
      ${splitAddrCommaLines(f.fullBillAddr, 45).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
    <div style="flex:1;max-width:48%;text-align:right;">
      <div style="font-weight:700;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:4px;">Shipping Address:</div>
      <div>${esc(f.shipName)}</div>
      ${splitAddrCommaLines(f.fullShipAddr, 45).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:7.8pt;margin-top:16px;">
    <thead>
      <tr>
        <th style="border:1px solid #000;padding:5px;">SI.No</th>
        <th style="border:1px solid #000;padding:5px;">Description</th>
        <th style="border:1px solid #000;padding:5px;">Unit Price</th>
        <th style="border:1px solid #000;padding:5px;">QTY</th>
        <th style="border:1px solid #000;padding:5px;">Net Amount</th>
        <th style="border:1px solid #000;padding:5px;">Tax Rate</th>
        <th style="border:1px solid #000;padding:5px;">Tax Type</th>
        <th style="border:1px solid #000;padding:5px;">Tax Amount</th>
        <th style="border:1px solid #000;padding:5px;">Total Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <table style="width:100%;border-collapse:collapse;font-size:8pt;">
    <tr>
      <td style="border:1px solid #000;border-top:none;padding:5px;font-weight:700;">TOTAL:</td>
      <td style="border:1px solid #000;border-top:none;border-left:none;padding:5px;text-align:right;font-weight:700;width:120px;">₹ ${totalTax.toFixed(2)}</td>
      <td style="border:1px solid #000;border-top:none;border-left:none;padding:5px;text-align:right;font-weight:700;width:120px;">₹ ${totalAmt.toFixed(2)}</td>
    </tr>
    <tr>
      <td colspan="3" style="border:1px solid #000;border-top:none;padding:8px 5px;font-weight:700;">
        Amount in Words: ${numWords(Math.round(totalAmt))}
      </td>
    </tr>
    <tr>
      <td colspan="3" style="border:1px solid #000;border-top:none;padding:6px 5px;">
        From ${esc(f.coName)}
      </td>
    </tr>
  </table>

  <div style="display:flex;justify-content:space-between;margin-top:18px;font-size:8pt;">
    <div style="flex:1;max-width:60%;">
      <div style="font-weight:700;">Sold By :</div>
      <div>${esc(f.coName)}</div>
      ${splitAddrCommaLines(f.coAddr, 55).map(l => `<div>${esc(l)}</div>`).join('')}
    </div>
    <div style="text-align:right;">
      ${f.coPan ? `<div><b>PAN No:</b> ${esc(f.coPan)}</div>` : ''}
      ${f.coGst ? `<div><b>GST Registration No:</b> ${esc(f.coGst)}</div>` : ''}
      ${f.coCin ? `<div><b>CIN No:</b> ${esc(f.coCin)}</div>` : ''}
    </div>
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFPaybuzz(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 14, R = 196;
    let y = 16;

    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('Tax Invoice', L, y);
    let ry = y + 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('(Original for Recipient)', L, ry);

    // Logo + meta on right
    let logoBottomY = y - 9;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            const props = doc.getImageProperties(logoSrc);
            const ratioL = props?.width / props?.height || 3;
            const drawH = 11, drawW = Math.min(drawH * ratioL, 55);
            doc.addImage(logoSrc, imgType, R - drawW, y - 9, drawW, drawH, undefined, 'FAST');
            logoBottomY = y - 9 + drawH;
        } catch (e) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
            doc.text(f.coName, R, y, { align: 'right' });
            logoBottomY = y;
        }
    } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        doc.text(f.coName, R, y, { align: 'right' });
        logoBottomY = y;
    }

    let my = logoBottomY + 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Invoice Number: ${invNum}`, R, my, { align: 'right' }); my += 4;
    doc.text(`Invoice Date: ${f.invDate || '-'}`, R, my, { align: 'right' }); my += 4;
    doc.text(`Order Date: ${f.orderDate || '-'}`, R, my, { align: 'right' }); my += 4;

    y = Math.max(ry + 8, my + 6);

    doc.setDrawColor(0); doc.setLineWidth(0.3);

    // Billing (left) / Shipping (right)
    const colW = 85;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Billing Address', L, y);
    doc.text('Shipping Address:', R, y, { align: 'right' });
    doc.line(L, y + 1.3, L + colW, y + 1.3);
    doc.line(R - colW, y + 1.3, R, y + 1.3);
    y += 5;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', L, y);
    doc.text(f.shipName || '-', R, y, { align: 'right' });
    y += 3.8;

    const billLines = splitAddrCommaLines(f.fullBillAddr, 45);
    const shipLines = splitAddrCommaLines(f.fullShipAddr, 45);
    billLines.forEach((ln, idx) => doc.text(ln, L, y + idx * 3.6));
    shipLines.forEach((ln, idx) => doc.text(ln, R, y + idx * 3.6, { align: 'right' }));
    y += Math.max(billLines.length, shipLines.length) * 3.6 + 6;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total Amount']],
        body: lines.map((l: any, i: number) => [
            String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty),
            fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal),
        ]),
        foot: [['', '', '', '', '', '', 'TOTAL:', 'Rs. ' + fmtNum(totalTax), 'Rs. ' + fmtNum(totalAmt)]],
        margin: { left: L, right: 14 },
        styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 2, textColor: 0, valign: 'middle', lineColor: 0, lineWidth: 0.2 },
        headStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold', fontSize: 6.8, lineWidth: 0.25 },
        footStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold', fontSize: 7, lineWidth: 0.25 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 42 },
            2: { halign: 'center', cellWidth: 20 }, 3: { halign: 'center', cellWidth: 12 },
            4: { halign: 'center', cellWidth: 22 }, 5: { halign: 'center', cellWidth: 16 },
            6: { halign: 'center', cellWidth: 18 }, 7: { halign: 'center', cellWidth: 22 },
            8: { halign: 'center', cellWidth: 22 },
        },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    const words = numWords(Math.round(totalAmt)) || '';
    const wordLines = doc.splitTextToSize(`Amount in Words: ${words}`, 182 - 8);
    doc.rect(L, y, R - L, wordLines.length * 4.2 + 5);
    doc.text(wordLines, L + 3, y + 5.2);
    y += wordLines.length * 4.2 + 5;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.rect(L, y, R - L, 8);
    doc.text(`From ${f.coName}`, L + 3, y + 5.5);
    y += 14;

    // Sold By footer
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Sold By :', L, y); y += 4.2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(f.coName || '-', L, y); y += 4;
    const coAddrLines = splitAddrCommaLines(f.coAddr, 55);
    doc.text(coAddrLines, L, y);
    const leftFinalY = y + coAddrLines.length * 3.6;

    let py = y - 4;
    if (f.coPan) { doc.text(`PAN No: ${f.coPan}`, R, py, { align: 'right' }); py += 4; }
    if (f.coGst) { doc.text(`GST Registration No: ${f.coGst}`, R, py, { align: 'right' }); py += 4; }
    if (f.coCin) { doc.text(`CIN No: ${f.coCin}`, R, py, { align: 'right' }); py += 4; }

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXPaybuzz(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const PAGE_W = 9360;
    const itemWidths = [700, 2260, 1100, 700, 1200, 900, 1000, 1200, 1300];
    const fmtNum = (n: any) => cleanNum(n).toFixed(2);

    let body = '';
    body += wPTheme('Tax Invoice', { bold: true, size: 15 });
    body += wPTheme('(Original for Recipient)', { size: 8.5 });
    body += wPTheme('');
    body += wPTheme(f.coName, { bold: true, size: 12, align: 'right' });
    body += wPTheme(`Invoice Number: ${invNum}`, { size: 8, align: 'right' });
    body += wPTheme(`Invoice Date: ${f.invDate}`, { size: 8, align: 'right' });
    body += wPTheme(`Order Date: ${f.orderDate}`, { size: 8, align: 'right' });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['Billing Address', 'Shipping Address:'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 8 }) +
        wTRTheme(
            [
                [f.merchantName, ...splitAddrCommaLines(f.fullBillAddr, 45)].join('\n'),
                [f.shipName, ...splitAddrCommaLines(f.fullShipAddr, 45)].join('\n'),
            ],
            [PAGE_W / 2, PAGE_W / 2], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total Amount'],
            itemWidths, { bold: true, size: 6.5, align: 'center' }) +
        lines.map((l: any, idx: number) => wTRTheme(
            [String(idx + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)],
            itemWidths, { size: 6.5, align: 'center' }
        )).join('') +
        wTRTheme(['', '', '', '', '', '', 'TOTAL:', '₹' + fmtNum(totalTax), '₹' + fmtNum(totalAmt)],
            itemWidths, { bold: true, size: 7, align: 'center' }),
        PAGE_W
    );
    body += wPTheme('');

    body += wPTheme(`Amount in Words: ${numWords(Math.round(totalAmt))}`, { bold: true, size: 8 });
    body += wPTheme(`From ${f.coName}`, { size: 8 });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(
            [
                ['Sold By :', f.coName, ...splitAddrCommaLines(f.coAddr, 55)].join('\n'),
                [
                    f.coPan ? `PAN No: ${f.coPan}` : '',
                    f.coGst ? `GST Registration No: ${f.coGst}` : '',
                    f.coCin ? `CIN No: ${f.coCin}` : '',
                ].filter(Boolean).join('\n'),
            ],
            [PAGE_W * 0.6, PAGE_W * 0.4], { size: 8, align: 'right' }
        ),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}