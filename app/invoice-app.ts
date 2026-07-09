// app/invoice-app.ts
//
// Phase 0/4/5 complete: this file no longer defines any GST math,
// template registry, or HTML/PDF/DOCX generation — all of that now
// lives in lib/invoice/{db,gst,template,utils,builder}.ts and is
// imported below. This is the single source of truth used by both
// the main "Generate Invoices" page AND /builder/[id] — they share
// the exact same functions, so nothing can silently diverge between
// them anymore.
//
// Phase 5 cutover: "✏️ Edit" now navigates to /builder/[id] instead
// of opening showEditModal() (deleted). The in-place InvoiceBuilder
// overlay (InvoiceBuilder.tsx + createRoot mounting) has also been
// removed — /builder/[id] is the only builder UI now.

import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import {
  getSupabaseClient,
  dbSaveInvoice, dbLoadInvoices, dbDeleteInvoice, dbClearInvoices,
  dbSaveRows, dbLoadRows, dbClearRows,
  dbSaveProfiles, dbLoadProfiles,
  dbSaveCompany, dbLoadCompany,
  dbSaveDraftInvoice,
  uploadLogoToStorage, uploadProfileLogoToStorage, uploadInvoiceFiles,
  matchProfile, makeDraftRow,
} from './lib/invoice/db';
import { getGSTInfo } from './lib/invoice/gst';
import { resolveTemplate, templateOptionsHTML } from './lib/invoice/template';
import {
  esc, uid, fmt, cleanNum, fmtINR,
  numWords, genInvNum, genFileName, parseDate,
  getLogoSrc, getProfileLogo, triggerDL,
} from './lib/invoice/utils';

export function initApp() {
  /* ═══════════════════════════════════════════════
     SUPABASE CLIENT
  ═══════════════════════════════════════════════ */
  let supa: any = null;
  let supaReady = false;

  function initSupabase() {
    try {
      supa = getSupabaseClient();
      return true;
    } catch (e) {
      console.error('Supabase init failed:', e);
      return false;
    }
  }

  function setDbStatus(state: string, label: string) {
    const dot = document.getElementById('dbDot');
    const lbl = document.getElementById('dbLabel');
    if (dot) { dot.className = 'db-dot ' + state; }
    if (lbl) lbl.textContent = label;
  }

  /* ═══════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════ */
  const S: any = {
    page: 'invoices',
    rows: [],
    uploadedFileName: null,
    profiles: [],
    company: null,
    savedInvoices: [],
    generated: [],
    session: null,
  };

  /* ═══════════════════════════════════════════════
     AUTH (Supabase Auth — email + password, open signup,
     shared single workspace: every logged-in user sees
     the same company/profiles/invoices data)
  ═══════════════════════════════════════════════ */
  let authTab = 'login'; // 'login' | 'signup'

  function showAuthScreen() {
    (document.getElementById('authScreen') as HTMLElement).style.display = 'flex';
    (document.getElementById('appShell') as HTMLElement).style.display = 'none';
    renderAuthCard();
  }

  function showAppShell(session: any) {
    (document.getElementById('authScreen') as HTMLElement).style.display = 'none';
    (document.getElementById('appShell') as HTMLElement).style.display = 'flex';
    const email = session?.user?.email || '';
    const chip = document.getElementById('userChip');
    const avatar = document.getElementById('userAvatar');
    const emailEl = document.getElementById('userEmail');
    if (chip) chip.style.display = 'flex';
    if (avatar) avatar.textContent = email ? email[0].toUpperCase() : '?';
    if (emailEl) emailEl.textContent = email;
  }

  function renderAuthCard(errMsg?: string | null, okMsg?: string | null) {
    const card = document.getElementById('authCard');
    if (!card) return;
    card.innerHTML = `
    <div class="auth-logo">
      <div class="logo-mark" style="font-size:20px;">Invoice<span>Generator</span></div>
      <div class="logo-sub" style="margin-top:6px;">Settlement Generator</div>
    </div>
    <div class="auth-tabs">
      <div class="auth-tab ${authTab === 'login' ? 'active' : ''}" id="tabLogin">Log In</div>
      <div class="auth-tab ${authTab === 'signup' ? 'active' : ''}" id="tabSignup">Sign Up</div>
    </div>
    <div class="auth-err" id="authErr">${errMsg ? esc(errMsg) : ''}</div>
    <div class="auth-ok" id="authOk">${okMsg ? esc(okMsg) : ''}</div>
    <div class="field"><label>Email</label><input type="email" id="auth_email" placeholder="you@company.com" autocomplete="username"></div>
    <div class="field"><label>Password</label><input type="password" id="auth_password" placeholder="••••••••" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}"></div>
    ${authTab === 'signup' ? `<div class="field"><label>Confirm Password</label><input type="password" id="auth_password2" placeholder="••••••••" autocomplete="new-password"></div>` : ''}
    ${authTab === 'login' ? `<div style="text-align:right;margin-bottom:10px;"><span class="auth-link" id="forgotPwLink" style="font-size:11px;">Forgot password?</span></div>` : ''}
    <button class="btn btn-primary" id="authSubmitBtn" style="width:100%;justify-content:center;margin-top:4px;">${authTab === 'login' ? 'Log In' : 'Create Account'}</button>
    <div class="auth-foot">
      ${authTab === 'login' ? `Don't have an account? <span class="auth-link" id="switchToSignup">Sign up</span>` : `Already have an account? <span class="auth-link" id="switchToLogin">Log in</span>`}
    </div>`;
    if (errMsg) (card.querySelector('#authErr') as HTMLElement).style.display = 'block';
    if (okMsg) (card.querySelector('#authOk') as HTMLElement).style.display = 'block';
    wireAuthCard();
  }

  function wireAuthCard() {
    document.getElementById('tabLogin')?.addEventListener('click', () => { authTab = 'login'; renderAuthCard(); });
    document.getElementById('tabSignup')?.addEventListener('click', () => { authTab = 'signup'; renderAuthCard(); });
    document.getElementById('switchToSignup')?.addEventListener('click', () => { authTab = 'signup'; renderAuthCard(); });
    document.getElementById('switchToLogin')?.addEventListener('click', () => { authTab = 'login'; renderAuthCard(); });

    document.getElementById('forgotPwLink')?.addEventListener('click', async () => {
      const email = (document.getElementById('auth_email') as HTMLInputElement).value.trim();
      if (!email) { renderAuthCard('Enter your email above first, then click "Forgot password?" again.'); return; }
      try {
        const { error } = await supa.auth.resetPasswordForEmail(email);
        if (error) throw error;
        renderAuthCard(null, 'Password reset email sent — check your inbox.');
      } catch (e: any) { renderAuthCard(e.message || 'Could not send reset email.'); }
    });

    document.getElementById('authSubmitBtn')?.addEventListener('click', async () => {
      const email = (document.getElementById('auth_email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('auth_password') as HTMLInputElement).value;
      const btn = document.getElementById('authSubmitBtn') as HTMLButtonElement;
      if (!email || !password) { renderAuthCard('Email and password are required.'); return; }

      if (authTab === 'signup') {
        const password2 = (document.getElementById('auth_password2') as HTMLInputElement).value;
        if (password.length < 6) { renderAuthCard('Password must be at least 6 characters.'); return; }
        if (password !== password2) { renderAuthCard('Passwords do not match.'); return; }
        btn.disabled = true; btn.textContent = 'Creating account…';
        try {
          const { data, error } = await supa.auth.signUp({ email, password });
          if (error) throw error;
          if (data.session) {
            toast('Account created — welcome!', 'good');
          } else {
            authTab = 'login';
            renderAuthCard(null, 'Account created. Check your email to confirm, then log in.');
            return;
          }
        } catch (e: any) {
          renderAuthCard(e.message || 'Could not create account.');
          btn.disabled = false; btn.textContent = 'Create Account';
        }
      } else {
        btn.disabled = true; btn.textContent = 'Logging in…';
        try {
          const { error } = await supa.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } catch (e: any) {
          renderAuthCard(e.message || 'Login failed. Check your email and password.');
          btn.disabled = false; btn.textContent = 'Log In';
        }
      }
      // On success, onAuthStateChange (registered in boot()) picks up the
      // new session and loads the app — nothing else to do here.
    });
  }

  async function loadAppData() {
    try {
      const [company, profiles, invoices, uploaded] = await Promise.all([
        dbLoadCompany(supa),
        dbLoadProfiles(supa),
        dbLoadInvoices(supa),
        dbLoadRows(supa),
      ]);
      S.company = company;
      S.profiles = profiles;
      S.savedInvoices = invoices;
      S.rows = uploaded.rows || [];
      S.uploadedFileName = uploaded.fileName || null;
    } catch (e) {
      console.error('Data load error:', e);
    }
    goto(S.company ? 'invoices' : 'settings');
  }

  /* ═══════════════════════════════════════════════
     EXCEL → FIELD MAPPING / ROW GROUPING
     (unchanged parsing logic — this is Excel ingestion,
     not part of the extracted GST/template/build engine)
  ═══════════════════════════════════════════════ */
  function groupSettlementRows(json: any[]) {
    const groups: any[] = [];
    let current: any = null;

    json.forEach(row => {
      const settlementId = String(row['Seller Settlement Records ID'] || '').trim();
      const productText = String(row['Product List'] || '').trim();
      const lineAmt = row['Group Settlement row'] !== undefined && row['Group Settlement row'] !== ''
        ? row['Group Settlement row']
        : row['__EMPTY'];

      if (settlementId) {
        current = row;
        current._products = [];
        // Stable id assigned at ingestion — this is what /builder/[id]
        // matches against (Phase 2/3 requirement). Existing rows loaded
        // from cloud without an id get one lazily on first Edit click.
        current.id = current.id || uid();
        groups.push(current);
      }
      if (!current) return;

      if (productText) {
        const qtyMatch = productText.match(/\|\s*Quantity:\s*(\d+)\s*\|/i);
        const qty = qtyMatch ? (cleanNum(qtyMatch[1]) || 1) : 1;
        const description = productText.replace(/\|\s*Quantity:\s*\d+\s*\|/i, '').trim();
        current._products.push({ description, qty, amount: cleanNum(lineAmt) });
      }
    });

    groups.forEach(g => {
      const grandTotal = cleanNum(g['Transaction Amount']);
      if (!g._products.length) {
        g._products.push({ description: g['Product List'] || 'Settlement Pay', qty: 1, amount: grandTotal });
        return;
      }
      const sum = g._products.reduce((s: number, p: any) => s + cleanNum(p.amount), 0);
      if (sum <= 0) {
        g._products[0].amount = grandTotal;
      } else if (grandTotal > 0 && Math.abs(sum - grandTotal) > 0.01) {
        const factor = grandTotal / sum;
        let running = 0;
        g._products.forEach((p: any, idx: number) => {
          if (idx === g._products.length - 1) {
            p.amount = parseFloat((grandTotal - running).toFixed(2));
          } else {
            p.amount = parseFloat((p.amount * factor).toFixed(2));
            running += p.amount;
          }
        });
      }
      g['_description'] = g._products.map((p: any) => p.description).join(' + ');
    });

    return groups;
  }

  function extractAddressFieldsFromRow(row: any) {
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
      }
      return '';
    };

    const productDesc = pick('Product List', 'Product Description', 'Item Description', 'Description', 'Product Details', 'Transaction Type');
    const personName = pick('Name', 'Name ', 'Customer Name', 'Billing Name', 'Bill To Name', 'Buyer Name');

    const billAddress = pick('Billing Address', 'Bill To Address', 'Buyer Address', 'Billing Address Line', 'Address');
    const billCity = pick('Billing City', 'Bill City', 'City');
    const billState = pick('Billing State', 'Bill State', 'State');
    const billPin = pick('Billing Pincode', 'Billing PIN', 'Bill Pincode', 'Pincode', 'PIN Code', 'PIN');
    const billGST = pick('Billing GST', 'Buyer GST', 'GSTIN', 'GST Number', 'GST No');
    const billPAN = pick('Billing PAN', 'Buyer PAN', 'PAN Number', 'PAN No');

    const shipName = pick('Shipping Name', 'Ship To Name', 'Consignee Name', 'Delivery Name');
    const shipAddress = pick('Shipping Address', 'Ship To Address', 'Consignee Address', 'Delivery Address');
    const shipCity = pick('Shipping City', 'Ship City', 'Delivery City');
    const shipState = pick('Shipping State', 'Ship State', 'Delivery State');
    const shipPin = pick('Shipping Pincode', 'Shipping PIN', 'Ship Pincode', 'Delivery Pincode');

    if (!row['_billName']) row['_billName'] = personName || row['Seller Name'] || '';
    if (!row['_billAddress']) row['_billAddress'] = billAddress;
    if (!row['_billCity']) row['_billCity'] = billCity;
    if (!row['_billState']) row['_billState'] = billState;
    if (!row['_billPin']) row['_billPin'] = billPin;
    if (!row['_billGST']) row['_billGST'] = billGST;
    if (!row['_billPAN']) row['_billPAN'] = billPAN;

    if (!row['_shipName']) row['_shipName'] = shipName || row['_billName'];
    if (!row['_shipAddress']) row['_shipAddress'] = shipAddress || row['_billAddress'];
    if (!row['_shipCity']) row['_shipCity'] = shipCity || row['_billCity'];
    if (!row['_shipState']) row['_shipState'] = shipState || row['_billState'];
    if (!row['_shipPin']) row['_shipPin'] = shipPin || row['_billPin'];

    if (!row['_description']) row['_description'] = productDesc;

    return row;
  }

  /* ═══════════════════════════════════════════════
     ROUTER
  ═══════════════════════════════════════════════ */
  function goto(page: string) {
    S.page = page;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.page === page);
    });
    render();
  }
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => goto((el as HTMLElement).dataset.page as string));
  });

  function render() {
    const m = document.getElementById('mainArea');
    if (!m) return;
    if (S.page === 'invoices') { m.innerHTML = viewInvoices(); wireInvoices(); }
    if (S.page === 'profiles') { m.innerHTML = viewProfiles(); wireProfiles(); }
    if (S.page === 'library') { m.innerHTML = viewLibrary(); wireLibrary(); }
    if (S.page === 'settings') { m.innerHTML = viewSettings(); wireSettings(); }
    updateBadges();
  }

  function updateBadges() {
    (document.getElementById('profileCount') as HTMLElement).textContent = String(S.profiles.length);
    (document.getElementById('libCount') as HTMLElement).textContent = String(S.savedInvoices.length);
  }

  /* ═══════════════════════════════════════════════
     PAGE: GENERATE INVOICES
  ═══════════════════════════════════════════════ */
  function viewInvoices() {
    const rows = S.rows;
    const gen = S.generated;
    const totalAmt = rows.reduce((s: number, r: any) => {
      const profile = S.profiles.find((p: any) => matchProfile(p, r['Seller Name']));
      return s + getGSTInfo(r, profile, S.company).total;
    }, 0);
    const sellers = [...new Set(rows.map((r: any) => r['Seller Name']))].filter(Boolean);

    return `
<div style="margin-bottom:24px;">
  <h1>Generate Settlement Invoices</h1>
  <p class="page-sub">Upload your Settlement Excel — dynamic Product List item parsing applied.</p>
</div>

${!supaReady ? `<div class="note warn" style="margin-bottom:18px;">⚠️ <b>Supabase not connected.</b> Check your URL and anon key. Data will not be saved.</div>` : ''}

${!S.company ? `
<div class="note warn" style="margin-bottom:18px;">
  ⚠️ <b>Your company details are not set.</b>
  <span style="cursor:pointer;text-decoration:underline;color:var(--amber);" onclick="window.__gotoSettings && window.__gotoSettings()">Set up your company →</span>
</div>` : ''}

<div class="card">
  <div class="card-title">📂 Upload Settlement Excel</div>
  <div class="drop-zone" id="dropZone">
    <div class="drop-icon">📊</div>
    <div class="drop-label">Drop your .xlsx or .csv file here</div>
    <div class="drop-sub">Excel settlement export format • Multiple rows = Multiple invoices</div>
    <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">
  </div>
  ${rows.length ? `
  <div class="row" style="margin-top:14px;justify-content:space-between;">
    <div class="row" style="gap:8px;">
      <span class="badge badge-green">✓ ${rows.length} rows loaded</span>
      <span class="badge badge-blue">${sellers.length} unique merchants</span>
      <span class="badge badge-dim">Total: ${fmtINR(totalAmt)}</span>
      ${S.uploadedFileName ? `<span class="badge badge-dim">☁️ ${esc(S.uploadedFileName)}</span>` : ''}
    </div>
    <button class="btn btn-ghost btn-sm" id="clearDataBtn">Clear data</button>
  </div>` : ''}
</div>

${rows.length ? `
<div class="card">
  <div class="row-between" style="margin-bottom:14px;">
    <div class="card-title" style="margin:0;">📋 Transaction Preview (${rows.length} rows)</div>
    <button class="btn btn-primary" id="genAllBtn">⚡ Generate all ${rows.length} invoices</button>
  </div>
  <div class="tbl-wrap">
    <table class="data-table">
      <thead><tr>
        <th>#</th><th>Name Target</th><th>Settlement Record ID</th><th>UTR Number</th>
        <th>Transaction Date</th><th>Amount</th><th>Qty</th><th>GST</th><th>Product List Item</th><th>Template</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows.map((r: any, i: number) => {
          const profile = S.profiles.find((p: any) => matchProfile(p, r['Seller Name']));
          const gst = getGSTInfo(r, profile, S.company);
          const tpl = resolveTemplate(profile, S.company);
          return `<tr>
            <td style="color:var(--dim);font-size:11px;">${i + 1}</td>
            <td>
              <div style="font-weight:600;font-size:12.5px;">${esc(r['_billName'] || '—')}</div>
            </td>
            <td style="font-family:monospace;font-size:11px;color:var(--muted);">${esc(r['Seller Settlement Records ID'] || '')}</td>
            <td style="font-family:monospace;font-size:11px;color:var(--muted);">${esc(r['Transaction UTR Number'] || '')}</td>
            <td style="font-size:12px;">${esc(parseDate(r['Transaction Date']))}</td>
            <td style="font-weight:700;color:var(--green);">
              ${fmtINR(gst.total)}
              ${gst.qty > 1 ? `<div style="font-weight:400;font-size:10px;color:var(--muted);">${fmtINR(gst.unitAmount)} × ${gst.qty}</div>` : ''}
            </td>
            <td style="font-size:12px;text-align:center;">${gst.qty}</td>
            <td style="font-size:11px;">
              <span class="badge ${gst.isSame ? 'badge-blue' : 'badge-amber'}" style="font-size:10px;">${gst.taxLabel}</span><br>
              <span style="color:var(--muted);font-size:10px;">Tax: ${fmtINR(gst.taxAmt)}</span>
            </td>
            <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--accent);">${esc(r['_description'] || '—')}</td>
            <td><span class="badge badge-dim" style="font-size:10px;">${esc(tpl.label)}</span></td>
            <td>
              <div class="row" style="gap:4px;">
                <button class="btn btn-ghost btn-xs" data-preview="${i}">👁 View</button>
                <button class="btn btn-ghost btn-xs" style="border-color:var(--accent);color:var(--accent);" data-edit="${i}">✏️ Edit</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div class="progress-wrap" id="genProgress" style="display:none;"><div class="progress-bar" id="genBar"></div></div>
  <div style="font-size:12px;color:var(--muted);margin-top:6px;" id="genText"></div>
</div>` : `
<div class="empty">
  <div class="empty-icon">📊</div>
  <h3>No data loaded</h3>
  <p>Upload your Excel above to get started.</p>
</div>`}

${gen.length ? `
<div class="card">
  <div class="row-between" style="margin-bottom:16px;">
    <div>
      <div class="card-title" style="margin:0;">✅ ${gen.length} invoices generated</div>
      <div style="font-size:12px;color:var(--green);margin-top:3px;">Saved to Supabase cloud ☁️</div>
    </div>
    <div class="row" style="gap:8px;">
      <button class="btn btn-ghost btn-sm" id="viewLibBtn">View library →</button>
      <button class="btn btn-green btn-sm" id="zipAllBtn">⬇ Download all as ZIP</button>
    </div>
  </div>
  <div class="results-grid">
    ${gen.map((g: any) => `
    <div class="result-card">
      <div class="rc-id">${esc(g.invNum)}</div>
      <div class="rc-merchant">${esc(g.merchant)}</div>
      <div class="rc-amount">${fmtINR(g.amount)}</div>
      <div class="rc-utr">UTR: ${esc(g.utr)}</div>
      <div class="rc-actions">
        <button class="btn btn-ghost btn-xs" data-dl-pdf="${esc(g.id)}">⬇ PDF</button>
        <button class="btn btn-ghost btn-xs" data-dl-docx="${esc(g.id)}">⬇ DOCX</button>
        <button class="btn btn-ghost btn-xs" data-preview-gen="${esc(g.id)}">👁</button>
      </div>
    </div>`).join('')}
  </div>
</div>` : ''}`;
  }

  function wireInvoices() {
    const drop = document.getElementById('dropZone');
    const inp = document.getElementById('fileInput') as HTMLInputElement;
    if (drop) {
      drop.addEventListener('click', () => inp.click());
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e: any) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
      inp.addEventListener('change', (e: any) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    }
    document.getElementById('clearDataBtn')?.addEventListener('click', async () => {
      S.rows = []; S.generated = []; S.uploadedFileName = null;
      render();
      if (supaReady) {
        try { await dbClearRows(supa); toast('Cleared uploaded data from cloud.', ''); }
        catch (e: any) { toast('Cloud clear failed: ' + e.message, 'bad'); }
      }
    });
    document.getElementById('genAllBtn')?.addEventListener('click', generateAll);
    document.getElementById('zipAllBtn')?.addEventListener('click', downloadZip);
    document.getElementById('viewLibBtn')?.addEventListener('click', () => goto('library'));
    document.querySelectorAll('[data-preview]').forEach(btn => btn.addEventListener('click', () => showPreviewModal(S.rows[+(btn as HTMLElement).dataset.preview!])));

    // Phase 5 cutover: Edit now navigates to the real /builder/[id] route
    // instead of opening the old showEditModal(). Rows loaded before the
    // id migration get one assigned + persisted on first click.
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = +(btn as HTMLElement).dataset.edit!;
        const row = S.rows[idx];
        if (!row) return;
        if (!row.id) {
          row.id = uid();
          if (supaReady) {
            try { await dbSaveRows(supa, S.rows, S.uploadedFileName); }
            catch (e) { console.warn('Could not persist new row id before navigating:', e); }
          }
        }
        window.location.href = `/builder/${row.id}`;
      });
    });

    document.querySelectorAll('[data-dl-pdf]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = S.generated.find((x: any) => x.id === (btn as HTMLElement).dataset.dlPdf);
        if (g && g.pdfBlob) triggerDL(g.pdfBlob, (g.fileName || g.invNum) + '.pdf');
        else if (g && g.pdfUrl) window.open(g.pdfUrl, '_blank');
      });
    });
    document.querySelectorAll('[data-dl-docx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = S.generated.find((x: any) => x.id === (btn as HTMLElement).dataset.dlDocx);
        if (g && g.docxBlob) triggerDL(g.docxBlob, (g.fileName || g.invNum) + '.docx');
        else if (g && g.docxUrl) window.open(g.docxUrl, '_blank');
      });
    });
    document.querySelectorAll('[data-preview-gen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = S.generated.find((x: any) => x.id === (btn as HTMLElement).dataset.previewGen);
        if (g) showPreviewModal(g._row);
      });
    });
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true, raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        if (!json.length) throw new Error('No rows found in file');
        const grouped = groupSettlementRows(json);
        grouped.forEach(extractAddressFieldsFromRow);
        S.rows = grouped; S.generated = []; S.uploadedFileName = file.name;
        render();
        toast(`✓ Loaded ${json.length} rows from ${file.name}`, 'good');

        if (supaReady) {
          try {
            await dbSaveRows(supa, S.rows, file.name);
            toast(`☁️ ${json.length} rows saved to cloud`, 'good');
          } catch (err) {
            console.warn('Saving rows to cloud failed:', err);
          }
        }
      } catch (err: any) { toast('Error reading file: ' + err.message, 'bad'); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function generateAll() {
    S.generated = [];
    const btn = document.getElementById('genAllBtn') as HTMLButtonElement;
    const prog = document.getElementById('genProgress') as HTMLElement;
    const bar = document.getElementById('genBar') as HTMLElement;
    const txt = document.getElementById('genText') as HTMLElement;
    if (btn) btn.disabled = true;
    if (prog) prog.style.display = 'block';

    for (let i = 0; i < S.rows.length; i++) {
      const row = S.rows[i];
      const profile = S.profiles.find((p: any) => matchProfile(p, row['Seller Name']));
      const invNum = genInvNum(row);
      const fileName = genFileName(row);
      const amount = getGSTInfo(row, profile, S.company).total; // qty-scaled grand total
      const tpl = resolveTemplate(profile, S.company);

      const pdfBlob = await tpl.buildPDF(row, profile, invNum);
      const docxBlob = await tpl.buildDOCX(row, profile, invNum);

      const g: any = {
        id: uid(), invNum, fileName,
        merchant: row['_billName'] || 'Unknown',
        amount, utr: row['Transaction UTR Number'] || '',
        settlementId: row['Seller Settlement Records ID'] || '',
        savedAt: Date.now(),
        pdfBlob, docxBlob, _row: row,
        pdfUrl: null, docxUrl: null,
      };

      if (supaReady) {
        try {
          const urls = await uploadInvoiceFiles(supa, fileName, pdfBlob, docxBlob);
          g.pdfUrl = urls.pdfUrl;
          g.docxUrl = urls.docxUrl;
          await dbSaveInvoice(supa, g);
        } catch (e) { console.warn('Supabase save configuration sync skipped:', e); }
      }

      S.generated.push(g);
      const pct = Math.round(((i + 1) / S.rows.length) * 100);
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = `Saving ${i + 1} of ${S.rows.length} to cloud…`;
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    if (supaReady) {
      try { S.savedInvoices = await dbLoadInvoices(supa); } catch (e) { }
    }
    if (btn) btn.disabled = false;
    toast(`✅ ${S.rows.length} invoices generated and saved to cloud!`, 'good');
    render();
  }

  async function downloadZip() {
    const z = new JSZip();
    for (const g of S.generated) {
      const base = g.fileName || g.invNum;
      if (g.pdfBlob) z.file(base + '.pdf', g.pdfBlob);
      if (g.docxBlob) z.file(base + '.docx', g.docxBlob);
    }
    const blob = await z.generateAsync({ type: 'blob' });
    triggerDL(blob, `settlement_invoices_${Date.now()}.zip`);
  }

  /* ═══════════════════════════════════════════════
     PREVIEW MODAL — uses the same resolveTemplate()
     that generateAll() and /builder/[id] both use.
  ═══════════════════════════════════════════════ */
  function showPreviewModal(row: any) {
    if (!row) return;
    const profile = S.profiles.find((p: any) => matchProfile(p, row['Seller Name']));
    const invNum = genInvNum(row);
    const tpl = resolveTemplate(profile, S.company);
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.style.cssText = 'align-items:flex-start;padding:20px;overflow-y:auto;';
    bg.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;width:800px;max-width:100%;padding:20px;">
    <div class="row-between" style="margin-bottom:16px;">
      <div style="font-weight:700;font-size:15px;">Invoice Preview</div>
      <div class="row" style="gap:8px;">
        <span class="badge badge-dim">${esc(tpl.label)} template</span>
        <span class="badge ${profile ? 'badge-green' : 'badge-amber'}">${profile ? '✓ Profile matched' : 'No merchant profile'}</span>
        <button class="btn btn-ghost btn-sm" id="closePreview">✕ Close</button>
      </div>
    </div>
    <div style="overflow-x:auto;">${tpl.buildHTML(row, profile, invNum)}</div>
  </div>`;
    document.body.appendChild(bg);
    (document.getElementById('closePreview') as HTMLElement).onclick = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  }

  /* ═══════════════════════════════════════════════
     PAGE: MERCHANT PROFILES
  ═══════════════════════════════════════════════ */
  function viewProfiles() {
    return `
<div style="margin-bottom:24px;"><h1>Merchant Profiles</h1><p class="page-sub">Store details for each client. State handles automatic tax categorization.</p></div>
<div class="card">
  <div class="card-title" style="margin-bottom:16px;">Add Merchant Profile</div>
  <div style="margin-bottom:16px;">
    <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Merchant Logo</label>
    <div style="display:flex;align-items:center;gap:14px;">
      <div class="logo-upload-zone" id="pf_logoPreview" style="width:150px;cursor:pointer;"><span class="logo-placeholder">No logo — click Upload</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;">📁 Upload Logo<input type="file" id="pf_logoInput" accept="image/png,image/jpeg,image/jpg,image/svg+xml" style="display:none;"></label>
        <button class="btn btn-danger btn-sm" id="pf_removeLogoBtn">✕ Remove</button>
      </div>
    </div>
  </div>
  <div class="grid2">
    <div class="field"><label>Merchant Name *</label><input type="text" id="pf_name" placeholder="Name Entity"></div>
    <div class="field"><label>Seller ID</label><input type="text" id="pf_sid" placeholder="e.g. 41001327"></div>
    <div class="field"><label>GST Number</label><input type="text" id="pf_gst" placeholder="27AAAAA1234A1Z5"></div>
    <div class="field"><label>PAN Number</label><input type="text" id="pf_pan" placeholder="AAAAA1234A"></div>
    <div class="field"><label>CIN Number</label><input type="text" id="pf_cin" placeholder="U74999MH2020PTC123456"></div>
    <div class="field"><label>Email</label><input type="text" id="pf_email" placeholder="accounts@company.com"></div>
  </div>
  <div class="field"><label>Registered Address</label><input type="text" id="pf_address" placeholder="123, Industrial Area"></div>
  <div class="grid3">
    <div class="field"><label>City</label><input type="text" id="pf_city" placeholder="Mumbai"></div>
    <div class="field"><label>State</label><input type="text" id="pf_state" placeholder="Maharashtra"></div>
    <div class="field"><label>PIN Code</label><input type="text" id="pf_pin" placeholder="400001"></div>
  </div>
  <div class="field">
    <label>Invoice Template</label>
    <select id="pf_template">${templateOptionsHTML('default')}</select>
  </div>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
    <button class="btn btn-primary" id="saveProfileBtn">Save Profile</button>
  </div>
</div>
${S.profiles.length ? `
<div class="card">
  <div class="card-title">Saved Profiles (${S.profiles.length})</div>
  <div class="profiles-grid">
    ${S.profiles.map((p: any, i: number) => `
    <div class="profile-card">
      <div class="profile-card-del"><button class="btn btn-danger btn-xs" data-del-p="${i}">✕</button></div>
      ${getProfileLogo(p) ? `<img src="${getProfileLogo(p)}" style="max-height:28px;max-width:110px;object-fit:contain;margin-bottom:6px;display:block;">` : ''}
      <div class="profile-card-name">${esc(p.name)}</div>
      <div class="profile-card-detail">
        ${p.sellerId ? `ID: ${esc(p.sellerId)}<br>` : ''}
        ${[p.city, p.state].filter(Boolean).join(', ')}<br>
        ${p.gst ? `GST: ${esc(p.gst)}<br>` : ''}${p.pan ? `PAN: ${esc(p.pan)}<br>` : ''}
        <select class="tpl-switch" data-tpl-profile="${esc(p.id)}" style="margin-top:6px;width:100%;font-size:10px;padding:3px 4px;">
  ${templateOptionsHTML(p.template || 'default')}
</select>
      </div>
      <button class="btn btn-primary btn-xs" style="margin-top:8px;width:100%;justify-content:center;" data-open-builder="${esc(p.id)}">🎨 Open Invoice Builder</button>
    </div>`).join('')}
  </div>
</div>` : `<div class="empty" style="padding:40px 20px;"><div class="empty-icon">🏢</div><h3>No profiles yet</h3><p>Add profiles above.</p></div>`}`;
  }

  function wireProfiles() {
    let pendingLogoB64: string | null = null;
    const logoInput = document.getElementById('pf_logoInput') as HTMLInputElement;
    const logoPreview = document.getElementById('pf_logoPreview') as HTMLElement;
    logoPreview?.addEventListener('click', () => logoInput.click());
    logoInput?.addEventListener('change', (e: any) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 500000) { toast('Logo too large — max 500 KB.', 'bad'); return; }
      const reader = new FileReader();
      reader.onload = (ev: any) => {
        pendingLogoB64 = ev.target.result;
        logoPreview.innerHTML = `<img src="${pendingLogoB64}" style="max-height:52px;max-width:100%;object-fit:contain;padding:4px;">`;
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('pf_removeLogoBtn')?.addEventListener('click', () => {
      pendingLogoB64 = null;
      if (logoPreview) logoPreview.innerHTML = `<span class="logo-placeholder">No logo — click Upload</span>`;
    });

    document.querySelectorAll('[data-tpl-profile]').forEach(sel => {
  sel.addEventListener('change', async (e: any) => {
    const id = (sel as HTMLElement).dataset.tplProfile;
    const profileObj = S.profiles.find((pr: any) => pr.id === id);
    if (!profileObj) return;
    profileObj.template = e.target.value;
    try {
      if (supaReady) { await dbSaveProfiles(supa, S.profiles); toast('Template updated.', 'good'); }
    } catch (err) { toast('Could not save template change.', 'bad'); }
    render();
  });
});

    document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
      const name = (document.getElementById('pf_name') as HTMLInputElement).value.trim();
      if (!name) { toast('Name target is required.', 'bad'); return; }
      const newProfile: any = {
        id: uid(), name,
        sellerId: (document.getElementById('pf_sid') as HTMLInputElement).value.trim(),
        gst: (document.getElementById('pf_gst') as HTMLInputElement).value.trim(),
        pan: (document.getElementById('pf_pan') as HTMLInputElement).value.trim(),
        cin: (document.getElementById('pf_cin') as HTMLInputElement).value.trim(),
        email: (document.getElementById('pf_email') as HTMLInputElement).value.trim(),
        address: (document.getElementById('pf_address') as HTMLInputElement).value.trim(),
        city: (document.getElementById('pf_city') as HTMLInputElement).value.trim(),
        state: (document.getElementById('pf_state') as HTMLInputElement).value.trim(),
        pin: (document.getElementById('pf_pin') as HTMLInputElement).value.trim(),
        template: (document.getElementById('pf_template') as HTMLSelectElement)?.value || 'default',
        logoUrl: null,
      };
      try {
        if (supaReady && pendingLogoB64) {
          newProfile.logoUrl = await uploadProfileLogoToStorage(supa, pendingLogoB64, newProfile.id);
        }
      } catch (e) { toast('Logo upload failed', 'bad'); }
      S.profiles.push(newProfile);
      if (supaReady) {
        try { await dbSaveDraftInvoice(supa, newProfile.id, makeDraftRow(newProfile, S.company)); } catch (e) { }
      }
      try { if (supaReady) await dbSaveProfiles(supa, S.profiles); } catch (e) { }
      toast('Profile saved.', 'good'); render();
    });
    document.querySelectorAll('[data-del-p]').forEach(btn => {
      btn.addEventListener('click', async () => {
        S.profiles.splice(+(btn as HTMLElement).dataset.delP!, 1);
        try { if (supaReady) await dbSaveProfiles(supa, S.profiles); } catch (e) { }
        render();
      });
    });
    // Phase 5: profile builder also routes to the real /builder/[id] page
    // (id here is the merchant profile's id — /builder/[id] resolves that
    // case by loading/creating the merchant's draft invoice).
    document.querySelectorAll('[data-open-builder]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.href = `/builder/${(btn as HTMLElement).dataset.openBuilder}`;
      });
    });
  }

  /* ═══════════════════════════════════════════════
     PAGE: LIBRARY
  ═══════════════════════════════════════════════ */
  function viewLibrary() {
    const inv = S.savedInvoices;
    const total = inv.reduce((s: number, i: any) => s + cleanNum(i.amount), 0);
    return `
<div style="margin-bottom:24px;"><h1>Saved Invoices</h1><p class="page-sub">All invoices are stored safely in your cloud database cache.</p></div>
<div class="stats-strip" style="grid-template-columns:repeat(3,1fr);">
  <div class="stat accent"><div class="stat-val">${inv.length}</div><div class="stat-lbl">Total Invoices</div></div>
  <div class="stat"><div class="stat-val">${[...new Set(inv.map((i: any) => i.merchant))].length}</div><div class="stat-lbl">Unique Merchants</div></div>
  <div class="stat green"><div class="stat-val">${total > 0 ? fmtINR(total) : '—'}</div><div class="stat-lbl">Total Value</div></div>
</div>
${inv.length ? `
<div class="card">
  <div class="row-between" style="margin-bottom:14px;">
    <div class="card-title" style="margin:0;">All Invoices</div>
    <div class="row" style="gap:8px;">
      <button class="btn btn-ghost btn-sm" id="libRefreshBtn">↻ Refresh</button>
      <button class="btn btn-danger btn-sm" id="libClearBtn">🗑 Clear all</button>
    </div>
  </div>
  <div class="tbl-wrap">
    <table class="data-table">
      <thead><tr><th>Invoice No</th><th>Merchant Target</th><th>Amount</th><th>UTR</th><th>Saved</th><th>Download</th></tr></thead>
      <tbody>
        ${inv.map((i: any) => `
        <tr>
          <td style="font-weight:700;">${esc(i.invNum)}</td>
          <td>${esc(i.merchant)}</td>
          <td style="font-weight:700;color:var(--green);">${fmtINR(i.amount)}</td>
          <td style="font-family:monospace;font-size:11px;color:var(--muted);">${esc(i.utr || '')}</td>
          <td style="font-size:11px;color:var(--muted);">${fmt(i.savedAt)}</td>
          <td>
            <div class="row" style="gap:5px;">
              ${i.pdfUrl ? `<a href="${esc(i.pdfUrl)}" target="_blank" class="btn btn-ghost btn-xs">⬇ PDF</a>` : ''}
              ${i.docxUrl ? `<a href="${esc(i.docxUrl)}" target="_blank" class="btn btn-ghost btn-xs">⬇ DOCX</a>` : ''}
              <button class="btn btn-danger btn-xs" data-lib-del="${esc(i.id)}">✕</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>` : `
<div class="empty"><div class="empty-icon">📁</div><h3>No invoices saved yet</h3><p>Generated invoices appear here automatically.</p></div>`}`;
  }

  function wireLibrary() {
    document.getElementById('libRefreshBtn')?.addEventListener('click', async () => {
      try {
        S.savedInvoices = await dbLoadInvoices(supa);
        render(); toast('Refreshed from cloud.', 'good');
      } catch (e) { toast('Refresh failed', 'bad'); }
    });
    document.getElementById('libClearBtn')?.addEventListener('click', async () => {
      if (!confirm(`Delete all ${S.savedInvoices.length} saved invoices? This cannot be undone.`)) return;
      try {
        await dbClearInvoices(supa);
        S.savedInvoices = [];
        toast('All invoices deleted from cloud.', '');
        render();
      } catch (e) { toast('Delete failed', 'bad'); }
    });
    document.querySelectorAll('[data-lib-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this invoice?')) return;
        const id = (btn as HTMLElement).dataset.libDel!;
        const inv = S.savedInvoices.find((i: any) => i.id === id);
        try {
          await dbDeleteInvoice(supa, id, inv?.pdfUrl, inv?.docxUrl);
          S.savedInvoices = S.savedInvoices.filter((i: any) => i.id !== id);
          toast('Invoice deleted.', ''); render();
        } catch (e) { toast('Delete failed', 'bad'); }
      });
    });
  }

  /* ═══════════════════════════════════════════════
     PAGE: SELLER SETUP
  ═══════════════════════════════════════════════ */
  function viewSettings() {
    const c = S.company || {};
    const logoSrc = getLogoSrc(S.company);
    return `
<div style="margin-bottom:24px;"><h1>Seller Setup</h1><p class="page-sub">Configure primary business billing rules below.</p></div>
<div class="card">
  <div class="card-title">🖼 Company Logo</div>
  <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;">
    <div id="logoPreviewBox" style="width:150px;height:72px;border:1.5px dashed var(--border2);border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--surface2);flex-shrink:0;overflow:hidden;">
      ${logoSrc ? `<img src="${logoSrc}" style="max-width:140px;max-height:64px;object-fit:contain;">` : '<span style="font-size:11px;color:var(--dim);">No logo uploaded</span>'}
    </div>
    <div>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
        📁 Upload Logo <input type="file" id="logoInput" accept="image/png,image/jpeg,image/jpg,image/svg+xml" style="display:none;">
      </label>
      ${logoSrc ? '<button class="btn btn-danger btn-sm" id="removeLogoBtn" style="margin-left:8px;">✕ Remove Logo</button>' : ''}
    </div>
  </div>
  <div class="card-title">🏢 Company Details</div>
  <div class="grid2">
    <div class="field"><label>Company Name *</label><input type="text" id="co_name" value="${esc(c.name || '')}" placeholder="Your company name"></div>
    <div class="field"><label>PAN Number</label><input type="text" id="co_pan" value="${esc(c.pan || '')}" placeholder="AANCP1985H"></div>
    <div class="field"><label>GST Number</label><input type="text" id="co_gst" value="${esc(c.gst || '')}" placeholder="29AANCP1985H1ZS"></div>
    <div class="field"><label>CIN Number</label><input type="text" id="co_cin" value="${esc(c.cin || '')}" placeholder="U74999KA2022PTC165574"></div>
    <div class="field"><label>Email</label><input type="text" id="co_email" value="${esc(c.email || '')}" placeholder="accounts@company.com"></div>
    <div class="field"><label>Phone</label><input type="text" id="co_phone" value="${esc(c.phone || '')}" placeholder="+91 98765 43210"></div>
  </div>
  <div class="field"><label>Registered Address</label><input type="text" id="co_address" value="${esc(c.address || '')}" placeholder="Street, Area"></div>
  <div class="grid3">
    <div class="field"><label>City</label><input type="text" id="co_city" value="${esc(c.city || '')}" placeholder="City"></div>
    <div class="field"><label>State</label><input type="text" id="co_state" value="${esc(c.state || '')}" placeholder="Madhya Pradesh"></div>
    <div class="field"><label>PIN Code</label><input type="text" id="co_pin" value="${esc(c.pin || '')}" placeholder="000000"></div>
  </div>
  <div class="grid2">
    <div class="field"><label>Authorised Signatory</label><input type="text" id="co_signatory" value="${esc(c.signatory || '')}" placeholder="Full name"></div>
    <div class="field"><label>Designation</label><input type="text" id="co_designation" value="${esc(c.designation || '')}" placeholder="Director"></div>
  </div>
  <div style="display:flex;justify-content:flex-end;margin-top:8px;">
    <button class="btn btn-primary" id="saveCompanyBtn">Save & Sync to Cloud</button>
  </div>
</div>`;
  }

  function wireSettings() {
    const logoInput = document.getElementById('logoInput') as HTMLInputElement;
    if (logoInput) {
      logoInput.addEventListener('change', (e: any) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 500000) { toast('Logo too large. Use an image under 500KB.', 'bad'); return; }
        const reader = new FileReader();
        reader.onload = (ev: any) => {
          if (!S.company) S.company = {};
          S.company.logoB64 = ev.target.result;
          S.company.logoUrl = null;
          const box = document.getElementById('logoPreviewBox');
          if (box) box.innerHTML = `<img src="${ev.target.result}" style="max-width:140px;max-height:64px;object-fit:contain;">`;
          toast('Logo ready. Save to finalize upload.', 'good');
        };
        reader.readAsDataURL(file);
      });
    }
    document.getElementById('removeLogoBtn')?.addEventListener('click', async () => {
      if (S.company) { S.company.logoB64 = null; S.company.logoUrl = null; }
      try { if (supaReady) await dbSaveCompany(supa, S.company || {}); } catch (e) { }
      toast('Logo removed.', ''); render();
    });
    document.getElementById('saveCompanyBtn')?.addEventListener('click', async () => {
      const name = (document.getElementById('co_name') as HTMLInputElement).value.trim();
      if (!name) { toast('Company name is required.', 'bad'); return; }
      const logoB64 = S.company?.logoB64 || null;
      const logoUrl = S.company?.logoUrl || null;
      S.company = {
        name, logoB64, logoUrl,
        defaultGstRate: 18,
        pan: (document.getElementById('co_pan') as HTMLInputElement).value.trim(),
        gst: (document.getElementById('co_gst') as HTMLInputElement).value.trim(),
        cin: (document.getElementById('co_cin') as HTMLInputElement).value.trim(),
        email: (document.getElementById('co_email') as HTMLInputElement).value.trim(),
        phone: (document.getElementById('co_phone') as HTMLInputElement).value.trim(),
        address: (document.getElementById('co_address') as HTMLInputElement).value.trim(),
        city: (document.getElementById('co_city') as HTMLInputElement).value.trim(),
        state: (document.getElementById('co_state') as HTMLInputElement).value.trim(),
        pin: (document.getElementById('co_pin') as HTMLInputElement).value.trim(),
        signatory: (document.getElementById('co_signatory') as HTMLInputElement).value.trim(),
        designation: (document.getElementById('co_designation') as HTMLInputElement).value.trim(),
      };
      try {
        if (supaReady) {
          const savedLogoUrl = await dbSaveCompany(supa, S.company);
          if (savedLogoUrl) { S.company.logoUrl = savedLogoUrl; S.company.logoB64 = null; }
        }
        toast('Seller details saved to cloud!', 'good');
      } catch (e) { toast('Save failed', 'bad'); }
      render();
    });
  }

  /* ═══════════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════════ */
  let toastT: any;
  function toast(msg: string, type: string = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.className = 'show ' + (type || '');
    clearTimeout(toastT); toastT = setTimeout(() => el.className = '', 3500);
  }

  /* ═══════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════ */
  let appDataLoaded = false;

  (window as any).__gotoSettings = () => goto('settings');

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try { await supa.auth.signOut(); }
    catch (e: any) { toast('Logout failed: ' + e.message, 'bad'); }
  });

  async function pingAndLoad(session: any) {
    setDbStatus('amber', 'Connecting…');
    try {
      const { error: pingError } = await supa.from('company_settings').select('id').limit(1);
      if (pingError && pingError.code !== 'PGRST116') throw pingError;
      supaReady = true;
      setDbStatus('green', 'Connected ✓');
    } catch (e) {
      supaReady = false;
      setDbStatus('red', 'Connection failed');
    }
    await loadAppData();
  }

  async function boot() {
    const ok = initSupabase();
    if (!ok) { setDbStatus('red', 'Connection failed'); showAuthScreen(); return; }

    supa.auth.onAuthStateChange((event: string, session: any) => {
      S.session = session;
      if (session) {
        showAppShell(session);
        if (!appDataLoaded) {
          appDataLoaded = true;
          pingAndLoad(session);
        }
      } else {
        appDataLoaded = false;
        supaReady = false;
        S.company = null; S.profiles = []; S.savedInvoices = []; S.rows = []; S.generated = [];
        showAuthScreen();
      }
    });

    const { data: { session } } = await supa.auth.getSession();
    if (session) {
      S.session = session;
      showAppShell(session);
      if (!appDataLoaded) {
        appDataLoaded = true;
        await pingAndLoad(session);
      }
    } else {
      showAuthScreen();
    }
  }

  boot();
}