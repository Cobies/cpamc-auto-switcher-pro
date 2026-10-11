# Sources

## Source Index

### S-001: Formateador de Telemetría TUI y Adaptador de Footer
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/adapter.ts`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read` / `bash`
- Used for: Inyección de telemetría en Footer y Sidebar, función `formatFooterRotationBlock` y `formatSidebarQuotaCardLines`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Define la inyección mediante `footer.setQuota()` y la tarjeta del sidebar en modo fullscreen. Su salida es sombreada en modo regular por `j0k3r-theme`.

### S-002: Parseador de Cuentas y Clasificador de Modelos en Extensión
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/store.ts`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read` / `bash`
- Used for: Extracción de cuotas desde `cpamc-auto-switcher -list`, clasificación de modelos con `classifyModel` y filtrado de parejas de rotación con `getRotationPairForModelSync`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que la suite homologada clasifica sin errores los 4 pools (`agy`, `agy2`, `agy_son`, `agy_opus`).

### S-003: Motor de Cálculo de Cuotas y Ventanas Temporales
- Family: IMPLEMENTATION
- URL or locator: `internal/quota/quota.go`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read`
- Used for: Algoritmo de cálculo de cuota disponible `MinAvailableRemaining()`, aislamiento por familia de modelo y clasificación de ventanas 5h / semanal.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Valida que `MinAvailableRemaining` representa la cuota restante mínima ($\min(100 - \text{5hConsumido}, 100 - \text{SemanalConsumido})$).

### S-004: Orquestador de Rotación Atómica y Políticas de Conmutación
- Family: IMPLEMENTATION
- URL or locator: `internal/switcher/switcher.go`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read` / `bash`
- Used for: Políticas de rotación 3B (capacidad restante) y 4A (promoción primero con rollback), ordenamiento de candidatos y gestión de perfiles.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma la asignación de perfiles (`default`, `2`, `son`, `opus`) a cada par líder-reserva.

### S-005: Punto de Entrada CLI y Comando `-list` de CPAMC Auto-Switcher
- Family: IMPLEMENTATION
- URL or locator: `cmd/cpamc-auto-switcher/main.go`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read` / `bash`
- Used for: Salida tabular del comando `cpamc-auto-switcher -list`, mapeo de columnas `5H CONSUMED`, `WEEKLY CONSUMED` y `MIN AVAILABLE`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Verificado mediante ejecución en caliente de `cpamc-auto-switcher -list`, reflejando los 4 perfiles y sus consumos reales.

### S-006: Descomposición de Prefijos y Convenciones de Perfiles
- Family: IMPLEMENTATION
- URL or locator: `internal/config/config.go`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read`
- Used for: Lógica de `ParsePrefix`, segmentación de perfiles numéricos (`agy2` -> perfil `"2"`) y alfanuméricos (`agy_son` -> perfil `"son"`, `agy_opus` -> perfil `"opus"`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explica por qué el backend Go clasifica `agy2` bajo perfil `"2"` y no `"default"`.

### S-007: Cliente de Gestión HTTP y Descarga Directa de Credenciales
- Family: IMPLEMENTATION
- URL or locator: `internal/client/client.go`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read`
- Used for: Métodos `GetAuthFileDetails` y descarga directa de JSONs para inspeccionar el campo `prefix` real sin depender de `file.note`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Permite que el backend Go conozca `agy2` y `agy2_1` aun cuando `file.note` esté vacío o nulo en el índice de CLIProxyAPI.

### S-008: Telemetría Multimedia del Footer y Bucle de Rotación en Tema
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts`
- Date/version: 2026-10-04 / v1.0.3
- Access method: `read` / `bash`
- Used for: Origen exacto del string `│⏸ agy 44% ↻ 3h/4d │ ⏭ agy_1 100% ↻ 5h/7d`, funciones `formatMultimediaQuota`, `resolveProfileFromModelId` y `computeProfileLoop`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Fuente directa de los bugs de clasificación que congelan la telemetría del footer en el pool `agy`/`agy_1`.

### S-009: Renderizado TUI del Pie de Página y Precedencia de Telemetría
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/J0k3rThemeFooter.ts`
- Date/version: 2026-10-04 / v1.0.3
- Access method: `read`
- Used for: Método `render()` (línea 495) y mecanismo de sombreado / precedencia donde `formatMultimediaQuota` descarta a `this.quota`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Prueba documental del punto de colisión arquitectural entre `j0k3r-theme` y `cpamc-auto-switcher`.

### S-010: Integración de Consumo y Llamadas a Google Cloud Code
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/extensions/cpamc-usage/src/api.ts`
- Date/version: 2026-09-28 / v1.0.1
- Access method: `read` / `bash`
- Used for: Invocación de `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, extracción de `remainingFraction` y fechas `resetTime`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Provee las marcas temporales que alimentan las cuentas regresivas `3h/4d` y `5h/7d`.

### S-011: Panel de Control Web y Medidores Espectrales en Auto Switcher Pro
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/ControlSwitcher.jsx`
- Date/version: 2026-10-07 / Git HEAD
- Access method: `read`
- Used for: Visualización y agrupación de pools en Auto Switcher Pro, medidores TrueColor `SpectralGauge` y estado de las reservas.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que a nivel de Auto Switcher Pro los 4 pools están 100% disponibles y monitoreados en la UI web.

### S-012: Estado en Vivo de Archivos de Autenticación en CLIProxyAPI
- Family: PRIMARY
- URL or locator: `http://192.168.10.150:8317/v0/management/auth-files`
- Date/version: 2026-10-07T07:55:00Z
- Access method: `curl` / `bash`
- Used for: Verificación del estado de las 8 cuentas configuradas y detección del campo `"note": null` en las cuentas `agy2` y `agy2_1`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Evidencia empírica de por qué `j0k3r-theme` no logra mapear `agy2` al depender de `file.note`.

### S-013: Configuración de Entornos de Usuario y Modo TUI
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/settings.json` y `~/.gentle-shell/agent/settings.json`
- Date/version: 2026-10-07 / Configuración Activa
- Access method: `read`
- Used for: Identificación del modo TUI (`regular` en `j0k3r-pi` vs `fullscreen` en `gentle-shell`) y modelo predeterminado (`agy2/gemini-3.8-flash-high`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explica por qué el usuario observa la telemetría de footer de `j0k3r-theme` en lugar del sidebar de Gentle-Shell.

### S-014: Homologación de la Suite de Extensión Todo-en-Uno (ADRs)
- Family: PRIMARY
- URL or locator: `docs/architecture/unified-pi-extension-homologation.md`
- Date/version: 2026-10-07 / v1.0.0
- Access method: `read`
- Used for: Decisiones arquitecturales ADR-01 (SSOT bajo `extensions/cpamc-auto-switcher`) y ADR-02 (Pipeline dinámico).
- Usefulness: CONTEXT
- Confidence impact: HIGH
- Notes: Establece la directriz de gobernanza para consolidar toda la telemetría dentro de la suite homologada.
