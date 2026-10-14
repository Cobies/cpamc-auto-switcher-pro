import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch, patchAuthFilePrefix, getPredictiveState, updatePredictiveConfig, listPools } from '../api/managementClient';

/**
 * Paleta de 8 colores del Espectro TrueColor (24-bit RGB)
 */
const SPECTRAL_COLORS = [
  '#4ADE80', // 1: Verde Esmeralda
  '#84CC16', // 2: Verde Lima
  '#A3E635', // 3: Lima Brillante
  '#EAB308', // 4: Amarillo Cálido
  '#F59E0B', // 5: Ámbar / Oro
  '#F97316', // 6: Naranja Alerta
  '#EF4444', // 7: Rojo Alerta
  '#DC2626', // 8: Rojo Fuego Máximo
];

const EMPTY_CELL_COLOR = 'rgb(70, 85, 100)'; // Gris metálico carril [70, 85, 100]
const CONTEXT_LABEL_COLOR = 'rgb(92, 184, 199)'; // Cian pastel [92, 184, 199]

/**
 * Componente Barra Espectral TrueColor de 8 celdas con glifos ▰ y ▱
 */
export function SpectralGauge({ percentage = 0, label = 'Context', compact = false, testId = 'spectral-gauge' }) {
  const clamped = Math.max(0, Math.min(100, Number(percentage) || 0));
  // 8 celdas: cada celda representa 12.5%
  const filledCells = Math.min(8, Math.round((clamped / 100) * 8));

  // El color dinámico del porcentaje toma el color exacto de la última celda encendida (o verde si es 0%)
  const activeColor = filledCells > 0 ? SPECTRAL_COLORS[filledCells - 1] : SPECTRAL_COLORS[0];

  const cells = [];
  for (let i = 0; i < 8; i++) {
    if (i < filledCells) {
      cells.push(
        <span
          key={i}
          className="cs-gauge-glyph-fill"
          style={{ color: SPECTRAL_COLORS[i] }}
        >
          ▰
        </span>
      );
    } else {
      cells.push(
        <span
          key={i}
          className="cs-gauge-glyph-empty"
          style={{ color: EMPTY_CELL_COLOR }}
        >
          ▱
        </span>
      );
    }
  }

  return (
    <div className={`cs-spectral-gauge ${compact ? 'compact' : ''}`} data-testid={testId}>
      {label && (
        <span className="cs-gauge-label" style={{ color: CONTEXT_LABEL_COLOR }}>
          {label}
        </span>
      )}
      <span className="cs-gauge-cells">{cells}</span>
      <span className="cs-gauge-pct" style={{ color: activeColor }}>
        {clamped.toFixed(1)}%
      </span>
    </div>
  );
}

/**
 * ControlSwitcher: CPAMC · Centro de Control de Infraestructura IA
 * Réplica idéntica y Pixel-Perfect según la especificación visual (tres.jpg)
 */
export default function ControlSwitcher({ nodes = [], onReloadRequested }) {
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkOutput, setCheckOutput] = useState('');
  const [actionError, setActionError] = useState('');
  const [rawFiles, setRawFiles] = useState([]);
  const [quotasMap, setQuotasMap] = useState({});
  const [registeredPools, setRegisteredPools] = useState([]);

  // Motor Predictivo (Anti-429)
  const [predictiveConfig, setPredictiveConfig] = useState({ enabled: true, max_reqs_per_hour: 80, threshold_pct: 80 });
  const [predictiveAccounts, setPredictiveAccounts] = useState([]);
  const [savingPredictive, setSavingPredictive] = useState(false);

  // Controles dinámicos de Paginación, Filtrado y Búsqueda
  const [searchQuery, setSearchQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState('all'); // all | gemini | claude | codex | warning
  const [sortBy, setSortBy] = useState('urgency'); // urgency | hierarchy | availability | alphabetical
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 3;

  // Helper para ofuscar emails al estilo mar...tro@gmail.com
  const obfuscateEmail = (email) => {
    if (!email || typeof email !== 'string') return '';
    const atIdx = email.indexOf('@');
    if (atIdx === -1) {
      if (email.length <= 6) return email;
      return `${email.slice(0, 3)}...${email.slice(-3)}`;
    }
    const user = email.slice(0, atIdx);
    const domain = email.slice(atIdx);
    if (user.length <= 6) {
      return `${user.slice(0, 3)}...${domain}`;
    }
    return `${user.slice(0, 3)}...${user.slice(-3)}${domain}`;
  };

  // Parser dinámico de cuotas con aislamiento de familias g* vs son*
  const parseQuotaPayload = (rawEnvelope, provider, prefix) => {
    let payload = rawEnvelope;
    if (rawEnvelope && rawEnvelope.body) {
      if (typeof rawEnvelope.body === 'string') {
        try {
          payload = JSON.parse(rawEnvelope.body);
        } catch {
          payload = rawEnvelope.body;
        }
      } else {
        payload = rawEnvelope.body;
      }
    }

    const prov = (provider || '').toLowerCase();
    const prof = (prefix || '').replace(/^(agy|codex)_?/, '').toLowerCase();

    let worstFiveHour = null;
    let worstWeekly = null;

    if (prov === 'codex') {
      const rl = payload?.rate_limit;
      if (rl?.primary_window?.used_percent !== undefined && rl.primary_window.used_percent !== null) {
        worstFiveHour = Math.max(0, Math.min(100, Number(rl.primary_window.used_percent)));
      }
      if (rl?.secondary_window?.used_percent !== undefined && rl.secondary_window.used_percent !== null) {
        worstWeekly = Math.max(0, Math.min(100, Number(rl.secondary_window.used_percent)));
      }
    } else {
      // Antigravity (Google Cloud Code): Aislar cuotas por convención de familia
      // - agy, agy2, agy_1, g1, g2... -> Solo vigila "Gemini Models"
      // - agy_clau, agy_son, agy_opus, son, clau... -> Solo vigila "Claude and GPT models"
      const cleanPrefix = (prefix || '').trim().toLowerCase();
      const isClaudeFamily =
        cleanPrefix.startsWith('agy_clau') ||
        cleanPrefix.startsWith('agy_son') ||
        cleanPrefix.startsWith('agy_opus') ||
        cleanPrefix.startsWith('clau') ||
        cleanPrefix.startsWith('son') ||
        cleanPrefix.startsWith('opus') ||
        prof.startsWith('clau') ||
        prof.startsWith('son') ||
        prof.startsWith('opus');
      const isGeminiFamily = !isClaudeFamily && (/^agy\d*(_\d+)?$/.test(cleanPrefix) || prof.startsWith('g') || prof === 'default');

      const groups = payload?.groups || [];
      for (const group of groups) {
        const grpName = (group.displayName || '').toLowerCase();
        if (isGeminiFamily && !grpName.includes('gemini')) continue;
        if (isClaudeFamily && !grpName.includes('claude') && !grpName.includes('gpt')) continue;

        const buckets = group.buckets || [];
        for (const b of buckets) {
          const name = (b.displayName || b.label || b.window || '').toLowerCase();
          const remPct = (b.remainingFraction !== undefined ? b.remainingFraction : 1.0) * 100;
          const consPct = Math.max(0, Math.min(100, 100 - remPct));

          if (name.includes('5') || name.includes('five')) {
            if (worstFiveHour === null || consPct > worstFiveHour) {
              worstFiveHour = consPct;
            }
          } else if (name.includes('week')) {
            if (worstWeekly === null || consPct > worstWeekly) {
              worstWeekly = consPct;
            }
          }
        }
      }
    }

    const five = worstFiveHour !== null ? worstFiveHour : 0;
    const weekly = worstWeekly !== null ? worstWeekly : 0;
    const minAvailable = Math.max(0, 100 - Math.max(five, weekly));

    return {
      fiveHourConsumed: worstFiveHour !== null ? Math.round(worstFiveHour * 10) / 10 : null,
      weeklyConsumed: worstWeekly !== null ? Math.round(worstWeekly * 10) / 10 : null,
      minAvailable: Math.round(minAvailable * 10) / 10,
    };
  };

  // Cuentas unificadas: usa `nodes` si están disponibles (fuente de verdad en App.jsx),
  // o cae en `rawFiles` enriquecidos con su prefijo descargado.
  const effectiveFiles = useMemo(() => {
    if (Array.isArray(nodes) && nodes.length > 0) {
      return nodes
        .filter((n) => n?.data?.prefix && !n.data.prefix.startsWith('unlinked_'))
        .map((n) => ({
          name: n.data?.fileName || n.id,
          id: n.id,
          prefix: (n.data?.prefix || '').trim(),
          note: (n.data?.prefix || '').trim(),
          email: n.data?.email || n.data?.account || n.data?.fileName || n.id,
          provider: (n.data?.provider || n.data?.accountType || 'antigravity').toLowerCase(),
          disabled: false,
        }));
    }
    return rawFiles;
  }, [nodes, rawFiles]);

  // Carga las cuentas y sus cuotas en tiempo real
  const loadData = useCallback(async () => {
    setLoading(true);
    setActionError('');
    try {
      // 1. Obtener lista de auth-files
      const res = await apiFetch('/v0/management/auth-files');
      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];

      // 2. Descargar prefijos de archivos válidos (omitiendo subcarpetas con slashes)
      const validFiles = files.filter(
        (f) => f.name && !f.name.includes('/') && !f.name.includes('\\') && !f.disabled
      );

      // 3. Consultar cuotas para cada archivo Y enriquecer con el prefijo descargado
      const newQuotas = {};
      const enrichedFiles = await Promise.all(
        validFiles.map(async (f) => {
          let prefix = (f.note || f.prefix || '').trim();
          try {
            const dlRes = await apiFetch(`/v0/management/auth-files/download?name=${encodeURIComponent(f.name)}`);
            const dlData = await dlRes.json();
            prefix = (dlData?.prefix || f.note || f.prefix || '').trim();

            const isCodex = (f.provider || '').toLowerCase() === 'codex';
            const chatgptId = dlData?.chatgpt_account_id || dlData?.account_id || '';

            let qRes;
            if (isCodex) {
              qRes = await apiFetch('/v0/management/api-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  authIndex: f.auth_index,
                  method: 'GET',
                  url: 'https://chatgpt.com/backend-api/wham/usage',
                  header: {
                    Authorization: 'Bearer $TOKEN$',
                    Accept: 'application/json',
                    'OpenAI-Beta': 'codex-1',
                    Originator: 'Codex Desktop',
                    ...(chatgptId ? { 'Chatgpt-Account-Id': chatgptId } : {}),
                  },
                }),
              });
            } else {
              qRes = await apiFetch('/v0/management/api-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  authIndex: f.auth_index,
                  method: 'POST',
                  url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
                  header: {
                    Authorization: 'Bearer $TOKEN$',
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)',
                  },
                  data: f.project_id ? JSON.stringify({ project: f.project_id }) : '{}',
                }),
              });
            }

            if (qRes && qRes.ok) {
              const qRaw = await qRes.json();
              newQuotas[f.name] = parseQuotaPayload(qRaw, f.provider, prefix);
            }
          } catch {
            // Continúa con las demás
          }
          return {
            ...f,
            prefix,
            note: prefix,
          };
        })
      );

      setRawFiles(enrichedFiles);
      setQuotasMap(newQuotas);

      // Cargar lista canónica de pools registrados
      try {
        const poolRes = await listPools();
        if (poolRes && Array.isArray(poolRes.pools)) {
          setRegisteredPools(poolRes.pools);
        }
      } catch {
        // Fallback a pools descubiertos dinámicamente si no hay backend activo
      }

      // Cargar estado de Rebalanceo Predictivo
      try {
        const predRes = await getPredictiveState();
        if (predRes && predRes.ok) {
          if (predRes.config) setPredictiveConfig(predRes.config);
          if (Array.isArray(predRes.accounts)) setPredictiveAccounts(predRes.accounts);
        }
      } catch {
        // Silencioso si aún no está disponible
      }
    } catch (err) {
      setActionError(err.message || 'Error cargando datos de infraestructura');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 20_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Estructuración de los Pools con sus reservas completas
  const allPools = useMemo(() => {
    const valid = effectiveFiles.filter(
      (f) =>
        f.name &&
        !f.name.includes('/') &&
        !f.name.includes('\\') &&
        ['antigravity', 'codex'].includes((f.provider || '').toLowerCase())
    );

    // Definición canónica de perfiles predefinidos (legacy g1 / g2)
    const canonicalPools = {
      g1: {
        profile: 'g1',
        title: 'Gemini 1 (Subagentes & Velocidad)',
        modelTarget: 'gemini-3.8-flash-high',
        dotColor: 'var(--dot-emerald, #34d399)',
        activePrefix: 'agy_g1',
      },
      g2: {
        profile: 'g2',
        title: 'Gemini 2 (Chat & Interactivo)',
        modelTarget: 'gemini-3.8-flash-high',
        dotColor: 'var(--dot-emerald, #34d399)',
        activePrefix: 'agy_g2',
      },
      son: {
        profile: 'son',
        title: 'Claude Sonnet (agy_son)',
        modelTarget: 'claude-sonnet-4-6 / 5.5 High',
        dotColor: '#f59e0b',
        activePrefix: 'agy_son',
      },
    };

    // Extracción dinámica de todos los perfiles presentes en las cuentas.
    // Usa el prefijo activo completo como clave de pool para evitar
    // contaminación cruzada (e.g. "agy" vs "agy_clau").
    const discoveredProfiles = new Map();

    valid.forEach((f) => {
      const pref = (f.note || f.prefix || '').trim();
      if (!pref) return;

      const isCodex = (f.provider || '').toLowerCase() === 'codex';

      // Extraer el prefijo activo base del pool (removiendo sufijo _N si es una reserva)
      const reserveMatch = pref.match(/^(.*)_(\d+)$/);
      const activePref = reserveMatch ? reserveMatch[1] : pref;

      // Clave única de pool: el activePref completo (no descomponer en base+prof)
      const poolKey = activePref;
      if (discoveredProfiles.has(poolKey)) return;

      // Detectar perfil canónico (agy_g1, agy_g2, agy_son)
      const base = isCodex ? 'codex' : 'agy';
      let prof = '';
      if (activePref === base) {
        prof = 'default';
      } else if (activePref.startsWith(`${base}_`)) {
        prof = activePref.slice(`${base}_`.length);
      } else {
        prof = activePref;
      }
      if (!prof) return;

      if (canonicalPools[prof] && activePref === `${base}_${prof}`) {
        discoveredProfiles.set(poolKey, {
          ...canonicalPools[prof],
          provider: f.provider,
          basePrefix: base,
          activePrefix: activePref,
          key: poolKey,
        });
      } else {
        // Pool dinámico personalizado con reconocimiento de familia
        let title = `Pool ${prof.toUpperCase()}`;
        let modelTarget = 'auto';
        let dotColor = '#58a6ff';

        if (isCodex) {
          title = `Codex (${prof.toUpperCase()})`;
          modelTarget = 'gpt-5.6-codex';
          dotColor = '#79c0ff';
        } else if (activePref.startsWith('agy_opus') || prof.startsWith('opus')) {
          title = `Claude Opus (${activePref})`;
          modelTarget = 'claude-opus-4-6-thinking / 5.5 High';
          dotColor = '#c084fc';
        } else if (activePref === 'agy_son' || prof === 'son') {
          title = 'Sonnet (Arquitectura & Razonamiento)';
          modelTarget = 'claude-sonnet-4-6 / 5.5 High';
          dotColor = '#f59e0b';
        } else if (activePref.startsWith('agy_son') || prof.startsWith('son')) {
          title = `Claude Sonnet (${activePref})`;
          modelTarget = 'claude-sonnet-4-6 / 5.5 High';
          dotColor = '#f59e0b';
        } else if (activePref.startsWith('agy_clau') || prof.startsWith('clau')) {
          title = `Claude del Paquete (${activePref})`;
          modelTarget = 'claude-sonnet-4-6';
          dotColor = '#a855f7';
        } else if (prof.startsWith('g')) {
          const num = prof.slice(1);
          title = `Gemini ${num || prof.toUpperCase()}`;
          modelTarget = 'gemini-3.8-flash-high';
          dotColor = 'var(--dot-emerald, #34d399)';
        } else if (prof === 'default' || /^agy\d*$/.test(activePref)) {
          // Direct agy or agy2, agy3... pools: Gemini puro
          const suffix = activePref === 'agy' ? '' : ` ${activePref.slice(3)}`;
          title = `Gemini Puro${suffix} (${activePref})`;
          modelTarget = 'gemini-3.8-flash-high';
          dotColor = 'var(--dot-emerald, #34d399)';
        }

        discoveredProfiles.set(poolKey, {
          profile: prof,
          title,
          modelTarget,
          dotColor,
          activePrefix: activePref,
          provider: f.provider,
          basePrefix: base,
          key: poolKey,
        });
      }
    });

    // Si no se descubrió ningún pool dinámico, conservar la definición canónica por defecto
    let poolDefs = Array.from(discoveredProfiles.values());
    if (poolDefs.length === 0) {
      poolDefs = Object.values(canonicalPools);
    } else {
      // Ordenar: primero g1, g2, son, luego el resto alfabéticamente
      const canonicalOrder = ['g1', 'g2', 'son'];
      poolDefs.sort((a, b) => {
        const idxA = canonicalOrder.indexOf(a.profile);
        const idxB = canonicalOrder.indexOf(b.profile);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.profile.localeCompare(b.profile);
      });
    }

    const result = poolDefs.map((def) => {
      // Filtrar archivos pertenecientes a este perfil.
      // CRITICAL: Solo incluir reservas cuyo sufijo tras activePrefix_ sea numérico,
      // para evitar que "agy" absorba cuentas de "agy_clau" (sufijo alfabético).
      const matchingFiles = valid.filter((f) => {
        const pref = (f.note || f.prefix || '').trim();
        if (pref === def.activePrefix) return true;
        if (!pref.startsWith(`${def.activePrefix}_`)) return false;
        const suffix = pref.slice(def.activePrefix.length + 1);
        return /^\d/.test(suffix);
      });

      // Encontrar la activa: exactamente el prefijo activo agy_g1 / agy_g2 / agy_son / custom
      const activeFile = matchingFiles.find((f) => {
        const pref = (f.note || f.prefix || '').trim();
        return pref === def.activePrefix;
      });

      // Reservas: empiezan con <activePrefix>_ y tienen sufijo numérico
      const reserveFiles = matchingFiles
        .filter((f) => {
          const pref = (f.note || f.prefix || '').trim();
          if (!pref.startsWith(`${def.activePrefix}_`)) return false;
          const suffix = pref.slice(def.activePrefix.length + 1);
          return /^\d/.test(suffix);
        })
        .map((f) => {
          const pref = (f.note || f.prefix || '').trim();
          const matchNum = pref.match(/_(\d+)$/);
          const index = matchNum ? parseInt(matchNum[1], 10) : 99;
          const quota = quotasMap[f.name] || {
            fiveHourConsumed: null,
            weeklyConsumed: null,
            minAvailable: null,
          };
          const weekly = quota.weeklyConsumed ?? 0;
          const isAgotada = weekly >= 98.0;

          return {
            name: f.name,
            email: f.email || f.account || f.name,
            obfuscatedEmail: obfuscateEmail(f.email || f.account || f.name),
            prefix: pref,
            index,
            quota,
            isAgotada,
            resetDate: isAgotada ? 'En cooldown' : null,
          };
        });

      // Ordenar reservas por índice ascendente (agy_son_1, agy_son_2, ...)
      reserveFiles.sort((a, b) => a.index - b.index);

      // Calcular cuál es la Mejor Candidata (mayor disponibilidad de cuota y no agotada)
      let bestReserveName = null;
      let maxAvail = -1;
      reserveFiles.forEach((r) => {
        if (!r.isAgotada) {
          const avail = r.quota?.minAvailable ?? 100;
          if (avail > maxAvail) {
            maxAvail = avail;
            bestReserveName = r.name;
          }
        }
      });

      // Si ninguna tiene cuota o todas están sin evaluar, tomar la primera no agotada
      if (!bestReserveName) {
        const firstAvailable = reserveFiles.find((r) => !r.isAgotada);
        if (firstAvailable) {
          bestReserveName = firstAvailable.name;
        }
      }

      const markedReserves = reserveFiles.map((r) => ({
        ...r,
        isBestCandidate: r.name === bestReserveName,
      }));

      // Métricas de cuenta activa
      const activeQuota = activeFile ? quotasMap[activeFile.name] : null;
      const fiveH = activeQuota?.fiveHourConsumed ?? 0;
      const weekly = activeQuota?.weeklyConsumed ?? 0;
      const minAvail = activeQuota?.minAvailable ?? (100 - Math.max(fiveH, weekly));

      let status = 'HEALTHY';
      if (weekly >= 95 || fiveH >= 90) {
        status = 'EXHAUSTED';
      } else if (weekly >= 80 || fiveH >= 75) {
        status = 'WARNING';
      }

      return {
        ...def,
        status,
        activeAccount: activeFile
          ? {
              name: activeFile.name,
              email: activeFile.email || activeFile.account || activeFile.name,
              obfuscatedEmail: obfuscateEmail(activeFile.email || activeFile.account || activeFile.name),
              fiveHourConsumed: activeQuota?.fiveHourConsumed !== null && activeQuota?.fiveHourConsumed !== undefined ? activeQuota.fiveHourConsumed : 0,
              weeklyConsumed: activeQuota?.weeklyConsumed !== null && activeQuota?.weeklyConsumed !== undefined ? activeQuota.weeklyConsumed : 0,
              minAvailable: minAvail,
            }
          : null,
        reserves: markedReserves,
      };
    });

    // Mapear pools soberanos registrados desde el backend si existen
    if (registeredPools && registeredPools.length > 0) {
      return registeredPools.map((rp, idx) => {
        const base = rp.base_prefix || (rp.id ? rp.id.toLowerCase().replace(/[^a-z0-9]/g, '_') : `pool_${idx}`);
        const famLower = (rp.family || '').toLowerCase();
        const dotColor = famLower.includes('claude')
          ? '#f59e0b'
          : famLower.includes('codex')
          ? '#79c0ff'
          : 'var(--dot-emerald, #34d399)';

        // Identificar la cuenta líder en memoria (active_leader en RAM o leader_auth)
        const leaderFileName = rp.active_leader || rp.leader_auth;
        const leaderFile = effectiveFiles.find((f) => (f.name || f.id) === leaderFileName);

        // Identificar las cuentas de reserva desde rp.reserves o rp.members (excluyendo el líder)
        const reserveFileNames = Array.isArray(rp.reserves) && rp.reserves.length > 0
          ? rp.reserves
          : (Array.isArray(rp.members) ? rp.members.filter((m) => m !== leaderFileName) : []);

        const mappedReserves = reserveFileNames.map((rfName, rIdx) => {
          const rFile = effectiveFiles.find((f) => (f.name || f.id) === rfName);
          const rawEmail = rFile?.email || rFile?.account || rfName;
          const assignedReservePrefix = `${base}_${rIdx + 1}`;
          const quota = (rFile && quotasMap[rFile.name]) || {
            fiveHourConsumed: null,
            weeklyConsumed: null,
            minAvailable: null,
          };
          const weekly = quota.weeklyConsumed ?? 0;
          const isAgotada = weekly >= 98.0;

          const resModel =
            (rp.member_models && rp.member_models[rfName]) ||
            rp.policy?.target_models?.[0] ||
            null;

          return {
            name: rfName,
            email: rawEmail,
            obfuscatedEmail: obfuscateEmail(rawEmail),
            prefix: assignedReservePrefix,
            model: resModel,
            index: rIdx + 1,
            quota,
            isAgotada,
            resetDate: isAgotada ? 'En cooldown' : null,
          };
        });

        // Calcular Mejor Candidata en la cola de reservas
        let bestReserveName = null;
        let maxAvail = -1;
        mappedReserves.forEach((r) => {
          if (!r.isAgotada) {
            const avail = r.quota?.minAvailable ?? 100;
            if (avail > maxAvail) {
              maxAvail = avail;
              bestReserveName = r.name;
            }
          }
        });
        if (!bestReserveName) {
          const firstAvail = mappedReserves.find((r) => !r.isAgotada);
          if (firstAvail) bestReserveName = firstAvail.name;
        }

        const markedReserves = mappedReserves.map((r) => ({
          ...r,
          isBestCandidate: r.name === bestReserveName,
        }));

        // Métricas de cuenta líder activa
        const leaderQuota = leaderFile ? quotasMap[leaderFile.name] : null;
        const fiveH = leaderQuota?.fiveHourConsumed ?? 0;
        const weekly = leaderQuota?.weeklyConsumed ?? 0;
        const minAvail = leaderQuota?.minAvailable ?? (100 - Math.max(fiveH, weekly));

        let status = 'HEALTHY';
        if (weekly >= 95 || fiveH >= 90) {
          status = 'EXHAUSTED';
        } else if (weekly >= 80 || fiveH >= 75) {
          status = 'WARNING';
        }

        const leaderModel =
          (leaderFile && rp.member_models && rp.member_models[leaderFile.name]) ||
          rp.policy?.target_models?.[0] ||
          'gemini-3.8-flash-high';

        return {
          id: rp.id,
          displayName: rp.display_name || rp.id,
          profile: base,
          title: rp.display_name || rp.id,
          modelTarget: leaderModel,
          dotColor,
          activePrefix: base,
          status,
          activeAccount: leaderFile
            ? {
                name: leaderFile.name,
                email: leaderFile.email || leaderFile.account || leaderFile.name,
                obfuscatedEmail: obfuscateEmail(leaderFile.email || leaderFile.account || leaderFile.name),
                fiveHourConsumed: leaderQuota?.fiveHourConsumed !== null && leaderQuota?.fiveHourConsumed !== undefined ? leaderQuota.fiveHourConsumed : 0,
                weeklyConsumed: leaderQuota?.weeklyConsumed !== null && leaderQuota?.weeklyConsumed !== undefined ? leaderQuota.weeklyConsumed : 0,
                minAvailable: minAvail,
              }
            : null,
          reserves: markedReserves,
        };
      });
    }

    return result;
  }, [effectiveFiles, quotasMap, registeredPools]);

  // Filtrado y Ordenamiento Dinámico de los Pools
  const filteredAndSortedPools = useMemo(() => {
    let result = allPools.filter((p) => {
      // 1. Filtro por búsqueda de texto
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = (p.title || '').toLowerCase().includes(q);
        const matchPrefix = (p.activePrefix || '').toLowerCase().includes(q);
        const matchActiveEmail = (p.activeAccount?.email || '').toLowerCase().includes(q);
        const matchReserve = (p.reserves || []).some(
          (r) => (r.email || '').toLowerCase().includes(q) || (r.prefix || '').toLowerCase().includes(q)
        );
        if (!matchTitle && !matchPrefix && !matchActiveEmail && !matchReserve) {
          return false;
        }
      }

      // 2. Filtro por familia
      if (familyFilter === 'all') return true;
      if (familyFilter === 'gemini') {
        const isClau =
          p.title?.toLowerCase().includes('claude') ||
          p.title?.toLowerCase().includes('sonnet') ||
          p.title?.toLowerCase().includes('opus') ||
          p.activePrefix?.startsWith('agy_clau') ||
          p.activePrefix?.startsWith('agy_son') ||
          p.activePrefix?.startsWith('agy_opus') ||
          p.activePrefix?.startsWith('clau') ||
          p.activePrefix?.startsWith('son') ||
          p.activePrefix?.startsWith('opus');
        return !isClau && (
          p.title?.toLowerCase().includes('gemini') ||
          p.activePrefix?.startsWith('g') ||
          /^agy\d*$/.test(p.activePrefix || '')
        );
      }
      if (familyFilter === 'claude') {
        return (
          p.title?.toLowerCase().includes('claude') ||
          p.title?.toLowerCase().includes('sonnet') ||
          p.title?.toLowerCase().includes('opus') ||
          p.activePrefix?.startsWith('agy_clau') ||
          p.activePrefix?.startsWith('agy_son') ||
          p.activePrefix?.startsWith('agy_opus') ||
          p.activePrefix?.startsWith('clau') ||
          p.activePrefix?.startsWith('son') ||
          p.activePrefix?.startsWith('opus')
        );
      }
      if (familyFilter === 'codex') {
        return p.provider === 'codex' || p.title?.toLowerCase().includes('codex');
      }
      if (familyFilter === 'warning') {
        return p.status === 'WARNING' || p.status === 'EXHAUSTED' || (p.activeAccount?.minAvailable ?? 100) <= 20;
      }
      return true;
    });

    // 3. Ordenamiento
    result.sort((a, b) => {
      if (sortBy === 'urgency') {
        const statusWeight = { EXHAUSTED: 0, WARNING: 1, HEALTHY: 2 };
        const wA = statusWeight[a.status] ?? 2;
        const wB = statusWeight[b.status] ?? 2;
        if (wA !== wB) return wA - wB;
        return (a.activeAccount?.minAvailable ?? 100) - (b.activeAccount?.minAvailable ?? 100);
      }
      if (sortBy === 'availability') {
        return (b.activeAccount?.minAvailable ?? 0) - (a.activeAccount?.minAvailable ?? 0);
      }
      if (sortBy === 'alphabetical') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortBy === 'hierarchy') {
        const prefA = (a.activePrefix || '').toLowerCase();
        const prefB = (b.activePrefix || '').toLowerCase();
        return prefA.localeCompare(prefB);
      }
      return 0;
    });

    return result;
  }, [allPools, searchQuery, familyFilter, sortBy]);

  // Conteos por familia para los chips
  const familyCounts = useMemo(() => {
    let gemini = 0;
    let claude = 0;
    let codex = 0;
    let warning = 0;
    allPools.forEach((p) => {
      const isClau =
        p.title?.toLowerCase().includes('claude') ||
        p.title?.toLowerCase().includes('sonnet') ||
        p.title?.toLowerCase().includes('opus') ||
        p.activePrefix?.startsWith('agy_clau') ||
        p.activePrefix?.startsWith('agy_son') ||
        p.activePrefix?.startsWith('agy_opus') ||
        p.activePrefix?.startsWith('clau') ||
        p.activePrefix?.startsWith('son') ||
        p.activePrefix?.startsWith('opus');
      const isGem =
        !isClau &&
        (p.title?.toLowerCase().includes('gemini') ||
          p.activePrefix?.startsWith('g') ||
          /^agy\d*$/.test(p.activePrefix || ''));
      const isCod = p.provider === 'codex' || p.title?.toLowerCase().includes('codex');

      if (isGem) gemini++;
      if (isClau) claude++;
      if (isCod) codex++;
      if (p.status === 'WARNING' || p.status === 'EXHAUSTED' || (p.activeAccount?.minAvailable ?? 100) <= 20) {
        warning++;
      }
    });
    return { all: allPools.length, gemini, claude, codex, warning };
  }, [allPools]);

  // Paginación segmentada (3 pools por página)
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedPools.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const displayedPools = useMemo(() => {
    const startIdx = (safeCurrentPage - 1) * pageSize;
    return filteredAndSortedPools.slice(startIdx, startIdx + pageSize);
  }, [filteredAndSortedPools, safeCurrentPage, pageSize]);

  // Chequeo forzado de cuotas
  const handleTogglePredictive = async () => {
    setSavingPredictive(true);
    const newEnabled = !predictiveConfig.enabled;
    const updated = { ...predictiveConfig, enabled: newEnabled };
    try {
      await updatePredictiveConfig(updated);
      setPredictiveConfig(updated);
      setCheckOutput(newEnabled ? '🛡️ Auto-Rebalanceo Predictivo ACTIVADO (Rotación preventiva antes de 429)' : '⚠️ Auto-Rebalanceo Predictivo DESACTIVADO (Rotación solo reactiva)');
    } catch (err) {
      setActionError('Error actualizando motor predictivo: ' + err.message);
    } finally {
      setSavingPredictive(false);
    }
  };

  const handleTriggerForceCheck = async () => {
    setChecking(true);
    setCheckOutput('');
    setActionError('');
    try {
      await loadData();
      setCheckOutput('⚡ Chequeo de cuotas completado con éxito.');
    } catch (err) {
      setActionError(`Error en chequeo forzado: ${err.message}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="control-switcher-view">
      {/* 1. Header & Hero Bar Idéntico a tres.jpg */}
      <div className="cs-hero-container">
        <div className="cs-hero-left">
          <div className="cs-tag-row">
            <span className="cs-badge-cat">INFRAESTRUCTURA DE MODELOS IA</span>
            <span className="cs-status-indicator">
              <span className="cs-dot-pulse"></span>
              Auto-Switcher Operativo (Zero-Downtime)
            </span>
            <span className="cs-badge-port">Puerto 8317</span>
          </div>
          <h1 className="cs-title">
            <span className="cs-title-icon">🤖</span>
            <span>CPAMC · Centro de Control de Infraestructura IA</span>
          </h1>
          <p className="cs-subtitle">
            Orquestación y rotación automática de cuotas de Antigravity (Google Cloud Code), perfiles aislados por propósito y flota de respaldo permanente con OpenCode Go y NVIDIA NIM.
          </p>
        </div>

        {/* Acciones Rápidas */}
        <div className="cs-hero-actions">
          {/* Toggle de Auto-Rebalanceo Predictivo */}
          <button
            type="button"
            onClick={handleTogglePredictive}
            disabled={savingPredictive}
            className={`cs-btn-predictive ${predictiveConfig.enabled ? 'active' : ''}`}
            title="Activa rotación preventiva de cuentas al 80% de cuota para evitar 429 de Google"
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: predictiveConfig.enabled ? '1px solid #10b981' : '1px solid #64748b',
              background: predictiveConfig.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
              color: predictiveConfig.enabled ? '#34d399' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            <span>🛡️</span>
            <span>Predictivo: {predictiveConfig.enabled ? 'ON (Anti-429)' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerForceCheck}
            disabled={checking}
            className="cs-btn-force"
            title="Fuerza un chequeo inmediato de cuotas sin cooldown"
          >
            <span className="cs-bolt-icon">⚡</span>
            <span>{checking ? 'Evaluando...' : 'Chequeo Forzado (-force)'}</span>
          </button>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="cs-btn-refresh"
            title="Refrescar métricas en vivo"
          >
            <span className={`cs-refresh-icon ${loading ? 'spinning' : ''}`}>↻</span>
          </button>
        </div>
      </div>

      {/* Salida de Chequeo Forzado / Error si aplica */}
      {checkOutput && (
        <div className="cs-alert-success">
          <span>{checkOutput}</span>
          <button type="button" onClick={() => setCheckOutput('')} className="cs-alert-close">✕</button>
        </div>
      )}
      {actionError && (
        <div className="cs-alert-error">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="cs-alert-close">✕</button>
        </div>
      )}

      {/* 2. Barra de Control Dinámico, Búsqueda, Filtros y Paginación */}
      <div className="cs-toolbar">
        {/* Lado Izquierdo: Buscador y Chips por Familia */}
        <div className="cs-toolbar-left">
          <div className="cs-search-wrap">
            <span className="cs-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar pool, prefijo o correo..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="cs-search-input"
              data-testid="input-search-cs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="cs-search-clear"
                title="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>

          <div className="cs-filter-chips">
            <button
              type="button"
              className={`cs-filter-chip ${familyFilter === 'all' ? 'active' : ''}`}
              onClick={() => { setFamilyFilter('all'); setCurrentPage(1); }}
              data-testid="filter-cs-all"
            >
              🌐 Todos ({familyCounts.all})
            </button>
            <button
              type="button"
              className={`cs-filter-chip ${familyFilter === 'gemini' ? 'active' : ''}`}
              onClick={() => { setFamilyFilter('gemini'); setCurrentPage(1); }}
              data-testid="filter-cs-gemini"
            >
              🔷 Gemini ({familyCounts.gemini})
            </button>
            <button
              type="button"
              className={`cs-filter-chip ${familyFilter === 'claude' ? 'active' : ''}`}
              onClick={() => { setFamilyFilter('claude'); setCurrentPage(1); }}
              data-testid="filter-cs-claude"
            >
              🔶 Claude ({familyCounts.claude})
            </button>
            <button
              type="button"
              className={`cs-filter-chip ${familyFilter === 'codex' ? 'active' : ''}`}
              onClick={() => { setFamilyFilter('codex'); setCurrentPage(1); }}
              data-testid="filter-cs-codex"
            >
              🧩 Codex ({familyCounts.codex})
            </button>
            {familyCounts.warning > 0 && (
              <button
                type="button"
                className={`cs-filter-chip alert ${familyFilter === 'warning' ? 'active' : ''}`}
                onClick={() => { setFamilyFilter('warning'); setCurrentPage(1); }}
                data-testid="filter-cs-warning"
              >
                ⚠️ Alerta ({familyCounts.warning})
              </button>
            )}
          </div>
        </div>

        {/* Lado Derecho: Selector de Orden y Controles de Paginación */}
        <div className="cs-toolbar-right">
          <div className="cs-sort-wrap">
            <label className="cs-sort-label">Ordenar:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="cs-sort-select"
              data-testid="select-sort-cs"
            >
              <option value="urgency">⚡ Mayor Urgencia / Menor Cuota</option>
              <option value="hierarchy">👑 Familia y Jerarquía</option>
              <option value="availability">📊 Mayor Disponibilidad</option>
              <option value="alphabetical">🔤 Alfabético (A-Z)</option>
            </select>
          </div>

          <div className="cs-pagination-wrap">
            <button
              type="button"
              className="cs-btn-page"
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              data-testid="btn-prev-page"
              title="Página anterior"
            >
              ◀
            </button>
            <span className="cs-page-indicator" data-testid="page-indicator">
              Pág <strong>{safeCurrentPage}</strong> de <strong>{totalPages}</strong>
              <span className="cs-page-count-badge">({filteredAndSortedPools.length} pools)</span>
            </span>
            <button
              type="button"
              className="cs-btn-page"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              data-testid="btn-next-page"
              title="Página siguiente"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* 3. Grid de Pools Segmentados */}
      <div className="cs-pools-grid">
        {displayedPools.map((pool, poolIdx) => {
          const isExhausted = pool.status === 'EXHAUSTED';
          const isWarning = pool.status === 'WARNING';
          const badgeClass = isExhausted
            ? 'cs-badge-exhausted'
            : isWarning
            ? 'cs-badge-warning'
            : 'cs-badge-healthy';
          const pLower = (pool.activePrefix || pool.profile || pool.title || '').toLowerCase();
          const famSuffix = pLower.includes('codex')
            ? 'codex'
            : pLower.includes('clau') || pLower.includes('son') || pLower.includes('opus')
            ? 'claude'
            : 'gemini';
          const canonicalPoolName = `Pool-${String(poolIdx + 1).padStart(2, '0')}-${famSuffix}`;
          const sovereignId = pool.id || pool.displayName || canonicalPoolName;
          const poolLabel = pool.displayName || pool.id || canonicalPoolName;

          return (
            <div key={sovereignId} className="cs-pool-card">
              {/* Cabecera del Pool */}
              <div className="cs-pool-head">
                <div>
                  <div className="cs-pool-title-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span
                      className="cs-pool-dot"
                      style={{ backgroundColor: pool.dotColor }}
                    ></span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                      📦 {poolLabel}
                    </span>
                    <h2 className="cs-pool-title">{pool.title}</h2>
                  </div>
                  <div className="cs-pool-model" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <span>Modelo: {pool.modelTarget}</span>
                    <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', background: 'rgba(100, 116, 139, 0.15)', padding: '1px 6px', borderRadius: 4 }} title="Identificador Único Soberano Inmutable del Pool">
                      ID: {sovereignId}
                    </span>
                  </div>
                </div>
                <span className={`cs-status-badge ${badgeClass}`}>{pool.status}</span>
              </div>

              {/* Caja de Cuenta Activa (En Producción) */}
              <div className="cs-active-box">
                <div className="cs-active-header">
                  <span className="cs-active-label">CUENTA ACTIVA (EN PRODUCCIÓN)</span>
                  <span className="cs-active-badge">{pool.activePrefix}</span>
                </div>

                <div className="cs-active-email" title={pool.activeAccount?.email}>
                  {pool.activeAccount?.obfuscatedEmail || 'Sin cuenta activa'}
                </div>

                {/* Métricas de Cuota con Barra Espectral TrueColor */}
                <div className="cs-quota-metrics">
                  {/* Ventana 5 Horas */}
                  <div className="cs-metric-group">
                    <div className="cs-metric-header">
                      <span className="cs-metric-label">Ventana 5 Horas (5h Limit):</span>
                    </div>
                    <SpectralGauge
                      percentage={pool.activeAccount?.fiveHourConsumed ?? 0}
                      label="Context"
                      testId={`spectral-gauge-5h-${pool.profile}`}
                    />
                  </div>

                  {/* Límite Semanal */}
                  <div className="cs-metric-group">
                    <div className="cs-metric-header">
                      <span className="cs-metric-label">Límite Semanal (Weekly Limit):</span>
                    </div>
                    <SpectralGauge
                      percentage={pool.activeAccount?.weeklyConsumed ?? 0}
                      label="Weekly"
                      testId={`spectral-gauge-weekly-${pool.profile}`}
                    />
                  </div>

                  {/* Cuota Restante Mínima */}
                  <div className="cs-remaining-row">
                    <span className="cs-remaining-label">Cuota Restante Mínima:</span>
                    <span
                      className="cs-remaining-val"
                      style={{
                        color:
                          (pool.activeAccount?.minAvailable ?? 0) <= 5
                            ? '#DC2626'
                            : (pool.activeAccount?.minAvailable ?? 0) <= 20
                            ? '#F59E0B'
                            : '#4ADE80',
                      }}
                    >
                      {pool.activeAccount?.minAvailable ?? 0}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Sección Completa: Cuentas de Reserva (X en Cola) */}
              <div className="cs-reserves-section">
                <div className="cs-reserves-head">
                  <span className="cs-reserves-title">CUENTAS DE RESERVA</span>
                  <span className="cs-reserves-count">
                    {pool.reserves.length} EN COLA
                  </span>
                </div>

                <div className="cs-reserves-list">
                  {pool.reserves.map((res) => (
                    <div
                      key={res.prefix}
                      className={`cs-reserve-item ${
                        res.isBestCandidate ? 'cs-reserve-item-best' : ''
                      }`}
                    >
                      <div className="cs-reserve-info">
                        <div className="cs-reserve-email-row">
                          <span className="cs-reserve-email" title={res.email}>
                            {res.obfuscatedEmail}
                          </span>
                          {res.isBestCandidate && (
                            <span className="cs-badge-best-candidate">
                              ⭐ MEJOR CANDIDATA
                            </span>
                          )}
                        </div>
                        <div className="cs-reserve-meta">
                          <span className="cs-reserve-prefix">{res.prefix}</span>
                          {res.model && (
                            <span
                              className="cs-reserve-model"
                              style={{
                                fontSize: 10,
                                color: '#38bdf8',
                                background: 'rgba(56, 189, 248, 0.12)',
                                padding: '1px 5px',
                                borderRadius: 4,
                                fontFamily: 'monospace',
                              }}
                              title={`Modelo Especialista Asignado: ${res.model}`}
                            >
                              🎯 {res.model}
                            </span>
                          )}
                          {res.quota?.minAvailable !== null && res.quota?.minAvailable !== undefined && !res.isAgotada && (
                            <span className="cs-reserve-avail">
                              · {res.quota.minAvailable}% libre
                            </span>
                          )}
                          {res.resetDate && (
                            <span className="cs-reserve-reset">
                              · Reset: {res.resetDate}
                            </span>
                          )}
                        </div>

                        {/* Gauges espectrales compactos para Context (5h) y Weekly */}
                        <div className="cs-reserve-gauges">
                          <SpectralGauge
                            percentage={res.quota?.fiveHourConsumed ?? 0}
                            label="Context"
                            compact={true}
                            testId={`spectral-gauge-5h-res-${res.prefix}`}
                          />
                          <SpectralGauge
                            percentage={res.quota?.weeklyConsumed ?? 0}
                            label="Weekly"
                            compact={true}
                            testId={`spectral-gauge-weekly-res-${res.prefix}`}
                          />
                        </div>
                      </div>
                      <div className="cs-reserve-status">
                        <span
                          className={`cs-reserve-badge ${
                            res.isAgotada ? 'agotada' : 'lista'
                          }`}
                        >
                          {res.isAgotada ? 'AGOTADA' : 'LISTA'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {pool.reserves.length === 0 && (
                    <div className="cs-reserves-empty">
                      No hay cuentas de reserva configuradas
                    </div>
                  )}
                </div>
              </div>

              {/* Footer del Card */}
              <div className="cs-pool-footer">
                <span className="cs-footer-label">Invocación en Pi (/model):</span>
                <span className="cs-footer-code" title={`cpamc/${pool.activePrefix}/...`}>
                  {poolLabel} (cpamc/{pool.activePrefix}/...)
                </span>
              </div>
            </div>
          );
        })}
        {displayedPools.length === 0 && (
          <div className="cs-empty-pools-alert">
            <span style={{ fontSize: 24 }}>🔍</span>
            <h4>No se encontraron pools que coincidan</h4>
            <p>Prueba ajustando el filtro de familia o limpiando el texto de búsqueda.</p>
            <button
              type="button"
              className="cs-btn-clear-filters"
              onClick={() => { setSearchQuery(''); setFamilyFilter('all'); setCurrentPage(1); }}
            >
              Restablecer Filtros
            </button>
          </div>
        )}
      </div>

      {/* 4. Pie de Reglas de Rotación */}
      <div className="cs-rules-footer">
        <div className="cs-rules-left">
          <span className="cs-gear-icon">⚙️</span>
          <span>
            <strong>Reglas de Rotación:</strong> Disparo con 5 Horas ≥ 90% o Semanal ≥ 95%. Política 3B (elección de reserva con mayor cuota disponible) y Política 4A (promoción primero, zero-downtime).
          </span>
        </div>
        <div className="cs-rules-right">
          Cooldown: 5 min · Debounce en Pi: 3 seg
        </div>
      </div>
    </div>
  );
}
