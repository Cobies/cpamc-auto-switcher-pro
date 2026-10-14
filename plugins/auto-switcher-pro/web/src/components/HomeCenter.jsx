import React, { useState } from 'react';
import './HomeCenter.css';
import logoImg from '../assets/auto-switcher-pro-logo.png';

export default function HomeCenter({ onNavigateTab, onOpenLicenseModal }) {
  const [copied, setCopied] = useState(false);
  const [licenseData, setLicenseData] = useState({
    machine_id: 'CPA-...',
    status: 'trial',
    tier: 'trial',
    days_remaining: 30,
    is_pro: false
  });

  // Cargar estado real de la licencia desde el backend de CPAMC
  React.useEffect(() => {
    let active = true;
    fetch('/v0/management/plugins/auto-switcher-pro/license')
      .then(r => r.json())
      .then(d => {
        if (active && d && d.machine_id) {
          setLicenseData(d);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const machineId = licenseData.machine_id || 'CPA-2F60-969A-CA1D';

  const handleCopyMachineId = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const menuItems = [
    {
      id: 'create-groups',
      icon: '🛠️',
      title: 'Crear Group / Perfiles',
      desc: 'Orquestador central: arma o disuelve grupos y pools de balanceo. Configura el líder y cuentas de respaldo.',
      badge: 'Principal',
    },
    {
      id: 'auto-auth-files',
      icon: '🗂️',
      title: 'Auto Auth Files',
      desc: 'Visor de cuentas físicas OAuth. Gestiona la trazabilidad y la Tuerca ⚙️ de Modo Especialista virtual.',
      badge: 'Trazabilidad',
    },
    {
      id: 'switcher',
      icon: '♊',
      title: 'Control Switcher',
      desc: 'Monitoreo en tiempo real: muestra qué cuenta está activa y cuáles en fila de reserva con sus cuotas.',
      badge: 'En Vivo',
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

      {/* 4 TARJETAS PRINCIPALES DE ESTADO (KPIs) */}
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

        {/* KPI 3: Versión */}
        <div className="home-kpi-card" data-testid="kpi-version">
          <div className="kpi-header">
            <span className="kpi-title">Versión Instalada</span>
            <span className="kpi-status-badge badge-blue">C-ABI Estable</span>
          </div>
          <div className="kpi-value text-white">v2.4.0</div>
          <div className="kpi-caption">Compilado nativo Linux amd64 para CPAMC</div>
        </div>

        {/* KPI 4: Conexión */}
        <div className="home-kpi-card" data-testid="kpi-status">
          <div className="kpi-header">
            <span className="kpi-title">Estado del Motor</span>
            <span className="kpi-status-badge badge-green">Online</span>
          </div>
          <div className="kpi-value text-green">Conectado</div>
          <div className="kpi-caption">Enrutamiento reactivo de pools en funcionamiento</div>
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
                <span className="home-menu-badge">{item.badge}</span>
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
