# Registro de Arquitectura y Gobernanza: Homologación de la Extensión CPAMC Auto-Switcher en Pi

**Fecha**: 2026-10-07  
**Estado**: Aprobado y Homologado  
**Autor**: CTO & Engineering Team  
**Ámbito**: `cpamc-auto-switcher-pro` / `gentle-shell` / `jok3r-pi`

---

## 1. Contexto y Problemática Previa

Durante la auditoría del pipeline de sincronización de pools de CPAMC hacia los selectores de modelos de Pi (`/model` y `/cpamc-model`), se identificaron tres fallas estructurales:

1. **Fragmentación Histórica de Módulos**:
   - Existían tres carpetas en el repositorio: `pi extensions/cpamc-auto-switcher` (failover en septiembre), `extensions/cpamc-runtime-ui` (UI en octubre) y `extensions/cpamc-auto-switcher` (suite unificada).
   - En el entorno del desarrollador (`jok3r-pi`), existían dos enlaces simbólicos apuntando a versiones obsoletas y separadas, mientras que `gentle-shell` apuntaba a la suite unificada. Esto causaba comportamientos erráticos, divergencia entre entornos y la ejecución de código no homologado.
2. **Defecto de Renderizado en TUI (`[object Object]`)**:
   - `ctx.ui.select` en el SDK de Pi requiere estrictamente un arreglo de cadenas simples (`string[]`). La versión en `cpamc-runtime-ui` enviaba un arreglo de objetos `{ label, value }`, provocando que el motor de la TUI convirtiera cada opción a `String(item)`, mostrando `[object Object]`.
3. **Ceguera y Desincronización de Catálogo**:
   - `/cpamc-model` operaba sobre un snapshot estático en memoria sin disparar peticiones de red hacia `ctx.modelRegistry.refresh()`.
   - El descubrimiento de prefijos en `provider.ts` fallaba por timeout de 5 segundos ante $N$ descargas concurrentes, cayendo en un fallback que excluía prefijos clave como `agy_opus` y `codex`.
   - Cuentas en fallo transitorio de token (`failed > 0`) o cooldown desaparecían del catálogo sin alternativa.

---

## 2. Decisiones de Arquitectura Tomadas

### ADR-01: Homologación a Suite Unificada Todo-en-Uno (SSOT)
- **Decisión**: Se elimina completamente `extensions/cpamc-runtime-ui/` del repositorio. Se declara `extensions/cpamc-auto-switcher/` como la **Única Fuente de la Verdad** (Single Source of Truth).
- **Homologación de Enlaces**:
  - `~/.pi/agent-j0k3r/extensions/cpamc-auto-switcher` ➔ `extensions/cpamc-auto-switcher`
  - `~/.gentle-shell/agent/extensions/cpamc-auto-switcher` ➔ `extensions/cpamc-auto-switcher`
  - Eliminado el enlace residual `cpamc-runtime-ui`.

### ADR-02: Pipeline Dinámico con Purga Atómica
- **Decisión**: La sincronización de modelos debe soportar altas, bajas y modificaciones en tiempo real:
  - **Alta**: Al crear pools en la web de CPAMC, se reflejan inmediatamente en la próxima invocación de `/cpamc-model` o en el tick de 75s en segundo plano.
  - **Baja / Purga Atómica**: Al borrar un pool en CPAMC, CLIProxyAPI deja de publicarlo en `/v1/models`. En el siguiente refresco, `provider.ts` devuelve solo los modelos vivos y Pi ejecuta `models = refreshed`, depurando inmediatamente los pools eliminados sin dejar modelos huérfanos ni duplicados.
  - **Persistencia Dual**: `saveCachedModels` actualiza atómicamente tanto la caché de `jok3r-pi` (`~/.pi/agent-j0k3r/cpamc-models-cache.json`) como la de `gentle-shell` (`~/.gentle-shell/agent/cpamc-models-cache.json`).

### ADR-03: Corrección de Contrato de TUI
- **Decisión**: En `src/picker.ts`, las opciones se proyectan como cadenas formateadas (`string[]`) con insignias y decoradores de rol (`👑`, `⚡`, `💤`). La selección se resuelve mapeando por índice hacia el array de modelos en memoria y aplicando `pi.setModel(selected)`.

### ADR-04: Resiliencia de Red y Fallback Extendido
- **Decisión**: En `src/provider.ts`:
  - Los prefijos válidos se pre-populan desde los campos `note` y `prefix` de `GET /v0/management/auth-files`.
  - El timeout de descubrimiento se amplía de 5s a 10s.
  - `KNOWN_ACCOUNT_PREFIXES` incluye explícitamente `agy`, `agy2`, `agy3`, `agy_son`, `agy_opus`, `agy_clau`, `codex`, `codex2`, `codex3`.

### ADR-05: Purga Estricta de Prefijos Ajenos (Anti-Contaminación)
- **Decisión**: Se eliminaron definitivamente `"nv"`, `"nan"` y `"ocgo"` de `KNOWN_ACCOUNT_PREFIXES`. En modo conectado con Management API, el proveedor `cpamc` **únicamente** acepta modelos cuyo prefijo pertenezca a los archivos de autenticación configurados en CPAMC (`validPrefixes.has(prefix)`).
- **Resultado**: Se purgaron 105 modelos ajenos de NVIDIA NIM y Nano que inundaban `/model`. El catálogo de producción quedó saneado a exactamente los **8 modelos reales** de los pools activos de CPAMC.

---

## 3. Matriz de Validación de Calidad

| Capa | Herramienta | Resultado |
| :--- | :--- | :--- |
| **Go Backend** | `go test ./...` | **100% PASS** (todos los paquetes `config`, `quota`, `switcher`, `client`) |
| **Go Plugin (Visual Profile)** | `go test ./...` | **100% PASS** (todos los paquetes `plugin`, `handlers`, `web`) |
| **Web Frontend (Visual Profile)** | `vitest run` | **100% PASS** (14 suites, 275 tests unitarios e integración) |
| **Extension TypeScript Bundle** | `esbuild --bundle` | **0 Errores** (construcción limpia y tipos conformes) |
| **Integración CLIProxyAPI** | Node Script en vivo | **100% OK**: `hasAgy`, `hasAgy2`, `hasAgyOpus`, `hasAgySon` todos detectados |

---

## 4. Guía de Mantenimiento y Continuidad

Para futuras iteraciones o adiciones de proveedores/modelos:
1. Cualquier nuevo componente TUI o hook de Pi debe agregarse exclusivamente bajo `extensions/cpamc-auto-switcher/src/`.
2. No crear sub-extensiones separadas para UI vs failover; la suite unificada garantiza un solo ciclo de vida de conexión con el agente.
3. Al modificar `ctx.ui.select`, respetar la firma de `string[]`.
