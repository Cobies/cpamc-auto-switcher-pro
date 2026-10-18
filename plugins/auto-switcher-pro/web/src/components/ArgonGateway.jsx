import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getArgonStatus, syncArgonSession, deleteArgonSession } from '../api/managementClient';
import QuotaClock from './QuotaClock';
import './AutoAuthFiles.css';
import './ArgonGateway.css';

export default function ArgonGateway() {
  const [loading, setLoading] = useState(true);
  const [statusData, setStatusData] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [copiedDaemonCmd, setCopiedDaemonCmd] = useState(false);
  const [maskEmails, setMaskEmails] = useState(false);
  const bookmarkletRef = useRef(null);

  // Manual cookie input state
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCookies, setManualCookies] = useState('');
  const [manualAuthUser, setManualAuthUser] = useState('0');
  const [manualEmail, setManualEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getArgonStatus();
      if (data && data.ok) {
        setStatusData(data);
      } else {
        setError(data?.message || 'No se pudo consultar el estado de Gemini Argon Gateway');
      }
    } catch (err) {
      setError(err?.message || 'Error de conexión con el backend de Auto Switcher Pro');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = setInterval(() => {
      loadStatus();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadStatus]);

  // Sincronizador Bookmarklet Code (JavaScript URI)
  const bookmarkletCode = `javascript:(function(){
    try {
      var c = document.cookie;
      if (!c || c.indexOf("__Secure-1PSID") === -1) {
        alert("⚠️ No se encontraron cookies de sesión de Gemini (__Secure-1PSID). Asegúrate de haber iniciado sesión en gemini.google.com.");
        return;
      }
      var uMatch = window.location.pathname.match(/\\/u\\/(\\d+)/);
      var authuser = uMatch ? uMatch[1] : "0";
      var targetUrl = (window.location.protocol === "https:" ? "http:" : window.location.protocol) + "//" + window.location.hostname + ":8317/auto-switcher-pro/argon/sync-session";
      fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookies: c,
          authuser: authuser,
          url: window.location.href,
          save_to_disk: true
        })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.ok) {
          alert("✅ ¡Sesión de Gemini 4 Argon (/u/" + authuser + ") sincronizada exitosamente en Auto Switcher Pro!");
        } else {
          alert("❌ Error del servidor: " + (d.message || "Desconocido"));
        }
      })
      .catch(function(e){
        alert("⚠️ No se pudo conectar con Auto Switcher Pro en el puerto 8317. Verifica que CPAMC esté ejecutándose: " + e.message);
      });
    } catch(err) {
      alert("Error: " + err.message);
    }
  })();`.replace(/\s+/g, ' ');

  useEffect(() => {
    if (bookmarkletRef.current) {
      bookmarkletRef.current.href = bookmarkletCode;
    }
  }, [bookmarkletCode]);

  const handleCopyBookmarklet = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(bookmarkletCode);
      setCopiedBookmarklet(true);
      setFeedback({ type: 'success', message: '¡Código del Bookmarklet copiado al portapapeles! Pégalo como URL en un nuevo marcador de tu navegador.' });
      setTimeout(() => setCopiedBookmarklet(false), 3000);
    }
  };

  const handleCopyDaemonCmd = () => {
    const cmd = "bash /home/wilox/services/gemini-argon-daemon/start-daemon.sh";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cmd);
      setCopiedDaemonCmd(true);
      setFeedback({ type: 'success', message: 'Comando de inicio copiado al portapapeles.' });
      setTimeout(() => setCopiedDaemonCmd(false), 3000);
    }
  };

  const handleManualSync = async (e) => {
    e.preventDefault();
    if (!manualCookies.trim()) {
      setFeedback({ type: 'error', message: 'Por favor pega la cadena de cookies o token __Secure-1PSID.' });
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await syncArgonSession({
        cookies: manualCookies.trim(),
        authuser: manualAuthUser || '0',
        email: manualEmail.trim() || undefined,
        save_to_disk: true,
      });
      if (res && res.ok) {
        setFeedback({ type: 'success', message: res.message || 'Sesión sincronizada exitosamente.' });
        setManualCookies('');
        setShowManualInput(false);
        loadStatus();
      } else {
        setFeedback({ type: 'error', message: res?.message || 'Error al procesar la sesión.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Fallo de red al enviar cookies.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSession = async (authUser, email) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la sesión /u/${authUser} (${email})? Se borrará de memoria RAM y de disco.`)) {
      return;
    }
    setFeedback(null);
    try {
      const res = await deleteArgonSession(authUser);
      if (res && res.ok) {
        setFeedback({ type: 'success', message: res.message || 'Sesión eliminada con éxito.' });
        loadStatus();
      } else {
        setFeedback({ type: 'error', message: res?.message || 'Error al eliminar la sesión.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Error de red al eliminar la sesión.' });
    }
  };

  const daemonStatus = statusData?.daemon_status || 'offline';
  const accounts = statusData?.accounts || [];

  const formatEmail = (email) => {
    if (!email) return 'gemini-argon@google.com';
    if (!maskEmails) return email;
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const maskedName = name.length > 3 ? name.slice(0, 2) + '••••' + name.slice(-1) : name + '••';
    return `${maskedName}@${parts[1]}`;
  };

  return (
    <div className="argon-gateway" data-testid="argon-gateway">
      {/* Header Section */}
      <header className="argon-header">
        <div className="argon-title-section">
          <div className="argon-icon-wrapper">⚡</div>
          <div>
            <div className="argon-breadcrumb-tag">
              <span>CPAMC</span>
              <span>•</span>
              <span>Web Reasoning Engine</span>
            </div>
            <h1 className="argon-title">
              <span>Gemini 4 Argon Gateway</span>
              <span className="argon-title-pill">2026 Pro</span>
            </h1>
            <p className="argon-subtitle">
              Puerta de enlace web, sincronización de sesiones 1-Click y monitoreo de Playwright Companion
            </p>
          </div>
        </div>

        <div className="argon-actions">
          <button
            type="button"
            className="argon-btn argon-btn-outline"
            onClick={() => setMaskEmails(!maskEmails)}
            title="Alternar privacidad de correos"
          >
            {maskEmails ? '👁️ Ver Emails' : '🔒 Ocultar Emails'}
          </button>
          <button
            type="button"
            className="argon-btn argon-btn-outline"
            onClick={loadStatus}
            disabled={loading}
          >
            {loading ? 'Sondeando...' : '🔄 Actualizar Estado'}
          </button>
          <button
            type="button"
            className="argon-btn argon-btn-primary"
            onClick={() => setShowManualInput(!showManualInput)}
          >
            {showManualInput ? '✕ Cerrar Pegado' : '🔑 Pegado Manual de Cookies'}
          </button>
        </div>
      </header>

      {/* Live Feedback Banner */}
      {feedback && (
        <div className={`argon-feedback-msg ${feedback.type}`}>
          {feedback.message}
        </div>
      )}

      {/* Playwright Daemon Status Telemetry Strip */}
      <div className={`argon-daemon-banner ${daemonStatus}`}>
        <div className="daemon-left-block">
          <div className="daemon-pill">
            <span className={`daemon-dot ${daemonStatus}`} />
            <span>
              {daemonStatus === 'online'
                ? 'Playwright Daemon Activo'
                : daemonStatus === 'idle'
                ? 'Playwright Daemon en Suspensión (10 min idle)'
                : 'Playwright Daemon Offline'}
            </span>
          </div>

          <div className="daemon-chips">
            <span className="daemon-chip">
              <span>Socket:</span>
              <strong>Puerto 8319</strong>
            </span>
            {daemonStatus === 'online' && (
              <>
                <span className="daemon-chip">
                  <span>RAM:</span>
                  <strong>{statusData?.memory_mb ? `${statusData.memory_mb.toFixed(1)} MB` : 'Activo'}</strong>
                </span>
                <span className="daemon-chip">
                  <span>Modo:</span>
                  <strong style={{ color: statusData?.is_busy ? '#f59e0b' : '#34d399' }}>
                    {statusData?.is_busy ? 'Procesando' : 'En espera'}
                  </strong>
                </span>
              </>
            )}
            <span className="daemon-chip">
              <span>Ahorro RAM:</span>
              <strong>Auto-Sleep 10m</strong>
            </span>
          </div>
        </div>

        {daemonStatus === 'offline' && (
          <div className="daemon-offline-helper">
            <span>Companion no detectado en http://127.0.0.1:8319. Inicia <code>node gemini_daemon.js</code> para activar la ejecución web.</span>
            <button
              type="button"
              className="argon-btn argon-btn-outline"
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
              onClick={handleCopyDaemonCmd}
            >
              {copiedDaemonCmd ? '✓ ¡Copiado!' : '📋 Copiar comando'}
            </button>
          </div>
        )}
      </div>

      {/* Bento Metric Tiles (4 KPIs) */}
      <div className="argon-kpi-grid">
        <div className="argon-kpi-card accent-cyan">
          <div className="kpi-header-row">
            <span className="kpi-label">Cuentas Argon Vinculadas</span>
            <span className="kpi-icon-watermark">🌐</span>
          </div>
          <span className="kpi-value">{accounts.length}</span>
          <span className="kpi-tag">Google Gemini Web</span>
        </div>

        <div className="argon-kpi-card accent-emerald">
          <div className="kpi-header-row">
            <span className="kpi-label">En Rotación Activa</span>
            <span className="kpi-icon-watermark">⚡</span>
          </div>
          <span className="kpi-value" style={{ color: '#34d399' }}>
            {statusData?.total_active ?? 0}
          </span>
          <span className="kpi-tag" style={{ color: '#34d399' }}>
            ● Disponibles en RAM
          </span>
        </div>

        <div className="argon-kpi-card accent-amber">
          <div className="kpi-header-row">
            <span className="kpi-label">En Cooldown / Límite</span>
            <span className="kpi-icon-watermark">⏳</span>
          </div>
          <span className="kpi-value" style={{ color: '#fbbf24' }}>
            {statusData?.in_cooldown ?? 0}
          </span>
          <span className="kpi-tag" style={{ color: '#f59e0b' }}>
            Recuperación temporal
          </span>
        </div>

        <div className="argon-kpi-card accent-violet">
          <div className="kpi-header-row">
            <span className="kpi-label">Fallback Híbrido</span>
            <span className="kpi-icon-watermark">🛡️</span>
          </div>
          <span className="kpi-value" style={{ fontSize: '1.45rem', color: '#c084fc' }}>
            Google Antigravity
          </span>
          <span className="kpi-tag" style={{ color: '#a855f7' }}>
            Sin caídas 502/504
          </span>
        </div>
      </div>

      {/* Hero Interactive 1-Click Bookmarklet Pod */}
      <div className="argon-sync-box">
        <div className="sync-box-header">
          <span className="sync-box-title">
            <span>📌</span>
            <span>Sincronizador 1-Click (Bookmarklet Universal)</span>
            <span className="sync-badge-hero">Zero-Config</span>
          </span>
          <button
            type="button"
            className="argon-btn argon-btn-outline"
            style={{ fontSize: '0.78rem', padding: '0.4rem 0.85rem' }}
            onClick={handleCopyBookmarklet}
          >
            {copiedBookmarklet ? '✓ ¡Código Copiado!' : '📋 Copiar Código Bookmarklet'}
          </button>
        </div>

        {/* 3-Step Visual Pipeline */}
        <div className="bookmarklet-pipeline">
          <div className="pipeline-step">
            <div className="step-num">1</div>
            <div className="step-content">
              <strong>Arrastra a Favoritos</strong>
              <p>Arrastra el botón azul inferior a la barra de marcadores de tu navegador.</p>
            </div>
          </div>
          <div className="pipeline-step">
            <div className="step-num">2</div>
            <div className="step-content">
              <strong>Abre Gemini Web</strong>
              <p>Visita <code>gemini.google.com</code> con tu cuenta Google personal iniciada.</p>
            </div>
          </div>
          <div className="pipeline-step">
            <div className="step-num">3</div>
            <div className="step-content">
              <strong>Pulsa el Marcador</strong>
              <p>1 solo clic sincroniza las cookies al instante sin abrir terminales ni JSONs.</p>
            </div>
          </div>
        </div>

        <div className="bookmarklet-action-row">
          <a
            ref={bookmarkletRef}
            href="#bookmarklet-argon"
            className="bookmarklet-drag-btn"
            title="Arrastra este enlace a tu barra de favoritos"
            onClick={(e) => {
              if (window.confirm("Arrastra este botón a tu barra de marcadores para usarlo en gemini.google.com.\n\n¿Deseas copiar el código JS al portapapeles?")) {
                handleCopyBookmarklet();
              }
              e.preventDefault();
            }}
          >
            <span>⚡</span>
            <span>Sync Argon a Auto Switcher</span>
          </a>
          <span className="drag-instruction">
            <span>←</span>
            <span>Arrastra este botón azul a tu barra de marcadores</span>
          </span>
        </div>

        {/* Manual Cookie Injection Modal / Panel */}
        {showManualInput && (
          <form className="manual-input-panel" onSubmit={handleManualSync}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '150px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  Índice AuthUser (/u/0, /u/1, etc.)
                </label>
                <input
                  type="text"
                  className="cookie-textarea"
                  style={{ minHeight: 'unset', height: '38px' }}
                  value={manualAuthUser}
                  onChange={(e) => setManualAuthUser(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div style={{ flex: '2', minWidth: '220px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  Email de la Cuenta (Opcional)
                </label>
                <input
                  type="text"
                  className="cookie-textarea"
                  style={{ minHeight: 'unset', height: '38px' }}
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="usuario@gmail.com"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                Cadena de Cookies o Cookie __Secure-1PSID
              </label>
              <textarea
                className="cookie-textarea"
                rows="3"
                value={manualCookies}
                onChange={(e) => setManualCookies(e.target.value)}
                placeholder="Pega aquí document.cookie o la cookie __Secure-1PSID..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="argon-btn argon-btn-outline"
                onClick={() => setShowManualInput(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="argon-btn argon-btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Guardando...' : 'Sincronizar Sesión en Caliente'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Accounts List Grid */}
      <div className="argon-accounts-header">
        <h2 className="argon-accounts-title">
          <span>🗂️</span>
          <span>Sesiones de Cuenta en Memoria RAM</span>
        </h2>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {accounts.length} {accounts.length === 1 ? 'cuenta gestionada' : 'cuentas gestionadas'}
        </span>
      </div>

      {accounts.length === 0 ? (
        <div style={{ padding: '2.5rem', textAlign: 'center', background: 'rgba(20, 28, 48, 0.4)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
          No hay cuentas de Gemini Argon vinculadas actualmente. Usa el botón del Bookmarklet o el pegado manual de cookies para agregar una.
        </div>
      ) : (
        <div className="auto-auth-grid" data-testid="argon-accounts-grid">
          {accounts.map((acc, idx) => {
            const isReady = acc.status === 'ready';
            const isCooldown = acc.status === 'cooldown';
            const isCaptcha = acc.status === 'captcha';
            const isExpired = acc.status === 'expired';

            const remainingCooldownMins = isCooldown
              ? acc.reset_seconds ? Math.max(1, Math.round(acc.reset_seconds / 60)) : 45
              : 60;
            const cooldownConsumed = isCooldown ? 100 : Math.max(0, 100 - (acc.quota_pct || 100));

            return (
              <div
                key={acc.account_id || idx}
                className="auto-auth-card master"
                style={{
                  '--card-accent': '#0284c7',
                  '--card-accent-bg': 'rgba(2, 132, 199, 0.15)',
                  '--card-accent-border': '#38bdf8',
                  '--card-accent-color': '#38bdf8',
                  borderColor: isCooldown ? 'rgba(245, 158, 11, 0.5)' : 'rgba(56, 189, 248, 0.35)',
                }}
                data-testid={`argon-card-${acc.authuser}`}
              >
                {/* 1. Header Row */}
                <div className="auto-auth-card-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      className="badge-prefix-hero"
                      style={{ background: '#0284c7', color: '#ffffff' }}
                      data-testid={`badge-prefix-hero-${idx}`}
                    >
                      🏷️ [{acc.account_id || `argon_u${acc.authuser}`}]
                    </span>
                    <span className="badge-role master">
                      💎 GEMINI WEB
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="btn-card-gear"
                      onClick={() => {
                        setFeedback({
                          type: 'success',
                          message: `⚙️ Sesión /u/${acc.authuser} (${acc.email}): Almacenamiento en RAM, Cookies ${acc.has_cookies ? 'válidas' : 'pendientes'}, Fallback hacia Google Antigravity activo.`
                        });
                      }}
                      aria-label="Configurar Especialista"
                      title="Configurar Especialista (⚙️)"
                    >
                      ⚙️
                    </button>
                  </div>
                </div>

                {/* 2. Identity Block */}
                <div className="auto-auth-identity">
                  <span className="auto-auth-email" title={acc.email}>
                    {formatEmail(acc.email)}
                  </span>
                  <span className="auto-auth-filename">
                    argon_session_u{acc.authuser}.json · /u/{acc.authuser}
                  </span>
                </div>

                {/* 3. Hero Active Model Banner */}
                <div
                  className="hero-model-banner specialist"
                  data-testid="hero-model-banner"
                >
                  <div className="hero-model-badge-row">
                    <span className="badge-specialist-active">
                      🎯 MODELO ASIGNADO EN RAM
                    </span>
                  </div>
                  <div
                    className="hero-model-name"
                    data-testid="hero-model-name"
                  >
                    gemini-2.5-pro (Web Thinking)
                  </div>
                  <div className="hero-model-helper">
                    Ruteo virtual activo · 🛡️ Aislamiento en RAM (Disco intacto)
                  </div>
                </div>

                {/* 4. Badges Row: Dispatch status and Isolation */}
                <div className="auto-auth-badges-row">
                  <div className="status-pill-group">
                    <span
                      className="badge-pool-prefix"
                      style={{
                        background: isReady ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.4)',
                        borderColor: isReady ? '#10b981' : 'rgba(148, 163, 184, 0.3)',
                        color: isReady ? '#34d399' : '#94a3b8',
                        fontWeight: 700,
                      }}
                    >
                      {isReady
                        ? '🟢 EN CALIENTE: DESPACHANDO EN RAM'
                        : isCooldown
                        ? '⏳ EN COOLDOWN: RECUPERACIÓN'
                        : isCaptcha
                        ? '⚠️ CAPTCHA DETECTADO EN DOM'
                        : isExpired
                        ? '⚠️ COOKIE VENCIDA · USA BOOKMARKLET'
                        : '⏸️ EN BANQUILLO: RESERVA LISTA'}
                    </span>
                    {isReady && (
                      <span className="badge-ram-leader">
                        👑 Turno Activo
                      </span>
                    )}
                  </div>

                  <div className="isolation-pill-group">
                    <span className="badge-isolation-tag">
                      🛡️ Pipeline Sintético ReAct ( ⚡ SSE Streaming )
                    </span>
                  </div>
                </div>

                {/* 5. Cooldown Banner (if in 429 cooldown) */}
                {isCooldown && (
                  <div className="card-cooldown-banner" data-testid="card-cooldown-banner">
                    <span className="cooldown-icon">🧊</span>
                    <span className="cooldown-text">
                      En cooldown (429): gemini-web-thinking · se libera a las {acc.reset_at || '11h 59m'}
                    </span>
                  </div>
                )}

                {/* 6. Quota Telemetry (Dual QuotaClock gauges) */}
                <div className="card-quota-telemetry" data-testid="card-quota-telemetry">
                  <div className="plan-row">
                    <span>GEMINI MODELS</span>
                    <div className="plan-badges">
                      <span className="plan-badge" data-testid="plan-badge">Plan Pro Web</span>
                    </div>
                  </div>

                  <div className="quota-clocks-row">
                    <QuotaClock
                      totalMinutes={60}
                      remainingMinutes={remainingCooldownMins}
                      consumedPercent={cooldownConsumed}
                      label="Ventana de Cooldown"
                      windowKey="cooldown"
                      resetLabel={acc.reset_at ? `Se libera a las ${acc.reset_at}` : 'Cuota lista'}
                      percentLabel={isCooldown ? 'Agotada (429)' : 'Cuota disponible'}
                      isLoading={loading}
                      testId={`quota-clock-cooldown-${acc.authuser}`}
                    />
                    <QuotaClock
                      totalMinutes={2880}
                      remainingMinutes={acc.has_cookies ? 1440 : 0}
                      consumedPercent={acc.has_cookies ? 20 : 100}
                      label="Vigencia Cookie TS"
                      windowKey="cookie"
                      resetLabel={acc.has_cookies ? 'Sesión activa' : 'Expirada'}
                      percentLabel={acc.has_cookies ? '80% restante' : 'Renovar con Bookmarklet'}
                      isLoading={loading}
                      testId={`quota-clock-cookie-${acc.authuser}`}
                    />
                  </div>

                  {/* Activity Sparkline Row */}
                  <div className="card-activity-wrap">
                    <div className="activity-header">
                      <span className="activity-title">ACTIVITY (~3.3H)</span>
                      <span className="activity-meta">
                        <strong>{isReady ? '5 reqs · 100% ok' : '0 reqs'}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Refresh Quota Footer */}
                  <div className="card-quota-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn-card-refresh"
                      style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.35)', color: '#fca5a5' }}
                      onClick={() => handleDeleteSession(acc.authuser, acc.email)}
                      title="Eliminar esta sesión de cuenta"
                    >
                      <span>🗑️</span>
                      <span>Eliminar Sesión</span>
                    </button>
                    <button
                      type="button"
                      className="btn-card-refresh"
                      onClick={loadStatus}
                      disabled={loading}
                      title="Actualizar Cuota"
                    >
                      <span>🔄</span>
                      <span>{loading ? 'Consultando...' : 'Actualizar Cuota'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Synthetic Tool Calling Feature Architecture Banner */}
      <div className="argon-tool-pipeline-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <span style={{ fontSize: '1.5rem' }}>🔧</span>
          <div>
            <strong style={{ color: '#ffffff', fontSize: '0.92rem', display: 'block', marginBottom: '0.2rem' }}>
              Normalización Sintética de Herramientas Activa:
            </strong>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Los bloques de código ReAct generados por Gemini Web son interceptados dentro del pipeline SSE y transformados al vuelo en eventos nativos de OpenAI (<code>tool_calls</code>).
            </span>
          </div>
        </div>

        <div className="pipeline-diagram">
          <span className="pipeline-node">🌐 Gemini Web DOM</span>
          <span className="pipeline-arrow">➔</span>
          <span className="pipeline-node">⚡ SSE Heartbeat</span>
          <span className="pipeline-arrow">➔</span>
          <span className="pipeline-node" style={{ borderColor: 'rgba(56, 189, 248, 0.5)', color: '#38bdf8' }}>
            🔧 ReAct Parser
          </span>
          <span className="pipeline-arrow">➔</span>
          <span className="pipeline-node" style={{ borderColor: 'rgba(16, 185, 129, 0.5)', color: '#34d399' }}>
            📦 OpenAI Delta
          </span>
        </div>
      </div>

      {/* FAQ & Clarity Section: «Afina esto.» */}
      <section className="argon-faq-section" data-testid="argon-faq-section">
        <h2 className="argon-faq-title">
          <span>💡</span>
          <span>Conceptos Clave & Preguntas Frecuentes</span>
        </h2>

        <div className="argon-faq-grid">
          <div className="argon-faq-card">
            <div className="faq-card-header">
              <span className="faq-icon-pill">🌐</span>
              <span>Gemini Web vs Flota Antigravity</span>
            </div>
            <p className="faq-card-body">
              <strong>Gemini 4 Argon</strong> opera directamente sobre la web de consumidor (<code>gemini.google.com</code>) con capacidades experimentales de razonamiento ("Thinking"). No utiliza tokens OAuth de Google Cloud Code ni reemplaza a tu flota Antigravity (<code>agy_*</code>), sino que conviven como fuentes complementarias con respaldo automático.
            </p>
          </div>

          <div className="argon-faq-card">
            <div className="faq-card-header">
              <span className="faq-icon-pill">⏱️</span>
              <span>Latencia Honesta (15s – 60s)</span>
            </div>
            <p className="faq-card-body">
              A diferencia de las APIs directas en microsegundos, el navegador Chromium headless debe renderizar la interfaz web y esperar el stream del DOM. Auto Switcher Pro emite <strong>Heartbeats SSE cada 5s</strong> para que Pi y tus editores mantengan la conexión permanentemente viva sin errores de socket hang up.
            </p>
          </div>

          <div className="argon-faq-card">
            <div className="faq-card-header">
              <span className="faq-icon-pill">🔄</span>
              <span>Ciclo de Vida de Cookies (__Secure-1PSIDTS)</span>
            </div>
            <p className="faq-card-body">
              Google renueva periódicamente por seguridad la cookie temporal (24h a 72h). Si una cuenta marca "Sesión Expirada", no es un error de Auto Switcher: simplemente abre <code>gemini.google.com</code> en tu navegador y vuelve a pulsar el <strong>Bookmarklet 1-Click</strong> para sincronizarla al instante.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
