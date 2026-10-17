import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getArgonStatus, syncArgonSession } from '../api/managementClient';
import './ArgonGateway.css';

export default function ArgonGateway() {
  const [loading, setLoading] = useState(true);
  const [statusData, setStatusData] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
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
    // Sondeo periódico cada 15 segundos
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
      setFeedback({ type: 'success', message: 'Código del Bookmarklet copiado al portapapeles. ¡Pégalo como URL en un nuevo marcador!' });
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

  const daemonStatus = statusData?.daemon_status || 'offline';
  const accounts = statusData?.accounts || [];

  return (
    <div className="argon-gateway" data-testid="argon-gateway">
      {/* Header */}
      <header className="argon-header">
        <div className="argon-title-section">
          <div className="argon-icon-wrapper">⚡</div>
          <div>
            <h1 className="argon-title">Gemini 4 Argon Gateway</h1>
            <p className="argon-subtitle">
              Puerta de enlace web, sincronización de sesiones 1-Click y monitoreo de Playwright Companion
            </p>
          </div>
        </div>

        <div className="argon-actions">
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
            🔑 Pegado Manual de Cookies
          </button>
        </div>
      </header>

      {/* Feedback banner */}
      {feedback && (
        <div className={`argon-feedback-msg ${feedback.type}`}>
          {feedback.message}
        </div>
      )}

      {/* Daemon Status Banner */}
      <div className={`argon-daemon-banner ${daemonStatus}`}>
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

        <div className="daemon-info">
          {daemonStatus === 'online' && (
            <span>
              Puerto 8319 • RAM: {statusData?.memory_mb ? `${statusData.memory_mb.toFixed(1)} MB` : 'Activo'} •{' '}
              {statusData?.is_busy ? '⚠️ Ocupado procesando turno' : '✅ En espera'}
            </span>
          )}
          {daemonStatus === 'idle' && (
            <span>Puerto 8319 • Suspendido para ahorrar RAM. Se reactiva al primer requerimiento.</span>
          )}
          {daemonStatus === 'offline' && (
            <span>
              Companion no detectado en http://127.0.0.1:8319. Inicia <code>node gemini_daemon.js</code> para activar la ejecución web.
            </span>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="argon-kpi-grid">
        <div className="argon-kpi-card">
          <span className="kpi-label">Cuentas Argon Vinculadas</span>
          <span className="kpi-value">{accounts.length}</span>
          <span className="kpi-tag">Google Gemini Web</span>
        </div>

        <div className="argon-kpi-card">
          <span className="kpi-label">En Rotación Activa</span>
          <span className="kpi-value">{statusData?.total_active ?? 0}</span>
          <span className="kpi-tag" style={{ color: '#34d399' }}>● Disponibles</span>
        </div>

        <div className="argon-kpi-card">
          <span className="kpi-label">En Cooldown / Límite</span>
          <span className="kpi-value">{statusData?.in_cooldown ?? 0}</span>
          <span className="kpi-tag" style={{ color: '#f59e0b' }}>Recuperación temporal</span>
        </div>

        <div className="argon-kpi-card">
          <span className="kpi-label">Fallback Híbrido</span>
          <span className="kpi-value" style={{ fontSize: '1.25rem', color: '#38bdf8' }}>Google Antigravity</span>
          <span className="kpi-tag">Sin caídas 502/504</span>
        </div>
      </div>

      {/* 1-Click Bookmarklet Synchronizer */}
      <div className="argon-sync-box">
        <div className="sync-box-header">
          <span className="sync-box-title">
            <span>📌</span> Sincronizador 1-Click (Bookmarklet Universal)
          </span>
          <button
            type="button"
            className="argon-btn argon-btn-outline"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
            onClick={handleCopyBookmarklet}
          >
            📋 Copiar Código Bookmarklet
          </button>
        </div>

        <p className="sync-box-desc">
          Arrastra el botón azul directamente a la barra de marcadores de tu navegador. Cuando estés en{' '}
          <strong>gemini.google.com</strong>, pulsa el marcador: enviará tus cookies de sesión automáticamente al
          plugin sin necesidad de terminal ni de copiar archivos JSON a mano. Funciona en Linux, Windows y macOS.
        </p>

        <div className="bookmarklet-row">
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
            ⚡ Sync Argon a Auto Switcher
          </a>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            ← Arrastra este botón a tus favoritos
          </span>
        </div>

        {/* Manual Cookie Injection Modal / Panel */}
        {showManualInput && (
          <form className="manual-input-panel" onSubmit={handleManualSync}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '150px' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                  Índice AuthUser (/u/0, /u/1, etc.)
                </label>
                <input
                  type="text"
                  className="cookie-textarea"
                  style={{ minHeight: 'unset', height: '36px' }}
                  value={manualAuthUser}
                  onChange={(e) => setManualAuthUser(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div style={{ flex: '2', minWidth: '200px' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                  Email de la Cuenta (Opcional)
                </label>
                <input
                  type="text"
                  className="cookie-textarea"
                  style={{ minHeight: 'unset', height: '36px' }}
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="usuario@gmail.com"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '1rem' }}>
        Sesiones de Cuenta en Memoria RAM
      </h2>

      {accounts.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(30, 41, 59, 0.4)', borderRadius: '12px', color: '#94a3b8' }}>
          No hay cuentas de Gemini Argon vinculadas actualmente. Usa el botón del Bookmarklet o el pegado manual de cookies para agregar una.
        </div>
      ) : (
        <div className="argon-accounts-grid">
          {accounts.map((acc) => (
            <div key={acc.account_id} className="argon-account-card">
              <div className="acc-card-header">
                <span className="acc-authuser-badge">u/{acc.authuser}</span>
                <span className={`acc-status-badge ${acc.status}`}>
                  {acc.status === 'ready'
                    ? '● Lista / Activa'
                    : acc.status === 'cooldown'
                    ? '⏳ En Cooldown'
                    : acc.status === 'captcha'
                    ? '⚠️ Captcha Requerido'
                    : acc.status}
                </span>
              </div>

              <div className="acc-email" title={acc.email}>
                {acc.email}
              </div>

              <div className="quota-bar-wrapper">
                <div className="quota-bar-labels">
                  <span>Capacidad Operativa</span>
                  <span>{acc.quota_pct.toFixed(0)}%</span>
                </div>
                <div className="quota-track">
                  <div
                    className={`quota-fill ${acc.status === 'cooldown' ? 'cooldown' : ''}`}
                    style={{ width: `${acc.quota_pct}%` }}
                  />
                </div>
              </div>

              {acc.status === 'cooldown' && acc.reset_at && (
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>⏰ Restablece a las:</span>
                  <strong>{acc.reset_at}</strong>
                </div>
              )}

              {acc.error_message && (
                <div style={{ fontSize: '0.75rem', color: '#f87171' }}>
                  {acc.error_message}
                </div>
              )}

              <div className="acc-fallback-pill">
                <span>🛡️</span>
                <span>Respaldo en caliente: <strong>Google Antigravity</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Synthetic Tool Calling Feature Badge */}
      <div style={{ marginTop: '2.5rem', padding: '1rem 1.25rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: '10px', fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>🔧</span>
        <div>
          <strong style={{ color: '#cbd5e1' }}>Normalización Sintética de Herramientas Activa:</strong>{' '}
          Los bloques de código ReAct (<code>```tool_call```</code>) producidos por Gemini Web son interceptados dentro del pipeline SSE y transformados al vuelo en eventos nativos de OpenAI (<code>tool_calls</code>).
        </div>
      </div>
    </div>
  );
}
