import React, { useState, useMemo, useCallback } from 'react';
import { saveAuthFilePrefixes, listModels } from '../api/managementClient';
import '../GroupManager.css';

// Familias principales soportadas por la convención de cuota del switcher (internal/quota/quota.go)
const MODEL_FAMILIES = {
  gemini: {
    label: 'Gemini (Paquete Antigravity)',
    icon: '✨',
    provider: 'antigravity',
    hasSubtypes: true,
    subtypes: {
      pure: {
        key: 'pure',
        label: 'Gemini Puro',
        icon: '🔷',
        hintPrefix: 'agy',
        quota: 'Gemini Models',
        note: 'Vigila cuota de "Gemini Models" (3.7 y 3.8 comparten el mismo balde).',
      },
      claude: {
        key: 'claude',
        label: 'Claude del Paquete',
        icon: '🔶',
        hintPrefix: 'agy_clau',
        quota: 'Claude and GPT models',
        note: 'Vigila cuota de "Claude and GPT models" de las cuentas del paquete Gemini.',
      },
    },
  },
  claude: {
    label: 'Claude Nativo / Individual',
    icon: '🤖',
    hintPrefix: 'clau',
    provider: 'antigravity',
    quota: 'Claude and GPT models',
    note: 'Cuentas asignadas para vigilar cuota de Claude/GPT.',
  },
  codex: {
    label: 'Codex (ChatGPT)',
    icon: '🧩',
    hintPrefix: 'codex',
    provider: 'codex',
    quota: 'Codex',
    note: 'Cuentas individuales Codex / OpenAI.',
  },
};

// Determina si un prefijo es descendiente estricto de un pool base:
// 'agy' -> 'agy_1', 'agy_2' (SI), pero 'agy_clau' (NO, porque su sufijo es alfabético).
function isPoolDescendant(poolBase, prefix) {
  const p = (prefix || '').trim();
  const b = (poolBase || '').trim();
  if (!p || !b) return false;
  if (p === b) return true;
  if (!p.startsWith(`${b}_`)) return false;
  const suffix = p.slice(b.length + 1);
  return /^\d+/.test(suffix);
}

// Filtra rutas modelo por familia del pool según su convención de prefijo:
// agy_clau* / clau* / son* -> solo claude/gpt
// agy* / g* -> solo gemini
// codex* -> solo codex
function matchesFamilyModel(base, modelId) {
  const id = String(modelId || '').toLowerCase();
  const b = String(base || '').toLowerCase();
  if (b.startsWith('agy_clau') || b.startsWith('clau') || b.startsWith('son')) {
    return id.includes('claude') || /^gpt/.test(id.replace(/^[a-z0-9_-]+\//, ''));
  }
  if (b.startsWith('agy') || b.startsWith('g')) {
    return id.includes('gemini');
  }
  if (b.startsWith('codex')) {
    return id.includes('codex');
  }
  return true;
}

// Sugiere el siguiente prefijo base libre sin colisiones para N grupos:
// agy -> si agy existe, sugiere agy2, agy3...
// agy_clau -> si agy_clau existe, sugiere agy_clau2, agy_clau3...
function suggestNextBasePrefix(nodes, hint) {
  const existing = new Set(
    nodes.map((n) => (n?.data?.prefix || '').trim()).filter(Boolean)
  );
  if (!existing.has(hint)) return hint;
  let idx = 2;
  while (existing.has(`${hint}${idx}`)) idx++;
  return `${hint}${idx}`;
}

// Próximo número de reserva sin colisión contra TODOS los prefijos existentes
// (nodes) más los ya asignados en la transacción en curso (extraAssigned).
function nextReserveNumber(nodes, base, extraAssigned) {
  const existing = new Set(
    nodes.map((n) => (n?.data?.prefix || '').trim()).filter(Boolean)
  );
  if (extraAssigned) {
    extraAssigned.forEach((p) => existing.add(p));
  }
  let n = 1;
  while (existing.has(`${base}_${n}`)) n++;
  return n;
}

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
  const [family, setFamily] = useState(null); // 'gemini' | 'claude' | 'codex' | null (libre)
  const [geminiSubtype, setGeminiSubtype] = useState('pure'); // 'pure' (agy) | 'claude' (agy_clau)
  const [saveReport, setSaveReport] = useState(null); // { base, successful, failed }
  const [modelRoutes, setModelRoutes] = useState(null); // { base, routes: [] }
  const [copiedRoute, setCopiedRoute] = useState('');

  // Identificar cuentas verdaderamente libres (sin prefijo asignado o huérfanas)
  const freeNodes = useMemo(() => {
    return nodes.filter((n) => {
      const pref = (n.data?.prefix || '').trim();
      return pref === '' || pref.startsWith('unlinked_');
    });
  }, [nodes]);

  // Resolución de familia efectiva (gestiona la jerarquía de sub-tipos de Gemini)
  const effectiveFamily = useMemo(() => {
    if (!family) return null;
    if (family === 'gemini') {
      const sub = MODEL_FAMILIES.gemini.subtypes[geminiSubtype] || MODEL_FAMILIES.gemini.subtypes.pure;
      return {
        key: `gemini_${geminiSubtype}`,
        label: sub.label,
        hintPrefix: sub.hintPrefix,
        provider: 'antigravity',
        quota: sub.quota,
        note: sub.note,
      };
    }
    const fam = MODEL_FAMILIES[family];
    return {
      key: family,
      label: fam.label,
      hintPrefix: fam.hintPrefix,
      provider: fam.provider,
      quota: fam.quota,
      note: fam.note,
    };
  }, [family, geminiSubtype]);

  // Cuentas compatibles con la familia seleccionada.
  const familyCompatibleNodes = useMemo(() => {
    if (!effectiveFamily) return [];
    const famProvider = effectiveFamily.provider;
    return freeNodes.filter((n) => {
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
      return prov === famProvider;
    });
  }, [effectiveFamily, freeNodes]);

  // Cuentas de reserva compatibles: mismas reglas de familia y SIEMPRE excluye
  // la cuenta principal actual, de modo que al cambiarla la anterior reaparezca
  // abajo como candidata y la vigente nunca se ofrezca como su propia reserva.
  const compatibleReserveNodes = useMemo(() => {
    if (!effectiveFamily || !selectedActiveNodeId) return [];
    const famProvider = effectiveFamily.provider;
    return freeNodes.filter((n) => {
      if (n.id === selectedActiveNodeId) return false;
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
      return prov === famProvider;
    });
  }, [effectiveFamily, selectedActiveNodeId, freeNodes]);

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

  // Advertencia de convención de familia (agy* / agy_clau* / clau* / codex*) sobre el nombre del pool
  const familyMismatch = useMemo(() => {
    const trimmed = groupBasePrefix.trim();
    if (!effectiveFamily || !trimmed) return null;
    const hint = effectiveFamily.hintPrefix;

    if (effectiveFamily.key === 'gemini_pure' && trimmed.toLowerCase().startsWith('agy_clau')) {
      return {
        hint,
        message: 'Has seleccionado Gemini Puro, pero el prefijo inicia con "agy_clau" (reservado para Claude del Paquete).',
      };
    }

    const isLegacyValid =
      (effectiveFamily.key === 'gemini_pure' && trimmed.toLowerCase().startsWith('g')) ||
      (effectiveFamily.key === 'claude' && trimmed.toLowerCase().startsWith('son'));

    if (trimmed.toLowerCase().startsWith(hint) || isLegacyValid) return null;

    return {
      hint,
      message: `La convención exige un prefijo que empiece con "${hint}" para vigilar la cuota de "${effectiveFamily.quota}". Con "${trimmed}" el switcher evaluará el peor caso de todas las familias.`,
    };
  }, [effectiveFamily, groupBasePrefix]);

  const handleSelectFamily = useCallback((famKey) => {
    if (family !== famKey) {
      setSelectedActiveNodeId('');
      setSelectedReserveNodeIds([]);
    }
    setFamily(famKey);
    setErrorMessage('');
    setModelRoutes(null);
    setSaveReport(null);

    let hint = famKey && MODEL_FAMILIES[famKey] ? MODEL_FAMILIES[famKey].hintPrefix : null;
    if (famKey === 'gemini') {
      hint = MODEL_FAMILIES.gemini.subtypes[geminiSubtype].hintPrefix;
    }
    if (hint) {
      setGroupBasePrefix(suggestNextBasePrefix(nodes, hint));
    }
  }, [nodes, family, geminiSubtype]);

  const handleSelectGeminiSubtype = useCallback((subType) => {
    if (geminiSubtype !== subType) {
      setSelectedActiveNodeId('');
      setSelectedReserveNodeIds([]);
    }
    setGeminiSubtype(subType);
    setErrorMessage('');
    setModelRoutes(null);
    setSaveReport(null);

    const hint = MODEL_FAMILIES.gemini.subtypes[subType].hintPrefix;
    setGroupBasePrefix(suggestNextBasePrefix(nodes, hint));
  }, [nodes, geminiSubtype]);

  const handleCopyRoute = useCallback(async (route) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(route);
        setCopiedRoute(route);
        setTimeout(() => setCopiedRoute(''), 1500);
      }
    } catch {
      // clipboard no disponible: la ruta sigue visible para copia manual
    }
  }, []);

  // Seleccionar cuenta activa y autocompletar sugerencias
  const handleSelectActiveNode = useCallback((nodeId) => {
    setSelectedActiveNodeId(nodeId);
    setSelectedReserveNodeIds([]);
    setErrorMessage('');

    const chosenNode = nodes.find((n) => n.id === nodeId);
    const chosenPref = (chosenNode?.data?.prefix || '').trim();
    if (chosenPref && !chosenPref.startsWith('unlinked_')) {
      // Cargar el prefijo ya asignado en el auth-file de la cuenta seleccionada
      setGroupBasePrefix(chosenPref);
    } else if (!groupBasePrefix.trim()) {
      // Sugerencia según familia elegida (o codex por defecto), sin colisión
      const hint = effectiveFamily ? effectiveFamily.hintPrefix : null;
      if (chosenNode) {
        const prov = (chosenNode.data?.provider || chosenNode.data?.accountType || '').toLowerCase();
        if (prov === 'codex') {
          setGroupBasePrefix('codex_');
          return;
        }
      }
      if (hint) {
        setGroupBasePrefix(suggestNextBasePrefix(nodes, hint));
      }
    }
  }, [nodes, groupBasePrefix, effectiveFamily]);

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
    if (selectedReserveNodeIds.length === 0) {
      setErrorMessage('Mínimo 2 cuentas requeridas por grupo: debes seleccionar al menos 1 cuenta de reserva.');
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

    const assignedPrefixes = new Set();
    selectedReserveNodeIds.forEach((resId) => {
      const resNode = nodes.find((n) => n.id === resId);
      if (resNode && resNode.data?.fileName) {
        const reserveNum = nextReserveNumber(nodes, trimmedBase, assignedPrefixes);
        const reservePrefix = `${trimmedBase}_${reserveNum}`;
        assignedPrefixes.add(reservePrefix);
        updates.push({
          name: resNode.data.fileName,
          prefix: reservePrefix,
        });
      }
    });

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const report = await saveAuthFilePrefixes(updates);
      if (report.failed.length > 0) {
        setSaveReport({ base: trimmedBase, successful: report.successful, failed: report.failed });
        setErrorMessage(
          `Pool "${trimmedBase}" guardado con errores parciales: fallaron ${report.failed.length} de ${updates.length} cuentas.`
        );
      } else {
        setSaveReport(null);
        setSuccessFeedback(`⚡ Pool "${trimmedBase}" creado y guardado con éxito (${updates.length} cuentas configuradas).`);
        setGroupBasePrefix('');
        setSelectedActiveNodeId('');
        setSelectedReserveNodeIds([]);
        try {
          const { models } = await listModels();
          setModelRoutes({
            base: trimmedBase,
            routes: models.filter((id) => id.startsWith(`${trimmedBase}/`) && matchesFamilyModel(trimmedBase, id)),
          });
        } catch {
          setModelRoutes(null);
        }
      }
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

  // Reintentar solo las cuentas que fallaron en el último guardado
  const handleRetryFailed = useCallback(async () => {
    if (!saveReport || saveReport.failed.length === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const retryUpdates = saveReport.failed.map(({ name, prefix }) => ({ name, prefix }));
      const report = await saveAuthFilePrefixes(retryUpdates);
      if (report.failed.length > 0) {
        setSaveReport((prev) => ({
          base: prev.base,
          successful: [...prev.successful, ...report.successful],
          failed: report.failed,
        }));
        setErrorMessage(`Reintento fallido para ${report.failed.length} cuenta(s).`);
      } else {
        setSaveReport(null);
        setSuccessFeedback(`⚡ Pool "${saveReport.base}" creado y guardado con éxito (reintento completado).`);
        if (typeof onReloadRequested === 'function') {
          await onReloadRequested();
        }
        try {
          const { models } = await listModels();
          setModelRoutes({
            base: saveReport.base,
            routes: models.filter((id) => id.startsWith(`${saveReport.base}/`) && matchesFamilyModel(saveReport.base, id)),
          });
        } catch {
          setModelRoutes(null);
        }
        setTimeout(() => setSuccessFeedback(''), 4000);
      }
    } catch (err) {
      setErrorMessage(`Error al reintentar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [saveReport, nodes, onReloadRequested]);

  // Disolver un pool completo liberando sus cuentas.
  // CRÍTICO: incluye también descendientes profundos (agy_1_1, agy_2_3_1, ...)
  // pero NUNCA disuelve pools hermanos con nombres parecidos (ej. 'agy' no disuelve 'agy_clau'
  // porque el sufijo de este último es alfabético y no numérico).
  const handleDissolvePool = useCallback(async (pool) => {
    const descendants = nodes.filter((n) => {
      const pref = (n.data?.prefix || '').trim();
      return isPoolDescendant(pool.basePrefix, pref);
    });
    const memberIds = new Set([
      ...(pool.root ? [pool.root.id] : []),
      ...pool.reserves.map(({ node }) => node.id),
    ]);
    const deepNodes = descendants.filter((n) => !memberIds.has(n.id));

    const confirmMsg = deepNodes.length > 0
      ? `¿Seguro que deseas disolver el pool "${pool.basePrefix}"? Se liberarán ${(pool.root ? 1 : 0) + pool.reserves.length} cuentas directas y ${deepNodes.length} descendiente(s) profundo(s) (ej. "${pool.basePrefix}_1_1").`
      : `¿Seguro que deseas disolver el pool "${pool.basePrefix}"? Todas sus cuentas volverán a estar libres.`;
    if (!window.confirm(confirmMsg)) return;

    const updates = [];
    descendants.forEach((node) => {
      if (node.data?.fileName) {
        updates.push({ name: node.data.fileName, prefix: '' });
      }
    });

    if (updates.length === 0) return;

    setIsSubmitting(true);
    try {
      const report = await saveAuthFilePrefixes(updates);
      if (report.failed.length > 0) {
        setErrorMessage(`Error al disolver pool: fallaron ${report.failed.length} de ${updates.length} cuentas. Revisa la pestaña de prefijos.`);
      } else {
        setSuccessFeedback(`💥 Pool "${pool.basePrefix}" disuelto exitosamente. Se liberaron ${updates.length} cuentas.`);
        setTimeout(() => setSuccessFeedback(''), 4000);
      }
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
      setTimeout(() => setSuccessFeedback(''), 4000);
    } catch (err) {
      setErrorMessage(`Error al disolver pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [nodes, onReloadRequested]);

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

                {/* Paso 1: Familia de modelos */}
                <div className="group-field">
                  <label className="group-label">① Familia de modelos (define qué cuota se vigila):</label>
                  <div className="group-family-segmented" role="group">
                    {Object.entries(MODEL_FAMILIES).map(([key, fam]) => (
                      <button
                        key={key}
                        type="button"
                        className={`group-family-chip ${family === key ? 'active' : ''}`}
                        onClick={() => handleSelectFamily(key)}
                        data-testid={`family-${key}`}
                      >
                        <span className="group-family-icon">{fam.icon}</span>
                        <span className="group-family-label">{fam.label}</span>
                        <span className="group-family-hint">
                          {key === 'gemini' ? 'Gemini / Claude Paquete' : `prefijo ${fam.hintPrefix}*`}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Sub-selector en la misma columna para el Paquete Gemini */}
                  {family === 'gemini' && (
                    <div className="group-subfamily-container" data-testid="gemini-subfamily-container">
                      <div className="group-subfamily-title">
                        <span>📦</span>
                        <span>Especialidad / Cuota dentro del Paquete Gemini:</span>
                      </div>
                      <div className="group-subfamily-segmented" role="group">
                        <button
                          type="button"
                          className={`group-subfamily-chip ${geminiSubtype === 'pure' ? 'active' : ''}`}
                          onClick={() => handleSelectGeminiSubtype('pure')}
                          data-testid="subfamily-gemini-pure"
                        >
                          <span className="group-subfamily-label">🔷 Gemini Puro</span>
                          <span className="group-subfamily-hint">Prefijo: agy / agy2 · Cuota: Gemini</span>
                        </button>
                        <button
                          type="button"
                          className={`group-subfamily-chip ${geminiSubtype === 'claude' ? 'active' : ''}`}
                          onClick={() => handleSelectGeminiSubtype('claude')}
                          data-testid="subfamily-gemini-claude"
                        >
                          <span className="group-subfamily-label">🔶 Claude del Paquete</span>
                          <span className="group-subfamily-hint">Prefijo: agy_clau / agy_clau2 · Cuota: Claude/GPT</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveFamily && effectiveFamily.note && (
                    <p className="group-family-note">ℹ️ {effectiveFamily.note}</p>
                  )}
                </div>

                {/* Badge de Capacidad en Tiempo Real */}
                {family && (
                  <div className="group-capacity-badge" data-testid="capacity-badge">
                    <span>📊 Cuentas compatibles libres: <strong>{familyCompatibleNodes.length}</strong></span>
                    <span> · Capacidad máxima: <strong>{Math.floor(familyCompatibleNodes.length / 2)}</strong> grupo(s) de rotación (mínimo 2 cuentas/grupo)</span>
                  </div>
                )}

                {/* ② Cuenta Principal + ③ Prefijo Base (lado a lado) */}
                <div className="group-inline-row">
                  <div className="group-field group-field-account">
                    <label className="group-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>👑</span>
                      <span>② Cuenta Principal (Activa / Leader):</span>
                    </label>
                    <select
                      className="group-select"
                      value={selectedActiveNodeId}
                      disabled={!family}
                      onChange={(e) => handleSelectActiveNode(e.target.value)}
                      data-testid="select-active-account"
                    >
                      <option value="">
                        {family
                          ? '-- Selecciona la cuenta principal libre --'
                          : '⚠️ Elige primero la familia de modelos (①)'}
                      </option>
                      {familyCompatibleNodes.map((n) => {
                        const email = n.data?.email || n.data?.fileName || n.id;
                        const prov = (n.data?.provider || n.data?.accountType || 'ANTIGRAVITY').toUpperCase();
                        return (
                          <option key={n.id} value={n.id}>
                            👑 {email} ({prov})
                          </option>
                        );
                      })}
                    </select>
                    {family && familyCompatibleNodes.length === 0 && (
                      <div className="group-family-warning" data-testid="no-compatible-accounts-alert">
                        ℹ️ No hay cuentas libres compatibles con <strong>{effectiveFamily ? effectiveFamily.label : 'esta familia'}</strong>. Las cuentas ya asignadas a otros pools aparecen en la pestaña "💥 Disolver / Desagrupar Pools".
                      </div>
                    )}
                    <p className="group-field-hint">Al elegir la cuenta, su prefijo de auth-file se carga automáticamente.</p>
                  </div>

                  <div className="group-field group-field-prefix">
                    <label className="group-label">③ Prefijo Base del Grupo (Pool):</label>
                    <input
                      type="text"
                      className="group-input"
                      placeholder="ej. agy, agy_clau, agy_clau2"
                      value={groupBasePrefix}
                      onChange={(e) => {
                        setGroupBasePrefix(e.target.value);
                        setErrorMessage('');
                      }}
                      data-testid="input-group-base-prefix"
                    />
                    {familyMismatch && (
                      <div className="group-family-warning" data-testid="prefix-family-warning">
                        ⚠️ {familyMismatch.message}
                      </div>
                    )}
                    <div className="group-prefix-chips">
                      <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Sugerencias:</span>
                      {effectiveFamily && effectiveFamily.hintPrefix === 'agy' && (
                        <>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix(suggestNextBasePrefix(nodes, 'agy'))}>
                            {suggestNextBasePrefix(nodes, 'agy')}
                          </button>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy2')}>agy2</button>
                        </>
                      )}
                      {effectiveFamily && effectiveFamily.hintPrefix === 'agy_clau' && (
                        <>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix(suggestNextBasePrefix(nodes, 'agy_clau'))}>
                            {suggestNextBasePrefix(nodes, 'agy_clau')}
                          </button>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy_clau2')}>agy_clau2</button>
                        </>
                      )}
                      {effectiveFamily && effectiveFamily.hintPrefix === 'clau' && (
                        <>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix(suggestNextBasePrefix(nodes, 'clau'))}>
                            {suggestNextBasePrefix(nodes, 'clau')}
                          </button>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('clau2')}>clau2</button>
                        </>
                      )}
                      {effectiveFamily && effectiveFamily.hintPrefix === 'codex' && (
                        <>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('codex_pool')}>codex_pool</button>
                        </>
                      )}
                      {!family && (
                        <>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy')}>agy</button>
                          <button type="button" className="group-prefix-chip" onClick={() => setGroupBasePrefix('agy_clau')}>agy_clau</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cuentas de Reserva */}
                <div className="group-field">
                  <label className="group-label">
                    Cuentas de Reserva (Mismo Proveedor en Cascada):
                  </label>
                  {compatibleReserveNodes.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>
                      {selectedActiveNodeId
                        ? 'No hay más cuentas libres compatibles con esta familia para agregar como reservas.'
                        : family
                          ? 'Selecciona primero una cuenta principal.'
                          : 'Elige primero la familia de modelos (①).'}
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

                {/* Acciones & Indicadores de Capacidad */}
                {selectedActiveNodeId && selectedReserveNodeIds.length === 0 && (
                  <div className="group-family-warning" style={{ marginTop: 8 }} data-testid="min-reserves-warning">
                    ⚠️ <strong>Mínimo 2 cuentas requeridas:</strong> Cada grupo de rotación debe tener 1 líder + al menos 1 reserva. Selecciona al menos 1 cuenta de reserva arriba.
                  </div>
                )}
                {selectedActiveNodeId && selectedReserveNodeIds.length > 0 && (
                  <div className="group-pool-ready-banner" data-testid="pool-ready-banner">
                    ✨ <strong>Pool listo para crear:</strong> 1 líder + {selectedReserveNodeIds.length} reserva(s) ({1 + selectedReserveNodeIds.length} cuentas en rotación).
                  </div>
                )}

                <div className="group-actions-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      isSubmitting ||
                      !family ||
                      !selectedActiveNodeId ||
                      selectedReserveNodeIds.length < 1 ||
                      !groupBasePrefix.trim() ||
                      !!familyMismatch
                    }
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

          {/* Columna Derecha: Vista Previa de Topología + Panel de Errores + Rutas Aisladas */}
          <div className="group-preview-col">
            {/* Panel de fallos parciales con reintento */}
            {saveReport && saveReport.failed.length > 0 && (
              <div className="group-card group-card-error" data-testid="pool-save-errors">
                <h3 className="group-card-title">
                  <span>⚠️</span>
                  <span>Pool "{saveReport.base}" guardado con errores parciales</span>
                </h3>
                <div className="group-save-report">
                  {saveReport.successful.map((s) => (
                    <div key={`ok-${s.name}`} className="group-save-row ok">
                      ✅ <span className="group-mono">[{s.prefix}]</span> → {s.name}
                    </div>
                  ))}
                  {saveReport.failed.map((f) => (
                    <div key={`fail-${f.name}`} className="group-save-row fail">
                      ❌ <span className="group-mono">[{f.prefix}]</span> → {f.name}
                      <span className="group-save-error">{f.error}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-outline group-retry-btn"
                  disabled={isSubmitting}
                  onClick={handleRetryFailed}
                  data-testid="btn-retry-failed"
                >
                  🔄 Reintentar {saveReport.failed.length} cuenta(s) fallida(s)
                </button>
              </div>
            )}

            {/* Panel de rutas de acceso aislado */}
            {modelRoutes && modelRoutes.routes.length > 0 && (
              <div className="group-card group-card-routes" data-testid="model-routes-panel">
                <h3 className="group-card-title">
                  <span>🔐</span>
                  <span>Rutas de Acceso Aislado — pool "{modelRoutes.base}"</span>
                </h3>
                <p className="group-routes-hint">
                  Usa estas rutas <strong>prefijo/modelo</strong> para que las peticiones de tus clientes sirvan solo las cuentas de este pool.
                </p>
                <div className="group-routes-list">
                  {modelRoutes.routes.map((route) => (
                    <div key={route} className="group-route-row">
                      <code className="group-route-code">{route}</code>
                      <button
                        type="button"
                        className="group-copy-btn"
                        onClick={() => handleCopyRoute(route)}
                        data-testid={`btn-copy-route`}
                      >
                        {copiedRoute === route ? '✓ Copiado' : '📋 Copiar'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="group-route-example">
                  <span className="group-routes-hint">Ejemplo de llamada:</span>
                  <pre className="group-mono">{`POST /v1/chat/completions\n{ "model": "${modelRoutes.routes[0]}", ... }`}</pre>
                </div>
                <div className="group-routes-warning">
                  ⚠️ Si tus clientes usan el modelo base sin prefijo, la petición rota entre todas las cuentas — la cuota NO se aísla.
                </div>
              </div>
            )}

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

                  {/* Nodos de Reserva (numeración anti-colisión) */}
                  {(() => {
                    const previewAssigned = new Set();
                    return selectedReserveNodeIds.map((resId, idx) => {
                      const resNode = nodes.find((n) => n.id === resId);
                      const reserveNum = groupBasePrefix.trim()
                        ? nextReserveNumber(nodes, groupBasePrefix.trim(), previewAssigned)
                        : idx + 1;
                      if (groupBasePrefix.trim()) {
                        previewAssigned.add(`${groupBasePrefix.trim()}_${reserveNum}`);
                      }
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
                          {groupBasePrefix ? `${groupBasePrefix}_${reserveNum}` : `_${reserveNum}`}
                        </span>
                        <span style={{ fontSize: 12, color: '#cbd5e1', marginLeft: 'auto' }}>
                          {resNode?.data?.email || resNode?.data?.fileName}
                        </span>
                      </div>
                    );
                    });
                  })()}
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
