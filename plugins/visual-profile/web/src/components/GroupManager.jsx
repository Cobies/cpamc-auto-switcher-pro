import React, { useState, useMemo, useCallback } from 'react';
import { saveAuthFilePrefixes } from '../api/managementClient';
import '../GroupManager.css';

/**
 * GroupManager Component
 * Dedicated full-screen manager for structuring new pools and dissolving existing ones.
 */
export default function GroupManager({
  nodes = [],
  edges = [],
  onReloadRequested,
  onSwitchTab,
}) {
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'dissolve'
  const [groupBasePrefix, setGroupBasePrefix] = useState('');
  const [selectedActiveNodeId, setSelectedActiveNodeId] = useState('');
  const [selectedReserveNodeIds, setSelectedReserveNodeIds] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successFeedback, setSuccessFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Identificar cuentas verdaderamente libres (sin prefijo asignado o huérfanas)
  const freeNodes = useMemo(() => {
    return nodes.filter((n) => {
      const pref = (n.data?.prefix || '').trim();
      return pref === '' || pref.startsWith('unlinked_');
    });
  }, [nodes]);

  // Cuentas de reserva compatibles con el proveedor de la cuenta activa
  const compatibleReserveNodes = useMemo(() => {
    if (!selectedActiveNodeId) return [];
    const activeNode = nodes.find((n) => n.id === selectedActiveNodeId);
    if (!activeNode) return [];

    const activeProv = (activeNode.data?.provider || activeNode.data?.accountType || '').toLowerCase();
    const isActiveCodex = activeProv === 'codex';

    return freeNodes.filter((n) => {
      if (n.id === selectedActiveNodeId) return false;
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
      const isCodex = prov === 'codex';
      return isActiveCodex ? isCodex : !isCodex;
    });
  }, [selectedActiveNodeId, nodes, freeNodes]);

  // Mapear pools existentes en el sistema agrupados por prefijo base
  const existingPools = useMemo(() => {
    const poolsMap = new Map();

    nodes.forEach((node) => {
      const pref = (node.data?.prefix || '').trim();
      if (!pref || pref.startsWith('unlinked_')) return;

      // Detectar si es reserva (_N) o raíz
      const reserveMatch = pref.match(/^(.*)_(\d+)$/);
      const baseKey = reserveMatch ? reserveMatch[1] : pref;
      const isReserve = !!reserveMatch;

      if (!poolsMap.has(baseKey)) {
        poolsMap.set(baseKey, {
          basePrefix: baseKey,
          root: null,
          reserves: [],
        });
      }

      const pool = poolsMap.get(baseKey);
      if (!isReserve && !pool.root) {
        pool.root = node;
      } else {
        pool.reserves.push({
          node,
          prefix: pref,
          reserveIndex: reserveMatch ? parseInt(reserveMatch[2], 10) : 99,
        });
      }
    });

    // Ordenar reservas por índice de cascada
    return Array.from(poolsMap.values()).map((p) => {
      p.reserves.sort((a, b) => a.reserveIndex - b.reserveIndex);
      return p;
    });
  }, [nodes]);

  // Seleccionar cuenta activa y autocompletar sugerencias
  const handleSelectActiveNode = useCallback((nodeId) => {
    setSelectedActiveNodeId(nodeId);
    setSelectedReserveNodeIds([]);
    setErrorMessage('');

    const chosenNode = nodes.find((n) => n.id === nodeId);
    const chosenPref = (chosenNode?.data?.prefix || '').trim();
    if (chosenPref && !chosenPref.startsWith('unlinked_')) {
      setGroupBasePrefix(chosenPref);
    } else if (!groupBasePrefix.trim()) {
      const prov = (chosenNode?.data?.provider || chosenNode?.data?.accountType || '').toLowerCase();
      if (prov === 'codex') {
        setGroupBasePrefix('codex_');
      } else {
        setGroupBasePrefix('agy_');
      }
    }
  }, [nodes, groupBasePrefix]);

  const handleToggleReserve = useCallback((nodeId) => {
    setSelectedReserveNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  }, []);

  // Crear y guardar el nuevo pool vía PATCH en la API de gestión
  const handleCreateGroup = useCallback(async () => {
    const trimmedBase = groupBasePrefix.trim();
    if (!trimmedBase) {
      setErrorMessage('El prefijo base del pool no puede estar vacío.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedBase)) {
      setErrorMessage('El prefijo solo puede contener letras, números, guiones y guiones bajos.');
      return;
    }
    if (!selectedActiveNodeId) {
      setErrorMessage('Debes seleccionar una cuenta Principal (Activa / Root).');
      return;
    }

    const activeNode = nodes.find((n) => n.id === selectedActiveNodeId);
    if (!activeNode || !activeNode.data?.fileName) {
      setErrorMessage('No se encontró el archivo de autenticación de la cuenta principal.');
      return;
    }

    const updates = [
      { name: activeNode.data.fileName, prefix: trimmedBase },
    ];

    selectedReserveNodeIds.forEach((resId, idx) => {
      const resNode = nodes.find((n) => n.id === resId);
      if (resNode && resNode.data?.fileName) {
        updates.push({
          name: resNode.data.fileName,
          prefix: `${trimmedBase}_${idx + 1}`,
        });
      }
    });

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await saveAuthFilePrefixes(updates);
      setSuccessFeedback(`⚡ Pool "${trimmedBase}" creado y guardado con éxito (${updates.length} cuentas configuradas).`);
      setGroupBasePrefix('');
      setSelectedActiveNodeId('');
      setSelectedReserveNodeIds([]);
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
      setTimeout(() => setSuccessFeedback(''), 4000);
    } catch (err) {
      setErrorMessage(`Error al guardar pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [groupBasePrefix, selectedActiveNodeId, selectedReserveNodeIds, nodes, onReloadRequested]);

  // Disolver un pool completo liberando sus cuentas
  const handleDissolvePool = useCallback(async (pool) => {
    const confirmDissolve = window.confirm(
      `¿Seguro que deseas disolver el pool "${pool.basePrefix}"? Todas sus cuentas volverán a estar libres.`
    );
    if (!confirmDissolve) return;

    const updates = [];
    if (pool.root && pool.root.data?.fileName) {
      updates.push({ name: pool.root.data.fileName, prefix: '' });
    }
    pool.reserves.forEach(({ node }) => {
      if (node && node.data?.fileName) {
        updates.push({ name: node.data.fileName, prefix: '' });
      }
    });

    setIsSubmitting(true);
    try {
      await saveAuthFilePrefixes(updates);
      setSuccessFeedback(`💥 Pool "${pool.basePrefix}" disuelto exitosamente. Se liberaron ${updates.length} cuentas.`);
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
      setTimeout(() => setSuccessFeedback(''), 4000);
    } catch (err) {
      setErrorMessage(`Error al disolver pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [onReloadRequested]);

  return (
    <div className="group-manager-container" data-testid="group-manager-view">
      {/* Header Principal */}
      <div className="group-manager-header">
        <div className="group-manager-title-area">
          <div className="group-manager-title-row">
            <span className="group-manager-icon">🛠️</span>
            <h2 className="group-manager-title">Crear Group / Perfiles</h2>
          </div>
          <p className="group-manager-desc">
            Orquesta pools de balanceo de carga y alta disponibilidad (Leader / Cascading Reserves) para enrutamiento en CPAMC.
          </p>
        </div>
      </div>

      {/* Feedback Toasts */}
      {successFeedback && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.2)',
          border: '1px solid #10b981',
          color: '#6ee7b7',
          padding: '10px 16px',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          fontWeight: 600,
        }}>
          {successFeedback}
        </div>
      )}

      {errorMessage && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
          padding: '10px 16px',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          fontWeight: 600,
        }}>
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Navegación por Pestañas */}
      <div className="group-manager-tabs">
        <button
          type="button"
          className={`group-manager-tab ${activeTab === 'create' ? 'active' : ''}`}
          onClick={() => setActiveTab('create')}
          data-testid="tab-armar-pool"
        >
          <span>⚡</span>
          <span>Armar Nuevo Pool</span>
        </button>
        <button
          type="button"
          className={`group-manager-tab ${activeTab === 'dissolve' ? 'active' : ''}`}
          onClick={() => setActiveTab('dissolve')}
          data-testid="tab-disolver-pools"
        >
          <span>💥</span>
          <span>Disolver / Desagrupar Pools ({existingPools.length})</span>
        </button>
      </div>

      {/* Pestaña: Armar Nuevo Pool */}
      {activeTab === 'create' && (
        <div className="group-manager-content">
          <div className="group-builder-col">
            {freeNodes.length === 0 ? (
              <div className="group-empty-alert" data-testid="empty-free-nodes-alert">
                <span className="group-alert-icon">⚠️</span>
                <h4 className="group-alert-title">No hay cuentas libres disponibles</h4>
                <p className="group-alert-desc">
                  Todas las cuentas están asignadas a grupos existentes. Para armar un nuevo pool, ve a la pestaña <strong>"💥 Disolver / Desagrupar Pools"</strong> para liberar cuentas.
                </p>
                <button
                  type="button"
                  className="group-prefix-chip"
                  onClick={() => setActiveTab('dissolve')}
                  style={{ marginTop: 12, padding: '8px 16px', fontSize: 12 }}
                  data-testid="btn-go-to-dissolve"
                >
                  💥 Ir a Disolver / Liberar Cuentas
                </button>
              </div>
            ) : (
              <div className="group-card">
                <h3 className="group-card-title">
                  <span>⚡</span>
                  <span>Estructuración de Grupo & Pool</span>
                </h3>

                {/* Input Prefijo Base */}
                <div className="group-field">
                  <label className="group-label">Prefijo Base del Grupo (Pool):</label>
                  <input
                    type="text"
                    className="group-input"
                    placeholder="ej. agy_g3 o codex_dev"
                    value={groupBasePrefix}
                    onChange={(e) => {
                      setGroupBasePrefix(e.target.value);
                      setErrorMessage('');
                    }}
                    data-testid="input-group-base-prefix"
                  />
                  <div className="group-prefix-chips">
                    <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Sugerencias:</span>
                    <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy_g3')}>agy_g3</button>
                    <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy_g4')}>agy_g4</button>
                    <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy_son2')}>agy_son2</button>
                    <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('codex_pool')}>codex_pool</button>
                  </div>
                </div>

                {/* Selector de Cuenta Principal */}
                <div className="group-field">
                  <label className="group-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>👑</span>
                    <span>Cuenta Principal (Activa / Leader):</span>
                  </label>
                  <select
                    className="group-select"
                    value={selectedActiveNodeId}
                    onChange={(e) => handleSelectActiveNode(e.target.value)}
                    data-testid="select-active-account"
                  >
                    <option value="">-- Selecciona la cuenta principal libre --</option>
                    {freeNodes.map((n) => {
                      const email = n.data?.email || n.data?.fileName || n.id;
                      const prov = (n.data?.provider || n.data?.accountType || 'ANTIGRAVITY').toUpperCase();
                      return (
                        <option key={n.id} value={n.id}>
                          👑 {email} ({prov})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Cuentas de Reserva */}
                <div className="group-field">
                  <label className="group-label">
                    Cuentas de Reserva (Mismo Proveedor en Cascada):
                  </label>
                  {compatibleReserveNodes.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>
                      {selectedActiveNodeId
                        ? 'No hay más cuentas libres con este mismo proveedor para agregar como reservas.'
                        : 'Selecciona primero una cuenta principal.'}
                    </div>
                  ) : (
                    <div className="group-reserves-container" data-testid="reserves-container">
                      {compatibleReserveNodes.map((n) => {
                        const isChecked = selectedReserveNodeIds.includes(n.id);
                        const email = n.data?.email || n.data?.fileName || n.id;
                        const file = n.data?.fileName || '';
                        return (
                          <div
                            key={n.id}
                            className={`group-reserve-item ${isChecked ? 'selected' : ''}`}
                            onClick={() => handleToggleReserve(n.id)}
                            data-testid={`reserve-item-${n.id}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ cursor: 'pointer' }}
                            />
                            <div className="group-reserve-label">
                              <span className="group-reserve-email">{email}</span>
                              <span className="group-reserve-sub">{file}</span>
                            </div>
                            {isChecked && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#c084fc' }}>
                                _{selectedReserveNodeIds.indexOf(n.id) + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="group-actions-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isSubmitting || !selectedActiveNodeId || !groupBasePrefix.trim()}
                    onClick={handleCreateGroup}
                    data-testid="btn-save-group"
                    style={{
                      padding: '10px 20px',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                      color: '#fff',
                      fontWeight: 700,
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span>✓</span>
                    <span>{isSubmitting ? 'Guardando...' : 'Armar y Guardar Pool'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Columna Derecha: Vista Previa de Topología */}
          <div className="group-preview-col">
            <div className="group-card">
              <h3 className="group-card-title">
                <span>👁️</span>
                <span>Previsualización en Vivo de la Cascada</span>
              </h3>

              {!selectedActiveNodeId ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b', fontSize: 13 }}>
                  Selecciona una cuenta principal y prefijo para ver la jerarquía resultante.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Nodo Principal */}
                  <div className="group-preview-node root" data-testid="preview-node-root">
                    <span className="group-preview-badge root">👑 Principal</span>
                    <span className="group-preview-code">
                      {groupBasePrefix || 'prefijo_base'}
                    </span>
                    <span style={{ fontSize: 12, color: '#cbd5e1', marginLeft: 'auto' }}>
                      {nodes.find((n) => n.id === selectedActiveNodeId)?.data?.email || 'cuenta'}
                    </span>
                  </div>

                  {/* Nodos de Reserva */}
                  {selectedReserveNodeIds.map((resId, idx) => {
                    const resNode = nodes.find((n) => n.id === resId);
                    return (
                      <div
                        key={resId}
                        className="group-preview-node"
                        style={{ marginLeft: 20 }}
                        data-testid={`preview-node-reserve-${idx}`}
                      >
                        <span className="group-preview-badge reserve">
                          ↳ 🛡️ Reserva {idx + 1}
                        </span>
                        <span className="group-preview-code">
                          {groupBasePrefix ? `${groupBasePrefix}_${idx + 1}` : `_${idx + 1}`}
                        </span>
                        <span style={{ fontSize: 12, color: '#cbd5e1', marginLeft: 'auto' }}>
                          {resNode?.data?.email || resNode?.data?.fileName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pestaña: Disolver / Desagrupar Pools */}
      {activeTab === 'dissolve' && (
        <div className="group-pools-grid" data-testid="dissolve-pools-grid">
          {existingPools.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 48, color: '#94a3b8' }}>
              No se detectaron pools estructurados en el sistema actualmente.
            </div>
          ) : (
            existingPools.map((pool) => (
              <div key={pool.basePrefix} className="group-pool-card" data-testid={`pool-card-${pool.basePrefix}`}>
                <div className="group-pool-header">
                  <h4 className="group-pool-title">{pool.basePrefix}</h4>
                  <span style={{ fontSize: 11, background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', padding: '2px 8px', borderRadius: 4 }}>
                    {(pool.root ? 1 : 0) + pool.reserves.length} cuentas
                  </span>
                </div>

                <div className="group-pool-members">
                  {pool.root && (
                    <div className="group-pool-member-row">
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>👑 {pool.root.data?.email || pool.root.data?.fileName}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', color: '#fbbf24', fontWeight: 700 }}>
                          [{pool.root.data?.prefix || pool.basePrefix}]
                        </span>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 800,
                          background: 'rgba(234, 179, 8, 0.25)',
                          color: '#fef08a',
                          padding: '2px 6px',
                          borderRadius: 4,
                          border: '1px solid rgba(234, 179, 8, 0.4)',
                        }}>
                          LEADER
                        </span>
                      </div>
                    </div>
                  )}
                  {pool.reserves.map(({ node, prefix }) => (
                    <div key={node.id} className="group-pool-member-row">
                      <span style={{ color: '#7dd3fc' }}>🛡️ {node.data?.email || node.data?.fileName}</span>
                      <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>[{prefix}]</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => handleDissolvePool(pool)}
                  disabled={isSubmitting}
                  className="btn btn-outline"
                  data-testid={`btn-dissolve-pool-${pool.basePrefix}`}
                  style={{
                    marginTop: 10,
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: 'rgba(239, 68, 68, 0.1)',
                  }}
                >
                  <span>💥</span>
                  <span>Disolver Pool (Liberar Cuentas)</span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
