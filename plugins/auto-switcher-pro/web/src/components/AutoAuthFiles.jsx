import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  classifyAuthAccount,
  deleteAuthFile,
  maskDisplayIdentifier,
  buildManagedPoolCards,
  resolveInheritedCardModels,
  detectSpecialistState,
  listModels,
  listPools,
  savePool,
  patchAuthFileExclusions,
  fetchCardQuota,
  computeAccountTelemetry,
  classifyCooldowns,
  formatRemainingDuration,
  CANONICAL_PROVIDER_MODELS,
  sortPoolsByNumber,
} from '../api/managementClient';
import SpecialistModal from './SpecialistModal';
import QuotaClock from './QuotaClock';
import './AutoAuthFiles.css';

// Computes deterministic pool group colors: unassigned cards stay neutral (no color glow),
// while assigned cards inherit the exclusive theme color of their pool group.
const getPoolGroupStyle = (assignedPrefix) => {
  if (!assignedPrefix || assignedPrefix.startsWith('unlinked_')) {
    return {
      className: 'badge-provider unassigned',
      primary: '#64748b',
      bg: 'rgba(51, 65, 85, 0.3)',
      border: 'rgba(100, 116, 139, 0.5)',
      color: '#94a3b8',
      style: {
        background: 'rgba(51, 65, 85, 0.3)',
        border: '1px dashed rgba(100, 116, 139, 0.5)',
        color: '#94a3b8',
      },
      cardStyle: {
        borderTop: '1px solid rgba(51, 65, 85, 0.6)',
        borderColor: 'rgba(51, 65, 85, 0.6)',
      },
      statusBadgeStyle: {
        background: 'rgba(51, 65, 85, 0.3)',
        border: '1px solid rgba(71, 85, 105, 0.5)',
        color: '#94a3b8',
      },
    };
  }

  const match = assignedPrefix.match(/^(.*)_(\d+)$/);
  const poolBase = match ? match[1] : assignedPrefix;

  const poolColors = {
    agy: { primary: '#38bdf8', bg: 'rgba(56, 189, 248, 0.18)', border: 'rgba(56, 189, 248, 0.5)', color: '#7dd3fc' },
    agy2: { primary: '#a855f7', bg: 'rgba(168, 85, 247, 0.18)', border: 'rgba(168, 85, 247, 0.5)', color: '#e9d5ff' },
    agy_son: { primary: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)', border: 'rgba(245, 158, 11, 0.5)', color: '#fef08a' },
    agy_opus: { primary: '#ec4899', bg: 'rgba(236, 72, 153, 0.18)', border: 'rgba(236, 72, 153, 0.5)', color: '#fbcfe8' },
    agy_clau: { primary: '#10b981', bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.5)', color: '#6ee7b7' },
    clau: { primary: '#10b981', bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.5)', color: '#67e8f9' },
    codex: { primary: '#6366f1', bg: 'rgba(99, 102, 241, 0.18)', border: 'rgba(99, 102, 241, 0.5)', color: '#c7d2fe' },
  };

  const scheme = poolColors[poolBase] || {
    primary: '#818cf8',
    bg: 'rgba(129, 140, 248, 0.18)',
    border: 'rgba(129, 140, 248, 0.5)',
    color: '#c7d2fe',
  };

  return {
    className: 'badge-provider assigned-group',
    primary: scheme.primary,
    bg: scheme.bg,
    border: scheme.border,
    color: scheme.color,
    style: {
      background: scheme.bg,
      border: `1px solid ${scheme.border}`,
      color: scheme.color,
      fontWeight: '700',
    },
    cardStyle: {
      borderTop: `3px solid ${scheme.primary}`,
      borderColor: scheme.border,
    },
    statusBadgeStyle: {
      background: scheme.bg,
      border: `1px solid ${scheme.border}`,
      color: scheme.color,
      fontWeight: '700',
    },
  };
};

/**
 * AutoAuthFiles Component
 *
 * Dedicated control view establishing architectural separation between physical OAuth
 * master accounts and derived virtual pool cards (scalable N -> 2N managed card model).
 * Provides origin traceability, model exclusion indicators, individual card dissolution,
 * batch orphan purging, single-model specialist gear configuration (⚙️), hero active
 * model banner, and homologated quota telemetry (Plan Pro, Gemini & Claude limits).
 */
export default function AutoAuthFiles({
  nodes = [],
  catalogModels = [],
  initialQuotas = {},
  onReloadRequested,
  registeredPools: propPools,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [fetchedCatalog, setFetchedCatalog] = useState([]);
  const [quotasMap, setQuotasMap] = useState(initialQuotas || {});
  const [refreshingQuotaKeys, setRefreshingQuotaKeys] = useState(new Set());
  const [loadingQuotaKeys, setLoadingQuotaKeys] = useState(new Set());
  const [specialistModal, setSpecialistModal] = useState({
    isOpen: false,
    card: null,
    inheritedModels: [],
  });
  // Pools registrados en el plugin PoolRegistry (auto-switcher-pro-state.json)
  const [registeredPools, setRegisteredPools] = useState(
    propPools ? sortPoolsByNumber(propPools) : []
  );
  // Guard so live quota is auto-fetched once per physical master per mount cycle
  const autoFetchedMastersRef = useRef(new Set(initialQuotas ? Object.keys(initialQuotas) : []));
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync initialQuotas if prop updates and mark keys as fetched to avoid N+1 requests
  useEffect(() => {
    if (initialQuotas && Object.keys(initialQuotas).length > 0) {
      setQuotasMap((prev) => ({ ...prev, ...initialQuotas }));
      Object.keys(initialQuotas).forEach((k) => autoFetchedMastersRef.current.add(k));
    }
  }, [initialQuotas]);

  // [registeredPools] Sincroniza el PoolRegistry del plugin (fuente única de verdad).
  // Si propPools viene suministrado, lo usa directamente para evitar llamadas N+1 duplicadas.
  useEffect(() => {
    if (Array.isArray(propPools) && propPools.length > 0) {
      setRegisteredPools(sortPoolsByNumber(propPools));
      return;
    }
    let cancelled = false;
    listPools()
      .then((res) => {
        if (!cancelled) setRegisteredPools(sortPoolsByNumber(Array.isArray(res?.pools) ? res.pools : []));
      })
      .catch(() => {
        // Registro no disponible (sin key / plugin cargando): estrictamente 0 tarjetas
        if (!cancelled) setRegisteredPools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [nodes, propPools]);

  // Load catalog models via GET /v1/models if not passed via props
  useEffect(() => {
    if (Array.isArray(catalogModels) && catalogModels.length > 0) return;
    let mounted = true;
    listModels()
      .then((res) => {
        if (mounted && Array.isArray(res?.models) && res.models.length > 0) {
          setFetchedCatalog(res.models);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [catalogModels]);

  const effectiveCatalogModels = useMemo(() => {
    if (Array.isArray(catalogModels) && catalogModels.length > 0) return catalogModels;
    const fetched = Array.isArray(fetchedCatalog) && fetchedCatalog.length > 0 ? fetchedCatalog : [];
    const canonicalList = [
      ...CANONICAL_PROVIDER_MODELS.gemini,
      ...CANONICAL_PROVIDER_MODELS.claude,
      ...CANONICAL_PROVIDER_MODELS.codex,
    ];
    return Array.from(new Set([...canonicalList, ...fetched]));
  }, [catalogModels, fetchedCatalog]);

  const handleOpenSpecialist = useCallback(
    (targetCard) => {
      const inherited = resolveInheritedCardModels(targetCard, effectiveCatalogModels);
      const isUnassigned = !targetCard?.poolId && !targetCard?.activePoolBase;
      setSpecialistModal({
        isOpen: true,
        card: {
          ...targetCard,
          isUnassigned,
        },
        inheritedModels: inherited,
      });
    },
    [effectiveCatalogModels]
  );

  const handlePatchSpecialist = useCallback(
    async (targetFileName, exclusionsToSave, selectedModel) => {
      const currentCard = specialistModal.card;
      // Gobernanza 100% Virtual e Independencia Per-Cuenta:
      // Si la tarjeta pertenece a un pool registrado, actualizamos ÚNICAMENTE el modelo
      // especialista de esta cuenta física en member_models[targetFile], sin alterar
      // la política general del pool ni forzar a las demás tarjetas miembros.
      if (currentCard?.poolId || currentCard?.activePoolBase) {
        const targetPoolId = currentCard.poolId;
        const targetBase = currentCard.activePoolBase;
        const targetPool = registeredPools.find(
          (p) => p.id === targetPoolId || p.base_prefix === targetBase
        );
        if (targetPool) {
          const authKey = currentCard.masterFileName || targetFileName;
          const updatedMemberModels = {
            ...(targetPool.member_models || {}),
          };
          if (authKey && selectedModel) {
            updatedMemberModels[authKey] = selectedModel;
          }
          const updatedPool = {
            ...targetPool,
            policy: {
              ...(targetPool.policy || {}),
              disable_isolation: false,
              // Preservar target_models existente como fallback de familia,
              // o inicializarlo si estaba vacío.
              target_models:
                Array.isArray(targetPool.policy?.target_models) && targetPool.policy.target_models.length > 0
                  ? targetPool.policy.target_models
                  : (selectedModel ? [selectedModel] : []),
              excluded_models: [],
            },
            member_models: updatedMemberModels,
          };
          await savePool(updatedPool);
          // Refrescar la lista de pools localmente
          const poolsRes = await listPools();
          if (Array.isArray(poolsRes?.pools)) {
            setRegisteredPools(poolsRes.pools);
          }
          return { ok: true, name: targetFileName };
        }
      }
      // Salvaguarda Arquitectónica (Gobernanza Virtual Pura - Mandamiento III):
      // NUNCA inyectar listas masivas de exclusión en archivos físicos .json de cuentas libres.
      // Las credenciales físicas en disco deben preservar excluded_models: [] de fábrica
      // para que CPAMC nativo no mutile el catálogo en Auth Files Management.
      // Si la acción es restaurar/purgar (exclusionsToSave vacío []), permitimos sanear el disco.
      if (Array.isArray(exclusionsToSave) && exclusionsToSave.length === 0) {
        return await patchAuthFileExclusions(targetFileName, []);
      }
      return {
        ok: true,
        name: targetFileName,
        unassignedNotice: `ℹ️ La cuenta "${maskDisplayIdentifier(targetFileName)}" es una cuenta libre (no asignada a ningún pool). Sus credenciales se mantienen en modo nativo. Para fijar un especialista virtual, agrégala a un pool desde Group Manager.`,
      };
    },
    [specialistModal.card, registeredPools]
  );

  const handleSpecialistSaved = useCallback(
    async (result) => {
      if (result?.unassignedNotice) {
        setErrorMessage(result.unassignedNotice);
        setTimeout(() => setErrorMessage(''), 6000);
        return;
      }
      setSuccessMessage(
        `⚙️ Configuración de especialista actualizada para ${maskDisplayIdentifier(result.fileName)}.`
      );
      setTimeout(() => setSuccessMessage(''), 4000);
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    },
    [onReloadRequested]
  );

  const handleRefreshCardQuota = useCallback(
    async (masterKey, telemetry) => {
      setRefreshingQuotaKeys((prev) => new Set(prev).add(masterKey));
      setLoadingQuotaKeys((prev) => new Set(prev).add(masterKey));
      try {
        const result = await fetchCardQuota({
          fileName: masterKey,
          auth_index: telemetry.authIndex || '',
          project_id: telemetry.projectId || '',
          prefix: telemetry.prefix || '',
          familyRole: telemetry.familyRole || '',
        });
        if (isMountedRef.current) {
          setQuotasMap((prev) => ({
            ...prev,
            [masterKey]: result,
          }));
        }
      } catch (err) {
        if (isMountedRef.current) {
          setErrorMessage(`Error al actualizar cuota: ${err.message}`);
        }
      } finally {
        if (isMountedRef.current) {
          setRefreshingQuotaKeys((prev) => {
            const next = new Set(prev);
            next.delete(masterKey);
            return next;
          });
          setLoadingQuotaKeys((prev) => {
            const next = new Set(prev);
            next.delete(masterKey);
            return next;
          });
        }
      }
    },
    []
  );

  // Normalizes real CPAMC-native telemetry from a master entry (node) or a
  // managed card (both carry the same physical account fields).
  const extractAccountTelemetry = useCallback((source) => {
    const nodeData = source?.node?.data || null;
    return {
      authIndex:
        source?.authIndex ||
        nodeData?.auth_index ||
        '',
      projectId: source?.projectId || nodeData?.project_id || '',
      unavailable: source?.unavailable === true || nodeData?.unavailable === true,
      disabled: source?.disabled === true || nodeData?.disabled === true,
      cooldowns: source?.cooldowns || nodeData?.cooldowns || [],
      recentRequests: source?.recentRequests || nodeData?.recent_requests || [],
      nextRetryAfter: source?.nextRetryAfter || nodeData?.next_retry_after || '',
    };
  }, []);

  // Honest quota groups derived from real CPAMC-native cooldown state.
  // Never fabricates percentages: exhausted families come from real 429
  // cooldowns with their true reset times; everything else is "sin datos" / "consultando".
  const deriveNativeQuotaGroups = useCallback((telemetry, isCardLoading = false) => {
    const cd = classifyCooldowns(telemetry.cooldowns);
    const noDataRow = (label) => ({
      label,
      percent: null,
      percentLabel: isCardLoading ? 'Consultando en vivo...' : 'Sin datos en vivo',
      resetLabel: '—',
      warning: false,
    });
    const exhaustedRows = (info) => {
      if (!info) return null;
      const remainingMs = info.retryAtMs !== null ? info.retryAtMs - Date.now() : null;
      const resetLabel = info.retryAt
        ? `Se libera en ${formatRemainingDuration(info.retryAt)}`
        : 'En cooldown';
      const exhaustedRow = {
        label: 'Weekly Limit',
        percent: 0,
        percentLabel: 'Agotada (429)',
        resetLabel,
        resetMs: info.retryAtMs,
        warning: true,
      };
      const fiveHourRow = {
        label: 'Five Hour Limit',
        percent: 0,
        percentLabel: 'Agotada (429)',
        resetLabel,
        resetMs: info.retryAtMs,
        warning: true,
      };
      // A cooldown resetting within ~6h indicates the 5-hour window is the
      // exhausted one; longer resets indicate the weekly quota.
      if (remainingMs !== null && remainingMs <= 6 * 60 * 60 * 1000) {
        return [fiveHourRow, noDataRow('Weekly Limit')];
      }
      return [noDataRow('Five Hour Limit'), exhaustedRow];
    };

    return [
      {
        title: 'GEMINI MODELS',
        rows: exhaustedRows(cd.gemini) || [
          noDataRow('Five Hour Limit'),
          noDataRow('Weekly Limit'),
        ],
      },
      {
        title: 'CLAUDE AND GPT MODELS',
        rows: exhaustedRows(cd.claudeGpt) || [
          noDataRow('Five Hour Limit'),
          noDataRow('Weekly Limit'),
        ],
      },
    ];
  }, []);

  // Effective quota for a physical master: cached live Google data wins when
  // available; otherwise the honest native-derived state is rendered.
  const getCardQuota = useCallback(
    (masterKey, telemetry) => {
      const cached = quotasMap[masterKey];
      if (cached && Array.isArray(cached.groups) && cached.groups.length > 0) {
        return { plan: cached.plan, groups: cached.groups, live: true, loading: false };
      }
      const isCardLoading = loadingQuotaKeys.has(masterKey);
      return {
        plan: cached?.plan || null,
        groups: deriveNativeQuotaGroups(telemetry, isCardLoading),
        live: false,
        loading: isCardLoading,
      };
    },
    [quotasMap, deriveNativeQuotaGroups, loadingQuotaKeys]
  );

  const renderHeroBanner = (specState, defaultModel, poolStyle, modelsCount = 0) => {
    const bannerStyle = poolStyle ? {
      borderColor: poolStyle.border,
      background: poolStyle.bg,
      boxShadow: `0 0 12px ${poolStyle.bg}`,
    } : {};

    const activeModelNameStyle = poolStyle ? {
      color: '#fbbf24',
      textShadow: `0 0 8px ${poolStyle.border}`,
    } : {};

    if (specState.isSpecialist) {
      return (
        <div
          className="hero-model-banner specialist"
          style={bannerStyle}
          data-testid="hero-model-banner"
        >
          <div className="hero-model-badge-row">
            <span
              className="badge-specialist-active"
              style={poolStyle ? {
                background: poolStyle.bg,
                borderColor: poolStyle.border,
                color: poolStyle.color,
              } : {}}
            >
              🎯 MODELO ASIGNADO EN RAM
            </span>
          </div>
          <div
            className="hero-model-name"
            style={activeModelNameStyle}
            data-testid="hero-model-name"
          >
            {specState.activeSpecialistModel}
          </div>
          <div className="hero-model-helper">
            Ruteo virtual activo · 🛡️ Aislamiento en RAM (Disco intacto)
          </div>
        </div>
      );
    }
    const countLabel = modelsCount > 0 ? ` (${modelsCount})` : '';
    return (
      <div className="hero-model-banner multipurpose" data-testid="hero-model-banner">
        <div className="hero-model-badge-row">
          <span className="badge-multipurpose-default">✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)</span>
        </div>
        <div className="hero-model-name" data-testid="hero-model-name">
          Todos los modelos{countLabel}
        </div>
        <div className="hero-model-helper">
          Modo multipropósito abierto · Predeterminado preferente: {defaultModel}
        </div>
      </div>
    );
  };

  const renderQuotaTelemetry = (masterKey, source, familyRole) => {
    const telemetry = extractAccountTelemetry(source);
    const quota = getCardQuota(masterKey, telemetry);
    const isRefreshing = refreshingQuotaKeys.has(masterKey);
    const isCardLoading = quota.loading || isRefreshing;
    const activity = computeAccountTelemetry(telemetry.recentRequests);
    const cd = classifyCooldowns(telemetry.cooldowns);
    const planName = quota.plan;

    const earliestCooldown =
      cd.active.length > 0
        ? cd.active.reduce(
            (earliest, a) =>
              a.retryAtMs !== null && (!earliest || earliest.retryAtMs === null || a.retryAtMs < earliest.retryAtMs)
                ? a
                : earliest,
            null
          )
        : null;

    // Filtrar grupos de cuota para priorizar la familia activa de la tarjeta:
    // En Gemini cards, no saturar con Claude si ya hay Gemini models presentes
    const visibleGroups = (quota.groups || []).filter((group) => {
      if (familyRole === 'gemini') {
        // Si el grupo contiene Claude, solo mostrarlo si no hay grupo de Gemini
        const isClaudeGroup = group.title.toLowerCase().includes('claude');
        const hasGeminiGroup = quota.groups.some((g) => g.title.toLowerCase().includes('gemini'));
        if (isClaudeGroup && hasGeminiGroup) return false;
      }
      return true;
    });

    return (
      <div className="card-quota-telemetry" data-testid="card-quota-telemetry">
        {/* Real cooldown state from CPAMC native (429 quota exhaustion) */}
        {earliestCooldown && (
          <div className="card-cooldown-banner" data-testid="card-cooldown-banner">
            <span className="cooldown-icon">🧊</span>
            <span className="cooldown-text">
              En cooldown (429): {earliestCooldown.modelKey}
              {earliestCooldown.retryAt ?
                ` · se libera en ${formatRemainingDuration(earliestCooldown.retryAt)}` : ''}
            </span>
          </div>
        )}

        <div className="plan-row">
          <span>Plan</span>
          <div className="plan-badges">
            {planName ? (
              <span className="plan-badge" data-testid="plan-badge">Plan {planName}</span>
            ) : isCardLoading ? (
              <span className="plan-badge plan-loading" data-testid="plan-badge">Plan: consultando...</span>
            ) : (
              <span className="plan-badge plan-unknown" data-testid="plan-badge">Plan: sin datos</span>
            )}
          </div>
        </div>

        {visibleGroups.map((group, gIdx) => {
          // Sort to always place 5-hour window on the left and weekly window on the right
          const sortedRows = [...(group.rows || [])].sort((a, b) => {
            const aIs5h =
              (a.label || '').toLowerCase().includes('5') ||
              (a.label || '').toLowerCase().includes('five');
            const bIs5h =
              (b.label || '').toLowerCase().includes('5') ||
              (b.label || '').toLowerCase().includes('five');
            if (aIs5h && !bIs5h) return -1;
            if (!aIs5h && bIs5h) return 1;
            return 0;
          });

          return (
            <div key={gIdx} className="quota-group">
              <div className="group-title">{group.title}</div>
              <div className="quota-clocks-row" data-testid={`quota-clocks-${gIdx}`}>
                {sortedRows.map((row, rIdx) => {
                  const isWeekly = (row.label || '').toLowerCase().includes('week');
                  const totalMinutes = isWeekly ? 10080 : 300;
                  const windowKey = isWeekly ? 'weekly' : '5h';
                  const consumedPercent =
                    row.percent === null || row.percent === undefined
                      ? null
                      : row.percent === 0
                      ? 100
                      : Math.max(0, Math.min(100, 100 - row.percent));
                  const remainingMinutes =
                    row.resetMs !== null && row.resetMs !== undefined
                      ? Math.max(0, Math.round((row.resetMs - Date.now()) / 60000))
                      : null;

                  return (
                    <QuotaClock
                      key={rIdx}
                      totalMinutes={totalMinutes}
                      remainingMinutes={remainingMinutes}
                      consumedPercent={consumedPercent}
                      label={row.label}
                      windowKey={windowKey}
                      resetLabel={row.resetLabel}
                      percentLabel={row.percentLabel}
                      isLoading={isCardLoading}
                      testId={`quota-clock-${windowKey}-${masterKey || 'card'}-${rIdx}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Real Activity from CPAMC native recent_requests buckets */}
        <div className="card-activity-wrap">
          <div className="activity-header">
            <span className="activity-title">Activity (~3.3h)</span>
            <span
              className="activity-meta"
              data-testid="card-activity-meta"
            >
              {activity.reqs} reqs · <strong>{activity.okPct}% ok</strong>
            </span>
          </div>
        </div>

        {/* Card Refresh Footer */}
        <div className="card-quota-footer">
          <button
            type="button"
            className="btn-card-refresh"
            onClick={() => handleRefreshCardQuota(masterKey, telemetry)}
            disabled={isRefreshing}
            aria-label="Actualizar Cuota"
            data-testid={`btn-refresh-quota-${masterKey}`}
            title="Actualizar telemetría de cuota en vivo"
          >
            <span className={isRefreshing ? 'spinning' : ''}>🔄</span>
            <span>Actualizar Cuota</span>
          </button>
        </div>
      </div>
    );
  };

  // 1. Scalable N -> 2N Managed Pool Cards (estrictamente desde el PoolRegistry del plugin)
  const managedCards = useMemo(
    () => buildManagedPoolCards(nodes, registeredPools),
    [nodes, registeredPools]
  );

  // Scalable N -> 2N Managed Pool Cards agrupadas por Pool
  const poolGroups = useMemo(() => {
    const groups = new Map();
    managedCards.forEach((card, idx) => {
      const poolKey = card.poolId || card.activePoolBase || 'sin-pool';
      if (!groups.has(poolKey)) {
        groups.set(poolKey, {
          poolId: card.poolId,
          activePoolBase: card.activePoolBase,
          cards: [],
        });
      }
      groups.get(poolKey).cards.push({ card, originalIdx: idx });
    });
    return Array.from(groups.values());
  }, [managedCards]);

  // 1b. Auto-fetch live quota/tier once per physical master on mount so cards
  // show real Google values when reachable (never fabricated defaults).
  useEffect(() => {
    const antigravityCards = managedCards.filter(
      (c) => (c.familyRole === 'gemini' || c.familyRole === 'claude') && c.masterFileName
    );
    antigravityCards.forEach((card) => {
      const key = card.masterFileName;
      if (autoFetchedMastersRef.current.has(key)) return;
      autoFetchedMastersRef.current.add(key);
      setLoadingQuotaKeys((prev) => new Set(prev).add(key));
      fetchCardQuota({
        fileName: key,
        auth_index: card.authIndex || '',
        project_id: card.projectId || '',
        prefix: card.prefix || '',
        familyRole: card.familyRole || '',
      })
        .then((result) => {
          if (isMountedRef.current) {
            setQuotasMap((prev) => ({ ...prev, [key]: result }));
          }
        })
        .catch(() => {
          // Live quota unavailable: cards fall back to honest native-derived
          // state (cooldowns / sin datos) instead of mock values.
        })
        .finally(() => {
          if (isMountedRef.current) {
            setLoadingQuotaKeys((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }
        });
    });
  }, [managedCards]);

  // 2. Classify accounts and identify physical masters vs virtual accounts on disk
  const { masterAccounts, virtualAccounts, orphanAccounts } = useMemo(() => {
    const masters = [];
    const virtuals = [];
    const orphans = [];

    // Map of active virtual files referenced by valid managed cards
    const activeVirtualFiles = new Set(
      managedCards.map((c) => c.virtualFileName).filter(Boolean)
    );

    (nodes || []).forEach((node) => {
      if (!node) return;
      const classification = classifyAuthAccount(node);
      const entry = {
        node,
        classification,
        fileName: classification.fileName,
        prefix: classification.prefix,
        maskedEmail: classification.maskedEmail,
        masterOrigin: classification.masterOrigin,
        exclusionBadges: classification.exclusionBadges,
      };

      if (classification.isMaster) {
        masters.push(entry);
      } else if (classification.isVirtual) {
        virtuals.push(entry);
        // An orphan clone is a virtual account that is unlinked, has no active prefix,
        // or does not belong to the valid active managed cards
        const rawPrefix = (node.data?.prefix || node.prefix || '').trim();
        if (
          !rawPrefix ||
          rawPrefix.startsWith('unlinked_') ||
          !activeVirtualFiles.has(classification.fileName)
        ) {
          orphans.push(entry);
        }
      }
    });

    return {
      masterAccounts: masters,
      virtualAccounts: virtuals,
      orphanAccounts: orphans,
    };
  }, [nodes, managedCards]);

  // Active in live routing prefixes count
  const activeInPoolsCount = useMemo(() => {
    return managedCards.filter(
      (c) => c.assignedPrefix && !c.assignedPrefix.startsWith('unlinked_')
    ).length;
  }, [managedCards]);

  // Map master accounts to their derived virtual accounts on disk
  const masterToDerivedMap = useMemo(() => {
    const map = new Map();
    virtualAccounts.forEach((v) => {
      if (v.masterOrigin) {
        if (!map.has(v.masterOrigin)) {
          map.set(v.masterOrigin, []);
        }
        map.get(v.masterOrigin).push(v);
      }
    });
    return map;
  }, [virtualAccounts]);

  // Handle individual virtual clone dissolution/deletion
  const handleDeleteVirtual = useCallback(
    async (fileName) => {
      if (!fileName) return;
      const safeName = maskDisplayIdentifier(fileName);
      if (
        !window.confirm(
          `¿Liberar réplica virtual "${safeName}"? Tu cuenta física OAuth y credenciales maestras permanecen 100% intactas en Google/Anthropic.`
        )
      ) {
        return;
      }

      setIsProcessing(true);
      setErrorMessage('');
      try {
        await deleteAuthFile(fileName);
        setSuccessMessage(`🧹 Réplica virtual "${safeName}" liberada exitosamente (credencial maestra intacta).`);
        if (typeof onReloadRequested === 'function') {
          await onReloadRequested();
        }
        setTimeout(() => setSuccessMessage(''), 4000);
      } catch (err) {
        setErrorMessage(`Error al liberar réplica virtual: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [onReloadRequested]
  );

  // Handle batch purge of orphan clones
  const handlePurgeOrphans = useCallback(async () => {
    if (orphanAccounts.length === 0) return;
    if (
      !window.confirm(
        `¿Seguro que deseas purgar ${orphanAccounts.length} clon(es) huérfano(s)? Se eliminarán permanentemente de CPAMC los archivos residuales.`
      )
    ) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    try {
      const results = await Promise.allSettled(
        orphanAccounts.map((o) => deleteAuthFile(o.fileName))
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        setErrorMessage(`Fallaron ${failed.length} de ${orphanAccounts.length} eliminaciones.`);
      } else {
        setSuccessMessage(
          `🧹 Se purgaron exitosamente ${orphanAccounts.length} archivo(s) clon huérfano(s).`
        );
      }
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      setErrorMessage(`Error al purgar clones huérfanos: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [orphanAccounts, onReloadRequested]);

  // Virtual/Claude cards for backwards-compatible test queries
  const claudeCards = useMemo(() => {
    return managedCards.filter((c) => c.familyRole === 'claude');
  }, [managedCards]);

  return (
    <div className="auto-auth-container" data-testid="auto-auth-files-view">
      {/* Header */}
      <div className="auto-auth-header">
        <div className="auto-auth-title-row">
          <span className="auto-auth-icon">🗂️</span>
          <h2 className="auto-auth-title">Auto Auth Files & Trazabilidad</h2>
        </div>
        <p className="auto-auth-desc">
          Separación arquitectónica de cuentas físicas OAuth (Masters) y credenciales
          virtuales derivadas para pools de Claude y Gemini (Modelo escalable N → 2N).
          Supervisa origen, exclusiones y limpieza de clones residuales en CPAMC.
        </p>
      </div>

      {/* Metrics Ribbon */}
      <div className="auto-auth-metrics">
        <div className="auto-auth-metric-card">
          <span className="auto-auth-metric-label">Cards Gestionadas</span>
          <span
            className="auto-auth-metric-value"
            data-testid="metric-total-accounts"
          >
            {managedCards.length}
            <span
              className="auto-auth-metric-sub"
              data-testid="metric-managed-cards"
            >
              {virtualAccounts.length > 0 || claudeCards.length > 0
                ? `${managedCards.length} en pools (2N)`
                : `${managedCards.length} en pools`}
            </span>
          </span>
        </div>

        <div className="auto-auth-metric-card">
          <span className="auto-auth-metric-label">Cuentas Maestras (OAuth)</span>
          <span
            className="auto-auth-metric-value"
            style={{ color: '#fef08a' }}
            data-testid="metric-master-accounts"
          >
            {masterAccounts.length}
            <span className="auto-auth-metric-sub">físicas (N)</span>
          </span>
        </div>

        <div className="auto-auth-metric-card">
          <span className="auto-auth-metric-label">Cuentas Virtuales</span>
          <span
            className="auto-auth-metric-value"
            style={{ color: '#e9d5ff' }}
            data-testid="metric-virtual-accounts"
          >
            {virtualAccounts.length || claudeCards.length}
            <span className="auto-auth-metric-sub">derivadas (Claude)</span>
          </span>
        </div>

        <div
          className={`auto-auth-metric-card ${orphanAccounts.length > 0 ? 'alert' : ''}`}
        >
          <span className="auto-auth-metric-label">Clones Huérfanos</span>
          <span
            className="auto-auth-metric-value"
            style={{ color: orphanAccounts.length > 0 ? '#f87171' : '#6ee7b7' }}
            data-testid="metric-orphan-clones"
          >
            {orphanAccounts.length}
            <span className="auto-auth-metric-sub">a purgar</span>
          </span>
        </div>
      </div>

      {/* Feedback Alerts */}
      {errorMessage && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.2)',
            border: '1px solid #10b981',
            color: '#6ee7b7',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {successMessage}
        </div>
      )}

      {/* Section: Purgar Clones Huérfanos Banner (if detected) */}
      {orphanAccounts.length > 0 && (
        <div className="auto-auth-orphan-banner" data-testid="orphan-purge-banner">
          <div className="auto-auth-orphan-info">
            <span className="auto-auth-orphan-icon">⚠️</span>
            <div className="auto-auth-orphan-text">
              <h4>Se detectaron {orphanAccounts.length} clones residuales huérfanos</h4>
              <p>
                Archivos virtuales desasociados o sin prefijo activo ocupando espacio en CPAMC.
                Púrgalos para mantener el entorno limpio y evitar deriva.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-purge-orphans"
            onClick={handlePurgeOrphans}
            disabled={isProcessing}
            data-testid="btn-purge-orphans"
          >
            <span>🧹</span>
            <span>Purgar Clones Huérfanos ({orphanAccounts.length})</span>
          </button>
        </div>
      )}

      {/* Managed Pool Cards Section (Model 2N: Gemini + Claude Cards) */}
      <div
        className="auto-auth-section"
        data-testid="section-managed-cards"
      >
        <div className="auto-auth-section-header">
          <h3 className="auto-auth-section-title">
            <span>🔀</span>
            <span>
              {claudeCards.length > 0
                ? 'Cards Gestionadas en Pools (Modelo 2N: Gemini + Claude)'
                : 'Cards Gestionadas en Pools (Cuentas Activas)'}
            </span>
          </h3>
          <span className="auto-auth-section-count">{managedCards.length} cards</span>
        </div>

        {managedCards.length === 0 ? (
          <div
            className="auto-auth-empty-alert"
            data-testid="auto-auth-empty-pools"
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              background: 'rgba(15, 23, 42, 0.45)',
              borderRadius: '12px',
              border: '1px dashed rgba(100, 116, 139, 0.35)',
              margin: '16px 0',
            }}
          >
            <div style={{ fontSize: '30px', marginBottom: '8px' }}>🛠️</div>
            <h4 style={{ margin: '0 0 6px', color: '#f8fafc', fontSize: '15px', fontWeight: 700 }}>
              0 Cards Gestionadas en Auto Auth Files
            </h4>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px', maxWidth: '540px', display: 'inline-block' }}>
              Las tarjetas de pool deben generarse a través de{' '}
              <strong>"🛠️ Crear Group/Perfiles"</strong>. Una vez estructurados los pools de Gemini o Claude, sus tarjetas se reflejarán aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="auto-auth-section-groups" data-testid="section-virtuals">
            {poolGroups.map((group, gIdx) => {
              const groupPoolId = group.poolId || group.activePoolBase || `Pool-${gIdx + 1}`;
              const poolDef = registeredPools.find(
                (p) => p.id === group.poolId || p.base_prefix === group.activePoolBase
              );
              const groupTargetModel =
                poolDef?.policy?.target_models?.[0] ||
                group.cards[0]?.card?.specialistModel ||
                'Multimodelo';

              return (
                <div key={groupPoolId} className="auto-auth-pool-group" data-testid={`pool-group-${gIdx}`}>
                  <div className="auto-auth-pool-header">
                    <div className="auto-auth-pool-info">
                      <span className="auto-auth-pool-title">
                        📦 {groupPoolId}
                      </span>
                      {group.activePoolBase && (
                        <span className="auto-auth-pool-badge">
                          Base: [{group.activePoolBase}]
                        </span>
                      )}
                      <span className="auto-auth-pool-target">
                        🎯 Objetivo: <strong>{groupTargetModel}</strong>
                      </span>
                    </div>
                    <span className="auto-auth-section-count">
                      {group.cards.length} cuenta(s) en rotación
                    </span>
                  </div>

                  <div className="auto-auth-grid">
                    {group.cards.map(({ card, originalIdx: idx }) => {
                      const isGemini = card.familyRole === 'gemini';
                      const isCodex = card.familyRole === 'codex';
                      const roleBadgeClass = isGemini ? 'master' : isCodex ? 'codex' : 'virtual';
                      const familyTitle = isGemini ? '💎 Gemini' : isCodex ? '🧩 Codex' : '🎭 Claude';

                      const excludes55 = (card.exclusionBadges || []).includes('Excluye 5.5');
                      const virtualFileToDelete = card.virtualFileName;
                      const claudeIdx = claudeCards.indexOf(card);
                      const cardInherited = resolveInheritedCardModels(card, effectiveCatalogModels);
                      const specState = card.specialistModel
                        ? {
                            isSpecialist: true,
                            activeSpecialistModel: card.specialistModel,
                            excludedCount:
                              cardInherited.length > 1
                                ? cardInherited.length - 1
                                : (card.excludedModels || []).length,
                          }
                        : detectSpecialistState(card, cardInherited);
                      const poolGroupStyle = getPoolGroupStyle(card.assignedPrefix);
                      const cardTelemetry = extractAccountTelemetry(card);
                      const cardCd = classifyCooldowns(cardTelemetry.cooldowns);
                      const cardEarliestCooldown =
                        cardCd.active.length > 0
                          ? cardCd.active.reduce(
                              (earliest, a) =>
                                a.retryAtMs !== null && (!earliest || earliest.retryAtMs === null || a.retryAtMs < earliest.retryAtMs)
                                  ? a
                                  : earliest,
                              null
                            )
                          : null;

                      return (
                        <div
                          key={card.cardId || idx}
                          className={`auto-auth-card ${roleBadgeClass}`}
                          style={{
                            ...poolGroupStyle.cardStyle,
                            '--card-accent': poolGroupStyle.primary,
                            '--card-accent-bg': poolGroupStyle.bg,
                            '--card-accent-border': poolGroupStyle.border,
                            '--card-accent-color': poolGroupStyle.color,
                          }}
                          data-testid={isGemini ? `gemini-card-${idx}` : `virtual-card-${claudeIdx}`}
                        >
                          <div className="auto-auth-card-top">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                className="badge-prefix-hero"
                                style={{
                                  background: poolGroupStyle.primary || '#0284c7',
                                  color: '#ffffff',
                                }}
                                data-testid={`badge-prefix-hero-${idx}`}
                              >
                                🏷️ [{card.assignedPrefix || card.activePoolBase || 'sin-prefijo'}]
                              </span>
                              <span className={`badge-role ${roleBadgeClass}`}>
                                {familyTitle}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                type="button"
                                className="btn-card-gear"
                                onClick={() => handleOpenSpecialist(card)}
                                aria-label="Configurar Especialista"
                                data-testid={isGemini ? `btn-gear-gemini-${idx}` : `btn-gear-virtual-${claudeIdx}`}
                                title="Configurar Especialista (⚙️)"
                              >
                                ⚙️
                              </button>
                            </div>
                          </div>

                          <div className="auto-auth-identity">
                            <span
                              className="auto-auth-email"
                              title={card.email || card.maskedEmail}
                            >
                              {card.email || card.maskedEmail}
                            </span>
                            <span className="auto-auth-filename">
                              {card.virtualFileName
                                ? maskDisplayIdentifier(card.virtualFileName)
                                : maskDisplayIdentifier(card.masterFileName)}
                            </span>
                          </div>

                          {/* Origin Traceability Badge (derived cards linking to master) */}
                          {!isGemini && (
                            <div
                              className="auto-auth-origin-box"
                              data-testid="origin-traceability-badge"
                            >
                              <span className="auto-auth-origin-icon">🔗</span>
                              <span>
                                Origen: <strong>{card.maskedEmail}</strong> (Master)
                              </span>
                            </div>
                          )}

                          {/* Hero Active Model Banner (MINI-002) */}
                          {renderHeroBanner(
                            specState,
                            isGemini
                              ? cardInherited.includes('gemini-3.8-flash-high')
                                ? 'gemini-3.8-flash-high'
                                : cardInherited.find((m) => m.includes('3.8'))
                                || (cardInherited.includes('gemini-2.5-pro') ? 'gemini-2.5-pro' : cardInherited[0] || 'gemini-3.8-flash-high')
                              : cardInherited.includes('claude-3-7-sonnet')
                              ? 'claude-3-7-sonnet'
                              : cardInherited.find((m) => m.includes('3.7') || m.includes('sonnet'))
                              || cardInherited[0]
                              || 'claude-3-7-sonnet',
                            poolGroupStyle,
                            cardInherited.length
                          )}

                          <div className="auto-auth-badges-row">
                            <div className="status-pill-group">
                              {(() => {
                                const hasCooldown = Boolean(cardEarliestCooldown);
                                const isResting = hasCooldown;
                                const cooldownMinutes = cardEarliestCooldown?.retryAt
                                  ? formatRemainingDuration(cardEarliestCooldown.retryAt)
                                  : '';

                                if (card.isDynamicRAMLeader) {
                                  return (
                                    <>
                                      <span
                                        className="badge-pool-prefix badge-state-ram-leader"
                                        title="Esta cuenta es la que actualmente procesa las peticiones en caliente"
                                      >
                                        🟢 EN CALIENTE: DESPACHANDO EN RAM
                                      </span>
                                      <span className="badge-ram-leader" style={{ marginLeft: 4 }}>
                                        👑 Turno Activo (Líder en RAM)
                                      </span>
                                    </>
                                  );
                                }

                                if (isResting) {
                                  return (
                                    <span
                                      className="badge-pool-prefix badge-state-resting"
                                      title="Cuenta en descanso temporal por cuota o cooldown para recuperar ventana"
                                    >
                                      💤 EN REPOSO PREVENTIVO{cooldownMinutes ? ` · restan ${cooldownMinutes}` : ''}
                                    </span>
                                  );
                                }

                                return (
                                  <span
                                    className="badge-pool-prefix badge-state-reserve"
                                    title="Reserva sana con cuota disponible lista para relevo inmediato"
                                  >
                                    ⏸️ EN BANQUILLO: RESERVA LISTA
                                  </span>
                                );
                              })()}
                            </div>

                            <div className="isolation-pill-group">
                              {specState.isSpecialist ? (
                                <>
                                  <span
                                    className="badge-specialist-active"
                                    style={{ display: 'none' }}
                                    data-testid={`badge-specialist-active-${idx}`}
                                  >
                                    🎯 Modelo Activo: {specState.activeSpecialistModel}
                                  </span>
                                  <span
                                    className="badge-isolation-tag"
                                    data-testid={`badge-specialist-excluded-${idx}`}
                                  >
                                    🛡️ Aislamiento Virtual Puro (🚫 Excluidos: {specState.excludedCount} modelos)
                                  </span>
                                </>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {(card.exclusionBadges || []).map((badge, bIdx) => (
                                    <span key={bIdx} className="badge-exclusion">
                                      🚫 {badge}
                                    </span>
                                  ))}
                                  <span className="badge-target-family">
                                    {isGemini
                                      ? '✨ Gemini 3.x'
                                      : `✨ Claude ${excludes55 ? '4.6' : '4.6 & 5.5'}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Quota Telemetry Homologation (MINI-003) */}
                          {renderQuotaTelemetry(card.masterFileName, card, card.familyRole)}

                          {/* Card actions: dissolution if virtual file exists */}
                          {virtualFileToDelete && (
                            <div className="auto-auth-card-actions">
                              <button
                                type="button"
                                className="btn-delete-clone"
                                onClick={() => handleDeleteVirtual(virtualFileToDelete)}
                                disabled={isProcessing}
                                data-testid={`btn-delete-virtual-${virtualFileToDelete}`}
                                title="Liberar réplica virtual de disco (la cuenta maestra física OAuth permanece intacta)"
                              >
                                <span>🧹</span>
                                <span>Liberar Réplica Virtual</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Specialist Configuration Modal */}
      <SpecialistModal
        isOpen={specialistModal.isOpen}
        card={specialistModal.card}
        inheritedModels={specialistModal.inheritedModels}
        allCatalogModels={effectiveCatalogModels}
        onClose={() => setSpecialistModal((prev) => ({ ...prev, isOpen: false, card: null }))}
        onSaved={handleSpecialistSaved}
        patchFn={handlePatchSpecialist}
      />
    </div>
  );
}
