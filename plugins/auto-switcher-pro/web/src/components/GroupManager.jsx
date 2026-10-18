import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  saveAuthFilePrefixes,
  listModels,
  listPools,
  patchAuthFileExclusions,
  classifyAuthAccount,
  deleteAuthFile,
  buildManagedPoolCards,
  savePool,
  dissolvePool,
  resolveInheritedCardModels,
  CANONICAL_PROVIDER_MODELS,
} from '../api/managementClient';
import '../GroupManager.css';

// Rol de cuota de un pool del registro (coherente con targetFamilyRole / buildManagedPoolCards):
// gemini_pure → 'gemini'; gemini_sonnet/gemini_opus/gemini_claude/claude → 'claude'; codex → 'codex'
const poolFamilyRole = (family) => {
  const f = (family || '').trim();
  if (!f) return null;
  if (f === 'gemini_pure' || f.startsWith('gemini_pure')) return 'gemini';
  if (f === 'codex' || f.startsWith('codex')) return 'codex';
  if (f === 'gemini_sonnet' || f === 'gemini_opus' || f === 'gemini_claude' || f === 'claude') return 'claude';
  return f;
};

// Familias principales soportadas por la convención de cuota del switcher (internal/quota/quota.go)
const MODEL_FAMILIES = {
  gemini: {
    label: 'Google Gemini',
    icon: '✨',
    provider: 'antigravity',
    hasSubtypes: true,
    subtypes: {
      pure: {
        key: 'pure',
        label: 'Gemini Fleet',
        icon: '🔷',
        hintPrefix: 'agy',
        quota: 'Gemini Models',
        targetPatterns: ['gemini'],
        note: 'Vigila cuota de "Gemini Models" (3.7 y 3.8 comparten el mismo balde). Convención: agy, agy2, agy3...',
      },
      sonnet: {
        key: 'sonnet',
        label: 'Claude Sonnet',
        icon: '🔶',
        hintPrefix: 'agy_son',
        quota: 'Claude and GPT models',
        targetPatterns: ['sonnet'],
        note: 'Pool dedicado para código y tareas ágiles con claude-sonnet-4-6 y claude-sonnet-5-5-high. Convención: agy_son, agy_son2...',
      },
      opus: {
        key: 'opus',
        label: 'Claude Opus',
        icon: '🟣',
        hintPrefix: 'agy_opus',
        quota: 'Claude and GPT models',
        targetPatterns: ['opus'],
        note: 'Pool de razonamiento profundo con claude-opus-4-6-thinking y claude-opus-5-5-high. Convención: agy_opus, agy_opus2...',
      },
      claude: {
        key: 'claude',
        label: 'Antigravity Dual',
        icon: '🎭',
        hintPrefix: 'agy_clau',
        quota: 'Claude and GPT models',
        targetPatterns: ['claude', 'gpt'],
        note: 'Pool dual que rota tanto Sonnet como Opus bajo la misma cuota. Convención: agy_clau, agy_clau2...',
      },
    },
  },
  claude: {
    label: 'Anthropic Claude',
    icon: '🤖',
    hintPrefix: 'clau',
    provider: 'antigravity',
    quota: 'Claude and GPT models',
    note: 'Cuentas directas oficiales Anthropic (prefijo clau*). Convención: clau, clau2...',
  },
  codex: {
    label: 'OpenAI Codex',
    icon: '🧩',
    hintPrefix: 'codex',
    provider: 'codex',
    quota: 'Codex',
    note: 'Cuentas individuales Codex / OpenAI (prefijo codex*). Convención: codex, codex2...',
  },
};

// Patrones de nombre por familia objetivo: se usan para liberar modelos del
// origen al virtualizar aunque el catálogo no los liste (p.ej. excluidos).
const FAMILY_TARGET_PATTERNS = {
  gemini_pure: ['gemini'],
  gemini_sonnet: ['sonnet'],
  gemini_opus: ['opus'],
  gemini_claude: ['claude', 'gpt'],
  claude: ['claude', 'gpt'],
  codex: ['codex'],
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
function matchesFamilyModel(base, modelId, exclude55 = false) {
  const id = String(modelId || '').toLowerCase();
  const b = String(base || '').toLowerCase();
  if (exclude55 && (id.includes('5-5') || id.includes('5.5'))) {
    return false;
  }
  if (b.startsWith('agy_opus')) {
    return id.includes('opus');
  }
  if (b.startsWith('agy_son')) {
    return id.includes('sonnet');
  }
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
  const [excludeVersion55, setExcludeVersion55] = useState(false);
  const [selectedSpecialistModel, setSelectedSpecialistModel] = useState('');
  const [saveReport, setSaveReport] = useState(null); // { base, successful, failed }
  const [modelRoutes, setModelRoutes] = useState(null); // { base, routes: [] }
  const [copiedRoute, setCopiedRoute] = useState('');
  // [registeredPools] Pools registrados en el plugin PoolRegistry (fuente única de verdad).
  // Se resincroniza en cada reload de nodos (tras crear/disolver un pool).
  const [registeredPools, setRegisteredPools] = useState([]);
  const [catalogModels, setCatalogModels] = useState([]);
  const [adoptTargetPool, setAdoptTargetPool] = useState('');
  const [adoptAccountNodeId, setAdoptAccountNodeId] = useState('');
  const [adoptSpecialistModel, setAdoptSpecialistModel] = useState('');
  const [cardAdoptSelections, setCardAdoptSelections] = useState({});
  const feedbackTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    listModels()
      .then((res) => {
        if (mounted && Array.isArray(res?.models)) {
          setCatalogModels(res.models);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Evalúa si las cuentas de Antigravity conectadas o el catálogo soportan modelos Claude
  const hasClaudeInAntigravity = useMemo(() => {
    const hasExistingClaudePrefixes = nodes.some((n) => {
      const p = (n.data?.prefix || '').toLowerCase();
      return p.startsWith('agy_son') || p.startsWith('agy_opus') || p.startsWith('agy_clau');
    });
    if (hasExistingClaudePrefixes) return true;

    if (!catalogModels || catalogModels.length === 0) return true;

    return catalogModels.some((m) => {
      const lower = String(m || '').toLowerCase();
      return lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus');
    });
  }, [nodes, catalogModels]);

  useEffect(() => {
    let cancelled = false;
    listPools()
      .then((res) => {
        if (!cancelled) setRegisteredPools(Array.isArray(res?.pools) ? res.pools : []);
      })
      .catch(() => {
        // Registro no disponible: degradar a pools derivados de prefijos en disco
        if (!cancelled) setRegisteredPools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [nodes]);

  // Archivos miembros de pools registrados (cualquier familia) — para freeNodes
  const registryMemberFileNames = useMemo(() => {
    const members = new Set();
    registeredPools.forEach((pool) => {
      if (pool.leader_auth) members.add(pool.leader_auth);
      (Array.isArray(pool.reserves) ? pool.reserves : []).forEach((auth) => members.add(auth));
    });
    return members;
  }, [registeredPools]);

  // [2N] Miembros de pools registrados agrupados por rol de cuota: una cuenta física
  // puede servir a 'gemini' Y a 'claude' a la vez, pero solo a UN pool por rol
  const registryMembersByRole = useMemo(() => {
    const byRole = new Map();
    registeredPools.forEach((pool) => {
      const role = poolFamilyRole(pool.family);
      if (!role) return;
      if (!byRole.has(role)) byRole.set(role, new Set());
      const members = byRole.get(role);
      if (pool.leader_auth) members.add(pool.leader_auth);
      (Array.isArray(pool.reserves) ? pool.reserves : []).forEach((auth) => members.add(auth));
    });
    return byRole;
  }, [registeredPools]);

  // Identificar cuentas verdaderamente libres: sin prefijo asignado o huérfanas,
  // y que NO sean miembros de un pool registrado (el registro es la verdad autoritativa)
  const freeNodes = useMemo(() => {
    return nodes.filter((n) => {
      const fileName = n.data?.fileName || n.name || n.id || '';
      if (registryMemberFileNames.has(fileName)) return false;
      const pref = (n.data?.prefix || '').trim();
      return pref === '' || pref.startsWith('unlinked_');
    });
  }, [nodes, registryMemberFileNames]);

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

  const isGeminiPackageFamily = !!effectiveFamily && (
    effectiveFamily.key.startsWith('gemini_')
  );

  // 1. Managed pool cards abstraction (N -> 2N scalable model sincronizado con Auto Auth Files)
  const managedCards = useMemo(() => buildManagedPoolCards(nodes), [nodes]);

  // Rol de familia objetivo según la selección (gemini vs claude)
  const targetFamilyRole = useMemo(() => {
    if (!effectiveFamily) return null;
    if (effectiveFamily.key === 'gemini_pure') return 'gemini';
    if (
      effectiveFamily.key === 'gemini_sonnet' ||
      effectiveFamily.key === 'gemini_opus' ||
      effectiveFamily.key === 'gemini_claude' ||
      effectiveFamily.key === 'claude'
    ) {
      return 'claude';
    }
    return null;
  }, [effectiveFamily]);

  // Modelos candidatos disponibles para el pool según la familia efectiva seleccionada
  const availableSpecialistModels = useMemo(() => {
    if (!effectiveFamily) return [];
    const sourceModels = Array.isArray(catalogModels) && catalogModels.length > 0
      ? catalogModels
      : [];
    const dummyCard = {
      familyRole: targetFamilyRole || 'gemini',
      assignedPrefix: effectiveFamily.hintPrefix,
    };
    let models = resolveInheritedCardModels(dummyCard, sourceModels);

    // Si el catálogo aún no cargó o está vacío en tests, proveer los modelos canónicos conocidos
    if (models.length === 0) {
      if (effectiveFamily.key === 'gemini_pure') {
        models = [
          'gemini-3.8-flash-high',
          'gemini-3.7-flash-high',
          'gemini-3.6-flash-high',
          'gemini-3.5-flash-lite',
          'gemini-3.1-pro-low',
          'gemini-3.1-flash-lite',
          'gemini-3.1-flash-image',
          'gemini-3-flash',
          'gemini-pro-agent',
        ];
      } else if (effectiveFamily.key === 'gemini_sonnet') {
        models = ['claude-sonnet-4-6', 'claude-sonnet-5-5-high'];
      } else if (effectiveFamily.key === 'gemini_opus') {
        models = ['claude-opus-4-6-thinking', 'claude-opus-5-5-high'];
      } else if (effectiveFamily.key === 'gemini_claude' || effectiveFamily.key === 'claude') {
        models = [
          'claude-3-7-sonnet',
          'claude-3-5-haiku',
          'claude-sonnet-4-6',
          'claude-opus-4-6-thinking',
        ];
      } else if (effectiveFamily.key === 'codex') {
        models = ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o3-mini'];
      }
    }

    if (excludeVersion55) {
      models = models.filter((m) => !m.includes('5-5') && !m.includes('5.5'));
    }

    // Ordenar con 3.8 primero para gemini, o A-Z para claude/otros
    const isGemini = (targetFamilyRole || '') === 'gemini';
    return [...models].sort((a, b) => {
      if (isGemini) {
        const a38 = a.includes('3.8');
        const b38 = b.includes('3.8');
        if (a38 && !b38) return -1;
        if (!a38 && b38) return 1;
      }
      return a.localeCompare(b);
    });
  }, [effectiveFamily, catalogModels, targetFamilyRole, excludeVersion55]);

  // Actualizar el modelo especialista predeterminado cuando cambie la familia o subtipo
  useEffect(() => {
    if (availableSpecialistModels.length > 0) {
      setSelectedSpecialistModel((prev) => {
        if (prev && availableSpecialistModels.includes(prev)) return prev;
        const default38 = availableSpecialistModels.find((m) => m.includes('3.8'));
        return default38 || availableSpecialistModels[0] || '';
      });
    } else {
      setSelectedSpecialistModel('');
    }
  }, [availableSpecialistModels]);

  // ¿El prefijo corresponde al sub-tipo Gemini objetivo (mismo paquete)?
  const prefixMatchesEffectiveFamily = useCallback((prefix) => {
    const p = (prefix || '').trim();
    if (!effectiveFamily) return false;
    if (effectiveFamily.key === 'gemini_pure') {
      return (
        (/^agy\d*(_\d+)?$/.test(p) || p.startsWith('g')) &&
        !p.startsWith('agy_clau') &&
        !p.startsWith('agy_son') &&
        !p.startsWith('agy_opus')
      );
    }
    if (effectiveFamily.key === 'gemini_sonnet') return p.startsWith('agy_son');
    if (effectiveFamily.key === 'gemini_opus') return p.startsWith('agy_opus');
    if (effectiveFamily.key === 'gemini_claude') return p.startsWith('agy_clau');
    return p.startsWith(effectiveFamily.hintPrefix);
  }, [effectiveFamily]);

  // Cuentas del rol objetivo sincronizadas directamente con Auto Auth Files
  const targetRoleCards = useMemo(() => {
    if (!targetFamilyRole) return [];
    return managedCards.filter((c) => c.familyRole === targetFamilyRole);
  }, [managedCards, targetFamilyRole]);

  // Cuentas libres en el rol objetivo
  const freeCardsInTargetRole = useMemo(() => {
    return targetRoleCards.filter((c) => !c.assignedPrefix || c.assignedPrefix.startsWith('unlinked_'));
  }, [targetRoleCards]);

  // ¿El nodo requiere clonación virtual? (master que sirve a la familia opuesta)
  const isVirtualSource = useCallback(
    (node) => {
      if (!node || !targetFamilyRole) return false;
      const classification = classifyAuthAccount(node);
      if (classification.isVirtual) return false; // ya es credencial derivada: se parchea
      const pref = (node.data?.prefix || '').trim();
      if (!pref || pref.startsWith('unlinked_')) return false; // master libre: parche in-place
      const isClaudePref =
        pref.startsWith('agy_son') || pref.startsWith('agy_opus') ||
        pref.startsWith('agy_clau') || pref.startsWith('clau') || pref.startsWith('son');
      const isGeminiPref = (pref.startsWith('agy') || pref.startsWith('g')) && !isClaudePref;
      if (targetFamilyRole === 'claude') return isGeminiPref; // master gemini → clonar para Claude
      if (targetFamilyRole === 'gemini') return isClaudePref; // master claude → clonar para Gemini
      return false;
    },
    [targetFamilyRole]
  );

  // Candidatos para líder: SOLO tarjetas LIBRES del rol objetivo (modelo 2N de Auto Auth Files)
  const leaderCandidates = useMemo(() => {
    if (!effectiveFamily) return [];
    const famProvider = effectiveFamily.provider;

    if (famProvider !== 'antigravity') {
      return nodes
        .filter((n) => {
          const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
          const fileName = n.data?.fileName || n.name || n.id || '';
          const matchesProv = prov === famProvider;
          if (!matchesProv) return false;

          // Si ya está asignada a un pool registrado de esta misma familia/rol, no es libre
          const sameRoleMembers = registryMembersByRole.get(targetFamilyRole || famProvider);
          if (sameRoleMembers && sameRoleMembers.has(fileName)) return false;

          const pref = (n.data?.prefix || '').trim();
          return !pref || pref.startsWith('unlinked_');
        })
        .map((node) => ({ node, virtual: false }));
    }

    return freeCardsInTargetRole.map((card) => {
      // Buscar el nodo en el grafo que respalda a esta tarjeta
      let backingNode = null;
      if (card.virtualFileName) {
        backingNode = nodes.find(
          (n) => n.data?.fileName === card.virtualFileName || n.id === card.virtualFileName
        );
      }
      if (!backingNode && card.masterFileName) {
        backingNode = nodes.find(
          (n) => n.data?.fileName === card.masterFileName || n.id === card.masterFileName
        );
      }

      const node = backingNode || {
        id: card.virtualFileName || card.masterFileName,
        data: {
          fileName: card.virtualFileName || card.masterFileName,
          email: card.maskedEmail,
          prefix: card.assignedPrefix,
          provider: 'antigravity',
        },
      };

      const needsVirtualize = isVirtualSource(node);
      return { node, card, virtual: needsVirtualize };
    }).filter(({ node }) => {
      // [2N] Los miembros de un pool registrado de la MISMA familia-rol NO son candidatos
      // libres; estar en el pool Gemini NO impide armar el pool Claude con la misma cuenta
      const fileName = node.data?.fileName || node.name || node.id || '';
      const sameRoleMembers = registryMembersByRole.get(targetFamilyRole);
      return !(sameRoleMembers && sameRoleMembers.has(fileName));
    });
  }, [effectiveFamily, nodes, freeCardsInTargetRole, isVirtualSource, registryMembersByRole, targetFamilyRole]);

  // Cuentas de reserva compatibles: excluyen la cuenta líder seleccionada
  const reserveCandidates = useMemo(() => {
    if (!effectiveFamily || !selectedActiveNodeId) return [];
    const activeNode = nodes.find((n) => n.id === selectedActiveNodeId);
    const leaderEmail = activeNode?.data?.email || activeNode?.id;

    return leaderCandidates.filter(({ node }) => {
      const email = node.data?.email || node.id;
      return node.id !== selectedActiveNodeId && (!leaderEmail || email !== leaderEmail);
    });
  }, [effectiveFamily, selectedActiveNodeId, leaderCandidates, nodes]);

  const hasAntigravityAccounts = useMemo(
    () => nodes.some((n) => (n.data?.provider || n.data?.accountType || '').toLowerCase() === 'antigravity'),
    [nodes]
  );

  // Mapear pools existentes en el sistema agrupados por prefijo base.
  // FUENTE ÚNICA DE VERDAD: el registro del plugin (PoolRegistry). Los pools derivados
  // de prefijos en disco se incluyen solo si el registro no los cubre (pools legacy).
  const existingPools = useMemo(() => {
    const poolsMap = new Map();

    // 1) Pools registrados en el plugin (GroupManager = único generador)
    registeredPools.forEach((pool) => {
      const basePrefix = (pool.base_prefix || '').trim();
      if (!basePrefix || poolsMap.has(basePrefix)) return;

      const findNode = (authFileName) =>
        nodes.find((n) => (n.data?.fileName || n.name || n.id) === authFileName) || null;

      const root = pool.leader_auth ? findNode(pool.leader_auth) : null;
      const reserves = (Array.isArray(pool.reserves) ? pool.reserves : [])
        .map((auth, idx) => {
          const rNode = findNode(auth);
          return rNode
            ? { node: rNode, prefix: `${basePrefix}_${idx + 1}`, reserveIndex: idx + 1 }
            : null;
        })
        .filter(Boolean);

      // Si el pool no tiene ninguna cuenta física viva en nodes (fueron borradas en CPAMC),
      // descartar para evitar pools huérfanos/zombies y liberar el prefijo inmediatamente.
      if (!root && reserves.length === 0) {
        return;
      }

      const activeLeaderAuth = pool.active_leader || pool.leader_auth || '';
      const targetModel =
        (Array.isArray(pool.policy?.target_models) && pool.policy.target_models[0]) || 'gemini-3.8-flash-high';
      const poolIndex = poolsMap.size + 1;
      const famStr = (pool.family || basePrefix || '').toLowerCase();
      const famSuffix = famStr.includes('codex')
        ? 'codex'
        : famStr.includes('clau') || famStr.includes('son') || famStr.includes('opus')
        ? 'claude'
        : 'gemini';
      const canonicalPoolName = `Pool-${String(poolIndex).padStart(2, '0')}-${famSuffix}`;
      const poolId = pool.id || canonicalPoolName;
      const displayName =
        pool.display_name && pool.display_name.startsWith('Pool-')
          ? pool.display_name
          : canonicalPoolName;
      const enabled = pool.enabled !== false;
      const memberModels = pool.member_models || {};

      poolsMap.set(basePrefix, {
        id: poolId,
        displayName,
        enabled,
        basePrefix,
        root,
        reserves,
        activeLeaderAuth,
        targetModel,
        memberModels,
      });
    });

    // 2) Pools legacy detectados solo por prefijos en disco (no cubiertos por el registro)
    const registryCovered = new Set(
      registeredPools.map((p) => (p.base_prefix || '').trim()).filter(Boolean)
    );

    nodes.forEach((node) => {
      const pref = (node.data?.prefix || '').trim();
      if (!pref || pref.startsWith('unlinked_')) return;

      const reserveMatch = pref.match(/^(.*)_(\d+)$/);
      const baseKey = reserveMatch ? reserveMatch[1] : pref;
      // Los pools cubiertos por el registro son autoritativos: no mezclar miembros del disco
      if (registryCovered.has(baseKey)) return;

      const isReserve = !!reserveMatch;

      if (!poolsMap.has(baseKey)) {
        const poolIndex = poolsMap.size + 1;
        const bkLower = baseKey.toLowerCase();
        const famSuffix = bkLower.includes('codex')
          ? 'codex'
          : bkLower.includes('clau') || bkLower.includes('son') || bkLower.includes('opus')
          ? 'claude'
          : 'gemini';
        const canonicalPoolName = `Pool-${String(poolIndex).padStart(2, '0')}-${famSuffix}`;
        poolsMap.set(baseKey, {
          id: canonicalPoolName,
          displayName: canonicalPoolName,
          enabled: true,
          basePrefix: baseKey,
          root: null,
          reserves: [],
          targetModel: famSuffix === 'claude' ? 'claude-sonnet-4-6' : famSuffix === 'codex' ? 'gpt-4o' : 'gemini-3.8-flash-high',
          memberModels: {},
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
  }, [nodes, registeredPools]);

  // Advertencia de convención de familia (agy* / agy_clau* / clau* / codex*) sobre el nombre del pool
  const familyMismatch = useMemo(() => {
    const trimmed = groupBasePrefix.trim();
    if (!effectiveFamily || !trimmed) return null;
    const hint = effectiveFamily.hintPrefix;

    // VALIDACIÓN 1: El prefijo base de un pool NUNCA debe terminar en _<número>
    // porque ese formato es exclusivo de cuentas de reserva (e.g. agy_1 es reserva de agy, no un pool).
    if (/_\d+$/.test(trimmed)) {
      const match = trimmed.match(/^(.*)_(\d+)$/);
      const suggested = match ? `${match[1]}${match[2]}` : trimmed.replace(/_/g, '');
      return {
        hint,
        message: `El formato "_<número>" está reservado para cuentas de reserva. Para un nuevo pool usa "${suggested}" en vez de "${trimmed}".`,
      };
    }

    // VALIDACIÓN 1B: Caracteres seguros (alineado con safePrefixPattern en el backend Go)
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return {
        hint,
        message: 'El prefijo contiene caracteres inválidos. Solo se permiten caracteres alfanuméricos, guiones (-) y guiones bajos (_).',
      };
    }

    // VALIDACIÓN 2: Distinguir subtipos del paquete Gemini
    if (effectiveFamily.key === 'gemini_pure' && (trimmed.toLowerCase().startsWith('agy_clau') || trimmed.toLowerCase().startsWith('agy_son') || trimmed.toLowerCase().startsWith('agy_opus'))) {
      return {
        hint,
        message: 'Has seleccionado Gemini Puro, pero el prefijo inicia con un subtipo de Claude (agy_son/agy_opus/agy_clau). Usa "agy", "agy2", "agy3"...',
      };
    }

    if (effectiveFamily.key === 'gemini_sonnet' && !trimmed.toLowerCase().startsWith('agy_son')) {
      return {
        hint,
        message: 'Para Claude Sonnet del Paquete, el prefijo debe iniciar con "agy_son" (ej. agy_son, agy_son2...).',
      };
    }

    if (effectiveFamily.key === 'gemini_opus' && !trimmed.toLowerCase().startsWith('agy_opus')) {
      return {
        hint,
        message: 'Para Claude Opus del Paquete, el prefijo debe iniciar con "agy_opus" (ej. agy_opus, agy_opus2...).',
      };
    }

    if (effectiveFamily.key === 'gemini_claude' && !trimmed.toLowerCase().startsWith('agy_clau')) {
      return {
        hint,
        message: 'Para Claude Multipropósito, el prefijo debe iniciar con "agy_clau" (ej. agy_clau, agy_clau2...).',
      };
    }

    // VALIDACIÓN 3: Evitar colisión si el prefijo ya existe en otra cuenta activa
    const existingPoolPrefixes = new Set(
      nodes.map((n) => (n?.data?.prefix || '').trim()).filter(Boolean)
    );
    const currentActiveNodePrefix = (nodes.find((n) => n.id === selectedActiveNodeId)?.data?.prefix || '').trim();
    if (existingPoolPrefixes.has(trimmed) && trimmed !== currentActiveNodePrefix) {
      return {
        hint,
        message: `El prefijo "${trimmed}" ya está asignado a otra cuenta. Elige el siguiente libre (ej. ${suggestNextBasePrefix(nodes, hint)}).`,
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
  }, [effectiveFamily, groupBasePrefix, nodes, selectedActiveNodeId]);

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

    // Si el usuario ya ha escrito un prefijo manualmente en el input, no sobreescribirlo
    if (groupBasePrefix.trim()) {
      return;
    }

    const chosenNode = nodes.find((n) => n.id === nodeId);
    const chosenPref = (chosenNode?.data?.prefix || '').trim();

    if (chosenPref && !chosenPref.startsWith('unlinked_') && prefixMatchesEffectiveFamily(chosenPref)) {
      // Cargar el prefijo ya asignado en el auth-file solo si coincide con la familia activa
      setGroupBasePrefix(chosenPref);
    } else {
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
  }, [nodes, groupBasePrefix, effectiveFamily, prefixMatchesEffectiveFamily]);

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

    const updates = [];
    const virtualJobs = [];
    const registryOnlyFiles = [];
    const queueAssignment = (node, prefix) => {
      const fileName = node.data?.fileName || node.name;
      if (!fileName) return;
      // [2N] Una cuenta que ya pertenece a un pool registrado NO se toca en disco
      // (ni clon virtual ni parche de prefijo: preserva la otra familia). Su membresía
      // a esta nueva familia queda definida exclusivamente en el registro del plugin.
      if (registryMemberFileNames.has(fileName)) {
        registryOnlyFiles.push(fileName);
        return;
      }
      if (isVirtualSource(node)) {
        virtualJobs.push({ sourceFile: fileName, prefix, email: node.data?.email });
      } else {
        updates.push({ name: fileName, prefix });
      }
    };

    queueAssignment(activeNode, trimmedBase);
    const assignedPrefixes = new Set();
    const reserveFileNames = [];
    selectedReserveNodeIds.forEach((resId) => {
      const resNode = nodes.find((n) => n.id === resId);
      const resFileName = resNode?.data?.fileName || resNode?.name;
      if (!resFileName) return;
      reserveFileNames.push(resFileName);
      // Homologación: Las cuentas de reserva maestras reciben prefijo indexado (_1, _2...)
      // para que el planificador nativo de CPAMC no las confunda con cuentas libres sin prefijo.
      // La regla /_(\d+)$/ de la extensión de Pi las oculta automáticamente de /model.
      if (registryMemberFileNames.has(resFileName)) {
        registryOnlyFiles.push(resFileName);
      } else if (isVirtualSource(resNode)) {
        const reserveNum = nextReserveNumber(nodes, trimmedBase, assignedPrefixes);
        const reservePrefix = `${trimmedBase}_${reserveNum}`;
        assignedPrefixes.add(reservePrefix);
        virtualJobs.push({ sourceFile: resFileName, prefix: reservePrefix, email: resNode.data?.email });
      } else {
        const reserveNum = nextReserveNumber(nodes, trimmedBase, assignedPrefixes);
        const reservePrefix = `${trimmedBase}_${reserveNum}`;
        assignedPrefixes.add(reservePrefix);
        updates.push({ name: resFileName, prefix: reservePrefix });
      }
    });

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      let targetModels = [];
      let oppositeModels = [];
      let allBaseModels = [];
      try {
        const { models } = await listModels();
        const knownPrefixes = new Set(
          nodes.map((n) => (n.data?.prefix || '').trim()).filter(Boolean)
        );
        const toBaseModelId = (id) => {
          let cur = (id || '').trim();
          while (cur.includes('/')) {
            cur = cur.slice(cur.indexOf('/') + 1);
          }
          return cur;
        };
        // Filtrar modelos válidos para la familia
        const isAntigravityModel = (id) => {
          const lower = (id || '').toLowerCase();
          if (lower.startsWith('pool-') || lower.includes('pool-')) return false;
          return lower.includes('gemini') || lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku');
        };

        const targetSet = new Set();
        const oppositeSet = new Set();
        const familyMatchingModels = [];

        models
          .map(toBaseModelId)
          .filter(Boolean)
          .filter(isAntigravityModel)
          .forEach((id) => {
            if (matchesFamilyModel(trimmedBase, id, excludeVersion55)) {
              familyMatchingModels.push(id);
            }
          });

        // REGLA ARQUITECTÓNICA SAGRADA (Especialista Único por Pool):
        // Cada pool creado es estrictamente especialista de 1 solo modelo.
        // El modelo elegido queda como único target y el resto de la familia como opuesto/bloqueado.
        const effectiveSpecialist = selectedSpecialistModel ||
          familyMatchingModels.find((m) => m.includes('3.8')) ||
          familyMatchingModels[0] ||
          '';

        if (effectiveSpecialist) {
          targetSet.add(effectiveSpecialist);
          models
            .map(toBaseModelId)
            .filter(Boolean)
            .filter(isAntigravityModel)
            .forEach((id) => {
              if (id !== effectiveSpecialist) {
                oppositeSet.add(id);
              }
            });
        } else {
          // Fallback seguro si no hay modelos coincidentes detectados
          familyMatchingModels.forEach((id) => targetSet.add(id));
        }

        targetModels = [...targetSet];
        oppositeModels = [...oppositeSet];
        allBaseModels = [...new Set(models.map(toBaseModelId).filter(Boolean).filter(isAntigravityModel))];
      } catch {
        // Model listing is non-blocking
      }

      // [2N] Exclusiones union-aware: excluido = catálogo base − unión de los targets
      // de TODOS los pools a los que pertenece cada cuenta asignada. Para cuentas
      // solo en este pool equivale a la lista opuesta de la familia (legacy).
      const computeUnionExclusions = async (files, newPoolTargets) => {
        const exclusionsByFile = new Map();
        let existingPools = [];
        try {
          const res = await listPools();
          existingPools = Array.isArray(res?.pools) ? res.pools : [];
        } catch {
          // Registro no disponible: tratar todas como cuentas de un solo pool
        }
        const poolsByFile = new Map();
        existingPools.forEach((p) => {
          if (!p || !p.base_prefix) return;
          if (String(p.base_prefix).toLowerCase() === trimmedBase.toLowerCase()) return;
          const members = [p.leader_auth, ...(Array.isArray(p.reserves) ? p.reserves : [])].filter(Boolean);
          members.forEach((file) => {
            const list = poolsByFile.get(file) || [];
            list.push(p);
            poolsByFile.set(file, list);
          });
        });
        files.forEach((file) => {
          const union = new Set(newPoolTargets || []);
          (poolsByFile.get(file) || []).forEach((p) => {
            (p.policy?.target_models || []).forEach((m) => union.add(m));
          });
          exclusionsByFile.set(file, allBaseModels.filter((m) => !union.has(m)));
        });
        return exclusionsByFile;
      };

      // In-place patch of prefixes for non-virtual accounts
      const patchReport = updates.length > 0
        ? await saveAuthFilePrefixes(updates)
        : { successful: [], failed: [] };

      // Guardar definición de pool en el registro del plugin PRIMERO: el watcher de
      // archivos dispara re-registro (model.for_auth) que ya debe ver este pool.
      const leaderFileName = activeNode.data?.fileName || activeNode.name;
      const nextPoolIndex = existingPools.length + 1;
      const famKey = (effectiveFamily?.key || trimmedBase || '').toLowerCase();
      const famSuffix = famKey.includes('codex')
        ? 'codex'
        : famKey.includes('clau') || famKey.includes('son') || famKey.includes('opus')
        ? 'claude'
        : 'gemini';
      const canonicalPoolName = `Pool-${String(nextPoolIndex).padStart(2, '0')}-${famSuffix}`;
      const chosenModel = targetModels[0] || 'gemini-3.8-flash-high';
      const memberModelsMap = { [leaderFileName]: chosenModel };
      reserveFileNames.forEach((rf) => {
        memberModelsMap[rf] = chosenModel;
      });
      const poolPayload = {
        id: canonicalPoolName,
        name: canonicalPoolName,
        display_name: canonicalPoolName,
        route_slug: canonicalPoolName,
        enabled: true,
        family: effectiveFamily?.key || 'gemini_pure',
        base_prefix: trimmedBase,
        members: [leaderFileName, ...reserveFileNames],
        member_models: memberModelsMap,
        active_leader: leaderFileName,
        leader_auth: leaderFileName,
        leader_email: activeNode.data?.email || '',
        reserves: reserveFileNames,
        policy: {
          disable_isolation: false,
          exclude_55: Boolean(excludeVersion55),
          target_models: targetModels,
          excluded_models: oppositeModels,
        },
      };

      try {
        await savePool(poolPayload);
      } catch (poolErr) {
        console.warn('savePool error in registry:', poolErr);
      }

      // NOTA ARQUITECTÓNICA (Gobernanza Virtual Pura):
      // Las cuentas físicas en disco NO deben mutar su `excluded_models`.
      // Si se inyecta `excluded_models` en el archivo .json, CPAMC nativo oculta y mutila
      // el catálogo de modelos de la credencial en su vista nativa de Auth Files.
      // El aislamiento de modelo especialista (1 Pool = 1 Modelo) lo gestiona 100% el plugin
      // a través de `poolPayload.policy` y el enrutador virtual `model.route` / `scheduler.pick`.
      // Por ende, NUNCA sobreescribimos las exclusiones físicas del disco al crear pools.

      const successful = [
        ...patchReport.successful,
        ...virtualJobs.map((j) => ({ name: j.sourceFile, prefix: j.prefix })),
      ];
      const failed = patchReport.failed.map((f) => ({ ...f, kind: 'patch' }));

      const total = updates.length + virtualJobs.length + registryOnlyFiles.length;
      if (failed.length > 0) {
        setSaveReport({ base: trimmedBase, successful, failed });
        setErrorMessage(
          `Pool "${trimmedBase}" guardado con errores parciales: fallaron ${failed.length} de ${total} cuentas.`
        );
      } else {
        setSaveReport(null);
        const virtualNote = virtualJobs.length > 0 ? ` (${virtualJobs.length} virtualizada[s])` : '';
        const registryNote = registryOnlyFiles.length > 0 ? ` · ${registryOnlyFiles.length} vía registro (2N)` : '';
        setSuccessFeedback(`⚡ Pool "${trimmedBase}" creado y guardado con éxito (${updates.length + virtualJobs.length + registryOnlyFiles.length} cuentas${virtualNote})${registryNote}.`);
        setGroupBasePrefix('');
        setSelectedActiveNodeId('');
        setSelectedReserveNodeIds([]);
        try {
          const { models } = await listModels();
          setModelRoutes({
            base: trimmedBase,
            routes: models.filter((id) => id.startsWith(`${trimmedBase}/`) && matchesFamilyModel(trimmedBase, id, excludeVersion55)),
          });
        } catch {
          setModelRoutes(null);
        }
        if (typeof onReloadRequested === 'function') {
          await onReloadRequested();
        }
      }
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = setTimeout(() => setSuccessFeedback(''), 4000);
    } catch (err) {
      setErrorMessage(`Error al guardar pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [groupBasePrefix, selectedActiveNodeId, selectedReserveNodeIds, nodes, onReloadRequested, effectiveFamily, excludeVersion55, selectedSpecialistModel, isVirtualSource, registryMemberFileNames, registryMembersByRole]);

  // Reintentar solo las cuentas que fallaron en el último guardado
  const handleRetryFailed = useCallback(async () => {
    if (!saveReport || saveReport.failed.length === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const results = await Promise.allSettled(
        saveReport.failed.map((entry) => {
          if (entry.kind === 'virtual') {
            return virtualizeAccount({
              sourceFileName: entry.sourceFile,
              prefix: entry.prefix,
              targetModels: entry.targetModels,
              targetPatterns: entry.targetPatterns,
              oppositeModels: entry.oppositeModels,
            });
          }
          return saveAuthFilePrefixes([{ name: entry.name, prefix: entry.prefix }]);
        })
      );

      const successful = [...saveReport.successful];
      const failed = [];
      results.forEach((res, idx) => {
        const entry = saveReport.failed[idx];
        if (res.status === 'fulfilled') {
          if (entry.kind === 'virtual') {
            successful.push({ name: res.value?.name || entry.name, prefix: entry.prefix });
          } else if (res.value.failed.length > 0) {
            failed.push(entry);
          } else {
            successful.push({ name: entry.name, prefix: entry.prefix });
          }
        } else {
          failed.push({ ...entry, error: res.reason?.message || entry.error });
        }
      });

      if (failed.length > 0) {
        setSaveReport((prev) => ({ base: prev.base, successful, failed }));
        setErrorMessage(`Reintento fallido para ${failed.length} cuenta(s).`);
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
        if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = setTimeout(() => setSuccessFeedback(''), 4000);
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

    const masterUpdates = [];
    const virtualDeletions = [];
    const memberMasterFiles = new Set();

    descendants.forEach((node) => {
      const fileName = node.data?.fileName || node.name || '';
      if (!fileName) return;
      const classification = classifyAuthAccount(node);
      if (classification.isVirtual) {
        virtualDeletions.push(fileName);
      } else {
        masterUpdates.push({ name: fileName, prefix: '' });
        memberMasterFiles.add(fileName);
      }
    });

    // [2N] Miembros del pool definidos solo en el registro (sin prefijo propio en disco):
    // también deben recuperar su catálogo al disolver.
    (pool.reserves || []).forEach(({ node }) => {
      const fileName = node?.data?.fileName || node?.name || '';
      if (fileName) memberMasterFiles.add(fileName);
    });
    if (pool.root?.data?.fileName) {
      memberMasterFiles.add(pool.root.data.fileName);
    }

    setIsSubmitting(true);
    try {
      try {
        await dissolvePool(pool.basePrefix);
      } catch (dissolveErr) {
        console.warn('dissolvePool registry error:', dissolveErr);
      }

      const deleteResults = virtualDeletions.length > 0
        ? await Promise.allSettled(virtualDeletions.map((fn) => deleteAuthFile(fn)))
        : [];
      const patchReport = masterUpdates.length > 0
        ? await saveAuthFilePrefixes(masterUpdates)
        : { successful: [], failed: [] };

      // [2N] Re-parche union-aware de exclusiones para los miembros liberados:
      // excluido = catálogo base − unión de los targets de los pools REMANENTES de la
      // cuenta (vacío cuando ya no pertenece a ningún pool: catálogo base completo).
      try {
        // Gobernanza Virtual Pura (Cero Mutación en Disco):
        // Al disolver un pool NO inyectamos exclusiones físicas en disco (/root/.cli-proxy-api/*.json).
        // Las credenciales físicas en disco deben mantener excluded_models: [] de fábrica para que
        // CPAMC native "Auth Files Management" conserve el catálogo completo y el failover opere sin trabas.
        await Promise.allSettled(
          [...memberMasterFiles].map((file) => patchAuthFileExclusions(file, []))
        );
      } catch (exclusionErr) {
        console.warn('dissolve exclusion reset error:', exclusionErr);
      }

      const failedDeletions = deleteResults.filter((r) => r.status === 'rejected');
      const totalFailed = failedDeletions.length + patchReport.failed.length;
      if (totalFailed > 0) {
        setErrorMessage(
          `Error al disolver pool: fallaron ${totalFailed} de ${masterUpdates.length + virtualDeletions.length} operaciones.`
        );
      } else {
        const parts = [];
        if (virtualDeletions.length > 0) {
          parts.push(`${virtualDeletions.length} cuenta(s) virtual(es) eliminada(s) de disco`);
        }
        if (masterUpdates.length > 0) {
          parts.push(`${masterUpdates.length} cuenta(s) maestra(s) liberada(s)`);
        }
        setSuccessFeedback(`💥 Pool "${pool.basePrefix}" disuelto exitosamente (${parts.join(', ')}).`);
      }
      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      setErrorMessage(`Error al disolver pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [nodes, onReloadRequested]);

  // Adoptar una cuenta libre dentro de un pool existente como nueva reserva
  const handleAdoptAccountIntoPool = useCallback(async (targetPoolBase, targetNode, customSpecialistModel = '') => {
    if (!targetPoolBase || !targetNode) return;
    const fileName = targetNode.data?.fileName || targetNode.name || targetNode.id || '';
    const email = targetNode.data?.email || fileName;
    if (!fileName) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const poolDef = registeredPools.find((p) => p.base_prefix === targetPoolBase);
      const existingPool = existingPools.find((p) => p.basePrefix === targetPoolBase);

      const currentReserves = poolDef?.reserves
        ? [...poolDef.reserves]
        : (existingPool?.reserves || [])
            .map((r) => r.node?.data?.fileName || r.node?.name || r.node?.id)
            .filter(Boolean);

      const nextNum = Math.max(
        nextReserveNumber(nodes, targetPoolBase),
        currentReserves.length + 1
      );
      const newPrefix = `${targetPoolBase}_${nextNum}`;

      try {
        await saveAuthFilePrefixes([{ name: fileName, prefix: newPrefix }]);
      } catch (patchErr) {
        console.warn('saveAuthFilePrefixes warning on adopt:', patchErr);
      }

      if (!currentReserves.includes(fileName)) {
        currentReserves.push(fileName);
      }

      const rootNode = existingPool?.root;
      const leaderFile =
        poolDef?.leader_auth ||
        rootNode?.data?.fileName ||
        rootNode?.name ||
        rootNode?.id ||
        '';
      const leaderEmail = poolDef?.leader_email || rootNode?.data?.email || '';

      const effectiveModel =
        customSpecialistModel ||
        (Array.isArray(poolDef?.policy?.target_models) && poolDef.policy.target_models[0]) ||
        selectedSpecialistModel ||
        (targetPoolBase.startsWith('clau') || targetPoolBase.startsWith('agy_son') || targetPoolBase.startsWith('agy_clau')
          ? 'claude-sonnet-4-6'
          : targetPoolBase.startsWith('agy_opus')
          ? 'claude-opus-4-6-thinking'
          : 'gemini-3.8-flash-high');

      const updatedMemberModels = {
        ...(poolDef?.member_models || existingPool?.memberModels || {}),
        [fileName]: effectiveModel,
      };

      const poolPayload = {
        id: poolDef?.id || existingPool?.id || `Pool-01-gemini`,
        name: poolDef?.name || existingPool?.displayName || targetPoolBase,
        display_name: poolDef?.display_name || existingPool?.displayName || `Pool-01-gemini`,
        route_slug: poolDef?.route_slug || existingPool?.displayName || targetPoolBase,
        enabled: poolDef?.enabled !== false,
        family: poolDef?.family || effectiveFamily?.key || 'gemini_pure',
        base_prefix: targetPoolBase,
        members: [leaderFile, ...currentReserves].filter(Boolean),
        member_models: updatedMemberModels,
        active_leader: poolDef?.active_leader || leaderFile,
        leader_auth: leaderFile,
        leader_email: leaderEmail,
        reserves: currentReserves,
        policy: {
          ...(poolDef?.policy || {}),
          disable_isolation: false,
          exclude_55: Boolean(poolDef?.policy?.exclude_55 ?? excludeVersion55),
          target_models:
            Array.isArray(poolDef?.policy?.target_models) && poolDef.policy.target_models.length > 0
              ? poolDef.policy.target_models
              : [effectiveModel],
          excluded_models: poolDef?.policy?.excluded_models || [],
        },
      };

      try {
        await savePool(poolPayload);
      } catch (poolErr) {
        console.warn('savePool error on adopt:', poolErr);
      }

      setRegisteredPools((prev) => {
        const exists = prev.some((p) => p.base_prefix === targetPoolBase);
        if (exists) {
          return prev.map((p) => (p.base_prefix === targetPoolBase ? poolPayload : p));
        }
        return [...prev, poolPayload];
      });

      setSuccessFeedback(
        `✅ Cuenta "${email}" adoptada con éxito como Reserva en el pool "${targetPoolBase}" (prefijo [${newPrefix}] · Modelo: ${effectiveModel}).`
      );
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = setTimeout(() => setSuccessFeedback(''), 5000);

      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      setErrorMessage(`Error al adoptar cuenta en el pool: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [registeredPools, existingPools, nodes, effectiveFamily, excludeVersion55, selectedSpecialistModel, onReloadRequested]);

  // Liberar individualmente una reserva de un pool sin disolver el pool completo
  const handleReleaseReserve = useCallback(async (targetPoolBase, reserveNode) => {
    if (!targetPoolBase || !reserveNode) return;
    const fileName = reserveNode.data?.fileName || reserveNode.name || reserveNode.id || '';
    const email = reserveNode.data?.email || fileName;
    if (!fileName) return;

    const existingPool = existingPools.find((p) => p.basePrefix === targetPoolBase);
    if (existingPool && existingPool.reserves.length <= 1) {
      if (
        !window.confirm(
          `⚠️ Esta es la única reserva del pool "${targetPoolBase}". Si la liberas, el pool quedará sin suplentes de respaldo. ¿Deseas continuar?`
        )
      ) {
        return;
      }
    } else {
      if (
        !window.confirm(
          `¿Liberar la cuenta de reserva "${email}" del pool "${targetPoolBase}"? La cuenta volverá a estar libre.`
        )
      ) {
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      try {
        await saveAuthFilePrefixes([{ name: fileName, prefix: '' }]);
      } catch (patchErr) {
        console.warn('saveAuthFilePrefixes warning on release reserve:', patchErr);
      }

      const poolDef = registeredPools.find((p) => p.base_prefix === targetPoolBase);
      if (poolDef) {
        const updatedReserves = (poolDef.reserves || []).filter((f) => f !== fileName);
        const updatedPayload = {
          ...poolDef,
          reserves: updatedReserves,
        };
        try {
          await savePool(updatedPayload);
        } catch (poolErr) {
          console.warn('savePool error on release reserve:', poolErr);
        }
        setRegisteredPools((prev) =>
          prev.map((p) => (p.base_prefix === targetPoolBase ? updatedPayload : p))
        );
      }

      setSuccessFeedback(`✓ Reserva "${email}" liberada del pool "${targetPoolBase}". Ahora está libre.`);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = setTimeout(() => setSuccessFeedback(''), 5000);

      if (typeof onReloadRequested === 'function') {
        await onReloadRequested();
      }
    } catch (err) {
      setErrorMessage(`Error al liberar reserva: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [registeredPools, existingPools, onReloadRequested]);

  const providerAuraClass = family ? `provider-${family}` : 'provider-neutral';

  return (
    <div className={`group-manager-container ${providerAuraClass}`} data-testid="group-manager-view">
      {/* Header Principal Bento 2027 */}
      <div className="group-manager-header">
        <div className="group-manager-title-area">
          <div className="group-manager-title-row">
            <span className="group-manager-icon">⚡</span>
            <h2 className="group-manager-title">Constructor de Pools</h2>
            <span className="group-manager-badge-2027">v2027 · Failover Engine</span>
          </div>
          <p className="group-manager-desc">
            Orquesta pools virtuales de balanceo de carga y alta disponibilidad para CPAMC con failover automático y cero downtime.
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

      {/* Navegación por Pestañas Bento */}
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
          className={`group-manager-tab ${activeTab === 'adopt' ? 'active' : ''}`}
          onClick={() => setActiveTab('adopt')}
          data-testid="tab-adoptar-reserva"
        >
          <span>➕</span>
          <span>Adoptar / Sumar Reservas ({freeNodes.length})</span>
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
            {freeNodes.length === 0 && !hasAntigravityAccounts ? (
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
                          {key === 'gemini' ? 'Gemini: agy* · Claude: agy_son*, agy_opus*, agy_clau*' : `prefijo ${fam.hintPrefix}*`}
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
                          <span className="group-subfamily-hint">Prefijo: agy, agy2... · Cuota: Gemini Models</span>
                        </button>
                        {hasClaudeInAntigravity && (
                          <>
                            <button
                              type="button"
                              className={`group-subfamily-chip ${geminiSubtype === 'sonnet' ? 'active' : ''}`}
                              onClick={() => handleSelectGeminiSubtype('sonnet')}
                              data-testid="subfamily-gemini-sonnet"
                            >
                              <span className="group-subfamily-label">🔶 Claude Sonnet</span>
                              <span className="group-subfamily-hint">Prefijo: agy_son... · claude-sonnet 4.6 & 5.5</span>
                            </button>
                            <button
                              type="button"
                              className={`group-subfamily-chip ${geminiSubtype === 'opus' ? 'active' : ''}`}
                              onClick={() => handleSelectGeminiSubtype('opus')}
                              data-testid="subfamily-gemini-opus"
                            >
                              <span className="group-subfamily-label">🟣 Claude Opus</span>
                              <span className="group-subfamily-hint">Prefijo: agy_opus... · claude-opus 4.6 & 5.5 High</span>
                            </button>
                            <button
                              type="button"
                              className={`group-subfamily-chip ${geminiSubtype === 'claude' ? 'active' : ''}`}
                              onClick={() => handleSelectGeminiSubtype('claude')}
                              data-testid="subfamily-gemini-claude"
                            >
                              <span className="group-subfamily-label">🎭 Antigravity Dual</span>
                              <span className="group-subfamily-hint">Prefijo: agy_clau... · Cuota: Claude & GPT</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {effectiveFamily && effectiveFamily.note && (
                    <p className="group-family-note" data-testid="group-family-note">
                      ℹ️ {excludeVersion55 && (effectiveFamily.key.includes('claude') || effectiveFamily.key.includes('sonnet') || effectiveFamily.key.includes('opus'))
                        ? effectiveFamily.note.replace(/(claude-[a-z]+-5-5[a-z-]*)/gi, '$1 (versión 5.5 excluida)')
                        : effectiveFamily.note}
                    </p>
                  )}

                  {/* 🎯 Selección Obligatoria de Modelo Especialista (Invariante Sagrado: 1 Pool = 1 Modelo) */}
                  {family && (
                    <div
                      className="group-model-policy-card bento-specialist-card"
                      data-testid="model-policy-card"
                    >
                      <div className="bento-specialist-header">
                        <div className="bento-specialist-title">
                          <span className="bento-specialist-icon">🎯</span>
                          <span>Modelo Especialista Aislado</span>
                        </div>
                        <span className="bento-specialist-badge">1 Pool = 1 Modelo</span>
                      </div>
                      <select
                        className="group-select bento-select"
                        value={selectedSpecialistModel}
                        onChange={(e) => setSelectedSpecialistModel(e.target.value)}
                        data-testid="select-specialist-model"
                      >
                        {availableSpecialistModels.map((m) => (
                          <option key={m} value={m}>
                            {m}{m.includes('3.8') ? ' ⭐ (Recomendado)' : ''}
                          </option>
                        ))}
                      </select>
                      <p className="bento-specialist-hint">
                        🔒 Este pool responderá <strong>únicamente</strong> a <code>{selectedSpecialistModel || 'este modelo'}</code>. Los restantes {Math.max(0, availableSpecialistModels.length - 1)} modelos de su familia quedan automáticamente bloqueados para aislar la cuota.
                      </p>
                      {/* Casilla 5.5 solo visible para familias de Claude donde existe dicha versión */}
                      {effectiveFamily && (effectiveFamily.key.includes('claude') || effectiveFamily.key.includes('sonnet') || effectiveFamily.key.includes('opus')) && (
                        <label className="bento-checkbox-label">
                          <input
                            type="checkbox"
                            data-testid="checkbox-exclude-55"
                            checked={excludeVersion55}
                            onChange={(e) => setExcludeVersion55(e.target.checked)}
                          />
                          <span>Excluir versiones 5.5 (Mantener solo versión 4.6 / Estable)</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {/* Badge de Capacidad en Tiempo Real */}
                {family && (() => {
                  const totalEligible = leaderCandidates.length;
                  const maxGroups = Math.floor(totalEligible / 2);
                  return (
                    <div className="group-capacity-badge" data-testid="capacity-badge">
                      <span>📊 Cuentas disponibles sin asignar: <strong>{totalEligible}</strong></span>
                      <span> · Capacidad máxima: <strong>{maxGroups}</strong> grupo(s) de rotación (mínimo 2 cuentas/grupo)</span>
                    </div>
                  );
                })()}

                {/* Mensaje informativo si no hay cuentas compatibles suficientes */}
                {family && leaderCandidates.length === 0 && (
                  <div className="group-family-warning" style={{ margin: '16px 0', padding: '14px', borderRadius: 8, background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)' }} data-testid="no-compatible-accounts-alert">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#facc15', marginBottom: 4 }}>
                      <span>ℹ️</span>
                      <span>No hay cuentas libres compatibles para armar un nuevo pool de {effectiveFamily ? effectiveFamily.label : 'esta familia'}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                      Se requieren al menos 2 cuentas disponibles (1 titular y 1 reserva). Tus cuentas actuales ya están operando dentro de los pools activos. Puedes liberar cuentas existentes en la pestaña <strong>"💥 Disolver / Desagrupar Pools"</strong> o vincular una nueva cuenta en CPAMC.
                    </p>
                  </div>
                )}

                {/* Cuenta Principal + Prefijo Base */}
                <div className="group-inline-row">
                  <div className="group-field group-field-account">
                    <label className="group-label">
                      <span>👑</span>
                      <span>Titular del Pool (Líder Activo en RAM):</span>
                    </label>
                    <select
                      className="group-select"
                      value={selectedActiveNodeId}
                      disabled={!family || leaderCandidates.length === 0}
                      onChange={(e) => handleSelectActiveNode(e.target.value)}
                      data-testid="select-active-account"
                    >
                      <option value="">
                        {family
                          ? (leaderCandidates.length === 0 ? '-- Sin cuentas disponibles para esta familia --' : '-- Selecciona la cuenta titular libre --')
                          : '⚠️ Elige primero la familia de modelos'}
                      </option>
                      {leaderCandidates.map(({ node: n, virtual }) => {
                        const email = n.data?.email || n.data?.fileName || n.id;
                        const prov = (n.data?.provider || n.data?.accountType || 'ANTIGRAVITY').toUpperCase();
                        return (
                          <option key={n.id} value={n.id}>
                            {virtual ? '🔀 ' : '👑 '}{email} ({prov}){virtual ? ' — copia' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <p className="group-field-hint">Esta cuenta encabezará la rotación inicial del pool soberano.</p>
                  </div>

                  <div className="group-field group-field-prefix">
                    <label className="group-label">
                      <span>🏷️</span>
                      <span>Ruta Soberana del Pool (Nombre en /model):</span>
                    </label>
                    <input
                      type="text"
                      className="group-input"
                      placeholder={
                        effectiveFamily
                          ? `ej. ${effectiveFamily.hintPrefix}, ${effectiveFamily.hintPrefix}2`
                          : "ej. agy, agy2, agy_clau, codex"
                      }
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
                      <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Sugerido:</span>
                      {effectiveFamily && (
                        <button
                          type="button"
                          className="group-prefix-chip"
                          onClick={() => setGroupBasePrefix(suggestNextBasePrefix(nodes, effectiveFamily.hintPrefix))}
                        >
                          {suggestNextBasePrefix(nodes, effectiveFamily.hintPrefix)} (próximo libre)
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cuentas de Reserva */}
                <div className="group-field">
                  <label className="group-label">
                    <span>🛡️</span>
                    <span>Banco de Suplentes (Reservas en RAM · Failover transparente):</span>
                  </label>
                  {reserveCandidates.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>
                      {selectedActiveNodeId
                        ? 'No hay más cuentas libres compatibles con esta familia para agregar como reservas.'
                        : family
                          ? 'Selecciona primero una cuenta principal.'
                          : 'Elige primero la familia de modelos.'}
                    </div>
                  ) : (
                    <div className="group-reserves-container" data-testid="reserves-container">
                      {reserveCandidates.map(({ node: n, virtual }) => {
                        const isChecked = selectedReserveNodeIds.includes(n.id);
                        const email = n.data?.email || n.data?.fileName || n.id;
                        const file = n.data?.fileName || '';
                        const reserveIdx = selectedReserveNodeIds.indexOf(n.id);
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
                              <span className="group-reserve-email">
                                {virtual ? '🔀 ' : ''}{email}
                              </span>
                              <span className="group-reserve-sub">{file}</span>
                            </div>
                            {isChecked && (
                              <span className="bento-reserve-order-badge">
                                🛡️ {reserveIdx + 1}º Suplente
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

      {/* Pestaña: Adoptar / Sumar Reservas a Pools Existentes */}
      {activeTab === 'adopt' && (
        <div className="group-manager-content" data-testid="adopt-reserves-view">
          <div className="group-builder-col" style={{ maxWidth: 840, margin: '0 auto', width: '100%' }}>
            <div className="group-card">
              <h3 className="group-card-title">
                <span>➕</span>
                <span>Adoptar Cuenta Libre como Reserva de un Pool</span>
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, margin: '0 0 16px 0' }}>
                Si agregaste una cuenta nueva en <strong>Auth Files Management</strong> nativo de CPAMC, puedes incorporarla directamente a cualquiera de tus pools activos sin tener que desarmar ni disolver tus grupos existentes.
              </p>

              {freeNodes.length === 0 ? (
                <div className="group-empty-alert" style={{ margin: '16px 0' }} data-testid="no-free-accounts-adopt-alert">
                  <span className="group-alert-icon">✨</span>
                  <h4 className="group-alert-title">No hay cuentas libres pendientes</h4>
                  <p className="group-alert-desc">
                    Todas las cuentas de OAuth registradas ya están asignadas a un pool activo. Si agregas una cuenta nueva en CPAMC o liberas una reserva, aparecerá aquí automáticamente.
                  </p>
                </div>
              ) : existingPools.length === 0 ? (
                <div className="group-empty-alert" style={{ margin: '16px 0' }}>
                  <span className="group-alert-icon">⚠️</span>
                  <h4 className="group-alert-title">No hay pools activos creados</h4>
                  <p className="group-alert-desc">
                    Para adoptar reservas, primero debes estructurar al menos un pool en la pestaña <strong>"⚡ Armar Nuevo Pool"</strong>.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Selector 1: Cuenta Libre */}
                  <div className="group-field">
                    <label className="group-label">
                      <span>🔑</span>
                      <span>① Selecciona la Cuenta Libre a incorporar:</span>
                    </label>
                    <select
                      className="group-select"
                      value={adoptAccountNodeId || freeNodes[0]?.id || ''}
                      onChange={(e) => setAdoptAccountNodeId(e.target.value)}
                      data-testid="select-adopt-account"
                      style={{ fontSize: 13, padding: '10px 14px' }}
                    >
                      {freeNodes.map((fn) => {
                        const email = fn.data?.email || fn.data?.fileName || fn.id;
                        const prov = (fn.data?.provider || fn.data?.accountType || 'ANTIGRAVITY').toUpperCase();
                        return (
                          <option key={fn.id} value={fn.id}>
                            🔑 {email} ({prov})
                          </option>
                        );
                      })}
                    </select>
                    <p className="group-field-hint">
                      Cuentas autenticadas físicamente en CPAMC que no tienen ningún grupo o prefijo asignado.
                    </p>
                  </div>

                  {/* Selector 2: Pool Destino */}
                  <div className="group-field">
                    <label className="group-label">
                      <span>📦</span>
                      <span>② Selecciona el Pool Destino que la adoptará:</span>
                    </label>
                    <select
                      className="group-select"
                      value={adoptTargetPool || existingPools[0]?.basePrefix || ''}
                      onChange={(e) => {
                        const newPoolBase = e.target.value;
                        setAdoptTargetPool(newPoolBase);
                        const pDef = registeredPools.find((p) => p.base_prefix === newPoolBase);
                        const defMod = Array.isArray(pDef?.policy?.target_models) && pDef.policy.target_models[0]
                          ? pDef.policy.target_models[0]
                          : '';
                        setAdoptSpecialistModel(defMod);
                      }}
                      data-testid="select-adopt-target-pool"
                      style={{ fontSize: 13, padding: '10px 14px' }}
                    >
                      {existingPools.map((p, idx) => {
                        const leaderEmail = p.root?.data?.email || p.root?.data?.fileName || 'Líder';
                        const count = (p.root ? 1 : 0) + p.reserves.length;
                        const label = p.displayName || `Pool ${idx + 1}`;
                        return (
                          <option key={p.id || p.basePrefix} value={p.basePrefix}>
                            📦 {label} [{p.basePrefix}] (ID: {p.id || p.basePrefix}) — Líder: {leaderEmail} ({count} cuentas)
                          </option>
                        );
                      })}
                    </select>
                    <p className="group-field-hint">
                      La cuenta se sumará como Reserva adicional (ej. <code>{adoptTargetPool || existingPools[0]?.basePrefix}_N</code>) y responderá cuando el líder o reservas previas agoten su cuota.
                    </p>
                  </div>

                  {/* Selector 3: Modelo Especialista que Adoptará la Cuenta */}
                  {(() => {
                    const currentTargetBase = adoptTargetPool || existingPools[0]?.basePrefix || '';
                    const poolDef = registeredPools.find((p) => p.base_prefix === currentTargetBase);
                    const poolFamily = poolDef?.family || (currentTargetBase.startsWith('clau') || currentTargetBase.startsWith('agy_son') || currentTargetBase.startsWith('agy_clau') ? 'gemini_sonnet' : currentTargetBase.startsWith('agy_opus') ? 'gemini_opus' : 'gemini_pure');

                    let candidateModels = [];
                    if (poolFamily.includes('sonnet')) {
                      candidateModels = ['claude-sonnet-4-6', 'claude-sonnet-5-5-high'];
                    } else if (poolFamily.includes('opus')) {
                      candidateModels = ['claude-opus-4-6-thinking', 'claude-opus-5-5-high'];
                    } else if (poolFamily.includes('claude')) {
                      candidateModels = ['claude-sonnet-4-6', 'claude-3-7-sonnet', 'claude-3-5-haiku', 'claude-opus-4-6-thinking'];
                    } else if (poolFamily.includes('codex')) {
                      candidateModels = ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o3-mini'];
                    } else {
                      candidateModels = [
                        'gemini-3.8-flash-high',
                        'gemini-3.7-flash-high',
                        'gemini-3.6-flash-high',
                        'gemini-3.5-flash-lite',
                        'gemini-3.1-pro-low',
                        'gemini-3.1-flash-lite',
                        'gemini-3.1-flash-image',
                        'gemini-3-flash',
                        'gemini-pro-agent',
                      ];
                    }

                    const poolCurrentModel =
                      (Array.isArray(poolDef?.policy?.target_models) && poolDef.policy.target_models[0]) ||
                      candidateModels[0];

                    const effectiveSelectedModel = adoptSpecialistModel && candidateModels.includes(adoptSpecialistModel)
                      ? adoptSpecialistModel
                      : poolCurrentModel;

                    return (
                      <div className="bento-specialist-box" data-testid="adopt-specialist-box" style={{ marginTop: 4 }}>
                        <div className="bento-specialist-head">
                          <span className="bento-specialist-title">🎯 ③ Modelo Especialista que Adoptará la Cuenta</span>
                          <span className="bento-specialist-badge">1 Pool = 1 Modelo</span>
                        </div>
                        <select
                          className="group-select bento-specialist-select"
                          value={effectiveSelectedModel}
                          onChange={(e) => setAdoptSpecialistModel(e.target.value)}
                          data-testid="select-adopt-specialist-model"
                        >
                          {candidateModels.map((mod) => (
                            <option key={mod} value={mod}>
                              {mod === poolCurrentModel
                                ? `${mod} ⭐ (Por defecto del Pool [${currentTargetBase}])`
                                : mod}
                            </option>
                          ))}
                        </select>
                        <p className="bento-specialist-hint">
                          🔒 Por defecto hereda el modelo especialista del pool (<code>{poolCurrentModel}</code>) para garantizar aislamiento de cuota 100% uniforme en toda la cascada.
                        </p>
                      </div>
                    );
                  })()}

                  {/* Botón de Acción Principal */}
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        const targetId = adoptAccountNodeId || freeNodes[0]?.id;
                        const found = freeNodes.find((fn) => fn.id === targetId) || freeNodes[0];
                        const targetPool = adoptTargetPool || existingPools[0]?.basePrefix;
                        const pDef = registeredPools.find((p) => p.base_prefix === targetPool);
                        const defaultMod = (Array.isArray(pDef?.policy?.target_models) && pDef.policy.target_models[0]) || 'gemini-3.8-flash-high';
                        const chosenModel = adoptSpecialistModel || defaultMod;
                        if (found && targetPool) {
                          handleAdoptAccountIntoPool(targetPool, found, chosenModel);
                        }
                      }}
                      data-testid="btn-quick-adopt"
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
                      }}
                    >
                      <span>➕</span>
                      <span>{isSubmitting ? 'Incorporando cuenta...' : 'Adoptar como Nueva Reserva'}</span>
                    </button>
                  </div>
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
            existingPools.map((pool, poolIdx) => {
              const poolCleanName = pool.displayName || `Pool-${String(poolIdx + 1).padStart(2, '0')}-gemini`;
              const leaderFile = pool.root?.data?.fileName || pool.root?.name || pool.root?.id || '';
              const leaderModel = (pool.memberModels && pool.memberModels[leaderFile]) || pool.targetModel || 'gemini-3.8-flash-high';
              const leaderPref = pool.root?.data?.prefix || pool.basePrefix;

              return (
              <div key={pool.id || pool.basePrefix} className="group-pool-card" data-testid={`pool-card-${pool.basePrefix}`}>
                <div className="group-pool-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                      📦 {poolCleanName}
                    </span>
                    <h4 className="group-pool-title">{pool.basePrefix}</h4>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', background: 'rgba(148, 163, 184, 0.1)', padding: '2px 6px', borderRadius: 4 }} title="En /model aparece limpio como este identificador">
                      /model: {poolCleanName}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', padding: '2px 8px', borderRadius: 4 }}>
                    {(pool.root ? 1 : 0) + pool.reserves.length} cuentas
                  </span>
                </div>

                <div className="group-pool-members">
                  {pool.root && (
                    <div className="group-pool-member-row">
                      <div className="group-pool-member-top">
                        <div className="group-pool-member-identity">
                          <span style={{ color: '#fbbf24', flexShrink: 0 }}>1️⃣ 👑</span>
                          <span className="group-pool-member-email" style={{ color: '#fbbf24' }} title={pool.root.data?.email || pool.root.data?.fileName}>
                            {pool.root.data?.email || pool.root.data?.fileName}
                          </span>
                        </div>
                        <div className="group-pool-member-badges">
                          <span style={{
                            fontSize: 9,
                            fontWeight: 800,
                            background: 'rgba(234, 179, 8, 0.25)',
                            color: '#fef08a',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid rgba(234, 179, 8, 0.4)',
                          }}
                          title="Líder dinámico ficticio en RAM: Auto Switcher Pro rota este rol automáticamente según disponibilidad y anti-429"
                          >
                            LEADER
                          </span>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                          }}>
                            🔄 DINÁMICO
                          </span>
                        </div>
                      </div>
                      <div className="group-pool-member-bottom">
                        <span className="group-pool-member-model" title={`Especialista: ${leaderModel}`}>
                          ⚙️ {leaderModel}
                        </span>
                        <span className="group-pool-member-prefix" style={{ color: '#fbbf24', fontWeight: 700 }}>
                          [{leaderPref || pool.basePrefix}]
                        </span>
                      </div>
                    </div>
                  )}
                  {pool.reserves.map(({ node, prefix }, rIdx) => {
                    const rFile = node.data?.fileName || node.name || node.id || '';
                    const rModel = (pool.memberModels && pool.memberModels[rFile]) || pool.targetModel || 'gemini-3.8-flash-high';
                    const numBadge = rIdx === 0 ? '2️⃣' : rIdx === 1 ? '3️⃣' : `${rIdx + 2}️⃣`;
                    return (
                    <div key={node.id} className="group-pool-member-row">
                      <div className="group-pool-member-top">
                        <div className="group-pool-member-identity">
                          <span style={{ color: '#7dd3fc', flexShrink: 0 }}>{numBadge} 🛡️</span>
                          <span className="group-pool-member-email" style={{ color: '#7dd3fc' }} title={node.data?.email || node.data?.fileName}>
                            {node.data?.email || node.data?.fileName}
                          </span>
                        </div>
                        <div className="group-pool-member-badges">
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            background: 'rgba(125, 211, 252, 0.15)',
                            color: '#7dd3fc',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid rgba(125, 211, 252, 0.3)',
                          }}>
                            RESERVA {rIdx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleReleaseReserve(pool.basePrefix, node)}
                            disabled={isSubmitting}
                            title="Liberar solo esta cuenta de reserva sin disolver el pool"
                            data-testid={`btn-release-reserve-${pool.basePrefix}-${node.id}`}
                            style={{
                              background: 'rgba(239, 68, 68, 0.12)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#fca5a5',
                              borderRadius: 4,
                              padding: '1px 6px',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                              marginLeft: 2,
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="group-pool-member-bottom">
                        <span className="group-pool-member-model" style={{ color: '#7dd3fc', background: 'rgba(14, 165, 233, 0.08)', borderColor: 'rgba(125, 211, 252, 0.25)' }} title={`Especialista: ${rModel}`}>
                          ⚙️ {rModel}
                        </span>
                        <span className="group-pool-member-prefix">
                          [{prefix || `${pool.basePrefix}_${rIdx + 1}`}]
                        </span>
                      </div>
                    </div>
                  );
                  })}
                </div>

                {/* Sección de Adopción Directa dentro de la tarjeta del Pool */}
                {freeNodes.length > 0 && (
                  <div
                    data-testid={`card-adopt-section-${pool.basePrefix}`}
                    style={{
                      marginTop: 10,
                      padding: '8px 10px',
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px dashed rgba(56, 189, 248, 0.35)',
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>
                      ➕ Adoptar cuenta libre en [{pool.basePrefix}]:
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="group-select"
                        style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                        value={cardAdoptSelections[pool.basePrefix] || freeNodes[0]?.id || ''}
                        onChange={(e) =>
                          setCardAdoptSelections((prev) => ({
                            ...prev,
                            [pool.basePrefix]: e.target.value,
                          }))
                        }
                        data-testid={`select-card-adopt-${pool.basePrefix}`}
                      >
                        {freeNodes.map((fn) => (
                          <option key={fn.id} value={fn.id}>
                            {fn.data?.email || fn.data?.fileName || fn.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          const selId = cardAdoptSelections[pool.basePrefix] || freeNodes[0]?.id;
                          const targetNode = freeNodes.find((fn) => fn.id === selId) || freeNodes[0];
                          if (targetNode) {
                            handleAdoptAccountIntoPool(pool.basePrefix, targetNode);
                          }
                        }}
                        data-testid={`btn-card-adopt-${pool.basePrefix}`}
                        style={{
                          background: '#0284c7',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 5,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ➕ Adoptar
                      </button>
                    </div>
                  </div>
                )}

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
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
