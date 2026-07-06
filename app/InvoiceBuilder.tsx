'use client';

// ═══════════════════════════════════════════════════════════════
// InvoiceBuilder.tsx — NEW FILE. Phase 2.
//
// This component does NOT reimplement GST math, invoice HTML, PDF,
// or DOCX generation. Every calculation and every export call is
// delegated to the SAME functions invoice-app.ts already uses
// (getGSTInfo, calcGST, resolveTemplate().buildPDF/buildDOCX, etc.),
// passed in via the `api` prop. This component only owns: draft
// state, the spreadsheet-style product editor, and the layout.
//
// It is mounted by invoice-app.ts via `createRoot(...).render(...)`
// from inside initApp()'s closure — see the openInvoiceBuilder()
// patch for invoice-app.ts. That's what lets this component call
// the real getGSTInfo/calcGST without any of those functions being
// exported or moved.
// ═══════════════════════════════════════════════════════════════

import React, { useMemo, useReducer, useState } from 'react';

export type Product = {
  id: string;
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  discount: number;
  amount: number; // authoritative GST-inclusive line total — this is the
                   // only field getGSTInfo()/getProductLines() actually
                   // read. qty/rate/discount/hsn exist purely for this
                   // editor's UI and are ignored by the untouched engine.
};

export type DraftRow = {
  [key: string]: any;
  _products: Product[];
};

export interface InvoiceBuilderAPI {
  company: any;
  profiles: any[];
  activeProfileId: string;
  getGSTInfo: (row: any, profile: any) => any;
  numWords: (n: number) => string;
  fmtINR: (n: any) => string;
  cleanNum: (v: any) => number;
  genInvNum: (row: any) => string;
  parseDate: (raw: any) => string;
  buildHTML: (row: any, profile: any, invNum: string) => string;
  templateLabel: string;
  onExportPDF: (row: DraftRow, invNum: string) => Promise<void>;
  onExportDOCX: (row: DraftRow, invNum: string) => Promise<void>;
  onSave: (row: DraftRow) => Promise<void>;
  onSwitchProfile: (profileId: string) => void;
  onClose: () => void;
}

export interface InvoiceBuilderProps {
  initialRow: DraftRow;
  profile: any;
  api: InvoiceBuilderAPI;
}

function newId(): string {
  return typeof crypto !== 'undefined' && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : Math.random().toString(36).slice(2, 10);
}

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
  | { type: 'MOVE_PRODUCT'; index: number; dir: -1 | 1 }
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
      const p = recalcProduct({ id: newId(), description: '', hsn: '', qty: 1, rate: 0, discount: 0, amount: 0 });
      return { ...state, _products: [...state._products, p] };
    }
    case 'DELETE_PRODUCT': {
      if (state._products.length <= 1) return state; // always keep at least one line
      return { ...state, _products: state._products.filter((_, i) => i !== action.index) };
    }
    case 'DUPLICATE_PRODUCT': {
      const copy = { ...state._products[action.index], id: newId() };
      const products = [...state._products];
      products.splice(action.index + 1, 0, copy);
      return { ...state, _products: products };
    }
    case 'MOVE_PRODUCT': {
      const newIdx = action.index + action.dir;
      if (newIdx < 0 || newIdx >= state._products.length) return state;
      const products = [...state._products];
      [products[action.index], products[newIdx]] = [products[newIdx], products[action.index]];
      return { ...state, _products: products };
    }
    case 'REPLACE':
      return action.row;
    default:
      return state;
  }
}

type TabKey = 'details' | 'buyer' | 'shipping' | 'products' | 'gst' | 'notes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'details', label: 'Invoice Details' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'products', label: 'Products' },
  { key: 'gst', label: 'GST' },
  { key: 'notes', label: 'Notes & Terms' },
];

export default function InvoiceBuilder({ initialRow, profile, api }: InvoiceBuilderProps) {
  const [row, dispatch] = useReducer(reducer, initialRow);
  const [tab, setTab] = useState<TabKey>('details');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  const set = (field: string) => (value: any) => dispatch({ type: 'SET_FIELD', field, value });
  const setInput = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    dispatch({ type: 'SET_FIELD', field, value: e.target.value });
  const setNumInput = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    dispatch({ type: 'SET_FIELD', field, value: api.cleanNum(e.target.value) });

  const invNum = useMemo(() => row['_invNum'] || api.genInvNum(row), [row, api]);
  const gst = useMemo(() => api.getGSTInfo(row, profile), [row, profile, api]);
  const previewHTML = useMemo(() => api.buildHTML(row, profile, invNum), [row, profile, invNum, api]);
  const hasNotes = !!(row._notes || row._terms);

  async function handleSave() {
    setSaving(true);
    try {
      await api.onSave(row);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(kind: 'pdf' | 'docx') {
    setExporting(kind);
    try {
      if (kind === 'pdf') await api.onExportPDF(row, invNum);
      else await api.onExportDOCX(row, invNum);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="ib-root">
      <style>{IB_STYLES}</style>

      {/* LEFT — merchant switcher */}
      <aside className="ib-left">
        <div className="ib-left-head">Merchants</div>
        <div className="ib-left-list">
          {api.profiles.map((p: any) => (
            <div
              key={p.id}
              className={'ib-merchant-item' + (p.id === api.activeProfileId ? ' active' : '')}
              onClick={() => api.onSwitchProfile(p.id)}
            >
              <div className="ib-merchant-dot" />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
        <div className="ib-left-foot">Add merchants from the Merchant Profiles page.</div>
      </aside>

      {/* CENTER — live preview */}
      <main className="ib-center">
        <div className="ib-toolbar">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge badge-dim">{api.templateLabel} template</span>
            <span className="badge badge-blue">{invNum}</span>
            {savedAt && <span className="badge badge-green">✓ Saved</span>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Draft'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
              {exporting === 'pdf' ? 'Exporting…' : '⬇ PDF'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleExport('docx')} disabled={exporting !== null}>
              {exporting === 'docx' ? 'Exporting…' : '⬇ DOCX'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={api.onClose}>✕ Close</button>
          </div>
        </div>
        <div className="ib-preview-scroll">
          <div dangerouslySetInnerHTML={{ __html: previewHTML }} />
          {hasNotes && (
            <div className="ib-notes-preview">
              {row._notes && (
                <div className="ib-notes-block">
                  <div className="ib-notes-label">Notes</div>
                  <div>{row._notes}</div>
                </div>
              )}
              {row._terms && (
                <div className="ib-notes-block">
                  <div className="ib-notes-label">Terms &amp; Conditions</div>
                  <div>{row._terms}</div>
                </div>
              )}
              <div className="ib-notes-hint">
                Shown here for reference — Notes &amp; Terms aren't in the PDF/DOCX output yet
                (that needs a small extension to buildPDF/buildDOCX in a later phase).
              </div>
            </div>
          )}
        </div>
      </main>

      {/* RIGHT — edit panel */}
      <aside className="ib-right">
        <div className="ib-tabbar">
          {TABS.map(t => (
            <div key={t.key} className={'ib-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
              {t.label}
            </div>
          ))}
        </div>
        <div className="ib-tab-content">
          {tab === 'details' && (
            <>
              <div className="field"><label>Invoice Number</label>
                <input type="text" value={row._invNum || ''} onChange={setInput('_invNum')} placeholder={invNum} />
              </div>
              <div className="field"><label>Transaction Date</label>
                <input type="text" value={row['Transaction Date'] || ''} onChange={setInput('Transaction Date')} placeholder="DD/MM/YYYY" />
              </div>
              <div className="field"><label>Settlement / Reference ID</label>
                <input type="text" value={row['Seller Settlement Records ID'] || ''} onChange={setInput('Seller Settlement Records ID')} />
              </div>
              <div className="field"><label>UTR Number</label>
                <input type="text" value={row['Transaction UTR Number'] || ''} onChange={setInput('Transaction UTR Number')} />
              </div>
            </>
          )}

          {tab === 'buyer' && (
            <>
              <div className="field"><label>Buyer Name</label>
                <input type="text" value={row._billName || ''} onChange={setInput('_billName')} />
              </div>
              <div className="field"><label>Address</label>
                <input type="text" value={row._billAddress || ''} onChange={setInput('_billAddress')} />
              </div>
              <div className="grid3">
                <div className="field"><label>City</label><input type="text" value={row._billCity || ''} onChange={setInput('_billCity')} /></div>
                <div className="field"><label>State</label><input type="text" value={row._billState || ''} onChange={setInput('_billState')} /></div>
                <div className="field"><label>PIN</label><input type="text" value={row._billPin || ''} onChange={setInput('_billPin')} /></div>
              </div>
              <div className="grid2">
                <div className="field"><label>GST Number</label><input type="text" value={row._billGST || ''} onChange={setInput('_billGST')} /></div>
                <div className="field"><label>PAN Number</label><input type="text" value={row._billPAN || ''} onChange={setInput('_billPAN')} /></div>
              </div>
            </>
          )}

          {tab === 'shipping' && (
            <>
              <div className="field"><label>Recipient Name</label>
                <input type="text" value={row._shipName || ''} onChange={setInput('_shipName')} placeholder={row._billName || ''} />
              </div>
              <div className="field"><label>Address</label>
                <input type="text" value={row._shipAddress || ''} onChange={setInput('_shipAddress')} />
              </div>
              <div className="grid3">
                <div className="field"><label>City</label><input type="text" value={row._shipCity || ''} onChange={setInput('_shipCity')} /></div>
                <div className="field"><label>State</label><input type="text" value={row._shipState || ''} onChange={setInput('_shipState')} /></div>
                <div className="field"><label>PIN</label><input type="text" value={row._shipPin || ''} onChange={setInput('_shipPin')} /></div>
              </div>
            </>
          )}

          {tab === 'products' && (
            <div className="ib-products">
              <table className="ib-product-table">
                <thead>
                  <tr>
                    <th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Amount</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {row._products.map((p, i) => (
                    <tr key={p.id}>
                      <td><input type="text" value={p.description} onChange={e => dispatch({ type: 'SET_PRODUCT_FIELD', index: i, field: 'description', value: e.target.value })} placeholder="Item description" /></td>
                      <td><input type="text" value={p.hsn} onChange={e => dispatch({ type: 'SET_PRODUCT_FIELD', index: i, field: 'hsn', value: e.target.value })} style={{ width: 70 }} /></td>
                      <td><input type="number" value={p.qty} min={0} onChange={e => dispatch({ type: 'SET_PRODUCT_FIELD', index: i, field: 'qty', value: api.cleanNum(e.target.value) })} style={{ width: 55 }} /></td>
                      <td><input type="number" value={p.rate} min={0} step="0.01" onChange={e => dispatch({ type: 'SET_PRODUCT_FIELD', index: i, field: 'rate', value: api.cleanNum(e.target.value) })} style={{ width: 80 }} /></td>
                      <td><input type="number" value={p.discount} min={0} step="0.01" onChange={e => dispatch({ type: 'SET_PRODUCT_FIELD', index: i, field: 'discount', value: api.cleanNum(e.target.value) })} style={{ width: 70 }} /></td>
                      <td className="ib-amount-cell">{api.fmtINR(p.amount)}</td>
                      <td>
                        <div className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Move up" onClick={() => dispatch({ type: 'MOVE_PRODUCT', index: i, dir: -1 })}>↑</button>
                          <button className="btn btn-ghost btn-xs" title="Move down" onClick={() => dispatch({ type: 'MOVE_PRODUCT', index: i, dir: 1 })}>↓</button>
                          <button className="btn btn-ghost btn-xs" title="Duplicate" onClick={() => dispatch({ type: 'DUPLICATE_PRODUCT', index: i })}>⧉</button>
                          <button className="btn btn-danger btn-xs" title="Delete" onClick={() => dispatch({ type: 'DELETE_PRODUCT', index: i })} disabled={row._products.length <= 1}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => dispatch({ type: 'ADD_PRODUCT' })}>+ Add Product</button>
            </div>
          )}

          {tab === 'gst' && (
            <>
              <div className="field"><label>GST Rate %</label>
                <select value={row._gstRate ?? api.company?.defaultGstRate ?? 18} onChange={e => dispatch({ type: 'SET_FIELD', field: '_gstRate', value: api.cleanNum(e.target.value) })}>
                  <option value={0}>0% — Exempt</option>
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                  <option value={28}>28%</option>
                </select>
              </div>
              <div className="ib-gst-summary">
                <div className="row-between"><span>Base Amount</span><b>{api.fmtINR(gst.base)}</b></div>
                {gst.isSame ? (
                  <>
                    <div className="row-between"><span>CGST @ {gst.rate / 2}%</span><b>{api.fmtINR(gst.cgst)}</b></div>
                    <div className="row-between"><span>SGST @ {gst.rate / 2}%</span><b>{api.fmtINR(gst.sgst)}</b></div>
                  </>
                ) : (
                  <div className="row-between"><span>IGST @ {gst.rate}%</span><b>{api.fmtINR(gst.igst)}</b></div>
                )}
                <div className="row-between ib-gst-total"><span>Total</span><b>{api.fmtINR(gst.total)}</b></div>
                <div className="ib-gst-words">{api.numWords(gst.total)}</div>
              </div>
              <div className="note" style={{ marginTop: 10 }}>
                Same-state vs. inter-state (CGST+SGST vs IGST) is decided automatically from Seller Setup's state vs. the buyer's state above — same logic as the rest of the app.
              </div>
            </>
          )}

          {tab === 'notes' && (
            <>
              <div className="field"><label>Notes</label>
                <textarea rows={4} value={row._notes || ''} onChange={setInput('_notes')} placeholder="Internal notes or a message to the buyer…" style={{ resize: 'vertical' }} />
              </div>
              <div className="field"><label>Terms &amp; Conditions</label>
                <textarea rows={4} value={row._terms || ''} onChange={setInput('_terms')} placeholder="Payment terms, late fees, etc…" style={{ resize: 'vertical' }} />
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

const IB_STYLES = `
.ib-root { position: fixed; inset: 0; z-index: 9995; display: flex; background: var(--bg); color: var(--text); }
.ib-left { width: 210px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); padding: 18px 14px; display: flex; flex-direction: column; }
.ib-left-head { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 10px; }
.ib-left-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.ib-merchant-item { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 7px; font-size: 12.5px; color: var(--muted); cursor: pointer; }
.ib-merchant-item:hover { background: var(--surface2); color: var(--text); }
.ib-merchant-item.active { background: var(--accent-glow); color: var(--accent); font-weight: 600; }
.ib-merchant-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; opacity: 0.6; }
.ib-left-foot { font-size: 10.5px; color: var(--dim); line-height: 1.5; margin-top: 12px; }
.ib-center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ib-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; gap: 10px; }
.ib-preview-scroll { flex: 1; overflow-y: auto; padding: 28px; background: #2a2f3a; }
.ib-notes-preview { max-width: 760px; margin: 14px auto 0; background: #fff; color: #222; border-radius: 8px; padding: 18px 24px; font-size: 11px; }
.ib-notes-block { margin-bottom: 10px; }
.ib-notes-label { font-weight: 700; font-size: 10px; text-transform: uppercase; color: #888; margin-bottom: 3px; }
.ib-notes-hint { font-size: 10px; color: #999; border-top: 1px dashed #ddd; padding-top: 8px; margin-top: 8px; }
.ib-right { width: 400px; flex-shrink: 0; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; }
.ib-tabbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 12px 14px 0; border-bottom: 1px solid var(--border); }
.ib-tab { padding: 7px 10px; font-size: 11.5px; font-weight: 600; color: var(--muted); cursor: pointer; border-radius: 6px 6px 0 0; }
.ib-tab:hover { color: var(--text); }
.ib-tab.active { color: var(--accent); background: var(--surface2); }
.ib-tab-content { flex: 1; overflow-y: auto; padding: 18px; }
.ib-product-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.ib-product-table th { text-align: left; font-size: 10px; color: var(--muted); font-weight: 600; padding: 4px 4px; border-bottom: 1px solid var(--border); }
.ib-product-table td { padding: 4px 3px; vertical-align: middle; }
.ib-product-table input { padding: 5px 6px; font-size: 11.5px; }
.ib-amount-cell { font-weight: 700; color: var(--green); white-space: nowrap; padding-left: 8px; }
.ib-gst-summary { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
.ib-gst-total { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 2px; font-size: 13.5px; }
.ib-gst-words { font-size: 11px; color: var(--muted); margin-top: 4px; }
`;