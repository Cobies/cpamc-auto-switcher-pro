import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchAgentMatrix,
  saveAgentMatrix,
  testAgentRoute,
  scanAgentEnvironment,
  triggerTriageWarmup,
} from '../api/managementClient';
import './AgentMatrix.css';

const UNIVERSE_STORAGE_KEY = 'agent_matrix_active_universe';

const isWriterAgent = (agent) => {
  if (!agent) return false;
  if (agent.is_orchestrator) return true;
  const id = (agent.agent_id || '').toLowerCase();
  const role = (agent.role_type || '').toLowerCase();
  return role === 'apply' || id.includes('apply') || id.includes('worker') || id.includes('fix');
};

const getAgentHumanMeta = (agent) => {
  const id = (agent.agent_id || '').toLowerCase();
  switch (id) {
    case '00-discovery':
      return {
        badge: 'FASE 0 · LECTURA',
        badgeClass: 'badge-discovery',
        summary: 'Exploración y recolección de evidencia sin modificar código.',
      };
    case '01-planning':
      return {
        badge: 'FASE 1 · ARQUITECTURA',
        badgeClass: 'badge-planning',
        summary: 'Diseño técnico de contratos plan.md y estrategia TDD.',
      };
    case '02-apply':
      return {
        badge: 'FASE 2 · IMPLEMENTACIÓN',
        badgeClass: 'badge-apply',
        summary: 'Edición quirúrgica de código y resolución guiada de tareas.',
      };
    case '03-verify':
      return {
        badge: 'FASE 3 · AUDITORÍA',
        badgeClass: 'badge-verify',
        summary: 'Auditoría independiente con suites de pruebas y regresión.',
      };
    case 'gentle-ai-worker':
      return {
        badge: 'WORKER · EDICIÓN',
        badgeClass: 'badge-apply',
        summary: 'Implementador fullstack senior de Gentle-Shell y OpenCode.',
      };
    case 'gentle-ai-explore':
      return {
        badge: 'EXPLORADOR',
        badgeClass: 'badge-discovery',
        summary: 'Análisis previo e inspección segura de repositorios.',
      };
    case 'gentle-ai-verify':
      return {
        badge: 'VERIFICADOR',
        badgeClass: 'badge-verify',
        summary: 'Verificación técnica independiente de suites de tests.',
      };
    case 'deep-researcher':
      return {
        badge: 'RESEARCH EXTERNO',
        badgeClass: 'badge-research',
        summary: 'Investigación técnica en internet, GitHub y documentación.',
      };
    case 'news-researcher':
      return {
        badge: 'INTELIGENCIA',
        badgeClass: 'badge-news',
        summary: 'Radar de novedades y briefings tecnológicos periódicos.',
      };
    case 'tool-smoke':
      return {
        badge: 'DIAGNÓSTICO',
        badgeClass: 'badge-smoke',
        summary: 'Comprobación de herramientas y permisos del entorno.',
      };
    case 'ui-designer':
      return {
        badge: '🎨 DIRECCIÓN DE ARTE',
        badgeClass: 'badge-ui-design',
        summary: 'Arquitectura UX/UI, tokens 2027, prototipos interactivos y auditoría Afina Esto.',
      };
    default:
      return {
        badge: agent.role_type ? agent.role_type.toUpperCase() : 'AGENTE',
        badgeClass: 'badge-generic',
        summary: agent.description || 'Subagente especializado de desarrollo.',
      };
  }
};

export default function AgentMatrix() {
  const [activeUniverse, setActiveUniverse] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(UNIVERSE_STORAGE_KEY) || 'all';
    }
    return 'all';
  });

  const [harnesses, setHarnesses] = useState([]);
  const [availablePools, setAvailablePools] = useState([]);
  const [poolCapabilities, setPoolCapabilities] = useState({});
  const [poolDetails, setPoolDetails] = useState({});
  const [upstreamModels, setUpstreamModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [warming, setWarming] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [pingStates, setPingStates] = useState({});
  const [dirtyHarnesses, setDirtyHarnesses] = useState({}); // { [agentKey]: { loading: bool, latency: number, text: string, ok: bool } }

  const handleUniverseChange = (univ) => {
    setActiveUniverse(univ);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(UNIVERSE_STORAGE_KEY, univ);
    }
  };

  const processPayload = useCallback((data) => {
    if (!data?.ok) return;

    let detected = [];
    if (Array.isArray(data.harnesses) && data.harnesses.length > 0) {
      detected = data.harnesses;
    } else {
      // Fallback: build harnesses array from legacy gentle_agents / jok3r_agents if provided
      if (data.gentle_agents && data.gentle_agents.length > 0) {
        detected.push({
          id: 'gentle_shell',
          name: 'Gentle-Shell CLI',
          icon: '📟',
          badge: '📟 Gentle-Shell Terminal CLI',
          config_path: '~/.gentle-shell/agent/profiles.json',
          subtitle: '⚡ Terminal CLI Soberana: Arnés independiente para desarrollo ágil en consola con streaming nativo.',
          agents: data.gentle_agents,
        });
      }
      if (data.jok3r_detected && data.jok3r_agents && data.jok3r_agents.length > 0) {
        detected.push({
          id: 'jok3r_pi',
          name: 'j0k3r-pi',
          icon: '⚡',
          badge: '⚡ j0k3r-pi Orchestrator',
          config_path: '~/.pi/agent-j0k3r/subagents.json',
          subtitle: '⚡ Suite Todo-en-Uno Soberana: Orquestador interactivo de terminal y escuadrón de subagentes Planned Workflow.',
          agents: data.jok3r_agents,
        });
      }
    }

    setHarnesses(detected);
    setAvailablePools(data.available_pools || []);
    setPoolCapabilities(data.pool_capabilities || {});
    setPoolDetails(data.pool_details || {});
    setUpstreamModels(data.upstream_models || []);

    // Ensure activeUniverse matches an available harness or 'all'
    setActiveUniverse((prev) => {
      if (detected.length === 1) {
        return detected[0].id;
      }
      if (detected.length > 1) {
        const exists = detected.some((h) => h.id === prev);
        return exists || prev === 'all' ? prev : 'all';
      }
      return 'all';
    });
  }, []);

  const loadMatrix = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAgentMatrix();
      processPayload(data);
    } catch (err) {
      setFeedback({ text: `Error al cargar matriz: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [processPayload]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  const handleScanEnvironment = async () => {
    try {
      setScanning(true);
      const data = await scanAgentEnvironment();
      if (data?.ok) {
        processPayload(data);
        const count = Array.isArray(data.harnesses) ? data.harnesses.length : (data.jok3r_detected ? 2 : 1);
        const names = Array.isArray(data.harnesses) ? data.harnesses.map((h) => h.name).join(' y ') : 'Arneses activos';
        setFeedback({
          text: `✅ Entorno escaneado: ${count} arnés(es) detectado(s) (${names})`,
          type: 'success',
        });
        setTimeout(() => setFeedback({ text: '', type: '' }), 4500);
      }
    } catch (err) {
      setFeedback({ text: `Error al escanear entorno: ${err.message}`, type: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const handleTriggerWarmup = async () => {
    try {
      setWarming(true);
      await triggerTriageWarmup(['Pool-01-gemini', 'Pool-04-claude']);
      setFeedback({
        text: '⚡ Shadow Warmup ejecutado: Sockets TLS y Prompt Cache precalentados',
        type: 'success',
      });
      setTimeout(() => setFeedback({ text: '', type: '' }), 4000);
    } catch (err) {
      setFeedback({ text: `Error en warmup: ${err.message}`, type: 'error' });
    } finally {
      setWarming(false);
    }
  };

  const isClaudeFamily = useCallback((poolId) => {
    if (!poolId) return false;
    const lower = poolId.toLowerCase();
    if (lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus')) {
      return true;
    }
    const detail = poolDetails[poolId];
    if (detail && detail.target_model) {
      const mLower = detail.target_model.toLowerCase();
      if (mLower.includes('claude') || mLower.includes('sonnet') || mLower.includes('opus')) {
        return true;
      }
    }
    return false;
  }, [poolDetails]);

  const handleApplyPreset = (preset) => {
    setHarnesses((prev) =>
      prev.map((h) => ({
        ...h,
        agents: h.agents?.map((a) => {
          if (a.is_orchestrator) return a;
          if (isWriterAgent(a)) {
            return { ...a, concurrency: 1 };
          }
          if (preset === 'safe') return { ...a, concurrency: 1 };
          if (preset === 'turbo') return { ...a, concurrency: 3 };
          // pro / balanced:
          return { ...a, concurrency: 2 };
        }),
      }))
    );
    setFeedback({
      text:
        preset === 'safe'
          ? '🛡️ Modo Seguro activado: Concurrencia en 1 tarea para todos los agentes.'
          : preset === 'turbo'
          ? '🚀 Modo Turbo activado: Exploradores y auditores a 3 tareas en ráfaga (Escritores protegidos en 1).'
          : '⚡ Modo Pro activado: Balance óptimo (Escritores en 1, Lectores en 2).',
      type: 'success',
    });
    setTimeout(() => setFeedback({ text: '', type: '' }), 4000);
  };

  const handlePoolChange = (universe, agentId, field, value) => {
    setDirtyHarnesses((prev) => ({ ...prev, [universe]: true }));
    setHarnesses((prev) =>
      prev.map((h) => {
        if (h.id !== universe) return h;
        const updatedAgents = h.agents.map((a) => {
          if (a.agent_id !== agentId) return a;
          const updated = { ...a, [field]: value };

          // Cascada y Exclusión Mutua por Fila
          if (field === 'primary_pool') {
            // 1. Thinking capability sync
            if (poolCapabilities[value] === false) {
              updated.thinking_level = 'none';
            } else if (poolCapabilities[value] !== false && updated.thinking_level === 'none') {
              updated.thinking_level = 'medium';
            }

            // 2. Si el nuevo primario colisiona con el rescate actual, reasignar el rescate automáticamente
            if (updated.fallback_pool === value) {
              // Obtener todos los candidatos disponibles
              const allCandidates = [
                ...availablePools,
                ...upstreamModels.map((u) => u.id),
              ];
              // Elige el primer candidato que sea diferente al nuevo primario
              const alternative = allCandidates.find((c) => c !== value);
              updated.fallback_pool = alternative || '';
            }
          } else if (field === 'fallback_pool') {
            // Si intenta elegir el mismo que el primario, revertir o bloquear
            if (value === updated.primary_pool) {
              const allCandidates = [
                ...availablePools,
                ...upstreamModels.map((u) => u.id),
              ];
              const alternative = allCandidates.find((c) => c !== updated.primary_pool);
              updated.fallback_pool = alternative || '';
            }
          }

          return updated;
        });
        return { ...h, agents: updatedAgents };
      })
    );
  };

  const handleTestRoute = async (agent, harnessId) => {
    const agentKey = `${harnessId || agent.universe}_${agent.agent_id}`;
    setPingStates((prev) => ({
      ...prev,
      [agentKey]: { loading: true, latency: 0, text: 'Verificando...', ok: true },
    }));

    try {
      const res = await testAgentRoute(agent.primary_pool, poolDetails[agent.primary_pool]?.target_model);
      setPingStates((prev) => ({
        ...prev,
        [agentKey]: {
          loading: false,
          latency: res.latency_ms,
          text: `⚡ OK (${res.latency_ms}ms) · ${res.pool_id || agent.primary_pool} · ${res.account_email}`,
          ok: true,
        },
      }));
    } catch (err) {
      setPingStates((prev) => ({
        ...prev,
        [agentKey]: {
          loading: false,
          latency: 0,
          text: `❌ Fallo: ${err.message || 'Error'}`,
          ok: false,
        },
      }));
    }
  };

  const handleSaveHarness = async (harnessId) => {
    const harness = harnesses.find((h) => h.id === harnessId);
    if (!harness) return;
    try {
      setSaving(true);
      const agentsToSave = (harness.agents || []).map((a) => ({
        ...a,
        universe: harness.id,
      }));
      const res = await saveAgentMatrix(agentsToSave);
      setDirtyHarnesses((prev) => ({ ...prev, [harnessId]: false }));
      setFeedback({
        text: `✓ ${harness.name}: ${res?.message || 'Guardado exitosamente en disco'}`,
        type: 'success',
      });
      setTimeout(() => setFeedback({ text: '', type: '' }), 5000);
    } catch (err) {
      setFeedback({ text: `Error al guardar ${harness.name}: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const allAgents = harnesses.flatMap((h) =>
        (h.agents || []).map((a) => ({
          ...a,
          universe: h.id, // Normalización quirúrgica: previene fragmentación en SQLite
        }))
      );
      const res = await saveAgentMatrix(allAgents);
      setDirtyHarnesses({});
      setFeedback({ text: res?.message || 'Matriz guardada y sincronizada con éxito en disco', type: 'success' });
      setTimeout(() => setFeedback({ text: '', type: '' }), 5000);
    } catch (err) {
      setFeedback({ text: `Error al guardar: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Semáforo de Estrés de Cuota ("Token Burn Gauge")
  const stress = useMemo(() => {
    let claudePressure = 0;
    for (const h of harnesses) {
      for (const a of h.agents || []) {
        const isClaude = (a.primary_pool || '').toLowerCase().includes('claude') || (a.primary_pool || '').toLowerCase().includes('sonnet');
        const thinkWeight = a.thinking_level === 'high' ? 3 : (a.thinking_level === 'medium' ? 2 : (a.thinking_level === 'low' ? 1 : 0));
        const concurrency = a.concurrency || 1;

        if (isClaude) {
          claudePressure += concurrency * (thinkWeight === 0 ? 1 : thinkWeight);
        }
      }
    }

    if (claudePressure <= 4) {
      return {
        level: 'optimal',
        badge: '🟢 Distribución Óptima',
        autonomy: '> 8 horas continuas',
        desc: 'Cargas balanceadas hacia Gemini; cuota de Claude reservada para tareas críticas.',
        claudePressure,
      };
    } else if (claudePressure <= 8) {
      return {
        level: 'moderate',
        badge: '🟡 Carga Moderada',
        autonomy: '3 - 5 horas continuas',
        desc: 'Uso activo de Claude; vigilar ráfagas de subagentes concurrentes en paralelo.',
        claudePressure,
      };
    } else {
      return {
        level: 'critical',
        badge: '🔴 Estrés Crítico de Cuota',
        autonomy: '< 30 minutos',
        desc: 'Riesgo de agotar la ventana de 5h. Se recomienda desviar discovery/verify a Gemini o activar Auto-Downgrade T2+.',
        claudePressure,
      };
    }
  }, [harnesses]);

  if (loading) {
    return (
      <div className="agent-matrix-container" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div className="loading-spinner" />
        <p style={{ marginTop: 12, color: '#94a3b8' }}>Cargando matriz de orquestación y perfiles...</p>
      </div>
    );
  }

  const renderDropdownOptions = (excludedValue = null) => {
    const pools = excludedValue ? availablePools.filter((p) => p !== excludedValue) : availablePools;
    const upstreams = excludedValue ? upstreamModels.filter((u) => u.id !== excludedValue) : upstreamModels;

    if (pools.length === 0 && upstreams.length === 0) {
      return <option value="">(Sin opciones disponibles)</option>;
    }

    return (
      <>
        {pools.length > 0 && (
          <optgroup label="── 🛡️ POOLS DISPONIBLES ──">
            {pools.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        )}
        {upstreams.length > 0 && (
          <optgroup label="── 🌐 CUENTAS SUELTAS / UPSTREAM ──">
            {upstreams.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id} ({u.displayName})
              </option>
            ))}
          </optgroup>
        )}
      </>
    );
  };

  const renderPoolTransparencyPill = (poolId, isFallback = false) => {
    if (!poolId) return null;
    const detail = poolDetails[poolId];
    if (!detail) {
      if (poolId.includes('/')) {
        return (
          <div className="pool-transparency-pill upstream-pill" title={`Modelo upstream directo: ${poolId}`}>
            <span className="dot-active">🌐</span>
            <span className="pill-model">Direct Upstream: {poolId}</span>
          </div>
        );
      }
      return null;
    }

    if (isFallback) {
      return (
        <div
          className="pool-transparency-pill fallback-pill"
          title={`Pool de Relevo: ${poolId}\nModelo: ${detail.target_model}\nCuentas preparadas: ${detail.total_members}\nConsumo actual: 0% tokens (en espera de 429)`}
        >
          <span className="dot-standby">⚪</span>
          <span className="pill-model">Relevo: {detail.target_model}</span>
          <span className="pill-accounts">({detail.total_members} cuentas en espera)</span>
        </div>
      );
    }

    return (
      <div
        className="pool-transparency-pill"
        title={`Pool Primario: ${poolId}\nModelo en ejecución: ${detail.target_model}\nLíder activo en RAM: ${detail.leader_email}\nCuentas en rotación: ${detail.total_members} (1 líder + ${detail.reserves_count} reservas)`}
      >
        <span className="dot-active">🟢</span>
        <span className="pill-model">Modelo: {detail.target_model}</span>
        <span className="pill-accounts">({detail.total_members} cuentas activas)</span>
      </div>
    );
  };

  const renderOrchestrator = (agent, harnessId) => {
    if (!agent) return null;
    const agentKey = `${harnessId}_${agent.agent_id}`;
    const ping = pingStates[agentKey];

    return (
      <div className="orchestrator-card" key={agent.agent_id}>
        <div className="orchestrator-info">
          <div className="orchestrator-title">
            <span>{agent.displayName || agent.agent_id}</span>
            <button
              type="button"
              className="btn-ping-route"
              onClick={() => handleTestRoute(agent, harnessId)}
              disabled={ping?.loading}
              title="Prueba de Fuego (Dry-Run Ping): Verifica la latencia y la salud del líder activo en RAM"
            >
              {ping?.loading ? '⏳ Verificando...' : '⚡ Test Route'}
            </button>
            {ping?.text && (
              <span className={`ping-result-badge ${ping.ok ? 'ok' : 'err'}`}>
                {ping.text}
              </span>
            )}
          </div>
          <div className="orchestrator-desc">{agent.description}</div>
        </div>
        <div className="orchestrator-controls">
          <div>
            <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              POOL PRIMARIO
            </span>
            <select
              className="matrix-select"
              value={agent.primary_pool}
              onChange={(e) => handlePoolChange(harnessId, agent.agent_id, 'primary_pool', e.target.value)}
            >
              {renderDropdownOptions()}
            </select>
            {renderPoolTransparencyPill(agent.primary_pool, false)}
            {isClaudeFamily(agent.primary_pool) && (
              <div
                className="claude-contextual-controls"
                style={{ marginTop: 6 }}
                title="Protector de cuota Claude: tope de intentos antes de pasar a Gemini"
              >
                <div className="claude-contextual-row">
                  <span className="claude-shield-icon">🛡️</span>
                  <span className="claude-shield-label">Freno:</span>
                  <select
                    className="matrix-select claude-turns-select"
                    value={agent.max_claude_turns ?? 3}
                    onChange={(e) => handlePoolChange(harnessId, agent.agent_id, 'max_claude_turns', parseInt(e.target.value, 10))}
                    title="Protector de cuota Claude: tope de intentos antes de pasar a Gemini"
                  >
                    <option value={2}>2 (Ahorro)</option>
                    <option value={3}>3 (Recomendado)</option>
                    <option value={5}>5 (Paciencia)</option>
                    <option value={0}>Sin límite</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <span
            className="relay-arrow"
            title="Relevo automático: Solo toma el control si el pool primario recibe 429 o fallo de red"
          >
            →
          </span>

          <div>
            <span
              style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}
              title="Rescate Pasivo: Permanece en espera con 0% de consumo hasta que el pool primario agote cuota o reciba 429"
            >
              POOL DE RESCATE (FAILOVER)
            </span>
            <select
              className="matrix-select"
              value={agent.fallback_pool}
              onChange={(e) => handlePoolChange(harnessId, agent.agent_id, 'fallback_pool', e.target.value)}
              disabled={availablePools.length + upstreamModels.length <= 1}
            >
              {availablePools.length + upstreamModels.length <= 1 ? (
                <option value="">🚫 Sin failover (Requiere 2+ pools/cuentas)</option>
              ) : (
                renderDropdownOptions(agent.primary_pool)
              )}
            </select>
            {renderPoolTransparencyPill(agent.fallback_pool, true)}
          </div>

          <div>
            <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              THINKING
            </span>
            {poolCapabilities[agent.primary_pool] === false ? (
              <span
                className="thinking-na-badge"
                title="Este modelo no requiere ni admite parámetros de razonamiento/thinking"
              >
                🚫 N/A - Sin Razonamiento
              </span>
            ) : (
              <div className="thinking-toggle">
                {['low', 'medium', 'high'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`thinking-btn ${agent.thinking_level === lvl ? `active ${lvl}` : ''}`}
                    onClick={() => handlePoolChange(harnessId, agent.agent_id, 'thinking_level', lvl)}
                  >
                    {lvl.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTable = (agents, harnessId) => {
    const subagents = agents.filter((a) => !a.is_orchestrator);
    if (subagents.length === 0) return null;

    return (
      <table className="agents-table">
        <thead>
          <tr>
            <th>
              <div className="th-title">ROL / AGENTE</div>
              <div className="th-sub">Misión en el ciclo</div>
            </th>
            <th>
              <div className="th-title">POOL PRIMARIO</div>
              <div className="th-sub">Grupo activo de ejecución</div>
            </th>
            <th style={{ width: 24 }}></th>
            <th title="Modo Pasivo (0% consumo ordinario). Solo toma el relevo si el pool primario agota cuota o recibe error HTTP 429.">
              <div className="th-title">POOL DE RESCATE (FAILOVER)</div>
              <div className="th-sub">Relevo en espera (0% consumo)</div>
            </th>
            <th>
              <div className="th-title">THINKING</div>
              <div className="th-sub">Nivel de razonamiento</div>
            </th>
            <th>
              <div className="th-title">CONCURRENCIA</div>
              <div className="th-sub">Capacidad paralela segura</div>
            </th>
            <th>
              <div className="th-title">TEST</div>
              <div className="th-sub">Sonda de red y token</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {subagents.map((a) => {
            const agentKey = `${harnessId}_${a.agent_id}`;
            const ping = pingStates[agentKey];
            const meta = getAgentHumanMeta(a);
            const isWriter = isWriterAgent(a);

            return (
              <tr key={a.agent_id}>
                <td className="agent-name-cell">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{a.displayName || a.agent_id}</span>
                    <span className={`agent-role-chip ${meta.badgeClass}`}>{meta.badge}</span>
                  </div>
                  <div className="agent-desc-sub">{meta.summary}</div>
                </td>
                <td>
                  <select
                    className="matrix-select"
                    value={a.primary_pool}
                    onChange={(e) => handlePoolChange(harnessId, a.agent_id, 'primary_pool', e.target.value)}
                  >
                    {renderDropdownOptions()}
                  </select>
                  {renderPoolTransparencyPill(a.primary_pool, false)}
                  {isClaudeFamily(a.primary_pool) && (
                    <div
                      className="claude-contextual-controls"
                      title="Protector de cuota Claude: tope de intentos en Claude antes de pasar a Gemini"
                    >
                      <div className="claude-contextual-row">
                        <span className="claude-shield-icon">🛡️</span>
                        <span className="claude-shield-label">Freno Anti-Bucle:</span>
                        <select
                          className="matrix-select claude-turns-select"
                          value={a.max_claude_turns ?? 3}
                          onChange={(e) => handlePoolChange(harnessId, a.agent_id, 'max_claude_turns', parseInt(e.target.value, 10))}
                          title="Protector de cuota Claude: tope de intentos antes de pasar a Gemini"
                        >
                          <option value={2}>2 (Ahorro)</option>
                          <option value={3}>3 (Recomendado)</option>
                          <option value={5}>5 (Paciencia)</option>
                          <option value={0}>Sin límite</option>
                        </select>
                        <button
                          type="button"
                          className={`btn-downgrade-chip ${a.auto_downgrade ? 'active' : ''}`}
                          onClick={() => handlePoolChange(harnessId, a.agent_id, 'auto_downgrade', !a.auto_downgrade)}
                          title="Mitigación T2+: reduce tokens de pensamiento a partir del 2do turno"
                        >
                          {a.auto_downgrade ? '🟢 T2+' : '⚪ T2+ Off'}
                        </button>
                      </div>
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'center', width: 24 }}>
                  <span
                    className="relay-arrow"
                    title="Rescate automático: Solo toma el relevo si el líder primario recibe 429 o fallo de red"
                  >
                    →
                  </span>
                </td>
                <td>
                  <select
                    className="matrix-select"
                    value={a.fallback_pool}
                    onChange={(e) => handlePoolChange(harnessId, a.agent_id, 'fallback_pool', e.target.value)}
                    disabled={availablePools.length + upstreamModels.length <= 1}
                  >
                    {availablePools.length + upstreamModels.length <= 1 ? (
                      <option value="">🚫 Sin failover (Requiere 2+ pools/cuentas)</option>
                    ) : (
                      renderDropdownOptions(a.primary_pool)
                    )}
                  </select>
                  {renderPoolTransparencyPill(a.fallback_pool, true)}
                </td>
                <td>
                  {poolCapabilities[a.primary_pool] === false ? (
                    <span
                      className="thinking-na-badge"
                      title="Este modelo no requiere ni admite parámetros de razonamiento/thinking"
                    >
                      🚫 N/A
                    </span>
                  ) : (
                    <div className="thinking-toggle">
                      {['low', 'medium', 'high'].map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          className={`thinking-btn ${a.thinking_level === lvl ? `active ${lvl}` : ''}`}
                          onClick={() => handlePoolChange(harnessId, a.agent_id, 'thinking_level', lvl)}
                        >
                          {lvl.charAt(0).toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {isWriter ? (
                    <div
                      className="concurrency-lock-badge"
                      title="Candado de Seguridad: Agente con permisos de escritura y edición de código. Bloqueado en 1 tarea para evitar que dos agentes editen los mismos archivos y corrompan código."
                    >
                      <span className="lock-icon">🔒</span>
                      <span className="lock-label">1 tarea</span>
                      <span className="lock-status">(Seguro)</span>
                    </div>
                  ) : (
                    <div className="concurrency-selector-wrapper">
                      <select
                        className="matrix-select concurrency-select"
                        value={a.concurrency || 1}
                        onChange={(e) => handlePoolChange(harnessId, a.agent_id, 'concurrency', parseInt(e.target.value, 10))}
                        title="Capacidad de tareas simultáneas seguras para este agente de lectura"
                      >
                        <option value={1}>1 (Ahorro)</option>
                        <option value={2}>2 (Recomendado 2x)</option>
                        <option value={3}>3 (Ráfaga Turbo)</option>
                      </select>
                    </div>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-ping-route"
                    onClick={() => handleTestRoute(a, harnessId)}
                    disabled={ping?.loading}
                    title="Test rápido de conectividad y latencia con el líder del pool"
                  >
                    {ping?.loading ? '⏳...' : '⚡ Test'}
                  </button>
                  {ping?.text && (
                    <div
                      style={{
                        fontSize: 10,
                        color: ping.ok ? '#10b981' : '#ef4444',
                        marginTop: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ping.text}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="agent-matrix-container">
      {/* Header Bar */}
      <div className="matrix-header">
        <div className="matrix-title-group">
          <h2>
            <span>🎛️</span>
            <span>Matriz de Agentes & Orquestación</span>
          </h2>
          <p className="matrix-subtitle">
            Control unificado de orquestadores y subagentes detectados dinámicamente en el equipo
          </p>
        </div>

        <div className="matrix-actions">
          {feedback.text && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: feedback.type === 'error' ? '#ef4444' : '#10b981',
                marginRight: 8,
              }}
            >
              {feedback.text}
            </span>
          )}
          <button
            type="button"
            className="matrix-scan-btn"
            style={{ borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.08)' }}
            onClick={handleTriggerWarmup}
            disabled={warming || loading}
            title="Disparar Shadow Warmup predictivo para pre-calentar conexiones y prompt cache"
          >
            <span>{warming ? '⏳' : '⚡'}</span>
            <span>{warming ? 'Calentando...' : 'Warmup Triage'}</span>
          </button>
          <button
            type="button"
            className="matrix-scan-btn"
            onClick={handleScanEnvironment}
            disabled={scanning || loading}
            title="Escanear y detectar los arneses instalados en el equipo"
          >
            <span>{scanning ? '⏳' : '🔍'}</span>
            <span>{scanning ? 'Escaneando...' : 'Detectar Arneses'}</span>
          </button>
          <button
            type="button"
            className="matrix-save-btn"
            onClick={handleSave}
            disabled={saving || loading}
          >
            <span>💾</span>
            <span>{saving ? 'Guardando...' : 'Guardar Todo'}</span>
          </button>
        </div>
      </div>

      {/* Semáforo de Estrés de Cuota ("Token Burn Gauge") */}
      <div className={`token-burn-gauge ${stress.level}`} data-testid="token-burn-gauge">
        <span className="gauge-badge">{stress.badge}</span>
        <span className="gauge-autonomy">Autonomía estimada: {stress.autonomy}</span>
        <span className="gauge-desc">{stress.desc}</span>
      </div>

      {/* Preset Strategy Bar (Claude Design 2027) */}
      <div className="matrix-presets-bar">
        <div className="presets-label">
          <span className="presets-icon">🎛️</span>
          <span>Estrategia de Ejecución:</span>
        </div>
        <div className="presets-buttons">
          <button
            type="button"
            className="preset-btn safe"
            onClick={() => handleApplyPreset('safe')}
            title="Concurrencia en 1 tarea para todos los agentes. Máximo ahorro de cuota y cero riesgo."
          >
            🛡️ Modo Seguro
          </button>
          <button
            type="button"
            className="preset-btn pro"
            onClick={() => handleApplyPreset('pro')}
            title="Escritores en 1 tarea fija, lectores y exploradores en 2 tareas simultáneas. Velocidad 2x recomendada."
          >
            ⚡ Modo Pro
          </button>
          <button
            type="button"
            className="preset-btn turbo"
            onClick={() => handleApplyPreset('turbo')}
            title="Escritores protegidos en 1 tarea, exploradores a 3 tareas en ráfaga para proyectos gigantes."
          >
            🚀 Modo Turbo
          </button>
        </div>
      </div>

      {/* Universe Segmented Tabs (Dinámico según harnesses detectados) */}
      {harnesses.length > 1 ? (
        <div className="matrix-tabs">
          <button
            type="button"
            className={`matrix-tab-btn ${activeUniverse === 'all' ? 'active' : ''}`}
            onClick={() => handleUniverseChange('all')}
          >
            <span>🌐</span>
            <span>Vista Global Completa</span>
          </button>
          {harnesses.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`matrix-tab-btn ${activeUniverse === h.id ? 'active' : ''}`}
              onClick={() => handleUniverseChange(h.id)}
            >
              <span>{h.icon}</span>
              <span>{h.name} ({h.agents?.filter((a) => !a.is_orchestrator).length || 0})</span>
            </button>
          ))}
        </div>
      ) : harnesses.length === 1 ? (
        <div className="matrix-tabs" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <div className="matrix-single-universe-badge" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#7dd3fc',
            fontWeight: 600,
          }}>
            <span>{harnesses[0].icon} {harnesses[0].name}</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>• ({harnesses[0].agents?.filter((a) => !a.is_orchestrator).length || 0} agentes detectados en disco)</span>
          </div>
        </div>
      ) : (
        <div className="matrix-tabs" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            No se detectaron arneses configurados. Pulsa en <strong>🔍 Detectar Arneses</strong> para escanear el entorno.
          </div>
        </div>
      )}

      {/* Harness Sections (100% Dinámicas) */}
      {harnesses.map((harness) => {
        if (activeUniverse !== 'all' && activeUniverse !== harness.id) {
          return null;
        }

        const orch = harness.agents?.find((a) => a.is_orchestrator);
        const subagents = harness.agents?.filter((a) => !a.is_orchestrator) || [];

        return (
          <div key={harness.id} className="universe-section">
            <div className="universe-header">
              <div>
                <h3>
                  <span>{harness.icon}</span>
                  <span>{harness.name.toUpperCase()}</span>
                  <span className="dual-runtime-badge">
                    <span className="chip-shell">{harness.badge || harness.name}</span>
                  </span>
                </h3>
                <p className="universe-clarity-callout">
                  {harness.subtitle}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span className="universe-meta">
                  📁 {harness.config_path}
                </span>
                <button
                  type="button"
                  className={`matrix-save-harness-btn ${dirtyHarnesses[harness.id] ? 'dirty' : ''}`}
                  onClick={() => handleSaveHarness(harness.id)}
                  disabled={saving || loading}
                  title={`Guardar cambios y persistir en ${harness.config_path}`}
                >
                  <span>{saving ? '⏳' : '💾'}</span>
                  <span>
                    {saving
                      ? 'Guardando...'
                      : dirtyHarnesses[harness.id]
                      ? `Guardar Cambios Pendientes (${harness.name})`
                      : `Guardar ${harness.name}`}
                  </span>
                </button>
              </div>
            </div>

            {orch && renderOrchestrator(orch, harness.id)}
            {renderTable(subagents, harness.id)}
          </div>
        );
      })}

      {/* Footer Banner: Cache & Token Optimization */}
      <div className="matrix-cache-footer">
        <div className="cache-info">
          <h4>
            <span>🧹</span>
            <span>Reglas Transversales de Compactación Asimétrica & Prompt Cache</span>
          </h4>
          <p>
            Los resúmenes de sesión se desvían a <code>cpamc/gemini-3.8-flash-high</code> (0$ en cuota de Claude).
            El Prompt Cache se mantiene caliente vía Ghost Warmup y afinidad universal de IP/Token.
          </p>
        </div>

        <div className="cache-metrics">
          <div className="cache-pill">
            <span className="cache-pill-label">Ahorro en Compactación</span>
            <span className="cache-pill-value">100% GRATIS</span>
          </div>
          <div className="cache-pill">
            <span className="cache-pill-label">Hit Rate KV-Cache</span>
            <span className="cache-pill-value">&gt; 90%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
