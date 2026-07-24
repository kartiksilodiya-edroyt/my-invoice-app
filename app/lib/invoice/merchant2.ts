// ═══════════════════════════════════════════════════════════════
// lib/invoice/merchant2.ts
// MERCHANT 2 — "Boxed Grid" style. Strict black & white. Every
// section lives inside its own bordered box (like a form), double
// rule under the masthead, address blocks as bordered two-column
// cells, item table + totals fused into one outer-bordered block.
// ═══════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';

// Georgia/Times fonts (both in-browser and jsPDF's built-in font) don't
// reliably render the ₹ glyph — it shows as a broken superscript mark.
// "Rs." renders correctly everywhere, so shadow fmtINR with this instead.
const fmtINR = (n: any) => 'Rs. ' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { wPTheme, wTRTheme, wTableTheme } from './builder';

function splitAddrCommaLines(addr: string, maxLineLen = 42): string[] {
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
export function buildInvoiceHTMLMerchant2(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:38px;max-width:150px;object-fit:contain;filter:grayscale(1);" alt="logo">`
        : `<span style="font-size:18px;font-weight:900;">${esc(f.coName)}</span>`;

    const cell = (v: any, align = 'left', extra = '') => `<td style="padding:5px 6px;border:1px solid #000;text-align:${align};${extra}">${v}</td>`;
    const rowsHTML = lines.map((l: any, i: number) => `
      <tr>
        ${cell(i + 1, 'center')}
        ${cell(esc(l.description || 'Item'))}
        ${cell(cleanNum(l.unitPrice).toFixed(2), 'center')}
        ${cell(l.qty, 'center')}
        ${cell(l.net.toFixed(2), 'center')}
        ${cell(`${gst.rate}%`, 'center')}
        ${cell(l.taxType, 'center')}
        ${cell(l.taxAmt.toFixed(2), 'center')}
        ${cell(l.lineTotal.toFixed(2), 'center', 'font-weight:700;')}
      </tr>`).join('');

    return `<div style="background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;padding:16px;font-size:8.5pt;">
  <div style="border:2px solid #000;padding:14px 18px;">

    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:2px double #000;">
      ${logoBlockHTML}
      <div style="text-align:center;flex:1;">
        <div style="font-size:14pt;font-weight:800;letter-spacing:1px;">TAX INVOICE</div>
        <div style="font-size:7.5pt;">Original for Recipient</div>
      </div>
      <div style="min-width:150px;"></div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:7.8pt;">
      <tr>
        <td style="border:1px solid #000;padding:5px 8px;width:33%;"><b>Invoice No.</b><br>${esc(invNum)}</td>
        <td style="border:1px solid #000;padding:5px 8px;width:33%;"><b>Invoice Date</b><br>${esc(f.invDate)}</td>
        <td style="border:1px solid #000;padding:5px 8px;width:34%;"><b>Order Date</b><br>${esc(f.orderDate)}</td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:8pt;">
      <tr>
        <td style="border:1px solid #000;padding:6px 8px;width:50%;vertical-align:top;">
          <div style="font-weight:700;font-size:7.5pt;text-transform:uppercase;margin-bottom:3px;">Billing Address</div>
          <div><b>${esc(f.merchantName)}</b></div>
          ${splitAddrCommaLines(f.fullBillAddr).map(l => `<div>${esc(l)}</div>`).join('')}
        </td>
        <td style="border:1px solid #000;padding:6px 8px;width:50%;vertical-align:top;">
          <div style="font-weight:700;font-size:7.5pt;text-transform:uppercase;margin-bottom:3px;">Shipping Address</div>
          <div><b>${esc(f.shipName)}</b></div>
          ${splitAddrCommaLines(f.fullShipAddr).map(l => `<div>${esc(l)}</div>`).join('')}
        </td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:7.6pt;table-layout:fixed;">
      <colgroup><col style="width:7%;"><col style="width:23%;"><col style="width:11%;"><col style="width:7%;"><col style="width:12%;"><col style="width:9%;"><col style="width:10%;"><col style="width:11%;"><col style="width:10%;"></colgroup>
      <thead>
        <tr style="background:#eee;">
          <th style="border:1px solid #000;padding:5px;">SI.No</th>
          <th style="border:1px solid #000;padding:5px;">Description</th>
          <th style="border:1px solid #000;padding:5px;">Unit Price</th>
          <th style="border:1px solid #000;padding:5px;">QTY</th>
          <th style="border:1px solid #000;padding:5px;">Net Amount</th>
          <th style="border:1px solid #000;padding:5px;">Tax Rate</th>
          <th style="border:1px solid #000;padding:5px;">Tax Type</th>
          <th style="border:1px solid #000;padding:5px;">Tax Amount</th>
          <th style="border:1px solid #000;padding:5px;">Total</th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot>
        <tr style="font-weight:700;background:#f5f5f5;">
          <td colspan="7" style="border:1px solid #000;padding:5px;text-align:center;">GRAND TOTAL</td>
          <td style="border:1px solid #000;padding:5px;text-align:center;">₹ ${totalTax.toFixed(2)}</td>
          <td style="border:1px solid #000;padding:5px;text-align:center;">₹ ${totalAmt.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:8pt;">
      <tr><td style="border:1px solid #000;padding:8px;"><b>Amount in Words:</b> ${numWords(Math.round(totalAmt))}</td></tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:7.8pt;">
      <tr>
        <td style="border:1px solid #000;padding:8px;width:58%;vertical-align:top;">
          <div style="font-weight:700;font-size:7.3pt;text-transform:uppercase;margin-bottom:2px;">Sold By</div>
          <div><b>${esc(f.coName)}</b></div>
          ${splitAddrCommaLines(f.coAddr, 55).map(l => `<div>${esc(l)}</div>`).join('')}
        </td>
        <td style="border:1px solid #000;padding:8px;width:42%;vertical-align:top;text-align:right;">
          ${f.coPan ? `<div><b>PAN No:</b> ${esc(f.coPan)}</div>` : ''}
          ${f.coGst ? `<div><b>GST Reg. No:</b> ${esc(f.coGst)}</div>` : ''}
          ${f.coCin ? `<div><b>CIN No:</b> ${esc(f.coCin)}</div>` : ''}
        </td>
      </tr>
    </table>

  </div>
</div>`;
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
export async function buildPDFMerchant2(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 12, R = 198;
    let y = 14;
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    doc.setDrawColor(0); doc.setLineWidth(0.6);
    doc.rect(L, y, R - L, 258);

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }
    let cy = y + 8;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            doc.addImage(logoSrc, imgType, L + 5, cy - 6, 40, 13, undefined, 'FAST');
        } catch (e) { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(f.coName, L + 5, cy); }
    } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(f.coName, L + 5, cy);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('TAX INVOICE', 105, cy - 2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text('Original for Recipient', 105, cy + 3, { align: 'center' });

    y += 14;
    doc.setLineWidth(0.5);
    doc.line(L, y, R, y);
    y += 2;
    doc.setLineWidth(0.2);
    doc.line(L, y, R, y);
    y += 6;

    const thirdW = (R - L) / 3;
    doc.rect(L, y, thirdW, 12); doc.rect(L + thirdW, y, thirdW, 12); doc.rect(L + thirdW * 2, y, thirdW, 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text('Invoice No.', L + 3, y + 4);
    doc.text('Invoice Date', L + thirdW + 3, y + 4);
    doc.text('Order Date', L + thirdW * 2 + 3, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(invNum, L + 3, y + 9);
    doc.text(f.invDate || '-', L + thirdW + 3, y + 9);
    doc.text(f.orderDate || '-', L + thirdW * 2 + 3, y + 9);
    y += 16;

    const halfW = (R - L) / 2;
    const billLines = splitAddrCommaLines(f.fullBillAddr);
    const shipLines = splitAddrCommaLines(f.fullShipAddr);
    const addrBoxH = Math.max(billLines.length, shipLines.length) * 3.6 + 14;
    doc.rect(L, y, halfW, addrBoxH); doc.rect(L + halfW, y, halfW, addrBoxH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.3);
    doc.text('BILLING ADDRESS', L + 3, y + 5);
    doc.text('SHIPPING ADDRESS', L + halfW + 3, y + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(f.merchantName || '-', L + 3, y + 10);
    doc.text(f.shipName || '-', L + halfW + 3, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    billLines.forEach((ln, i) => doc.text(ln, L + 3, y + 14.5 + i * 3.6));
    shipLines.forEach((ln, i) => doc.text(ln, L + halfW + 3, y + 14.5 + i * 3.6));
    y += addrBoxH + 4;

    const fmtNum = (n: any) => cleanNum(n).toFixed(2);
    autoTable(doc, {
        startY: y,
        head: [['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total']],
        body: lines.map((l: any, i: number) => [String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)]),
        foot: [[
            { content: 'GRAND TOTAL', colSpan: 7, styles: { halign: 'center' } },
            'Rs. ' + fmtNum(totalTax),
            'Rs. ' + fmtNum(totalAmt),
        ]],
        margin: { left: L, right: 12 },
        styles: { font: 'helvetica', fontSize: 6.6, cellPadding: 2, textColor: 0, valign: 'middle', lineColor: 0, lineWidth: 0.25 },
        headStyles: { fillColor: [238, 238, 238], textColor: 0, fontStyle: 'bold', fontSize: 6.6, lineWidth: 0.3 },
        footStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold', fontSize: 7, lineWidth: 0.3 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 11 }, 1: { halign: 'left', cellWidth: 40 },
            2: { halign: 'center', cellWidth: 19 }, 3: { halign: 'center', cellWidth: 11 },
            4: { halign: 'center', cellWidth: 21 }, 5: { halign: 'center', cellWidth: 15 },
            6: { halign: 'center', cellWidth: 17 }, 7: { halign: 'center', cellWidth: 21 },
            8: { halign: 'center', cellWidth: 21 },
        },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    doc.rect(L, y, R - L, 9);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(`Amount in Words: ${numWords(Math.round(totalAmt))}`, L + 3, y + 5.8);
    y += 13;

    const soldW = (R - L) * 0.58;
    const panW = (R - L) - soldW;
    doc.rect(L, y, soldW, 26); doc.rect(L + soldW, y, panW, 26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.3);
    doc.text('SOLD BY', L + 3, y + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(f.coName || '', L + 3, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    const coAddrLines = splitAddrCommaLines(f.coAddr, 55);
    doc.text(coAddrLines, L + 3, y + 14.5);

    let py = y + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    if (f.coPan) { doc.text(`PAN No: ${f.coPan}`, R - 3, py, { align: 'right' }); py += 4; }
    if (f.coGst) { doc.text(`GST Reg. No: ${f.coGst}`, R - 3, py, { align: 'right' }); py += 4; }
    if (f.coCin) { doc.text(`CIN No: ${f.coCin}`, R - 3, py, { align: 'right' }); py += 4; }

    return doc.output('blob');
}

/* ═══════════════════════════════ DOCX ═══════════════════════════════ */
export async function buildDOCXMerchant2(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const lines = withLineTax(gst);
    const totalTax = lines.reduce((s: number, l: any) => s + l.taxAmt, 0);
    const totalAmt = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);

    const PAGE_W = 9360;
    const itemWidths = [700, 2260, 1100, 700, 1200, 900, 1000, 1200, 1300];
    const fmtNum = (n: any) => cleanNum(n).toFixed(2);

    let body = '';
    body += wPTheme('TAX INVOICE', { bold: true, size: 15, align: 'center' });
    body += wPTheme('Original for Recipient', { size: 8, align: 'center' });
    body += wPTheme(f.coName, { bold: true, size: 12 });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme([`Invoice No.: ${invNum}`, `Invoice Date: ${f.invDate}`, `Order Date: ${f.orderDate}`], [PAGE_W / 3, PAGE_W / 3, PAGE_W / 3], { size: 8, bold: true }),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['BILLING ADDRESS', 'SHIPPING ADDRESS'], [PAGE_W / 2, PAGE_W / 2], { bold: true, size: 7.5 }) +
        wTRTheme(
            [[f.merchantName, ...splitAddrCommaLines(f.fullBillAddr)].join('\n'), [f.shipName, ...splitAddrCommaLines(f.fullShipAddr)].join('\n')],
            [PAGE_W / 2, PAGE_W / 2], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(['SI.No', 'Description', 'Unit Price', 'QTY', 'Net Amount', 'Tax Rate', 'Tax Type', 'Tax Amount', 'Total'], itemWidths, { bold: true, size: 6.5, align: 'center', shade: 'EEEEEE' }) +
        lines.map((l: any, i: number) => wTRTheme([String(i + 1), l.description || 'Item', fmtNum(l.unitPrice), String(l.qty), fmtNum(l.net), `${gst.rate}%`, l.taxType, fmtNum(l.taxAmt), fmtNum(l.lineTotal)], itemWidths, { size: 6.5, align: 'center' })).join('') +
        wTRTheme(['GRAND TOTAL', '', '', '', '', '', '', '₹' + fmtNum(totalTax), '₹' + fmtNum(totalAmt)], itemWidths, { bold: true, size: 7, align: 'center', shade: 'F5F5F5' }),
        PAGE_W
    );
    body += wPTheme('');
    body += wPTheme(`Amount in Words: ${numWords(Math.round(totalAmt))}`, { bold: true, size: 8 });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(
            [
                ['SOLD BY', f.coName, ...splitAddrCommaLines(f.coAddr, 55)].join('\n'),
                [f.coPan ? `PAN No: ${f.coPan}` : '', f.coGst ? `GST Reg. No: ${f.coGst}` : '', f.coCin ? `CIN No: ${f.coCin}` : ''].filter(Boolean).join('\n'),
            ],
            [PAGE_W * 0.58, PAGE_W * 0.42], { size: 8, align: 'right' }
        ),
        PAGE_W
    );

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}