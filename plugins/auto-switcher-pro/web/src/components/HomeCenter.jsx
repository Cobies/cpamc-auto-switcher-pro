import React, { useState, useEffect } from 'react';
import './HomeCenter.css';
import logoImg from '../assets/auto-switcher-pro-logo.png';
import { Icons } from './Icons';
import { HelpTooltip } from './HelpTooltip';
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
  const [showAllPillars, setShowAllPillars] = useState(false);
  const [openPillars, setOpenPillars] = useState({ 1: true });

  const togglePillar = (id) => {
    setOpenPillars((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const PILLARS_CATALOG = [
    {
      id: 1,
      title: '1. Resiliencia, Failover Zero-Downtime & Flota OmniAuth Pro',
      badge: 'Núcleo Estrella',
      badgeClass: 'badge-emerald',
      sourceFile: 'modelprovider.go & GroupManager.jsx',
      functions: [
        { num: 1, title: 'Rescate instantáneo ante 429', desc: 'Conmutación inmediata en memoria RAM hacia cuentas de reserva sin abortar la respuesta ni quebrar la sesión activa del agente.' },
        { num: 2, title: 'Tolerancia a micro-cortes y caídas de red', desc: 'Rescate automático ante caídas de socket y errores HTTP 502/503/504, ECONNRESET, socket hang up y UND_ERR_BODY_TERMINATED.' },
        { num: 3, title: 'Pools Soberanos para NVIDIA NIM & DeepSeek', desc: 'Agrupa múltiples API keys de OmniAuth Pro para correr Llama 3.3 70B y DeepSeek R1 con rotación automática cuando se agotan saldos o cuotas.' },
        { num: 4, title: 'Modo Supervivencia (applySurvivalMode)', desc: 'Enrutamiento de emergencia hacia pools alternativos cuando todos los miembros de una familia entran en fatiga crítica.' },
        { num: 5, title: 'Auto-Cosecha de Modelos Deprecados', desc: 'Detecta en caliente cuando un modelo es descontinuado por el upstream (404/400) y migra la petición al reemplazo activo sin intervención manual.' },
      ],
    },
    {
      id: 2,
      title: '2. ⚡ Adopción Dinámica de OmniAuth Pro & Proveedores Terceros',
      badge: 'Multi-Proveedor',
      badgeClass: 'badge-pink',
      sourceFile: 'GroupManager.jsx & registry.go',
      functions: [
        { num: 6, title: 'Detección Reactiva de Proveedores', desc: 'Reconoce automáticamente credenciales de NVIDIA NIM, NaN, DeepSeek, Groq, Cerebras, Mistral, TypeSafe, Vercel AI y OpenCode Go.' },
        { num: 7, title: 'Alta Disponibilidad en DeepSeek y Groq', desc: 'Si una cuenta o clave de DeepSeek/Groq sufre rate limit, conmuta a la siguiente reserva en milisegundos.' },
        { num: 8, title: 'Cero Ruido Visual en la UI', desc: 'Los selectores de proveedores de terceros solo aparecen si tienes cuentas reales vinculadas, manteniendo la interfaz 100% limpia.' },
        { num: 9, title: 'Aislamiento de Modelos Especialistas de Terceros', desc: 'Permite asociar modelos pesados como deepseek-ai/deepseek-r1 o meta/llama-3.3-70b-instruct a pools dedicados.' },
      ],
    },
    {
      id: 3,
      title: '3. 🧠 Optimización de Tokens & Blindaje de Prompt Caching',
      badge: 'Tokens & Caché',
      badgeClass: 'badge-purple',
      sourceFile: 'modelprovider.go',
      functions: [
        { num: 10, title: 'Histéresis Matemática (Δ ≥ 35%)', desc: 'Exige que el líder tenga cuota crítica (<20%) y la reserva una ventaja confirmada ≥35% para no destruir la memoria caché de contexto.' },
        { num: 11, title: 'Afinidad de Caché por Proyecto (X-Project-Identity)', desc: 'Aísla y ancla líderes en memoria volátil (/dev/shm) por cada repositorio o espacio de trabajo abierto.' },
        { num: 12, title: 'Afinidad de Sesión Persistente', desc: 'Mantiene la conversación enlazada a la misma cuenta durante los turnos activos de chat interactivo.' },
        { num: 13, title: 'Calentamiento Fantasma (Ghost Warmup)', desc: 'Pre-calienta en segundo plano los embeddings de contexto en cuentas de reserva para que un failover tenga 0ms de lag de inferencia.' },
      ],
    },
    {
      id: 4,
      title: '4. 🔮 Motor Predictivo Anti-429 & Enfriamiento Automático',
      badge: 'Predictivo',
      badgeClass: 'badge-amber',
      sourceFile: 'predictive.go & quota_poller.go',
      functions: [
        { num: 14, title: 'Detección de Fatiga Horaria (>80%)', desc: 'Evalúa el ritmo de peticiones por hora y rota al líder preventivamente antes de que el proveedor emita el 429.' },
        { num: 15, title: 'Ventanas de Enfriamiento (15 min)', desc: 'Pone a descansar cuentas fatigadas en una lista de espera para permitir la recuperación de sus cuotas por minuto (RPM).' },
        { num: 16, title: 'Poller Autónomo de Cuotas en Segundo Plano', desc: 'Consulta silenciosamente cada 60s las APIs internas de Google Cloud Code para conocer la cuota exacta de 5h y semanal.' },
      ],
    },
    {
      id: 5,
      title: '5. 🎯 Enrutamiento Inteligente Task-Aware & Pacing Adaptativo',
      badge: 'Enrutamiento',
      badgeClass: 'badge-blue',
      sourceFile: 'modelprovider.go',
      functions: [
        { num: 17, title: 'Enrutamiento por Tipo de Tarea (Task-Aware)', desc: 'Pondera un 70% de la cuota semanal para tareas pesadas (investigación, subagentes) y un 70% de la ventana de 5h para consultas ligeras.' },
        { num: 18, title: 'Pacing Adaptativo con Jitter', desc: 'Inyecta micro-pausas (250–350ms) cuando se alcanza el límite de velocidad por minuto (RPM) sin necesidad de forzar rotaciones innecesarias.' },
        { num: 19, title: 'Protector de Concurrencia en Vuelo (inFlightSessions)', desc: 'Monitoriza llamadas activas simultáneas y desvía turnos si una sola cuenta acumula demasiados procesos paralelos.' },
      ],
    },
    {
      id: 6,
      title: '6. 📦 Gobernanza Soberana de Pools & Fachadas Limpias',
      badge: 'Soberanía /model',
      badgeClass: 'badge-cyan',
      sourceFile: 'registry.go & virtualize.go',
      functions: [
        { num: 20, title: 'Fachadas Limpias en /model (Pool-XX-<family>)', desc: 'Reemplaza decenas de cuentas desordenadas en tu editor por identificadores limpios como Pool-01-gemini o Pool-04-claude.' },
        { num: 21, title: 'Convivencia Bimodal Quirúrgica', desc: 'Oculta únicamente las cuentas agrupadas en pools, mientras las cuentas libres sin asignar pasan 100% nativas y directas a la consola.' },
        { num: 22, title: 'Especialización Estricta (1 Pool = 1 Modelo)', desc: 'Cada pool queda bloqueado a un propósito único (Flash, Sonnet 4-6, Opus 4-6 o Codex), evitando mezclas erráticas de modelos.' },
        { num: 23, title: 'Aislamiento Puro en Memoria RAM', desc: 'Toda la gobernanza vive en RAM (ActiveLeader). Cero inyección de excluded_models y cero alteración destructiva de credenciales en disco.' },
      ],
    },
    {
      id: 7,
      title: '7. 🎭 Homologación 2N Multicuota & Separación de Familias',
      badge: 'Dual-Familia',
      badgeClass: 'badge-indigo',
      sourceFile: 'virtualize.go',
      functions: [
        { num: 24, title: 'Aprovechamiento 2N de Cuotas', desc: 'Una misma cuenta física de Google Antigravity puede alimentar a la vez un pool de Gemini y otro de Claude Sonnet/Opus sin clonar archivos en disco.' },
        { num: 25, title: 'Separación Estricta de Orígenes Claude', desc: 'Distingue automáticamente entre cuentas de Google Antigravity (agy_son*, agy_opus*) y cuentas nativas oficiales de Anthropic (clau*).' },
      ],
    },
    {
      id: 8,
      title: '8. ⏱️ Blindaje de Streaming & SSE Proxy con Keep-Alive',
      badge: 'Anti-Terminated',
      badgeClass: 'badge-emerald',
      sourceFile: 'proxy.go',
      functions: [
        { num: 26, title: 'Proxy SSE con Keep-Alive', desc: 'Emite pulsos de latido (heartbeats) cada 5s para que los proxies intermediarios nunca corten la conexión mientras el modelo piensa.' },
        { num: 27, title: 'Timeouts Extendidos (120s)', desc: 'Diseñado para tolerar turnos largos de razonamiento profundo (thinking_budget) sin provocar errores de desconexión prematura.' },
      ],
    },
    {
      id: 9,
      title: '9. 🎛️ Matriz de Agentes Cockpit para Gentle-AI, Gentle-Pi, Gentle-Shell y otros',
      badge: 'Arneses & Agentes',
      badgeClass: 'badge-amber',
      sourceFile: 'agent_matrix_handler.go',
      functions: [
        { num: 28, title: 'Control Unificado de Orquestadores y Subagentes', desc: 'Panel de mando integral para Gentle-AI, Gentle-Pi, Gentle-Shell, OpenCode, Pi y otros con visibilidad de roles y herramientas.' },
        { num: 29, title: 'Thinking Levels Dinámicos', desc: 'Ajuste en vivo del esfuerzo de razonamiento (None, Low, Medium, High) calibrado contra las capacidades nativas de CPAMC.' },
        { num: 30, title: 'Ping Dry-Run en Tiempo Real', desc: 'Prueba de fuego con medición milimétrica de latencia para verificar que una ruta de modelo responde antes de usarla.' },
        { num: 31, title: 'Auditoría Tripartita de Arneses', desc: 'Compara la versión local instalada contra el registro oficial de NPM y el repositorio upstream de GitHub.' },
        { num: 32, title: 'Estrategias de Concurrencia Segura', desc: 'Permite paralelismo de subagentes de solo lectura mientras blinda los agentes con permisos de escritura en concurrencia 1.' },
      ],
    },
    {
      id: 10,
      title: '10. 🩺 Autocuración Universal & Mantenimiento Atómico',
      badge: 'Autocuración',
      badgeClass: 'badge-teal',
      sourceFile: 'maintenance.go',
      functions: [
        { num: 33, title: 'Limpiador Universal y Atómico de config.yaml', desc: 'Purga proveedores huérfanos de forma agnóstica mediante escritura atómica (tempfile + Sync + rename) evitando bucles de reinicio.' },
        { num: 34, title: 'Cadena de Copias de Respaldo Automáticas', desc: 'Cada limpieza de configuración genera un backup fechado (.bak-pre-clean-<timestamp>) al lado del original.' },
        { num: 35, title: 'Purga de Binarios Huérfanos', desc: 'Localiza y elimina librerías .so, headers .h o residuos de compilación que ensucien el directorio del plugin.' },
        { num: 36, title: 'Actualizador Seguro de CPAMC Console', desc: 'Descarga y reemplaza la interfaz web nativa directamente desde las releases oficiales de GitHub.' },
      ],
    },
    {
      id: 11,
      title: '11. 📜 Caja Negra Forense SQLite WAL & Analítica Financiera',
      badge: 'Forense & ROI',
      badgeClass: 'badge-blue',
      sourceFile: 'analytics/db.go & metrics_handler.go',
      functions: [
        { num: 37, title: 'Base de Datos SQLite WAL (rotations.db)', desc: 'Registro forense de alta velocidad que almacena cada conmutación, incidente y tiempo de respuesta sin degradar el rendimiento.' },
        { num: 38, title: 'Telemetría de Latencia en Percentiles', desc: 'Medición precisa de p50, p95 y p99 reales en peticiones exitosas.' },
        { num: 39, title: 'Calculadora de Valor Comercial en Dólares', desc: 'Contabiliza tokens de entrada, salida, pensamiento y caché, calculando el ahorro económico real frente a tarifas estándar de mercado.' },
        { num: 40, title: 'Generador de Diagnóstico 1-Clic', desc: 'Empaqueta el estado del sistema, eventos recientes y logs de salud para asistencia técnica inmediata.' },
      ],
    },
    {
      id: 12,
      title: '12. 🔐 Seguridad Criptográfica & Licenciamiento por Hardware',
      badge: 'Seguridad',
      badgeClass: 'badge-rose',
      sourceFile: 'license/',
      functions: [
        { num: 41, title: 'Huella de Hardware Inmutable (Machine ID)', desc: 'Identidad criptográfica vinculada a la CPU, disco y MAC del equipo con verificación por firmas Ed25519.' },
        { num: 42, title: 'Handshake Transparente de Sesión', desc: 'Autorización segura de sesión por hardware para la consola web sin necesidad de introducir credenciales repetidas.' },
      ],
    },
    {
      id: 13,
      title: '13. 💻 Experiencia Visual Cyberpunk & Herramientas de Sesión',
      badge: 'UX / UI',
      badgeClass: 'badge-purple',
      sourceFile: 'extensions/ & web/',
      functions: [
        { num: 43, title: 'Almacén Volátil por Proyecto en /dev/shm', desc: 'Sincroniza el modelo activo entre paneles de terminal independientes en tiempo real sin ensuciar el disco.' },
        { num: 44, title: 'Medidores Espectrales TrueColor de 8 Celdas', desc: 'Visualización instantánea con glyphs ▰▰▰▱▱▱ y colores dinámicos de estrés de cuota.' },
        { num: 45, title: 'Modo Stream-Safe de 1-Clic', desc: 'Enmascara de forma instantánea credenciales sensibles, correos y rutas para transmisiones en vivo o capturas compartidas.' },
      ],
    },
  ];

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
      icon: <Icons.Layers size={22} />,
      title: 'Pulse Tokens',
      desc: 'Telemetría de consumo: gráficas de uso de tokens, latencias por modelo y horas de demanda.',
      badge: 'Métricas',
    },
    {
      id: 'create-prefixes',
      icon: <Icons.Tag size={22} />,
      title: 'Directorio Cuentas',
      desc: 'Inventario general de credenciales, pertenencia a pools soberanos y prefijos (agy, agy_son, agy_opus, clau, codex).',
      badge: 'Directorio',
    },
    {
      id: 'maintenance',
      icon: <Icons.Wrench size={22} />,
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
      icon: <Icons.FileText size={22} />,
      title: 'Bitácora & Caja Negra',
      desc: 'Historial forense de rotaciones, rescates 429 e incidentes en disco (SQLite WAL).',
      badge: 'Forense',
      liveBadge: auditStats.total_events > 0 ? `${auditStats.total_events} Eventos` : null,
    },
    {
      id: 'agent-matrix',
      icon: '🎛️',
      title: 'Matriz de Agentes & Orquestación',
      desc: 'Control unificado de orquestadores y subagentes para Gentle-AI, Gentle-Pi, Gentle-Shell y otros arneses.',
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

        {/* BARRA HORIZONTAL UNIFICADA: VERSIÓN, LICENCIA & HOST ID */}
        <div className="home-system-cockpit-bar" data-testid="home-cockpit-bar">
          {/* Bloque 1: Versión */}
          <div className="cockpit-item cockpit-version">
            <span className="cockpit-label">📦 Versión:</span>
            <span className="cockpit-val text-white">{versionData.current_tag || `v${versionData.current_version}`}</span>
            <span className={`cockpit-badge ${versionData.update_available ? 'badge-amber' : 'badge-green'}`}>
              {versionData.update_available ? (
                <a
                  href={versionData.releases_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cockpit-update-link"
                >
                  ⚡ Actualizar a {versionData.latest_tag}
                </a>
              ) : (
                '✓ Estable'
              )}
            </span>
          </div>

          <span className="cockpit-divider">│</span>

          {/* Bloque 2: Licencia */}
          <div className="cockpit-item cockpit-license">
            <span className="cockpit-label">⚡ Licencia:</span>
            <span className="cockpit-val text-accent">
              {licenseData.is_pro ? 'Pro Vitalicia' : 'Free Tier'}
            </span>
            {!licenseData.is_pro && (
              <>
                <span className="cockpit-bullet">·</span>
                <button
                  type="button"
                  className="cockpit-btn cockpit-btn-pro"
                  onClick={() => onOpenLicenseModal && onOpenLicenseModal()}
                  data-testid="btn-home-open-license"
                  title="Activar clave Pro para soporte prioritario"
                >
                  ⚡ Activar Pro
                </button>
              </>
            )}
          </div>

          <span className="cockpit-divider">│</span>

          {/* Bloque 3: Host ID */}
          <div className="cockpit-item cockpit-host">
            <span className="cockpit-label">💻 Host ID:</span>
            <span className="cockpit-val mono text-highlight" title={machineId}>
              {machineId}
            </span>
          </div>
        </div>

        {/* ANATOMÍA TÉCNICA DEL CÓDIGO (ACORDEÓN INTERACTIVO TOP ESTRELLA + 13 PILARES COMPLETOS) */}
        <div className="home-anatomy-box" data-testid="home-anatomy-box">
          <div className="anatomy-box-header">
            <div className="anatomy-header-left">
              <span className="anatomy-header-icon"><Icons.Cpu size={16} /></span>
              <span className="anatomy-header-title">ANATOMÍA TÉCNICA DEL CÓDIGO</span>
            </div>
            <div className="anatomy-header-badges">
              <span className="anatomy-badge-count">42 Capacidades</span>
              <span className="anatomy-badge-divider">│</span>
              <span className="anatomy-badge-count">13 Pilares Maestros</span>
            </div>
          </div>

          <div className="anatomy-box-body">
            {/* Si showAllPillars es false: muestra exclusivamente el Pilar 1 (Top Estrella) */}
            {/* Si showAllPillars es true: muestra los 13 pilares ordenados de forma exhaustiva */}
            {(showAllPillars ? PILLARS_CATALOG : [PILLARS_CATALOG[0]]).map((pillar) => {
              const isOpen = showAllPillars ? !!openPillars[pillar.id] : true;
              return (
                <div
                  key={pillar.id}
                  className={`anatomy-pillar-item ${isOpen ? 'open' : 'closed'} ${pillar.id === 1 ? 'pillar-star' : ''}`}
                  data-testid={`pillar-item-${pillar.id}`}
                >
                  <div
                    className="anatomy-pillar-head"
                    onClick={() => showAllPillars && togglePillar(pillar.id)}
                    role={showAllPillars ? 'button' : undefined}
                    tabIndex={showAllPillars ? 0 : undefined}
                    style={{ cursor: showAllPillars ? 'pointer' : 'default' }}
                  >
                    <div className="anatomy-pillar-title-wrap">
                      <span className="anatomy-chevron">{isOpen ? '▼' : '▶'}</span>
                      <span className="anatomy-pillar-title">{pillar.title}</span>
                      <span className={`anatomy-pillar-badge ${pillar.badgeClass}`}>{pillar.badge}</span>
                    </div>
                    <span className="anatomy-pillar-source">{pillar.sourceFile}</span>
                  </div>

                  {isOpen && (
                    <div className="anatomy-pillar-content">
                      <ul className="anatomy-function-list">
                        {pillar.functions.map((fn) => (
                          <li key={fn.num} className="anatomy-function-item">
                            <span className="anatomy-function-num">• {fn.num}.</span>
                            <div className="anatomy-function-body">
                              <strong className="anatomy-function-title">{fn.title}:</strong>{' '}
                              <span className="anatomy-function-desc">{fn.desc}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="anatomy-box-footer">
            <button
              type="button"
              className="anatomy-toggle-button"
              onClick={() => setShowAllPillars((prev) => !prev)}
              data-testid="btn-toggle-all-pillars"
            >
              {showAllPillars ? (
                <>▲ Plegar a vista Top Estrella</>
              ) : (
                <>⚡ Ver arquitectura completa (13 Pilares · 42 Capacidades en detalle)... ▼</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 4 TARJETAS OPERATIVAS Y DE APOYO */}
      <div className="home-kpi-grid">
        {/* KPI 1: Estado del Motor */}
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

        {/* KPI 2: ¿Te salvó de un 429? (Apoyo voluntario al creador) */}
        <div className="home-kpi-card kpi-card-sponsor" data-testid="kpi-sponsor">
          <div className="kpi-header">
            <span className="kpi-title">☕ ¿Te salvó de un 429?</span>
            <span className="kpi-status-badge badge-rose">
              Valor Dev
            </span>
          </div>
          <div className="kpi-sponsor-action">
            <a
              href="https://www.paypal.com/donate/?hosted_button_id=WD6GVECN9GTJA"
              target="_blank"
              rel="noopener noreferrer"
              className="kpi-sponsor-button"
              data-testid="btn-home-sponsor"
              title="Donar un café al creador de cpamc Auto Switcher Pro"
            >
              💖 Invitar un Café al Creador
            </a>
          </div>
          <div className="kpi-caption">
            Si este balanceador te ahorra bloqueos, cuida tus tokens y mantiene a tus agentes
            programando sin parar, ¡un café ayuda a que el proyecto siga activo y actualizado para ti!
          </div>
        </div>

        {/* KPI 3: Pools Soberanos Activos */}
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

        {/* KPI 4: Rescates 429 & Telemetría */}
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
          <h2 className="home-section-title"><Icons.Compass size={20} style={{ marginRight: 8, verticalAlign: "middle" }} /> Directorio de Menús</h2>
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
