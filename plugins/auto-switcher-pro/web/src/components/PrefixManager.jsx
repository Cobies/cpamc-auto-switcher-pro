import React, { useState, useMemo, useCallback } from 'react';
import { saveAuthFilePrefixes } from '../api/managementClient';
import '../PrefixManager.css';

/**
 * Helper para clasificar el rol del prefijo según la convención de Auto Switcher:
 * - Root / Principal (ej: agy, agy2, agy_clau, codex)
 * - Child / Reserva (ej: agy_1, agy2_1, agy_clau_1, codex_1)
 * - Salvavidas / Fijo (nv, ocgo)
 * - Libre / Sin Asignar
 */
function classifyPrefixRole(prefix = '') {
  const p = prefix.trim();
  if (!p || p.startsWith('unlinked_')) {
    return { role: 'free', label: '⚪ LIBRE / SIN ASIGNAR', badgeClass: 'pm-role-free' };
  }
  if (p === 'nv' || p === 'ocgo') {
    return { role: 'specialist', label: '⚡ SALVAVIDAS PERMANENTE', badgeClass: 'pm-role-specialist' };
  }
  if (/_([0-9]+)$/.test(p)) {
    const match = p.match(/_([0-9]+)$/);
    return { role: 'reserve', label: `🛡️ RESERVA ${match[1]}`, badgeClass: 'pm-role-reserve' };
  }
  return { role: 'leader', label: '👑 CUENTA PRINCIPAL (ROOT)', badgeClass: 'pm-role-leader' };
}

export default function PrefixManager({ nodes = [], onReloadRequested }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all'); // all | gemini | claude | codex | free | antigravity | others
  const [drafts, setDrafts] = useState({});
  const [savingRowId, setSavingRowId] = useState(null);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Inicializar o sincronizar borradores
  const effectiveDrafts = useMemo(() => {
    const map = {};
    nodes.forEach((n) => {
      map[n.id] = drafts[n.id] !== undefined ? drafts[n.id] : (n.data?.prefix || '');
    });
    return map;
  }, [nodes, drafts]);

  // Manejo de cambio en el input de prefijo
  const handleDraftChange = (nodeId, val) => {
    setDrafts((prev) => ({
      ...prev,
      [nodeId]: val,
    }));
  };

  // Cuentas con modificaciones pendientes
  const dirtyNodes = useMemo(() => {
    return nodes.filter((n) => {
      const orig = (n.data?.prefix || '').trim();
      const current = (effectiveDrafts[n.id] || '').trim();
      return orig !== current;
    });
  }, [nodes, effectiveDrafts]);

  // Mapa de conteo de prefijos para detectar colisiones en tiempo real
  const prefixCounts = useMemo(() => {
    const counts = {};
    Object.values(effectiveDrafts).forEach((p) => {
      const trimmed = p.trim();
      if (trimmed && !trimmed.startsWith('unlinked_')) {
        counts[trimmed] = (counts[trimmed] || 0) + 1;
      }
    });
    return counts;
  }, [effectiveDrafts]);

  // Filtrado reactivo por categoría y búsqueda
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      const email = (n.data?.email || n.id).toLowerCase();
      const fileName = (n.data?.fileName || n.id).toLowerCase();
      const prefix = (effectiveDrafts[n.id] || '').toLowerCase();
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();

      // 1. Filtro de búsqueda
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match = email.includes(q) || fileName.includes(q) || prefix.includes(q);
        if (!match) return false;
      }

      // 2. Filtro por categoría / familia
      if (filterCategory === 'all') return true;
      if (filterCategory === 'gemini') {
        // Gemini puro: agy, agy2, agy_1, agy2_1, g1, g2, g3, gemini
        // Exclude agy_clau (Claude del paquete)
        return (
          prefix.includes('g1') || prefix.includes('g2') || prefix.includes('g3') || prefix.includes('gemini') ||
          /^agy\d*$/.test(prefix) || /^agy\d*_\d+$/.test(prefix)
        );
      }
      if (filterCategory === 'claude') {
        return (
          prefix.includes('son') ||
          prefix.includes('claude') ||
          prefix.includes('clau') ||
          prefix.includes('opus')
        );
      }
      if (filterCategory === 'agy_clau') {
        return (
          prefix.startsWith('agy_clau') ||
          fileName.includes('agy_clau')
        );
      }
      if (filterCategory === 'codex') {
        return prov === 'codex' || prefix.includes('codex');
      }
      if (filterCategory === 'free') {
        return !prefix || prefix.startsWith('unlinked_');
      }
      if (filterCategory === 'antigravity') {
        return prov === 'antigravity';
      }
      if (filterCategory === 'others') {
        return prov !== 'antigravity' && prov !== 'codex';
      }
      return true;
    });
  }, [nodes, effectiveDrafts, searchQuery, filterCategory]);

  // Guardar cambio de una sola fila mediante PATCH
  const handleSaveRow = async (node) => {
    const fileName = node.data?.fileName || node.id;
    const newPrefix = (effectiveDrafts[node.id] || '').trim();
    setSavingRowId(node.id);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const res = await saveAuthFilePrefixes([{ name: fileName, prefix: newPrefix }]);
      if (res.successful && res.successful.length > 0) {
        setStatusMessage(`✓ Prefijo "${newPrefix}" guardado para ${fileName}`);
        if (typeof onReloadRequested === 'function') {
          onReloadRequested();
        }
      } else {
        throw new Error('Error al guardar en el servidor');
      }
    } catch (err) {
      setErrorMessage(`Error guardando ${fileName}: ${err.message}`);
    } finally {
      setSavingRowId(null);
    }
  };

  // Guardar todo en lote
  const handleSaveBatch = async () => {
    if (dirtyNodes.length === 0) return;
    setIsSavingBatch(true);
    setStatusMessage('');
    setErrorMessage('');

    const filesToPatch = dirtyNodes.map((n) => ({
      name: n.data?.fileName || n.id,
      prefix: (effectiveDrafts[n.id] || '').trim(),
    }));

    try {
      const res = await saveAuthFilePrefixes(filesToPatch);
      if (res.successful && res.successful.length > 0) {
        setStatusMessage(`✓ ${res.successful.length} prefijos guardados con éxito.`);
        if (typeof onReloadRequested === 'function') {
          onReloadRequested();
        }
      }
      if (res.failed && res.failed.length > 0) {
        setErrorMessage(`⚠️ ${res.failed.length} archivos fallaron al actualizarse.`);
      }
    } catch (err) {
      setErrorMessage(`Fallo general al guardar en lote: ${err.message}`);
    } finally {
      setIsSavingBatch(false);
    }
  };

  return (
    <div className="pm-container" data-testid="prefix-manager-view">
      {/* 1. Hero & Guía de Enrutamiento */}
      <div className="pm-hero-bar">
        <div>
          <h2 className="pm-hero-title">
            <span>📋</span>
            <span>Directorio de Cuentas & Auditoría de Prefijos</span>
          </h2>
          <p className="pm-hero-desc">
            Consulta el estado de tus cuentas vinculadas. La asignación normal y balanceo de prefijos se gestiona de forma automática en <strong>🛠️ Crear Group/Perfiles</strong>. La edición manual en esta tabla está reservada para ajustes avanzados o casos de emergencia.
          </p>
        </div>

        <div className="pm-guide-box">
          <div>• <strong>Creación Automática:</strong> Usa siempre <code>🛠️ Crear Group/Perfiles</code> para balanceo ordenado de Líder (ej: <code>agy</code>, <code>agy_clau</code>, <code>codex</code>) y Reservas (ej: <code>agy_1</code>, <code>agy_clau_1</code>).</div>
          <div>• <strong>Edición Manual de Emergencia:</strong> Puedes forzar un prefijo en disco aquí si necesitas un rescate técnico manual.</div>
        </div>
      </div>

      {/* Alertas efímeras */}
      {statusMessage && (
        <div style={{ padding: '8px 14px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div style={{ padding: '8px 14px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
          {errorMessage}
        </div>
      )}

      {/* 2. Barra de Búsqueda y Filtros Rápidos */}
      <div className="pm-toolbar">
        <div className="pm-search-row">
          <div className="pm-search-input-wrap">
            <span className="pm-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar por correo, prefijo o archivo .json..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pm-search-input"
              data-testid="input-search-prefix"
            />
          </div>

          <div className="pm-filter-chips">
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'all' ? 'active' : ''}`}
              onClick={() => setFilterCategory('all')}
            >
              🌐 Todos ({nodes.length})
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'gemini' ? 'active' : ''}`}
              onClick={() => setFilterCategory('gemini')}
              data-testid="filter-chip-gemini"
            >
              ♊ Gemini
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'claude' ? 'active' : ''}`}
              onClick={() => setFilterCategory('claude')}
              data-testid="filter-chip-claude"
            >
              🟣 Claude
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'agy_clau' ? 'active' : ''}`}
              onClick={() => setFilterCategory('agy_clau')}
              data-testid="filter-chip-agy-clau"
            >
              🎭 agy_clau
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'codex' ? 'active' : ''}`}
              onClick={() => setFilterCategory('codex')}
            >
              🔵 Codex
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'free' ? 'active' : ''}`}
              onClick={() => setFilterCategory('free')}
            >
              ⚪ Sin Prefijo
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'antigravity' ? 'active' : ''}`}
              onClick={() => setFilterCategory('antigravity')}
            >
              🟢 Antigravity
            </button>
            <button
              type="button"
              className={`pm-filter-chip ${filterCategory === 'others' ? 'active' : ''}`}
              onClick={() => setFilterCategory('others')}
            >
              🛠️ Especialistas
            </button>
          </div>
        </div>
      </div>

      {/* 3. Tabla Maestra de Cuentas y Prefijos */}
      <div className="pm-table-card">
        <table className="pm-table">
          <thead>
            <tr>
              <th>PROVEEDOR</th>
              <th>CUENTA / CORREO</th>
              <th>ARCHIVO FÍSICO (.JSON)</th>
              <th>ROL / TOPOLOGÍA</th>
              <th>PREFIJO ASIGNADO</th>
              <th>ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            {filteredNodes.map((n) => {
              const fileName = n.data?.fileName || n.id;
              const email = n.data?.email || n.data?.account || fileName;
              const prov = (n.data?.provider || n.data?.accountType || 'ANTIGRAVITY').toUpperCase();
              const currentVal = effectiveDrafts[n.id] || '';
              const origVal = (n.data?.prefix || '').trim();
              const isDirty = currentVal.trim() !== origVal;
              const isCollision = (prefixCounts[currentVal.trim()] || 0) > 1;
              const roleInfo = classifyPrefixRole(currentVal);
              const isSavingThis = savingRowId === n.id;

              return (
                <tr key={n.id} data-testid={`prefix-row-${n.id}`}>
                  <td>
                    <span style={{
                      fontWeight: 800,
                      fontSize: 10,
                      color: prov === 'CODEX' ? '#79c0ff' : prov === 'ANTIGRAVITY' ? '#4ade80' : '#c084fc',
                    }}>
                      {prov}
                    </span>
                  </td>
                  <td>
                    <div className="pm-email-cell">{email}</div>
                  </td>
                  <td>
                    <div className="pm-filename-cell">{fileName}</div>
                  </td>
                  <td>
                    <span className={`pm-role-badge ${roleInfo.badgeClass}`}>
                      {roleInfo.label}
                    </span>
                  </td>
                  <td>
                    <div className="pm-prefix-input-group">
                      <input
                        type="text"
                        value={currentVal}
                        onChange={(e) => handleDraftChange(n.id, e.target.value)}
                        placeholder="e.g. agy, agy_1, agy_clau, agy_clau_1"
                        className={`pm-prefix-input ${isCollision ? 'collision' : ''} ${isDirty ? 'dirty' : ''}`}
                        data-testid={`input-prefix-${n.id}`}
                      />
                      {isCollision && (
                        <span title="¡Atención! Este prefijo está repetido en más de una cuenta" style={{ fontSize: 13, cursor: 'help' }}>
                          ⚠️
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleSaveRow(n)}
                      disabled={!isDirty || isSavingThis || isSavingBatch}
                      className="pm-btn-save-row"
                      data-testid={`btn-save-row-${n.id}`}
                    >
                      {isSavingThis ? '...' : isDirty ? '💾 Guardar' : '✓'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredNodes.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  No se encontraron cuentas que coincidan con el filtro seleccionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Barra Inferior de Guardado en Lote */}
      <div className="pm-footer-bar">
        <div className="pm-footer-stats">
          <span>Total Cuentas: <strong>{nodes.length}</strong></span>
          <span style={{ margin: '0 8px' }}>•</span>
          <span>Visibles: <strong>{filteredNodes.length}</strong></span>
          <span style={{ margin: '0 8px' }}>•</span>
          <span>Modificadas: <strong style={{ color: dirtyNodes.length > 0 ? '#fde047' : '#94a3b8' }}>{dirtyNodes.length}</strong></span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dirtyNodes.length > 0 && (
            <button
              type="button"
              onClick={handleSaveBatch}
              disabled={isSavingBatch}
              className="pm-btn-batch-save"
              data-testid="btn-save-batch-prefixes"
            >
              <span>💾</span>
              <span>{isSavingBatch ? 'Guardando...' : `Guardar Todo en Lote (${dirtyNodes.length})`}</span>
            </button>
          )}

          {typeof onReloadRequested === 'function' && (
            <button
              type="button"
              onClick={onReloadRequested}
              className="btn btn-outline"
              style={{ fontSize: 11, padding: '6px 12px' }}
            >
              🔄 Recargar Cuentas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
