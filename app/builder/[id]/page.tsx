'use client';

// ═══════════════════════════════════════════════════════════════
// app/builder/[id]/page.tsx — v2
//
// Same data model / same resolution logic as before (row-id or
// merchant-profile-id, dbLoadRows / dbLoadDraftInvoice fallback).
// What changed: the invoice PREVIEW is now the editor. Buyer,
// shipping, dates, products (with drag-reorder), GST rate and
// notes are all edited directly on the invoice paper. The old
// tabbed right rail is gone — Save / PDF / DOCX / status live in
// the top toolbar, and the left rail is just the merchant switcher.
// Export still calls tpl.buildPDF / tpl.buildDOCX exactly as before.
// ═══════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
  getSupabaseClient, dbLoadCompany, dbLoadProfiles, dbLoadRows, dbSaveRows,
  dbLoadDraftInvoice, dbSaveDraftInvoice, matchProfile, makeDraftRow,
} from '../../lib/invoice/db';
import { getGSTInfo } from '../../lib/invoice/gst';
import { resolveTemplate } from '../../lib/invoice/template';
import { fmtINR, cleanNum, numWords, genInvNum, uid, getLogoSrc, getProfileLogo } from '../../lib/invoice/utils';

type Product = { id: string; description: string; hsn: string; qty: number; rate: number; discount: number; amount: number };
type DraftRow = { [key: string]: any; _products: Product[] };

function recalcProduct(p: Product): Product {
  const amount = Math.max(0, (p.qty || 0) * (p.rate || 0) - (p.discount || 0));
  return { ...p, amount: parseFloat(amount.toFixed(2)) };
}

type Action =
  | { type: 'SET_FIELD'; field: string; value: any }
  | { type: 'SET_PRODUCT_FIELD'; index: number; field: keyof Product; value: any }
  | { type: 'ADD_PRODUCT' }
  | { type: 'DELETE_PRODUCT'; index: number }
  | { type: 'DUPLICATE_PRODUCT'; index: number }
  | { type: 'REORDER_PRODUCTS'; oldIndex: number; newIndex: number }
  | { type: 'SET_SHIP_SAME'; value: boolean }
  | { type: 'REPLACE'; row: DraftRow };

function reducer(state: DraftRow, action: Action): DraftRow {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_PRODUCT_FIELD': {
      const products = state._products.map((p, i) =>
        i === action.index ? recalcProduct({ ...p, [action.field]: action.value } as Product) : p
      );
      return { ...state, _products: products };
    }
    case 'ADD_PRODUCT': {
      const p = recalcProduct({ id: uid(), description: '', hsn: '', qty: 1, rate: 0, discount: 0, amount: 0 });
      return { ...state, _products: [...state._products, p] };
    }
    case 'DELETE_PRODUCT': {
      if (state._products.length <= 1) return state;
      return { ...state, _products: state._products.filter((_, i) => i !== action.index) };
    }
    case 'DUPLICATE_PRODUCT': {
      const copy = { ...state._products[action.index], id: uid() };
      const products = [...state._products];
      products.splice(action.index + 1, 0, copy);
      return { ...state, _products: products };
    }
    case 'REORDER_PRODUCTS':
      return { ...state, _products: arrayMove(state._products, action.oldIndex, action.newIndex) };
    case 'SET_SHIP_SAME': {
      if (!action.value) return { ...state, _shipSameAsBilling: false };
      return {
        ...state,
        _shipSameAsBilling: true,
        _shipName: state._billName, _shipAddress: state._billAddress,
        _shipCity: state._billCity, _shipState: state._billState, _shipPin: state._billPin,
      };
    }
    case 'REPLACE':
      return action.row;
    default:
      return state;
  }
}

/* ═══════════════════════════════════════════════
   TINY EDITABLE PRIMITIVES — styled to sit invisibly
   on the white invoice paper until hovered/focused.
═══════════════════════════════════════════════ */
function PField({ value, onChange, placeholder, className = '', style, as = 'input', rows }: {
  value: any; onChange: (v: string) => void; placeholder?: string; className?: string;
  style?: React.CSSProperties; as?: 'input' | 'textarea'; rows?: number;
}) {
  if (as === 'textarea') {
    return (
      <textarea
        className={`pi-field pi-textarea ${className}`}
        value={value ?? ''}
        placeholder={placeholder}
        rows={rows || 2}
        style={style}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className={`pi-field ${className}`}
      value={value ?? ''}
      placeholder={placeholder}
      style={style}
      onChange={e => onChange(e.target.value)}
    />
  );
}

function EditableProductRow({ p, index, dispatch, canDelete }: {
  p: Product; index: number; dispatch: React.Dispatch<Action>; canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    background: isDragging ? '#f2f6ff' : undefined,
  };
  const set = (field: keyof Product) => (v: string) =>
    dispatch({ type: 'SET_PRODUCT_FIELD', index, field, value: field === 'description' || field === 'hsn' ? v : cleanNum(v) });

  return (
    <tr ref={setNodeRef} style={style} className="pi-row">
      <td className="pi-drag" {...attributes} {...listeners} title="Drag to reorder">⠿</td>
      <td style={{ textAlign: 'left' }}>
        <PField value={p.description} onChange={set('description')} placeholder="Item description" />
        <PField value={p.hsn} onChange={set('hsn')} placeholder="HSN/SAC" className="pi-hsn" />
      </td>
      <td><PField value={p.qty} onChange={set('qty')} className="pi-num" /></td>
      <td><PField value={p.rate} onChange={set('rate')} className="pi-num" /></td>
      <td><PField value={p.discount} onChange={set('discount')} className="pi-num" /></td>
      <td className="pi-amount">{fmtINR(p.amount)}</td>
      <td className="pi-rowactions">
        <button className="pi-icon-btn" title="Duplicate" onClick={() => dispatch({ type: 'DUPLICATE_PRODUCT', index })}>⧉</button>
        <button className="pi-icon-btn danger" title="Delete" disabled={!canDelete} onClick={() => dispatch({ type: 'DELETE_PRODUCT', index })}>✕</button>
      </td>
    </tr>
  );
}

type TabKey = 'products' | 'gst';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'products', label: 'Products' },
  { key: 'gst', label: 'GST' },
];

export default function BuilderPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [source, setSource] = useState<'row' | 'profile' | null>(null);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [merchantFilter, setMerchantFilter] = useState('');

  const [row, dispatch] = useReducer(reducer, null as unknown as DraftRow);
  const baselineRef = useRef<string>('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  const supa = useMemo(() => getSupabaseClient(), []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [co, profs, rowsData] = await Promise.all([
          dbLoadCompany(supa), dbLoadProfiles(supa), dbLoadRows(supa),
        ]);
        if (cancelled) return;
        setCompany(co);
        setProfiles(profs);
        setAllRows(rowsData.rows || []);
        setFileName(rowsData.fileName || null);

        const foundRow = (rowsData.rows || []).find((r: any) => r.id === id);
        let loadedRow: DraftRow;
        if (foundRow) {
          const matched = profs.find((p: any) => matchProfile(p, foundRow['Seller Name']));
          if (!foundRow._products || !foundRow._products.length) {
            foundRow._products = [{
              id: uid(), description: foundRow['_description'] || 'Settlement Pay', hsn: '',
              qty: cleanNum(foundRow['_qty']) || 1, rate: cleanNum(foundRow['Transaction Amount']),
              discount: 0, amount: cleanNum(foundRow['Transaction Amount']) * (cleanNum(foundRow['_qty']) || 1),
            }];
          }
          if (foundRow._shipSameAsBilling === undefined) foundRow._shipSameAsBilling = true;
          setProfile(matched || null);
          setSource('row');
          loadedRow = foundRow;
        } else {
          const matchedProfile = profs.find((p: any) => p.id === id);
          if (!matchedProfile) {
            setError('No row or merchant profile matches this link.');
            setLoading(false);
            return;
          }
          let draft = await dbLoadDraftInvoice(supa, matchedProfile.id);
          if (!draft) draft = makeDraftRow(matchedProfile, co);
          if (draft._shipSameAsBilling === undefined) draft._shipSameAsBilling = true;
          setProfile(matchedProfile);
          setSource('profile');
          loadedRow = draft;
        }
        dispatch({ type: 'REPLACE', row: loadedRow });
        baselineRef.current = JSON.stringify(loadedRow);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load invoice.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const invNum = useMemo(() => (row ? row['_invNum'] || genInvNum(row) : ''), [row]);
  const tpl = useMemo(() => resolveTemplate(profile, company), [profile, company]);
  const gst = useMemo(() => (row ? getGSTInfo(row, profile, company) : null), [row, profile, company]);
  const companyLogo = useMemo(() => getLogoSrc(company), [company]);
  const merchantLogo = useMemo(() => (profile ? getProfileLogo(profile) : null), [profile]);

  const dirty = row ? JSON.stringify(row) !== baselineRef.current : false;

  const setField = (field: string) => (v: string) => dispatch({ type: 'SET_FIELD', field, value: v });

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = row._products.findIndex((p: Product) => p.id === active.id);
    const newIndex = row._products.findIndex((p: Product) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    dispatch({ type: 'REORDER_PRODUCTS', oldIndex, newIndex });
  }, [row]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (source === 'row') {
        const updatedRows = allRows.map((r: any) => (r.id === row.id ? row : r));
        await dbSaveRows(supa, updatedRows, fileName);
        setAllRows(updatedRows);
      } else if (source === 'profile' && profile) {
        await dbSaveDraftInvoice(supa, profile.id, row);
      }
      baselineRef.current = JSON.stringify(row);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [source, allRows, row, fileName, profile, supa]);

  async function handleExport(kind: 'pdf' | 'docx') {
    setExporting(kind);
    try {
      const { triggerDL } = await import('../../lib/invoice/utils');
      if (kind === 'pdf') {
        const blob = await tpl.buildPDF(row, profile, invNum);
        triggerDL(blob, (row._invNum || invNum) + '.pdf');
      } else {
        const blob = await tpl.buildDOCX(row, profile, invNum);
        triggerDL(blob, (row._invNum || invNum) + '.docx');
      }
    } catch (e: any) {
      setError(e?.message || 'Export failed.');
    } finally {
      setExporting(null);
    }
  }

  // Ctrl/Cmd+S to save, and warn on unload if there are unsaved edits
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving) handleSave();
      }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, saving, handleSave]);

  function switchProfile(profileId: string) {
    if (dirty && !confirm('You have unsaved changes on this invoice. Switch merchants anyway?')) return;
    router.push(`/builder/${profileId}`);
  }

  const [tab, setTab] = useState<TabKey>('gst');

  if (loading) {
    return <div className="ib3-status">Loading invoice…</div>;
  }
  if (error || !row) {
    return (
      <div className="ib3-status">
        <p>{error || 'Invoice not found.'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => router.push('/')}>← Back to app</button>
      </div>
    );
  }

  const filteredProfiles = profiles.filter((p: any) => p.name.toLowerCase().includes(merchantFilter.toLowerCase()));

  return (
    <div className="ib3-root">
      <style>{IB3_STYLES}</style>

      <aside className="ib3-nav">
        <div className="logo" style={{ marginBottom: 20 }}>
          <div className="logo-mark">Fidy<span>Invoice</span></div>
          <div className="logo-sub">Invoice Builder</div>
        </div>
        <div className="ib3-nav-item" onClick={() => router.push('/')}>🧾 Back to App</div>
        <div className="nav-sep" />
        <div className="ib3-left-head">Merchants</div>
        <input
          className="ib3-merchant-search"
          placeholder="Search merchants…"
          value={merchantFilter}
          onChange={e => setMerchantFilter(e.target.value)}
        />
        <div className="ib3-merchant-list">
          {filteredProfiles.map((p: any) => (
            <div key={p.id} className={'ib3-merchant-item' + (p.id === profile?.id ? ' active' : '')} onClick={() => switchProfile(p.id)}>
              <span className="ib3-dot" /><span>{p.name}</span>
            </div>
          ))}
          {!filteredProfiles.length && <div className="ib3-nomatch">No merchants match.</div>}
        </div>
      </aside>

      <main className="ib3-center">
        <div className="ib3-toolbar">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge badge-dim">{tpl.label} template</span>
            <span className="badge badge-blue">{row._invNum || invNum}</span>
            <span className="badge badge-dim">{source === 'row' ? 'From Excel row' : 'Merchant draft'}</span>
            {dirty
              ? <span className="badge badge-amber">● Unsaved changes</span>
              : savedAt && <span className="badge badge-green">✓ Saved</span>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? '💾 Save' : '✓ Saved'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleExport('pdf')} disabled={exporting !== null}>{exporting === 'pdf' ? 'Exporting…' : '⬇ PDF'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleExport('docx')} disabled={exporting !== null}>{exporting === 'docx' ? 'Exporting…' : '⬇ DOCX'}</button>
          </div>
        </div>

        <div className="ib3-preview-scroll">
          <div className="inv-paper pi-paper">
            {/* ── Header ── */}
            <div className="inv-top">
              <div className="inv-title-block">
                <h2>Tax Invoice</h2>
                <p>(Original for Recipient)</p>
              </div>
              <div className="inv-logo">
                {merchantLogo
                  ? <img src={merchantLogo} alt="" style={{ maxHeight: 44, maxWidth: 200, objectFit: 'contain' }} />
                  : companyLogo
                    ? <img src={companyLogo} alt="" style={{ maxHeight: 44, maxWidth: 200, objectFit: 'contain' }} />
                    : <span>{company?.name || 'Your Company'}</span>}
              </div>
            </div>

            <div className="inv-meta">
              <div>
                <span>Invoice Number:</span>
                <PField value={row._invNum} onChange={setField('_invNum')} placeholder={invNum} className="pi-inline pi-strong" />
              </div>
              <div>
                <span>Transaction Date:</span>
                <PField value={row['Transaction Date']} onChange={setField('Transaction Date')} placeholder="DD/MM/YYYY" className="pi-inline" />
              </div>
              <div>
                <span>Settlement / Ref ID:</span>
                <PField value={row['Seller Settlement Records ID']} onChange={setField('Seller Settlement Records ID')} className="pi-inline" />
              </div>
              <div>
                <span>UTR Number:</span>
                <PField value={row['Transaction UTR Number']} onChange={setField('Transaction UTR Number')} className="pi-inline" />
              </div>
            </div>

            <hr className="inv-rule" />

            {/* ── Billing / Shipping ── */}
            <div className="inv-addr-stack">
              <div className="inv-addr-block">
                <div className="inv-addr-label">Billing Address</div>
                <div className="inv-addr-body">
                  <PField value={row._billName} onChange={setField('_billName')} placeholder="Buyer name" className="pi-strong pi-block" />
                  <PField as="textarea" rows={2} value={row._billAddress} onChange={setField('_billAddress')} placeholder="Address" className="pi-block" />
                  <div className="pi-grid3">
                    <PField value={row._billCity} onChange={setField('_billCity')} placeholder="City" />
                    <PField value={row._billState} onChange={setField('_billState')} placeholder="State" />
                    <PField value={row._billPin} onChange={setField('_billPin')} placeholder="PIN" />
                  </div>
                  <div className="pi-grid2">
                    <PField value={row._billGST} onChange={setField('_billGST')} placeholder="GST Number" />
                    <PField value={row._billPAN} onChange={setField('_billPAN')} placeholder="PAN Number" />
                  </div>
                </div>
              </div>

              <div className="inv-addr-block ship">
                <div className="inv-addr-label" style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                  <label className="pi-checkbox">
                    <input
                      type="checkbox"
                      checked={!!row._shipSameAsBilling}
                      onChange={e => dispatch({ type: 'SET_SHIP_SAME', value: e.target.checked })}
                    />
                    Same as billing
                  </label>
                  Shipping Address
                </div>
                {row._shipSameAsBilling ? (
                  <div className="inv-addr-body" style={{ opacity: 0.55 }}>
                    <b>{row._billName || '—'}</b>
                    <div>{row._billAddress || '—'}</div>
                    <div>{[row._billCity, row._billState, row._billPin].filter(Boolean).join(', ')}</div>
                  </div>
                ) : (
                  <div className="inv-addr-body">
                    <PField value={row._shipName} onChange={setField('_shipName')} placeholder="Recipient name" className="pi-strong pi-block" style={{ textAlign: 'right' }} />
                    <PField as="textarea" rows={2} value={row._shipAddress} onChange={setField('_shipAddress')} placeholder="Address" className="pi-block" style={{ textAlign: 'right' }} />
                    <div className="pi-grid3">
                      <PField value={row._shipCity} onChange={setField('_shipCity')} placeholder="City" />
                      <PField value={row._shipState} onChange={setField('_shipState')} placeholder="State" />
                      <PField value={row._shipPin} onChange={setField('_shipPin')} placeholder="PIN" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Products ── */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <table className="inv-table pi-table">
                <thead>
                  <tr><th></th><th>Description</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Amount</th><th></th></tr>
                </thead>
                <tbody>
                  <SortableContext items={row._products.map((p: Product) => p.id)} strategy={verticalListSortingStrategy}>
                    {row._products.map((p: Product, i: number) => (
                      <EditableProductRow key={p.id} p={p} index={i} dispatch={dispatch} canDelete={row._products.length > 1} />
                    ))}
                  </SortableContext>
                </tbody>
                <tfoot>
                  <tr><td colSpan={5}>TOTAL:</td><td colSpan={2}>{gst ? fmtINR(gst.total) : '—'}</td></tr>
                </tfoot>
              </table>
            </DndContext>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 4, marginBottom: 18 }} onClick={() => dispatch({ type: 'ADD_PRODUCT' })}>+ Add product</button>

            {/* ── Totals + GST ── */}
            {gst && (
              <table className="inv-totals pi-totals">
                <tbody>
                  <tr><td>Base Amount</td><td>{fmtINR(gst.base)}</td></tr>
                  <tr>
                    <td>
                      GST Rate:&nbsp;
                      <select
                        className="pi-select"
                        value={row._gstRate ?? company?.defaultGstRate ?? 18}
                        onChange={e => dispatch({ type: 'SET_FIELD', field: '_gstRate', value: cleanNum(e.target.value) })}
                      >
                        <option value={0}>0% Exempt</option>
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18%</option>
                        <option value={28}>28%</option>
                      </select>
                    </td>
                    <td>{gst.isSame ? fmtINR(gst.cgst + gst.sgst) : fmtINR(gst.igst)}</td>
                  </tr>
                  {gst.isSame ? (
                    <tr><td style={{ color: '#888' }}>— CGST {gst.rate / 2}% + SGST {gst.rate / 2}%</td><td /></tr>
                  ) : (
                    <tr><td style={{ color: '#888' }}>— IGST {gst.rate}% (inter-state)</td><td /></tr>
                  )}
                  <tr className="total-final"><td>Total</td><td>{fmtINR(gst.total)}</td></tr>
                </tbody>
              </table>
            )}
            {gst && <div className="inv-words">Amount in Words: {numWords(gst.total)}</div>}

            {/* ── Notes / Terms ── */}
            <div className="pi-notes-grid">
              <div>
                <div className="inv-addr-label">Notes</div>
                <PField as="textarea" rows={3} value={row._notes} onChange={setField('_notes')} placeholder="Add a note for the buyer (optional)" className="pi-block" />
              </div>
              <div>
                <div className="inv-addr-label">Terms &amp; Conditions</div>
                <PField as="textarea" rows={3} value={row._terms} onChange={setField('_terms')} placeholder="Payment / return terms (optional)" className="pi-block" />
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="inv-footer">
              <div className="inv-sold-by">
                <div className="co-name">{company?.name || 'Your Company'}</div>
                <div>{company?.address}</div>
                <div>{[company?.city, company?.state, company?.pin].filter(Boolean).join(', ')}</div>
                {company?.gst && <div>GST: {company.gst}</div>}
                {company?.pan && <div>PAN: {company.pan}</div>}
              </div>
              <div className="inv-sign">
                <div className="sig-line" />
                <div className="sig-name">{company?.signatory || 'Authorised Signatory'}</div>
                <div>{company?.designation || ''}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const IB3_STYLES = `
/* ── invoice paper (self-contained: don't rely on global CSS reaching this route) ── */
.inv-paper { background: #fff; color: #111; border-radius: 8px; padding: 40px 48px; max-width: 820px; margin: 0 auto; box-shadow: 0 8px 40px rgba(0,0,0,0.5); font-family: 'Arial', sans-serif; font-size: 10.5px; line-height: 1.4; }
.inv-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.inv-title-block h2 { font-size: 17px; font-weight: 900; color: #111; margin-bottom: 1px; }
.inv-title-block p { font-size: 10px; color: #555; }
.inv-logo { font-size: 22px; font-weight: 900; color: #111; letter-spacing: -0.5px; text-align: right; max-width: 220px; display: flex; justify-content: flex-end; align-items: flex-start; }
.inv-meta { text-align: right; font-size: 10px; color: #333; margin-bottom: 16px; }
.inv-meta div { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 3px; align-items: center; }
hr.inv-rule { border: none; border-top: 1.5px solid #222; margin: 18px 0; }
.inv-addr-stack { display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; gap: 14px; margin: 14px 0; }
.inv-addr-block { max-width: 60%; flex: 1; }
.inv-addr-block.ship { text-align: right; }
.inv-addr-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #777; margin-bottom: 5px; border-bottom: 1px solid #e2e2e2; padding-bottom: 4px; }
.inv-addr-body { font-size: 10.5px; color: #222; line-height: 1.75; word-break: break-word; }
.inv-addr-body b { font-size: 11.5px; }
table.inv-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10px; table-layout: fixed; color: #222; }
table.inv-table th { background: #f2f2f2; border: 1px solid #ccc; padding: 9px 8px; text-align: center; font-weight: 700; font-size: 9.5px; color: #333; }
table.inv-table th:nth-child(2) { text-align: left; }
table.inv-table td { border: 1px solid #ddd; padding: 7px 8px; vertical-align: top; text-align: center; }
table.inv-table td:nth-child(2) { text-align: left; }
table.inv-table tr:nth-child(even) td { background: #fafafa; }
table.inv-table tfoot td { text-align: right; font-weight: 700; }
.inv-totals { margin-left: auto; width: 320px; border-collapse: collapse; margin-top: 16px; color: #222; }
.inv-totals td { padding: 5px 8px; font-size: 10px; border: none; font-variant-numeric: tabular-nums; }
.inv-totals td:first-child { text-align: left; color: #444; }
.inv-totals td:last-child { text-align: right; font-weight: 600; }
.inv-totals .total-final td { font-weight: 800; font-size: 12px; border-top: 2px solid #111; padding-top: 7px; }
.inv-words { font-size: 10.5px; background: #f9f9f9; border: 1px solid #ddd; padding: 10px 14px; margin: 10px 0; border-radius: 4px; color: #222; }
.inv-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 28px; padding-top: 18px; border-top: 1px solid #ddd; gap: 24px; }
.inv-sold-by { font-size: 9.5px; color: #333; line-height: 1.7; flex: 1; min-width: 0; }
.inv-sold-by .co-name { font-size: 11px; font-weight: 700; color: #111; margin-bottom: 3px; }
.inv-sign { text-align: right; font-size: 9.5px; color: #555; flex-shrink: 0; min-width: 150px; }
.inv-sign .sig-line { width: 130px; border-bottom: 1.5px solid #333; height: 36px; margin-left: auto; margin-bottom: 5px; }
.inv-sign .sig-name { font-weight: 700; font-size: 11px; color: #111; }

.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.badge-green { background: #0d2b1e; color: #3ecf8e; border: 1px solid #1a4f35; }
.badge-amber { background: #2b1e08; color: #f5a623; border: 1px solid #4a3010; }
.badge-blue { background: var(--accent-glow); color: var(--accent); border: 1px solid #1f3a80; }
.badge-dim { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
.btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; font-family: inherit; }
.btn-ghost { background: transparent; border: 1px solid var(--border2); color: var(--text); }
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-ghost:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: #3d6be6; }
.btn-sm { padding: 6px 12px; font-size: 12px; }

.ib3-root { position: fixed; inset: 0; display: flex; background: var(--bg); color: var(--text); }
.ib3-status { display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; height: 100vh; color: var(--muted); }

.ib3-nav { width: 224px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); padding: 20px 16px; display: flex; flex-direction: column; overflow-y: auto; }
.ib3-nav-item { padding: 9px 10px; border-radius: 8px; font-size: 13px; color: var(--muted); cursor: pointer; margin-bottom: 4px; transition: background .15s, color .15s; }
.ib3-nav-item:hover { background: var(--surface2); color: var(--text); }
.ib3-left-head { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; margin: 10px 0 8px; }
.ib3-merchant-search { width: 100%; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-radius: 7px; padding: 7px 10px; font-size: 12px; margin-bottom: 10px; outline: none; }
.ib3-merchant-search:focus { border-color: var(--accent); }
.ib3-merchant-list { display: flex; flex-direction: column; gap: 2px; }
.ib3-merchant-item { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 7px; font-size: 12.5px; color: var(--muted); cursor: pointer; transition: background .15s, color .15s; }
.ib3-merchant-item:hover { background: var(--surface2); color: var(--text); }
.ib3-merchant-item.active { background: var(--accent-glow); color: var(--accent); font-weight: 600; }
.ib3-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; flex-shrink: 0; }
.ib3-nomatch { font-size: 11.5px; color: var(--dim); padding: 8px 4px; }

.ib3-center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ib3-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; gap: 10px; position: sticky; top: 0; z-index: 5; }
.ib3-preview-scroll { flex: 1; overflow-y: auto; padding: 32px 28px; background: #232833; }

/* ── editable-on-paper primitives ── */
.pi-paper { position: relative; }
.pi-field { font-family: inherit; color: inherit; background: transparent; border: none; border-bottom: 1px dashed transparent; border-radius: 3px; padding: 1px 3px; outline: none; transition: background .15s, border-color .15s; width: 100%; }
.pi-field:hover { background: rgba(79,127,255,0.06); border-bottom-color: #c7d3ef; }
.pi-field:focus { background: rgba(79,127,255,0.09); border-bottom-color: #4f7fff; }
.pi-field::placeholder { color: #b7bcc8; }
.pi-textarea { resize: vertical; line-height: 1.5; }
.pi-inline { display: inline-block; width: auto; min-width: 110px; font-weight: 600; margin-left: 4px; }
.pi-strong { font-weight: 700; font-size: 11.5px; }
.pi-block { display: block; margin: 2px 0; }
.pi-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 3px; }
.pi-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-top: 3px; }
.pi-checkbox { display: inline-flex; align-items: center; gap: 4px; font-weight: 400; font-size: 9px; text-transform: none; letter-spacing: 0; color: #999; cursor: pointer; }
.pi-checkbox input { cursor: pointer; }

.pi-table td, .pi-table th { position: relative; }
.pi-row:hover { background: #fbfcff; }
.pi-drag { cursor: grab; color: #bbb; width: 18px; text-align: center; font-size: 12px; }
.pi-num .pi-field { text-align: right; }
.pi-hsn { font-size: 9px; color: #999; margin-top: 2px; }
.pi-amount { font-weight: 700; text-align: right; white-space: nowrap; }
.pi-rowactions { white-space: nowrap; }
.pi-icon-btn { border: none; background: transparent; color: #aaa; font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 4px; }
.pi-icon-btn:hover { background: #eef1f8; color: #333; }
.pi-icon-btn.danger:hover { background: #fdeaea; color: #c33; }
.pi-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.pi-select { font-family: inherit; font-size: 10px; border: 1px solid #ddd; border-radius: 4px; padding: 1px 4px; background: #fff; }
.pi-totals td:first-child { display: flex; align-items: center; }
.pi-notes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 18px; padding-top: 14px; border-top: 1px dashed #ddd; }
.pi-notes-grid textarea { font-size: 10.5px; border: 1px solid transparent; }
.pi-notes-grid textarea:hover, .pi-notes-grid textarea:focus { border-color: #dde3f5; }
`;