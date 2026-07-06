// ═══════════════════════════════════════════════════════════════
// lib/invoice/db.ts
// Verbatim extraction of SUPABASE CONFIG / DB HELPERS / STORAGE
// HELPERS from invoice-app.ts. Every db* function's SQL/query logic
// is unchanged — the only change is that `supa` (the Supabase client)
// is now a parameter instead of a closure variable, since this module
// has no closure to read it from.
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { uid } from './utils';

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPA_URL || 'https://sabdnoadpwpirirqljkx.supabase.co';
export const SUPA_KEY = process.env.NEXT_PUBLIC_SUPA_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYmRub2FkcHdwaXJpcnFsamt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDYwNDYsImV4cCI6MjA5Nzc4MjA0Nn0.Z4YhL0REBTUBfd1GMNzTJGeANo-Lf1TV7MAMeSkZpMs';
export const BUCKET = 'invoice-files';

export function getSupabaseClient() {
  return createClient(SUPA_URL, SUPA_KEY);
}


export async function dbSaveInvoice(supa: any, obj: any) {
  const { error } = await supa.from('invoices').upsert({
    id: obj.id,
    inv_num: obj.invNum,
    merchant: obj.merchant,
    amount: obj.amount,
    utr: obj.utr,
    settlement_id: obj.settlementId,
    pdf_url: obj.pdfUrl || null,
    docx_url: obj.docxUrl || null,
    row_data: obj._row || null,
    saved_at: new Date(obj.savedAt).toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function dbLoadInvoices(supa: any) {
  const { data, error } = await supa.from('invoices').select('*').order('saved_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id, invNum: r.inv_num, merchant: r.merchant, amount: r.amount, utr: r.utr,
    settlementId: r.settlement_id, pdfUrl: r.pdf_url, docxUrl: r.docx_url,
    savedAt: new Date(r.saved_at).getTime(), _row: r.row_data,
  }));
}

export async function dbDeleteInvoice(supa: any, id: string, pdfUrl?: string | null, docxUrl?: string | null) {
  const paths: string[] = [];
  if (pdfUrl) paths.push(pdfUrl.split('/invoice-files/')[1]);
  if (docxUrl) paths.push(docxUrl.split('/invoice-files/')[1]);
  if (paths.length) await supa.storage.from(BUCKET).remove(paths);
  const { error } = await supa.from('invoices').delete().eq('id', id);
  if (error) throw error;
}

export async function dbClearInvoices(supa: any) {
  const { data: files } = await supa.storage.from(BUCKET).list('invoices');
  if (files && files.length) {
    const paths = files.map((f: any) => 'invoices/' + f.name);
    await supa.storage.from(BUCKET).remove(paths);
  }
  const { error } = await supa.from('invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

/* ── settlement_uploads (rows) ──────────────────────────────── */
export const ROWS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

export async function dbSaveRows(supa: any, rows: any[], fileName?: string | null) {
  const payload = {
    id: ROWS_SINGLETON_ID,
    file_name: fileName || null,
    row_count: rows.length,
    rows,
    uploaded_at: new Date().toISOString(),
  };
  const { error } = await supa.from('settlement_uploads').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
}

export async function dbLoadRows(supa: any) {
  const { data, error } = await supa.from('settlement_uploads').select('*').eq('id', ROWS_SINGLETON_ID).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return { rows: [], fileName: null };
  return { rows: data.rows || [], fileName: data.file_name || null };
}

export async function dbClearRows(supa: any) {
  const { error } = await supa.from('settlement_uploads').delete().eq('id', ROWS_SINGLETON_ID);
  if (error) throw error;
}

/* ── merchant_profiles ──────────────────────────────────────── */
export async function dbSaveProfiles(supa: any, profiles: any[]) {
  await supa.from('merchant_profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (!profiles.length) return;
  const rows = profiles.map((p: any) => ({
    id: p.id, name: p.name, seller_id: p.sellerId || null, gst: p.gst || null, pan: p.pan || null,
    cin: p.cin || null, email: p.email || null, address: p.address || null, city: p.city || null,
    state: p.state || null, pin: p.pin || null, logo_url: p.logoUrl || null, template: p.template || 'default',
  }));
  const { error } = await supa.from('merchant_profiles').insert(rows);
  if (error) throw error;
}

export async function dbLoadProfiles(supa: any) {
  const { data, error } = await supa.from('merchant_profiles').select('*').order('name');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id, name: r.name, sellerId: r.seller_id, gst: r.gst, pan: r.pan, cin: r.cin, email: r.email,
    address: r.address, city: r.city, state: r.state, pin: r.pin, logoUrl: r.logo_url, logoB64: null,
    template: r.template || 'default',
  }));
}

/* ── company_settings ───────────────────────────────────────── */
export async function dbSaveCompany(supa: any, co: any) {
  let logoUrl = co.logoUrl || null;
  if (co.logoB64 && co.logoB64.startsWith('data:')) {
    try { logoUrl = await uploadLogoToStorage(supa, co.logoB64); }
    catch (e) { console.warn('Logo upload failed, storing URL as-is', e); }
  }
  const payload = {
    id: '00000000-0000-0000-0000-000000000001',
    name: co.name || null, pan: co.pan || null, gst: co.gst || null, cin: co.cin || null,
    email: co.email || null, phone: co.phone || null, address: co.address || null, city: co.city || null,
    state: co.state || null, pin: co.pin || null, signatory: co.signatory || null,
    designation: co.designation || null, default_gst_rate: co.defaultGstRate ?? 18,
    logo_url: logoUrl, updated_at: new Date().toISOString(),
  };
  const { error } = await supa.from('company_settings').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
  return logoUrl;
}

export async function dbLoadCompany(supa: any) {
  const { data, error } = await supa.from('company_settings').select('*').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  return {
    name: data.name, pan: data.pan, gst: data.gst, cin: data.cin, email: data.email, phone: data.phone,
    address: data.address, city: data.city, state: data.state, pin: data.pin, signatory: data.signatory,
    designation: data.designation, defaultGstRate: data.default_gst_rate, logoUrl: data.logo_url, logoB64: null,
  };
}


const DRAFTS_TABLE = 'invoice_drafts';

export async function dbLoadDraftInvoice(supa: any, profileId: string) {
  const { data, error } = await supa.from(DRAFTS_TABLE).select('*').eq('profile_id', profileId).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data ? data.row_data : null;
}

export async function dbSaveDraftInvoice(supa: any, profileId: string, rowData: any) {
  const { error } = await supa.from(DRAFTS_TABLE).upsert({
    profile_id: profileId, row_data: rowData, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' });
  if (error) throw error;
}

/* ── storage ─────────────────────────────────────────────────── */
export function b64ToBlobLocal(d: string, mime: string) {
  const bin = atob(d.split(',')[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function uploadToStorage(supa: any, blob: Blob, path: string, mime: string) {
  const { error } = await supa.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: true });
  if (error) throw error;
  const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

export async function uploadLogoToStorage(supa: any, base64: string) {
  const mime = base64.split(';')[0].split(':')[1] || 'image/png';
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('svg') ? 'svg' : 'png';
  const blob = b64ToBlobLocal(base64, mime);
  return uploadToStorage(supa, blob as Blob, `logos/company-logo.${ext}`, mime);
}

export async function uploadProfileLogoToStorage(supa: any, base64: string, profileId: string) {
  const mime = base64.split(';')[0].split(':')[1] || 'image/png';
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('svg') ? 'svg' : 'png';
  const blob = b64ToBlobLocal(base64, mime);
  return uploadToStorage(supa, blob as Blob, `logos/profile-${profileId}.${ext}`, mime);
}

export async function uploadInvoiceFiles(supa: any, invNum: string, pdfBlob: Blob | null, docxBlob: Blob | null) {
  const safe = invNum.replace(/[^a-zA-Z0-9\-_]/g, '_');
  let pdfUrl = null, docxUrl = null;
  if (pdfBlob) pdfUrl = await uploadToStorage(supa, pdfBlob, `invoices/${safe}.pdf`, 'application/pdf');
  if (docxBlob) docxUrl = await uploadToStorage(supa, docxBlob, `invoices/${safe}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return { pdfUrl, docxUrl };
}

/* ── matching + drafts ───────────────────────────────────────── */
export function matchProfile(profile: any, sellerName: any) {
  if (!profile || !sellerName) return false;
  const a = String(profile.name || '').toLowerCase().trim();
  const b = String(sellerName || '').toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function makeDraftRow(profile: any, company: any): any {
  const co = company || {};
  return {
    id: uid(),
    'Seller Name': profile.name || '',
    'Seller Settlement Records ID': '',
    'Transaction UTR Number': '',
    'Transaction Reference Number': '',
    'Transaction Date': new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    'Transaction Amount': 0,
    _qty: 1,
    _gstRate: co.defaultGstRate ?? 18,
    _description: '',
    _invNum: '',
    _billName: profile.name || '',
    _billAddress: profile.address || '',
    _billCity: profile.city || '',
    _billState: profile.state || '',
    _billPin: profile.pin || '',
    _billGST: profile.gst || '',
    _billPAN: profile.pan || '',
    _shipName: profile.name || '',
    _shipAddress: profile.address || '',
    _shipCity: profile.city || '',
    _shipState: profile.state || '',
    _shipPin: profile.pin || '',
    _logoB64: null,
    _logoUrl: profile.logoUrl || null,
    _notes: '',
    _terms: '',
    _products: [{ id: uid(), description: '', hsn: '', qty: 1, rate: 0, discount: 0, amount: 0 }],
  };
}