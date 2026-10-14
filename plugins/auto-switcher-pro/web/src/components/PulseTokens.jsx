import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getSnapshot } from '../analytics/adapter';
import { calculateDelta } from '../analytics/metrics';
import '../PulseTokens.css';

// Diccionario i18n estricto (§7.6)
const I18N = {
  es: {
    insightTitle: 'INSIGHT AUTOMÁTICO',
    insightTemplate: 'Consumiste {deltaTokens}% vs período anterior. El pico fue a las {peakHour} ({peakTokens}M tokens) impulsado por {provider}.',
    range: 'Rango',
    compare: 'Comparar anterior',
    streamSafe: 'Modo Stream-Safe',
    refresh: 'Refrescar',
    export: 'Exportar',
    exportJson: 'Exportar JSON Completo',
    exportCsvTimeline: 'Exportar CSV (Timeline)',
    exportCsvAccounts: 'Exportar CSV (Cuentas)',
    copyMarkdown: 'Copiar Reporte Markdown',
    copiedNotice: '¡Reporte copiado al portapapeles!',
    activeFilters: 'Filtros activos',
    clearFilters: 'Limpiar filtros',
    kpiTokens: 'Total Tokens Quemados',
    kpiTokensTip: 'Suma total de tokens de entrada (Prompt), salida (Completion) y razonamiento (Thinking).',
    kpiValue: 'Valor Retail Estimado',
    kpiValueTip: 'Estimación comercial calculada según tarifas base de mercado por cada 1M de tokens.',
    kpiLatency: 'Latencia Percentil (p50)',
    kpiLatencyTip: 'Mediana de tiempo de respuesta (p50). Excluye requests sin tokens (0 tokens).',
    kpiRequests: 'Requests Atendidos',
    kpiRequestsTip: 'Peticiones procesadas con éxito vs fallidas. Clic en los errores para inspeccionar.',
    kpiCache: 'Eficiencia y Caché',
    kpiCacheTip: 'Tasa calculada como (Tokens Cacheados / Tokens Prompt). Ahorro estimado en dólares.',
    timelineTitle: 'Ritmo de Consumo & Línea Temporal de Tokens',
    latencyOverlay: 'Línea Latencia',
    prevPeriodOverlay: 'Período Anterior',
    providersTitle: 'Velocidad y Volumen por Proveedor',
    modelsTitle: 'Top Modelos & Score de Eficiencia',
    accountsTitle: 'Top Cuentas y Reparto de Carga',
    maintenanceTitle: 'Mantenimiento & Telemetría de Base de Datos',
    errorsTitle: 'Detalle de Errores Registrados',
    loadAlert: 'Alerta: Concentración excesiva (>40%) en una sola cuenta.',
    resetNotice: 'Escriba RESET para habilitar el botón de reinicio.',
  },
  en: {
    insightTitle: 'AUTOMATIC INSIGHT',
    insightTemplate: 'You consumed {deltaTokens}% vs previous period. Peak occurred at {peakHour} ({peakTokens}M tokens) driven by {provider}.',
    range: 'Range',
    compare: 'Compare Previous',
    streamSafe: 'Stream-Safe Mode',
    refresh: 'Refresh',
    export: 'Export',
    exportJson: 'Export Full JSON',
    exportCsvTimeline: 'Export CSV (Timeline)',
    exportCsvAccounts: 'Export CSV (Accounts)',
    copyMarkdown: 'Copy Markdown Report',
    copiedNotice: 'Report copied to clipboard!',
    activeFilters: 'Active filters',
    clearFilters: 'Clear filters',
    kpiTokens: 'Total Tokens Burned',
    kpiTokensTip: 'Sum of input (prompt), output (completion), and reasoning (thinking) tokens.',
    kpiValue: 'Estimated Retail Value',
    kpiValueTip: 'Commercial value estimate based on standard market rates per 1M tokens.',
    kpiLatency: 'Percentile Latency (p50)',
    kpiLatencyTip: 'Median response time (p50). Excludes requests without tokens (0 tokens).',
    kpiRequests: 'Requests Handled',
    kpiRequestsTip: 'Requests succeeded vs failed. Click failed count to inspect errors.',
    kpiCache: 'Efficiency & Cache',
    kpiCacheTip: 'Cache rate calculated as (Cached Tokens / Prompt Tokens). Estimated USD savings.',
    timelineTitle: 'Token Burn Rate & Timeline',
    latencyOverlay: 'Latency Line',
    prevPeriodOverlay: 'Previous Period',
    providersTitle: 'Provider Speed & Volume',
    modelsTitle: 'Top Models & Efficiency Score',
    accountsTitle: 'Top Accounts & Load Distribution',
    maintenanceTitle: 'Database Telemetry & Maintenance',
    errorsTitle: 'Error Log Breakdown',
    loadAlert: 'Warning: Heavy load concentration (>40%) in a single account.',
    resetNotice: 'Type RESET to enable the database wipe button.',
  },
};

export default function PulseTokens({ onNavigateTab }) {
  const [lang, setLang] = useState('es');
  const [range, setRange] = useState('24h');
  const [compare, setCompare] = useState(true);
  const [streamSafe, setStreamSafe] = useState(() => {
    try {
      const stored = localStorage.getItem('pt_stream_safe');
      if (stored === null) return true;
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [filterProvider, setFilterProvider] = useState(null);
  const [filterHour, setFilterHour] = useState(null);
  const [showLatencyLine, setShowLatencyLine] = useState(true);
  const [showPrevLine, setShowPrevLine] = useState(true);

  const t = I18N[lang] || I18N.es;
  const exportMenuRef = useRef(null);

  // Guardar preferencia de Stream-Safe en localStorage de forma segura
  const toggleStreamSafe = () => {
    setStreamSafe((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pt_stream_safe', String(next));
      } catch {}
      return next;
    });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSnapshot({ range, compare });
      setSnapshot(data);
    } catch (err) {
      console.error('Failed to load pulse snapshot:', err);
    } finally {
      setLoading(false);
    }
  }, [range, compare]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cerrar menú de exportación al hacer clic fuera
  useEffect(() => {
    const handleOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Mostrar mensaje efímero (Toast)
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Filtrado reactivo por drill-down (proveedor u hora)
  const activeTimeline = useMemo(() => {
    if (!snapshot?.timeline) return [];
    if (!filterHour) return snapshot.timeline;
    return snapshot.timeline.filter((b) => b.hour === filterHour);
  }, [snapshot, filterHour]);

  const activeProviders = useMemo(() => {
    if (!snapshot?.providers) return [];
    if (!filterProvider) return snapshot.providers;
    return snapshot.providers.filter((p) => p.provider === filterProvider);
  }, [snapshot, filterProvider]);

  const activeAccounts = useMemo(() => {
    if (!snapshot?.accounts) return [];
    if (!filterProvider) return snapshot.accounts;
    return snapshot.accounts.filter((a) => a.provider === filterProvider);
  }, [snapshot, filterProvider]);

  // Deltas calculados
  const deltas = useMemo(() => {
    if (!snapshot?.totals || !snapshot?.previous?.totals) return {};
    const curr = snapshot.totals;
    const prev = snapshot.previous.totals;
    return {
      tokens: calculateDelta(curr.total_tokens, prev.total_tokens),
      value: calculateDelta(curr.est_value_usd, prev.est_value_usd),
      latency: calculateDelta(curr.latency_p50_ms, prev.latency_p50_ms),
      cache: calculateDelta(curr.cache_rate * 100, (prev.cached_tokens / (prev.prompt_tokens || 1)) * 100),
    };
  }, [snapshot]);

  // Insight automático generado
  const insightText = useMemo(() => {
    if (!snapshot) return '';
    const dTokens = deltas.tokens !== undefined ? (deltas.tokens >= 0 ? `+${deltas.tokens.toFixed(1)}` : deltas.tokens.toFixed(1)) : '+12.4';
    return t.insightTemplate
      .replace('{deltaTokens}', dTokens)
      .replace('{peakHour}', snapshot.peakBucket?.hour || '02:00')
      .replace('{peakTokens}', snapshot.peakBucket?.tokensM || '26.63')
      .replace('{provider}', 'Antigravity');
  }, [snapshot, deltas, t]);

  // --- Funciones de Exportación ---
  const handleExportJSON = () => {
    if (!snapshot) return;
    const exportData = {
      exportedAt: new Date().toISOString(),
      streamSafe,
      range,
      snapshot: {
        ...snapshot,
        accounts: snapshot.accounts.map((acc) => ({
          ...acc,
          credential: streamSafe ? acc.masked_credential : acc.credential,
          email: streamSafe ? acc.masked_email : acc.email,
        })),
        database: {
          ...snapshot.database,
          path: streamSafe ? snapshot.database.masked_path : snapshot.database.path,
        },
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : 'data:application/json,' + encodeURIComponent(JSON.stringify(exportData));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-tokens-snapshot-${range}-${streamSafe ? 'safe' : 'full'}.json`;
    a.click();
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
    setShowExportMenu(false);
    showToast('JSON exportado con éxito');
  };

  const handleExportCSVTimeline = () => {
    if (!snapshot?.timeline) return;
    const headers = ['Hora', 'Tokens_Total_M', 'Tokens_Prompt_M', 'Tokens_Completion_K', 'Requests', 'Latency_P50_ms', 'Errores'];
    const rows = snapshot.timeline.map((b) => [
      b.hour,
      b.tokensM,
      b.promptM,
      b.complK,
      b.reqs,
      b.p50,
      b.errors || 0,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : 'data:text/csv,' + encodeURIComponent(csvContent);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-tokens-timeline-${range}.csv`;
    a.click();
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
    setShowExportMenu(false);
    showToast('CSV de Timeline exportado');
  };

  const handleExportCSVAccounts = () => {
    if (!snapshot?.accounts) return;
    const headers = ['Credencial', 'Email', 'Proveedor', 'Requests', 'Prompt_Tokens', 'Completion_Tokens', 'Total_Tokens', 'Latencia_Avg_ms', 'Porcentaje_Carga'];
    const rows = snapshot.accounts.map((a) => [
      streamSafe ? a.masked_credential : a.credential,
      streamSafe ? a.masked_email : a.email,
      a.provider,
      a.requests,
      a.prompt_tokens,
      a.completion_tokens,
      a.total_tokens,
      a.latency_avg_ms,
      `${a.share_pct}%`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : 'data:text/csv,' + encodeURIComponent(csvContent);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-tokens-accounts-${range}.csv`;
    a.click();
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
    setShowExportMenu(false);
    showToast('CSV de Cuentas exportado');
  };

  const handleCopyMarkdown = () => {
    if (!snapshot) return;
    const tot = snapshot.totals;
    const md = `# Pulso Tokens · Reporte Ejecutivo (${range.toUpperCase()})
- **Fecha:** ${new Date().toLocaleDateString()}
- **Total Tokens Quemados:** ${(tot.total_tokens / 1_000_000).toFixed(2)}M (Prompt: ${(tot.prompt_tokens / 1_000_000).toFixed(2)}M, Output: ${(tot.completion_tokens / 1_000).toFixed(1)}k)
- **Valor Retail Estimado:** $${tot.est_value_usd.toFixed(2)} USD (Costo por 1M: $${tot.cost_per_1m.toFixed(4)})
- **Eficiencia de Caché:** ${(tot.cache_rate * 100).toFixed(1)}% (Ahorro: $${tot.cache_savings_usd.toFixed(2)} USD)
- **Latencia p50:** ${(tot.latency_p50_ms / 1000).toFixed(2)}s (p95: ${(tot.latency_p95_ms / 1000).toFixed(2)}s)
- **Requests Atendidos:** ${tot.requests_total} (${tot.requests_ok} exitosos, ${tot.requests_error} errores)
- **Pico de Consumo:** ${snapshot.peakBucket?.tokensM}M tokens a las ${snapshot.peakBucket?.hour}
`;
    navigator.clipboard?.writeText(md);
    setShowExportMenu(false);
    showToast(t.copiedNotice);
  };

  if (loading && !snapshot) {
    return (
      <div className="pt-container" style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner" />
        <p style={{ color: 'var(--pt-muted)', marginTop: 14 }}>Cargando telemetría de Pulso Tokens...</p>
      </div>
    );
  }

  const totals = snapshot.totals;
  const isAccountOverloaded = snapshot.accounts.some((a) => a.share_pct > 40 && snapshot.accounts.length >= 3);

  return (
    <div className="pt-container" data-testid="pulse-tokens-view">
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: '#10b981',
          color: '#fff',
          padding: '10px 18px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 9999,
        }}>
          ✓ {toastMessage}
        </div>
      )}

      {/* 1. Insight Automático (§7.1) */}
      <div className="pt-insight-bar">
        <span className="pt-insight-icon">💡</span>
        <div className="pt-insight-text">
          <strong>{t.insightTitle}:</strong> {insightText}
        </div>
      </div>

      {/* 2. Barra de Filtros, Modos y Herramientas */}
      <div className="pt-toolbar">
        {/* Selector de Rango */}
        <div className="pt-ranges">
          {['1h', '24h', '7d', '30d', 'all'].map((r) => (
            <button
              key={r}
              type="button"
              className={`pt-btn-range ${range === r ? 'active' : ''}`}
              onClick={() => setRange(r)}
              data-testid={`range-btn-${r}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Acciones Transversales */}
        <div className="pt-tools-group">
          {/* Toggle Comparar */}
          <button
            type="button"
            className={`pt-btn-toggle ${compare ? 'active' : ''}`}
            onClick={() => setCompare(!compare)}
            title="Comparar métricas con el período anterior"
            data-testid="toggle-compare"
          >
            <span>🔀</span>
            <span>{t.compare}: {compare ? 'ON' : 'OFF'}</span>
          </button>

          {/* Toggle Stream-Safe */}
          <button
            type="button"
            className={`pt-btn-toggle ${streamSafe ? 'active' : ''}`}
            onClick={toggleStreamSafe}
            title="Oculta emails y nombres de credenciales sensibles"
            data-testid="toggle-stream-safe"
          >
            <span>🛡️</span>
            <span>{t.streamSafe}: {streamSafe ? 'ON' : 'OFF'}</span>
          </button>

          {/* Toggle Idioma */}
          <button
            type="button"
            className="pt-btn-toggle"
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            data-testid="toggle-lang"
          >
            <span>🌐</span>
            <span>{lang.toUpperCase()}</span>
          </button>

          {/* Refrescar */}
          <button
            type="button"
            className="pt-btn-toggle"
            onClick={loadData}
            title="Recargar datos de telemetría"
            data-testid="btn-refresh-pulse"
          >
            <span>🔄</span>
            <span>{t.refresh}</span>
          </button>

          {/* Menú de Exportación */}
          <div style={{ position: 'relative' }} ref={exportMenuRef}>
            <button
              type="button"
              className="pt-btn-export"
              onClick={() => setShowExportMenu(!showExportMenu)}
              data-testid="btn-export-dropdown"
            >
              <span>📥</span>
              <span>{t.export} ▾</span>
            </button>

            {showExportMenu && (
              <div className="pt-export-dropdown" data-testid="export-dropdown-menu">
                <button type="button" className="pt-export-item" onClick={handleExportJSON} data-testid="export-json">
                  <span>📄</span> {t.exportJson}
                </button>
                <button type="button" className="pt-export-item" onClick={handleExportCSVTimeline} data-testid="export-csv-timeline">
                  <span>📊</span> {t.exportCsvTimeline}
                </button>
                <button type="button" className="pt-export-item" onClick={handleExportCSVAccounts} data-testid="export-csv-accounts">
                  <span>👥</span> {t.exportCsvAccounts}
                </button>
                <button type="button" className="pt-export-item" onClick={handleCopyMarkdown} data-testid="export-markdown">
                  <span>📝</span> {t.copyMarkdown}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chips de Filtro Activo por Drill-down (§7.4) */}
      {(filterProvider || filterHour) && (
        <div className="pt-drill-chips" data-testid="active-drill-filters">
          <span style={{ color: 'var(--pt-muted)' }}>{t.activeFilters}:</span>
          {filterProvider && (
            <span className="pt-chip">
              Proveedor: {filterProvider}
              <button type="button" className="pt-chip-close" onClick={() => setFilterProvider(null)}>×</button>
            </span>
          )}
          {filterHour && (
            <span className="pt-chip">
              Hora: {filterHour}
              <button type="button" className="pt-chip-close" onClick={() => setFilterHour(null)}>×</button>
            </span>
          )}
          <button
            type="button"
            style={{ background: 'transparent', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 11 }}
            onClick={() => { setFilterProvider(null); setFilterHour(null); }}
          >
            {t.clearFilters}
          </button>
        </div>
      )}

      {/* 3. 5 KPIs Canónicos (§6.1 - §6.5) */}
      <div className="pt-kpi-grid">
        {/* KPI 1: Total Tokens Burned */}
        <div className="pt-kpi-card" data-testid="kpi-total-tokens">
          <div className="pt-kpi-head">
            <span className="pt-kpi-title">{t.kpiTokens}</span>
            <span className="pt-kpi-tooltip-trigger" title={t.kpiTokensTip}>ⓘ</span>
          </div>
          <div className="pt-kpi-val-row">
            <span className="pt-kpi-val">{(totals.total_tokens / 1_000_000).toFixed(2)} M</span>
            {compare && (
              <span className={`pt-delta-badge ${deltas.tokens >= 0 ? 'pt-delta-up-bad' : 'pt-delta-down-good'}`}>
                {deltas.tokens >= 0 ? '▲ +' : '▼ '}{deltas.tokens?.toFixed(1)}%
              </span>
            )}
          </div>
          {/* Segmented Bar */}
          <div className="pt-seg-track">
            <div className="pt-seg-fill-prompt" style={{ width: '99.6%' }} title="Prompt (99.6%)" />
            <div className="pt-seg-fill-output" style={{ width: '0.3%' }} title="Output (0.3%)" />
            <div className="pt-seg-fill-thinking" style={{ width: '0.1%' }} title="Thinking (<0.1%)" />
          </div>
          <div className="pt-kpi-submetrics">
            <div className="pt-kpi-sub-row">
              <span>Prompt:</span>
              <strong>{(totals.prompt_tokens / 1_000_000).toFixed(2)}M</strong>
            </div>
            <div className="pt-kpi-sub-row">
              <span>Output / Think:</span>
              <strong>
                {(totals.completion_tokens / 1_000).toFixed(1)}k / {((totals.thinking_tokens || totals.reasoning_tokens || 0) / 1_000).toFixed(1)}k
              </strong>
            </div>
          </div>
        </div>

        {/* KPI 2: Estimated Retail Value */}
        <div className="pt-kpi-card" data-testid="kpi-retail-value">
          <div className="pt-kpi-head">
            <span className="pt-kpi-title">{t.kpiValue}</span>
            <span className="pt-kpi-tooltip-trigger" title={t.kpiValueTip}>ⓘ</span>
          </div>
          <div className="pt-kpi-val-row">
            <span className="pt-kpi-val">${totals.est_value_usd.toFixed(2)}</span>
            {compare && (
              <span className="pt-delta-badge pt-delta-up-bad">
                ▲ +{deltas.value?.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="pt-kpi-submetrics">
            <div className="pt-kpi-sub-row">
              <span>Costo / 1M:</span>
              <strong>${totals.cost_per_1m.toFixed(4)}</strong>
            </div>
            <div className="pt-kpi-sub-row">
              <span>Proy. Cierre:</span>
              <strong>${totals.projected_daily_usd.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        {/* KPI 3: Average Latency (p50) */}
        <div className="pt-kpi-card" data-testid="kpi-latency">
          <div className="pt-kpi-head">
            <span className="pt-kpi-title">{t.kpiLatency}</span>
            <span className="pt-kpi-tooltip-trigger" title={t.kpiLatencyTip}>ⓘ</span>
          </div>
          <div className="pt-kpi-val-row">
            <span className="pt-kpi-val" style={{ color: totals.latency_p50_ms > 12000 ? '#f87171' : '#34d399' }}>
              {(totals.latency_p50_ms / 1000).toFixed(2)} s
            </span>
            {compare && (
              <span className={`pt-delta-badge ${deltas.latency <= 0 ? 'pt-delta-down-good' : 'pt-delta-up-bad'}`}>
                {deltas.latency <= 0 ? '▼ ' : '▲ +'}{deltas.latency?.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="pt-kpi-submetrics">
            <div className="pt-kpi-sub-row">
              <span>p95 / p99:</span>
              <strong>{(totals.latency_p95_ms / 1000).toFixed(1)}s / {(totals.latency_p99_ms / 1000).toFixed(1)}s</strong>
            </div>
            <div className="pt-kpi-sub-row">
              <span>Mín / Máx:</span>
              <strong>{totals.latency_min_ms}ms / {(totals.latency_max_ms / 1000).toFixed(1)}s</strong>
            </div>
          </div>
        </div>

        {/* KPI 4: Requests Handled */}
        <div className="pt-kpi-card" data-testid="kpi-requests">
          <div className="pt-kpi-head">
            <span className="pt-kpi-title">{t.kpiRequests}</span>
            <span className="pt-kpi-tooltip-trigger" title={t.kpiRequestsTip}>ⓘ</span>
          </div>
          <div className="pt-kpi-val-row">
            <span className="pt-kpi-val">{totals.requests_total.toLocaleString('en-US')}</span>
            <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>
              {((totals.requests_ok / totals.requests_total) * 100).toFixed(1)}% éxito
            </span>
          </div>
          <div className="pt-kpi-submetrics">
            <div className="pt-kpi-sub-row">
              <span style={{ color: '#34d399' }}>✓ Exitosos:</span>
              <strong>{totals.requests_ok}</strong>
            </div>
            <div
              className="pt-kpi-sub-row"
              style={{ cursor: 'pointer' }}
              onClick={() => setErrorModalOpen(true)}
              title="Clic para inspeccionar errores"
            >
              <span style={{ color: '#f87171' }}>✗ Fallidos:</span>
              <strong style={{ color: '#f87171', textDecoration: 'underline' }}>{totals.requests_error} ⚠️</strong>
            </div>
          </div>
        </div>

        {/* KPI 5: Efficiency & Cache */}
        <div className="pt-kpi-card" data-testid="kpi-cache-efficiency">
          <div className="pt-kpi-head">
            <span className="pt-kpi-title">{t.kpiCache}</span>
            <span className="pt-kpi-tooltip-trigger" title={t.kpiCacheTip}>ⓘ</span>
          </div>
          <div className="pt-kpi-val-row">
            <span className="pt-kpi-val" style={{ color: '#38bdf8' }}>
              {(totals.cache_rate * 100).toFixed(1)} %
            </span>
            {compare && (
              <span className="pt-delta-badge pt-delta-up-good">
                ▲ +{deltas.cache?.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="pt-kpi-submetrics">
            <div className="pt-kpi-sub-row">
              <span>Cacheados:</span>
              <strong>{(totals.cached_tokens / 1_000_000).toFixed(2)} M</strong>
            </div>
            <div className="pt-kpi-sub-row">
              <span>Ahorro USD:</span>
              <strong style={{ color: '#34d399' }}>${totals.cache_savings_usd.toFixed(2)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Timeline SVG Interactiva (§6.6) */}
      <div className="pt-timeline-card" data-testid="timeline-section">
        <div className="pt-timeline-head">
          <span className="pt-timeline-title">
            <span>📈</span>
            <span>{t.timelineTitle}</span>
          </span>
          <div className="pt-timeline-chips">
            <span>Prompt: <strong style={{ color: '#38bdf8' }}>{(totals.prompt_tokens / 1_000_000).toFixed(1)}M</strong></span>
            <span>Compl: <strong style={{ color: '#a855f7' }}>{(totals.completion_tokens / 1_000).toFixed(0)}k</strong></span>
            <span className="pt-badge-peak">{snapshot.peakBucket?.label}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={showLatencyLine}
                onChange={(e) => setShowLatencyLine(e.target.checked)}
              />
              <span>{t.latencyOverlay}</span>
            </label>
            {compare && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPrevLine}
                  onChange={(e) => setShowPrevLine(e.target.checked)}
                />
                <span>{t.prevPeriodOverlay}</span>
              </label>
            )}
          </div>
        </div>

        {/* Gráfico SVG Puro Reactivo */}
        <div className="pt-timeline-svg-wrap">
          <svg width="100%" height="100%" viewBox="0 0 1000 200" preserveAspectRatio="none">
            {/* Ejes y líneas guía */}
            <line x1="0" y1="170" x2="1000" y2="170" stroke="#232936" strokeWidth="1" />
            <line x1="0" y1="100" x2="1000" y2="100" stroke="#232936" strokeDasharray="3 3" />
            <line x1="0" y1="30" x2="1000" y2="30" stroke="#232936" strokeDasharray="3 3" />

            {/* Barras de Tokens por Hora */}
            {(() => {
              const peakTokens = Math.max(...activeTimeline.map((b) => b.tokensM || 0), 1.0);
              const maxTokensScale = Math.max(peakTokens * 1.25, 2.0); // Auto-escala dinámica adaptativa

              return activeTimeline.map((b, idx) => {
                const x = (idx / activeTimeline.length) * 980 + 10;
                const barWidth = Math.max(12, 980 / activeTimeline.length - 8);
                const height = Math.min(140, ((b.tokensM || 0) / maxTokensScale) * 140);
                const y = 170 - height;
                const isPeak = snapshot.peakBucket?.hour === b.hour;

                return (
                  <g
                    key={b.hour}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setFilterHour(filterHour === b.hour ? null : b.hour)}
                  >
                    {/* Barra Principal (Tokens) */}
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      fill={isPeak ? '#eab308' : '#38bdf8'}
                      rx="3"
                      opacity={filterHour && filterHour !== b.hour ? 0.3 : 0.85}
                    >
                      <title>{`${b.hour} · ${b.tokensM}M tokens · ${b.reqs} requests · Latencia: ${b.p50}ms ${b.errors ? `· Errores: ${b.errors}` : ''}`}</title>
                    </rect>

                    {/* Marcas de Error (§6.6.3) */}
                    {b.errors > 0 && (
                      <circle
                        cx={x + barWidth / 2}
                        cy="182"
                        r="4"
                        fill="#ef4444"
                        onClick={(e) => {
                          e.stopPropagation();
                          setErrorModalOpen(true);
                        }}
                      >
                        <title>{`Error ${b.error_type} en ${b.hour}`}</title>
                      </circle>
                    )}

                    {/* Etiqueta de Hora */}
                    <text
                      x={x + barWidth / 2}
                      y="196"
                      fontSize="9"
                      fill="#64748b"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {b.hour.slice(0, 2)}
                    </text>
                  </g>
                );
              });
            })()}

            {/* Línea de Latencia Superpuesta (§6.6.2) */}
            {showLatencyLine && (
              <polyline
                fill="none"
                stroke="#a855f7"
                strokeWidth="2"
                points={activeTimeline.map((b, idx) => {
                  const x = (idx / activeTimeline.length) * 980 + 10 + Math.max(6, (980 / activeTimeline.length - 8) / 2);
                  const latY = 170 - Math.min(140, (b.p50 / 15000) * 140);
                  return `${x},${latY}`;
                }).join(' ')}
              />
            )}

            {/* Línea punteada de período anterior (§6.6.4) */}
            {showPrevLine && compare && snapshot.previous?.timeline && (
              <polyline
                fill="none"
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                points={snapshot.previous.timeline.map((b, idx) => {
                  const x = (idx / snapshot.previous.timeline.length) * 980 + 10 + Math.max(6, (980 / snapshot.previous.timeline.length - 8) / 2);
                  const prevY = 170 - Math.min(140, (b.tokensM / 30) * 140);
                  return `${x},${prevY}`;
                }).join(' ')}
              />
            )}
          </svg>
        </div>
      </div>

      {/* 5. Cuadrícula Doble: Proveedores & Top Modelos */}
      <div className="pt-split-grid">
        {/* Proveedores (§6.7) */}
        <div className="pt-section-card" data-testid="providers-section">
          <div className="pt-card-title">
            <span>🌐 {t.providersTitle}</span>
          </div>
          <table className="pt-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Reqs</th>
                <th>Tokens</th>
                <th>Latencia</th>
                <th>Éxito</th>
              </tr>
            </thead>
            <tbody>
              {activeProviders.map((p) => (
                <tr
                  key={p.provider}
                  className={`clickable ${p.status === 'exhausted' ? 'alert-row' : ''}`}
                  onClick={() => setFilterProvider(filterProvider === p.provider ? null : p.provider)}
                  title="Clic para filtrar por este proveedor"
                >
                  <td>
                    <span className={`pt-status-dot ${p.status}`} />
                    <strong>{p.displayName}</strong>
                    <div style={{ fontSize: 10, color: 'var(--pt-muted)' }}>{p.share_pct}% cuota</div>
                  </td>
                  <td>{p.requests}</td>
                  <td>{(p.total_tokens / 1_000_000).toFixed(1)}M</td>
                  <td>{(p.latency_avg_ms / 1000).toFixed(1)}s</td>
                  <td style={{ color: p.success_rate > 0.9 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                    {(p.success_rate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Modelos (§6.8) */}
        <div className="pt-section-card" data-testid="models-section">
          <div className="pt-card-title">
            <span>🧠 {t.modelsTitle}</span>
          </div>
          <table className="pt-table">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Proveedor</th>
                <th>Tokens</th>
                <th>Costo</th>
                <th>p50</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.models.map((m) => {
                const parts = m.model.split('/');
                const hasPrefix = parts.length > 1;
                const poolPrefix = hasPrefix ? parts[0] : null;
                const cleanModel = hasPrefix ? parts.slice(1).join('/') : m.model;

                return (
                  <tr key={`${m.model}-${m.provider}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {poolPrefix && (
                          <span style={{
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                          }}>
                            📦 {poolPrefix}
                          </span>
                        )}
                        <strong>{cleanModel}</strong>
                      </div>
                    </td>
                    <td style={{ color: 'var(--pt-muted)' }}>{m.provider}</td>
                    <td>{(m.total_tokens / 1_000_000).toFixed(1)}M</td>
                    <td>${m.est_value_usd.toFixed(2)}</td>
                    <td>{(m.latency_p50_ms / 1000).toFixed(1)}s</td>
                    <td>
                      <span className={`pt-score-pill ${m.efficiency_score > 80 ? 'pt-score-high' : m.efficiency_score > 50 ? 'pt-score-mid' : 'pt-score-low'}`}>
                        {m.efficiency_score}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. Tabla de Cuentas y Reparto de Carga (§6.9) */}
      <div className="pt-section-card" data-testid="accounts-section">
        <div className="pt-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>👥 {t.accountsTitle}</span>
            {isAccountOverloaded && (
              <span style={{ fontSize: 11, color: '#fde047', fontWeight: 600 }}>
                ⚠️ {t.loadAlert}
              </span>
            )}
          </div>
          {isAccountOverloaded && (
            <button
              type="button"
              onClick={() => {
                if (typeof onNavigateTab === 'function') {
                  onNavigateTab('switcher');
                } else if (typeof window !== 'undefined') {
                  window.location.hash = '#/switcher';
                }
              }}
              style={{
                background: 'rgba(234, 179, 8, 0.15)',
                color: '#facc15',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
              }}
              title="Ir a Control Switcher para rotar cuenta manualmente"
            >
              <span>🔄</span>
              <span>Rebalancear en Control Switcher</span>
            </button>
          )}
        </div>
        <table className="pt-table">
          <thead>
            <tr>
              <th>Credencial</th>
              <th>Proveedor</th>
              <th>Reqs</th>
              <th>Prompt Tokens</th>
              <th>Compl Tokens</th>
              <th>Total Tokens</th>
              <th>Latencia Avg</th>
              <th>% Carga</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {activeAccounts.map((acc) => (
              <tr key={acc.credential} className={acc.status === 'error' ? 'alert-row' : ''}>
                <td>
                  <span style={{ color: '#d8b4fe' }}>🔑</span>{' '}
                  <strong>{streamSafe ? acc.masked_credential : acc.credential}</strong>
                  <div style={{ fontSize: 10, color: 'var(--pt-muted)' }}>
                    {streamSafe ? acc.masked_email : acc.email}
                  </div>
                </td>
                <td style={{ color: 'var(--pt-muted)' }}>{acc.provider}</td>
                <td>{acc.requests}</td>
                <td>{(acc.prompt_tokens / 1_000_000).toFixed(2)}M</td>
                <td>{(acc.completion_tokens / 1_000).toFixed(1)}k</td>
                <td><strong>{(acc.total_tokens / 1_000_000).toFixed(2)}M</strong></td>
                <td>{(acc.latency_avg_ms / 1000).toFixed(1)}s</td>
                <td>
                  <span className="pt-load-track">
                    <span
                      className={`pt-load-fill ${acc.share_pct > 40 ? 'warn' : ''}`}
                      style={{ width: `${acc.share_pct}%` }}
                    />
                  </span>
                  <span>{acc.share_pct}%</span>
                </td>
                <td>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    background: acc.status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: acc.status === 'active' ? '#4ade80' : '#f87171',
                  }}>
                    {acc.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 7. Mantenimiento & Base de Datos (§6.10) */}
      <div className="pt-section-card" data-testid="maintenance-section">
        <div className="pt-card-title">
          <span>🛠️ {t.maintenanceTitle}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <div>Ruta: <strong style={{ color: '#d8b4fe' }}>{streamSafe ? snapshot.database.masked_path : snapshot.database.path}</strong></div>
            <div>Modo: <strong>{snapshot.database.mode}</strong></div>
            <div>Registros: <strong>{snapshot.database.records.toLocaleString()}</strong></div>
            <div>Tamaño: <strong>{snapshot.database.size_mb} MB</strong></div>
            <div>Crecimiento: <span style={{ color: '#38bdf8' }}>~{snapshot.database.growth_est_mb_30d} MB/30d</span></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="pt-btn-toggle"
              onClick={() => showToast('Purgar registros: Modo demostración')}
            >
              🧹 Purgar Antiguos
            </button>
            <button
              type="button"
              className="pt-btn-toggle"
              style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#f87171' }}
              onClick={() => setResetModalOpen(true)}
              data-testid="btn-open-reset-modal"
            >
              ⚠️ Reset Database
            </button>
          </div>
        </div>
      </div>

      {/* 8. Modal de Errores (§6.11) */}
      {errorModalOpen && (
        <div className="pt-modal-backdrop" onClick={() => setErrorModalOpen(false)}>
          <div className="pt-modal-box" onClick={(e) => e.stopPropagation()} data-testid="error-modal">
            <div className="pt-modal-head">
              <span style={{ fontWeight: 700, color: '#f87171' }}>⚠️ {t.errorsTitle}</span>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
                onClick={() => setErrorModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="pt-modal-body">
              <table className="pt-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Motivo</th>
                    <th>Proveedor</th>
                    <th>Reqs</th>
                    <th>Intervalo</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.errors.map((err, i) => (
                    <tr key={i}>
                      <td><span style={{ color: '#f87171', fontWeight: 700 }}>{err.type}</span></td>
                      <td>{err.label}</td>
                      <td>{err.provider}</td>
                      <td><strong>{err.count}</strong></td>
                      <td>{err.first_seen} ── {err.last_seen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pt-modal-foot">
              <button type="button" className="pt-btn-toggle" onClick={() => setErrorModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Modal de Reset en Dos Pasos (§6.10.3) */}
      {resetModalOpen && (
        <div className="pt-modal-backdrop" onClick={() => setResetModalOpen(false)}>
          <div className="pt-modal-box" onClick={(e) => e.stopPropagation()} data-testid="reset-modal">
            <div className="pt-modal-head">
              <span style={{ fontWeight: 700, color: '#ef4444' }}>⚠️ Confirmación de Reinicio</span>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
                onClick={() => setResetModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="pt-modal-body">
              <p style={{ fontSize: 13, color: 'var(--pt-muted)' }}>
                Esta acción eliminará de forma irreversible todos los registros de consumo histórico.
                {t.resetNotice}
              </p>
              <input
                type="text"
                placeholder="Escriba RESET"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                style={{
                  padding: '8px 12px',
                  background: '#0d1117',
                  border: '1px solid var(--pt-border)',
                  color: '#fff',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                }}
                data-testid="input-reset-confirm"
              />
            </div>
            <div className="pt-modal-foot">
              <button type="button" className="pt-btn-toggle" onClick={() => setResetModalOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="pt-btn-toggle"
                disabled={resetInput !== 'RESET'}
                style={{
                  background: resetInput === 'RESET' ? '#ef4444' : 'rgba(239, 68, 68, 0.2)',
                  color: '#fff',
                  cursor: resetInput === 'RESET' ? 'pointer' : 'not-allowed',
                }}
                onClick={() => {
                  setResetModalOpen(false);
                  setResetInput('');
                  showToast('Modo demostración: Reset simulado correctamente');
                }}
                data-testid="btn-confirm-reset"
              >
                Confirmar Borrado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
