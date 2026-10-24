package main

import (
	"net/http"
)

func (s *Server) handleDashboardUI(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	rawHtml := `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Auto Switcher Pro · Centro de Mando</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #06090e;
      --card-bg: rgba(13, 17, 23, 0.85);
      --card-border: rgba(56, 189, 248, 0.15);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.25);
      --green: #10b981;
      --green-glow: rgba(16, 185, 129, 0.2);
      --gold: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
      --font: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.08) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(168, 85, 247, 0.08) 0px, transparent 50%);
    }

    /* LOGIN SCREEN */
    #login-view {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .login-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 40px var(--accent-glow);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      text-align: center;
      animation: fadeIn 0.4s ease-out;
    }
    .login-logo-img {
      width: 72px;
      height: 72px;
      object-fit: contain;
      border-radius: 16px;
      margin-bottom: 14px;
      filter: drop-shadow(0 0 20px rgba(56, 189, 248, 0.5));
      animation: logoPulse 3s ease-in-out infinite;
    }
    @keyframes logoPulse {
      0%, 100% { transform: scale(1); filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.4)); }
      50% { transform: scale(1.04); filter: drop-shadow(0 0 26px rgba(56, 189, 248, 0.7)); }
    }
    .remember-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: -10px;
      margin-bottom: 22px;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }
    .remember-row input {
      accent-color: var(--accent);
      cursor: pointer;
    }
    .login-title {
      font-size: 22px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .login-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 6px;
      margin-bottom: 28px;
    }
    .login-field {
      text-align: left;
      margin-bottom: 20px;
    }
    .login-field label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .login-input {
      width: 100%;
      padding: 12px 16px;
      background: #020617;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }
    .login-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 16px var(--accent-glow);
    }
    .btn-login {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #0284c7, #0369a1);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.3);
    }
    .btn-login:hover {
      background: linear-gradient(135deg, #0369a1, #075985);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.5);
      transform: translateY(-1px);
    }
    .login-error {
      margin-top: 14px;
      font-size: 12px;
      color: var(--red);
      font-weight: 600;
      display: none;
    }

    /* DASHBOARD VIEW */
    #dashboard-view {
      display: none;
      padding: 28px 36px 60px;
      max-width: 1440px;
      margin: 0 auto;
      animation: fadeIn 0.3s ease-out;
    }

    /* TOP NAVBAR */
    .navbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 28px;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav-logo-img {
      width: 38px;
      height: 38px;
      object-fit: contain;
      border-radius: 8px;
      filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.4));
    }
    .nav-title {
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .nav-badge-host {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--green);
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-action {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }
    .btn-create-modal {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      border-color: rgba(16, 185, 129, 0.4);
      box-shadow: 0 0 14px var(--green-glow);
    }
    .btn-create-modal:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-refresh {
      background: #0f172a;
      color: var(--text);
      border-color: rgba(255,255,255,0.1);
    }
    .btn-refresh:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .btn-logout {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .btn-logout:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    /* METRIC CARDS (KPIs) */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      margin-bottom: 28px;
    }
    @media (max-width: 960px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 580px) {
      .kpi-grid { grid-template-columns: 1fr; }
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      opacity: 0.5;
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .kpi-value {
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.03em;
    }
    .kpi-sub {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* CONTROLS BAR: SEARCH & TABS */
    .controls-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      margin-bottom: 18px;
    }
    .filter-tabs {
      display: flex;
      gap: 6px;
      background: #020617;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .tab-btn {
      padding: 6px 14px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      border-radius: 7px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
    .search-box {
      position: relative;
      min-width: 280px;
    }
    .search-input {
      width: 100%;
      padding: 8px 12px 8px 34px;
      background: #020617;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 12px;
      outline: none;
      transition: all 0.2s;
    }
    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 10px var(--accent-glow);
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 13px;
      color: var(--text-muted);
    }

    /* MAIN TABLE */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      overflow-x: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th, td {
      padding: 13px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    th {
      background: rgba(2, 6, 23, 0.6);
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    tr:hover td {
      background: rgba(56, 189, 248, 0.02);
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-active { background: rgba(16, 185, 129, 0.2); color: var(--green); border: 1px solid var(--green); }
    .badge-trial { background: rgba(245, 158, 11, 0.2); color: var(--gold); border: 1px solid var(--gold); }
    .badge-revoked { background: rgba(239, 68, 68, 0.2); color: var(--red); border: 1px solid var(--red); }
    .badge-expired { background: rgba(148, 163, 184, 0.2); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.4); }

    .country-flag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 600;
      color: #cbd5e1;
    }
    .btn-table {
      padding: 5px 10px;
      border-radius: 6px;
      border: none;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-table-approve { background: var(--green); color: #000; }
    .btn-table-approve:hover { filter: brightness(1.15); }
    .btn-table-revoke { background: transparent; color: var(--red); border: 1px solid var(--red); margin-left: 6px; }
    .btn-table-revoke:hover { background: rgba(239, 68, 68, 0.15); }

    /* MODAL */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(2, 6, 23, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .modal-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-card {
      background: var(--card-bg);
      border: 1px solid var(--accent);
      box-shadow: 0 20px 40px rgba(0,0,0,0.8), 0 0 30px var(--accent-glow);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 28px;
      animation: modalSlide 0.25s ease-out;
    }
    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .modal-title { font-size: 16px; font-weight: 800; color: #fff; }
    .modal-close {
      background: transparent; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;
    }
    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .modal-body label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .modal-input, .modal-select {
      width: 100%;
      padding: 10px 14px;
      background: #020617;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    .modal-input:focus, .modal-select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 10px var(--accent-glow);
    }
    .btn-submit-approve {
      margin-top: 10px;
      padding: 12px;
      background: linear-gradient(135deg, #10b981, #059669);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 0 16px var(--green-glow);
    }
    .btn-submit-approve:hover { filter: brightness(1.1); }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes modalSlide { from { transform: translateY(-16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  </style>
</head>
<body>

  <!-- 1. PANTALLA DE LOGIN MODERNA -->
  <div id="login-view">
    <div class="login-card">
      <img src="/assets/logo.png" alt="Auto Switcher Pro Logo" class="login-logo-img">
      <h2 class="login-title">Auto Switcher Pro</h2>
      <div class="login-subtitle">Centro de Mando de Licencias y Telemetría</div>
      
      <div class="login-field">
        <label>Token de Acceso Master</label>
        <input type="password" id="inputToken" class="login-input" placeholder="••••••••••••••••••••" autofocus onkeydown="if(event.key==='Enter') handleLogin()">
      </div>

      <label class="remember-row">
        <input type="checkbox" id="rememberToken" checked>
        <span>Recordar contraseña provisional en este navegador</span>
      </label>

      <button onclick="handleLogin()" class="btn-login">Ingresar al Centro de Mando →</button>
      <div id="loginError" class="login-error">Token incorrecto o no autorizado.</div>
    </div>
  </div>

  <!-- 2. DASHBOARD VIEW -->
  <div id="dashboard-view">
    <!-- Navbar -->
    <div class="navbar">
      <div class="nav-brand">
        <img src="/assets/logo.png" alt="Auto Switcher Pro" class="nav-logo-img">
        <div>
          <div class="nav-title">Centro de Mando de Licencias</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Contabo Cloud Hub · Controles Comerciales</div>
        </div>
        <span class="nav-badge-host">hub.wiloxdev.com</span>
      </div>
      <div class="nav-actions">
        <button onclick="openApproveModal()" class="btn-action btn-create-modal">
          <span>+</span> Nueva Activación Pro
        </button>
        <button onclick="fetchMachines()" class="btn-action btn-refresh">
          🔄 Refrescar
        </button>
        <button onclick="handleLogout()" class="btn-action btn-logout">
          Cerrar Sesión
        </button>
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Máquinas</div>
        <div class="kpi-value" id="kpi-total">0</div>
        <div class="kpi-sub">Instalaciones globales conectadas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Licencias Pro Activas</div>
        <div class="kpi-value" id="kpi-pro" style="color:var(--green);">0</div>
        <div class="kpi-sub">Clientes comerciales validados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Periodos de Prueba</div>
        <div class="kpi-value" id="kpi-trial" style="color:var(--gold);">0</div>
        <div class="kpi-sub">30 días de evaluación en curso</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Conmutaciones Totales</div>
        <div class="kpi-value" id="kpi-rotations" style="color:var(--accent);">⚡ 0</div>
        <div class="kpi-sub">Rotaciones salvadas de rate-limits</div>
      </div>
    </div>

    <!-- Filtros y Buscador -->
    <div class="controls-bar">
      <div class="filter-tabs">
        <button class="tab-btn active" onclick="setFilter('all', this)">Todos (<span id="count-all">0</span>)</button>
        <button class="tab-btn" onclick="setFilter('active', this)">Pro (<span id="count-pro">0</span>)</button>
        <button class="tab-btn" onclick="setFilter('trial', this)">Trial (<span id="count-trial">0</span>)</button>
        <button class="tab-btn" onclick="setFilter('revoked', this)">Revocados (<span id="count-revoked">0</span>)</button>
        <button class="tab-btn" style="border-color:#38bdf8; color:#38bdf8;" onclick="toggleReportsView(this)">📩 Tickets & Diagnósticos (<span id="count-reports">0</span>)</button>
      </div>

      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Buscar Machine ID, cliente, país..." oninput="renderTable()">
      </div>
    </div>

    <!-- Sección Tickets / Reportes de Soporte -->
    <div id="reportsContainer" style="display:none; margin-bottom:28px;">
      <div style="background:var(--card-bg); border:1px solid rgba(56,189,248,0.3); border-radius:14px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="margin:0; font-size:16px; color:#38bdf8; display:flex; align-items:center; gap:8px;">
            <span>📩</span> Bandeja de Diagnósticos y Soporte en Vivo
          </h3>
          <span style="font-size:12px; color:var(--text-muted);">Eventos anonimizados recibidos desde /switcher report</span>
        </div>
        <div id="reportsList" style="display:flex; flex-direction:column; gap:12px;">
          <div style="text-align:center; padding:20px; color:var(--text-muted);">No hay reportes de soporte recibidos aún.</div>
        </div>
      </div>
    </div>

    <!-- Tabla Principal -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Machine ID</th>
            <th>MAC Address</th>
            <th>Cliente</th>
            <th>País</th>
            <th>Estado</th>
            <th>Versión / SO</th>
            <th>Rotaciones</th>
            <th>Pools</th>
            <th>Última Actividad</th>
            <th>Vence</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          <tr><td colspan="11" style="text-align:center; padding:30px; color:var(--text-muted);">Cargando telemetría...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 3. MODAL DE APROBACIÓN PRO -->
  <div id="approveModal" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">💳 Aprobar Pago & Activar Pro</div>
        <button onclick="closeApproveModal()" class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div>
          <label>Machine ID:</label>
          <input type="text" id="modalMachine" class="modal-input" placeholder="CPA-XXXX-XXXX-XXXX">
        </div>
        <div>
          <label>Nombre / Contacto Cliente:</label>
          <input type="text" id="modalClient" class="modal-input" placeholder="Wilson / usuario@email.com">
        </div>
        <div>
          <label>Duración:</label>
          <select id="modalDays" class="modal-select">
            <option value="0">De por Vida (Lifetime)</option>
            <option value="365">1 Año (365 días)</option>
            <option value="180">6 Meses (180 días)</option>
            <option value="30">1 Mes (30 días)</option>
          </select>
        </div>
        <div>
          <label>Método de Pago:</label>
          <select id="modalMethod" class="modal-select">
            <option value="binance">🟡 Binance Pay (USDT)</option>
            <option value="paypal">🔵 PayPal (USD)</option>
            <option value="transferencia">🏦 Transferencia / Efectivo</option>
            <option value="admin">⭐ Cortesía / Admin</option>
          </select>
        </div>
        <div>
          <label>Referencia o TxID (Opcional):</label>
          <input type="text" id="modalRef" class="modal-input" placeholder="TxID / Hash / Correo">
        </div>
        <button onclick="submitModalApproval()" class="btn-submit-approve">
          ✅ Firmar Criptográficamente y Activar Pro
        </button>
      </div>
    </div>
  </div>

  <script>
    let currentToken = '';
    let allMachines = [];
    let allReports = [];
    let currentFilter = 'all';
    let showingReports = false;

    // Recuperar token recordado al cargar la página
    function initAuth() {
      // 1. Revisar si viene ?token= en la URL
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token');
      if (queryToken) {
        currentToken = queryToken;
        localStorage.setItem('cpamc_admin_token', currentToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        currentToken = localStorage.getItem('cpamc_admin_token') || sessionStorage.getItem('cpamc_admin_token') || '';
      }

      const input = document.getElementById('inputToken');
      const chk = document.getElementById('rememberToken');

      // Si hay token guardado en localStorage, marcar la casilla y llenar el input
      if (localStorage.getItem('cpamc_admin_token')) {
        chk.checked = true;
      }
      if (currentToken) {
        input.value = currentToken;
        // Intentar ingresar directamente
        fetchMachines(false);
      } else {
        showLoginView();
      }
    }

    function showLoginView() {
      document.getElementById('login-view').style.display = 'flex';
      document.getElementById('dashboard-view').style.display = 'none';
      setTimeout(() => document.getElementById('inputToken').focus(), 100);
    }

    function showDashboardView() {
      document.getElementById('login-view').style.display = 'none';
      document.getElementById('dashboard-view').style.display = 'block';
    }

    function handleLogin() {
      const val = document.getElementById('inputToken').value.trim();
      const errBox = document.getElementById('loginError');
      errBox.style.display = 'none';

      if (!val) {
        errBox.innerText = 'Por favor ingresa la contraseña.';
        errBox.style.display = 'block';
        return;
      }
      currentToken = val;
      fetchMachines(true);
    }

    function handleLogout() {
      localStorage.removeItem('cpamc_admin_token');
      sessionStorage.removeItem('cpamc_admin_token');
      currentToken = '';
      document.getElementById('inputToken').value = '';
      showLoginView();
    }

    async function fetchMachines(isLoginAttempt = false) {
      if (!currentToken) {
        showLoginView();
        return;
      }
      try {
        const res = await fetch('/api/v1/admin/licenses', {
          headers: { 'X-Admin-Token': currentToken }
        });
        if (!res.ok) throw new Error('Token no válido');
        const data = await res.json();
        
        // Guardar token según la casilla seleccionada
        const chk = document.getElementById('rememberToken');
        if (chk && chk.checked) {
          localStorage.setItem('cpamc_admin_token', currentToken);
          sessionStorage.removeItem('cpamc_admin_token');
        } else {
          sessionStorage.setItem('cpamc_admin_token', currentToken);
          localStorage.removeItem('cpamc_admin_token');
        }

        showDashboardView();
        allMachines = data.machines || [];
        updateKPIs();
        renderTable();
        fetchReports();
      } catch (e) {
        if (isLoginAttempt) {
          const errBox = document.getElementById('loginError');
          errBox.innerText = 'Contraseña incorrecta. Verifica e intenta nuevamente.';
          errBox.style.display = 'block';
        } else {
          // Token expirado o inválido guardado previamente
          handleLogout();
        }
      }
    }

    function updateKPIs() {
      const total = allMachines.length;
      const pro = allMachines.filter(m => m.status === 'active').length;
      const trial = allMachines.filter(m => m.status === 'trial').length;
      const revoked = allMachines.filter(m => m.status === 'revoked').length;
      const rotations = allMachines.reduce((acc, m) => acc + (m.rotations || 0), 0);

      document.getElementById('kpi-total').innerText = total;
      document.getElementById('kpi-pro').innerText = pro;
      document.getElementById('kpi-trial').innerText = trial;
      document.getElementById('kpi-rotations').innerText = '⚡ ' + rotations;

      document.getElementById('count-all').innerText = total;
      document.getElementById('count-pro').innerText = pro;
      document.getElementById('count-trial').innerText = trial;
      document.getElementById('count-revoked').innerText = revoked;
    }

    function setFilter(filter, el) {
      currentFilter = filter;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      renderTable();
    }

    function getFlagEmoji(cc) {
      if (!cc || cc === '??' || cc === 'LOCAL') return '🌐';
      if (cc.length !== 2) return '🌐';
      const codePoints = cc.toUpperCase().split('').map(c => 127397 + c.charCodeAt());
      return String.fromCodePoint(...codePoints);
    }

    function timeAgo(ts) {
      if (!ts) return '-';
      const diff = Math.floor(Date.now() / 1000) - ts;
      if (diff < 60) return 'Hace instantes';
      if (diff < 3600) return 'Hace ' + Math.floor(diff / 60) + 'm';
      if (diff < 86400) return 'Hace ' + Math.floor(diff / 3600) + 'h';
      return 'Hace ' + Math.floor(diff / 86400) + 'd';
    }

    const LATEST_RELEASE = '0.1.0';

    function renderTable() {
      const query = document.getElementById('searchInput').value.toLowerCase().trim();
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      let filtered = allMachines.filter(m => {
        if (currentFilter !== 'all' && m.status !== currentFilter) return false;
        if (query) {
          const matchId = (m.machine_id || '').toLowerCase().includes(query);
          const matchMac = (m.mac_address || '').toLowerCase().includes(query);
          const matchClient = (m.client_name || '').toLowerCase().includes(query);
          const matchCountry = (m.country_name || '').toLowerCase().includes(query) || (m.country_code || '').toLowerCase().includes(query);
          return matchId || matchMac || matchClient || matchCountry;
        }
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:30px; color:var(--text-muted);">No se encontraron máquinas con este filtro.</td></tr>';
        return;
      }

      filtered.forEach(m => {
        const tr = document.createElement('tr');
        const flag = getFlagEmoji(m.country_code);
        const countryLabel = m.country_code ? (m.country_code === 'LOCAL' ? 'Local' : m.country_code) : '??';

        // 1. Versión instalada vs Release oficial
        const vNum = m.version ? m.version.replace(/^v/, '') : '';
        let versionBadge = '';
        if (!vNum || vNum === '?') {
          versionBadge = '<span style="font-size:11px; color:#94a3b8;">Desconocida</span>';
        } else if (vNum === LATEST_RELEASE) {
          versionBadge = '<span style="color:#10b981; font-weight:700; font-size:11px;">v' + vNum + '</span> <span style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); color:#34d399; font-size:9.5px; padding:1px 5px; border-radius:4px; font-weight:700;">AL DÍA</span>';
        } else {
          versionBadge = '<span style="color:#f59e0b; font-weight:700; font-size:11px;">v' + vNum + '</span> <span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:#fbbf24; font-size:9.5px; padding:1px 5px; border-radius:4px; font-weight:700;">UPDATE v' + LATEST_RELEASE + '</span>';
        }
        const osLabel = m.os ? '<div style="font-size:10px; color:#64748b; margin-top:2px;">' + m.os + '</div>' : '';

        // 2. Total de Pools y badges individuales separados
        let poolsDisplay = '<span style="color:var(--text-muted);">-</span>';
        if (m.active_pools && m.active_pools.length > 0) {
          const count = m.active_pools.length;
          const badges = m.active_pools.map(p => '<span style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; color:var(--accent);">' + p + '</span>').join(' ');
          poolsDisplay = '<div><div style="font-size:10.5px; font-weight:700; color:#cbd5e1; margin-bottom:3px;">📦 ' + count + (count === 1 ? ' Pool' : ' Pools') + '</div><div style="display:flex; flex-wrap:wrap; gap:4px;">' + badges + '</div></div>';
        }

        const expText = m.expires_at > 0 ? new Date(m.expires_at * 1000).toLocaleDateString() : 'Lifetime';

        const reqCount = m.rotations || 0;
        const failCount = m.total_failovers || 0;
        const rotationsBadge = '<div><div style="color:var(--accent); font-weight:700;">⚡ ' + reqCount + ' reqs</div>' +
          (failCount > 0 
            ? '<div style="font-size:10.5px; color:#10b981; font-weight:700; margin-top:2px;">🛡️ ' + failCount + ' failovers</div>' 
            : '<div style="font-size:10px; color:#64748b; margin-top:2px;">(líder estable)</div>') + '</div>';

        tr.innerHTML = 
          '<td><code style="font-family:var(--font-mono); color:var(--accent); font-weight:700;">' + m.machine_id + '</code></td>' +
          '<td>' + (m.mac_address ? '<code style="font-family:var(--font-mono); color:#38bdf8; font-size:11.5px; background:rgba(56,189,248,0.1); padding:2px 6px; border-radius:4px; border:1px solid rgba(56,189,248,0.2);">' + m.mac_address + '</code>' : '<span style="color:var(--text-muted); font-size:11px;">-</span>') + '</td>' +
          '<td><strong>' + (m.client_name || 'Nuevo Usuario') + '</strong></td>' +
          '<td><span class="country-flag"><span>' + flag + '</span> ' + countryLabel + '</span></td>' +
          '<td><span class="badge badge-' + m.status + '">' + m.status.toUpperCase() + '</span></td>' +
          '<td><div>' + versionBadge + osLabel + '</div></td>' +
          '<td>' + rotationsBadge + '</td>' +
          '<td>' + poolsDisplay + '</td>' +
          '<td><span style="font-size:11px; color:var(--text-muted);">' + timeAgo(m.last_seen_at) + '</span></td>' +
          '<td>' + expText + '</td>' +
          '<td>' +
            '<button class="btn-table btn-table-approve" onclick="openApproveModal(\'' + m.machine_id + '\', \'' + (m.client_name || '') + '\')">Aprobar Pro</button>' +
            (m.status === 'active' ? ' <button class="btn-table btn-table-revoke" onclick="revokeMachine(\'' + m.machine_id + '\')">Revocar</button>' : '') +
            ' <button class="btn-table btn-table-revoke" style="border-color:#64748b; color:#94a3b8;" title="Eliminar registro fantasma o de prueba" onclick="deleteMachine(\'' + m.machine_id + '\')">🗑️</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    }

    function openApproveModal(id = '', name = '') {
      document.getElementById('modalMachine').value = id;
      document.getElementById('modalClient').value = name || '';
      document.getElementById('approveModal').classList.add('open');
    }

    function closeApproveModal() {
      document.getElementById('approveModal').classList.remove('open');
    }

    async function submitModalApproval() {
      const mID = document.getElementById('modalMachine').value.trim();
      const client = document.getElementById('modalClient').value.trim();
      const days = parseInt(document.getElementById('modalDays').value);
      const method = document.getElementById('modalMethod').value;
      const ref = document.getElementById('modalRef').value.trim();

      if (!mID) return alert('Por favor ingresa el Machine ID');

      try {
        const res = await fetch('/api/v1/admin/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': currentToken },
          body: JSON.stringify({
            machine_id: mID,
            client_name: client || 'Cliente Pro',
            tier: 'pro',
            days: days,
            payment_method: method,
            payment_ref: ref
          })
        });
        const d = await res.json();
        if (d.ok) {
          closeApproveModal();
          fetchMachines();
        } else {
          alert('❌ Error: ' + (d.error || 'Fallo'));
        }
      } catch (e) {
        alert('Error conectando con el servidor');
      }
    }

    async function revokeMachine(mID) {
      if (!confirm('¿Seguro que deseas revocar inmediatamente el acceso a ' + mID + '?')) return;
      await fetch('/api/v1/admin/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': currentToken },
        body: JSON.stringify({ machine_id: mID })
      });
      fetchMachines();
    }

    async function deleteMachine(mID) {
      if (!confirm('¿Deseas eliminar permanentemente el registro ' + mID + '? (Úsalo para limpiar pruebas o contenedores viejos)')) return;
      await fetch('/api/v1/admin/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': currentToken },
        body: JSON.stringify({ machine_id: mID })
      });
      fetchMachines();
    }

    async function fetchReports() {
      if (!currentToken) return;
      try {
        const res = await fetch('/api/v1/admin/reports', {
          headers: { 'X-Admin-Token': currentToken }
        });
        if (!res.ok) return;
        const data = await res.json();
        allReports = data.reports || [];
        document.getElementById('count-reports').innerText = allReports.length;
        renderReports();
      } catch (e) {}
    }

    function toggleReportsView(el) {
      showingReports = !showingReports;
      const container = document.getElementById('reportsContainer');
      container.style.display = showingReports ? 'block' : 'none';
      el.style.background = showingReports ? 'rgba(56, 189, 248, 0.2)' : 'transparent';
      if (showingReports) fetchReports();
    }

    function renderReports() {
      const list = document.getElementById('reportsList');
      if (allReports.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No hay reportes de soporte recibidos aún.</div>';
        return;
      }
      let html = '';
      for (let i = 0; i < allReports.length; i++) {
        const r = allReports[i];
        const dateStr = new Date(r.timestamp * 1000).toLocaleString();
        const logs = r.recent_logs || [];
        let logsHtml = '';
        for (let j = 0; j < logs.length; j++) {
          const l = logs[j];
          const badge = l.is_failover ? '<span style="color:#f87171; font-weight:700;">[FAILOVER]</span>' : '<span style="color:#34d399;">[OK]</span>';
          logsHtml += '<div style="font-family:monospace; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05); color:#94a3b8;">' +
            badge + ' Pool: <strong style="color:#f1f5f9;">' + (l.pool_id || l.pool_prefix) + '</strong> | Cuenta: ' + l.account_email + ' | Modelo: ' + l.target_model + ' (HTTP ' + (l.status_code || 200) + ')</div>';
        }

        html += '<div style="background:rgba(15, 23, 42, 0.6); border:1px solid rgba(56, 189, 248, 0.2); border-radius:10px; padding:14px; margin-bottom:10px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
            '<div><span style="font-family:monospace; font-weight:800; color:#38bdf8; background:rgba(56, 189, 248, 0.15); padding:2px 8px; border-radius:4px;">' + r.id + '</span>' +
            '<strong style="margin-left:8px; color:#fff;">' + r.client_name + '</strong>' +
            '<span style="color:var(--text-muted); font-size:12px; margin-left:6px;">(' + r.machine_id + (r.mac_address ? ' · <code style="color:#38bdf8;">' + r.mac_address + '</code>' : '') + ')</span></div>' +
            '<span style="font-size:11px; color:var(--text-muted);">' + dateStr + '</span>' +
          '</div>' +
          (r.summary ? '<div style="font-size:13px; color:#facc15; margin-bottom:8px;">💬 <em>"' + r.summary + '"</em></div>' : '') +
          '<div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">' +
            'Versión: ' + r.version + ' | SO: ' + r.os + ' | Ubicación: ' + (r.country_name || 'Desconocido') + ' (' + (r.ip || '-') + ') | Últimos eventos: ' + logs.length +
          '</div>' +
          '<div style="background:#090d16; border-radius:6px; padding:8px; max-height:140px; overflow-y:auto;">' +
            (logsHtml || '<div style="color:#64748b; font-size:11px;">Sin eventos de rotación registrados</div>') +
          '</div>' +
        '</div>';
      }
      list.innerHTML = html;
    }

    initAuth();
    setInterval(fetchMachines, 12000);
  </script>
</body>
</html>`

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(rawHtml))
}
