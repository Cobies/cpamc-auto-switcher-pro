import React, { useState, useEffect, useCallback } from 'react';
import { fetchAgentMatrix, saveAgentMatrix, testAgentRoute } from '../api/managementClient';
import './AgentMatrix.css';

const UNIVERSE_STORAGE_KEY = 'agent_matrix_active_universe';

export default function AgentMatrix() {
  const [activeUniverse, setActiveUniverse] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(UNIVERSE_STORAGE_KEY) || 'all';
    }
    return 'all';
  });

  const [gentleAgents, setGentleAgents] = useState([]);
  const [jok3rAgents, setJok3rAgents] = useState([]);
  const [jok3rDetected, setJok3rDetected] = useState(false);
  const [availablePools, setAvailablePools] = useState([]);
  const [poolCapabilities, setPoolCapabilities] = useState({});
  const [poolDetails, setPoolDetails] = useState({});
  const [upstreamModels, setUpstreamModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [pingStates, setPingStates] = useState({}); // { [agentId]: { loading: bool, latency: number, text: string, ok: bool } }

  const handleUniverseChange = (univ) => {
    setActiveUniverse(univ);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(UNIVERSE_STORAGE_KEY, univ);
    }
  };

  const loadMatrix = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAgentMatrix();
      if (data?.ok) {
        setGentleAgents(data.gentle_agents || []);
        const detected = Boolean(data.jok3r_detected && data.jok3r_agents && data.jok3r_agents.length > 0);
        setJok3rDetected(detected);
        setJok3rAgents(detected ? (data.jok3r_agents || []) : []);
        setAvailablePools(data.available_pools || []);
        setPoolCapabilities(data.pool_capabilities || {});
        setPoolDetails(data.pool_details || {});
        setUpstreamModels(data.upstream_models || []);

        if (!detected) {
          setActiveUniverse('gentle_ai');
        }
      }
    } catch (err) {
      setFeedback({ text: `Error al cargar matriz: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  const handlePoolChange = (universe, agentId, field, value) => {
    const updateList = (list) =>
      list.map((a) => {
        if (a.agent_id !== agentId) return a;
        const updated = { ...a, [field]: value };
        // Auto-sanitize thinking if changed to a non-reasoning pool
        if (field === 'primary_pool' && poolCapabilities[value] === false) {
          updated.thinking_level = 'none';
        } else if (field === 'primary_pool' && poolCapabilities[value] !== false && updated.thinking_level === 'none') {
          updated.thinking_level = 'medium';
        }
        return updated;
      });

    if (universe === 'gentle_ai') {
      setGentleAgents(updateList);
    } else {
      setJok3rAgents(updateList);
    }
  };

  const handleTestRoute = async (agent) => {
    const agentKey = `${agent.universe}_${agent.agent_id}`;
    setPingStates((prev) => ({
      ...prev,
      [agentKey]: { loading: true, text: 'Verificando ruta...', ok: true },
    }));

    try {
      const res = await testAgentRoute(agent.primary_pool, poolDetails[agent.primary_pool]?.target_model || '');
      setPingStates((prev) => ({
        ...prev,
        [agentKey]: {
          loading: false,
          latency: res.latency_ms,
          text: `⚡ ${res.latency_ms}ms · ${res.account_email}`,
          ok: res.ok,
        },
      }));
    } catch (err) {
      setPingStates((prev) => ({
        ...prev,
        [agentKey]: {
          loading: false,
          text: `❌ Fallo: ${err.message || 'Error'}`,
          ok: false,
        },
      }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const allAgents = [...gentleAgents, ...jok3rAgents];
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
      if (poolId.includes('/')) {
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

  const renderOrchestrator = (agent) => {
    if (!agent) return null;
    const agentKey = `${agent.universe}_${agent.agent_id}`;
    const ping = pingStates[agentKey];

    return (
      <div className="orchestrator-card" key={agent.agent_id}>
        <div className="orchestrator-info">
          <div className="orchestrator-title">
            <span>{agent.displayName || agent.agent_id}</span>
            {agent.universe === 'gentle_ai' && (
              <span className="orchestrator-dual-chip" title="Afecta simultáneamente a OpenCode y Gentle-Shell">
                💻 OpenCode + 📟 Shell
              </span>
            )}
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
              onChange={(e) => handlePoolChange(agent.universe, agent.agent_id, 'primary_pool', e.target.value)}
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
              onChange={(e) => handlePoolChange(agent.universe, agent.agent_id, 'fallback_pool', e.target.value)}
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
                    onClick={() => handlePoolChange(agent.universe, agent.agent_id, 'thinking_level', lvl)}
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

  const renderTable = (agents) => {
    const subagents = agents.filter((a) => !a.is_orchestrator);
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
            const agentKey = `${a.universe}_${a.agent_id}`;
            const ping = pingStates[agentKey];

            return (
              <tr key={a.agent_id}>
                <td className="agent-name-cell">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{a.displayName || a.agent_id}</span>
                    {a.universe === 'gentle_ai' && (
                      <span className="cell-gentle-tag" title="Sincronizado con OpenCode y Gentle-Shell">
                        💻+📟
                      </span>
                    )}
                  </div>
                  <div className="agent-desc-sub">{a.description}</div>
                </td>
                <td>
                  <select
                    className="matrix-select"
                    value={a.primary_pool}
                    onChange={(e) => handlePoolChange(a.universe, a.agent_id, 'primary_pool', e.target.value)}
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
                    onChange={(e) => handlePoolChange(a.universe, a.agent_id, 'fallback_pool', e.target.value)}
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
                          onClick={() => handlePoolChange(a.universe, a.agent_id, 'thinking_level', lvl)}
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
                    {a.concurrency} {a.concurrency === 1 ? 'tarea' : 'tareas'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button
                      type="button"
                      className="btn-ping-route-table"
                      onClick={() => handleTestRoute(a)}
                      disabled={ping?.loading}
                      title="Ejecutar Dry-Run de verificación para este agente"
                    >
                      {ping?.loading ? '⏳' : '⚡ Test'}
                    </button>
                    {ping?.text && (
                      <span className={`ping-result-badge-table ${ping.ok ? 'ok' : 'err'}`}>
                        {ping.text}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const gentleOrchestrator = gentleAgents.find((a) => a.is_orchestrator);
  const jok3rOrchestrator = jok3rAgents.find((a) => a.is_orchestrator);

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
            Control unificado de orquestadores y subagentes para los 2 Grandes Universos de Ejecución
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
            className="matrix-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            <span>💾</span>
            <span>{saving ? 'Guardando...' : 'Guardar Todo'}</span>
          </button>
        </div>
      </div>

      {/* Universe Segmented Filter with Persistent Storage (Solo si j0k3r-pi está detectado) */}
      {jok3rDetected ? (
        <div className="matrix-tabs">
          <button
            type="button"
            className={`matrix-tab-btn ${activeUniverse === 'all' ? 'active' : ''}`}
            onClick={() => handleUniverseChange('all')}
          >
            <span>🌐</span>
            <span>Vista Global Completa</span>
          </button>
          <button
            type="button"
            className={`matrix-tab-btn ${activeUniverse === 'gentle_ai' ? 'active' : ''}`}
            onClick={() => handleUniverseChange('gentle_ai')}
          >
            <span>🅰️</span>
            <span>Gentle-AI (OpenCode / Shell)</span>
          </button>
          <button
            type="button"
            className={`matrix-tab-btn ${activeUniverse === 'jok3r_pi' ? 'active' : ''}`}
            onClick={() => handleUniverseChange('jok3r_pi')}
          >
            <span>🅱️</span>
            <span>j0k3r-pi</span>
          </button>
        </div>
      ) : (
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
            <span>💻 OpenCode Editor + 📟 Gentle-Shell CLI</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>• (Universo Activo: Gentle-AI)</span>
          </div>
        </div>
      )}

      {/* Universe A: Gentle-AI */}
      {(activeUniverse === 'all' || activeUniverse === 'gentle_ai') && (
        <div className="universe-section">
          <div className="universe-header">
            <div>
              <h3>
                <span>🅰️</span>
                <span>UNIVERSO GENTLE-AI</span>
                <span className="dual-runtime-badge">
                  <span className="chip-opencode">💻 OpenCode Editor</span>
                  <span style={{ opacity: 0.5 }}>+</span>
                  <span className="chip-shell">📟 Gentle-Shell CLI</span>
                </span>
              </h3>
              <p className="universe-clarity-callout">
                💡 <strong>Sincronización Simultánea:</strong> OpenCode y Gentle-Shell son dos puertas de acceso que comparten el mismo arnés subyacente (<code>gentle-ai</code>). Al cambiar los modelos en esta sección, se actualizan simultáneamente en tu editor OpenCode y en tu terminal Gentle-Shell.
              </p>
            </div>
            <span className="universe-meta">
              ~/.gentle-shell/agent/profiles.json
            </span>
          </div>

          {renderOrchestrator(gentleOrchestrator)}
          {renderTable(gentleAgents)}
        </div>
      )}

      {/* Universe B: j0k3r-pi (Solo si está detectado dinámicamente) */}
      {jok3rDetected && (activeUniverse === 'all' || activeUniverse === 'jok3r_pi') && (
        <div className="universe-section">
          <div className="universe-header">
            <div>
              <h3>
                <span>🅱️</span>
                <span>UNIVERSO J0K3R-PI</span>
              </h3>
              <p className="universe-clarity-callout" style={{ borderColor: 'rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.04)' }}>
                ⚡ <strong>Suite Todo-en-Uno Soberana:</strong> Orquestador interactivo de terminal y escuadrón de subagentes Planned Workflow (<code>00-discovery</code>, <code>01-planning</code>, <code>02-apply</code>, etc.).
              </p>
            </div>
            <span className="universe-meta">
              ~/.pi/agent-j0k3r/subagents.json
            </span>
          </div>

          {renderOrchestrator(jok3rOrchestrator)}
          {renderTable(jok3rAgents)}
        </div>
      )}

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
