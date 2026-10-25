import React, { useEffect, useState } from 'react';
import { fetchGuardIncident } from '../api/managementClient';
import './IncidentModal.css';

function formatTimestamp(ts) {
  if (!ts) return '--';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour12: false }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function IncidentModal({ isOpen, incidentId, initialData = null, onClose }) {
  const [incident, setIncident] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIncident(null);
      setError('');
      return;
    }

    if (initialData) {
      setIncident(initialData);
      return;
    }

    if (incidentId) {
      setLoading(true);
      setError('');
      fetchGuardIncident(incidentId)
        .then((res) => {
          if (res && res.ok && res.incident) {
            setIncident(res.incident);
          } else {
            setError(res?.message || 'No se encontró el registro del incidente en SQLite.');
          }
        })
        .catch((err) => {
          setError(err?.message || 'Error al conectar con la base de datos de incidentes.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, incidentId, initialData]);

  if (!isOpen) return null;

  const copyTrace = () => {
    if (!incident) return;
    const jsonStr = JSON.stringify(incident, null, 2);
    navigator.clipboard?.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getReasonBadge = (type) => {
    switch (type) {
      case 'CYCLE_DETECTED':
        return <span className="incident-badge badge-cycle">🔄 Bucle Cíclico Repetitivo</span>;
      case 'STEP_BUDGET_EXCEEDED':
        return <span className="incident-badge badge-budget">🛑 Límite de 15 Acciones Excedido</span>;
      case 'PROHIBITED_COMMAND':
        return <span className="incident-badge badge-prohibited">🚫 Comando Host Prohibido (objdump/docker)</span>;
      default:
        return <span className="incident-badge badge-generic">⚡ Disyuntor Activado</span>;
    }
  };

  return (
    <div className="incident-modal-backdrop" onClick={onClose}>
      <div className="incident-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="incident-modal-header">
          <div className="incident-modal-title">
            <span className="incident-title-icon">🛡️</span>
            <div>
              <h3>Autopsia Forense de Disyuntor Anti-Bucle</h3>
              <p className="incident-subtitle">
                Registro inmutable auditado en rotations.db (SQLite)
              </p>
            </div>
          </div>
          <button type="button" className="incident-close-btn" onClick={onClose} title="Cerrar">
            ✕
          </button>
        </div>

        <div className="incident-modal-body">
          {loading && (
            <div className="incident-loading-state">
              <span className="spinner">⏳</span> Consultando base de datos SQLite...
            </div>
          )}

          {error && (
            <div className="incident-error-state">
              ⚠️ {error}
            </div>
          )}

          {incident && !loading && (
            <>
              <div className="incident-meta-grid">
                <div className="incident-meta-item">
                  <span className="meta-label">ID Incidente:</span>
                  <span className="meta-val mono">{incident.id}</span>
                </div>
                <div className="incident-meta-item">
                  <span className="meta-label">Fecha y Hora:</span>
                  <span className="meta-val">{formatTimestamp(incident.timestamp)}</span>
                </div>
                <div className="incident-meta-item">
                  <span className="meta-label">Causa de Intercepción:</span>
                  <span className="meta-val">{getReasonBadge(incident.incident_type)}</span>
                </div>
                <div className="incident-meta-item">
                  <span className="meta-label">Estado de Mitigación:</span>
                  <span className="meta-val status-mitigated">✅ Mitigado (Turno Frenado)</span>
                </div>
                <div className="incident-meta-item">
                  <span className="meta-label">Tokens Preservados:</span>
                  <span className="meta-val token-savings">
                    ~{(incident.tokens_saved || 45000).toLocaleString()} tokens protegidos
                  </span>
                </div>
                <div className="incident-meta-item">
                  <span className="meta-label">Pool Afectado:</span>
                  <span className="meta-val">{incident.pool_id || 'Sesión Pi activa'}</span>
                </div>
              </div>

              {incident.trigger_command && (
                <div className="incident-section">
                  <div className="section-title">⚡ Comando Desencadenante (Trigger)</div>
                  <pre className="incident-code-box trigger-box">
                    <code>{incident.trigger_command}</code>
                  </pre>
                </div>
              )}

              <div className="incident-section">
                <div className="section-title">
                  📜 Traza de Comandos Previos ({incident.command_trace?.length || 0} pasos)
                </div>
                {Array.isArray(incident.command_trace) && incident.command_trace.length > 0 ? (
                  <div className="incident-trace-list">
                    {incident.command_trace.map((cmd, idx) => (
                      <div key={idx} className="trace-row">
                        <span className="trace-idx">#{idx + 1}</span>
                        <code className="trace-cmd">{cmd}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="trace-empty">Sin historial de comandos detallado.</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="incident-modal-footer">
          <button
            type="button"
            className="btn-incident-secondary"
            onClick={copyTrace}
            disabled={!incident}
          >
            {copied ? '✅ ¡Traza Copiada!' : '📋 Copiar Traza JSON'}
          </button>
          <button type="button" className="btn-incident-primary" onClick={onClose}>
            Entendido / Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
