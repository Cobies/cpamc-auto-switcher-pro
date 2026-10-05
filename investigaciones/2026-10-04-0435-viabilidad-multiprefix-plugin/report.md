# Viabilidad: cuentas multi-prefijo / virtuales en `plugins/visual-profile` (Auto switcher pro)

## Veredicto de viabilidad (VIABILITY VERDICT)

**VIABLE — con cambios acotados SOLO en el plugin (Go + UI). NO requiere modificar el código de CLIProxyAPI ni el host en runtime.**

- El trigger de **BLOCKED NO se cumple**: en el commit del host en ejecución (`d7914af`, v8.0.13) **existen** `host.auth.save` (`MethodHostAuthSave`) y `POST /v0/management/auth-files` (UploadAuthFile) [S-004][S-007][S-008]; además el alias v8 `POST /v8/management/credentials` está vivo (`HTTP 200`) [S-001].
- Mecanismo recomendado: **A — server-side** con `host.auth.get` + `host.auth.save` (los tokens nunca salen del proceso host; el navegador solo envía `{origen, familia, nombre}`).
- Mecanismo alterno: **B — client-side** con `POST /v0/management/auth-files` (multipart), que **ya existe y hoy no se usa** pero obliga a que el navegador maneje el JSON con tokens.
- El requisito "sin que el navegador maneje tokens crudos si es evitable" **es evitable** (mecanismo A) y de hecho mejora un defecto actual: el plugin ya descarga los auth-files completos en el navegador para leer `prefix` [S-024].
- El aislamiento por familia (`excluded_models` distinto por prefijo) **solo es alcanzable duplicando *archivos* de auth**, no con la expansión virtual del host (ParseAuths), que comparte las exclusiones del archivo físico [S-010][S-011].

Confianza global: **MEDIUM-HIGH**. Alta en los hechos de código y rutas; media en el comportamiento de rotación del `refresh_token` de Google (no rotación confirmada empíricamente de forma completa).

## Executive Summary

El plugin "Auto switcher pro" (`plugins/visual-profile`, binario `.so` C-ABI) hoy **solo sirve estáticos y declara menús**; toda la lógica de pools vive en JS en el navegador y se persiste con `PATCH /v0/management/auth-files/fields` [S-023][S-024][S-025][S-032]. No existe ningún endpoint de "copiar/duplicar credencial" en la Management API (ni v0 ni v8) [S-007]; por tanto, crear cuentas "virtuales" (un mismo login físico sirviendo varios pools con distinto `prefix` y distinto `excluded_models`) **requiere una capacidad nueva**.

La investigación confirma que el host **ya expone las dos primitivas necesarias** para hacerlo sin tocar su código:

1. `host.auth.get(auth_index)` → devuelve el JSON físico completo **dentro del proceso host** [S-004][S-005].
2. `host.auth.save({name, json})` → escribe un archivo `.json` nuevo y hace upsert del registro en runtime [S-004][S-005].

El plugin ya captura el puntero de host en C (`stored_host`) pero **no tiene puente Go para invocarlo** [S-022]. Por tanto, el mecanismo A exige implementar ese puente (cambio acotado en `main.go` + `internal/plugin`) y un endpoint de management propio. No requiere recompilar el host.

El arquitrabe del ecosistema CPAMC es la convención de prefijos: el switcher descubre perfiles dinámicamente vía `config.ParsePrefix` (greedy, `^(.*)_(\d+)$`) y lee la cuota por `auth_index` filtrando por perfil [S-027][S-028][S-029][S-030]. Para `agy_clau` el perfil resultante es `clau`, que ya mapea al bucket Claude/GPT, y `agy` (perfil `""`) mapea a Gemini [S-028]. Es decir, la nomenclatura propuesta **encaja sin cambios en el switcher**.

El riesgo dominante es el `refresh_token` compartido entre archivos duplicados; se mitiga en gran parte porque el executor de Antigravity usa un `singleflight.Group` global **con clave en el propio refresh_token**, coalesciendo refrescos concurrentes de credenciales distintas [S-017]. El segundo riesgo es la pérdida transitoria de `Prefix` en runtime tras `host.auth.save` (issue #5381 abierto) [S-019][S-005][S-012], mitigable creando siempre archivos *nuevos* y evitando reescrituras idénticas.

## Research Question

¿Es **viable** que `plugins/visual-profile` soporte internamente **cuentas multi-prefijo / virtuales** — es decir, que una cuenta ya asignada al pool `agy` sirva además al pool `agy_clau` mediante **duplicados de auth-file por familia** (cada uno con su `prefix` y `excluded_models`) — **sin modificar el código fuente de CLIProxyAPI** y **sin que el navegador maneje tokens crudos si es evitable**?

Decisiones a informar: (1) qué mecanismo usar; (2) cómo debe `GroupManager` ofrecer candidatos de `agy_clau` a partir de cuentas ya en `agy`; (3) qué riesgos acotan o invalidan el diseño.

## Recommendation or Answer

**Recomendación: implementar el Mecanismo A (server-side)**, con el Mecanismo B como hoja de ruta/utilidad de diagnóstico si se necesita compatibilidad sin cambios de Go.

### Mecanismo A — server-side (`host.auth.get` + `host.auth.save`) — **RECOMENDADO**

Flujo por cada cuenta física que se quiera virtualizar:

1. La UI (GroupManager) envía al plugin un comando *no secreto*: `{action:"virtualize", source:"agy", family:"clau", sourceAuthIndex, keep:[...], extraExcludedModels:[...]}`.
2. El plugin (Go) llama `host.auth.get({auth_index})` → obtiene `{name, path, json}` (JSON con tokens) **sin salir del host** [S-004][S-005].
3. El plugin clona el JSON, y sobreescribe:
   - `prefix` = prefijo destino (p. ej. `agy_clau`).
   - `excluded_models` = exclusión de la familia destino (p. ej. excluir ids `gemini*`) calculada como complemento de la familia de la cuenta origen.
   - Conserva `type`, `email`, `project_id`, `refresh_token`, `access_token`, `timestamp`, `expires_in`, `expired`.
4. El plugin llama `host.auth.save({name:"<base>_agy_clau.json", json})` → el host escribe `AuthDir/<name>` (0o600) y hace upsert [S-004][S-005].
5. El `fsnotify` del host detecta el archivo **nuevo**, lo sintetiza con `SynthesizeAuthFile` (aplica `prefix` + `excluded_models` + `auth_kind`) y despacha la `AuthUpdate` [S-010][S-012].
6. La UI recarga la lista de auth-files y el nuevo nodo `agy_clau` aparece; la pool `clau` queda descubierta por el switcher [S-029].

Requisitos de código (acotados, en el plugin, no en el host):
- Añadir un puente cgo `hostCall(method, payload)` que invoque `stored_host->call(...)` (hoy `stored_host` se guarda pero nunca se usa) [S-022].
- Exponerlo a `internal/plugin` y añadir una ruta propia en `management.handle` (p. ej. `POST /api/virtualize`).
- No se necesita la management key en el plugin: usa los callbacks de host.

**Ventajas**: tokens nunca en el navegador; sin copiar/pegar secretos; el host resuelve rutas y upsert; compatible con el modelo de `auth_index` (path-derived, estable) [S-013].

### Mecanismo B — client-side (`POST /v0/management/auth-files`, multipart) — alterno

- El navegador hace `GET /v0/management/auth-files/download?name=...` (JSON completo), muta `prefix`/`excluded_models` y hace `POST /v0/management/auth-files` con el archivo (multipart o `?name=` + JSON crudo) [S-007][S-008][S-024].
- La ruta usa `buildAuthFromFileData` **con `SynthesizeAuthFile`**, por lo que el registro en runtime sale correcto de inmediato (sin la ventana de `Prefix` vacío del Mecanismo A) [S-008][S-010].
- **Contra**: el navegador transporta y manipula `refresh_token`/`access_token` en claro; choca con la invariante actual del cliente ("credentials are NEVER stored, returned, or logged") [S-024] y con el requisito de la tarea. Además, `DownloadAuthFile`/subida devuelven/aceptan el JSON íntegro (soporta 207 MultiStatus en carga parcial) [S-008].
- **A favor**: cero cambios de Go; usable como *fallback* o herramienta de administración avanzada/consciente del riesgo.

### Mecanismo C — expansión virtual del host (ParseAuths) — **DESCARTADO para este objetivo**

- Un plugin auth-provider puede expandir **un** archivo físico en **varios** auths runtime con distinto `Prefix` (`MarkPluginVirtualAuth`) [S-010].
- Pero la exclusión por modelo se calcula desde el **archivo físico** y se **sobreescribe** en cada virtual (`ApplyAuthExcludedModelsMeta`), por lo que **todos los virtuales comparten las mismas `excluded_models`** [S-010][S-011]. Esto rompe el aislamiento por familia.
- Además, los auths virtuales **no se persisten** (`persist()` los saltea con `IsPluginVirtualAuth`) [S-014], y este plugin ni siquiera declara la capability `auth_provider` [S-023]; implementarlo sería un cambio mayor y aun así insuficiente por la limitación de exclusiones.

### Comparativa

| Criterio | A: `host.auth.save` (server) | B: `POST /auth-files` (browser) | C: ParseAuths (virtual) |
|---|---|---|---|
| Tokens fuera del host | No (seguro) | **Sí (navegador)** | No |
| Cambios requeridos | Plugin Go + UI (puente host) | Solo UI | Cambio mayor (auth_provider) |
| `prefix` en runtime inmediato | Tras fsnotify (~ms) [S-012] | Inmediato [S-008] | Inmediato |
| `excluded_models` por familia | **Sí** (archivo propio) | **Sí** (archivo propio) | **No** (compartidas) [S-011] |
| Persistencia en disco | Sí [S-016][S-008] | Sí | **No** [S-014] |
| `auth_index` estable | Sí (path-derived) [S-013] | Sí | Sí (seed propio) |
| Compatible con switcher/ParsePrefix | Sí [S-027] | Sí | Sí (pero sin aislamiento) |

### Arquitectura concreta: `GroupManager` ofreciendo `agy_clau` desde cuentas ya en `agy`

Estado actual (hechos): `GroupManager` modela **un nodo = un archivo = un prefijo**; al "armar pool" solo emite `PATCH .../fields` sobre nodos existentes (`saveAuthFilePrefixes`) [S-024][S-025]. La familia se infiere por el nombre del prefijo (`agy_clau*`/`clau*`/`son*` → Claude/GPT; `agy*`/`g*` → Gemini) y `isPoolDescendant('agy','agy_clau')` es **falso** (sufijo alfabético) [S-025], por lo que disolver `agy` no toca `agy_clau`. Existe ya la noción de `geminiSubtype: 'pure' | 'claude'` [S-025].

Extensión propuesta (conceptual, sin implementar):

1. **Identidad física vs. archivo**: agrupar nodos por identidad física de cuenta (p. ej. `email` + `project_id`, legibles sin secretos vía `host.auth.get_runtime`, con el fallback binario→BOM de UTF-8) [S-004].
2. **Nueva acción "Añadir familia (virtualizar)"** en la pestaña *Crear Group/Pefiles*: al elegir la familia `claude` (subtipo `claude`), la lista de candidatos incluye **no solo nodos libres, sino también las cuentas físicas ya presentes en `agy`** (misma `email`/`project_id`) que aún no tengan un archivo de esa familia.
3. **Cálculo del prefijo destino**: `ConventionForProfile(provider,"clau")` ⇒ activo `agy_clau`, reservas `agy_clau_N` — idéntico al esquema del switcher [S-027]. Reutilizar `suggestNextBasePrefix`/`nextReserveNumber` para evitar colisiones [S-025].
4. **Cálculo de `excluded_models`**: mapa familia→exclusión (Gemini excluye ids `claude*`/`gpt*`; Claude excluye ids `gemini*`) y, para el nuevo archivo, **el complemento** del archivo origen; así ningún modelo queda servido por dos copias de la misma cuenta bajo la misma familia.
5. **Invocación**: `POST <plugin>/api/virtualize` (Mecanismo A) → crea el archivo → la UI refresca (con reintento/verificación) → entonces aplica, si hace falta, `PATCH .../fields` para fijar reserva `agy_clau_1` [S-009].
6. **Reversión**: "disolver virtual" = borrar el archivo duplicado (`DELETE /v0/management/auth-files`) [S-007], preservando el `agy` original; nunca renombrar el archivo físico original salvo intención explícita.

## Key Findings

- **F1 — CONFIRMADO (HIGH)**: el host en `d7914af` expone `MethodHostAuthSave` (`host.auth.save`) con `HostAuthSaveRequest{Name, JSON}` y `HostAuthSaveResponse{Name, Path}`; el nombre debe terminar en `.json` [S-004][S-005].
- **F2 — CONFIRMADO (HIGH)**: `POST /v0/management/auth-files` (UploadAuthFile) acepta multipart o JSON crudo con `?name=`, sintetiza con `SynthesizeAuthFile` y soporta 207 MultiStatus [S-007][S-008].
- **F3 — CONFIRMADO (HIGH)**: el alias v8 `POST/GET/DELETE /v8/management/credentials` mapea a los mismos handlers (`ListAuthFiles`/`UploadAuthFile`/`DeleteAuthFile`) [S-007]; en vivo `GET /v8/management/credentials` → `200` con `auth_index`, `path`, `project_id` [S-001].
- **F4 — CONFIRMADO (HIGH)**: no existe endpoint de "copiar credencial"; solo listar/descargar/subir/borrar/patch/refresh [S-007]. Duplicar = subir un JSON nuevo.
- **F5 — CONFIRMADO (HIGH)**: `host.auth.get` devuelve el `json` físico completo indexado por `auth_index` (lee del disco vía `path`) [S-005]; es la vía server-side para leer tokens sin navegador.
- **F6 — CONFIRMADO (HIGH)**: `host.auth.save` escribe el archivo y hace `upsertAuthRecord` → `Manager.Register/Update`, pero el `Auth` reconstruido (`buildAuthFromFileData` de pluginhost) **no aplica `prefix` ni `excluded_models`** (tampoco `disabled`): el registro inmediato queda con `Prefix` vacío [S-005][S-019].
- **F7 — CONFIRMADO (HIGH)**: el `fsnotify` del host re-sintetiza un archivo **nuevo/modificado** con `SynthesizeAuthFile` (aplica `prefix`, `excluded_models`, `auth_kind`, `priority`) [S-010][S-012]; para un archivo nuevo (sin hash previo) `authFileUnchanged` no suprime el re-procesamiento [S-012].
- **F8 — NUEVO RIESGO (MEDIUM)**: si se **reescribe** un archivo existente con contenido **idéntico** al último observado, `authFileUnchanged` (hash SHA-256) **suprime** el evento y el `Prefix` clobbeado por `host.auth.save` **no se restaura** hasta reinicio (issue #5381, abierto) [S-012][S-019].
- **F9 — CONFIRMADO (HIGH)**: `auth_index` = `sha256(authType + ":" + absFilePath)[:8]` para archivos `.json`; **nuevo nombre de archivo ⇒ nuevo índice estable**; el mismo path ⇒ mismo índice (sin churn al re-sintetizar) [S-013].
- **F10 — CONFIRMADO (HIGH)**: la expansión virtual (ParseAuths) aplica las `excluded_models` del archivo físico a **todos** los virtuales (sobreescritura en `ApplyAuthExcludedModelsMeta`) ⇒ **no permite aislamiento por familia** [S-010][S-011].
- **F11 — CONFIRMADO (HIGH)**: los auths virtuales **no se persisten** (`persist()` los omite vía `IsPluginVirtualAuth`) [S-014]; los archivos duplicados (normales) **sí** se persisten, y `FileTokenStore.Save` escribe en el `path` del propio archivo [S-016].
- **F12 — CONFIRMADO (HIGH)**: el executor de Antigravity coalesce refrescos con `antigravityRefreshGroup.Do(refreshToken, ...)` (clave = refresh_token): dos archivos que comparten token **no** disparan dos refrescos concurrentes dentro del proceso [S-017].
- **F13 — CONFIRMADO (HIGH)**: el `refresh_token` sólo se reescribe si la respuesta de Google incluye uno nuevo (`if tokenResp.RefreshToken != ""`); `UpdateRefreshedAuth` persiste en el `path` de cada archivo [S-015][S-016][S-017].
- **F14 — PARCIAL (MEDIUM)**: no hay deduplicación por `refresh_token` entre archivos (no se encontró mecanismo de dedupe de credenciales por token en el host para auth-files) ⇒ duplicar archivos **no** es rechazado por el host.
- **F15 — CONFIRMADO (HIGH)**: la cuota es propiedad de **una** identidad upstream; dos archivos de la misma cuenta devuelven el **mismo** payload de cuota. El filtro por perfil del switcher lee el bucket correcto por familia (`clau`/`son` → Claude/GPT; `g*`/`agy` → Gemini) [S-028][S-029][S-033].
- **F16 — CONFIRMADO (HIGH)**: `config.ParsePrefix('agy_clau')` ⇒ perfil `clau`, `IsActive:true`; `'agy_clau_1'` ⇒ perfil `clau`, reserva 1; `ConventionForProfile('antigravity','clau')` ⇒ activo `agy_clau`, reservas `agy_clau_` [S-027]. **Compatible con el switcher sin cambios.**
- **F17 — CONFIRMADO (HIGH)**: el plugin no tiene puente de host en Go; `stored_host` se captura pero no se invoca, y `management.handle` solo sirve estáticos [S-022][S-023][S-032].
- **F18 — CONFIRMADO (HIGH)**: el plugin ya descarga auth-files completos al navegador para leer `prefix` (`downloadAuthFilePrefix`) ⇒ el requisito "sin tokens en el navegador" **hoy no se cumple** y sería una mejora neta del Mecanismo A [S-024][S-032].
- **F19 — CONFIRMADO (HIGH, en vivo)**: estado actual = 4 cuentas `antigravity` sin prefijo en runtime expuesto; archivo `antigravity-infosoytec@gmail.com.json` con `prefix:"agy"` y `excluded_models` poblado (12 ids) y `project_id:"aicode-consumers"` [S-001][S-002]. Los 12 virtuales de obs 1190 **no** están desplegados ahora [S-031].
- **F20 — CONFIRMADO (HIGH)**: el listado `GET /v0/management/auth-files` **no** expone `prefix` (issue #5351, abierto), por lo que la verificación de "prefix aplicado" server-side debe hacerse con `host.auth.get`/re-lectura [S-001][S-005][S-020].

## Evidence Review

| # | Claim | Fuentes | Confianza | Limitaciones |
|---|---|---|---|---|
| C1 | Existen `host.auth.save` y `POST /v0/management/auth-files` en el host en ejecución | [S-004][S-005][S-007][S-008][S-001] | HIGH | Rutas verificadas en código (d7914af) y alias v8 verificado en vivo (200) |
| C2 | `host.auth.get` entrega el JSON físico (tokens) server-side por `auth_index` | [S-005][S-004] | HIGH | Requiere `path` presente en el auth; falla para auths runtime-only |
| C3 | `host.auth.save` no propaga `prefix`/`disabled` al runtime | [S-005][S-019] | HIGH | Issue abierto; corroborado por lectura de `buildAuthFromFileData` |
| C4 | El fsnotify re-sintetiza archivos nuevos/modificados | [S-010][S-012] | HIGH | Suprime eventos con hash idéntico (F8) |
| C5 | ParseAuths virtuales comparten `excluded_models` y no persisten | [S-010][S-011][S-014] | HIGH | Aplica a la ruta `auth.parse`; este plugin no la implementa |
| C6 | `auth_index` path-derived, estable por archivo | [S-013] | HIGH | Renombrar el archivo cambia el índice |
| C7 | Refrescos de Antigravity de tokens compartidos se coalescen | [S-017] | HIGH | Coalescencia = solo concurrente dentro de un proceso |
| C8 | No hay dedupe por refresh_token entre auth-files | [S-014][S-015] | MEDIUM | Búsqueda negativa; no prueba exhaustiva; `formatCredentialDedupKey` existe solo para API-keys de config [S-014] |
| C9 | `agy_clau` encaja en `ParsePrefix`/bucket del switcher | [S-027][S-028][S-029] | HIGH | Verificado por lectura de código local |
| C10 | No hay endpoint "copiar credencial" | [S-007] | HIGH | Tabla de rutas v0/v8 completa en fuente |
| C11 | El plugin debe implementar el puente de host (no existe hoy) | [S-022][S-023] | HIGH | Cambio acotado y aislado al plugin |
| C12 | Google no rota `refresh_token` en este flujo | [S-017][S-002] | LOW-MEDIUM | La evidencia es defensiva en código + archivos vivos conservan el mismo `refresh_token`; no hay prueba longitudinal |

## Trade-offs and Risks

**RISK-1 — `refresh_token` compartido y doble refresco (MEDIUM).**
Los duplicados comparten el mismo `refresh_token`. Mitigaciones confirmadas: (a) single-flight por refresh_token (`antigravityRefreshGroup.Do`) coalesce refrescos concurrentes de credenciales distintas [S-017]; (b) cada archivo persiste su propio `access_token` en su propio `path` [S-016]; (c) el `refresh_token` solo se reescribe si Google devuelve uno nuevo [S-017]. Riesgo residual: si Google **rotase** el token y lo devolviese solo a una copia, la otra quedaría con `invalid_grant` (el host marca `unauthorized (refresh token invalid)`) [S-015]. *No confirmado en el flujo actual* (F13/C12) ⇒ riesgo a vigilar, no bloqueante. Mitigación propuesta: reconciliar `refresh_token` entre hermanos (o re-login) ante `invalid_grant`.

**RISK-2 — Doble registro de modelos / ventana sin prefijo (LOW-MEDIUM).**
Tras `host.auth.save`, el registro inmediato tiene `Prefix` vacío y sin `excluded_models` [F6]. Hasta que el watcher re-sintetiza (~ms-1s) [S-012], el catálogo podría exponer modelos base servidos por la nueva copia. Al ser un intervalo muy corto y al afectar solo a peticiones sin prefijo, el impacto es bajo; el aislamiento por familia **no** se rompe de forma persistente porque el archivo lleva su `excluded_models` [S-010]. *(Contraste: con `force-model-prefix:false`, las peticiones base pueden ir a cualquier cuenta; ver S-033.)*

**RISK-3 — Clobber de `Prefix` por reescritura idéntica (MEDIUM, bug del host).**
Si la UI re-guarda (idempotente) un archivo existente con contenido byte-idéntico, el hash suprime el fsnotify y el `Prefix` en runtime queda vacío hasta reinicio (#5381) [S-008][S-019][S-012]. Mitigación: el plugin debe (a) crear siempre archivos **nuevos**, (b) saltar el `save` si el contenido no cambia, y (c) verificar post-save vía `host.auth.get`/`/v1/models` antes de confirmar.

**RISK-4 — Aislamiento de `excluded_models` (MEDIUM).**
Cada copia debe llevar exclusiones **complementarias** para que un mismo upstream-model no quede servido por dos copias de la misma cuenta en la misma familia. La ruta ParseAuths **no** lo permite [S-011]; la ruta de archivo propio **sí** [S-010]. No hay validación automática de solape: si el operador fija listas incorrectas, dos copias podrían servirse de modelos solapados (mismo bucket de cuota). *Discrepancia detectada*: obs 1190 usó exclusiones mínimas (p. ej. `claude-sonnet-4-6`), mientras el archivo vivo actual excluye 12 ids [S-002][S-031] ⇒ la política de exclusión no es uniforme (ver Unknowns).

**RISK-5 — Atribución de cuota (LOW, matiz importante).**
La cuota es de la cuenta upstream, no del archivo: duplicar **no** crea cuota adicional; simplemente permite que el switcher siga **independientemente** el bucket de cada familia para la **misma** cuenta [F15][S-028]. Dos archivos ⇒ dos llamadas de cuota con los mismos valores; el filtro por perfil asigna a cada pool su bucket [S-029]. No hay riesgo de doble consumo, pero tampoco beneficio de cuota.

**RISK-6 — Estabilidad de `auth_index` (LOW).**
Derivado del path absoluto [S-013]: crear el duplicado con un **nombre fijo y determinista** mantiene el índice estable entre reinicios; renombrar el archivo lo cambia (rompería asociaciones por índice en analítica/telemetría externa). El switcher no guarda estado por `auth_index` (solo `last_check`) [S-029/estado], por lo que el impacto operativo es bajo.

**RISK-7 — Compatibilidad con `ParsePrefix` y pools fantasma (LOW, pero requiere disciplina de nombres).**
`agy_clau` ⇒ perfil `clau` (activo); `agy_clau_1` ⇒ reserva 1 [S-027]. Nunca usar un nombre de archivo cuyo *prefix* termine en `_<dígitos>` salvo como reserva (evita pools fantasma, p. ej. `agy_clau_1_1` interpretado como perfil `clau_1`) [S-025][S-032]. `isPoolDescendant('agy','agy_clau')=false` evita que disolver `agy` arrastre `agy_clau`, pero exige una disolución explícita de la familia virtual [S-025].

**RISK-8 — Acoplamiento a callbacks solo presentes a partir de este commit (LOW).**
`host.auth.get/save` existen en `d7914af`; en hosts más antiguos podrían faltar. Mitigación: degradar a Mecanismo B (browser) o deshabilitar la función con detección de capacidad [S-004][S-007].

## Alternatives Considered

- **Solo `PATCH .../fields` (lo actual)**: no crea archivos ⇒ una cuenta no puede pertenecer a dos pools con distinta familia ni exclusiones distintas. Insuficiente por diseño [S-024][S-025].
- **ParseAuths / `auth_provider` (expansión virtual)**: cambio mayor y, por sobreescritura de exclusiones y no-persistencia, no logra aislamiento por familia [S-010][S-011][S-014].
- **`host.http.do` a la Management API** (llamar a `POST /credentials` desde el plugin Go): posible en teoría, pero `host.http.do` está pensado para upstream y requeriría la management key dentro del plugin; el callback dedicado `host.auth.save` es más limpio y ya existe [S-004][S-006].
- **Re-login separado por familia** (crear tokens nuevos por familia): aísla tokens y evita el refresh compartido, pero multiplica sesiones/consentimientos y no aporta cuota extra; descartado por coste operativo salvo si RISK-1 se materializa.
- **Mecanismo B (browser) como principal**: descartado por exponer tokens; conservado como fallback/diagnóstico.

## Unknowns and Limits

- **Rotación real de `refresh_token` de Google** en este cliente: no confirmada empíricamente de forma longitudinal (C12). Impacta directamente el RISK-1.
- **Política de `excluded_models`**: no existe una fuente única; obs 1190 (exclusiones mínimas) y el archivo vivo (12 ids) discrepan [S-002][S-031]. La lista "correcta" por familia queda como decisión del operador.
- **Comportamiento a escala del watcher** con muchos duplicados (posible *event storm* de fsnotify y múltiples `persistAuthAsync`): no medido [S-012].
- **Detalle de por qué `Prefix` en el listado está ausente hoy** (issue #5351 abierto) y si un futuro host cambiará `host.auth.save` para propagar `Prefix` (#5381): no resoluble con el host actual [S-019][S-020].
- **Verificación en vivo limitada**: no se ejecutó ninguna escritura (ni `save` ni `upload`) por la restricción READ-ONLY; la viabilidad se sustenta en fuente + rutas vivas, no en una prueba de extremo a extremo.

## Recommended Next Actions

1. **Decidir mecanismo** (recomendado A) y aprobar el cambio de plugin: puente de host `hostCall` + endpoint `POST <plugin>/api/virtualize` [S-022][S-004].
2. **Prototipo controlado** (fuera de esta tarea READ-ONLY): crear UN duplicado `agy_clau` de una cuenta `agy` y verificar (a) `auth_index` nuevo, (b) `prefix` en `/v1/models` como `agy_clau/<model>`, (c) coherencia de `excluded_models`, (d) supervivencia a un reinicio del host.
3. **Mitigar RISK-3**: regla "solo crear archivos nuevos; nunca reescribir idéntico sin cambio de contenido" + verificación post-save vía `host.auth.get`.
4. **Definir el mapa familia→`excluded_models`** y validarlo contra el catálogo real de Antigravity; documentar el complemento forzado entre las dos copias.
5. **Actualizar `GroupManager`**: agrupar por identidad física, acción "Añadir familia (virtualizar)", candidatos = cuentas de `agy` sin archivo de esa familia, y disolución explícita de la familia virtual [S-025].
6. **Vigilar RISK-1**: alarmar en `invalid_grant`/`unauthorized` de cualquier copia y ofrecer reconciliación de `refresh_token` entre hermanos [S-015][S-017].
