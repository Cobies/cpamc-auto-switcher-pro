import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAuditLog } from '../api/managementClient';
import './AuditLog.css';

function formatTimestamp(ts) {
  if (!ts) return '--';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour12: false }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function AuditLog() {
  const [data, setData] = useState({ audit_events: [], flight_recorder: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('ALL'); // ALL, PREVENTIVE, FAILOVER, GHOST_WARMUP, MANUAL
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAuditLog();
      if (res && res.ok) {
        setData({
          audit_events: Array.isArray(res.audit_events) ? res.audit_events : [],
          flight_recorder: Array.isArray(res.flight_recorder) ? res.flight_recorder : [],
        });
        setLastRefreshed(new Date());
      } else {
        setError(res?.message || 'Error al consultar la bitácora de auditoría');
      }
    } catch (err) {
      setError(err?.message || 'No se pudo conectar con el endpoint de auditoría');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto-refresh every 12 seconds
    const interval = setInterval(loadData, 12000);
    return () => clearInterval(interval);
  }, [loadData]);

  const filteredAudits = useMemo(() => {
    if (filterType === 'ALL') return data.audit_events;
    return data.audit_events.filter((e) => {
      const et = String(e.event_type || '').toUpperCase();
      if (filterType === 'MANUAL') {
        return et.includes('MANUAL');
      }
      return et === filterType;
    });
  }, [data.audit_events, filterType]);

  const counts = useMemo(() => {
    const total = data.audit_events.length;
    let preventive = 0;
    let failovers = 0;
    let warmups = 0;
    for (const e of data.audit_events) {
      const et = String(e.event_type || '').toUpperCase();
      if (et === 'PREVENTIVE') preventive++;
      else if (et === 'FAILOVER') failovers++;
      else if (et === 'GHOST_WARMUP') warmups++;
    }
    return {
      total,
      preventive,
      failovers,
      warmups,
      incidents: data.flight_recorder.length,
    };
  }, [data]);

  const handleExportForensicBundle = useCallback(() => {
    const maskEmail = (em) => {
      if (!em || typeof em !== 'string') return '--';
      const clean = em.replace(/^antigravity-/, '').replace(/\.json$/, '');
      const parts = clean.split('@');
      if (parts.length < 2) return clean;
      const user = parts[0];
      const domain = parts[1];
      const maskedUser = user.length > 5 ? `${user.slice(0, 3)}...${user.slice(-2)}` : `${user.slice(0, 2)}...`;
      return `${maskedUser}@${domain}`;
    };

    const bundle = {
      generator: 'CPAMC Auto Switcher Pro · Forensic Flight Recorder',
      exported_at: new Date().toISOString(),
      summary: counts,
      audit_events: data.audit_events.map((e) => ({
        ...e,
        previous_leader: maskEmail(e.previous_leader),
        new_leader: maskEmail(e.new_leader),
      })),
      flight_recorder: data.flight_recorder.map((f) => ({
        ...f,
        account_email: maskEmail(f.account_email),
      })),
    };

    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auto-switcher-forensic-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [counts, data]);

  return (
    <div className="audit-log-container" data-testid="audit-log-view">
      {/* Header */}
      <header className="audit-log-header">
        <div>
          <div className="audit-log-title-row">
            <span className="audit-log-icon">📜</span>
            <h2 className="audit-log-title">Bitácora de Auditoría & Caja Negra</h2>
          </div>
          <p className="audit-log-desc">
            Historial forense persistente en SQLite WAL (<code>rotations.db</code>). Trazabilidad de cada
            rotación preventiva, balanceo reactivo, pre-calentamiento fantasma (Ghost Warmup) e incidentes de red.
          </p>
        </div>
        <div className="audit-log-actions">
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              Actualizado: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            className="audit-btn-export"
            onClick={handleExportForensicBundle}
            disabled={loading || (data.audit_events.length === 0 && data.flight_recorder.length === 0)}
            data-testid="btn-export-forensic"
            title="Descarga un bundle forense anonimizado para soporte o auditoría"
          >
            <span>📦</span>
            <span>Descargar Reporte Forense</span>
          </button>
          <button
            type="button"
            className="audit-btn-refresh"
            onClick={loadData}
            disabled={loading}
            data-testid="btn-refresh-audit"
          >
            <span>🔄</span>
            <span>{loading ? 'Consultando...' : 'Refrescar'}</span>
          </button>
        </div>
      </header>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="audit-kpi-grid">
        <div className="audit-kpi-card">
          <div className="audit-kpi-label">Total Decisiones</div>
          <div className="audit-kpi-value">
            {counts.total}
            <span className="audit-kpi-sub">eventos</span>
          </div>
        </div>
        <div className="audit-kpi-card">
          <div className="audit-kpi-label">🛡️ Protección Preventiva</div>
          <div className="audit-kpi-value" style={{ color: '#34d399' }}>
            {counts.preventive}
            <span className="audit-kpi-sub">rotaciones</span>
          </div>
        </div>
        <div className="audit-kpi-card">
          <div className="audit-kpi-label">⚡ Rescates de Failover</div>
          <div className="audit-kpi-value" style={{ color: '#f87171' }}>
            {counts.failovers}
            <span className="audit-kpi-sub">rescates</span>
          </div>
        </div>
        <div className="audit-kpi-card">
          <div className="audit-kpi-label">👻 Ghost Warmups</div>
          <div className="audit-kpi-value" style={{ color: '#c084fc' }}>
            {counts.warmups}
            <span className="audit-kpi-sub">pre-calentados</span>
          </div>
        </div>
        <div className="audit-kpi-card">
          <div className="audit-kpi-label">🚨 Incidentes de Red / 429</div>
          <div className="audit-kpi-value" style={{ color: counts.incidents > 0 ? '#fbbf24' : '#94a3b8' }}>
            {counts.incidents}
            <span className="audit-kpi-sub">caja negra</span>
          </div>
        </div>
      </div>

      <div className="audit-sections-grid">
        {/* Section 1: Audit Log Table */}
        <section className="audit-card-section">
          <div className="audit-section-header">
            <h3 className="audit-section-title">
              <span>📋</span>
              <span>Bitácora de Decisiones & Rotaciones ({filteredAudits.length})</span>
            </h3>
            <div className="audit-filter-pills">
              {['ALL', 'PREVENTIVE', 'FAILOVER', 'GHOST_WARMUP', 'MANUAL'].map((ft) => (
                <button
                  key={ft}
                  type="button"
                  className={`audit-filter-pill ${filterType === ft ? 'active' : ''}`}
                  onClick={() => setFilterType(ft)}
                >
                  {ft === 'ALL' ? 'Todos' : ft}
                </button>
              ))}
            </div>
          </div>

          <div className="audit-table-wrapper">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Pool ID</th>
                  <th>Tipo</th>
                  <th>Flujo de Liderazgo</th>
                  <th>Motivo / Trigger</th>
                  <th>Latencia</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudits.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="audit-empty-state">
                      No hay eventos registrados bajo el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  filteredAudits.map((item, idx) => {
                    const badgeClass = `audit-badge-${item.event_type || 'MANUAL'}`;
                    const prevClean = (item.previous_leader || '--').replace(/^antigravity-/, '').replace(/\.json$/, '');
                    const newClean = (item.new_leader || '--').replace(/^antigravity-/, '').replace(/\.json$/, '');
                    return (
                      <tr key={item.id || idx}>
                        <td style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}>
                          {formatTimestamp(item.timestamp)}
                        </td>
                        <td style={{ fontWeight: 600, color: '#f1f5f9' }}>
                          {item.pool_id || 'Pool'}
                        </td>
                        <td>
                          <span className={`audit-badge-type ${badgeClass}`}>
                            {item.event_type}
                          </span>
                        </td>
                        <td>
                          <div className="audit-account-flow">
                            <span className="audit-prev-leader">{prevClean}</span>
                            <span className="audit-arrow">→</span>
                            <span className="audit-new-leader">{newClean}</span>
                          </div>
                        </td>
                        <td>
                          <code className="audit-reason-code">{item.trigger_reason || 'default'}</code>
                        </td>
                        <td style={{ color: '#94a3b8' }}>
                          {item.latency_ms ? `${item.latency_ms} ms` : '--'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 2: Flight Recorder Black Box */}
        <section className="audit-card-section">
          <div className="audit-section-header">
            <h3 className="audit-section-title">
              <span>🛡️</span>
              <span>Caja Negra Forense — Incidentes & Caídas ({data.flight_recorder.length})</span>
            </h3>
          </div>

          {data.flight_recorder.length === 0 ? (
            <div className="audit-empty-state">
              ✅ Ningún incidente de conexión o error 429 registrado en la caja negra.
            </div>
          ) : (
            <div className="flight-cards-grid">
              {data.flight_recorder.map((rec, idx) => (
                <div key={rec.id || idx} className="flight-incident-card">
                  <div className="flight-card-head">
                    <span className="flight-card-error-kind">{rec.error_kind || 'NETWORK_DROP'}</span>
                    <span className="flight-card-status">HTTP {rec.status_code || 500}</span>
                  </div>
                  <div className="flight-card-msg">
                    {rec.error_message || 'Sin mensaje de error reportado'}
                  </div>
                  <div className="flight-card-meta">
                    <span>Cuenta: {rec.account_email || 'desconocida'}</span>
                    <span>{formatTimestamp(rec.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
