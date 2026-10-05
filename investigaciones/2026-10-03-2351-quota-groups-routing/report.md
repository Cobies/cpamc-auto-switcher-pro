# Grupos de cuota de Antigravity (`retrieveUserQuotaSummary`) y enrutamiento de modelos en CLIProxyAPI

## Executive Summary

Ambas incógnitas del reporte anterior quedan resueltas, una de ellas con **evidencia en vivo** capturada vía la Management API local (solo lectura):

1. **`retrieveUserQuotaSummary` NO distingue Gemini 3.7 vs 3.8 ni variantes flash/pro como grupos separados.** El payload real (capturado el 2026-10-03 desde `daily-cloudcode-pa.googleapis.com` vía el proxy `POST /v0/management/api-call` de CLIProxyAPI v8.0.13) devuelve exactamente **2 grupos**: `"Gemini Models"` (buckets `gemini-weekly` + `gemini-5h`) y `"Claude and GPT models"` (buckets `3p-weekly` + `3p-5h`). La descripción del grupo Gemini dice "Models within this group: Gemini Flash, Gemini Pro" — toda la familia Gemini comparte un único límite semanal y uno de 5 horas. El filtro de perfil de `internal/quota/quota.go` (prefijo `g*` → grupo Gemini, `son*` → grupo Claude/GPT) es therefore correcto y completo para los dos perfiles que usa CPAMC. `CONFIRMED`.
2. **El enrutamiento de CLIProxyAPI es por catálogo de modelos + selección round-robin (por defecto), con la convención `prefijo/modelo` como mecanismo real de selección de cuenta.** Cada auth-file con `prefix` registra sus modelos en el registro global **tanto sin prefijo como bajo `prefijo/modelo`** (`sdk/cliproxy/service_models.go:623-663`). Una petición de `gemini-3.8-pro` (sin prefijo) rota entre **todas** las credenciales que soporten ese modelo; una petición de `agy_/gemini-3.8-flash-high` va **solo** a la cuenta con prefix `agy_` (confirmado en vivo: las cuentas actuales tienen prefijos `agy_` y `agy__1`, y el catálogo `/v1/models` expone rutas `agy_/gemini-3.7-flash-high`, `agy__1/gemini-3.8-flash-high`, etc.). El prefijo se elimina antes de la llamada upstream (`rewriteModelForAuth`, `sdk/cliproxy/auth/conductor_models.go:700-711`). Con `force-model-prefix: false` (valor actual del deployment) las peticiones sin prefijo también pueden usar cuentas prefijadas. `CONFIRMED`.

Implicación directa para el plugin/switcher de CPAMC: el "agrupar" por prefijos solo aísla cuotas si las peticiones entrantes usan la forma `prefijo/modelo`; si un cliente pide el modelo base sin prefijo, CLIProxyAPI puede despachar a cualquier cuenta (incluidas las reservas del pool), mientras el switcher siga rotando por umbrales de cuota por grupo familiar.

## Research Question

1. ¿Qué valores `displayName` devuelve `retrieveUserQuotaSummary` de Antigravity en su array `groups` — ¿aparecen Gemini 3.7 vs 3.8 (o variantes flash/pro) como grupos distintos? Capturar un payload real vía la Management API local si es posible.
2. ¿Cómo enruta CLIProxyAPI una petición entrante de un modelo (p. ej. `gemini-3.8-pro`) a una cuenta/auth-file/prefijo específico — filtrado modelo→auth-file, enrutamiento por configuración, o round-robin?

## Recommendation or Answer

### Parte 1 — Grupos de cuota: CONFIRMADO con payload real

**Fuente en vivo (2026-10-03T23:44Z, ambas cuentas antigravity activas, `project: "aicode-consumers"`, HTTP 200):**

```json
{
  "groups": [
    {
      "buckets": [
        { "bucketId": "gemini-weekly", "displayName": "Weekly Limit Remaining", "window": "weekly", "remainingFraction": 0.78577775 },
        { "bucketId": "gemini-5h", "displayName": "Five Hour Limit Remaining", "window": "5h", "remainingFraction": 1 }
      ],
      "displayName": "Gemini Models",
      "description": "Models within this group: Gemini Flash, Gemini Pro"
    },
    {
      "buckets": [
        { "bucketId": "3p-weekly", "displayName": "Weekly Limit Remaining", "window": "weekly", "remainingFraction": 1 },
        { "bucketId": "3p-5h", "displayName": "Five Hour Limit Remaining", "window": "5h", "remainingFraction": 1 }
      ],
      "displayName": "Claude and GPT models",
      "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS"
    }
  ],
  "description": "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. ..."
}
```

Hallazgos:

- **Solo 2 grupos**, a nivel de familia de modelos: `Gemini Models` y `Claude and GPT models`. **No hay grupo por versión de modelo** (3.7, 3.8, flash, pro comparten buckets). El propio texto del grupo lo declara: "Within each group, models share a weekly limit and a 5-hour limit" [S-001].
- La estructura coincide exactamente con lo que parsea `internal/quota/quota.go:14-21` (`Group.DisplayName`, `Group.Buckets`, `Bucket.RemainingFraction`) [S-004].
- El filtro por perfil de `ParseQuotaSummary` (`quota.go:66-79`: perfil `g*` → grupo que contenga "gemini"; perfil `son*` → grupo que contenga "claude"/"gpt") cubre correctamente ambos grupos reales. Nota: el grupo Claude/GPT se llama "Claude and GPT models" y contiene GPT-OSS además de Claude — coherente con el filtro.
- Dato adicional: cuando se agota el límite semanal, el bucket 5h llega con `"disabled": true` y `remainingFraction: 1` (cuenta 1, payload de `maribelluzbonitaaquinocastro@`). `ClassifyWindow` (`quota.go:51-62`) igualmente lo clasificaría como ventana 5h con 100 % restante — es decir, **el switcher podría ver una reserva "sana" en 5h aunque el semanal esté a 0 y deshabilitado**. El worst-case de la Policy 2A mitiga esto solo si el bucket semanal se evalúa; el bucket semanal deshabilitado NO lleva flag visible aparte de `disabled` (que `quota.go` no parsea hoy).
- Cómo se obtuvo (todo read-only): key en `~/.cliproxy_management_key`, endpoint `http://127.0.0.1:8317`, `POST /v0/management/api-call` con `{"authIndex","method":"POST","url":".../v1internal:retrieveUserQuotaSummary","data":"{\"project\":\"aicode-consumers\"}"}` — mismo formato que `internal/client/client.go:196-239 (GetQuotaSummary)` [S-003].

### Parte 2 — Enrutamiento de CLIProxyAPI v8.0.13: CONFIRMADO por código fuente (commit d7914af) y verificación en vivo

Flujo completo de una petición entrante (p. ej. `POST /v1/chat/completions` con `model`):

1. **Resolución de proveedor(es) por modelo**: `util.GetProviderName(model)` consulta el registro global de modelos (`registry.GetGlobalRegistry().GetModelProviders(modelID)`, `internal/util/provider.go:62-69`, `internal/registry/model_registry.go:1581`). No hay heurística si el modelo está registrado; el registro es la fuente de verdad.
2. **Catálogo por credencial**: al cargar los auth-files, cada credencial registra sus modelos con **doble entrada**: el ID base (`gemini-3.8-flash-high`) y el ID con prefijo (`agy_/gemini-3.8-flash-high`), mediante `applyModelPrefixes` (`sdk/cliproxy/service_models.go:623-663`, llamado en `service_models.go:231-299`). Si `force-model-prefix` está activo, la entrada sin prefijo se suprime (`service_models.go:655-657`) [S-005].
3. **Filtrado de candidatos**: `authSupportsRouteModel` (`sdk/cliproxy/auth/conductor_selection.go:996-1009`) descarta credenciales que no registraron el modelo pedido vía `ModelRegistry.ClientSupportsModel` (`model_registry.go:1187-1206`). Este filtrado es el único vínculo modelo→auth-file: **no hay configuración de enrutamiento estático modelo→cuenta**; el mapeo emerge del catálogo registrado por cada credencial.
4. **Selección entre candidatos**: selector configurable en `routing.strategy` — `"round-robin"` (default), `"weighted-round-robin"` o `"fill-first"` (`internal/config/config_types.go:352-355`); más `session-affinity` opcional (`config_types.go:357-375`). El `RoundRobinSelector` rota por clave `provider:model` reanudando desde el último ID elegido sobre candidatos ordenados por ID (`sdk/cliproxy/auth/selector.go:614-655`) [S-006]. Solo se elige dentro del **tier de prioridad más alto disponible** (`authPriority` desde atributo `priority`, `selector.go:364-377`; buckets en `selector.go:471-560`).
5. **Cooldowns por modelo**: credenciales en cooldown por 429/quota de un modelo se excluyen (`isAuthBlockedForModel`, `collectAvailableByPriority` en `selector.go:471-493`); si todas están en cooldown se devuelve `modelCooldownError` con el `resetIn` más próximo (`selector.go:527-542`). El deployment local tiene cooldown activo (`routing.cooldown.disable-cooling: false` en `~/services/cliproxy/config.yaml`) y `request-retry: 0` [S-007].
6. **Eliminación del prefijo upstream**: antes de ejecutar, `rewriteModelForAuth` quita `auth.Prefix + "/"` del modelo si la petición lo traía (`sdk/cliproxy/auth/conductor_models.go:700-711`), y luego se aplican alias por credencial (`applyOAuthModelAlias`, `applyAPIKeyModelAlias`, `conductor_models.go:171-189`).
7. **Despacho multi-proveedor**: si el modelo es servido por varios proveedores, `pickNextMixed` itera proveedores y aplica el mismo esquema de selección (`conductor_selection.go:2154`).

**Verificación en vivo contra el deployment local** [S-002][S-008]:

- Auth-files actuales y sus prefijos (leídos read-only vía `/v0/management/auth-files/download`): `maribelluzbonitaaquinocastro@gmail.com` → `prefix: "agy_"`; `wilsonlavio7@gmail.com` → `prefix: "agy__1"`.
- El catálogo público `GET /v1/models` (289 modelos) expone tanto rutas base (`gemini-3.8-flash-high`) como prefijadas (`agy_/gemini-3.7-flash-high`, `agy__1/gemini-3.8-flash-high`, …), confirmando el doble registro del punto 2.
- `GET /v0/management/force-model-prefix` → `{"force-model-prefix": false}`: las peticiones sin prefijo **pueden** usar cuentas prefijadas (round-robin entre ambas), y las rutas `prefijo/modelo` conviven con las base.

**Respuesta a la pregunta**: es **catálogo + round-robin**, no configuración estática ni prefijos-obligatorios. El modelo `gemini-3.8-flash-high` (que es como el catálogo remoto llama a la variante 3.8; no existe un `gemini-3.8-pro` en el catálogo antigravity — ver Unknowns) rotea entre todas las cuentas antigravity activas que lo soporten; `agy_/gemini-3.8-flash-high` fija la cuenta. Los prefijos que usa todo el ecosistema CPAMC son exactamente el mecanismo `prefix/model` nativo de CLIProxyAPI [S-005][S-006].

## Key Findings

- **F1 — CONFIRMADO (payload real, HIGH)**: `groups` tiene exactamente 2 entradas: `Gemini Models` y `Claude and GPT models`. Sin distinción por versión (3.7/3.8) ni variante (flash/pro). Evidencia: payload capturado 2026-10-03 para 2 cuentas [S-001].
- **F2 — CONFIRMADO (HIGH)**: `bucketId`s estables: `gemini-weekly`, `gemini-5h`, `3p-weekly`, `3p-5h`; `displayName` de buckets: `Weekly Limit Remaining` / `Five Hour Limit Remaining`. Coincide con el parseo de `quota.go` [S-001][S-004].
- **F3 — CONFIRMADO (HIGH)**: el límite es compartido por familia dentro del grupo ("models share a weekly limit and a 5-hour limit"), consumido proporcionalmente al coste de tokens [S-001].
- **F4 — CONFIRMADO (HIGH)**: enrutamiento = registro modelo→credencial + selector. Sin enrutamiento estático por config; `routing.strategy` default `round-robin` [S-005][S-006][S-007].
- **F5 — CONFIRMADO (HIGH)**: `prefix/modelo` selecciona la cuenta con ese prefix; el prefijo se elimina antes de la llamada upstream (`conductor_models.go:700-711`) [S-005].
- **F6 — CONFIRMADO en vivo (MEDIUM-HIGH)**: deployment actual con `force-model-prefix: false`, prefijos `agy_` y `agy__1`, doble registro base+prefijado en `/v1/models` [S-002][S-008]. Implicación: hoy una petición sin prefijo puede aterrizar en la reserva del pool; el aislamiento por pool solo es efectivo si los clientes piden `prefijo/modelo`.
- **F7 — CONFIRMADO (HIGH)**: cooldowns por modelo/prioridad y tiers `priority` por credencial modulan la selección; deshabilitadas y en cooldown se excluyen antes del selector [S-006].
- **F8 — NUEVO RIESGO (MEDIUM)**: bucket 5h con `disabled: true` + `remainingFraction: 1` cuando el semanal está agotado; `quota.go` no parsea `disabled` ni `bucketId`, solo `displayName/window/remainingFraction`. `ClassifyWindow` daría "5h al 100 %" — señal engañosa si se evalúa el bucket 5h aislado. El worst-case (Policy 2A) sobre ambos buckets lo compensa porque el semanal reporta 0 [S-001][S-004].

## Evidence Review

| # | Claim | Fuentes | Confianza | Limitaciones |
|---|---|---|---|---|
| C1 | `groups` = 2 familias, sin splits por versión/variante | [S-001] | HIGH | 1 endpoint (daily-cloudcode-pa) y 2 cuentas free/team del mismo proyecto; no se descarta que planes pagos añadan grupos, pero la estructura de 2 familias es la documentada en la propia respuesta |
| C2 | El parseo de `quota.go` cubre el payload real | [S-001][S-004] | HIGH | Comparación campo a campo; `disabled` y `bucketId` no parseados (F8) |
| C3 | Doble registro base+`prefix/` de modelos por credencial | [S-005] (service_models.go:623-663) | HIGH | Código de la release exacta en ejecución (v8.0.13, commit d7914af) |
| C4 | Selección round-robin default con filtrado por registro y cooldowns | [S-005][S-006][S-007] | HIGH | No se trazó en runtime la petición HTTP completa (read-only: no se enviaron peticiones de chat); la cadena de llamadas está verificada estáticamente |
| C5 | `force-model-prefix: false` y prefijos `agy_`/`agy__1` en vivo | [S-002][S-008] | HIGH | Estado al 2026-10-03T23:5xZ; puede cambiar con una rotación del switcher |
| C6 | Catálogo antigravity remoto: 14 modelos, sin `gemini-3.8-pro` | [S-009] | MEDIUM | Catálogo remoto `router-for-me/models` actualizado cada 3 h; los nombres de modelo de terceros (Antigravity) pueden cambiar sin aviso |

## Trade-offs and Risks

- **Aislamiento de pools depende del cliente, no del servidor**: con `force-model-prefix: false`, un cliente que pida el modelo base rotea entre líder y reservas; el "grupo" de CPAMC solo aísla cuota si las peticiones van dirigidas como `agy_/modelo` (o si se activa `force-model-prefix: true`, que además impide el uso del modelo base). Riesgo documentado, no defecto.
- **Worst-case por familia es la única granularidad disponible**: dado F1, cualquier lógica que pretenda conmutar por "cuenta agotada en Gemini 3.8 pero no en 3.7" es imposible a nivel de cuota; las dos versiones consumen el mismo bucket.
- **`disabled: true` en bucket 5h** (F8) puede inducir decisiones de rotación basadas en datos parcialmente engañosos si algún código futuro evalúa buckets individualmente.
- El catálogo de modelos antigravity se refresca cada 3 h desde un repo externo (`router-for-me/models`): los IDs disponibles pueden cambiar sin control local.

## Alternatives Considered

- Capturar el payload instalando un proxy/MITM entre CLIProxyAPI y Google: descartado; el proxy `api-call` de la propia Management API da el mismo dato sin tocar nada.
- Ejecutar una petición real de chat para observar la selección en runtime: descartada por la restricción read-only (habría consumido cuota y mutado estado de sesión/cooldown); la cadena de selección se verificó por código de la release exacta en ejecución.
- Analizar el binario Docker: innecesario; la imagen corresponde al código público de `router-for-me/CLIProxyAPI` en el commit reportado por el propio binario (`docker logs`: `Version: v8.0.13, Commit: d7914af`) [S-007].

## Unknowns and Limits

- **Varia el payload por plan/tier?** Las 2 cuentas probadas son del mismo proyecto (`aicode-consumers`). No se puede descartar que un plan pagado devuelva grupos extra, pero la descripción embebida del propio payload generaliza la estructura de 2 familias. No hay cuenta de pago disponible para contrastar (requeriría acción de Wilox).
- **`gemini-3.8-pro` no existe en el catálogo antigravity actual**: el catálogo remoto lista `gemini-3.8-flash-high` (y `gemini-3.7-flash-high`, `gemini-pro-agent`, etc.), y el ejemplo del prompt (`gemini-3.8-pro`) no está registrado. Si algún cliente lo pide, la respuesta sería "modelo no registrado" — el ejemplo era hipotético, no afecta las conclusiones de enrutamiento.
- No se verificó en runtime qué credencial concreta sirve una petición (requeriría tráfico real); la cadena `GetProviderName → authSupportsRouteModel → selector.Pick` está confirmada por código de la misma versión/commit en ejecución.
- Los `authIndex`/prefijos observados son el estado actual; el switcher de CPAMC puede haberlos cambiado después de la captura.
- Uso mínimo de scratch en `/tmp` (clon del código fuente y payloads temporales) para el análisis; **todo fue eliminado** tras la investigación. No se escribió ni modificó nada fuera del directorio de investigación.

## Recommended Next Actions

1. **Parsear `bucketId` y `disabled` en `internal/quota/quota.go`** (F8): clasificar por `bucketId` (`gemini-weekly`/`gemini-5h`/`3p-weekly`/`3p-5h`) es más robusto que por `displayName`, y tratar un bucket `disabled: true` como "no evaluable" en lugar de "100 % restante".
2. **Documentar/decidir la semántica de aislamiento**: si CPAMC quiere que cada pool aísle su cuota, los clientes deben pedir `prefijo/modelo`, o activar `force-model-prefix: true` (aceptando que el modelo base deja de existir en el catálogo).
3. **No construir lógica sobre "cuota por versión de modelo"** (F1/F3): la granularidad real es familia (Gemini vs Claude/GPT) × ventana (5h/weekly).
4. Si se necesita confirmar el comportamiento con un plan pagado, Wilox puede capturar el payload de esa cuenta manualmente con el mismo comando `api-call` documentado en `client.go:196-239`.
