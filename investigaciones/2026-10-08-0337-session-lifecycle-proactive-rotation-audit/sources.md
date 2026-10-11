# Sources

## Source Index

### S-001: CLI Entrypoint y Manejadores de Comandos de Auto Switcher Pro
- Family: PRIMARY
- URL or locator: `cmd/cpamc-auto-switcher/main.go`
- Date/version: 2026-10-08 / v1.0.0
- Access method: read
- Used for: Arquitectura de comandos CLI (`-switch`, `-list`, `-check`, `-force`, `-cooldown`), flujo de ejecución del switcher y gestión de estado runtime en `state.json`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que la CLI soporta conmutación explícita (`-switch <id|prefix>`) pero carece de un comando/modo de rebalanceo proactivo o re-evaluación por candidato óptimo.

### S-002: Motor Central de Conmutación y Despacho de Prefijos en Go
- Family: PRIMARY
- URL or locator: `internal/switcher/switcher.go`
- Date/version: 2026-10-08 / v1.0.0
- Access method: read
- Used for: Lógica de evaluación de perfiles (`RunProvider`), conmutación manual (`SwitchToAccount`), parcheo de 2 pasos en CLIProxyAPI (`PatchAuthPrefix`) y ordenamiento por cuota remanente.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que la evaluación en vivo solo dispara conmutación si la cuenta activa viola los umbrales de 90%/95% en `ShouldRotate`. El algoritmo de selección de reserva (`Policy 3B`) ya existe y ordena por `minRemain > eligible[j].minRemain`.

### S-003: Motor de Cálculo y Evaluación de Cuotas Rodantes
- Family: PRIMARY
- URL or locator: `internal/quota/quota.go`
- Date/version: 2026-10-08 / v1.0.0
- Access method: read
- Used for: Definición de ventanas (`5h`, `weekly`), umbrales de rotación (`ShouldRotate`), cálculo de cuota disponible mínima (`MinAvailableRemaining`) y estructuras de buckets con `ResetTime`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: La cuota mínima libre disponible sintetiza la ventana más restrictiva de la cuenta. Posee marcas temporales `ResetTime` en formato ISO/Unix para ventanas de 5h y semanales.

### S-004: Modelo de Configuración y Convención de Prefijos por Perfil
- Family: PRIMARY
- URL or locator: `internal/config/config.go`
- Date/version: 2026-10-08 / v1.0.0
- Access method: read
- Used for: Descomposición estructurada de prefijos (`ParsePrefix`), mapeo por perfiles numéricos (`ConventionForProfile`), aislamiento entre familias y defaults de configuración.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que el perfil `2` asigna `activePrefix = "agy2"` y `reservePrefixPrefix = "agy2_"`. Promover una reserva a activa implica que asume el prefijo `agy2`, mientras el líder anterior pasa a ser `agy2_1`.

### S-005: Ciclo de Vida y Registro de Hooks en la Extensión de Pi
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/index.ts`
- Date/version: 2026-10-08 / v1.0.0
- Access method: read
- Used for: Registro de eventos de Pi (`session_start`, `session_before_switch`, `turn_start`, `turn_end`), ciclo de vida del adaptador TUI y polling periódico de 25s.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: En `session_start`, actualmente solo se reinicia el timer y se actualiza la telemetría visual. No se invoca ninguna evaluación de cuotas ni rotación de candidatos.

### S-006: Tipos y Especificación del Sistema de Extensiones de Pi
- Family: PRIMARY
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- Date/version: 2026-10-05 / pi-coding-agent runtime v0.x
- Access method: read
- Used for: Contrato de eventos `SessionStartEvent`, `SessionBeforeSwitchEvent`, `ExtensionContext`, `ExtensionAPI` y `ExtensionCommandContextActions`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Revela que `SessionStartEvent` expone `reason: "startup" | "reload" | "new" | "resume" | "fork"`. Permite discriminar inequívocamente entre una nueva sesión (`new`), una recarga (`reload`) o el inicio inicial (`startup`).

### S-007: Runtime y Despacho del Ciclo de Vida de Sesión en Pi Core
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.ts`
- Date/version: 2026-10-05
- Access method: read
- Used for: Mecánica interna de `newSession()`, `switchSession()`, `teardownCurrent()` y la secuencia estricta de emisión `session_before_switch` -> `session_shutdown` -> `session_start`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que `/new` y `/reload` ejecutan un teardown sincrónico completo de la sesión previa antes de instanciar la nueva sesión y emitir `session_start`.

### S-008: Hook de Failover y Cola Serializada de Procesos en la Extensión
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/src/failover.ts`
- Date/version: 2026-10-08
- Access method: read
- Used for: Detección reactiva de 429 / Rate Limit, ejecución desacoplada de `cpamc-auto-switcher` mediante `spawn`, debounce y serialización mediante cola de Promesas (`queue = queue.then(...)`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Provee el patrón de serialización asíncrona esencial para evitar ejecuciones concurrentes del switcher en procesos en background.

### S-009: Selector Interactivo y Cambio de Modelos en Pi
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/picker.ts`
- Date/version: 2026-10-08
- Access method: read
- Used for: Mecánica de `/cpamc-model auto`, clasificación de modelos y llamada nativa a `pi.setModel(best)`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Muestra cómo Pi puede mutar el modelo activo programáticamente vía `pi.setModel(m)` para selección inter-pool, complementando la promoción intra-pool de prefijos.

### S-010: Almacén de Estado y Consulta de Cuentas en Tiempo Real
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/store.ts`
- Date/version: 2026-10-08
- Access method: read
- Used for: `querySwitcherAccounts`, clasificación léxica de prefijos de cuentas y funciones auxiliares de ranking de líderes (`getBestCandidateLeader`).
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Provee la interfaz en TypeScript que actualmente consume `cpamc-auto-switcher -list` con caché de 25 segundos.

### S-011: Telemetría y Widget de Cuotas en el Footer de j0k3r-theme
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts`
- Date/version: 2026-10-07
- Access method: read
- Used for: Mapeo de cuenta activa vs reserva siguiente (`computeProfileLoop`), cálculo de regresión y renderizado del footer `│▶ agy2 27% ↻ 3h/3d │ ⏭ agy2_1 100% ↻ 7d/7d`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Revela el origen exacto de los datos mostrados al usuario y cómo el footer reacciona a los cambios en el prefijo activo.

### S-012: Auditoría Previa de Retención de Standby Frío vs Consumo Activo
- Family: IMPLEMENTATION
- URL or locator: `investigaciones/2026-10-07-1904-rotation-standby-vs-drain-audit/report.md`
- Date/version: 2026-10-07
- Access method: read
- Used for: Análisis del modelo Active-Standby, explicación de por qué `agy2` se mantiene activa al 32% (68% consumido) y preservación del colchón contra el "Efecto Precipicio".
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establece las restricciones de diseño previas y la necesidad de evitar el agotamiento simultáneo por round-robin ciego.

### S-013: Registro de Arquitectura ADR-06 (Least-Used Routing)
- Family: PRIMARY
- URL or locator: `docs/architecture/smart-least-used-routing.md`
- Date/version: 2026-10-07
- Access method: read
- Used for: Principios arquitecturales del Least-Used Routing en el selector interactivo y delimitación entre plano de control y plano de datos.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documenta que ADR-06 solo aplicó a la UI de `/cpamc-model` y que el demonio reactivo de Go mantuvo intacta su filosofía Active-Standby.

### S-014: Observación de Memoria Engram sobre Mecánicas de Rotación
- Family: IMPLEMENTATION
- URL or locator: `mem:1847` (Engram observation id 1847)
- Date/version: 2026-10-07
- Access method: mem_get_observation / mem_search
- Used for: Contexto histórico del workspace sobre el umbral del 90%/95% y la retención intencional de reservas frías.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Resumen estructurado del hallazgo previo sobre la distinción entre cuota consumida y cuota remanente.

### S-015: Telemetría Viva de la CLI de Auto Switcher Pro
- Family: PRIMARY
- URL or locator: `cpamc-auto-switcher -list` & `cpamc-auto-switcher --check -verbose --force`
- Date/version: 2026-10-08
- Access method: bash
- Used for: Evidencia empírica en vivo del estado de `agy2` (75% semanal consumido, 25% disponible) vs `agy2_1` (0% consumido, 100% disponible).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que en vivo el pool `2` sufre exactamente el síntoma reportado por el usuario, sin disparar rotación por estar por debajo del umbral del 95%.
