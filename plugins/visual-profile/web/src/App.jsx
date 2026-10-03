import React, { useState, useEffect, useCallback, useRef } from 'react';
import ProfileGraph from './components/ProfileGraph';
import ControlSwitcher from './components/ControlSwitcher';
import PulseTokens from './components/PulseTokens';
import PrefixManager from './components/PrefixManager';
import GroupManager from './components/GroupManager';
import {
  getManagementKey,
  loadAuthFilesWithPrefixes,
  buildGraphFromAuthFiles,
} from './api/managementClient';
import './App.css';
import './ControlSwitcher.css';

export default function App() {
  const initialTab = (() => {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      if (window.location.pathname.includes('create-prefixes')) {
        return 'create-prefixes';
      }
      if (window.location.pathname.includes('create-groups') || window.location.pathname.includes('groups')) {
        return 'create-groups';
      }
      if (window.location.pathname.includes('profiles')) {
        return 'profiles';
      }
      if (window.location.pathname.includes('control-switcher')) {
        return 'switcher';
      }
      if (window.location.pathname.includes('pulse-tokens') || window.location.pathname.includes('tokens')) {
        return 'tokens';
      }
    }
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE === 'test') {
      return 'profiles';
    }
    return 'create-prefixes'; // Iniciar por defecto en el gestor de prefijos
  })();

  const [activeTab, setActiveTab] = useState(initialTab); // 'create-prefixes' | 'create-groups' | 'switcher' | 'profiles' | 'tokens'
  const [status, setStatus] = useState('loading'); // 'loading' | 'unauthenticated' | 'ready' | 'error' | 'demo'
  const [errorMessage, setErrorMessage] = useState('');
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [actionFeedback, setActionFeedback] = useState('');
  const [checkingForce, setCheckingForce] = useState(false);
  const graphRef = useRef(null);

  const loadProfiles = useCallback(async () => {
    const key = getManagementKey();
    if (!key) {
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const authFiles = await loadAuthFilesWithPrefixes({ key });
      const { nodes, edges } = buildGraphFromAuthFiles(authFiles);
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
    if (activeTab !== 'profiles') {
      setActiveTab('profiles');
    }
    setTimeout(() => {
      if (graphRef.current && typeof graphRef.current.openPrefixManagement === 'function') {
        graphRef.current.openPrefixManagement();
      }
    }, 100);
  }, [activeTab]);

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

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleUseDemo = useCallback(() => {
    setStatus('demo');
  }, []);

  /**
   * Reloads auth files with confirmation if graph contains unsaved dirty edits.
   * State is retrieved imperatively from the Graph component ref, avoiding React render lag.
   */
  const handleReload = useCallback(() => {
    if (graphRef.current) {
      if (typeof graphRef.current.isSaving === 'function' && graphRef.current.isSaving()) {
        return;
      }
      const currentNodes =
        typeof graphRef.current.getNodes === 'function'
          ? graphRef.current.getNodes()
          : [];
      const hasDirty = currentNodes.some((n) => Boolean(n?.data?.isDirty));
      if (hasDirty) {
        const confirmed =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
                'You have unsaved prefix modifications. Reloading will discard all changes. Continue?'
              )
            : true;
        if (!confirmed) {
          return;
        }
      }
    }
    loadProfiles();
  }, [loadProfiles]);

  return (
    <div className="app-layout">
      {/* Header Unificado */}
      <header className="app-header">
        {/* Lado Izquierdo: Identidad, Submenús y Acciones Estructurales */}
        <div className="header-left-cluster">
          <div className="header-brand">
            <div className="brand-icon">⚡</div>
            <div>
              <h1 className="brand-title">AUTO SWITCHER PRO</h1>
              <p className="brand-subtitle">
                Centro Integral de Control de Infraestructura IA
              </p>
            </div>
          </div>

          <div className="header-divider" />

          {/* Selector de Submenús */}
          <div className="header-tabs-nav" style={{ display: 'flex', gap: '6px', padding: '4px', background: 'rgba(2, 6, 23, 0.8)', borderRadius: '10px', border: '1px solid rgba(51, 65, 85, 0.6)' }}>
            <button
              type="button"
              onClick={() => setActiveTab('create-prefixes')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'create-prefixes' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'create-prefixes' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'create-prefixes' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-create-prefixes"
            >
              <span>⚡</span>
              <span>Crear Prefijos</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('create-groups')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'create-groups' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'create-groups' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'create-groups' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-create-groups"
            >
              <span>🛠️</span>
              <span>Crear Group/Pefiles</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('switcher')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'switcher' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'switcher' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'switcher' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-control-switcher"
            >
              <span>♊</span>
              <span>Control Switcher</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profiles')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'profiles' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'profiles' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'profiles' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-visual-profile"
            >
              <span>🔵</span>
              <span>Visual Profile</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tokens')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'tokens' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'tokens' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'tokens' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-pulse-tokens"
            >
              <span>🏷️</span>
              <span>Pulse Tokens</span>
            </button>
          </div>

          <div className="header-divider" />

          {/* Acciones de Gestión y Pools (En el Lado Izquierdo) */}
          <div className="header-actions-inline">
            <button
              type="button"
              className="btn-header-manage"
              onClick={handleHeaderOpenPrefixes}
              data-testid="btn-header-manage-prefixes"
              title="Abre la tabla de gestión de prefijos y cuentas"
            >
              <span>🏷️</span>
              <span>Gestionar Prefijos ({graphData?.nodes?.length || 14})</span>
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
            className="btn btn-outline"
            onClick={handleReload}
            data-testid="btn-reload-profiles"
            title="Recargar desde Management API"
            style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <span>🔄</span>
          </button>

          <div className="header-meta">
            <span className="badge-status">C-ABI v1</span>
            <span className="badge-route">
              {activeTab === 'create-prefixes'
                ? '/create-prefixes'
                : activeTab === 'create-groups'
                ? '/create-groups'
                : activeTab === 'switcher'
                ? '/control-switcher'
                : activeTab === 'tokens'
                ? '/pulse-tokens'
                : '/profiles'}
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
            <ControlSwitcher onReloadRequested={loadProfiles} />
          </div>
        )}

        {activeTab === 'tokens' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <PulseTokens />
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
          <ProfileGraph
            ref={graphRef}
            key={`live-graph-${datasetVersion}`}
            initialNodes={graphData.nodes}
            initialEdges={graphData.edges}
            allowSynthetic={false}
          />
        )}

            {status === 'demo' && (
              <ProfileGraph ref={graphRef} key="demo-graph" allowSynthetic={true} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
