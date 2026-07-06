// ═══════════════════════════════════════════════════════════════
// lib/invoice/gst.ts
// Verbatim extraction of the GST ENGINE section from invoice-app.ts.
// calcGST and getProductLines are byte-identical to the original.
// getGSTInfo's math is untouched — the ONLY change is that `company`
// is now a third argument instead of being read from S.company.
// ═══════════════════════════════════════════════════════════════

import { cleanNum } from './utils';

export function calcGST(totalAmount: any, gstRate: any, sellerState: any, buyerState: any) {
  const rate = cleanNum(gstRate) || 18;
  const total = cleanNum(totalAmount);
  const base = parseFloat((total / (1 + rate / 100)).toFixed(2));
  const tax = parseFloat((total - base).toFixed(2));
  const sA = (sellerState || '').toLowerCase().trim();
  const sB = (buyerState || '').toLowerCase().trim();
  const sameState = sA && sB && sA === sB;
  if (sameState) {
    const half = parseFloat((tax / 2).toFixed(2));
    return { base, total, rate, taxType: 'CGST+SGST', cgst: half, sgst: half, igst: 0, taxLabel: `CGST ${rate / 2}% + SGST ${rate / 2}%`, taxAmt: tax, isSame: true };
  } else {
    return { base, total, rate, taxType: 'IGST', cgst: 0, sgst: 0, igst: tax, taxLabel: `IGST ${rate}%`, taxAmt: tax, isSame: false };
  }
}

export function getProductLines(row: any) {
  if (Array.isArray(row._products) && row._products.length) return row._products;
  const qty = cleanNum(row['_qty']) || 1;
  return [{
    description: row['_description'] || 'Settlement Pay',
    qty,
    amount: cleanNum(row['Transaction Amount']) * qty,
  }];
}

// Only signature change vs. the original: `company` is now the 3rd
// argument instead of `S.company` read via closure. Every calculation
// below — the reverse-GST split, the same-state/inter-state decision,
// the qty-aware line totals — is unchanged.
export function getGSTInfo(row: any, profile: any, company: any) {
  const co = company || {};
  const p = profile || {};
  const rate = cleanNum(row['_gstRate'] ?? co.defaultGstRate ?? 18);
  const sellerState = co.state || '';
  const buyerState = row['_billState'] || p.state || '';

  const lines = getProductLines(row).map((item: any) => {
    const qty = cleanNum(item.qty) || 1;
    const amount = parseFloat(cleanNum(item.amount).toFixed(2));
    return {
      description: item.description,
      qty,
      unitPrice: qty ? parseFloat((amount / qty).toFixed(2)) : amount,
      base: amount,
      taxAmt: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: amount,
    };
  });

  const invoiceTotal = parseFloat(lines.reduce((s: number, l: any) => s + l.total, 0).toFixed(2));
  const invoiceGST = calcGST(invoiceTotal, rate, sellerState, buyerState);
  const totalQty = lines.reduce((s: number, l: any) => s + l.qty, 0);

  return {
    lines,
    rate,
    total: invoiceGST.total,
    base: invoiceGST.base,
    taxAmt: invoiceGST.taxAmt,
    cgst: invoiceGST.cgst,
    sgst: invoiceGST.sgst,
    igst: invoiceGST.igst,
    taxType: invoiceGST.taxType,
    taxLabel: invoiceGST.taxLabel,
    isSame: invoiceGST.isSame,
    qty: totalQty,
    unitAmount: lines.length ? lines[0].unitPrice : 0,
    unitPrice: lines.length ? lines[0].unitPrice : 0,
  };
}