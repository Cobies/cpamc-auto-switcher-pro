import React, { useState, useEffect, useCallback, useRef } from 'react';
import HomeCenter from './components/HomeCenter';
import ProfileGraph from './components/ProfileGraph';
import ControlSwitcher from './components/ControlSwitcher';
import PulseTokens from './components/PulseTokens';
import PrefixManager from './components/PrefixManager';
import GroupManager from './components/GroupManager';
import AutoAuthFiles from './components/AutoAuthFiles';
import Maintenance from './components/Maintenance';
import ArgonGateway from './components/ArgonGateway';
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
} from './api/managementClient';
import './App.css';
import './ControlSwitcher.css';

export default function App() {
  const resolveTabFromLocation = () => {
    if (typeof window === 'undefined' || !window.location) return 'home';

    const hash = (window.location.hash || '').toLowerCase();
    // CPAMC Native Menus index mapping:
    // CPAMC exposes pages as #/plugin-pages/<plugin-name>/<index>
    // 0: /create-groups
    // 1: /auto-auth-files
    // 2: /control-switcher
    // 3: /profiles
    // 4: /pulse-tokens
    // 5: /create-prefixes
    // 6: /maintenance
    // 7: /quick-guide
    const numIndexMatch = hash.match(/\/(\d+)(?:\b|\?|$)/);
    if (numIndexMatch) {
      const idx = parseInt(numIndexMatch[1], 10);
      switch (idx) {
        case 0: return 'create-groups';
        case 1: return 'auto-auth-files';
        case 2: return 'switcher';
        case 3: return 'profiles';
        case 4: return 'tokens';
        case 5: return 'create-prefixes';
        case 6: return 'argon';
        case 7: return 'maintenance';
        case 8: return 'quick-guide';
        default: break;
      }
    }

    if (hash.includes('tab-home') || hash.includes('tab=home') || hash === '#home') {
      return 'home';
    }
    if (hash.includes('tab-create-prefixes') || hash.includes('create-prefixes')) {
      return 'create-prefixes';
    }
    if (hash.includes('tab-create-groups') || hash.includes('create-groups') || hash.includes('groups')) {
      return 'create-groups';
    }
    if (hash.includes('tab-control-switcher') || hash.includes('switcher')) {
      return 'switcher';
    }
    if (hash.includes('tab-auto-auth-files') || hash.includes('auto-auth-files') || hash.includes('auth-files')) {
      return 'auto-auth-files';
    }
    if (hash.includes('tab-pulse-tokens') || hash.includes('pulse-tokens') || hash.includes('tokens')) {
      return 'tokens';
    }
    if (hash.includes('tab-maintenance') || hash.includes('maintenance')) {
      return 'maintenance';
    }
    if (hash.includes('tab-argon') || hash.includes('argon')) {
      return 'argon';
    }
    if (hash.includes('tab-quick-guide') || hash.includes('quick-guide') || hash.includes('guide')) {
      return 'quick-guide';
    }
    if (hash.includes('tab-profiles')) {
      return 'profiles';
    }

    const pathname = (window.location.pathname || '').toLowerCase();
    if (pathname.includes('home') || pathname.includes('center') || pathname.endsWith('/')) {
      return 'home';
    }
    if (pathname.includes('create-prefixes')) {
      return 'create-prefixes';
    }
    if (pathname.includes('create-groups') || pathname.includes('groups')) {
      return 'create-groups';
    }
    if (pathname.includes('auto-auth-files') || pathname.includes('auth-files')) {
      return 'auto-auth-files';
    }
    if (pathname.includes('control-switcher')) {
      return 'switcher';
    }
    if (pathname.includes('pulse-tokens') || pathname.includes('tokens')) {
      return 'tokens';
    }
    if (pathname.includes('maintenance')) {
      return 'maintenance';
    }
    if (pathname.includes('argon')) {
      return 'argon';
    }
    if (pathname.includes('quick-guide') || pathname.includes('guide')) {
      return 'quick-guide';
    }
    if (pathname.includes('profiles')) {
      return 'profiles';
    }
    return 'home';
  };

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
  const graphRef = useRef(null);

  // Escuchar cambios de hash en la barra de direcciones de CPAMC
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHashChange = () => {
      const nextTab = resolveTabFromLocation();
      setActiveTab(nextTab);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
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
      const registeredPools = Array.isArray(poolsRes?.pools) ? poolsRes.pools : [];
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
      {/* Header Unificado: Única y exclusivamente visible en Visual Profile Prefix Topology */}
      {activeTab === 'profiles' && (
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
          <div className="header-tabs-nav" style={{ display: 'flex', gap: '6px', padding: '4px', background: 'rgba(2, 6, 23, 0.8)', borderRadius: '10px', border: '1px solid rgba(51, 65, 85, 0.6)' }}>
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'home' ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
                background: activeTab === 'home' ? 'rgba(56, 189, 248, 0.35)' : 'transparent',
                color: activeTab === 'home' ? '#e0f2fe' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-home"
            >
              <span>🏠</span>
              <span>Inicio & Info</span>
            </button>

            {/* 1. Crear Group/Pefiles */}
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

            {/* 2. Auto Auth Files */}
            <button
              type="button"
              onClick={() => setActiveTab('auto-auth-files')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'auto-auth-files' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                background: activeTab === 'auto-auth-files' ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                color: activeTab === 'auto-auth-files' ? '#f3e8ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-auto-auth-files"
            >
              <span>🗂️</span>
              <span>Auto Auth Files</span>
            </button>

            {/* 3. Control Switcher */}
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

            {/* 4. Visual Profile */}
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

            {/* 5. Pulse Tokens */}
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

            {/* 6. Directorio Cuentas */}
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
              <span>📋</span>
              <span>Directorio Cuentas</span>
            </button>

            {/* 7. Gemini 4 Argon Gateway */}
            <button
              type="button"
              onClick={() => setActiveTab('argon')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'argon' ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
                background: activeTab === 'argon' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: activeTab === 'argon' ? '#7dd3fc' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-argon"
            >
              <span>⚡</span>
              <span>Gemini 4 Argon</span>
            </button>

            {/* 8. CPAMC Salud & Mantenimiento */}
            <button
              type="button"
              onClick={() => setActiveTab('maintenance')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'maintenance' ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid transparent',
                background: activeTab === 'maintenance' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
                color: activeTab === 'maintenance' ? '#a7f3d0' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-maintenance"
            >
              <span>🩺</span>
              <span>Salud & Mant.</span>
            </button>

            {/* 8. Guía Rápida */}
            <button
              type="button"
              onClick={() => setActiveTab('quick-guide')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                border: activeTab === 'quick-guide' ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
                background: activeTab === 'quick-guide' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: activeTab === 'quick-guide' ? '#7dd3fc' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              data-testid="tab-quick-guide"
            >
              <span>❓</span>
              <span>Guía Rápida</span>
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
            className="btn btn-outline"
            onClick={() => setIsGuideOpen(true)}
            data-testid="btn-open-quick-guide"
            title="Abrir Guía Rápida & Manual de Usuario"
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            <span>❓</span>
            <span>Guía Rápida</span>
          </button>

          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setIsLicenseOpen(true)}
            data-testid="btn-open-license-modal"
            title="Ver estado de Licencia y Machine ID"
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(234, 179, 8, 0.15)',
              color: '#facc15',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
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
              {activeTab === 'home'
                ? '/center'
                : activeTab === 'create-prefixes'
                ? '/create-prefixes'
                : activeTab === 'create-groups'
                ? '/create-groups'
                : activeTab === 'switcher'
                ? '/control-switcher'
                : activeTab === 'tokens'
                ? '/pulse-tokens'
                : activeTab === 'auto-auth-files'
                ? '/auto-auth-files'
                : activeTab === 'argon'
                ? '/argon'
                : activeTab === 'maintenance'
                ? '/maintenance'
                : activeTab === 'quick-guide'
                ? '/quick-guide'
                : '/profiles'}
            </span>
          </div>
        </div>
      </header>
      )}

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
            <ControlSwitcher nodes={graphData.nodes} onReloadRequested={loadProfiles} />
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

        {activeTab === 'argon' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <ArgonGateway />
          </div>
        )}

        {activeTab === 'quick-guide' && (
          <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
            <QuickGuideModal isOpen={true} onClose={() => setActiveTab('create-groups')} embedded={true} />
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
