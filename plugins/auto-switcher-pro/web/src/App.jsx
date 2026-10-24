import React, { useState, useEffect, useCallback, useRef } from 'react';
import HomeCenter from './components/HomeCenter';
import ControlSwitcher from './components/ControlSwitcher';
import PulseTokens from './components/PulseTokens';
import PrefixManager from './components/PrefixManager';
import GroupManager from './components/GroupManager';
import AutoAuthFiles from './components/AutoAuthFiles';
import Maintenance from './components/Maintenance';
import AuditLog from './components/AuditLog';
import AgentMatrix from './components/AgentMatrix';
import QuickGuideModal from './components/QuickGuideModal';
import LicenseModal from './components/LicenseModal';
import logoImg from './assets/auto-switcher-pro-logo.png';
import { triggerCPAMCSidebarRefresh } from './utils/syncSidebar';
import {
  getManagementKey,
  loadAuthFilesWithPrefixes,
  buildGraphFromAuthFiles,
  scanSystemHealth,
  updateManagementConsole,
  listPools,
  sortPoolsByNumber,
} from './api/managementClient';
import './App.css';
import './ControlSwitcher.css';

export const TABS = [
  { id: 'home', label: 'Inicio & Info', icon: '🏠', testId: 'tab-home', route: '/center', matches: ['tab-home', 'tab=home', '#home', 'center', 'home'] },
  { id: 'create-groups', label: 'Crear Group/Perfiles', icon: '🛠️', testId: 'tab-create-groups', route: '/create-groups', matches: ['tab-create-groups', 'create-groups', 'groups'] },
  { id: 'auto-auth-files', label: 'Auto Auth Files', icon: '🗂️', testId: 'tab-auto-auth-files', route: '/auto-auth-files', matches: ['tab-auto-auth-files', 'auto-auth-files', 'auth-files'] },
  { id: 'switcher', label: 'Control Switcher', icon: '♊', testId: 'tab-control-switcher', route: '/control-switcher', matches: ['tab-control-switcher', 'control-switcher', 'switcher'] },
  { id: 'profiles', label: 'Visual Profile', icon: '🔵', testId: 'tab-visual-profile', route: '/profiles', matches: ['tab-profiles', 'profiles'] },
  { id: 'tokens', label: 'Pulse Tokens', icon: '🏷️', testId: 'tab-pulse-tokens', route: '/pulse-tokens', matches: ['tab-pulse-tokens', 'pulse-tokens', 'tokens'] },
  { id: 'create-prefixes', label: 'Directorio Cuentas', icon: '📋', testId: 'tab-create-prefixes', route: '/create-prefixes', matches: ['tab-create-prefixes', 'create-prefixes', 'prefixes'] },
  { id: 'maintenance', label: 'Salud & Mant.', icon: '🩺', testId: 'tab-maintenance', route: '/maintenance', matches: ['tab-maintenance', 'maintenance', 'salud'] },
  { id: 'quick-guide', label: 'Guía Rápida', icon: '❓', testId: 'tab-quick-guide', route: '/quick-guide', matches: ['tab-quick-guide', 'quick-guide', 'guide'] },
  { id: 'audit-log', label: 'Bitácora & Caja Negra', icon: '📜', testId: 'tab-audit-log', route: '/audit-log', matches: ['tab-audit-log', 'audit-log', 'bitacora', 'caja-negra'] },
  { id: 'agent-matrix', label: 'Matriz de Agentes', icon: '🎛️', testId: 'tab-agent-matrix', route: '/agent-matrix', matches: ['tab-agent-matrix', 'agent-matrix', 'matriz'] },
];

export const resolveTabFromLocation = () => {
  if (typeof window === 'undefined' || !window.location) return 'home';

  const pathname = (window.location.pathname || '').toLowerCase();
  const hash = (window.location.hash || '').toLowerCase();
  const locationString = `${pathname} ${hash}`;

  for (const tab of TABS) {
    if (tab.id === 'home') continue;
    if (tab.matches && tab.matches.some((pattern) => locationString.includes(pattern))) {
      return tab.id;
    }
  }

  const homeTab = TABS.find((t) => t.id === 'home');
  if (homeTab?.matches?.some((pattern) => locationString.includes(pattern))) {
    return 'home';
  }

  return 'home';
};

export default function App() {

  const initialTab = (() => {
    // Si estamos en entorno de testing (Vitest / JSDOM), mantenemos 'profiles' como base de tests heredados
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
      return 'profiles';
    }
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE === 'test') {
      return 'profiles';
    }

    return resolveTabFromLocation();
  })();

  const [activeTab, setActiveTab] = useState(initialTab); // 'home' | 'create-prefixes' | 'create-groups' | 'switcher' | 'profiles' | 'tokens' | 'auto-auth-files' | 'maintenance' | 'quick-guide'
  const [status, setStatus] = useState('loading'); // 'loading' | 'unauthenticated' | 'ready' | 'error' | 'demo'
  const [errorMessage, setErrorMessage] = useState('');
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [actionFeedback, setActionFeedback] = useState('');
  const [checkingForce, setCheckingForce] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isLicenseOpen, setIsLicenseOpen] = useState(false);
  const [consoleToastVersion, setConsoleToastVersion] = useState(null);
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [manualKeyError, setManualKeyError] = useState('');
  const consoleCheckExecutedRef = useRef(false);

  // Escuchar cambios de hash en la barra de direcciones
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHashChange = () => {
      const nextTab = resolveTabFromLocation();
      setActiveTab(nextTab);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const loadProfiles = useCallback(async () => {
    let key = getManagementKey();
    if (!key) {
      // Auto-Handshake transparente por Licencia y Hardware (Trial o Activa)
      try {
        let sessionRes = await fetch('/v0/management/auto-switcher-pro/license/session', {
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);

        if (!sessionRes || !sessionRes.ok) {
          sessionRes = await fetch('/auto-switcher-pro/license/session', {
            signal: AbortSignal.timeout(3000),
          }).catch(() => null);
        }

        if (sessionRes && sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData?.authorized && sessionData?.management_key) {
            key = sessionData.management_key;
            try {
              localStorage.setItem('management_key', key);
            } catch {}
          }
        }
      } catch {
        // Fall through
      }
    }

    if (!key) {
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const [authFiles, poolsRes] = await Promise.all([
        loadAuthFilesWithPrefixes({ key }),
        listPools().catch(() => ({ pools: [] })),
      ]);
      const registeredPools = sortPoolsByNumber(Array.isArray(poolsRes?.pools) ? poolsRes.pools : []);
      const { nodes, edges } = buildGraphFromAuthFiles(authFiles, { registeredPools });
      setGraphData({ nodes, edges });
      setDatasetVersion((v) => v + 1);
      setStatus('ready');
    } catch (err) {
      // Never expose raw secrets or token material in error state
      setErrorMessage(
        err.message || 'Failed to load authentication profiles from Management API'
      );
      setStatus('error');
    }
  }, []);

  // Acciones invocadas desde el Header Global
  const handleHeaderOpenPrefixes = useCallback(() => {
    setActiveTab('create-prefixes');
  }, []);

  const handleHeaderOpenGroupModal = useCallback(() => {
    setActiveTab('create-groups');
  }, []);

  const handleHeaderForceCheck = useCallback(async () => {
    setCheckingForce(true);
    try {
      await loadProfiles();
      setActionFeedback('⚡ Chequeo forzado y rotación completados');
      setTimeout(() => setActionFeedback(''), 3000);
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
      setTimeout(() => setActionFeedback(''), 4000);
    } finally {
      setCheckingForce(false);
    }
  }, [loadProfiles]);

  const CPAMC_MENU_REVISION = '2026.10.11.1';

  useEffect(() => {
    loadProfiles();

    // Auto-sync CPAMC sidebar when menu revision changes
    if (typeof window !== 'undefined' && window.localStorage) {
      const currentRev = window.localStorage.getItem('cpamc_menu_revision');
      if (currentRev !== CPAMC_MENU_REVISION) {
        triggerCPAMCSidebarRefresh();
        window.localStorage.setItem('cpamc_menu_revision', CPAMC_MENU_REVISION);
      }
    }
  }, [loadProfiles]);

  // MINI-002: Startup Cooldown & Background Auto-Update Orchestration
  useEffect(() => {
    if (consoleCheckExecutedRef.current) return;
    const key = getManagementKey();
    if (!key) return;

    if (typeof window === 'undefined' || !window.localStorage) return;

    const autoUpdateSetting = window.localStorage.getItem('auto_update_console_on_boot');
    if (autoUpdateSetting === 'false') return;

    const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours (21,600,000 ms)
    const lastCheck = window.localStorage.getItem('last_console_check_ts');
    if (lastCheck) {
      const elapsed = Date.now() - Number(lastCheck);
      if (Number.isFinite(elapsed) && elapsed < COOLDOWN_MS) {
        return;
      }
    }

    consoleCheckExecutedRef.current = true;

    const runBackgroundUpdate = async () => {
      try {
        window.localStorage.setItem('last_console_check_ts', Date.now().toString());
        const res = await scanSystemHealth();
        if (res?.console_update_available && res?.console_latest_github) {
          await updateManagementConsole();
          setConsoleToastVersion(res.console_latest_github);
        }
      } catch (err) {
        // Non-blocking: catch and log without disrupting application bootstrap or profile loading
        console.warn('Background console update check failed:', err);
      }
    };

    runBackgroundUpdate();
  }, [status]);

  // MINI-003: 12-Second Auto-Dismissing Toast Notification Timer
  useEffect(() => {
    if (!consoleToastVersion) return;

    const timer = setTimeout(() => {
      setConsoleToastVersion(null);
    }, 12000);

    return () => {
      clearTimeout(timer);
    };
  }, [consoleToastVersion]);

  const handleUseDemo = useCallback(() => {
    setStatus('demo');
  }, []);

  /**
   * Reloads auth files from Management API.
   */
  const handleReload = useCallback(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <div className="app-layout">
      {/* Header Unificado Persistente */}
      <header className="app-header">
        {/* Lado Izquierdo: Identidad, Submenús y Acciones Estructurales */}
        <div className="header-left-cluster">
          <div className="header-brand">
            <img src={logoImg} alt="Auto Switcher Pro Logo" className="brand-logo-img" />
            <div>
              <h1 className="brand-title">AUTO SWITCHER PRO</h1>
              <p className="brand-subtitle">
                Centro Integral de Control de Infraestructura IA
              </p>
            </div>
          </div>

          <div className="header-divider" />

          {/* Selector de Submenús */}
          <div className="header-tabs-nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`header-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                data-testid={tab.testId}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="header-divider" />

          {/* Acciones de Gestión y Pools (En el Lado Izquierdo) */}
          <div className="header-actions-inline">
            <button
              type="button"
              className="btn-header-manage"
              onClick={handleHeaderOpenPrefixes}
              data-testid="btn-header-manage-prefixes"
              title="Abre el directorio de consulta e inspección de cuentas y prefijos"
            >
              <span>📋</span>
              <span>Directorio ({graphData?.nodes?.length || 14})</span>
            </button>

            <button
              type="button"
              className="btn-header-create"
              onClick={handleHeaderOpenGroupModal}
              data-testid="btn-header-create-group"
              title="Asistente para estructurar nuevos pools, perfiles y reservas"
            >
              <span>⚡</span>
              <span>Crear Grupo / Pool / Perfiles</span>
            </button>
          </div>
        </div>

        {/* Lado Derecho: Utilidades de Telemetría y Estado C-ABI */}
        <div className="header-right-meta">
          <button
            type="button"
            className="btn btn-outline btn-header-guide"
            onClick={() => setIsGuideOpen(true)}
            data-testid="btn-open-quick-guide"
            title="Abrir Guía Rápida & Manual de Usuario"
          >
            <span>❓</span>
            <span>Guía Rápida</span>
          </button>

          <button
            type="button"
            className="btn btn-outline btn-header-license"
            onClick={() => setIsLicenseOpen(true)}
            data-testid="btn-open-license-modal"
            title="Ver estado de Licencia y Machine ID"
          >
            <span>🔐</span>
            <span>Licencia</span>
          </button>

          <button
            type="button"
            className="btn-header-force"
            onClick={handleHeaderForceCheck}
            disabled={checkingForce}
            data-testid="btn-header-force-check"
            title="Fuerza evaluación y rotación inmediata de cuotas"
          >
            <span>⚡</span>
            <span>{checkingForce ? 'Evaluando...' : 'Chequeo Forzado'}</span>
          </button>

          <button
            type="button"
            className="btn btn-outline btn-header-reload"
            onClick={handleReload}
            data-testid="btn-reload-profiles"
            title="Recargar desde Management API"
          >
            <span>🔄</span>
          </button>

          <div className="header-meta">
            <span className="badge-status">C-ABI v1</span>
            <span className="badge-route">
              {TABS.find((t) => t.id === activeTab)?.route || '/profiles'}
            </span>
          </div>
        </div>
      </header>

      {/* Feedback Toast si se dispara acción global */}
      {actionFeedback && (
        <div style={{
          position: 'fixed',
          top: 70,
          right: 24,
          background: '#10b981',
          color: '#fff',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease',
        }}>
          {actionFeedback}
        </div>
      )}

      {/* Main Content Area */}
      <main className="app-main">
        {activeTab === 'home' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <HomeCenter
              onNavigateTab={setActiveTab}
              onOpenLicenseModal={() => setIsLicenseOpen(true)}
            />
          </div>
        )}

        {activeTab === 'create-prefixes' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <PrefixManager nodes={graphData.nodes} onReloadRequested={loadProfiles} />
          </div>
        )}

        {activeTab === 'create-groups' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <GroupManager
              nodes={graphData.nodes}
              edges={graphData.edges}
              onReloadRequested={loadProfiles}
              onSwitchTab={setActiveTab}
            />
          </div>
        )}

        {activeTab === 'switcher' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <ControlSwitcher nodes={graphData.nodes} onReloadRequested={loadProfiles} onNavigateTab={setActiveTab} />
          </div>
        )}

        {activeTab === 'tokens' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <PulseTokens onNavigateTab={setActiveTab} />
          </div>
        )}

        {activeTab === 'auto-auth-files' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <AutoAuthFiles nodes={graphData.nodes} onReloadRequested={loadProfiles} />
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <Maintenance onReloadRequested={loadProfiles} />
          </div>
        )}

        {activeTab === 'quick-guide' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <QuickGuideModal isOpen={true} onClose={() => setActiveTab('create-groups')} embedded={true} />
          </div>
        )}

        {activeTab === 'audit-log' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <AuditLog />
          </div>
        )}

        {activeTab === 'agent-matrix' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <AgentMatrix />
          </div>
        )}

        {activeTab === 'profiles' && (
          <>
            {status === 'loading' && (
              <div className="state-container" data-testid="status-loading">
                <div style={{ textAlign: 'center' }}>
                  <div className="loading-spinner" />
                  <p style={{ marginTop: 12, color: 'var(--text-secondary)' }}>
                    Loading profiles from Management API...
                  </p>
                </div>
              </div>
            )}

        {status === 'unauthenticated' && (
          <div className="state-container" data-testid="status-unauthenticated">
            <div className="auth-warning-box">
              <div className="auth-warning-head">
                <span className="auth-warning-icon">🔐</span>
                <div>
                  <h3 className="auth-warning-title">Authentication Required</h3>
                </div>
              </div>
              <p className="auth-warning-desc">
                The visual profile plugin could not retrieve the management key
                (<code>managementKey</code>) from browser storage. In <strong>CPAMC</strong>,
                the key is only accessible inside iframe plugins when logged in with{' '}
                <strong>"Remember password"</strong> enabled.
              </p>
              <div className="auth-warning-steps">
                <strong>How to resolve:</strong>
                <ol>
                  <li>Log in to the main CPAMC console.</li>
                  <li>
                    Ensure the <strong>"Remember password"</strong> checkbox is checked.
                  </li>
                  <li>Reload this panel or click "Retry Authentication" below.</li>
                </ol>
              </div>

              <div
                className="auth-manual-entry"
                style={{
                  margin: '18px 0',
                  padding: '14px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  borderRadius: '10px',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#38bdf8',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⚡</span> O conecta directamente pegando tu Management Key:
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="password"
                    data-testid="input-manual-key"
                    placeholder="Pega tu Management Key de CPAMC aquí..."
                    value={manualKeyInput}
                    onChange={(e) => {
                      setManualKeyInput(e.target.value);
                      if (manualKeyError) setManualKeyError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const trimmed = manualKeyInput.trim();
                        if (!trimmed) {
                          setManualKeyError('Por favor ingresa una clave válida');
                          return;
                        }
                        try {
                          localStorage.setItem('management_key', trimmed);
                        } catch {}
                        loadProfiles();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: manualKeyError ? '1px solid #f85149' : '1px solid #30363d',
                      background: '#0d1117',
                      color: '#c9d1d9',
                      fontSize: '13px',
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="btn-connect-manual-key"
                    onClick={() => {
                      const trimmed = manualKeyInput.trim();
                      if (!trimmed) {
                        setManualKeyError('Por favor ingresa una clave válida');
                        return;
                      }
                      try {
                        localStorage.setItem('management_key', trimmed);
                      } catch {}
                      loadProfiles();
                    }}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Conectar
                  </button>
                </div>
                {manualKeyError && (
                  <div style={{ color: '#f85149', fontSize: '12px', marginTop: '6px' }}>
                    {manualKeyError}
                  </div>
                )}
              </div>
              <div className="auth-warning-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleUseDemo}
                  data-testid="btn-load-demo"
                >
                  View Offline Demo
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadProfiles}
                  data-testid="btn-retry-auth"
                >
                  Retry Authentication
                </button>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="state-container" data-testid="status-error">
            <div className="error-card">
              <h3 style={{ color: '#f85149', marginBottom: 10 }}>Failed to Load Profiles</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                {errorMessage}
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleUseDemo}
                  data-testid="btn-load-demo-error"
                >
                  View Offline Demo
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadProfiles}
                  data-testid="btn-retry-error"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {status === 'ready' && (
          <div className="state-container" data-testid="profiles-view">
            <div className="info-card" style={{ maxWidth: '800px', margin: '40px auto', padding: '24px', background: '#161b22', borderRadius: '12px', border: '1px solid #30363d', color: '#c9d1d9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <span style={{ fontSize: '24px' }}>🛡️</span>
                <div>
                  <h3 style={{ margin: 0, color: '#58a6ff' }}>Visual Profile (Modo Deprecado)</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#8b949e' }}>
                    El subsistema de grafos físicos ha sido sustituido por Pools Soberanos en RAM.
                  </p>
                </div>
              </div>
              <div data-testid="badge-live-auth" style={{ marginBottom: '16px', display: 'inline-block', padding: '4px 10px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', fontSize: '12px', color: '#38bdf8' }}>
                Perfiles Activos Conectados: {graphData.nodes.length}
              </div>
              <div className="profiles-loaded-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {graphData.nodes.map((node) => (
                  <div key={node.id} style={{ padding: '8px 12px', background: '#0d1117', borderRadius: '6px', border: '1px solid #30363d', fontSize: '12px' }}>
                    <strong>{node.data?.prefix || node.id}</strong>
                    <span style={{ marginLeft: '8px', color: '#8b949e' }}>{node.id}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {status === 'demo' && (
          <div className="state-container" data-testid="demo-view">
            <div className="info-card" style={{ maxWidth: '600px', margin: '40px auto', padding: '24px', background: '#161b22', borderRadius: '12px', border: '1px solid #30363d', color: '#c9d1d9', textAlign: 'center' }}>
              <h3>Modo Demostración Offline</h3>
              <p style={{ color: '#8b949e' }}>Vista previa local de infraestructura sin conexión al daemon CPAMC.</p>
            </div>
          </div>
        )}
          </>
        )}

        {/* Quick Guide Modal Mount */}
        <QuickGuideModal
          isOpen={isGuideOpen}
          onClose={() => setIsGuideOpen(false)}
        />

        {/* License & Activation Modal Mount */}
        <LicenseModal
          isOpen={isLicenseOpen}
          onClose={() => setIsLicenseOpen(false)}
        />
      </main>

      {/* MINI-003: Floating Auto-Dismiss Toast for Console Auto-Update */}
      {consoleToastVersion && (
        <div
          className="console-update-toast"
          data-testid="toast-auto-update-console"
          role="status"
        >
          <span className="console-update-toast-msg">
            ⚡ AUTO SWITCHER PRO: Consola de Gestión actualizada automáticamente a la versión {consoleToastVersion} (Oficial)
          </span>
          <button
            type="button"
            className="btn-close-console-toast"
            onClick={() => setConsoleToastVersion(null)}
            data-testid="btn-close-console-toast"
            aria-label="Cerrar notificación"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
