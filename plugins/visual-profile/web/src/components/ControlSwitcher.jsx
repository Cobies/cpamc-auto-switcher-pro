import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch, patchAuthFilePrefix } from '../api/managementClient';

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
export function SpectralGauge({ percentage = 0, label = 'Context', testId = 'spectral-gauge' }) {
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
    <div className="cs-spectral-gauge" data-testid={testId}>
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
export default function ControlSwitcher({ onReloadRequested }) {
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkOutput, setCheckOutput] = useState('');
  const [actionError, setActionError] = useState('');
  const [rawFiles, setRawFiles] = useState([]);
  const [quotasMap, setQuotasMap] = useState({});

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
      // Antigravity (Google Cloud Code)
      const groups = payload?.groups || [];
      for (const group of groups) {
        const grpName = (group.displayName || '').toLowerCase();
        if (prof.startsWith('g') && !grpName.includes('gemini')) continue;
        if (prof.startsWith('son') && !grpName.includes('claude') && !grpName.includes('gpt')) continue;

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

  // Carga las cuentas y sus cuotas en tiempo real
  const loadData = useCallback(async () => {
    setLoading(true);
    setActionError('');
    try {
      // 1. Obtener lista de auth-files
      const res = await apiFetch('/v0/management/auth-files');
      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];
      setRawFiles(files);

      // 2. Descargar prefijos de archivos válidos (omitiendo subcarpetas con slashes)
      const validFiles = files.filter(
        (f) => f.name && !f.name.includes('/') && !f.name.includes('\\') && !f.disabled
      );

      // 3. Consultar cuotas para cada archivo
      const newQuotas = {};
      await Promise.allSettled(
        validFiles.map(async (f) => {
          try {
            const dlRes = await apiFetch(`/v0/management/auth-files/download?name=${encodeURIComponent(f.name)}`);
            const dlData = await dlRes.json();
            const prefix = (dlData?.prefix || f.note || '').trim();

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
        })
      );

      setQuotasMap(newQuotas);
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

  // Estructuración de los 3 Pools Canónicos (g1, g2, son) con sus reservas completas
  const pools = useMemo(() => {
    const valid = rawFiles.filter(
      (f) =>
        f.name &&
        !f.name.includes('/') &&
        !f.name.includes('\\') &&
        ['antigravity', 'codex'].includes((f.provider || '').toLowerCase())
    );

    // Definición canónica de perfiles predefinidos
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
        title: 'Sonnet (Arquitectura & Razonamiento)',
        modelTarget: 'claude-sonnet-4-6',
        dotColor: '#a855f7',
        activePrefix: 'agy_son',
      },
    };

    // Extracción dinámica de todos los perfiles presentes en las cuentas
    const discoveredProfiles = new Map();

    valid.forEach((f) => {
      const pref = (f.note || f.prefix || '').trim();
      if (!pref) return;

      const isCodex = (f.provider || '').toLowerCase() === 'codex';
      const base = isCodex ? 'codex' : 'agy';

      // Extraer el prefijo activo base del pool (removiendo sufijo _N si es una reserva)
      const reserveMatch = pref.match(/^(.*)_(\d+)$/);
      const activePref = reserveMatch ? reserveMatch[1] : pref;

      let prof = '';
      if (activePref === base) {
        prof = 'default';
      } else if (activePref.startsWith(`${base}_`)) {
        prof = activePref.slice(`${base}_`.length);
      } else {
        prof = activePref;
      }

      if (!prof) return;

      const poolKey = `${base}::${prof}`;
      if (!discoveredProfiles.has(poolKey)) {
        if (canonicalPools[prof] && activePref === `${base}_${prof}`) {
          discoveredProfiles.set(poolKey, {
            ...canonicalPools[prof],
            provider: f.provider,
            basePrefix: base,
            activePrefix: activePref,
            key: poolKey,
          });
        } else {
          // Pool dinámico personalizado
          let title = `Pool ${prof.toUpperCase()}`;
          let modelTarget = 'auto';
          let dotColor = '#58a6ff';

          if (isCodex) {
            title = `Codex (${prof.toUpperCase()})`;
            modelTarget = 'gpt-5.6-codex';
            dotColor = '#79c0ff';
          } else if (prof.startsWith('g')) {
            const num = prof.slice(1);
            title = `Gemini ${num || prof.toUpperCase()}`;
            modelTarget = 'gemini-3.8-flash-high';
            dotColor = 'var(--dot-emerald, #34d399)';
          } else if (prof.startsWith('son')) {
            title = `Claude Sonnet (${prof})`;
            modelTarget = 'claude-sonnet-4-6';
            dotColor = '#a855f7';
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
      // Filtrar archivos pertenecientes a este perfil
      const matchingFiles = valid.filter((f) => {
        const pref = (f.note || f.prefix || '').trim();
        return pref === def.activePrefix || pref.startsWith(`${def.activePrefix}_`);
      });

      // Encontrar la activa: exactamente el prefijo activo agy_g1 / agy_g2 / agy_son / custom
      const activeFile = matchingFiles.find((f) => {
        const pref = (f.note || f.prefix || '').trim();
        return pref === def.activePrefix;
      });

      // Reservas: empiezan con <activePrefix>_
      const reserveFiles = matchingFiles
        .filter((f) => {
          const pref = (f.note || f.prefix || '').trim();
          return pref.startsWith(`${def.activePrefix}_`);
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
            resetDate: isAgotada ? '02 de Octubre' : null,
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

    return result;
  }, [rawFiles, quotasMap]);

  // Chequeo forzado de cuotas
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

      {/* 2. Grid de 3 Pools Canónicos (Gemini 1, Gemini 2, Sonnet) */}
      <div className="cs-pools-grid">
        {pools.map((pool) => {
          const isExhausted = pool.status === 'EXHAUSTED';
          const isWarning = pool.status === 'WARNING';
          const badgeClass = isExhausted
            ? 'cs-badge-exhausted'
            : isWarning
            ? 'cs-badge-warning'
            : 'cs-badge-healthy';

          return (
            <div key={pool.profile} className="cs-pool-card">
              {/* Cabecera del Pool */}
              <div className="cs-pool-head">
                <div>
                  <div className="cs-pool-title-row">
                    <span
                      className="cs-pool-dot"
                      style={{ backgroundColor: pool.dotColor }}
                    ></span>
                    <h2 className="cs-pool-title">{pool.title}</h2>
                  </div>
                  <div className="cs-pool-model">Modelo: {pool.modelTarget}</div>
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
                <span className="cs-footer-label">Invocación en Pi:</span>
                <span className="cs-footer-code">
                  cpamc/{pool.activePrefix}/...
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Flota de Especialistas y Salvavidas Permanentes */}
      <div className="cs-specialists-section">
        <div className="cs-specialists-head">
          <div className="cs-specialists-title-row">
            <span className="cs-shield-icon">🛡️</span>
            <div>
              <h3 className="cs-specialists-title">
                Flota de Especialistas y Salvavidas Permanentes
              </h3>
              <p className="cs-specialists-desc">
                Modelos con API Key directa en CPAMC siempre en línea; operan como salvavidas cuando las cuentas de Google se saturan y para tareas de alta especialización.
              </p>
            </div>
          </div>
          <span className="cs-badge-online">SIEMPRE EN LÍNEA</span>
        </div>

        <div className="cs-specialists-grid">
          {/* Tarjeta 1: OpenCode Go */}
          <div className="cs-specialist-card">
            <div className="cs-specialist-head">
              <span className="cs-spec-title-group">
                <span className="cs-spec-icon">⚡</span>
                <span className="cs-spec-name">OpenCode Go</span>
              </span>
              <span className="cs-spec-badge">ocgo</span>
            </div>
            <p className="cs-spec-role">
              Salvavidas Código, Contexto Gigante & Testing
            </p>
            <div className="cs-spec-footer">
              <div className="cs-spec-row">
                <span className="cs-spec-label">Modelo Insignia:</span>
                <span className="cs-spec-model">
                  deepseek-v4-flash / deepseek-v4-pro
                </span>
              </div>
              <div className="cs-spec-row">
                <span className="cs-spec-label">Llamada en Pi:</span>
                <span className="cs-spec-code">cpamc/ocgo/...</span>
              </div>
            </div>
          </div>

          {/* Tarjeta 2: NVIDIA NIM */}
          <div className="cs-specialist-card">
            <div className="cs-specialist-head">
              <span className="cs-spec-title-group">
                <span className="cs-spec-icon">🚀</span>
                <span className="cs-spec-name">NVIDIA NIM</span>
              </span>
              <span className="cs-spec-badge">nv</span>
            </div>
            <p className="cs-spec-role">
              Especialista Lógica Matemática & Reglas Duras
            </p>
            <div className="cs-spec-footer">
              <div className="cs-spec-row">
                <span className="cs-spec-label">Modelo Insignia:</span>
                <span className="cs-spec-model">
                  nvidia/llama-3.1-nemotron-70b-instruct
                </span>
              </div>
              <div className="cs-spec-row">
                <span className="cs-spec-label">Llamada en Pi:</span>
                <span className="cs-spec-code">cpamc/nv/...</span>
              </div>
            </div>
          </div>
        </div>
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
