import React, { useState } from 'react';
import {
  scanSystemHealth,
  cleanSystemResidues,
  updateManagementConsole,
  deleteAuthFile,
  listPools,
  loadAuthFilesWithPrefixes,
} from '../api/managementClient';
import { triggerCPAMCSidebarRefresh } from '../utils/syncSidebar';
import './Maintenance.css';

/**
 * Normaliza un ID de modelo a su forma base sin prefijos ("agy/agy/x" -> "x").
 */
function bareModelId(m) {
  let cur = String(m || '').trim().toLowerCase();
  while (cur.includes('/')) {
    cur = cur.slice(cur.indexOf('/') + 1);
  }
  return cur;
}

/**
 * computeSyncAudit: motor puro y universal de los 4 Pilares Dinámicos.
 *
 * Es 100% agnóstico: no asume prefijos (agy, agy2...), familias ni proveedores.
 * Todo se deriva del PoolRegistry (listPools) y de las exclusiones físicas en
 * disco de cada cuenta (loadAuthFilesWithPrefixes), sea cual sea su escala (N cuentas).
 *
 * Pilar 1 — Tuerca ⚙️ por líder de pool: 🔓 multipropósito | 🔒 especialista | parcial | inconsistente.
 * Pilar 2 — Elección del Líder Virtual Activo por familia (prefijo canónico más corto, luego alfabético).
 * Pilar 3 — Proyección esperada en /model: "<líder>/<modelo>" por cada modelo permitido.
 *
 * @param {Array<Object>} pools - Pools registrados ({ family, base_prefix, leader_auth, leader_email, policy })
 * @param {Array<Object>} authFiles - Cuentas con exclusiones ({ name, prefix, excluded_models })
 * @returns {{ families: Array<Object>, expectedModels: string[], tuercaSummary: Object }}
 */
export function computeSyncAudit(pools = [], authFiles = []) {
  const poolList = (Array.isArray(pools) ? pools : []).filter(
    (p) => p && typeof p.base_prefix === 'string' && p.base_prefix.trim()
  );

  const exclusionByAuthName = new Map();
  for (const f of Array.isArray(authFiles) ? authFiles : []) {
    if (f && typeof f.name === 'string') {
      exclusionByAuthName.set(
        f.name,
        (Array.isArray(f.excluded_models) ? f.excluded_models : []).map((m) => String(m || '').trim().toLowerCase())
      );
    }
  }

  // Agrupación dinámica por familia declarada en el pool (cualquier familia futura vale).
  const families = new Map();
  for (const pool of poolList) {
    const fam = typeof pool.family === 'string' && pool.family.trim() ? pool.family.trim() : 'default';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push(pool);
  }

  const familyReports = [];
  const expectedModels = [];

  for (const [family, famPools] of families) {
    // Catálogo de la familia = unión de target_models de todos sus pools.
    const catalog = [];
    const seen = new Set();
    for (const p of famPools) {
      const targets = Array.isArray(p?.policy?.target_models) ? p.policy.target_models : [];
      for (const t of targets) {
        const b = bareModelId(t);
        if (b && !seen.has(b)) {
          seen.add(b);
          catalog.push(b);
        }
      }
    }

    // Elección del Líder Virtual Activo: prefijo canónico más corto, luego alfabético.
    const sorted = [...famPools].sort((a, b) => {
      const la = a.base_prefix.trim().length;
      const lb = b.base_prefix.trim().length;
      if (la !== lb) return la - lb;
      return a.base_prefix.trim().localeCompare(b.base_prefix.trim());
    });
    const elected = sorted[0];
    const shadowed = sorted.slice(1).map((p) => p.base_prefix.trim());

    // Tuerca ⚙️: exclusiones físicas de la cuenta líder electa.
    const excludedSet = new Set(exclusionByAuthName.get(elected.leader_auth) || []);
    const isWildcard = Boolean(elected?.policy?.disable_isolation) || catalog.length === 0;
    const allowed = isWildcard ? [] : catalog.filter((m) => !excludedSet.has(m));

    let tuercaMode;
    if (isWildcard) tuercaMode = 'multipurpose';
    else if (allowed.length === 0) tuercaMode = 'inconsistent';
    else if (allowed.length === 1) tuercaMode = 'specialist';
    else if (allowed.length === catalog.length) tuercaMode = 'multipurpose';
    else tuercaMode = 'partial';

    if (!isWildcard) {
      for (const m of allowed) {
        expectedModels.push(`${elected.base_prefix.trim()}/${m}`);
      }
    }

    familyReports.push({
      family,
      elected: {
        base_prefix: elected.base_prefix.trim(),
        leader_auth: elected.leader_auth || '',
        leader_email: elected.leader_email || '',
      },
      shadowed,
      catalogSize: isWildcard ? 0 : catalog.length,
      allowed,
      tuercaMode,
      wildcard: isWildcard,
    });
  }

  familyReports.sort((a, b) => a.family.localeCompare(b.family));

  const tuercaSummary = {
    total: familyReports.length,
    specialist: familyReports.filter((f) => f.tuercaMode === 'specialist').length,
    multipurpose: familyReports.filter((f) => f.tuercaMode === 'multipurpose').length,
    partial: familyReports.filter((f) => f.tuercaMode === 'partial').length,
    inconsistent: familyReports.filter((f) => f.tuercaMode === 'inconsistent').length,
  };

  return { families: familyReports, expectedModels, tuercaSummary };
}

export default function Maintenance({ onReloadRequested }) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStepText, setScanStepText] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPurgingOrphans, setIsPurgingOrphans] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Sub-pestañas: 'general' (auditoría clásica de 4 módulos) | 'sync' (Tuerca ⚙️ + Líderes + /model)
  const [activeSubTab, setActiveSubTab] = useState('general');
  const [syncAudit, setSyncAudit] = useState(null);
  const [isSyncScanning, setIsSyncScanning] = useState(false);

  // Por defecto HABILITADAS (4 de 4) para diagnóstico inmediato con 1 clic
  const [phases, setPhases] = useState({
    auth: true,
    models: true,
    pools: true,
    console: true,
  });

  const [autoUpdateConsole, setAutoUpdateConsole] = useState(() => {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    return window.localStorage.getItem('auto_update_console_on_boot') !== 'false';
  });

  const handleToggleAutoUpdate = (e) => {
    const nextVal = e.target.checked;
    setAutoUpdateConsole(nextVal);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('auto_update_console_on_boot', nextVal ? 'true' : 'false');
    }
  };

  const handleSyncSidebar = () => {
    triggerCPAMCSidebarRefresh();
    setFeedback({
      text: '✅ Menú lateral de CPAMC sincronizado con el backend exitosamente.',
      type: 'success',
    });
    setTimeout(() => {
      setFeedback({ text: '', type: '' });
    }, 4000);
  };

  const selectedCount = Object.values(phases).filter(Boolean).length;

  const toggleAllPhases = () => {
    const nextVal = selectedCount === 0;
    setPhases({
      auth: nextVal,
      models: nextVal,
      pools: nextVal,
      console: nextVal,
    });
  };

  const togglePhase = (key) => {
    setPhases((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const showFeedback = (text, type = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback({ text: '', type: '' }), 6000);
  };

  const handleScan = async () => {
    if (selectedCount === 0) {
      showFeedback('Por favor marca al menos una casilla de los módulos arriba para auditar.', 'error');
      return;
    }

    setIsScanning(true);
    setScanResult(null);
    setScanProgress(5);
    setScanStepText('Iniciando auditoría de los módulos seleccionados...');

    const isTest = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE === 'test';

    const activeStages = [];
    if (phases.auth) {
      activeStages.push({ text: 'Revisando archivos físicos de credenciales en servidor...', delay: isTest ? 10 : 800 });
    }
    if (phases.models) {
      activeStages.push({ text: 'Buscando modelos residuales y prefijos anidados...', delay: isTest ? 10 : 800 });
    }
    if (phases.pools) {
      activeStages.push({ text: 'Comprobando jerarquía de pools y balanceo de carga...', delay: isTest ? 10 : 900 });
    }
    if (phases.console) {
      activeStages.push({ text: 'Comprobando integridad de consola y versiones en canal oficial...', delay: isTest ? 10 : 900 });
    }

    try {
      const apiPromise = scanSystemHealth();

      for (let i = 0; i < activeStages.length; i++) {
        const stage = activeStages[i];
        await new Promise((r) => setTimeout(r, stage.delay));
        const pct = Math.round(((i + 1) / activeStages.length) * 100);
        setScanProgress(pct);
        setScanStepText(`Fase ${i + 1}/${activeStages.length}: ${stage.text}`);
      }

      const res = await apiPromise;
      setScanProgress(100);
      setScanStepText('Diagnóstico completado exitosamente.');
      await new Promise((r) => setTimeout(r, 150));

      setScanResult(res);
      showFeedback('🔍 Diagnóstico de salud finalizado.');
    } catch (err) {
      showFeedback(`Error durante la auditoría: ${err.message}`, 'error');
    } finally {
      setIsScanning(false);
    }
  };

  const handleClean = async () => {
    if (!window.confirm('¿Confirmas que deseas ejecutar la limpieza? Se eliminarán los modelos ajenos y prefijos duplicados para restaurar las políticas estándar de cada proveedor. Tus cuentas y tokens no se borrarán.')) {
      return;
    }
    setIsCleaning(true);
    try {
      const res = await cleanSystemResidues();
      showFeedback(res.message || 'Limpieza ejecutada con éxito. Credenciales depuradas.');
      await handleScan();
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      showFeedback(`Error al limpiar: ${err.message}`, 'error');
    } finally {
      setIsCleaning(false);
    }
  };

  const handlePurgeOrphans = async (orphanFiles) => {
    if (!orphanFiles || orphanFiles.length === 0) return;
    if (!window.confirm(`¿Seguro que deseas eliminar ${orphanFiles.length} archivo(s) clon huérfano(s)? Se borrarán permanentemente del disco para restaurar el orden.`)) {
      return;
    }
    setIsPurgingOrphans(true);
    try {
      const results = await Promise.allSettled(orphanFiles.map((fn) => deleteAuthFile(fn)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        showFeedback(`Se purgaron algunos archivos pero fallaron ${failed.length}.`, 'error');
      } else {
        showFeedback(`🧹 Se eliminaron ${orphanFiles.length} archivo(s) huérfano(s) exitosamente.`);
      }
      await handleScan();
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      showFeedback(`Error al purgar huérfanos: ${err.message}`, 'error');
    } finally {
      setIsPurgingOrphans(false);
    }
  };

  const handleUpdateConsole = async () => {
    if (!window.confirm('¿Deseas actualizar el archivo management.html desde el canal oficial? Se creará una copia de seguridad automática antes de actualizar.')) {
      return;
    }
    setIsUpdating(true);
    try {
      const res = await updateManagementConsole();
      showFeedback(`🚀 ${res.message || 'CPAMC Console actualizado con éxito.'}`);
      await handleScan();
    } catch (err) {
      showFeedback(`Error al actualizar la consola: ${err.message}`, 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  const runSyncAudit = async () => {
    setIsSyncScanning(true);
    setSyncAudit(null);
    try {
      const [poolsRes, authFiles] = await Promise.all([listPools(), loadAuthFilesWithPrefixes()]);
      setSyncAudit(computeSyncAudit(poolsRes.pools || [], authFiles || []));
    } catch (err) {
      showFeedback(`Error durante la auditoría de sincronización: ${err.message}`, 'error');
    } finally {
      setIsSyncScanning(false);
    }
  };

  const handleRealignAll = async () => {
    if (!window.confirm('¿Confirmas la RE-ALINEACIÓN total de la plataforma? Se depurarán los residuos de modelos y se re-sincronizarán las políticas de Tuercas ⚙️, líderes de pool y catálogo /model. Las cuentas y tokens no se borran.')) {
      return;
    }
    setIsSyncScanning(true);
    try {
      const res = await cleanSystemResidues();
      showFeedback(res.message || '⚡ Re-Alineación ejecutada: Tuercas, pools y catálogo /model sincronizados.');
      await runSyncAudit();
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      showFeedback(`Error al re-alinear: ${err.message}`, 'error');
    } finally {
      setIsSyncScanning(false);
    }
  };

  // Identificación dinámica de todos los casos de incidentes
  const residualAccountsCount = scanResult?.residual_accounts?.length || 0;
  const orphanClonesCount = scanResult?.orphan_clones?.length || 0;
  const orphanArtifactsCount = scanResult?.orphan_artifacts?.length || 0;
  const orphanProvidersCount = scanResult?.orphan_providers?.length || 0;
  const poolsCount = scanResult?.active_pools_count ?? 0;
  const isZeroPools = scanResult && phases.pools && poolsCount === 0;
  const hasConsoleUpdate = Boolean(scanResult?.console_update_available);

  // Cantidad total de incidentes detectados
  const totalIncidents =
    (phases.models ? residualAccountsCount : 0) +
    (phases.auth ? orphanClonesCount : 0) +
    orphanArtifactsCount +
    orphanProvidersCount +
    (isZeroPools ? 1 : 0) +
    (phases.console && hasConsoleUpdate ? 1 : 0);

  return (
    <div className="maintenance-container" data-testid="maintenance-view">
      <div className="maintenance-header">
        <div className="maintenance-title-row">
          <span className="maintenance-icon">🩺</span>
          <h2 className="maintenance-title">Salud & Diagnóstico de la Plataforma</h2>
        </div>
        <p className="maintenance-desc">
          Centro de diagnóstico preventivo e integridad para CPAMC. Audita credenciales activas de cualquier proveedor, valida la consistencia de catálogos y prefijos de enrutamiento, y comprueba la disponibilidad de actualizaciones del sistema.
        </p>

        {/* Sub-pestañas: preservan la esencia visual; el diagnóstico clásico queda intacto en su pestaña */}
        <div className="maintenance-subtabs" data-testid="maintenance-subtabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'general'}
            className={`maintenance-subtab ${activeSubTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('general')}
            data-testid="subtab-general"
          >
            <span>🔍</span>
            <span>Diagnóstico General</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'sync'}
            className={`maintenance-subtab ${activeSubTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('sync')}
            data-testid="subtab-sync"
          >
            <span>⚙️</span>
            <span>Sincronización Tuerca & /model</span>
          </button>
        </div>
      </div>

      {feedback.text && (
        <div className={`feedback-banner feedback-${feedback.type}`}>
          {feedback.text}
        </div>
      )}

      {/* Layout Principal de 2 Columnas: Izquierda (Auditoría) vs Derecha (Acciones Dinámicas) */}
      {activeSubTab === 'general' && (
      <div className="maintenance-main-layout">
        {/* ================= COLUMNA IZQUIERDA: AUDITORÍA & ESTADO ================= */}
        <div className="maintenance-col-audit">
          {/* Selector de Fases */}
          <div className="maintenance-phase-selector" data-testid="maintenance-phase-selector">
            <div className="maintenance-phase-header">
              <div className="maintenance-phase-title">
                <span className="phase-title-badge">Paso 1</span>
                <span>Elige qué aspectos deseas auditar:</span>
              </div>
              <button
                type="button"
                className="maintenance-phase-toggle-all"
                onClick={toggleAllPhases}
                disabled={isScanning}
                data-testid="btn-toggle-all-phases"
              >
                {selectedCount > 0 ? '◻ Desmarcar Todos' : '☑ Marcar Todos (4/4)'}
              </button>
            </div>

            <div className="maintenance-phase-grid">
              {/* Módulo 1 */}
              <label className={`maintenance-phase-card ${phases.auth ? 'active' : ''}`}>
                <div className="phase-card-top">
                  <input
                    type="checkbox"
                    checked={phases.auth}
                    onChange={() => togglePhase('auth')}
                    disabled={isScanning}
                    data-testid="chk-phase-auth"
                  />
                  <span className="phase-card-name">🗂️ 1. Archivos Físicos de Credenciales</span>
                </div>
                <p className="phase-card-desc">
                  Inspecciona la totalidad de credenciales instaladas en el servidor, validando la integridad de archivos y detectando archivos corruptos o huérfanos.
                </p>
              </label>

              {/* Módulo 2 */}
              <label className={`maintenance-phase-card ${phases.models ? 'active' : ''}`}>
                <div className="phase-card-top">
                  <input
                    type="checkbox"
                    checked={phases.models}
                    onChange={() => togglePhase('models')}
                    disabled={isScanning}
                    data-testid="chk-phase-models"
                  />
                  <span className="phase-card-name">🏷️ 2. Filtros de Modelos y Prefijos</span>
                </div>
                <p className="phase-card-desc">
                  Audita las políticas de exclusión para depurar modelos ajenos de otros proveedores, prefijos duplicados o asignaciones inconsistentes.
                </p>
              </label>

              {/* Módulo 3 */}
              <label className={`maintenance-phase-card ${phases.pools ? 'active' : ''}`}>
                <div className="phase-card-top">
                  <input
                    type="checkbox"
                    checked={phases.pools}
                    onChange={() => togglePhase('pools')}
                    disabled={isScanning}
                    data-testid="chk-phase-pools"
                  />
                  <span className="phase-card-name">💎 3. Topología de Pools y Balanceo</span>
                </div>
                <p className="phase-card-desc">
                  Comprueba que los grupos de balanceo mantengan una jerarquía íntegra entre cuentas Líder y cuentas de Reserva asignadas.
                </p>
              </label>

              {/* Módulo 4 */}
              <div className={`maintenance-phase-card ${phases.console ? 'active' : ''}`}>
                <label className="phase-card-top" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={phases.console}
                    onChange={() => togglePhase('console')}
                    disabled={isScanning}
                    data-testid="chk-phase-console"
                  />
                  <span className="phase-card-name">🚀 4. Integridad de la Consola Web</span>
                </label>
                <p className="phase-card-desc">
                  Compara la versión instalada de tu consola de administración con la última versión oficial liberada en el canal de distribución.
                </p>
                <div
                  className="phase-card-auto-update"
                  style={{
                    marginTop: '10px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: '#cbd5e1',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={autoUpdateConsole}
                      onChange={handleToggleAutoUpdate}
                      data-testid="chk-auto-update-console"
                    />
                    <span>Actualizar automáticamente al iniciar</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleSyncSidebar}
                    className="btn-sync-sidebar"
                    data-testid="btn-sync-sidebar"
                    title="Fuerza a la consola nativa de CPAMC a recargar la barra lateral con el orden y nombres actuales"
                  >
                    <span>🔄</span>
                    <span>Sincronizar Menú Lateral CPAMC</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Barra de Progreso en Vivo */}
          {isScanning && (
            <div className="maintenance-progress-wrap" data-testid="scan-progress-wrap">
              <div className="maintenance-progress-header">
                <span className="maintenance-progress-step-text">⏳ {scanStepText}</span>
                <span className="maintenance-progress-pct">{scanProgress}%</span>
              </div>
              <div className="maintenance-progress-bar-bg">
                <div
                  className="maintenance-progress-bar-fill"
                  style={{ width: `${scanProgress}%` }}
                  data-testid="scan-progress-bar-fill"
                />
              </div>
            </div>
          )}

          {/* Botón Principal de Diagnóstico */}
          <div className="maintenance-scan-bar">
            <button
              type="button"
              className="btn-scan-main"
              onClick={handleScan}
              disabled={isScanning || isCleaning || isPurgingOrphans || selectedCount === 0}
              data-testid="btn-scan-health"
            >
              <span>{isScanning ? '⏳' : selectedCount === 0 ? '⚠️' : '🔍'}</span>
              <span>
                {isScanning
                  ? 'Auditoría en curso...'
                  : selectedCount === 0
                  ? 'Selecciona al menos 1 módulo arriba para comenzar'
                  : `Ejecutar Diagnóstico (${selectedCount} de 4 módulos seleccionados)`}
              </span>
            </button>
          </div>

          {/* Tarjetas KPI de Resumen de Salud (Inmediatamente debajo del diagnóstico) */}
          {scanResult && (
            <div className="maintenance-kpi-grid">
              {phases.auth && (() => {
                const hasOrphans = orphanClonesCount > 0;
                const hasFiles = (scanResult.total_auth_files ?? 0) > 0;
                const isAuthOk = hasFiles && !hasOrphans;
                return (
                  <div className="maintenance-kpi-card" data-testid="kpi-auth">
                    <div className="kpi-card-header-row">
                      <span className="maintenance-kpi-label">Credenciales Físicas</span>
                      <span
                        className={`kpi-status-badge ${isAuthOk ? 'status-ok' : hasOrphans ? 'status-warning' : 'status-danger'}`}
                        data-testid="status-badge-auth"
                      >
                        {isAuthOk ? '✅ OK / Válido' : hasOrphans ? `⚠️ ${orphanClonesCount} Huérfano(s)` : '❌ Sin Cuentas'}
                      </span>
                    </div>
                    <span className="maintenance-kpi-val">
                      <span>🗂️</span>
                      <span>{scanResult.total_auth_files ? `${scanResult.total_auth_files} Archivos` : '0 Archivos'}</span>
                    </span>
                    <span className="maintenance-kpi-sub">
                      {isAuthOk
                        ? 'Almacenamiento local íntegro'
                        : hasOrphans
                        ? `${orphanClonesCount} archivo(s) clonado(s) residual(es)`
                        : 'No se detectaron archivos de credenciales'}
                    </span>
                  </div>
                );
              })()}

              {phases.models && (() => {
                const isModelsOk = residualAccountsCount === 0;
                return (
                  <div className="maintenance-kpi-card" data-testid="kpi-models">
                    <div className="kpi-card-header-row">
                      <span className="maintenance-kpi-label">Políticas de Modelos</span>
                      <span
                        className={`kpi-status-badge ${isModelsOk ? 'status-ok' : 'status-warning'}`}
                        data-testid="status-badge-models"
                      >
                        {isModelsOk ? '✅ 100% Óptimo' : `⚠️ ${residualAccountsCount} Con Residuos`}
                      </span>
                    </div>
                    <span className="maintenance-kpi-val" style={{ color: isModelsOk ? '#34d399' : '#fbbf24' }}>
                      <span>{isModelsOk ? '✅' : '⚠️'}</span>
                      <span>{isModelsOk ? '100% Consistente' : `${residualAccountsCount} Cuenta(s)`}</span>
                    </span>
                    <span className="maintenance-kpi-sub">
                      {isModelsOk
                        ? 'Filtros estándar por proveedor'
                        : `${residualAccountsCount} cuenta(s) con modelos ajenos o prefijos anidados`}
                    </span>
                  </div>
                );
              })()}

              {phases.pools && (() => {
                const isPoolsOk = poolsCount > 0;
                return (
                  <div className="maintenance-kpi-card" data-testid="kpi-pools">
                    <div className="kpi-card-header-row">
                      <span className="maintenance-kpi-label">Topología de Pools</span>
                      <span
                        className={`kpi-status-badge ${isPoolsOk ? 'status-ok' : 'status-info'}`}
                        data-testid="status-badge-pools"
                      >
                        {isPoolsOk ? '✅ Activo / OK' : 'ℹ️ Sin Pools'}
                      </span>
                    </div>
                    <span className="maintenance-kpi-val" style={{ color: isPoolsOk ? '#38bdf8' : '#94a3b8' }}>
                      <span>💎</span>
                      <span>{poolsCount} Pools Activos</span>
                    </span>
                    <span className="maintenance-kpi-sub">
                      {isPoolsOk
                        ? 'Balanceador y reservas operativas'
                        : 'Configura pools en Crear Group/Perfiles'}
                    </span>
                  </div>
                );
              })()}

              {phases.console && (() => {
                const localVer = scanResult.console_version_local || 'v1.26.1';
                const remoteVer = scanResult.console_latest_github || 'v1.26.1';
                return (
                  <div className="maintenance-kpi-card" data-testid="kpi-console">
                    <div className="kpi-card-header-row">
                      <span className="maintenance-kpi-label">Consola de Gestión</span>
                      <span
                        className={`kpi-status-badge ${hasConsoleUpdate ? 'status-warning' : 'status-ok'}`}
                        data-testid="status-badge-console"
                      >
                        {hasConsoleUpdate ? '🚀 Nueva Versión' : '✅ Al Día (Oficial)'}
                      </span>
                    </div>
                    <span className="maintenance-kpi-val" style={{ color: hasConsoleUpdate ? '#fbbf24' : '#c084fc' }}>
                      <span>{hasConsoleUpdate ? '⚡' : '🚀'}</span>
                      <span>
                        {hasConsoleUpdate
                          ? `${localVer} ➔ ${remoteVer}`
                          : localVer}
                      </span>
                    </span>
                    <span className="maintenance-kpi-sub">
                      {hasConsoleUpdate
                        ? `Instalada: ${localVer} | Disponible: ${remoteVer}`
                        : `Versión instalada (${localVer}) coincide con canal oficial`}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* ================= COLUMNA DERECHA: CENTRO DINÁMICO DE ACCIONES Y RESOLUCIÓN ================= */}
        <div className="maintenance-col-actions">
          <div className="maintenance-card resolution-center-card" data-testid="resolution-center">
            <div className="resolution-center-header">
              <div className="resolution-title-group">
                <span className="resolution-icon">🛠️</span>
                <div>
                  <h3 className="maintenance-card-title" style={{ margin: 0 }}>
                    Centro Dinámico de Acciones y Resolución
                  </h3>
                  <span className="resolution-subtitle">
                    Respuestas operativas contextuales según los resultados de la auditoría
                  </span>
                </div>
              </div>
              {scanResult && (
                <span className={`resolution-badge ${totalIncidents > 0 ? 'badge-incidents' : 'badge-healthy'}`}>
                  {totalIncidents > 0 ? `⚠️ ${totalIncidents} Tarea(s) Pendiente(s)` : '✅ Sistema Íntegro'}
                </span>
              )}
            </div>

            {/* CASO 1: AÚN NO SE HA AUDITADO */}
            {!scanResult && (
              <div className="resolution-empty-state" data-testid="resolution-initial">
                <div className="empty-state-icon">ℹ️</div>
                <h4 className="empty-state-title">Esperando Diagnóstico</h4>
                <p className="empty-state-desc">
                  Ejecuta la auditoría en la columna izquierda para inspeccionar las credenciales, filtros, pools y componentes de la plataforma. Si se detecta cualquier anomalía, aquí aparecerán las opciones de reparación directa con un clic.
                </p>
                <div className="empty-state-status-pill">
                  <span>Modo Espera</span> — Ninguna acción requerida por ahora
                </div>
              </div>
            )}

            {/* CASO 2: AUDITORÍA COMPLETADA Y TODO ESTÁ 100% SALUDABLE */}
            {scanResult && totalIncidents === 0 && (
              <div className="resolution-healthy-state" data-testid="resolution-all-healthy">
                <div className="healthy-state-banner">
                  <span className="healthy-icon">✅</span>
                  <div>
                    <h4 className="healthy-title">Todos los Módulos Auditados en Estado Óptimo</h4>
                    <p className="healthy-desc">
                      La infraestructura se encuentra en cumplimiento de los estándares: las credenciales están limpias, no hay archivos residuales huérfanos, la topología de pools es consistente y la consola se encuentra al día.
                    </p>
                  </div>
                </div>

                <div className="healthy-details-box">
                  <div className="healthy-detail-item">
                    <span>🗂️ Credenciales:</span>
                    <strong>{scanResult.total_auth_files ?? 0} Archivos Válidos (0 clones residuales)</strong>
                  </div>
                  <div className="healthy-detail-item">
                    <span>🏷️ Políticas de Modelos:</span>
                    <strong>Estándar por proveedor (0 exclusiones ajenas)</strong>
                  </div>
                  <div className="healthy-detail-item">
                    <span>💎 Balanceador:</span>
                    <strong>{poolsCount} Pools Activos en servicio</strong>
                  </div>
                  <div className="healthy-detail-item">
                    <span>🚀 Consola:</span>
                    <strong>Sincronizada con el canal oficial</strong>
                  </div>
                  <div className="healthy-detail-item">
                    <span>⚙️ Artefactos de Código:</span>
                    <strong>Código fuente limpio (0 archivos huérfanos fuera de bin/)</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-healthy-standby"
                  disabled={true}
                  data-testid="btn-clean-residuals"
                >
                  <span>✅</span>
                  <span>Sistema Óptimo — No se requiere ninguna acción correctiva</span>
                </button>
              </div>
            )}

            {/* CASO 3: SE DETECTARON INCIDENTES (RESOLUCIÓN REACTIVA Y DINÁMICA POR CASO) */}
            {scanResult && totalIncidents > 0 && (
              <div className="resolution-incidents-list" data-testid="resolution-incidents-active">
                <p className="incidents-intro">
                  Se detectaron los siguientes puntos que requieren intervención. Puedes resolver cada uno individualmente:
                </p>

                {/* CASO 3.1: Modelos residuales o prefijos duplicados */}
                {residualAccountsCount > 0 && (
                  <div className="incident-card" data-testid="incident-models">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">🏷️</span>
                        <div>
                          <strong className="incident-name">Residuos en Listas de Modelos de Cuentas</strong>
                          <span className="incident-meta">{residualAccountsCount} cuenta(s) afectadas</span>
                        </div>
                      </div>
                      <span className="tag-warning">Requiere Depuración</span>
                    </div>
                    <p className="incident-desc">
                      Se detectaron nombres de modelos ajenos de otros proveedores o prefijos anidados repetidos (<code>agy/agy/...</code>).
                    </p>

                    <div className="incident-sample-table-wrap">
                      <table className="results-table">
                        <thead>
                          <tr>
                            <th>Archivo de Cuenta</th>
                            <th>Modelos a Limpiar</th>
                            <th>Muestra Detectada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanResult.residual_accounts.map((acc) => (
                            <tr key={acc.file_name}>
                              <td style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{acc.file_name}</td>
                              <td>
                                <span className="badge-residual-count">{acc.foreign_excluded} modelos</span>
                              </td>
                              <td style={{ fontSize: 11, color: '#94a3b8' }}>
                                {acc.foreign_sample?.slice(0, 2).join(', ')}...
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <button
                      type="button"
                      className="btn-clean"
                      onClick={handleClean}
                      disabled={isCleaning}
                      data-testid="btn-clean-residuals"
                    >
                      <span>{isCleaning ? '⏳' : '✨'}</span>
                      <span>
                        {isCleaning
                          ? 'Depurando cuentas...'
                          : `Depurar y Restaurar ${residualAccountsCount} Cuenta(s)`}
                      </span>
                    </button>
                  </div>
                )}

                {/* CASO 3.2: Clones residuales o huérfanos en disco */}
                {orphanClonesCount > 0 && (
                  <div className="incident-card" data-testid="incident-orphans">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">🗂️</span>
                        <div>
                          <strong className="incident-name">Archivos Residuales Huérfanos en Servidor</strong>
                          <span className="incident-meta">{orphanClonesCount} archivo(s) sin asociar</span>
                        </div>
                      </div>
                      <span className="tag-warning">Limpieza de Disco</span>
                    </div>
                    <p className="incident-desc">
                      Existen archivos clonados o desvinculados en el servidor que no pertenecen a ningún pool activo y generan duplicados.
                    </p>
                    <button
                      type="button"
                      className="btn-clean"
                      style={{ background: 'rgba(239, 68, 68, 0.18)', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#f87171' }}
                      onClick={() => handlePurgeOrphans(scanResult.orphan_clones)}
                      disabled={isPurgingOrphans}
                      data-testid="btn-purge-orphans"
                    >
                      <span>{isPurgingOrphans ? '⏳' : '🗑️'}</span>
                      <span>
                        {isPurgingOrphans
                          ? 'Eliminando archivos...'
                          : `Purgar ${orphanClonesCount} Archivo(s) Huérfano(s)`}
                      </span>
                    </button>
                  </div>
                )}

                {/* CASO 3.3: Artefactos de compilación huérfanos fuera de bin/ */}
                {orphanArtifactsCount > 0 && (
                  <div className="incident-card" data-testid="incident-orphan-artifacts">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">⚙️</span>
                        <div>
                          <strong className="incident-name">Artefactos de Compilación Huérfanos</strong>
                          <span className="incident-meta">{orphanArtifactsCount} archivo(s) fuera de bin/</span>
                        </div>
                      </div>
                      <span className="tag-warning">Limpieza de Código Fuente</span>
                    </div>
                    <p className="incident-desc">
                      Se detectaron archivos de cabecera (.h) o bibliotecas (.so) generados en carpetas de código fuente. Estos artefactos deben residir únicamente en <code>bin/</code>.
                    </p>
                    <div className="incident-sample-table-wrap">
                      <table className="results-table">
                        <thead>
                          <tr>
                            <th>Archivo Huérfano Detectado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanResult.orphan_artifacts.map((art) => (
                            <tr key={art}>
                              <td style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{art}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      className="btn-clean"
                      onClick={handleClean}
                      disabled={isCleaning}
                      data-testid="btn-clean-orphan-artifacts"
                    >
                      <span>{isCleaning ? '⏳' : '✨'}</span>
                      <span>
                        {isCleaning
                          ? 'Purgando artefactos...'
                          : `Limpiar ${orphanArtifactsCount} Artefacto(s) Huérfano(s)`}
                      </span>
                    </button>
                  </div>
                )}

                {/* CASO 3.3.B: Proveedores huérfanos en config.yaml (universal y dinámico) */}
                {orphanProvidersCount > 0 && (
                  <div className="incident-card" data-testid="incident-orphan-providers">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">🔌</span>
                        <div>
                          <strong className="incident-name">Proveedores Huérfanos en config.yaml</strong>
                          <span className="incident-meta">{orphanProvidersCount} proveedor(es) inflando el catálogo</span>
                        </div>
                      </div>
                      <span className="tag-warning">Configuración Residual</span>
                    </div>
                    <p className="incident-desc">
                      Se detectaron proveedores declarados en <code>config.yaml</code> que no tienen cuentas de autenticación en disco ni plugins activos. Estos registros inflan innecesariamente el catálogo global de modelos de CPAMC.
                    </p>
                    <div className="incident-sample-table-wrap">
                      <table className="results-table">
                        <thead>
                          <tr>
                            <th>Proveedor</th>
                            <th>Prefijo</th>
                            <th>Modelos Declarados</th>
                            <th>Diagnóstico</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanResult.orphan_providers.map((p) => (
                            <tr key={p.name}>
                              <td style={{ fontWeight: 600, color: '#f8fafc' }}>{p.name}</td>
                              <td>
                                <code style={{ color: '#38bdf8' }}>{p.prefix ? `${p.prefix}/` : '(sin prefijo)'}</code>
                              </td>
                              <td>{p.models_count} modelo(s)</td>
                              <td style={{ color: '#f59e0b', fontSize: '0.85rem' }}>{p.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      className="btn-clean"
                      onClick={handleClean}
                      disabled={isCleaning}
                      data-testid="btn-clean-orphan-providers"
                    >
                      <span>{isCleaning ? '⏳' : '✨'}</span>
                      <span>
                        {isCleaning
                          ? 'Purgando proveedores huérfanos...'
                          : `Purgar ${orphanProvidersCount} Proveedor(es) de config.yaml`}
                      </span>
                    </button>
                  </div>
                )}

                {/* CASO 3.3: No hay pools creados */}
                {isZeroPools && (
                  <div className="incident-card" data-testid="incident-pools">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">💎</span>
                        <div>
                          <strong className="incident-name">Sin Pools de Balanceo Configurados</strong>
                          <span className="incident-meta">Topología vacía</span>
                        </div>
                      </div>
                      <span className="tag-info">Recomendación</span>
                    </div>
                    <p className="incident-desc">
                      No se encontraron pools de líderes y reservas en el sistema. Para aprovechar el balanceo de carga automático, dirígete al generador.
                    </p>
                  </div>
                )}

                {/* CASO 3.4: Actualización de consola disponible */}
                {phases.console && hasConsoleUpdate && (
                  <div className="incident-card" data-testid="incident-console">
                    <div className="incident-card-head">
                      <div className="incident-title-row">
                        <span className="incident-icon">🚀</span>
                        <div>
                          <strong className="incident-name">Actualización Oficial Disponible</strong>
                          <span className="incident-meta">
                            Instalada: {scanResult.console_version_local || 'desconocida'} ➔ Nueva: {scanResult.console_latest_github}
                          </span>
                        </div>
                      </div>
                      <span className="tag-warning">Nueva Versión</span>
                    </div>
                    <p className="incident-desc">
                      Hay una versión más reciente de la consola oficial en GitHub. Puedes sincronizarla de forma segura con respaldo automático y rollback.
                    </p>
                    <div className="version-compare-badge-row" data-testid="version-compare-row">
                      <div className="version-badge-box">
                        <span className="version-badge-label">Versión Instalada</span>
                        <span className="version-badge-val current" data-testid="console-current-version">
                          {scanResult.console_version_local || 'Desconocida'}
                        </span>
                      </div>
                      <span className="version-badge-arrow">➔</span>
                      <div className="version-badge-box">
                        <span className="version-badge-label">Nueva en GitHub</span>
                        <span className="version-badge-val target" data-testid="console-target-version">
                          {scanResult.console_latest_github}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-update"
                      onClick={handleUpdateConsole}
                      disabled={isUpdating}
                      data-testid="btn-update-console"
                    >
                      <span>{isUpdating ? '⏳' : '🔄'}</span>
                      <span>{isUpdating ? 'Actualizando...' : `Actualizar a ${scanResult.console_latest_github}`}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ================= SUB-PESTAÑA 2: SINCRONIZACIÓN TUERCA ⚙️ & /MODEL ================= */}
      {activeSubTab === 'sync' && (
      <div className="maintenance-main-layout" data-testid="sync-view">
        {/* COLUMNA IZQUIERDA: PILARES DINÁMICOS */}
        <div className="maintenance-col-audit">
          <div className="maintenance-phase-selector" data-testid="sync-audit-panel">
            <div className="maintenance-phase-header">
              <div className="maintenance-phase-title">
                <span className="phase-title-badge">Sincronización</span>
                <span>⚙️ Tuerca · Líderes por Familia · Catálogo /model</span>
              </div>
            </div>
            <p className="maintenance-desc" style={{ marginBottom: '12px' }}>
              Auditoría dinámica y universal: valida las Tuercas ⚙️ (Especialista 🔒 vs Multipropósito 🔓) de todas las
              cuentas, la elección del Líder Virtual Activo por familia y la proyección exacta que debe recibir el
              selector /model de Pi. Funciona con cualquier proveedor, familia o número de cuentas (N → 100+).
            </p>
            <button
              type="button"
              className="btn-scan-main"
              onClick={runSyncAudit}
              disabled={isSyncScanning}
              data-testid="btn-sync-audit"
            >
              <span>{isSyncScanning ? '⏳' : '🧬'}</span>
              <span>{isSyncScanning ? 'Auditando sincronización...' : 'Ejecutar Auditoría de Sincronización'}</span>
            </button>
          </div>

          {syncAudit && (
            <>
              {/* PILAR 1: TUERCA ⚙️ UNIVERSAL */}
              <div className="sync-pillar-card" data-testid="pillar-tuerca">
                <div className="sync-pillar-header">
                  <span className="sync-pillar-icon">⚙️</span>
                  <div>
                    <strong className="sync-pillar-title">Pilar 1 — Tuerca ⚙️ Universal (Especialista vs Multipropósito)</strong>
                    <span className="sync-pillar-sub">
                      {syncAudit.tuercaSummary.total} familia(s) evaluada(s):{' '}
                      {syncAudit.tuercaSummary.specialist} especialista(s) · {syncAudit.tuercaSummary.multipurpose} multipropósito(s)
                      {syncAudit.tuercaSummary.partial > 0 ? ` · ${syncAudit.tuercaSummary.partial} limitada(s)` : ''}
                      {syncAudit.tuercaSummary.inconsistent > 0 ? ` · ${syncAudit.tuercaSummary.inconsistent} inconsistente(s)` : ''}
                    </span>
                  </div>
                  <span
                    className={`kpi-status-badge ${syncAudit.tuercaSummary.inconsistent > 0 ? 'status-danger' : 'status-ok'}`}
                  >
                    {syncAudit.tuercaSummary.inconsistent > 0 ? '🔴 Desalineado' : '🟢 Alineado'}
                  </span>
                </div>
                <div className="incident-sample-table-wrap">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Familia</th>
                        <th>Líder Electo</th>
                        <th>Tuerca ⚙️</th>
                        <th>Permitidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncAudit.families.map((f) => (
                        <tr key={f.family}>
                          <td style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{f.family}</td>
                          <td style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{f.elected.base_prefix}</td>
                          <td>
                            <span className={`sync-mode-badge mode-${f.tuercaMode}`}>
                              {f.tuercaMode === 'specialist' && '🔒 Especialista (1 modelo)'}
                              {f.tuercaMode === 'multipurpose' && '🔓 Multipropósito (todos)'}
                              {f.tuercaMode === 'partial' && `🔒 Limitado (${f.allowed.length} de ${f.catalogSize})`}
                              {f.tuercaMode === 'inconsistent' && '🔴 Inconsistente (0 permitidos)'}
                            </span>
                          </td>
                          <td style={{ color: '#94a3b8' }}>
                            {f.wildcard ? 'Wildcard (catálogo nativo)' : `${f.allowed.length} / ${f.catalogSize}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PILAR 2: LÍDERES VIRTUALES POR FAMILIA */}
              <div className="sync-pillar-card" data-testid="pillar-leaders">
                <div className="sync-pillar-header">
                  <span className="sync-pillar-icon">🔀</span>
                  <div>
                    <strong className="sync-pillar-title">Pilar 2 — Líder Virtual Activo por Familia</strong>
                    <span className="sync-pillar-sub">
                      Elección determinista (prefijo canónico más corto, luego alfabético). Los pools sombreados
                      rotan como reservas bajo Auto Switcher Pro sin exponer rutas duplicadas.
                    </span>
                  </div>
                  <span className="kpi-status-badge status-ok">🟢 Electo</span>
                </div>
                <div className="incident-sample-table-wrap">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Familia</th>
                        <th>Líder (ruta expuesta)</th>
                        <th>Cuenta Líder</th>
                        <th>Pools Sombreados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncAudit.families.map((f) => (
                        <tr key={f.family}>
                          <td style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{f.family}</td>
                          <td style={{ fontFamily: 'monospace', color: '#38bdf8' }}>⭐ {f.elected.base_prefix}</td>
                          <td style={{ fontSize: 11, color: '#94a3b8' }}>{f.elected.leader_email || f.elected.leader_auth || '—'}</td>
                          <td>
                            {f.shadowed.length > 0 ? (
                              <span className="sync-chip">{f.shadowed.join(', ')}</span>
                            ) : (
                              <span style={{ color: '#64748b' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PILAR 3: WATCHDOG /MODEL */}
              <div className="sync-pillar-card" data-testid="pillar-watchdog">
                <div className="sync-pillar-header">
                  <span className="sync-pillar-icon">🎯</span>
                  <div>
                    <strong className="sync-pillar-title">Pilar 3 — Watchdog del Selector /model en Pi</strong>
                    <span className="sync-pillar-sub">
                      Proyección esperada: solo los modelos permitidos por la Tuerca ⚙️ del líder electo de cada familia.
                      Cero reservas, cero duplicados, cero modelos bloqueados.
                    </span>
                  </div>
                  <span
                    className={`kpi-status-badge ${syncAudit.expectedModels.length === 0 ? 'status-warning' : 'status-ok'}`}
                  >
                    {syncAudit.expectedModels.length === 0 ? '⚠️ Sin Proyección' : '🟢 Proyección Limpia'}
                  </span>
                </div>
                <div className="sync-chips-row">
                  <span className="sync-projected-count" data-testid="sync-projected-count">
                    {syncAudit.expectedModels.length} modelo(s) esperado(s) en /model:
                  </span>
                  {syncAudit.expectedModels.map((m) => (
                    <span key={m} className="sync-chip sync-chip-model" style={{ fontFamily: 'monospace' }}>
                      ⭐ {m}
                    </span>
                  ))}
                  {syncAudit.expectedModels.length === 0 && (
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                      Ninguna familia proyecta modelos: revisa las Tuercas ⚙️ inconsistentes o los target_models de los pools.
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* COLUMNA DERECHA: CENTRO DE SINCRONIZACIÓN */}
        <div className="maintenance-col-actions">
          <div className="maintenance-card resolution-center-card" data-testid="sync-resolution-center">
            <div className="resolution-center-header">
              <div className="resolution-title-group">
                <span className="resolution-icon">⚡</span>
                <div>
                  <h3 className="maintenance-card-title" style={{ margin: 0 }}>
                    Centro de Re-Alineación Universal
                  </h3>
                  <span className="resolution-subtitle">
                    Re-sincroniza atómicamente Tuercas ⚙️, líderes de pool y catálogo /model
                  </span>
                </div>
              </div>
              {syncAudit && (
                <span
                  className={`resolution-badge ${syncAudit.tuercaSummary.inconsistent > 0 ? 'badge-incidents' : 'badge-healthy'}`}
                >
                  {syncAudit.tuercaSummary.inconsistent > 0
                    ? `⚠️ ${syncAudit.tuercaSummary.inconsistent} Desalineación(es)`
                    : '✅ Plataforma Alineada'}
                </span>
              )}
            </div>

            {!syncAudit && (
              <div className="resolution-empty-state" data-testid="sync-initial">
                <div className="empty-state-icon">ℹ️</div>
                <h4 className="empty-state-title">Esperando Auditoría de Sincronización</h4>
                <p className="empty-state-desc">
                  Ejecuta la auditoría de sincronización para validar los 4 Pilares Dinámicos. Si se detecta cualquier
                  desalineación entre Tuercas ⚙️, pools y el catálogo de Pi, aquí aparecerá la acción de reparación con un clic.
                </p>
                <div className="empty-state-status-pill">
                  <span>Modo Espera</span> — Ninguna acción requerida por ahora
                </div>
              </div>
            )}

            {syncAudit && syncAudit.tuercaSummary.inconsistent === 0 && (
              <div className="resolution-healthy-state" data-testid="sync-healthy">
                <div className="healthy-state-banner">
                  <span className="healthy-icon">✅</span>
                  <div>
                    <h4 className="healthy-title">Tuerca ⚙️, Líderes y /model 100% Sincronizados</h4>
                    <p className="healthy-desc">
                      Cada familia expone exactamente su Líder Virtual Activo con los modelos permitidos por su Tuerca ⚙️.
                      El selector de Pi recibe una proyección limpia sin duplicados ni fugas.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-healthy-standby"
                  disabled={true}
                  data-testid="btn-sync-standby"
                >
                  <span>✅</span>
                  <span>Plataforma Alineada — No se requiere ninguna acción correctiva</span>
                </button>
              </div>
            )}

            {syncAudit && syncAudit.tuercaSummary.inconsistent > 0 && (
              <div className="resolution-incidents-list" data-testid="sync-incidents">
                <p className="incidents-intro">
                  Hay {syncAudit.tuercaSummary.inconsistent} familia(s) con Tuerca ⚙️ inconsistente (0 modelos permitidos).
                  Ejecuta la Re-Alineación para depurar residuos y restaurar la coherencia entre disco, pools y /model.
                </p>
                <button
                  type="button"
                  className="btn-clean"
                  onClick={handleRealignAll}
                  disabled={isSyncScanning}
                  data-testid="btn-realign-all"
                >
                  <span>{isSyncScanning ? '⏳' : '⚡'}</span>
                  <span>{isSyncScanning ? 'Re-Alineando plataforma...' : '⚡ Re-Alinear Tuercas, Pools y Catálogo de Pi (1 Clic)'}</span>
                </button>
              </div>
            )}

            {syncAudit && syncAudit.tuercaSummary.inconsistent === 0 && syncAudit.tuercaSummary.total > 0 && (
              <div className="healthy-details-box" style={{ marginTop: '14px' }}>
                <div className="healthy-detail-item">
                  <span>⚙️ Tuercas:</span>
                  <strong>{syncAudit.tuercaSummary.specialist} Especialista(s) · {syncAudit.tuercaSummary.multipurpose} Multipropósito(s)</strong>
                </div>
                <div className="healthy-detail-item">
                  <span>🎯 /model esperado:</span>
                  <strong>{syncAudit.expectedModels.length} modelo(s) consolidado(s), 0 duplicados</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
