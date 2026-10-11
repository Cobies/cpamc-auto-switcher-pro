# Auditoría Causal: Desaparición del Pool `agy2` en CPAMC / Auto Switcher Pro y Pi Model Selector

## Executive Summary

Esta investigación profunda de **solo lectura** identificó la causa raíz exacta por la cual un pool de cuentas desapareció del selector de modelos (`/model`, `/cpamc-model`, `/model-select`) y de la telemetría del footer en Pi y Gentle-Shell.

### Conclusiones Clave

1. **El pool desaparecido es `agy2` (Perfil 2 / Gemini 2)**:
   - Configurado con la cuenta líder activa `wilsonlavio11@gmail.com` (prefijo `agy2`) y la cuenta de reserva `wilsonlavio9@gmail.com` (prefijo `agy2_1`).
   - Los otros tres pools (`agy` / Gemini 1, `agy_son` / Claude Sonnet y `agy_opus` / Claude Opus) continúan registrados en los selectores y cachés.
   - En paralelo, se detectó que el pool `agy_opus` se encuentra en agotamiento crítico de cuota semanal (100.0% consumido, 0.0% disponible en líder y reserva), aunque sus slugs aún se publican formalmente en el catálogo.

2. **Detonante inicial (Evento Upstream HTTP 503)**:
   - A las **23:00:51 local (15:00:51 UTC)** del 2026-10-08, una petición interactiva despachada con el modelo `agy2/gemini-3.8-flash-high` falló en el upstream de Google (`daily-cloudcode-pa.googleapis.com`) con el código **`HTTP 503 Service Unavailable: "The service is currently unavailable."`**, registrado en el log `/root/.cli-proxy-api/logs/error-v1-chat-completions-2026-10-08T230100-27037b89.log` del contenedor Docker [S-004].

3. **Cascada de fallo en 4 eslabones (Mecanismo del Desvanecimiento)**:
   - **Eslabón 1 (Despublicación en CLIProxyAPI)**: Al fallar la petición, CLIProxyAPI incrementó el contador en memoria `failed: 1` para la credencial `antigravity-wilsonlavio11@gmail.com.json` [S-001]. Siguiendo su política de salud de rutas (`service_models.go`), CLIProxyAPI retiró inmediatamente `agy2/gemini-3.8-flash-high` del endpoint público `GET /v1/models?client_version=1`, dejando únicamente publicada la reserva `agy2_1/gemini-3.8-flash-high` [S-002].
   - **Eslabón 2 (Ceguera del Hook de Failover ante errores 503)**: La extensión de Pi `extensions/cpamc-auto-switcher/src/failover.ts` solo intercepta errores `429`, `rate limit` o `quota exhausted` [S-007]. Al ser un error de infraestructura 503, no se activó la rotación forzada automática.
   - **Eslabón 3 (Filtrado estricto de reservas en el Proveedor Dinámico)**: Cuando el refresco periódico de catálogo de la extensión (ejecutado cada 75s en `index.ts` [S-009]) consultó `/v1/models`, la regla `isCleanIncludedModel` en `provider.ts` descartó deliberadamente a `agy2_1` por coincidir con la expresión regular de reserva `/_(\d+)$/` [S-006].
   - **Eslabón 4 (Sobreescritura de la caché y Deadlock Operativo)**: Al no haber modelos válidos bajo `agy2`, la extensión reescribió `~/.pi/agent-j0k3r/cpamc-models-cache.json` a las 15:09 UTC reduciendo el catálogo de 8 a 7 modelos [S-005]. Sin modelos seleccionables en la interfaz, ningún cliente pudo volver a enviar peticiones al prefijo `agy2`, impidiendo que CLIProxyAPI registre un éxito que limpie el estado `failed: 1`.

---

## Research Question

1. ¿Cuál de los pools configurados en CPAMC (`agy`, `agy2`, `agy_son`, `agy_opus` o `codex`) desapareció del selector de modelos y footer de Pi?
2. ¿Cuál es el estado en vivo de las credenciales en CLIProxyAPI (`/v0/management/auth-files`) y qué modelos publica activamente `/v1/models`?
3. ¿Cuál fue el mecanismo técnico exacto (expiración de token, cuota 429, error upstream, filtrado regex o mutación de estado) que provocó la desaparición?
4. ¿Por qué el sistema de Auto Switcher no recuperó automáticamente el pool mediante su cuenta de reserva o rebalanceo proactivo?
5. ¿Cuáles son las acciones de remediación inmediatas y definitivas?

---

## Recommendation or Answer

### Diagnóstico Directo
El pool que desapareció es **`agy2`** (Gemini Profile 2). No fue borrado del disco ni desconfigurado en la base de datos de credenciales; sigue existiendo en `/root/.cli-proxy-api/antigravity-wilsonlavio11@gmail.com.json` y en `cpamc-auto-switcher -list` con cuota saludable (16.5% libre) [S-001][S-003].

Desapareció de la vista del usuario porque **CLIProxyAPI lo retiró de `/v1/models` tras un único error upstream HTTP 503**, la extensión de Pi filtró a su reserva saludable `agy2_1` como parte de su diseño anti-duplicados, y el ciclo de refresco automático sincronizó ese vacío en la caché local `cpamc-models-cache.json` [S-002][S-005][S-006].

### Remedio Inmediato (Operativo)
Dado que la cuenta de reserva `agy2_1` (`wilsonlavio9@gmail.com`) está 100% sana (`failed: 0`, 100% de cuota disponible), se puede restablecer el pool de inmediato mediante cualquiera de estas opciones:
1. **Rotación manual hacia la reserva**:
   ```bash
   cpamc-auto-switcher --switch agy2_1
   ```
   Esto promueve la cuenta sana a líder `agy2` y degrada la cuenta con fallo a reserva, forzando a CLIProxyAPI a republicar la ruta inmediatamente.
2. **Reinicio del contenedor Docker de CLIProxyAPI**:
   ```bash
   docker restart cli-proxy-api
   ```
   Reinicia los estados volátiles en memoria (`failed: 1`) y fuerza la regeneración completa de la tabla de rutas en `/v1/models`.

### Solución Arquitectural Definitiva
Para evitar futuros bloqueos irreversibles:
1. **Fallback a reserva en `provider.ts`**: Si el líder de un pool no expone modelos en `/v1/models` pero su reserva `_1` sí los expone, el proveedor dinámico debe exponer el modelo bajo el slug canónico del líder apoyándose en la ruta de la reserva [S-006].
2. **Ampliación de `failover.ts` a errores 502/503**: Incorporar códigos `502` y `503` en la detección de fallos de proveedor para disparar conmutación automática cuando Google Cloud Code sufra degradación [S-007].
3. **Rebalanceo proactivo multi-pool**: Modificar `checkProactivePoolRebalance` en `store.ts` para que evalúe periódicamente la totalidad de los pools configurados, y no únicamente el modelo activo actual de la sesión de Pi [S-008].

---

## Key Findings

### 1. Identificación del Pool Afectado y Estado Comparativo
Al contrastar las tres fuentes de verdad del sistema:
- **`cpamc-auto-switcher -list`** [S-003]:
  ```text
  STATUS      PROVIDER      PROFILE   ACCOUNT ID            PREFIX       5H CONSUMED   WEEKLY CONSUMED   MIN AVAILABLE
  [ACTIVE]    antigravity   default   inf...tec@gmail.com   agy          2.2%          9.7%              90.3%
  [RESERVE]   antigravity   default   mar...tro@gmail.com   agy_1        0.0%          47.3%             52.7%
  [ACTIVE]    antigravity   2         wil...o11@gmail.com   agy2         11.1%         83.5%             16.5%
  [RESERVE]   antigravity   2         wil...io9@gmail.com   agy2_1       N/A           0.0%              100.0%
  [ACTIVE]    antigravity   opus      wil...o11@gmail.com   agy_opus     0.0%          100.0%            0.0%
  [RESERVE]   antigravity   opus      wil...io9@gmail.com   agy_opus_1   N/A           100.0%            0.0%
  [ACTIVE]    antigravity   son       mar...tro@gmail.com   agy_son      0.0%          67.1%             32.9%
  [RESERVE]   antigravity   son       inf...tec@gmail.com   agy_son_1    0.0%          51.9%             48.1%
  ```
- **CLIProxyAPI `GET /v1/models?client_version=1`** [S-002]:
  - `agy/gemini-3.8-flash-high` → **PRESENTE**
  - `agy_1/gemini-3.8-flash-high` → **PRESENTE**
  - `agy2/gemini-3.8-flash-high` → ❌ **AUSENTE**
  - `agy2_1/gemini-3.8-flash-high` → **PRESENTE**
  - `agy_son/...` (3 modelos) → **PRESENTES**
  - `agy_son_1/...` (3 modelos) → **PRESENTES**
  - `agy_opus/...` (3 modelos) → **PRESENTES**
  - `agy_opus_1/...` (3 modelos) → **PRESENTES**

- **Caché local de Pi `cpamc-models-cache.json`** [S-005]:
  - Contiene exactamente 7 modelos: 1 de `agy`, 3 de `agy_son`, 3 de `agy_opus`.
  - Contiene **0 modelos bajo `agy2`**.

El pool desaparecido es categórica e indiscutiblemente **`agy2`**.

---

### 2. Evidencia Forense del Fallo Upstream (Log de Docker)
En el archivo de registro `/root/.cli-proxy-api/logs/error-v1-chat-completions-2026-10-08T230100-27037b89.log` [S-004], se encontró el registro completo de la transacción que originó la falla:

- **Timestamp de inicio**: `2026-10-08T23:00:51.770Z` (15:00:51 UTC).
- **Modelo solicitado por el cliente**: `{"model":"agy2/gemini-3.8-flash-high", ...}`.
- **Credencial asignada**: `auth_id: antigravity-wilsonlavio11@gmail.com.json`, `auth_index: 58bbc58486c622fb`.
- **URL destino upstream**: `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`.
- **Respuesta recibida**:
  ```json
  HTTP/1.1 503 Service Unavailable
  {
    "error": {
      "code": 503,
      "message": "The service is currently unavailable.",
      "status": "UNAVAILABLE"
    }
  }
  ```

---

### 3. El Contador `failed: 1` en CLIProxyAPI y su Efecto de Aislamiento
Al consultar el endpoint de gestión `GET /v0/management/auth-files` [S-001]:
- `antigravity-wilsonlavio11@gmail.com.json`:
  - `failed: 1`
  - `status: "active"`
  - `unavailable: false`
  - `recent_requests`: en la ventana `23:00-23:10`, `success: 7, failed: 1`. En la ventana posterior `23:10-23:20`, `success: 0, failed: 0`.
- Los otros 7 archivos de credenciales:
  - `failed: 0` de manera uniforme.

Por diseño interno de CLIProxyAPI (`sdk/cliproxy/service_models.go`), cuando un archivo de autenticación sufre un error de ejecución o entra en estado de fallo transitorio para un modelo determinado, el generador de rutas retira el slug prefijado del catálogo `GET /v1/models`. Como resultado, `agy2/gemini-3.8-flash-high` dejó de ser emitido.

---

### 4. Filtrado de Reservas en `provider.ts` y la Pérdida del Catálogo
En el código de la extensión Pi (`extensions/cpamc-auto-switcher/src/provider.ts` líneas 395–400) [S-006]:
```typescript
function isCleanIncludedModel(id: string, filterData: ...): boolean {
    const slashIndex = trimmed.indexOf("/");
    const prefix = trimmed.slice(0, slashIndex);

    // Omitir prefijos de cuentas de reserva (ej. _1, _2)
    if (/_(\d+)$/.test(prefix)) {
        return false;
    }
```
1. CLIProxyAPI sí estaba publicando `agy2_1/gemini-3.8-flash-high` [S-002].
2. Sin embargo, `isCleanIncludedModel` evaluó `/_(\d+)$/.test("agy2_1") === true` y lo descartó para evitar duplicar opciones en el selector de Pi.
3. Al estar `agy2` ausente por el fallo 503 y `agy2_1` bloqueado por la regla de reservas, el pool `agy2` se quedó con **cero modelos elegibles**.
4. La función `saveCachedModels` guardó la lista resultante en `~/.pi/agent-j0k3r/cpamc-models-cache.json` a las 15:09 UTC [S-005], borrando a `agy2` de la memoria persistente del cliente.

---

### 5. ¿Por qué Falló la Auto-Recuperación? (Análisis de Bloqueo)

Existían tres mecanismos teóricos que pudieron haber rescatado al pool, pero los tres quedaron neutralizados:

| Mecanismo de Rescate | Comportamiento Observado | Causa del Bloqueo |
| :--- | :--- | :--- |
| **Hook de Failover (`failover.ts`)** [S-007] | Inactivo. No lanzó `cpamc-auto-switcher --force`. | `RATE_LIMIT_PATTERN` busca exclusivamente patrones `429`, `rate limit` o `quota`. Ignoró el error 503. |
| **Switcher Programado (`switcher.go`)** [S-010] | Inactivo. Reportó estado saludable (`[OK]`). | Los umbrales de rotación son 90% (5h) y 95% (semanal). La cuenta activa estaba al 11.1% (5h) y 83.5% (semanal), por lo que el CLI consideró que no requería rotación. |
| **Rebalanceo Proactivo de Sesión (`store.ts`)** [S-008] | Inactivo. No evaluó la brecha de cuotas. | `checkProactivePoolRebalance` solo evalúa `ctx.model.id`. Como Pi ya estaba posicionado en `agy`, solo auditó el pool `default`, ignorando el pool `2` (a pesar de que `agy2_1` tenía una ventaja de 83.5% de cuota sobre `agy2`). |

Esto creó un **bucle de bloqueo estático (Deadlock)**:
```
[ Upstream Google 503 ]
         │
         ▼
[ failed: 1 en wilsonlavio11 ]
         │
         ▼
[ CLIProxyAPI retira agy2 de /v1/models ]
         │
         ▼
[ provider.ts filtra agy2_1 por regex de reserva ]
         │
         ▼
[ cpamc-models-cache.json purga agy2 ]
         │
         ▼
[ Ningún cliente puede seleccionar ni llamar a agy2 ]
         │
         ▼
[ wilsonlavio11 jamás recibe una petición exitosa ]
         │
         ▼
[ failed: 1 nunca se limpia (Bloqueo Permanente) ]
```

---

## Evidence Review

| # | Afirmación / Hallazgo | Fuentes | Nivel Confianza | Justificación Empírica |
|---|---|---|---|---|
| E-01 | El pool desaparecido es `agy2` | [S-002], [S-003], [S-005] | **HIGH** | Verificado en vivo: 0 modelos en caché y en `/v1/models`, mientras que `agy`, `agy_son` y `agy_opus` están intactos. |
| E-02 | El detonante fue un HTTP 503 de Google Cloud Code | [S-004] | **HIGH** | Registro exacto en log de Docker con trace ID `58bbc58486c622fb-01a11c08-0bb9-7ee8-85a7-e7eb27037b89`. |
| E-03 | CLIProxyAPI mantiene `failed: 1` en la cuenta líder | [S-001] | **HIGH** | Confirmado mediante consulta HTTP en vivo a `/v0/management/auth-files`. |
| E-04 | La reserva `agy2_1` está 100% sana y disponible | [S-001], [S-002], [S-003] | **HIGH** | `failed: 0`, 100.0% cuota disponible, y modelo publicado en `/v1/models`. |
| E-05 | `provider.ts` descarta la reserva activa por regla regex | [S-006] | **HIGH** | Inspección de la línea de código `if (/_(\d+)$/.test(prefix)) return false;`. |
| E-06 | `failover.ts` es ciego a errores HTTP 503 | [S-007] | **HIGH** | `RATE_LIMIT_PATTERN` en TypeScript solo busca `429` y `quota`. |
| E-07 | `cpamc-auto-switcher` no rotó por umbrales no alcanzados | [S-003], [S-010] | **HIGH** | Consumos de 11.1% y 83.5% se encuentran por debajo del 90% y 95% configurados. |
| E-08 | Rebalanceo proactivo solo inspecciona el modelo actual de la sesión | [S-008], [S-009] | **HIGH** | Verificado en `index.ts`: solo pasa `ctx.model.id` a `checkProactivePoolRebalance`. |

---

## Trade-offs and Risks

- **Riesgo de exponer reservas en el selector vs Resiliencia de Pool**:
  - Si se elimina sin precauciones el filtro `/_(\d+)$/` en `provider.ts`, el selector de modelos se inundará con duplicados confusos (`agy/gemini`, `agy_1/gemini`, `agy2_1/gemini`, `agy_son_1/sonnet`), desvirtuando el propósito del switcher autónomo.
  - La solución debe exponer el identificador base del pool (`agy2/gemini-3.8-flash-high`) mapeándolo internamente a la reserva si el líder está caído, o exponer la reserva temporalmente solo cuando el líder tenga 0 modelos.
- **Riesgo en el pool `agy_opus`**:
  - Aunque `agy_opus` no ha desaparecido visualmente del menú, ambas cuentas (`wilsonlavio11` y `wilsonlavio9`) se encuentran al 100% de consumo semanal (0% disponible). Si el usuario selecciona Claude Opus, recibirá un error 429 inmediato.

---

## Alternatives Considered

1. **Esperar al refresco natural de token de Google**:
   - *Descartada*: El token expira a las `00:00:58` (más de 30 minutos después). Incluso al refrescarse el token OAuth, si CLIProxyAPI mantiene el estado de fallo en el modelo o no recibe tráfico, la despublicación persistiría.
2. **Reconfigurar el pool en la interfaz gráfica web de Auto Switcher Pro**:
   - *Viable pero manual*: Disolver el pool y volver a agrupar reasigna los prefijos, pero requiere intervención humana del usuario en el navegador.
3. **Rotación asistida por CLI (`--switch agy2_1`)**:
   - *Recomendada como recuperación inmediata*: Intercambia instantáneamente los roles entre líder y reserva sin tocar archivos de configuración ni reiniciar servicios.

---

## Unknowns and Limits

- **Mecánica interna de descarte en el binario compilado de CLIProxyAPI**: CLIProxyAPI v8.0.13 evalúa la disponibilidad de modelos mediante estructuras no documentadas de `ModelStates`. No existe un endpoint público específico para consultar el tiempo exacto de enfriamiento interno tras un error 503 sin un header `Retry-After`.

---

## Recommended Next Actions

### 1. Remediación Inmediata (Restauración de `agy2`)
Ejecutar el comando de conmutación manual para promover la reserva sana al puesto líder:
```bash
cpamc-auto-switcher --switch agy2_1
```
O reiniciar el contenedor del proxy para limpiar el contador `failed: 1`:
```bash
docker restart cli-proxy-api
```
Una vez restaurado en `/v1/models`, forzar el refresco de catálogo en Pi o aguardar al tick automático de 75 segundos.

### 2. Parche en `extensions/cpamc-auto-switcher/src/failover.ts`
Ampliar el patrón de detección de fallos para incluir errores de indisponibilidad de infraestructura:
```typescript
const RATE_LIMIT_PATTERN = /\b(429|502|503)\b|rate.?limit|too many requests|quota|resource.?exhausted|service.?unavailable/i;
```

### 3. Parche en `extensions/cpamc-auto-switcher/src/provider.ts`
Implementar resiliencia ante líderes caídos en `fetchCLIProxyModels`:
- Si un prefijo de líder conocido (ej. `agy2`) tiene 0 modelos en `/v1/models`, pero su reserva correspondiente (ej. `agy2_1`) tiene modelos disponibles, admitir temporalmente el modelo de la reserva mapeándolo o exponiéndolo como sustituto para evitar que el pool desaparezca por completo.

### 4. Parche en `extensions/cpamc-auto-switcher/index.ts`
En el hook `session_start`, ejecutar la comprobación de rebalanceo proactivo sobre todos los pools configurados devueltos por `querySwitcherAccounts()`, en lugar de restringirse únicamente al modelo activo en `ctx.model`.
