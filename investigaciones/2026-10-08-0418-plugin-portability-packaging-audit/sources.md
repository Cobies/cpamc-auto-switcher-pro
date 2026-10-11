# Sources

## Source Index

### S-001: Dynamic Provider y Gestión de Red en Extensión Pi
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/provider.ts`
- Date/version: 2026-10-07
- Access method: `read` / `grep`
- Used for: Diagnóstico de secuestro de red local (IP LAN privada `192.168.10.150`), anulación de localhost y persistencia de caché atada a gentle-shell.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Contiene `DEFAULT_BASE_URL = "http://192.168.10.150:8317"` y lógica activa en `resolveBaseUrl()` que sustituye `127.0.0.1` o `localhost` por dicha IP LAN privada.

### S-002: Hook Reactivo de Auto-Failover ante Errores 429
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/failover.ts`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Evaluación del acoplamiento a subprocesos externos (`spawn("cpamc-auto-switcher")`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Detecta errores HTTP 429 e invoca el binario externo con debounce de 3 segundos; maneja `ENOENT` con advertencia pero detiene la rotación si el CLI no existe en `$PATH`.

### S-003: Almacén de Estado y Consulta de Cuentas vía Subproceso
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/store.ts`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Análisis del sondeo de cuotas para la TUI de Pi mediante `cpamc-auto-switcher -list`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Lanza `execFileAsync("cpamc-auto-switcher", ["-list"])`. Si el subproceso falla o no está en PATH, la caché queda vacía y se apagan los componentes de telemetría de cuotas.

### S-004: Selector Interactivo `/cpamc-model` y Balanceo Least-Used
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/picker.ts`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Verificación de la TUI nativa de selección de modelos, refresco proactivo de catálogo y roles de rotación (`👑`, `💤`, `⚡`).
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Emplea el contrato corregido de `ctx.ui.select` con arreglos de cadenas simples (`string[]`) y ordena modelos por disponibilidad remanente de cuota.

### S-005: Adaptador Polimórfico de TUI para Sidebar y Footer
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/adapter.ts`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Inspección de renderizado de QuotaCard calibrada a 36 columnas y compatibilidad con temas oscuros/claros.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Integra detección reactiva de modo Fullscreen (Gentle Sidebar) vs Regular (Footer superior derecho) con barras TrueColor.

### S-006: Punto de Entrada del CLI Go y Procesamiento de Opciones
- Family: IMPLEMENTATION
- URL or locator: `cmd/cpamc-auto-switcher/main.go`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Comprobación de flujo de configuración interactiva (`--init`), banderas CLI y omisión de lectura de variables de entorno.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Requiere un archivo de configuración válido en disco; si no existe, finaliza inmediatamente solicitando ejecutar `--init`.

### S-007: Modelo y Validación de Configuración del Switcher Go
- Family: IMPLEMENTATION
- URL or locator: `internal/config/config.go`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Análisis de la ruta canónica `~/.local/share/cpamc-auto-switcher/config.json` y requisitos de validación (`management_key` mandatorio).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Define valores por defecto (`http://localhost:8317`, 90% 5h, 95% semanal, 5 min cooldown). No implementa fallback a variables de entorno en caso de ausencia de archivo.

### S-008: Registro C-ABI v1 y Enrutamiento del Plugin Visual Profile
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/internal/plugin/plugin.go`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Auditoría de métodos de registro (`plugin.register`, `management.register`), menú de administración y metadatos de autor.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Publica los recursos `/profiles`, `/control-switcher`, `/create-prefixes`, `/create-groups` y `/pulse-tokens` hacia la interfaz web del host CLIProxyAPI.

### S-009: Cliente Web y Consulta Nativa de Cuotas en Frontend React
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/ControlSwitcher.jsx` & `plugins/visual-profile/web/src/api/managementClient.js`
- Date/version: 2026-10-07
- Access method: `read` / `bash` vitest
- Used for: Evidencia de viabilidad de consulta de cuotas pura en TypeScript/JavaScript sin dependencia de binarios Go compilados.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Realiza peticiones a `/v0/management/api-call` hacia Google Cloud Code y OpenAI Usage directamente desde el navegador con 275 tests unitarios aprobados.

### S-010: Flujo de Integración Continua y Release de Bibliotecas Compartidas
- Family: IMPLEMENTATION
- URL or locator: `.github/workflows/visual-profile-release.yml`
- Date/version: 2026-10-07
- Access method: `read` / `git diff`
- Used for: Diagnóstico del desacoplamiento de plataforma (Linux glibc amd64/arm64) y colisión por nombre duro de repositorio en GitHub Actions.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Genera artefactos `.so` estrictamente vinculados con glibc (rechaza musl) y hardcodea `gonzalez962/cpamc-auto-switcher`, rompiendo ejecuciones en repositorios bifurcados o renombrados.

### S-011: Documento de Arquitectura y Homologación de Extensión Pi
- Family: PRIMARY
- URL or locator: `docs/architecture/unified-pi-extension-homologation.md`
- Date/version: 2026-10-07
- Access method: `read`
- Used for: Marco de referencia para los ADRs 01 a 05 (unificación SSOT, purga atómica, contrato de TUI y aislamiento estricto de prefijos).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Archivo actualmente no indexado en git que fundamenta las decisiones técnicas vigentes de la suite.

### S-012: Módulo Histórico Standalone de Pi Extension (Septiembre 2026)
- Family: IMPLEMENTATION
- URL or locator: `pi extensions/cpamc-auto-switcher/`
- Date/version: 2026-09-28
- Access method: `read` / `diff`
- Used for: Identificación de código legado duplicado y advertencia de deprecación.
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: Módulo obsoleto que permanece trackeado en Git, generando riesgo de confusión para desarrolladores externos.

### S-013: Estado del Árbol de Trabajo y Configuración Remota de Git
- Family: PRIMARY
- URL or locator: Repositorio Git Local (`git status --ignored`, `git remote -v`)
- Date/version: 2026-10-08
- Access method: `bash` git CLI
- Used for: Verificación del estado de archivos no rastreados (`extensions/`, `docs/`) y la URL remota del proyecto (`WiloxDev/cpamc-auto-switcher-pro`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que la suite unificada moderna no está presente en la rama remota, imposibilitando la distribución a terceros en su estado actual.
