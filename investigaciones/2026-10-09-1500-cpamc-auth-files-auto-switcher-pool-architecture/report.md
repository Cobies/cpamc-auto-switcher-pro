# Arquitectura de Archivos de Autenticación, Auto Switcher Pro y Pools CPAMC

## Executive Summary

La infraestructura de proxy de IA basada en **CPAMC (CLIProxyAPI)** y el plugin **Auto Switcher Pro** administra el ciclo de vida de credenciales OAuth, la segregación de cuotas por proveedor/familia de modelos, y la rotación en cascada de cuentas activas y reservas. Este informe documenta exhaustivamente la cadena arquitectónica completa: desde los archivos de autenticación nativos generados tras el inicio de sesión OAuth en CPAMC, pasando por la abstracción de cuentas virtuales $N \to 2N$ de Auto Switcher Pro, hasta la estructuración de grupos/perfiles (Líder / Reservas en cascada), la ventilación e aislamiento de cuotas de Gemini vs. Claude Sonnet/Opus, y la integración homogénea con las extensiones de Pi (`dynamic-provider`, `j0k3r-model-picker`, `j0k3r-theme` y `cpamc-usage`).

---

## Research Question

¿Cómo se encadenan los archivos de autenticación nativos de CPAMC, las credenciales virtuales de Auto Switcher Pro, la arquitectura de grupos/perfiles/pools y el aislamiento de cuotas de Gemini frente a Claude Sonnet/Opus, y cómo deben consumir de forma limpia y consistente esta lógica las extensiones de Pi?

---

## Recommendation or Answer

1. **Separación Estricta de Identidades Físicas vs. Credenciales Virtuales ($N \to 2N$):** Conservar los archivos de autenticación nativos (`/root/.cli-proxy-api/<provider>-<email>.json`) exclusivamente como la **Identidad Física OAuth Maestra** [S-001]. No asignar prefijos ni rutas directamente sobre las cuentas maestras de Google/Antigravity cuando compartan múltiples servicios de IA.
2. **Clonación Virtualizada por Familia de Modelos (Auto Auth-Files):** Utilizar la función de virtualización de Auto Switcher Pro (`POST /v0/management/auto-switcher-pro/virtualize`) para derivar credenciales virtuales deterministas (`<master_base>.<prefix>.json`) [S-003, S-004]. Esto permite que una única cuenta física Antigravity se desdoble en una **Tarjeta Gemini** (`prefix: agy`) y una **Tarjeta Claude** (`prefix: agy_son` o `agy_opus`), aislando sus cuotas mediante listas explícitas de exclusión de modelos (`excluded_models`) [S-005, S-010].
3. **Estructura de Pools con Líder y Reservas en Cascada:** Definir los grupos mediante una convención de prefijos limpia: el **Líder** recibe el prefijo base del pool (`agy`, `agy2`, `agy_son`, `agy_opus`, `clau`, `codex`), mientras que las **Reservas** reciben el prefijo base más un sufijo numérico secuencial (`<base>_1`, `<base>_2`) [S-006].
4. **Consumo Homologado en Extensiones de Pi:** Todas las extensiones de Pi deben consumir el catálogo dinámico a través de `extensions/cpamc-auto-switcher/src/provider.ts` (o `cliproxyapi-dynamic-provider.ts`) [S-007, S-008]. El proveedor dinámico debe:
   - Suprimir de la lista `/v1/models` los prefijos de reserva (`/_(\d+)$/`) para evitar la duplicación de modelos en el selector TUI.
   - Interrogar a la Management API (`/v0/management/auth-files/download?name=...`) para respetar las exclusiones reales por archivo.
   - Derivar etiquetas conjugadas de pool (`P1·LÍDER agy`, `P2·LÍDER agy_son`, etc.) mediante `buildPoolLabelMap`.
   - Guardar atómicamente el catálogo procesado en las rutas de caché unificadas (`cpamc-models-cache.json`) en `~/.pi/agent/`, `~/.pi/agent-j0k3r/` y `~/.gentle-shell/agent/` [S-011].

---

## Key Findings

### 1. Archivos de Autenticación Nativos de CPAMC (`/root/.cli-proxy-api/*.json`)

* **Ubicación en Disco y Volumen:** En el contenedor Docker `cli-proxy-api`, los archivos nativos se almacenan en `/root/.cli-proxy-api/`, respaldados por el volumen de Docker `cliproxy_auth` (`/var/lib/docker/volumes/cliproxy_auth/_data`) [S-001].
* **Origen:** Se crean automáticamente cuando un usuario completa el flujo de inicio de sesión OAuth en CPAMC (ej. `antigravity-wilsonlavio9@gmail.com.json`, `antigravity-infosoytec@gmail.com.json`) [S-001].
* **Naturaleza:** Representan la **Identidad OAuth Física Maestra**. Contienen tokens de acceso y actualización, información de proyecto GCP/AI Studio y metadatos de telemetría nativos (`auth_index`, `project_id`, `cooldowns`, `recent_requests`) [S-004].
* **El Problema del Paquete Antigravity:** Una cuenta física de Google/Antigravity otorga acceso simultáneo a dos baldes de cuota independientes en los servidores de Google:
  1. **Cuota de Modelos Gemini:** `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`.
  2. **Cuota de Modelos Claude / GPT:** `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-opus-4`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`.
  Si un archivo de autenticación nativo sin filtrar procesa solicitudes tanto para Claude como para Gemini, un agotamiento de cuota (HTTP 429) en Claude coloca todo el archivo nativo en cooldown, bloqueando indebidamente las solicitudes de Gemini sobre la misma identidad física.

### 2. Arquitectura de Cuentas Virtuales de Auto Switcher Pro ($N \to 2N$)

* **Virtualización por Puente Host:** Auto Switcher Pro implementa una abstracción de tarjetas gestionadas $N \to 2N$ mediante invocaciones al puente del host (`host.auth.list`, `host.auth.get`, `host.auth.save`, `host.auth.delete`) expuestas en la ruta `POST /v0/management/auto-switcher-pro/virtualize` [S-003, S-004].
* **Mecanismo Interno:** El servidor lee el JSON del archivo maestro origen, modifica los campos de control (`prefix` y `excluded_models`) y guarda una nueva credencial virtual en el disco de CPAMC con la nomenclatura determinista:
  $$\text{Nombre Virtual} = \text{base\_maestra} . \text{prefijo} . \text{json}$$
  *Ejemplo:* `antigravity-wilsonlavio9@gmail.com.json` $\to$ `antigravity-wilsonlavio9@gmail.com.agy_son.json` [S-003, S-004].
* **Invariante de Seguridad y Privacidad:** Las credenciales brutas, refresh tokens y secretos jamás salen del proceso Go en CPAMC ni se transmiten al navegador web ni a las extensiones cliente. Solo se manipulan metadatos de exclusión e identificadores [S-004].
* **Modelo Gestionado de Tarjetas $2N$:** Para $N$ cuentas OAuth maestras físicas, el frontend de Auto Switcher Pro sintetiza exactamente $2N$ tarjetas gestionadas en la interfaz (`buildManagedPoolCards`) [S-004, S-005]:
  - **1 Tarjeta Gemini por cuenta:** Orientada exclusivamente a modelos Gemini (`excluded_models` contiene modelos Claude/GPT).
  - **1 Tarjeta Claude por cuenta:** Orientada exclusivamente a modelos Claude (`excluded_models` contiene modelos Gemini).

### 3. Arquitectura de Pools: Líder y Reservas en Cascada

* **Definición de Pool Base:** Un pool es un conjunto de cuentas identificadas por un prefijo común.
* **Cuenta Líder (LÍDER):** Es la cuenta principal responsable de atender el tráfico normal de un pool. Su prefijo coincide exactamente con el prefijo base del pool (ej. `prefix: agy`, `prefix: agy_son`, `prefix: agy_opus`) [S-006].
* **Cuentas de Reserva (RESERVA):** Son cuentas de respaldo configuradas para asumir el tráfico únicamente cuando la cuenta Líder entra en estado de cooldown/agotamiento de cuota (HTTP 429). Utilizan la convención de sufijo numérico `<base>_\d+`:
  $$\text{Líder} = \text{agy} \quad \longrightarrow \quad \text{Reserva 1} = \text{agy\_1}, \quad \text{Reserva 2} = \text{agy\_2}$$
  $$\text{Líder} = \text{agy\_son} \quad \longrightarrow \quad \text{Reserva 1} = \text{agy\_son\_1}, \quad \text{Reserva 2} = \text{agy\_son\_2}$$
* **Rotación y Failover Nátivo:** CPAMC evalúa la salud de las cuentas dentro de un pool. Si `agy` responde con HTTP 429, el motor de enrutamiento desplaza las peticiones entrantes hacia `agy_1`. Al recuperarse la cuota de `agy`, el sistema reasigna automáticamente el rol prioritario [S-006, S-010].

### 4. Aislamiento de Cuotas: Gemini Puro vs. Claude Sonnet vs. Claude Opus

Auto Switcher Pro clasifica y gestiona sub-tipos dedicados dentro de los paquetes Antigravity para evitar la interferencia de cuotas entre modelos pesados (Opus) y tareas de código ágil (Sonnet) [S-006, S-012]:

| Sub-tipo / Familia | Icono | Prefijo Base | Balde de Cuota Google | Exclusiones Aplicadas (`excluded_models`) | Uso Típico |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **Gemini Puro** | 🔷 | `agy`, `agy2` | Gemini Models | `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-opus-4`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking` | Tareas generales de Gemini 2.5 Pro / Flash |
| **Claude Sonnet** | 🔶 | `agy_son`, `agy_son2` | Claude and GPT models | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `claude-opus-4`, `claude-opus-4-6-thinking` | Desarrollo ágil y codificación con Claude Sonnet 4.6 / 5.5 High |
| **Claude Opus** | 🟣 | `agy_opus`, `agy_opus2` | Claude and GPT models | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `claude-sonnet-4-6`, `claude-3-7-sonnet` | Razonamiento profundo con Claude Opus 4.6 Thinking / 5.5 High |
| **Claude Multipropósito** | 🎭 | `agy_clau`, `agy_clau2` | Claude and GPT models | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash` | Balde compartido Sonnet + Opus |

### 5. Cadena de Integración y Consumo en Extensiones de Pi

El flujo de información desde el disco de CPAMC hasta las extensiones de Pi sigue una secuencia determinista y homologada [S-007, S-008, S-011]:

```
[OAuth Login en CPAMC] ──> Archivo Nativo (/root/.cli-proxy-api/antigravity-user.json)
                                   │
                                   ▼
[Auto Switcher Pro Web/Go] ──> Virtualización / Clonación
                                   │
                                   ├──> antigravity-user.json (prefix: agy, excluye Claude)
                                   └──> antigravity-user.agy_son.json (prefix: agy_son, excluye Gemini)
                                   │
                                   ▼
[CPAMC Routing Engine] ──> Expone endpoints HTTP /v1/models y /v0/management/auth-files
                                   │
                                   ▼
[Pi Dynamic Provider] ──> 1. Descarga metadata (/auth-files/download?name=...)
(extensions/cpamc-auto-switcher) 2. Filtra prefijos de reserva (_1, _2) mediante /_(\d+)$/
                          3. Conjuga etiquetas de pool: "P1·LÍDER agy", "P2·LÍDER agy_son"
                          4. Guarda en caché en cpamc-models-cache.json
                                   │
                                   ▼
[Componentes Pi UI] ──────> 1. j0k3r-model-picker: Muestra selector limpio con insignias ⭐ [P1·LÍDER agy]
                           2. j0k3r-theme: Renderiza telemetría y modelo activo en TUI
                           3. cpamc-usage: Muestra métricas de tokens y cuotas consumidas
```

---

## Evidence Review

* **Cadena de Virtualización Backend:** Verificada en `plugins/visual-profile/internal/plugin/virtualize.go`. La función `Virtualize()` lee el archivo físico mediante `host.auth.get`, sobrescribe `prefix` y recalcula `excluded_models` invocando `computeVirtualExclusions()`, y persiste el nuevo archivo mediante `host.auth.save` [S-003].
* **Filtro Estricto de Reservas en Pi Extension:** Verificado en `extensions/cpamc-auto-switcher/src/provider.ts` y `~/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`. La función `isCleanIncludedModel()` evalúa la expresión regular `/_(\d+)$/`. Si el prefijo contiene un sufijo de reserva, el modelo se excluye de la lista retribuida por `/v1/models` para Pi [S-007, S-008].
* **Conjugación Determinista de Pools:** La función `buildPoolLabelMap()` agrupa todas las bases de pool existentes y genera nombres correlativos (`P1·LÍDER agy`, `P2·LÍDER agy_son`, `P3·LÍDER agy_opus`), garantizando que la barra de estado y el selector de modelos muestren exactamente la jerarquía activa [S-007, S-011].
* **Persistencia Multitarget de Caché:** `resolveCacheTargets()` asegura que `saveCachedModels()` escriba sincrónicamente en `~/.pi/agent/cpamc-models-cache.json`, `~/.pi/agent-j0k3r/cpamc-models-cache.json` y `~/.gentle-shell/agent/cpamc-models-cache.json`, eliminando desincronizaciones entre diferentes entornos ejecutables [S-007].

---

## Trade-offs and Risks

1. **Riesgo de Modificación Manual de Archivos en `/root/.cli-proxy-api`:** Si un administrador edita manualmente un JSON de autenticación directamente en el sistema de archivos sin pasar por el plugin o la Management API, se corre el riesgo de invalidar los metadatos de exclusión o corromper el índice de autenticación (`auth_index`).
2. **Dependencia de la Key de Management para Extensiones Pi:** El proveedor dinámico requiere acceso a la clave de administración (`CLIPROXYAPI_MANAGEMENT_KEY` o `~/.cliproxy_management_key`) para consultar `/v0/management/auth-files/download`. Si la clave falta o expira, el proveedor utiliza la caché local `cpamc-models-cache.json` como fallback defensivo.

---

## Alternatives Considered

1. **Uso de Archivos Nativos Únicos sin Virtualización:** (Rechazado) Forzar a que un solo archivo nativo atienda Gemini y Claude provocaba bloqueos cruzados de cuota (HTTP 429 en Claude tumbaba las solicitudes de Gemini).
2. **Duplicación Manual de Cuentas OAuth:** (Rechazado) Re-autenticar la misma cuenta en CPAMC creaba duplicados en los desplegables de candidatos de la consola de administración, causando confusión y saturación visual. La abstracción $N \to 2N$ con credenciales virtuales resolvió esto de forma limpia.

---

## Unknowns and Limits

* **Acceso a Sistemas de Archivos Restringidos:** La inspección directa con la herramienta `read` del sistema operativo hacia `/root/.cli-proxy-api/` requiere privilegios de contenedor Docker o sudo. La inspección se validó de forma segura mediante `docker exec cli-proxy-api ls -la /root/.cli-proxy-api/`.

---

## Recommended Next Actions

1. **Mantener la Homologación de Extensiones:** Asegurar que cualquier actualización futura en la lógica de etiquetado o filtrado de pools en `extensions/cpamc-auto-switcher/src/provider.ts` se copie o enlace directamente a `~/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`.
2. **Verificación Periódica de Caché Multitarget:** Mantener la función `resolveCacheTargets()` para prevenir regresiones donde background jobs en un entorno (ej. Gentle Shell) sobrescriban la caché de J0k3r Pi con datos desactualizados.
