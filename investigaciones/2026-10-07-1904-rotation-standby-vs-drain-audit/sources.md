# Sources

## Source Index

### S-001: Telemetría viva de cuentas y cuotas (`cpamc-auto-switcher -list`)
- Family: PRIMARY
- URL or locator: `cpamc-auto-switcher -list` (CLI local)
- Date/version: 2026-10-07
- Access method: bash tool
- Used for: Estado exacto de consumo y disponibilidad de `agy2` (14.6% 5h, 68.6% semanal, 31.4% libre) y `agy2_1` (0.0% semanal, 100.0% libre).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma empíricamente que `agy2` tiene 31.4% (redondeado a 32%) de cuota disponible y no está en agotamiento total.

### S-002: Lógica de evaluación de umbrales `ShouldRotate` en Go
- Family: IMPLEMENTATION
- URL or locator: `internal/quota/quota.go:277-299`
- Date/version: v1.0.0
- Access method: read tool
- Used for: Condiciones matemáticas requeridas para que se dispare la rotación automática (`aq.WorstFiveHour.ConsumedPercentage >= fiveHourThreshold` o `aq.WorstWeekly.ConsumedPercentage >= weeklyThreshold`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que la rotación se activa por porcentaje consumido superando el umbral, no por cuota remanente relativa entre cuentas.

### S-003: Configuración activa de umbrales del switcher (`config.json`)
- Family: PRIMARY
- URL or locator: `~/.local/share/cpamc-auto-switcher/config.json`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Verificación de los umbrales configurados (`five_hour_threshold: 90.0`, `weekly_threshold: 95.0`, `cooldown_minutes: 5.0`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establece formalmente que la rotación no se dispara antes del 90% (5h) o 95% (semanal).

### S-004: Motor de inspección y rotación de cuentas en segundo plano (`switcher.go`)
- Family: IMPLEMENTATION
- URL or locator: `internal/switcher/switcher.go:440-520`
- Date/version: v1.0.0
- Access method: read tool
- Used for: Regla de cuenta activa única por perfil, omisión de rotación cuando `ShouldRotate` es falso, y mecanismo de intercambio de prefijos en dos pasos.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Prohíbe múltiples cuentas activas bajo el mismo prefijo y descarta la búsqueda de reservas si la cuenta activa no ha superado el umbral.

### S-005: Auditoría crítica de enrutamiento y balanceo de carga en CPAMC
- Family: PRIMARY
- URL or locator: `investigaciones/2026-10-07-0826-routing-load-balancing-critique/report.md`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Análisis del modelo Active-Standby vs Load Balancing, The Cliff Effect (Efecto Precipicio), y mapeo 1:1 de prefijos en CLIProxyAPI.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documenta en detalle el peligro de consumir cuentas de Antigravity al 50/50 por round-robin y confirma la falta de scheduler por petición en CLIProxyAPI.

### S-006: Registro de Arquitectura ADR-06 (Balanceo Proactivo Least-Used)
- Family: PRIMARY
- URL or locator: `docs/architecture/smart-least-used-routing.md`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Verificación de qué mejoras se implementaron: ranking interactivo en `/cpamc-model` entre líderes de familias, preservando deliberadamente a las reservas frías en modo standby.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que las reservas nunca fueron promovidas a participantes de tráfico en vivo, sino reservadas para emergencias.

### S-007: Implementación del selector de modelos enriquecido (`picker.ts`)
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/picker.ts:35-150`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Ordenamiento Least-Used First en `/cpamc-model`, comando `/cpamc-model auto`, e identificación del mejor candidato entre líderes.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Evidencia que el ranking ocurre exclusivamente al ejecutar el comando interactivo en Pi.

### S-008: Filtrado estricto de prefijos de reserva en el catálogo de modelos (`provider.ts`)
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/provider.ts:376-382`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Demostración de que las cuentas con sufijo `_(\d+)$` (`agy2_1`) son deliberadamente eliminadas del catálogo accesible en Pi.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que Pi no tiene ruta ejecutable directa para `agy2_1`; solo existe `agy2`.

### S-009: Determinismo de rutas en motor CLIProxyAPI
- Family: IMPLEMENTATION
- URL or locator: `investigaciones/2026-10-07-0826-routing-load-balancing-critique/sources.md:S-006`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Constatación de que CLIProxyAPI asocia cada modelo a la credencial que tiene su prefijo exacto en `ModelRegistry`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: En ausencia de scheduler activo por C-ABI, el proxy envía 100% del tráfico al archivo físico que posee el prefijo.

### S-010: Integración de eventos y hooks de failover en Pi (`failover.ts`)
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/failover.ts:160-240`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Puntos temporales en los que se invoca `cpamc-auto-switcher` (al final de cada turno o ante errores HTTP 429).
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Ratifica que el switcher es reactivo y out-of-band respecto a la petición de inferencia.

### S-011: Protocolo de cuotas de Antigravity (`retrieveUserQuotaSummary`)
- Family: PRIMARY
- URL or locator: `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Estructura de buckets de 5 horas y semanales en Google Cloud Code / Antigravity.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Base técnica de las dos ventanas rodantes que originan la necesidad del modelo Active-Standby.

### S-012: Formato del widget de cuotas en el footer del TUI de Pi (`quota.ts`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts:220-310`
- Date/version: 2026-10-07
- Access method: read tool
- Used for: Origen del string `│▶ agy2 32% ↻ 3h/3d │ ⏭ agy2_1 100% ↻ 7d/7d`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que `▶` indica la cuenta activa en ejecución, `⏭` indica la siguiente reserva en espera, `32%` es cuota disponible y `3h/3d` son los tiempos restantes para el reseteo de 5h y semanal.

### S-013: Registro de memoria Engram sobre telemetría y perfiles (obs-1822)
- Family: IMPLEMENTATION
- URL or locator: `mem:1822`
- Date/version: 2026-10-07
- Access method: mem_get_observation tool
- Used for: Validación del significado exacto de los porcentajes y tiempos de reseteo en el footer del TUI.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establece formalmente que los porcentajes representan capacidad disponible libre y no cuota gastada.
