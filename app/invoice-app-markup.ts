
export const APP_MARKUP = `
  <div id="toast"></div>

  <div id="authScreen">
    <div class="auth-card" id="authCard"></div>
  </div>

  <div class="shell" id="appShell" style="display:none;">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-mark">Fidy<span>Invoice</span></div>
        <div class="logo-sub">Settlement Generator</div>
      </div>
      <div class="nav-item active" data-page="invoices"><span class="nav-icon">🧾</span> Generate Invoices</div>
      <div class="nav-sep"></div>
      <div class="nav-item" data-page="profiles"><span class="nav-icon">🏢</span> Merchant Profiles<span
          class="nav-badge" id="profileCount">0</span></div>
      <div class="nav-item" data-page="library"><span class="nav-icon">📁</span> Saved Invoices<span class="nav-badge"
          id="libCount">0</span></div>
      <div class="nav-item" data-page="settings"><span class="nav-icon">⚙️</span> Seller Setup</div>
      <div class="sidebar-foot">
        <div class="db-status">
          <div class="db-dot amber" id="dbDot"></div>
          <span id="dbLabel">Connecting…</span>
        </div>
        Synced to Supabase cloud.<br>Data persists across devices.
        <div class="user-chip" id="userChip" style="display:none;">
          <div class="ua" id="userAvatar">?</div>
          <div class="ue" id="userEmail"></div>
          <button class="btn btn-ghost btn-xs" id="logoutBtn">Logout</button>
        </div>
      </div>
    </aside>
    <main class="main" id="mainArea"></main>
  </div>
  <div id="printTarget" style="display:none;"></div>
`;