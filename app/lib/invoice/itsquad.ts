import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { getGSTInfo } from './gst';
import {
    esc, cleanNum, fmtINR, numWords, parseDate,
    pickAddressBlock, getProfileLogo, getLogoSrc, urlToDataURL,
} from './utils';
import { wPTheme, wTRTheme, wTableTheme } from './builder';

function extractFields(row: any, profile: any, company: any) {
    const co = company || {};
    const p = profile || {};
    const formatAddr = (a: any, c: any, s: any, p: any) => [a, c, s, p].filter(Boolean).join(', ');

    const merchantName = row['_billName'] || p.name || '';
    const merchantGST = row['_billGST'] || p.gst || '';
    const bill = pickAddressBlock(row['_billAddress'], row['_billCity'], row['_billState'], row['_billPin'], p.address, p.city, p.state, p.pin);
    const fullBillAddr = formatAddr(bill.address, bill.city, bill.state, bill.pin);

    const shipName = row['_shipName'] || merchantName;
    const ship = pickAddressBlock(row['_shipAddress'], row['_shipCity'], row['_shipState'], row['_shipPin'], bill.address, bill.city, bill.state, bill.pin);
    const fullShipAddr = formatAddr(ship.address, ship.city, ship.state, ship.pin);

    const isProfile = !!p.name;
    const coName = isProfile ? p.name : (co.name || '');
    const coAddr = isProfile ? formatAddr(p.address, p.city, p.state, p.pin) : formatAddr(co.address, co.city, co.state, co.pin);
    const coPhone = isProfile ? (p.phone || '') : (co.phone || '');
    const coPan = isProfile ? (p.pan || '') : (co.pan || '');
    const coGst = isProfile ? (p.gst || '') : (co.gst || '');
    const coCin = isProfile ? (p.cin || '') : (co.cin || '');
    const coFssai = isProfile ? (p.fssai || '') : (co.fssai || '');
    const coDl = isProfile ? (p.dlNo || p.dl || '') : (co.dlNo || co.dl || '');

    const orderId = row['Seller Settlement Records ID'] || row['Transaction UTR Number'] || '';
    const orderDate = parseDate(row['Transaction Date']);
    const billTime = row['_billTime'] || row['Transaction Time'] || '';
    //const drName = row['_drName'] || row['Doctor Name'] || '';
    const ptAddress = fullBillAddr;

    const logoSrc = row['_logoB64'] || row['_logoUrl'] || getProfileLogo(profile) || getLogoSrc(company);

    return {
        merchantName, merchantGST, fullBillAddr, shipName, fullShipAddr,
        coName, coAddr, coPhone, coPan, coGst, coCin, coFssai, coDl,
        orderId, orderDate, billTime, ptAddress, logoSrc,
    };
}

export function buildInvoiceHTMLItsquad(row: any, profile: any, invNum: string, company: any) {
    if (row['_invNum']) invNum = row['_invNum'];
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

    const logoBlockHTML = f.logoSrc
        ? `<img src="${f.logoSrc}" style="max-height:26px;max-width:110px;object-fit:contain;" alt="logo">`
        : '';

    // ---- Item rows: Qty | Product | HSN | Model No | Warranty | MRP | Gross | Dis% | GST% | Amount
const rowsHTML = gst.lines.map((item: any, idx: number) => {
    const amount = item.base; // already GST-inclusive — do NOT add tax again
    const unitPrice = item.qty ? amount / item.qty : amount;
    return `<tr>
    <td style="padding:8px 6px;text-align:center;">${idx + 1}</td>
    <td style="padding:8px 6px;">${esc(item.description || 'Item')}</td>
    <td style="padding:8px 6px;text-align:right;">${fmtINR(unitPrice).replace('Rs. ', '')}</td>
    <td style="padding:8px 6px;text-align:center;">${item.qty}</td>
    <td style="padding:8px 6px;text-align:right;font-weight:700;">${fmtINR(amount).replace('Rs. ', '')}</td>
  </tr>`;
}).join('');

    return `<div style="
background:#fff;
color:#111;
border:1.5px solid #333;
font-family:Arial,Helvetica,sans-serif;
padding:14px 16px;
font-size:8pt;
line-height:1.35;
">

  <div style="text-align:center;font-size:12pt;font-weight:700;letter-spacing:.5px;margin-bottom:8px;">
    TAX INVOICE
  </div>

<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:8px;">
    <div style="flex:1; max-width:65%;">
      ${logoBlockHTML ? `<div style="margin-bottom:5px;">${logoBlockHTML}</div>` : ''}
      <div style="font-size:12pt;font-weight:800;letter-spacing:.3px; word-break: break-word;">${esc(f.coName)}</div>
      ${f.coAddr ? `<div style="font-size:7.5pt;">${esc(f.coAddr)}</div>` : ''}
      ${f.coGst ? `<div style="font-size:7.5pt;"><b>GSTIN:</b> ${esc(f.coGst)}</div>` : ''}
    </div>
    <div style="flex-shrink:0; text-align:right; font-size:7.8pt; line-height:1.6; margin-left:15px;">
      <div><b>Invoice No.:</b> ${esc(invNum)}</div>
      <div><b>Date:</b> ${esc(f.orderDate)}</div>
      ${f.billTime ? `<div><b>Time:</b> ${esc(f.billTime)}</div>` : ''}
      ${f.orderId ? `<div><b>Order ID:</b> ${esc(f.orderId)}</div>` : ''}
    </div>
</div>

<div style="border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:8px;font-size:8pt;line-height:1.6;">
    <div style="margin-bottom:5px;"><b>Customer Name:</b> ${esc(f.merchantName)}</div>
    <div style="display:flex;gap:14px;">
      <div style="flex:1;">
        <b>Billing Address:</b><br>${esc(f.fullBillAddr)}
      </div>
      <div style="flex:1;border-left:1px solid #ccc;padding-left:14px;">
        <b>Shipping Address:</b><br>${esc(f.fullShipAddr)}
      </div>
    </div>
  </div>

<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:14px;">
  <thead><tr style="background:#f2f2f2;font-weight:bold;border-bottom:1px solid #333;">
    <th style="padding:8px 6px;width:50px;">Sl. No</th>
    <th style="padding:8px 6px;text-align:left;">Description</th>
    <th style="padding:8px 6px;">Unit Price</th>
    <th style="padding:8px 6px;">QTY</th>
    <th style="padding:8px 6px;">Amount</th>
  </tr></thead>
  <tbody>${rowsHTML}</tbody>
  <tfoot>
    <tr style="background:#f7f7f7;font-weight:700;border-top:1px solid #333;">
      <td colSpan="4" style="padding:8px 6px;text-align:right;">TOTAL:</td>
      <td style="padding:8px 6px;text-align:right;">${fmtINR(gst.total).replace('Rs. ', '')}</td>
    </tr>
  </tfoot>
</table>

  <div style="display:flex;justify-content:flex-end;margin-top:10px;">
    <div style="width:260px;font-size:10.5px;line-height:1.9;">
      <div style="display:flex;justify-content:space-between;"><span>Base Amount</span><span>${fmtINR(gst.base)}</span></div>
      ${gst.isSame
        ? `<div style="display:flex;justify-content:space-between;"><span>CGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.cgst)}</span></div>
           <div style="display:flex;justify-content:space-between;"><span>SGST @ ${gst.rate / 2}%</span><span>${fmtINR(gst.sgst)}</span></div>`
        : `<div style="display:flex;justify-content:space-between;"><span>IGST @ ${gst.rate}%</span><span>${fmtINR(gst.igst)}</span></div>`
      }
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:12px;border-top:2px solid #111;margin-top:4px;padding-top:5px;">
        <span>Total</span><span>${fmtINR(gst.total)}</span>
      </div>
    </div>
  </div>

  <div style="font-size:10px;background:#f9f9f9;border:1px solid #ddd;padding:8px 12px;border-radius:4px;margin-top:14px;margin-bottom:8px;">Amount in Words: ${numWords(Math.round(gst.total))}</div>
  <div style="font-size:11px;font-weight:800;color:#111;margin-bottom:34px;">From ${esc(f.coName)}</div>

  <div style="display:flex;justify-content:flex-end;">
    <div style="text-align:center;min-width:180px;">
      <div style="border-top:1px solid #333;padding-top:4px;font-size:10px;">Authorized Signatory</div>
    </div>
  </div>

</div>`;
}

export async function buildPDFItsquad(row: any, profile: any, invNum: string, company: any) {
    const doc: any = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 12, R = 198, W = 186;
    let y = 14;

    const T = (text: any, x: any, y2: any, opts?: any) => {
        const safeX = Number.isFinite(x) ? x : 0;
        const safeY = Number.isFinite(y2) ? y2 : 0;
        if (Array.isArray(text)) {
            if (text.length === 0) return;
            doc.text(text, safeX, safeY, opts); // jsPDF handles string[] natively for multi-line
            return;
        }
        const safeText = (text === undefined || text === null || text === '') ? '' : String(text);
        if (!safeText) return;
        doc.text(safeText, safeX, safeY, opts);
    };

    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);
    const fmtNum = (n: any) => {
        const v = cleanNum(n);
        return Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
    };

    let logoSrc = f.logoSrc;
    if (logoSrc && !logoSrc.startsWith('data:')) {
        const dataUrl = await urlToDataURL(logoSrc);
        if (dataUrl) logoSrc = dataUrl;
    }

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    T('TAX INVOICE', 105, y, { align: 'center' });
    y += 8;

    const headerTopY = y;

    const maxLogoW = 32, maxLogoH = 12;
    let nameY = y + 5;
    if (logoSrc && logoSrc.startsWith('data:')) {
        try {
            const mime = logoSrc.split(';')[0].split(':')[1] || 'image/png';
            const imgType = mime.includes('jpeg') ? 'JPEG' : 'PNG';
            let drawW = maxLogoW, drawH = maxLogoH;
            try {
                const props = doc.getImageProperties(logoSrc);
                const ratio = props?.width / props?.height;
                if (Number.isFinite(ratio) && ratio > 0) {
                    if (maxLogoW / ratio <= maxLogoH) { drawW = maxLogoW; drawH = maxLogoW / ratio; }
                    else { drawH = maxLogoH; drawW = maxLogoH * ratio; }
                }
            } catch (e) { /* keep fixed box */ }
            if (Number.isFinite(drawW) && Number.isFinite(drawH) && drawW > 0 && drawH > 0) {
                doc.addImage(logoSrc, imgType, L, y, drawW, drawH, undefined, 'FAST');
                nameY = y + drawH + 5;
            }
        } catch (e) { /* ignore */ }
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    T(f.coName, L, nameY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
    let ly = nameY + 4.5;
    if (f.coAddr) {
        const lines = doc.splitTextToSize(f.coAddr, 110);
        T(lines, L, ly); ly += lines.length * 3.4;
    }
    if (f.coPhone) { T(`Phone: ${f.coPhone}`, L, ly); ly += 3.6; }
    if (f.coGst) { T(`GSTIN: ${f.coGst}`, L, ly); ly += 3.6; }
    // FSSAI / DL removed — not applicable to electronics e-commerce

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    let ry = headerTopY + 2;
    T(`Invoice No.: ${invNum}`, R, ry, { align: 'right' }); ry += 4.2;
    T(`Date: ${f.orderDate || '-'}`, R, ry, { align: 'right' }); ry += 4.2;
    if (f.billTime) { T(`Time: ${f.billTime}`, R, ry, { align: 'right' }); ry += 4.2; }
    if (f.orderId) { T(`Order ID: ${f.orderId}`, R, ry, { align: 'right' }); ry += 4.2; }

    y = Math.max(ly, ry) + 3;
    doc.setDrawColor(50, 50, 50); doc.setLineWidth(0.3);
    doc.line(L, y, R, y);
    y += 5;

    // Customer details
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8);
    T('Customer Name: ', L, y);
    doc.setFont('helvetica', 'normal');
    T(f.merchantName || '-', L + 28, y);
    y += 5;

    // Billing (left) and Shipping (right) side by side — always shown
    const colW = (W - 6) / 2; // small gap between the two columns
    const billX = L;
    const shipX = L + colW + 6;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    T('Billing Address:', billX, y);
    T('Shipping Address:', shipX, y);
    y += 4;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
    const billLines = doc.splitTextToSize(f.fullBillAddr || '-', colW);
    const shipLines = doc.splitTextToSize(f.fullShipAddr || '-', colW);
    T(billLines, billX, y);
    T(shipLines, shipX, y);
    y += Math.max(billLines.length, shipLines.length) * 3.6 + 3;

    doc.setDrawColor(50, 50, 50);
    doc.line(L, y, R, y);
    y += 4;

const head = [['Sl. No', 'Description', 'Unit Price', 'QTY', 'Amount']];
const bodyRows = gst.lines.map((l: any, idx: number) => {
    const amount = l.base; // already GST-inclusive — do NOT add tax again
    const unitPrice = l.qty ? amount / l.qty : amount;
    return [String(idx + 1), l.description || 'Item', fmtNum(unitPrice), String(l.qty), fmtNum(amount)];
});

autoTable(doc, {
    startY: y,
    head, body: bodyRows,
    foot: [['', '', '', 'TOTAL:', fmtNum(gst.total)]],
    margin: { left: L, right: 12 },
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: 20,
      lineWidth: 0,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: 0,
      fontStyle: 'bold',
      lineColor: [50, 50, 50],
      lineWidth: { top: 0, left: 0, right: 0, bottom: 0.3 },
    },
    footStyles: {
      fillColor: [247, 247, 247],
      textColor: 0,
      fontStyle: 'bold',
      lineColor: [50, 50, 50],
      lineWidth: { top: 0.3, left: 0, right: 0, bottom: 0 },
    },
    bodyStyles: { lineWidth: 0 },
    columnStyles: { 0: { halign: 'center' }, 1: { halign: 'left' } },
    didParseCell: function (data: any) { if (data.column.index > 1) data.cell.styles.halign = 'right'; },
});
y = (doc as any).lastAutoTable.finalY + 8;

    const totalsLabelX = R - 55, totalsValX = R;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    T('Base Amount', totalsLabelX, y); T(fmtNum(gst.base), totalsValX, y, { align: 'right' }); y += 4.5;
    if (gst.isSame) {
      T(`CGST @ ${gst.rate / 2}%`, totalsLabelX, y); T(fmtNum(gst.cgst), totalsValX, y, { align: 'right' }); y += 4.5;
      T(`SGST @ ${gst.rate / 2}%`, totalsLabelX, y); T(fmtNum(gst.sgst), totalsValX, y, { align: 'right' }); y += 4.5;
    } else {
      T(`IGST @ ${gst.rate}%`, totalsLabelX, y); T(fmtNum(gst.igst), totalsValX, y, { align: 'right' }); y += 4.5;
    }
    doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.4);
    doc.line(totalsLabelX, y, totalsValX, y); y += 4.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    T('Total', totalsLabelX, y); T(`Rs. ${fmtNum(gst.total)}`, totalsValX, y, { align: 'right' });
    y += 8;

    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
    const words = numWords(Math.round(gst.total)) || '';
    const wordLines = doc.splitTextToSize(`Amount in Words: ${words}`, W - 8);
    const boxH = wordLines.length * 4.2 + 6;
    doc.setFillColor(247, 247, 247);
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.rect(L, y, W, boxH, 'FD');
    T(wordLines, L + 4, y + 5.5);
    y += boxH + 8;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    T(`From ${f.coName}`, L, y);
    y += 14;

    doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.4);
    doc.line(R - 55, y, R, y);
    y += 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    T(`For ${f.coName}`, R, y, { align: 'right' });
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    T('Authorized Signatory', R, y, { align: 'right' });

    return doc.output('blob');
}

export async function buildDOCXItsquad(row: any, profile: any, invNum: string, company: any) {
    const f = extractFields(row, profile, company);
    const gst = getGSTInfo(row, profile, company);

    const PAGE_W = 9360;
    const cols = ['Qty', 'Product Name', 'Hsn', 'Model No.', 'Warranty', 'MRP', 'Gross Amt', 'Dis%', 'Gst%', 'Amount'];
    const colWidths = [700, 1900, 700, 800, 700, 900, 1120, 780, 780, 980];

    const divider = wTableTheme(wTRTheme([''], [PAGE_W], { size: 2 }), PAGE_W);

    const subTotal = gst.base;

    let body = '';
    body += wPTheme('TAX INVOICE', { bold: true, size: 14, align: 'center' });
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(
            [
                [
                    f.coName,
                    f.coAddr,
                    f.coPhone ? `Phone: ${f.coPhone}` : '',
                    f.coGst ? `GSTIN: ${f.coGst}` : '',
                ].filter(Boolean).join('\n'),
                [
                    `Invoice No.: ${invNum}`,
                    `Date: ${f.orderDate}`,
                    f.billTime ? `Time: ${f.billTime}` : '',
                    f.orderId ? `Order ID: ${f.orderId}` : '',
                ].filter(Boolean).join('\n'),
            ],
            [PAGE_W * 0.62, PAGE_W * 0.38], { size: 8 }
        ),
        PAGE_W
    );
    body += wPTheme('');
    body += divider;
    body += wPTheme('');

  body += wPTheme(`Customer Name: ${f.merchantName}`, { size: 8 });
    body += wTableTheme(
        wTRTheme(
            [
                `Billing Address:\n${f.fullBillAddr}`,
                `Shipping Address:\n${f.fullShipAddr}`,
            ],
            [PAGE_W * 0.5, PAGE_W * 0.5], { size: 8 }
        ),
        PAGE_W
    );
    
    body += wPTheme('');
    body += divider;
    body += wPTheme('');

    body += wTableTheme(
        wTRTheme(cols, colWidths, { bold: true, size: 7, align: 'center' }) +
        gst.lines.map((l: any) => {
            const gross = l.base; // already GST-inclusive — do NOT add tax again
            const disPct = l.disPercent != null ? cleanNum(l.disPercent).toFixed(2) : '0.00';
            return wTRTheme(
                [
                    String(l.qty),
                    l.description || 'Item',
                    l.hsn || '-',
                    l.model || l.batch || '-',
                    l.warranty || l.exp || '-',
                    fmtINR(l.mrp != null ? l.mrp : l.base),
                    fmtINR(gross),
                    disPct,
                    cleanNum(gst.rate).toFixed(2),
                    fmtINR(gross),
                ],
                colWidths, { size: 7, align: 'center' }
            );
        }).join(''),
        PAGE_W
    );
    body += wPTheme('');
    body += divider;
    body += wPTheme('');

    body += wPTheme(`Base Amount: ${fmtINR(gst.base)}`, { size: 8, align: 'right' });
    if (gst.isSame) {
      body += wPTheme(`CGST @ ${gst.rate / 2}%: ${fmtINR(gst.cgst)}`, { size: 8, align: 'right' });
      body += wPTheme(`SGST @ ${gst.rate / 2}%: ${fmtINR(gst.sgst)}`, { size: 8, align: 'right' });
    } else {
      body += wPTheme(`IGST @ ${gst.rate}%: ${fmtINR(gst.igst)}`, { size: 8, align: 'right' });
    }
    body += wPTheme(`Total: ${fmtINR(gst.total)}`, { bold: true, size: 11, align: 'right' });
    body += wPTheme('');
    body += divider;
    body += wPTheme('');

    body += wPTheme(`Amount in Words: ${numWords(Math.round(gst.total))}`, { size: 7, bold: true });
    body += wPTheme('');
    body += wPTheme(`For ${f.coName}`, { size: 8, align: 'right' });
    body += wPTheme('');
    body += wPTheme('');
    body += wPTheme('Authorized Signatory', { size: 7.5, align: 'right' });

    const z = new JSZip();
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}