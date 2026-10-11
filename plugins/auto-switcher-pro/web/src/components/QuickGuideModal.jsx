import React, { useEffect } from 'react';
import './QuickGuideModal.css';

export default function QuickGuideModal({ isOpen, onClose, embedded = false }) {
  useEffect(() => {
    if (embedded) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, embedded]);

  if (!isOpen) return null;

  const content = (
    <div
      className={embedded ? "quick-guide-embedded" : "quick-guide-modal"}
      onClick={(e) => e.stopPropagation()}
      data-testid="quick-guide-modal"
    >
      {/* Cabecera */}
      <div className="quick-guide-header">
        <div className="quick-guide-title-row">
          <span className="quick-guide-badge">Manual de Usuario</span>
          <h2 className="quick-guide-title">⚡ Auto Switcher Pro · Guía Rápida</h2>
        </div>
        {!embedded && (
          <button
            type="button"
            className="quick-guide-close"
            onClick={onClose}
            aria-label="Cerrar guía"
            data-testid="btn-close-guide"
          >
            ✕
          </button>
        )}
      </div>

      {/* Contenido con Scroll en 2 Columnas */}
      <div className="quick-guide-body">
        <div className="quick-guide-columns-layout">
          {/* COLUMNA 1: Flujo Rápido Recomendado (En 3 Pasos) */}
          <div className="quick-guide-col-flow">
            <div className="quick-guide-section-title">
              <span>🚀</span>
              <span>Flujo Rápido Recomendado (En 3 Pasos)</span>
            </div>
            <div className="quick-guide-flow-lead">
              Sigue esta ruta directa para configurar tu infraestructura y empezar a programar sin cortes por límites de cuota.
            </div>

            <div className="quick-guide-steps">
              <div className="quick-guide-step-item">
                <span className="quick-guide-step-num">1</span>
                <div className="quick-guide-step-content">
                  <div className="quick-guide-step-header">Iniciar Sesión OAuth</div>
                  Conecta tus cuentas de Google Antigravity en la consola nativa de CPAMC (sección <em>OAuth Login</em>).
                </div>
              </div>
              <div className="quick-guide-step-item">
                <span className="quick-guide-step-num">2</span>
                <div className="quick-guide-step-content">
                  <div className="quick-guide-step-header">Armar tu Primer Pool</div>
                  Ve a <code>🛠️ Crear Group/Perfiles</code>, elige tu paquete (ej. Gemini Puro), asigna el prefijo base (ej. <code>agy</code>), elige 1 Líder y al menos 1 Reserva, y pulsa <em>Crear y Guardar</em>.
                </div>
              </div>
              <div className="quick-guide-step-item">
                <span className="quick-guide-step-num">3</span>
                <div className="quick-guide-step-content">
                  <div className="quick-guide-step-header">¡A Programar sin Interrupciones!</div>
                  En tu editor de código o agente (Pi, Cursor, Claude Code), apunta tus solicitudes al modelo de tu pool (ej. <code>agy/gemini-2.5-pro</code>). Si una cuenta se agota, el sistema conmuta automáticamente.
                </div>
              </div>
            </div>

            <div className="quick-guide-protip-box">
              <div className="protip-title">💡 Consejo de Alta Disponibilidad</div>
              <p>
                Al crear grupos con prefijos base como <code>agy</code> y <code>agy2</code>, puedes asignar cuentas especializadas con la <strong>Tuerca ⚙️</strong> en <em>Auto Auth Files</em> para proteger cuotas de modelos premium.
              </p>
            </div>
          </div>

          {/* COLUMNA 2: Arquitectura y Submenús Explicados */}
          <div className="quick-guide-col-details">
            {/* Mapa Visual ASCII */}
            <div className="quick-guide-section-title">
              <span>🗺️</span>
              <span>Mapa de Arquitectura & Submenús</span>
            </div>

            <div className="quick-guide-ascii-box">
{`[ CPAMC Dashboard ]
       │
       ├── 🛠️ 1. Crear Group/Perfiles   ──> "La Fábrica": Une cuentas en Pools (1 Líder + Reservas automático).
       │
       ├── 🗂️ 2. Auto Auth Files       ──> "El Escaparate": Mira tus tarjetas y configúralas (⚙️).
       │
       ├── ♊ 3. Control Switcher      ──> "La Torre de Control": Mira la rotación en vivo y cuotas.
       │
       ├── 🔵 4. Visual Profile        ──> "El Mapa": Visualiza la topología gráfica interactiva.
       │
       ├── 🏷️ 5. Pulse Tokens          ──> "El Tacómetro": Analítica de tokens gastados y velocidad.
       │
       ├── 📋 6. Directorio Cuentas    ──> "El Directorio": Consulta cuentas (edición manual de emergencia).
       │
       ├── 🩺 7. Salud & Mantenimiento ──> "El Médico": Limpia basura residual y actualiza CPAMC.
       │
       └── ❓ 8. Guía Rápida           ──> "El Manual": Consulta cómo operar el sistema en 2 minutos.`}
            </div>

            {/* Desglose de los Módulos */}
            <div className="quick-guide-section-title">
              <span>🧭</span>
              <span>Los Submenús Explicados (Puntual & Sencillo)</span>
            </div>

            <div className="quick-guide-grid">
              {/* Módulo 1 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">🛠️ 1. Crear Group / Perfiles</span>
                  <span className="quick-guide-card-tag">La Fábrica</span>
                </div>
                <p className="quick-guide-card-desc">
                  ¡El núcleo principal! Unes 2 o más cuentas en un Pool con balanceo automático: define 1 Líder y sus Reservas con prefijos ordenados al instante (ej: agy, agy_1).
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Creas el pool <code>agy</code> con 3 cuentas. Llamas a <code>agy/gemini-2.5-pro</code> y jamás se corta tu trabajo por error 429.
                </div>
              </div>

              {/* Módulo 2 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">🗂️ 2. Auto Auth Files</span>
                  <span className="quick-guide-card-tag">El Escaparate</span>
                </div>
                <p className="quick-guide-card-desc">
                  Muestra todas las tarjetas con los colores de sus pools. Incluye la <strong>Tuerca ⚙️ de Modo Especialista</strong> para fijar una cuenta exclusivamente a un modelo pesado (ej. <code>gemini-3.8-flash-high</code>).
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Quieres que una cuenta de alta cuota solo atienda razonamiento complejo y no gaste tokens en autocompletado.
                </div>
              </div>

              {/* Módulo 3 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">♊ 3. Control Switcher</span>
                  <span className="quick-guide-card-tag">La Torre de Control</span>
                </div>
                <p className="quick-guide-card-desc">
                  Muestra en vivo quién está en el campo y quién en el banquillo. Visualiza la corona del líder activo, la cola ordenada de reservas y los tiempos de enfriamiento (cooldown).
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Estás programando intensamente y quieres ver qué cuenta está absorbiendo las peticiones en este momento.
                </div>
              </div>

              {/* Módulo 4 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">🔵 4. Visual Profile</span>
                  <span className="quick-guide-card-tag">El Mapa</span>
                </div>
                <p className="quick-guide-card-desc">
                  Mapa gráfico interactivo de nodos y topología que ilustra la relación entre cuentas, prefijos y jerarquías de pools en el sistema.
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Quieres inspeccionar visualmente cómo están conectadas las ramas de balanceo y dependencias entre credenciales.
                </div>
              </div>

              {/* Módulo 5 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">🏷️ 5. Pulse Tokens</span>
                  <span className="quick-guide-card-tag">El Tacómetro</span>
                </div>
                <p className="quick-guide-card-desc">
                  Analítica y telemetría de rendimiento. Conoce cuántos tokens has consumido hoy (prompt/completion), la velocidad de respuesta (latencia en ms) y qué modelos son los más usados.
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Auditas tu consumo semanal o detectas si un modelo específico está respondiendo más lento de lo normal.
                </div>
              </div>

              {/* Módulo 6 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">📋 6. Directorio de Cuentas</span>
                  <span className="quick-guide-card-tag">El Directorio</span>
                </div>
                <p className="quick-guide-card-desc">
                  Panel de consulta y auditoría para ver qué cuentas físicas están detectadas. Ya no es obligatorio crear prefijos aquí; la edición manual se conserva para emergencias o rescates técnicos.
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Quieres auditar qué correo tiene asignado cada prefijo o corregir manualmente un alias en disco en caso extremo.
                </div>
              </div>

              {/* Módulo 7 */}
              <div className="quick-guide-card">
                <div className="quick-guide-card-header">
                  <span className="quick-guide-card-name">🩺 7. Salud & Mantenimiento</span>
                  <span className="quick-guide-card-tag">El Médico & Limpieza Total</span>
                </div>
                <p className="quick-guide-card-desc">
                  Diagnóstico integral de la instalación de CPAMC. Su escáner auditivo recorre en 4 fases las cuentas físicas, la consola y el catálogo de modelos, detectando modelos ajenos (NVIDIA, OpenCode), duplicados de la misma cuenta y prefijos anidados repetidos (<code>agy/agy/...</code>). Su cleaner universal restaura todas las credenciales a su estado limpio de fábrica (0/36). También actualiza la consola oficial desde GitHub con rollback.
                </p>
                <div className="quick-guide-card-example">
                  <strong>Caso de uso:</strong> Notas prefijos repetidos en tus modelos o quieres asegurar que tu instalación de CPAMC esté 100% óptima.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pie del Modal */}
      {!embedded && (
        <div className="quick-guide-footer">
          <button type="button" className="btn-guide-close" onClick={onClose} data-testid="btn-guide-bottom-close">
            Entendido, cerrar guía
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="quick-guide-overlay" onClick={onClose} data-testid="quick-guide-overlay">
      {content}
    </div>
  );
}
