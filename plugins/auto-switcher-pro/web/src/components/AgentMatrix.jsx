import React, { useState, useEffect, useCallback } from 'react';
import { fetchAgentMatrix, saveAgentMatrix, testAgentRoute, scanAgentEnvironment } from '../api/managementClient';
import './AgentMatrix.css';

const UNIVERSE_STORAGE_KEY = 'agent_matrix_active_universe';

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
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [pingStates, setPingStates] = useState({}); // { [agentKey]: { loading: bool, latency: number, text: string, ok: bool } }

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

  const handlePoolChange = (universe, agentId, field, value) => {
    setHarnesses((prev) =>
      prev.map((h) => {
        if (h.id !== universe) return h;
        const updatedAgents = h.agents.map((a) => {
          if (a.agent_id !== agentId) return a;
          const updated = { ...a, [field]: value };
          if (field === 'primary_pool' && poolCapabilities[value] === false) {
            updated.thinking_level = 'none';
          } else if (field === 'primary_pool' && poolCapabilities[value] !== false && updated.thinking_level === 'none') {
            updated.thinking_level = 'medium';
          }
          return updated;
        });
        return { ...h, agents: updatedAgents };
      })
    );
  };

  const handleTestRoute = async (agent) => {
    const agentKey = `${agent.universe}_${agent.agent_id}`;
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
          text: `⚡ OK (${res.latency_ms}ms) · ${res.account_email}`,
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

  const handleSave = async () => {
    try {
      setSaving(true);
      const allAgents = harnesses.flatMap((h) => h.agents || []);
      const res = await saveAgentMatrix(allAgents);
      setFeedback({ text: res?.message || 'Matriz guardada y sincronizada con éxito', type: 'success' });
      setTimeout(() => setFeedback({ text: '', type: '' }), 4000);
    } catch (err) {
      setFeedback({ text: `Error al guardar: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="agent-matrix-container" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div className="loading-spinner" />
        <p style={{ marginTop: 12, color: '#94a3b8' }}>Cargando matriz de orquestación y perfiles...</p>
      </div>
    );
  }

  const renderDropdownOptions = () => (
    <>
      <optgroup label="── 🛡️ POOLS DE BALANCEO ACTIVO ──">
        {availablePools.map((p) => (
          <option key={p} value={p}>
            {p} {poolDetails[p]?.target_model ? `(${poolDetails[p].target_model})` : ''}
          </option>
        ))}
      </optgroup>
      {upstreamModels.length > 0 && (
        <optgroup label="── 🌐 CUENTAS SUELTAS / UPSTREAM ──">
          {upstreamModels.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id} ({u.displayName})
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  const renderPoolTransparencyPill = (poolId) => {
    const detail = poolDetails[poolId];
    if (!detail) {
      if (poolId && poolId.includes('/')) {
        return (
          <div className="pool-transparency-pill upstream-pill" title={`Modelo upstream directo: ${poolId}`}>
            <span className="dot-active">🌐</span>
            <span className="pill-model">Direct Upstream</span>
          </div>
        );
      }
      return null;
    }
    return (
      <div
        className="pool-transparency-pill"
        title={`Fachada Soberana: ${poolId}\nModelo en RAM: ${detail.target_model}\nLíder Activo: ${detail.leader_email}\nCuentas físicas en pool: ${detail.total_members} (1 líder + ${detail.reserves_count} reservas)`}
      >
        <span className="dot-active">🟢</span>
        <span className="pill-model">{detail.target_model}</span>
        <span className="pill-accounts">({detail.total_members} cuentas)</span>
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
              onClick={() => handleTestRoute(agent)}
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
              MODELO PRIMARIO
            </span>
            <select
              className="matrix-select"
              value={agent.primary_pool}
              onChange={(e) => handlePoolChange(harnessId, agent.agent_id, 'primary_pool', e.target.value)}
            >
              {renderDropdownOptions()}
            </select>
            {renderPoolTransparencyPill(agent.primary_pool)}
          </div>

          <span
            className="relay-arrow"
            title="Rescate automático: Solo toma el relevo si el líder primario recibe 429 o fallo de red"
          >
            →
          </span>

          <div>
            <span
              style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}
              title="Rescate Pasivo: Permanece en espera con 0% de consumo hasta que el líder primario agote cuota o reciba 429"
            >
              RESCATE (FAILOVER 429) ℹ️
            </span>
            <select
              className="matrix-select"
              value={agent.fallback_pool}
              onChange={(e) => handlePoolChange(harnessId, agent.agent_id, 'fallback_pool', e.target.value)}
            >
              {renderDropdownOptions()}
            </select>
            <div className="fallback-subtext">Standby · 0% tokens hasta 429</div>
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
            <th>ROL / AGENTE</th>
            <th>MODELO ASIGNADO (FACHADA EN RAM)</th>
            <th></th>
            <th title="Modo Pasivo (0% consumo ordinario). Solo toma el relevo si el modelo principal agota cuota o recibe error HTTP 429.">
              RESCATE EN CALIENTE (FAILOVER 429) ℹ️
            </th>
            <th>THINKING</th>
            <th>CONCURRENCIA</th>
            <th>TEST</th>
          </tr>
        </thead>
        <tbody>
          {subagents.map((a) => {
            const agentKey = `${harnessId}_${a.agent_id}`;
            const ping = pingStates[agentKey];

            return (
              <tr key={a.agent_id}>
                <td className="agent-name-cell">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{a.displayName || a.agent_id}</span>
                  </div>
                  <div className="agent-desc-sub">{a.description}</div>
                </td>
                <td>
                  <select
                    className="matrix-select"
                    value={a.primary_pool}
                    onChange={(e) => handlePoolChange(harnessId, a.agent_id, 'primary_pool', e.target.value)}
                  >
                    {renderDropdownOptions()}
                  </select>
                  {renderPoolTransparencyPill(a.primary_pool)}
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
                  >
                    {renderDropdownOptions()}
                  </select>
                  <div className="fallback-subtext">Standby · 0% tokens hasta 429</div>
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
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#94a3b8',
                      background: 'rgba(255,255,255,0.05)',
                      padding: '4px 8px',
                      borderRadius: 4,
                    }}
                  >
                    {a.concurrency || 1} {a.concurrency === 1 ? 'tarea' : 'tareas'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-ping-route"
                    onClick={() => handleTestRoute(a)}
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
              <span className="universe-meta">
                {harness.config_path}
              </span>
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
