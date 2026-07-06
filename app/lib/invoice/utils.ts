    // ═══════════════════════════════════════════════════════════════
// lib/invoice/utils.ts
// Verbatim extraction from invoice-app.ts's UTILS and INVOICE NUMBER
// / FILE NAME GENERATION sections. Every function body below is
// byte-identical to the original EXCEPT getLogoSrc, which took no
// arguments before (it read `S.company` via closure) and now takes
// `company` explicitly — the only signature change in this file.
// ═══════════════════════════════════════════════════════════════

export const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const uid = () =>
  (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2, 18);

export const fmt = (ts: number) =>
  new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const cleanNum = (v: any) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).replace(/[₹,\s]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

export const fmtINR = (n: any) =>
  '₹' + cleanNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function wrapAddressLines(addr: string, maxLineLen?: number) {
  if (!addr) return '';
  maxLineLen = maxLineLen || 45;
  const parts = String(addr).split(',').map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  let cur: string[] = [], curLen = 0;
  parts.forEach(p => {
    if (curLen + p.length > maxLineLen! && cur.length) {
      lines.push(cur.join(', '));
      cur = []; curLen = 0;
    }
    cur.push(p); curLen += p.length + 2;
  });
  if (cur.length) lines.push(cur.join(', '));
  return lines.map(esc).join(',<br>');
}

export function pickAddressBlock(
  rowAddr: any, rowCity: any, rowState: any, rowPin: any,
  fbAddr: any, fbCity: any, fbState: any, fbPin: any
) {
  const hasRow = !!(String(rowAddr || '').trim() || String(rowCity || '').trim() || String(rowState || '').trim() || String(rowPin || '').trim());
  return hasRow
    ? { address: rowAddr || '', city: rowCity || '', state: rowState || '', pin: rowPin || '' }
    : { address: fbAddr || '', city: fbCity || '', state: fbState || '', pin: fbPin || '' };
}

export function b64ToBlob(d: string, mime: string) {
  if (!d) return null;
  const bin = atob(d.split(',')[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export const b64 = (blob: Blob | null): Promise<string | null> =>
  new Promise((res, rej) => {
    if (!blob) return res(null);
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

export async function urlToDataURL(url: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await b64(blob);
  } catch (e) {
    console.warn('Could not fetch logo for PDF embedding:', e);
    return null;
  }
}

export function numWords(n: number) {
  n = Math.round(n);
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return 'Zero';
  function words(num: number): string {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? ' ' + a[num % 10] : '');
    if (num < 1000) return a[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + words(num % 100) : '');
    if (num < 100000) return words(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + words(num % 1000) : '');
    if (num < 10000000) return words(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + words(num % 100000) : '');
    return words(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + words(num % 10000000) : '');
  }
  return words(n) + ' Only';
}

export function genInvNum(row: any) {
  if (row['_invNum']) return row['_invNum'];
  let settlementId = String(row['Seller Settlement Records ID'] || '').trim();
  if (!settlementId) {
    const baseId = String(uid()).slice(-8);
    return 'INV-' + baseId;
  }
  if (settlementId.startsWith('41')) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    settlementId = mm + yy + settlementId.slice(4);
  }
  return 'INV-' + settlementId;
}

export function parseDate(raw: any) {
  if (!raw) return '';
  if (raw instanceof Date) return raw.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (typeof raw === 'number' && raw > 1000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const m = s.match(/(\d+)\/(\d+)\/(\d+)/);
  if (m) return `${String(m[1]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${m[3]}`;
  return s;
}

// Only signature change in this file: `company` is now an explicit
// argument instead of being read from S.company via closure.
export function getLogoSrc(company: any) {
  const co = company || {};
  return co.logoUrl || co.logoB64 || null;
}

export function getProfileLogo(profile: any) {
  if (!profile) return null;
  return profile.logoUrl || profile.logoB64 || null;
}

export function sanitizeFileBase(s: any) {
  return String(s || '').replace(/[^a-zA-Z0-9\-_]/g, '_');
}

export function genFileName(row: any) {
  const settlementId = String(row['Seller Settlement Records ID'] || '').trim();
  const base = settlementId ? ('INV-' + settlementId) : genInvNum(row);
  return sanitizeFileBase(base);
}

export function triggerDL(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}