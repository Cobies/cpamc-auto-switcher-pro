import React, { useState, useEffect } from 'react';
import './HomeCenter.css';
import logoImg from '../assets/auto-switcher-pro-logo.png';
import {
  fetchPluginVersion,
  fetchPluginHealth,
  fetchManifest,
  fetchLicenseStatus,
  fetchAuditLog,
  fetchAgentMatrix,
} from '../api/managementClient';

export default function HomeCenter({ onNavigateTab, onOpenLicenseModal }) {
  const [copied, setCopied] = useState(false);
  const [licenseData, setLicenseData] = useState({
    machine_id: 'CPA-...',
    status: 'trial',
    tier: 'trial',
    days_remaining: 30,
    is_pro: false,
  });

  const [versionData, setVersionData] = useState({
    current_version: '0.1.1',
    current_tag: 'v0.1.1',
    latest_tag: 'v0.1.1',
    update_available: false,
    github_repo: 'WiloxDev/cpamc-auto-switcher-pro',
    releases_url: 'https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases',
  });

  const [healthData, setHealthData] = useState({
    healthy: true,
    status: 'Online',
    active_pools: 0,
  });

  const [manifestData, setManifestData] = useState({
    pools: [],
    accounts: [],
    telemetry: [],
  });

  const [auditStats, setAuditStats] = useState({
    total_events: 0,
    failovers: 0,
  });

  const [harnessCount, setHarnessCount] = useState(0);

  // Cargar telemetría viva de todos los subsistemas del motor
  useEffect(() => {
    let active = true;

    // 1. Licencia & Machine ID real
    fetchLicenseStatus()
      .then((data) => {
        if (!active || !data) return;
        setLicenseData({
          machine_id: data.machine_id || 'CPA-...',
          status: data.status || 'trial',
          tier: data.tier || 'PRO',
          days_remaining: data.days_remaining ?? 30,
          is_pro: data.status === 'active' || data.tier === 'PRO_LIFETIME',
        });
      })
      .catch(() => {});

    // 2. Versión del Plugin y comparación con GitHub Releases
    fetchPluginVersion()
      .then((data) => {
        if (!active || !data) return;
        setVersionData(data);
      })
      .catch(() => {});

    // 3. Salud del motor /healthz
    fetchPluginHealth()
      .then((data) => {
        if (!active || !data) return;
        setHealthData({
          healthy: data.healthy ?? true,
          status: (data.healthy ?? true) ? 'Online' : 'Degradado',
          active_pools: data.active_pools ?? 0,
        });
      })
      .catch(() => {
        if (active) {
          setHealthData({ healthy: false, status: 'Desconectado', active_pools: 0 });
        }
      });

    // 4. Manifest agregado O(1) en RAM
    fetchManifest()
      .then((data) => {
        if (!active || !data) return;
        setManifestData({
          pools: Array.isArray(data.pools) ? data.pools : [],
          accounts: Array.isArray(data.accounts) ? data.accounts : [],
          telemetry: Array.isArray(data.telemetry) ? data.telemetry : [],
        });
      })
      .catch(() => {});

    // 5. Auditoría y eventos de rescate
    fetchAuditLog()
      .then((data) => {
        if (!active || !data) return;
        const timeline = Array.isArray(data.timeline) ? data.timeline : [];
        const fails = timeline.filter((e) => e.type === 'failover' || e.type === 'rotation').length;
        setAuditStats({
          total_events: timeline.length,
          failovers: fails,
        });
      })
      .catch(() => {});

    // 6. Matriz de agentes
    fetchAgentMatrix()
      .then((data) => {
        if (!active || !data) return;
        const hList = Array.isArray(data.harnesses) ? data.harnesses : [];
        setHarnessCount(hList.length);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const machineId = licenseData.machine_id || 'CPA-...';

  const handleCopyMachineId = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const poolCount = manifestData.pools.length;
  const totalAccounts = manifestData.accounts.length;
  const coolingCount = manifestData.accounts.filter((a) => a.is_cooling).length;

  const menuItems = [
    {
      id: 'create-groups',
      icon: '🛠️',
      title: 'Crear Group / Perfiles',
      desc: 'Orquestador central: arma o disuelve grupos y pools de balanceo. Configura el líder y cuentas de respaldo.',
      badge: 'Principal',
      liveBadge: poolCount > 0 ? `${poolCount} Pools` : null,
    },
    {
      id: 'auto-auth-files',
      icon: '🗂️',
      title: 'Auto Auth Files',
      desc: 'Visor de cuentas físicas OAuth. Gestiona la trazabilidad y la Tuerca ⚙️ de Modo Especialista virtual.',
      badge: 'Trazabilidad',
      liveBadge: totalAccounts > 0 ? `${totalAccounts} Cuentas` : null,
    },
    {
      id: 'switcher',
      icon: '♊',
      title: 'Control Switcher',
      desc: 'Monitoreo en tiempo real: muestra qué cuenta está activa y cuáles en fila de reserva con sus cuotas.',
      badge: 'En Vivo',
      liveBadge: coolingCount > 0 ? `${coolingCount} Enfriando` : 'Flota Óptima',
    },
    {
      id: 'profiles',
      icon: '🔵',
      title: 'Visual Profile',
      desc: 'Mapa gráfico interactivo de nodos y topología que ilustra la relación entre cuentas y pools.',
      badge: 'Gráfico',
    },
    {
      id: 'tokens',
      icon: '🏷️',
      title: 'Pulse Tokens',
      desc: 'Telemetría de consumo: gráficas de uso de tokens, latencias por modelo y horas de demanda.',
      badge: 'Métricas',
    },
    {
      id: 'create-prefixes',
      icon: '📋',
      title: 'Directorio Cuentas',
      desc: 'Inventario general de credenciales, pertenencia a pools soberanos y prefijos (agy, agy_son, agy_opus, clau, codex).',
      badge: 'Directorio',
    },
    {
      id: 'maintenance',
      icon: '🩺',
      title: 'Salud & Mantenimiento',
      desc: 'Autodiagnóstico del sistema, limpieza de modelos obsoletos y verificación honesta de versiones.',
      badge: 'Diagnóstico',
    },
    {
      id: 'quick-guide',
      icon: '❓',
      title: 'Guía Rápida',
      desc: 'Manual integrado con reglas recomendadas de balanceo, convenciones de prefijos y solución de dudas.',
      badge: 'Manual',
    },
    {
      id: 'audit-log',
      icon: '📜',
      title: 'Bitácora & Caja Negra',
      desc: 'Historial forense de rotaciones, rescates 429 e incidentes en disco (SQLite WAL).',
      badge: 'Forense',
      liveBadge: auditStats.total_events > 0 ? `${auditStats.total_events} Eventos` : null,
    },
    {
      id: 'agent-matrix',
      icon: '🎛️',
      title: 'Matriz de Agentes & Orquestación',
      desc: 'Control unificado de orquestadores y subagentes para Gentle-AI (OpenCode) y j0k3r-pi.',
      badge: 'Orquestación',
      liveBadge: harnessCount > 0 ? `${harnessCount} Arneses` : null,
    },
  ];

  return (
    <div className="home-center-container" data-testid="home-center-container">
      {/* SECCIÓN HERO CON LOGO Y BIENVENIDA */}
      <div className="home-hero-card">
        <div className="home-hero-logo-wrapper">
          <img
            src={logoImg}
            alt="Auto Switcher Pro Logo"
            className="home-hero-logo"
            data-testid="home-hero-logo"
          />
        </div>
        <h1 className="home-hero-title">cpamc Auto Switcher Pro</h1>
        <p className="home-hero-subtitle">
          Motor inteligente de equilibrio de carga, alta disponibilidad y rotación automática para CLIProxyAPI
        </p>

        <div className="home-hero-desc-box">
          <span className="home-desc-icon">👋</span>
          <div className="home-desc-content">
            <strong>¿De qué se trata?</strong>
            <span>
              Mantiene tus editores de código (Pi, Cursor, Cline) siempre operativos. Cuando una cuenta agota su cuota
              diaria de peticiones (Rate Limit 429), Auto Switcher Pro conmuta de inmediato a una cuenta de reserva de
              la misma familia sin interrumpir tu trabajo.
            </span>
          </div>
        </div>
      </div>

      {/* 6 TARJETAS PRINCIPALES DE ESTADO (KPIs OPERATIVOS) */}
      <div className="home-kpi-grid">
        {/* KPI 1: Licencia */}
        <div className="home-kpi-card" data-testid="kpi-license">
          <div className="kpi-header">
            <span className="kpi-title">Licencia del Sistema</span>
            <span className={`kpi-status-badge ${licenseData.is_pro ? 'badge-green' : 'badge-blue'}`}>
              {licenseData.is_pro ? 'Activa ✓' : `Trial (${licenseData.days_remaining}d)`}
            </span>
          </div>
          <div className="kpi-value text-accent">
            {licenseData.is_pro ? 'PRO Vitalicio' : 'Demo Evaluación'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
            <span className="kpi-caption" style={{ margin: 0 }}>
              {licenseData.is_pro ? 'Licencia de por vida activa' : `${licenseData.days_remaining} días restantes`}
            </span>
            <button
              type="button"
              className="kpi-copy-btn"
              style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}
              onClick={() => onOpenLicenseModal && onOpenLicenseModal()}
              data-testid="btn-home-open-license"
              title="Abrir asistente de activación o transferencia"
            >
              ⚡ Activar / Trasladar
            </button>
          </div>
        </div>

        {/* KPI 2: ID de Máquina */}
        <div className="home-kpi-card" data-testid="kpi-machine-id">
          <div className="kpi-header">
            <span className="kpi-title">ID de Esta Máquina</span>
            <button
              type="button"
              className="kpi-copy-btn"
              onClick={handleCopyMachineId}
              data-testid="btn-copy-machine-id"
              title="Copiar ID de máquina"
            >
              {copied ? '✓ Copiado' : '📋 Copiar'}
            </button>
          </div>
          <div className="kpi-value mono text-highlight">{machineId}</div>
          <div className="kpi-caption">Identificador de hardware para vincular tu clave PRO</div>
        </div>

        {/* KPI 3: Versión Dinámica & GitHub Sync */}
        <div className="home-kpi-card" data-testid="kpi-version">
          <div className="kpi-header">
            <span className="kpi-title">Versión del Plugin</span>
            <span className={`kpi-status-badge ${versionData.update_available ? 'badge-amber' : 'badge-green'}`}>
              {versionData.update_available ? (
                <a
                  href={versionData.releases_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge-update-link"
                >
                  ⚡ Actualizar a {versionData.latest_tag}
                </a>
              ) : (
                '✓ Al día'
              )}
            </span>
          </div>
          <div className="kpi-value text-white">{versionData.current_tag || `v${versionData.current_version}`}</div>
          <div className="kpi-caption">
            {versionData.update_available
              ? 'Nueva versión oficial disponible en GitHub'
              : 'Sincronizado con releases oficiales de GitHub'}
          </div>
        </div>

        {/* KPI 4: Estado del Motor */}
        <div className="home-kpi-card" data-testid="kpi-status">
          <div className="kpi-header">
            <span className="kpi-title">Estado del Motor</span>
            <span className={`kpi-status-badge ${healthData.healthy ? 'badge-green' : 'badge-amber'}`}>
              {healthData.status}
            </span>
          </div>
          <div className={`kpi-value ${healthData.healthy ? 'text-green' : 'text-amber'}`}>
            {healthData.healthy ? 'Conectado' : 'Revisar'}
          </div>
          <div className="kpi-caption">
            {healthData.healthy
              ? 'Enrutamiento reactivo de pools en funcionamiento'
              : 'Motor operando con advertencias o sin upstream'}
          </div>
        </div>

        {/* KPI 5: Pools Soberanos Activos */}
        <div className="home-kpi-card" data-testid="kpi-pools">
          <div className="kpi-header">
            <span className="kpi-title">Pools Soberanos</span>
            <span className="kpi-status-badge badge-purple">
              {poolCount > 0 ? `${poolCount} Activos` : 'Sin Pools'}
            </span>
          </div>
          <div className="kpi-value text-purple">{poolCount} Pools</div>
          <div className="kpi-caption">
            {poolCount > 0
              ? `${totalAccounts} cuentas totales balanceadas en RAM`
              : 'Estructura tu primer pool en Crear Group / Perfiles'}
          </div>
        </div>

        {/* KPI 6: Rescates 429 & Telemetría */}
        <div className="home-kpi-card" data-testid="kpi-telemetry">
          <div className="kpi-header">
            <span className="kpi-title">Rotaciones & Rescates</span>
            <span className="kpi-status-badge badge-blue">
              {auditStats.failovers} Rescates
            </span>
          </div>
          <div className="kpi-value text-accent">{auditStats.total_events} Eventos</div>
          <div className="kpi-caption">
            Historial de balanceo y protección ante caídas registrado en SQLite WAL
          </div>
        </div>
      </div>

      {/* DIRECTORIO DE MENÚS (¿QUÉ TRAE CADA MENÚ?) */}
      <div className="home-menus-section">
        <div className="home-section-header">
          <h2 className="home-section-title">🧭 ¿Qué encuentras en cada menú?</h2>
          <span className="home-section-subtitle">
            Haz clic en cualquiera de ellos para ingresar directamente
          </span>
        </div>

        <div className="home-menus-grid">
          {menuItems.map((item) => (
            <div
              key={item.id}
              className="home-menu-card"
              onClick={() => onNavigateTab && onNavigateTab(item.id)}
              data-testid={`menu-card-${item.id}`}
              role="button"
              tabIndex={0}
            >
              <div className="home-menu-header">
                <span className="home-menu-icon">{item.icon}</span>
                <div className="home-menu-badge-group">
                  {item.liveBadge && (
                    <span className="home-menu-live-badge">{item.liveBadge}</span>
                  )}
                  <span className="home-menu-badge">{item.badge}</span>
                </div>
              </div>
              <h3 className="home-menu-title">{item.title}</h3>
              <p className="home-menu-desc">{item.desc}</p>
              <div className="home-menu-action">
                <span>Abrir vista</span>
                <span className="action-arrow">→</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
