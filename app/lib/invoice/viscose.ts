// ═══════════════════════════════════════════════════════════════
// lib/invoice/viscose.ts
// VISCOSE template — matches the supplied sample exactly:
// logo top-left, "Sold By" block w/ PAN/GST/CIN, invoice meta
// top-right, Billing/Shipping stacked on the right, line-items
// table with per-line Net/Tax Rate/Tax Type/Tax Amount/Total,
// single TOTAL row, Amount in Words strip, company-name footer bar.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, fmtINR, numWords, parseDate, wrapAddressLines,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

// Wraps an address into lines broken at comma boundaries (not raw
// pixel/character width), so HTML, PDF, and DOCX all wrap identically.
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

    const orderId = row['Seller Settlement Records ID'] || row['Transaction UTR Number'] || '';
    const orderDate = parseDate(row['Transaction Date']);
    const invDate = row['_invDate'] ? parseDate(row['_invDate']) : orderDate;

    const logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);

    return {
        merchantName, fullBillAddr, shipName, fullShipAddr,
        coName, coAddr, coPan, coGst, coCin,
        orderId, orderDate, invDate, logoSrc,
    };
}

// gst.lines[].base is the RAW ENTERED amount per line (tax-inclusive,
// same convention as calcGST in gst.ts). We reverse-split it into
// net + tax the same way the invoice-level total is split, so the
// line's Total Amount always equals what was entered — never inflated.
function withLineTax(gst: any) {
    return gst.lines.map((l: any) => {
        const enteredAmt = cleanNum(l.base); // tax-inclusive, as entered
        const net = parseFloat((enteredAmt / (1 + gst.rate / 100)).toFixed(2));
        const taxAmt = parseFloat((enteredAmt - net).toFixed(2));
        return {
            ...l,
            net,
            taxAmt,
            taxType: gst.isSame ? 'CGST+SGST' : 'IGST',
            lineTotal: enteredAmt, // unchanged — this is the entered value
        };
    });
}

/* ═══════════════════════════════ HTML ═══════════════════════════════ */
export function buildInvoiceHTMLViscose(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:44px;max-width:170px;object-fit:contain;" alt="logo">`
        : `<span style="font-size:22px;font-weight:700;letter-spacing:1px;">${esc(f.coName)}</span>`;

    const cellBase = 'border:1px solid #999;padding:4px;';
    const td = (val: any, align: string) => `<td style="${cellBase}text-align:${align};">${val}</td>`;
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
        ${td(l.lineTotal.toFixed(2), 'center')}
      </tr>`).join('');

    return `<div style="
background:#fff;
color:#111;
font-family:Arial,Helvetica,sans-serif;
padding:18px 22px;
font-size:8.5pt;
line-height:1.4;
">
  <div style="text-align:center;font-size:12pt;font-weight:700;">Tax Invoice</div>
  <div style="text-align:center;font-size:8pt;color:#333;margin-bottom:10px;">(Original for Recipient)</div>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div style="flex:1;max-width:58%;">
      <div style="margin-bottom:6px;">${logoBlockHTML}</div>
      <div style="font-size:8pt;color:#333;">Sold By :</div>
      <div style="font-size:9.5pt;font-weight:700;">${esc(f.coName)}</div>
      ${f.coAddr ? splitAddrCommaLines(f.coAddr, 50).map((line: string) => `<div style="font-size:8pt;">${esc(line)}</div>`).join('') : ''}
      <div style="height:6px;"></div>
      ${f.coPan ? `<div style="font-size:8pt;">PAN No: ${esc(f.coPan)}</div>` : ''}
      ${f.coGst ? `<div style="font-size:8pt;">GST Registration No: ${esc(f.coGst)}</div>` : ''}
      ${f.coCin ? `<div style="font-size:8pt;">CIN No: ${esc(f.coCin)}</div>` : ''}
    </div>
    <div style="flex-shrink:0;text-align:right;font-size:8pt;line-height:1.7;">
      <div>Invoice Number: ${esc(invNum)}</div>
      <div>Invoice Date: ${esc(f.invDate)}</div>
      <div>Order Date: ${esc(f.orderDate)}</div>
      <div style="height:8px;"></div>
      <div style="font-weight:700;">Billing Address</div>
      <div>${esc(f.merchantName)}</div>
      <div>${esc(f.fullBillAddr)}</div>
      <div style="height:8px;"></div>
      <div style="font-weight:700;">Shipping Address:</div>
      <div>${esc(f.shipName)}</div>
      <div>${esc(f.fullShipAddr)}</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:7.8pt;">
    <thead>
      <tr style="background:#f2f2f2;">
        <th style="border:1px solid #999;padding:4px;">SI.No</th>
        <th style="border:1px solid #999;padding:4px;">Description</th>
        <th style="border:1px solid #999;padding:4px;">Unit Price</th>
        <th style="border:1px solid #999;padding:4px;">QTY</th>
        <th style="border:1px solid #999;padding:4px;">Net Amount</th>
        <th style="border:1px solid #999;padding:4px;">Tax Rate</th>
        <th style="border:1px solid #999;padding:4px;">Tax Type</th>
        <th style="border:1px solid #999;padding:4px;">Tax Amount</th>
        <th style="border:1px solid #999;padding:4px;">Total Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
    <tfoot>
      <tr style="font-weight:700;border-top:2px solid #333;">
        <td colspan="7" style="border:1px solid #999;padding:4px;text-align:center;">TOTAL:</td>
        <td style="border:1px solid #999;padding:4px;text-align:center;">₹${lines.reduce((s: number, l: any) => s + l.taxAmt, 0).toFixed(2)}</td>
        <td style="border:1px solid #999;padding:4px;text-align:center;">₹${lines.reduce((s: number, l: any) => s + l.lineTotal, 0).toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <div style="border:1px solid #ccc;padding:8px 12px;margin-top:10px;font-size:8.5pt;">
    Amount in Words: ${numWords(Math.round(gst.total))}
  </div>

  <div style="background:#f2f2f2;text-align:right;padding:8px 12px;margin-top:10px;font-weight:700;font-size:9pt;">
    ${esc(f.coName)}
  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFViscose(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 14, R = 196;
    let y = 14;

    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Tax Invoice', 105, y, { align: 'center' });
    y += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('(Original for Recipient)', 105, y, { align: 'center' });
    y += 8;

    const topY = y;

    // Logo + Sold By block (left)
    let leftY = y;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            const props = doc.getImageProperties(logoSrc);
            const ratio = props?.width / props?.height || 3;
            const drawH = 12, drawW = drawH * ratio;
            doc.addImage(logoSrc, imgType, L, leftY, Math.min(drawW, 55), drawH, undefined, 'FAST');
            leftY += drawH + 4;
        } catch (e) { /* ignore */ }
    }

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Sold By :', L, leftY); leftY += 4.2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(f.coName || '-', L, leftY); leftY += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    if (f.coAddr) {
        const addrLines = splitAddrCommaLines(f.coAddr, 50);
        doc.text(addrLines, L, leftY); leftY += addrLines.length * 3.6;
    }
    leftY += 2;
    if (f.coPan) { doc.text(`PAN No: ${f.coPan}`, L, leftY); leftY += 4; }
    if (f.coGst) { doc.text(`GST Registration No: ${f.coGst}`, L, leftY); leftY += 4; }
    if (f.coCin) { doc.text(`CIN No: ${f.coCin}`, L, leftY); leftY += 4; }

    // Right block: invoice meta + billing + shipping
    let ry = topY;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Invoice Number: ${invNum}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Invoice Date: ${f.invDate || '-'}`, R, ry, { align: 'right' }); ry += 4;
    doc.text(`Order Date: ${f.orderDate || '-'}`, R, ry, { align: 'right' }); ry += 7;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Billing Address', R, ry, { align: 'right' }); ry += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', R, ry, { align: 'right' }); ry += 3.8;
    const billLines = doc.splitTextToSize(f.fullBillAddr || '-', 85);
    billLines.forEach((ln: string) => { doc.text(ln, R, ry, { align: 'right' }); ry += 3.6; });
    ry += 3;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Shipping Address:', R, ry, { align: 'right' }); ry += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(f.shipName || '-', R, ry, { align: 'right' }); ry += 3.8;
    const shipLines = doc.splitTextToSize(f.fullShipAddr || '-', 85);
    shipLines.forEach((ln: string) => { doc.text(ln, R, ry, { align: 'right' }); ry += 3.6; });

    y = Math.max(leftY, ry) + 6;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total Amount']],
        body: lines.map((l: any, i: number) => [
            String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty),
            fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal),
        ]),
        foot: [['', '', '', '', '', '', 'TOTAL:',
            fmtNum(lines.reduce((s: number, l: any) => s + l.taxAmt, 0)),
            fmtNum(lines.reduce((s: number, l: any) => s + l.lineTotal, 0)),
        ]],
        margin: { left: L, right: 14 },
        styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 2, textColor: 20, valign: 'middle', lineColor: 150, lineWidth: 0.15 },
        headStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold', fontSize: 6.8 },
        footStyles: { fillColor: 255, textColor: 20, fontStyle: 'bold', fontSize: 7, lineWidth: 0.3 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'left', cellWidth: 42 },
            2: { halign: 'center', cellWidth: 20 }, 3: { halign: 'center', cellWidth: 12 },
            4: { halign: 'center', cellWidth: 22 }, 5: { halign: 'center', cellWidth: 16 },
            6: { halign: 'center', cellWidth: 18 }, 7: { halign: 'center', cellWidth: 22 },
            8: { halign: 'center', cellWidth: 22 },
        },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const words = numWords(Math.round(gst.total)) || '';
    const wordLines = doc.splitTextToSize(`Amount in Words: ${words}`, 182 - 8);
    doc.setDrawColor(200); doc.setLineWidth(0.3);
    doc.rect(L, y, R - L, wordLines.length * 4.2 + 5);
    doc.text(wordLines, L + 3, y + 5.2);
    y += wordLines.length * 4.2 + 5 + 5;

    doc.setFillColor(242, 242, 242);
    doc.rect(L, y, R - L, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(f.coName || '', R - 3, y + 5.5, { align: 'right' });

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXViscose(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);

    const PAGE_W = 9360;
    const itemWidths = [700, 2260, 1100, 700, 1200, 900, 1000, 1200, 1300];
    const fmtNum = (n: any) => cleanNum(n).toFixed(2);

    let body = '';
    body += wPTheme('Tax Invoice', { bold: true, size: 13, align: 'center' });
    body += wPTheme('(Original for Recipient)', { size: 8, align: 'center' });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(
            [
                [
                    'Sold By :',
                    f.coName,
                    f.coAddr,
                    f.coPan ? `PAN No: ${f.coPan}` : '',
                    f.coGst ? `GST Registration No: ${f.coGst}` : '',
                    f.coCin ? `CIN No: ${f.coCin}` : '',
                ].filter(Boolean).join('\n'),
                [
                    `Invoice Number: ${invNum}`,
                    `Invoice Date: ${f.invDate}`,
                    `Order Date: ${f.orderDate}`,
                    '',
                    'Billing Address',
                    f.merchantName,
                    f.fullBillAddr,
                    '',
                    'Shipping Address:',
                    f.shipName,
                    f.fullShipAddr,
                ].filter((x, idx, arr) => x !== '' || (idx > 0 && arr[idx - 1] !== '')).join('\n'),
            ],
            [PAGE_W * 0.55, PAGE_W * 0.45], { size: 7.5, align: 'right' }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total Amount'],
            itemWidths, { bold: true, size: 6.5, align: 'center', shade: 'F2F2F2' }) +
        lines.map((l: any, idx: number) => wTRTheme(
            [String(idx + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)],
            itemWidths, { size: 6.5, align: 'center' }
        )).join('') +
        wTRTheme(['', '', '', '', '', '', 'TOTAL:', fmtNum(gst.taxAmt), fmtNum(gst.total)],
            itemWidths, { bold: true, size: 7, align: 'right' }),
        PAGE_W
    );
    body += wPTheme('');

    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 8 });
    body += wPTheme('');
    body += wTableTheme(
        wTRTheme([f.coName], [PAGE_W], { bold: true, size: 9, align: 'right', shade: 'F2F2F2' }),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}