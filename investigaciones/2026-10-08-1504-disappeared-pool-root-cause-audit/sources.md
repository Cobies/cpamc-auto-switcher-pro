# Sources

## Source Index

### S-001: CLIProxyAPI Management API `/v0/management/auth-files`
- Family: PRIMARY
- URL or locator: `http://localhost:8317/v0/management/auth-files` (Bearer management key)
- Date/version: 2026-10-08T15:08:57Z / v8.0.13
- Access method: curl HTTP GET + JSON parsing
- Used for: Inspección en vivo de los 8 archivos de credenciales, estado `failed`, `status`, `unavailable`, `last_refresh` y telemetría de peticiones recientes
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Identificó que `antigravity-wilsonlavio11@gmail.com.json` acumuló `failed: 1` con 1 fallo en la ventana 23:00-23:10, mientras los otros 7 archivos se mantuvieron en `failed: 0`.

### S-002: CLIProxyAPI Routes Endpoint `/v1/models` y `/v1/models?client_version=1`
- Family: PRIMARY
- URL or locator: `http://localhost:8317/v1/models?client_version=1`
- Date/version: 2026-10-08T15:09:02Z / v8.0.13
- Access method: curl HTTP GET + Python parsing
- Used for: Verificación de modelos y prefijos publicados en la tabla de rutas del proxy
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirmó la ausencia total del slug `agy2/gemini-3.8-flash-high` en `/v1/models` y la presencia exclusiva de la reserva `agy2_1/gemini-3.8-flash-high`, junto con los prefijos `agy`, `agy_1`, `agy_son`, `agy_son_1`, `agy_opus` y `agy_opus_1`.

### S-003: Salida del comando CLI `cpamc-auto-switcher -list`
- Family: PRIMARY
- URL or locator: PATH binario `cpamc-auto-switcher`
- Date/version: 2026-10-08T15:07:34Z
- Access method: Ejecución CLI en bash
- Used for: Inspección del estado de cuentas activas y reservas, perfiles (`default`, `2`, `opus`, `son`) y consumos de cuota (5h, semanal y mínimo disponible)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Constató que la cuenta líder `agy2` tenía 16.5% disponible (83.5% semanal) frente al 100.0% de su reserva `agy2_1`, y que el pool `opus` tiene ambas cuentas al 100% semanal (0% disponible).

### S-004: Registro de error de chat completions en Docker `cli-proxy-api`
- Family: PRIMARY
- URL or locator: `/root/.cli-proxy-api/logs/error-v1-chat-completions-2026-10-08T230100-27037b89.log` en contenedor `cli-proxy-api`
- Date/version: 2026-10-08T23:01:00.753+08:00 (15:01:00 UTC)
- Access method: docker exec grep/head
- Used for: Identificación del evento detonante exacto (503 Service Unavailable upstream de Google) que provocó el incremento de `failed: 1`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Petición enviada con modelo `agy2/gemini-3.8-flash-high` y auth `58bbc58486c622fb` (`wilsonlavio11@gmail.com.json`) rechazada por `daily-cloudcode-pa.googleapis.com` con HTTP 503.

### S-005: Archivos de caché persistente de modelos de Pi
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json` y `/home/wilox/.gentle-shell/agent/cpamc-models-cache.json`
- Date/version: 2026-10-08T15:09:10Z
- Access method: read y diff en bash
- Used for: Confirmación de que el pool `agy2` fue purgado de los selectores de modelos de Pi
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Ambos archivos son idénticos y contienen exactamente 7 modelos (`agy`, `agy_son`, `agy_opus`), con 0 modelos bajo `agy2`.

### S-006: Código fuente `extensions/cpamc-auto-switcher/src/provider.ts`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/provider.ts`
- Date/version: commit reciente (Oct 8 2026)
- Access method: read
- Used for: Análisis del filtrado de modelos en `isCleanIncludedModel` y exclusión de reservas `/_(\d+)$/`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Revela que la regla de descarte de reservas omitió `agy2_1`, dejando al pool `agy2` con 0 modelos cuando CLIProxyAPI despublicó `agy2`.

### S-007: Código fuente `extensions/cpamc-auto-switcher/src/failover.ts`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/failover.ts`
- Date/version: commit reciente (Oct 8 2026)
- Access method: read
- Used for: Verificación de por qué el error 503 no activó la rotación forzada
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `RATE_LIMIT_PATTERN` solo evalúa `429`, `rate limit` y `quota/resource exhausted`. Un error HTTP 503 es ignorado silenciosamente por el hook de failover.

### S-008: Código fuente `extensions/cpamc-auto-switcher/src/store.ts` y `adapter.ts`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/store.ts` y `src/adapter.ts`
- Date/version: commit reciente (Oct 8 2026)
- Access method: read
- Used for: Análisis del rebalanceo proactivo `checkProactivePoolRebalance` y presentación en footer/sidebar
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `checkProactivePoolRebalance` solo evalúa `ctx.model.id`. Al estar Pi posicionado en `agy`, jamás evaluó el pool `agy2`.

### S-009: Entrada unificada `extensions/cpamc-auto-switcher/index.ts`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/index.ts`
- Date/version: commit reciente (Oct 8 2026)
- Access method: read
- Used for: Detección del ciclo periódico de refresco de catálogo (cada ~75s / 3 ticks)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: En cada ciclo de 75 segundos, `ctx.modelRegistry.refresh()` reescribe `cpamc-models-cache.json` con la lista de CLIProxyAPI, sellando la exclusión de `agy2`.

### S-010: Motor de conmutación en Go `internal/switcher/switcher.go` y CLI `main.go`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/switcher/switcher.go`
- Date/version: commit local con cambios de perfil numérico
- Access method: read
- Used for: Mecánica de evaluación de umbrales en `ShouldRotate` (90% 5h, 95% semanal)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Al tener `agy2` 11.1% en 5h y 83.5% semanal, el binario Go determinó que no requería rotación automática regular.

### S-011: Memoria histórica de auditoría de sincronización (Engram #1815 y #1816)
- Family: IMPLEMENTATION
- URL or locator: `mem:1815`, `mem:1816`
- Date/version: 2026-10-07
- Access method: `mem_get_observation` / `mem_search`
- Used for: Correlación con el incidente idéntico documentado 24 horas antes en `investigaciones/2026-10-07-0624-cpamc-pool-sync-model-audit`
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirmó el precedente donde fallos de token o transitorios en la cuenta líder provocan la desaparición del pool en CLIProxyAPI y su cascada en Pi.
