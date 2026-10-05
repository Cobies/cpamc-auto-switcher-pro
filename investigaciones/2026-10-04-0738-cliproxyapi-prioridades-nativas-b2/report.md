# Escenario B2 — Enrutamiento nativo por `priority` + `cooldown` sin prefijos

> Investigación de solo lectura sobre `/home/wilox/projects/cpamc-auto-switcher` y
> `/home/wilox/services/cliproxy`, contrastada con el código upstream de CLIProxyAPI
> `v8.0.13` (commit `d7914af`) y con el estado vivo del servicio en `127.0.0.1:8317`.

## Resumen Ejecutivo

**Veredicto: PARTIALLY VIABLE (parcialmente viable).**

CLIProxyAPI **sí** soporta enrutamiento nativo entre múltiples auth files de la misma
familia para peticiones a modelos **canónicos sin prefijo**, combinando `priority` (tiers
de preferencia por credencial) y `cooldown` (bloqueo por credencial/modelo). Está
implementado en `sdk/cliproxy/auth/` (`priority.go`, `selector.go`,
`conductor_selection.go`, `conductor_cooldown.go`) [S-001] y **funciona hoy** en el servicio local:
`claude-sonnet-4-6`, `gemini-3.8-flash-high`, etc. ya se sirven sin prefijo desde las 8
credenciales de Antigravity, y existe una prueba viva de cooldown nativo respetado
(~5.85 h, `scope=model`, `reason=quota`, `http_status=429`) [S-010][S-011].

Sin embargo, B2 **no es un reemplazo limpio 1:1** del modelo de prefijos del switcher:

1. El cooldown nativo de Antigravity es **por modelo, no por familia**, mientras que las
   ventanas 5h/weekly de Antigravity son **compartidas por familia** (grupo Gemini; grupo
   Claude+GPT). Esto genera 429 "de calentamiento" por cada modelo hermano hasta que cada
   uno se enfría por separado [S-009][S-005][S-010].
2. El cooldown es **reactivo** (post-429). La rotación proactiva 90 %/95 % solo se
   conserva si el switcher sigue existiendo — y entonces cambia su actuador de `prefix` a
   `priority`.
3. La persistencia de cooldowns está **apagada por defecto**
   (`routing.cooldown.save-cooldown-status=false`, Home deshabilitado): un reinicio del
   contenedor borra todos los cooldowns y el líder agotado vuelve a ser elegible [S-012].
4. Al eliminar el prefijo se pierde la **etiqueta de perfil/familia** que hoy codifica el
   switcher (`agy` vs `agy_clau`), por lo que se necesita un campo de metadatos nuevo
   (`note`/campo custom) para reconstruir perfiles [S-007][S-013].

La ruta de migración es acotada y reutiliza gran parte de `internal/switcher`, pero exige
prerequisitos de configuración y aceptar los 429 de calentamiento. Se recomienda B2 como
**base de enrutamiento** y conservar el switcher como **controlador proactivo de
`priority`**, o bien evaluar la alternativa con plugin `scheduler` (ver Alternativas).

---

## Pregunta de Investigación

¿Es viable (VIABLE / PARCIALMENTE VIABLE / NO VIABLE) el **Escenario B2**: que CLIProxyAPI
enrute modelos canónicos **sin prefijo** entre múltiples auth files de la misma familia
usando semántica nativa de `priority` + `cooldown`, de forma que la lista `/model` quede
limpia y el switcher deje de reescribir prefijos? Y en concreto:

- (a) ¿CLIProxyAPI soporta tiers nativos de `priority` + `cooldown` para peticiones sin
  prefijo entre auth files de la misma familia, y **dónde** en el código?
- (b) ¿Qué se rompe con las ventanas 5h/semanal de Antigravity frente a los cooldowns nativos?
- (c) ¿El plugin instalado **`Auto switcher pro`** (visual-profile v0.1.0) es efectivo para
  enrutar o es solo UI/gestión?
- (d) ¿Qué cambios requiere B2 en `internal/switcher`, `internal/client`, `internal/quota`
  y el plugin, con esfuerzo/riesgo?
- (e) ¿Ruta de migración recomendada y veredicto claro?

---

## Recomendación o Respuesta

**Adoptar B2 como mecanismo de enrutamiento de base, con tres prerequisitos y un cambio de
actuador.** Concretamente:

1. **Activar persistencia de cooldown** en CLIProxyAPI:
   `routing.cooldown.save-cooldown-status: true` y considerar `routing.strategy: fill-first`
   para que el tier superior sea determinista [S-012][S-021][S-024].
2. **Conservar la aislación por familia** que ya existe vía `excluded_models` en cada auth
   file (los archivos Gemini excluyen los modelos Claude; los clones `agy_clau*` excluyen
   todo lo que no sea Claude) [S-018][S-010].
3. **Introducir un tag de familia/perfil** en metadatos de la credencial (`note` o campo
   custom) y una **escala de `priority`** (líder alto, reservas bajo) [S-007][S-013].
4. **Cambiar el actuador del switcher de `prefix` a `priority`**: la lógica de umbrales
   90 %/95 %, ranking de reservas y selección de mejor reserva se reutiliza; lo que cambia
   es que la promoción/democión ahora escribe `priority` en vez de `prefix` [S-013][S-007].
5. **Eliminar (vaciar) el campo `prefix`** de las credenciales de Antigravity para que
   `/model` deje de listar los clones `prefijo/modelo`. Con `force-model-prefix=false` y
   prefijo vacío, CLIProxyAPI registra **solo** el ID base [S-008].

Riesgo residual aceptado: 429 de calentamiento por modelo hermano y comportamiento de la
ventana semanal no verificado (ver Incógnitas).

---

## Hallazgos Clave

### (a) SÍ: `priority` + `cooldown` nativos para modelos sin prefijo — y dónde

**Tiers de prioridad (por credencial, no por modelo).**
- El campo `priority` del auth file se copia a `auth.Metadata["priority"]` y
  `auth.Attributes["priority"]` (`ApplyAuthPriorityMetadata`,
  `sdk/cliproxy/auth/priority.go`) [S-002]. Lo aplican el file store y el watcher
  (`sdk/auth/filestore.go`, `internal/watcher/synthesizer/file.go`) [S-002].
- `authPriority(auth)` lee ese atributo (entero; por defecto `0`) [S-003].
- La selección agrupa candidatos **disponibles** por prioridad y devuelve **solo el tier
  más alto disponible** (`availableAuthsForRouteModelWithPriorityMode` →
  `availableAuthsFromPriorityBuckets(..., allPriorities=false)`); los tiers inferiores se
  usan **solo cuando todos los superiores están bloqueados** [S-003][S-004]. Empate en el
  tier: se ordena por `ID` y decide el selector configurado (`round-robin` por defecto;
  `weighted-round-robin`, `fill-first`) [S-003][S-021].

**Bloqueo por cooldown (por credencial o por modelo).**
- `isAuthBlockedForModel(auth, model, now)` bloquea si la credencial está deshabilitada,
  sin token, con `auth.Quota.Reason=credential_quota`, o si `auth.ModelStates[model]` está
  en cooldown. **Si el modelo pedido no está en `ModelStates`, no se considera bloqueado**
  (esto es lo que hace el bloqueo efectivamente *por modelo*) [S-003][S-022].
- En un 429, `applyAuthFailureState` fija el cooldown a `RetryAfter` (mínimo
  `minQuotaCooldownFloor=10s`) o, en su ausencia, a un backoff exponencial
  `1s·2^n` con techo `quotaBackoffMax=30min` [S-005].
- Si el error es *credential-scoped* (`isCredentialScopedError`), propaga el cooldown a
  todos los `ModelStates` hermanos y marca la credencial como `credential_quota`
  [S-005]. Claude y Codex sí marcan errores como credential-scoped; **Antigravity no**
  (ver (b)) [S-005][S-009].

**Modelos sin prefijo ya registrados.**
- `applyModelPrefixes` (`sdk/cliproxy/service_models.go`) registra, cuando hay prefijo y
  `force-model-prefix=false`, **tanto el ID base sin prefijo como el clon
  `prefijo/modelo`** [S-008]. Por eso hoy coexisten los 6 IDs planos de Antigravity junto a
  los 212 clones. Con prefijo vacío, solo se registra el ID base.
- El filtrado por `excluded_models` se aplica a los modelos base **antes** de clonar, por lo
  que la exclusión por familia funciona igual para IDs base y con prefijo [S-008][S-018].
- `ClientSupportsModel(auth.ID, model)` decide qué credenciales sirven cada modelo; una
  petición sin prefijo `claude-sonnet-4-6` empareja con todas las credenciales cuyo catálogo
  (post-exclusiones) incluya ese modelo [S-004][S-008].

**Conclusión (a): PRIMARY/IMPLEMENTATION + prueba viva.** La combinación pedida existe y es
el comportamiento por defecto salvo por `save-cooldown-status` y `strategy`.

### (b) Ventanas 5h/semanal de Antigravity vs cooldown nativo

- **El cooldown nativo de Antigravity es por modelo.** El executor devuelve un `statusErr`
  sin `credentialScoped` [S-009]; `decideAntigravity429` clasifica `FullQuotaExhausted`
  cuando `RESOURCE_EXHAUSTED`/`RATE_LIMIT_EXCEEDED` con `retryAfter >= 5min`, pero el error
  sigue siendo no-credential-scoped, por lo que el cooldown se asienta en `ModelStates[model]`
  [S-009][S-005][S-022].
- **Prueba viva:** `antigravity-infosoytec@gmail.com.json` (prefijo `agy`) tiene
  `cooldowns=[{scope:"model", model_key:"gemini-3.8-flash-high", reason:"quota",
  remaining_seconds≈21071 (~5.85 h), http_status:429}]` con `unavailable=false`. Esto
  demuestra (1) que Antigravity **sí** envía un reset hint compatible con la ventana 5h y
  (2) que CLIProxyAPI lo honra, pero **solo para ese modelo** [S-010].
- **Desajuste estructural:** la cuota de Antigravity es **por grupo/familia** (grupo
  "Gemini" para todas las variantes Gemini; grupo "Claude y GPT" para Claude/GPT), pero el
  cooldown nativo bloquea un único `model_key`. Consecuencia en B2: cuando el líder agota su
  ventana Gemini, cada **otro** modelo Gemini del mismo líder sigue "disponible" y produce
  su propio 429 antes de enfriarse. Mitigación: dentro de la misma petición,
  `executeMixedOnce` marca el fallo y **reintenta con otra credencial** (con
  `max-retry-credentials=0` intenta todas las disponibles), por lo que el usuario suele
  recibir respuesta igualmente, a costa de 429 extra y algo de latencia [S-006][S-012].
- **Ventana semanal: INCÓGNITA.** No se verificó si el 429 de agotamiento *semanal* trae un
  hint a escala semanal (días). Si no lo trae, el cooldown cae al backoff exponencial
  (≤30 min) muy inferior a la ventana semanal, provocando reintentos repetidos contra la
  cuenta agotada [S-005][S-009].
- **Rotación proactiva:** nativa no existe; el cooldown solo actúa tras el 429. La ventaja
  del switcher (rotar al 90 %/95 %) se pierde salvo que B2 mantenga el switcher como
  controlador de `priority` [S-013].
- **Persistencia:** `save-cooldown-status=false` y Home deshabilitado ⇒ los cooldowns viven
  en memoria y se pierden al reiniciar. `FileCooldownStateStore` existe para persistirlos
  junto a los auth files, pero hay que habilitarlo [S-012][S-024].

### (c) Plugin `Auto switcher pro` (visual-profile v0.1.0): solo gestión/UI

- Registra **únicamente** la capacidad `management_api: true`; no declara `scheduler` ni
  `auth_provider` [S-017].
- Sirve UI estática (`/profiles`, `/create-prefixes`, `/create-groups`,
  `/control-switcher`, `/pulse-tokens`) y **una** ruta de escritura:
  `POST /v0/management/visual-profile/virtualize` [S-017].
- `virtualize` clona un auth file físico vía `host.auth.get/save` y escribe `prefix` +
  `excluded_models` en el clon [S-018]. **No participa en la selección de credenciales ni
  escribe `priority`.**
- **Veredicto (c): NO efectivo para enrutar; es una herramienta de autoría/gestión.** Sirve
  para mantener `excluded_models` por familia y, si se extendiera, para escribir `priority`.
  La capacidad de enrutar existe en CLIProxyAPI (`scheduler` plugin), pero este plugin no la
  usa [S-017][S-023].

### (d) Cambios requeridos por componente

| Componente | Cambio B2 | Esfuerzo | Riesgo |
|---|---|---|---|
| `internal/client` | Añadir PATCH genérico de campos (`priority`, `note`, campo de familia) reutilizando `/v0/management/auth-files/fields`; exponer `priority` y `excluded_models` en `AuthFileMetadata` (hoy solo `Prefix`/`ChatGPTAccountID`) [S-007][S-014] | Bajo | Bajo |
| `internal/config` | Reemplazar/añadir convención de `priority` (p. ej. `active_priority`/`reserve_priority`) y campo de tag de perfil; mantener umbrales/cooldown [S-016] | Bajo–Medio | Bajo |
| `internal/switcher` | Sustituir `ParsePrefix` (perfil+rol desde prefijo) por detección **rol=priority** + **familia=tag de metadatos**; cambiar el "swap de 2 pasos" de `prefix` a `priority`; conservar `ShouldRotate`, ranking de reservas y `RunProvider` [S-013][S-016] | Medio | Medio–Alto |
| `internal/quota` | Prácticamente sin cambios (sigue leyendo 5h/semanal). Opcional: leer `cooldowns` del listado de auth-files como señal extra [S-015][S-010] | Bajo | Bajo |
| Plugin visual-profile | Añadir escritura de `priority` (y opción de vaciar prefijo) en `virtualize`/nueva ruta; hoy solo escribe `prefix`+`excluded_models` [S-017][S-018] | Medio | Medio |
| Config CLIProxyAPI | `routing.cooldown.save-cooldown-status: true`; evaluar `routing.strategy: fill-first`; verificar `force-model-prefix: false` y `disable-cooling: false` [S-012][S-021][S-025] | Bajo | Bajo |

El grueso del trabajo está en `internal/switcher` (actuador y detección de perfil). El resto
son cambios acotados. Estimación cualitativa: **~3–6 días de desarrollo enfocado + tests**,
con riesgo **Medio–Alto** concentrado en la semántica de cooldown por modelo/familia.

### (e) Ruta de migración recomendada

1. **Config CLIProxyAPI (staging primero):** `routing.cooldown.save-cooldown-status: true`;
   `routing.strategy: fill-first` (tier superior determinista); confirmar
   `force-model-prefix: false`, `disable-cooling: false` [S-012][S-021][S-025].
2. **Aislación por familia:** verificar que cada auth file Gemini excluye Claude y cada
   clon Claude excluye Gemini (ya vigente) [S-018][S-010].
3. **Metadatos:** añadir tag de familia/perfil (vía `note` o campo custom) y esquema de
   `priority` (líder=alto, reservas=bajo).
4. **Vaciar `prefix`** de las credenciales de Antigravity en una instancia de prueba;
   confirmar `/model` limpio (sin clones `prefijo/modelo`) y que los IDs canónicos planos
   siguen apareciendo [S-008][S-011].
5. **Validación de failover:** forzar 429 en el líder por modelo y observar failover
   intra-petición y propagación del cooldown antes de tocar producción [S-006][S-010].
6. **Cambiar el switcher** a `priority`; mantener la rotación proactiva por umbrales.
7. **Rollback:** re-aplicar prefijos y revertir binario/config.

---

## Revisión de Evidencia

| Afirmación | Fuentes | Confianza | Límites |
|---|---|---|---|
| Tiers nativos de `priority` con preferencia al más alto y fallback a tiers inferiores | [S-002][S-003][S-004] | HIGH | Código upstream v8.0.13; no probado en vivo con tiers |
| Cooldown nativo por credencial/modelo con `RetryAfter` o backoff exponencial | [S-005][S-009] | HIGH | `RetryAfter` depende del upstream |
| Ambos IDs (base sin prefijo y clon con prefijo) se registran si hay prefijo y `force-model-prefix=false` | [S-008] | HIGH | — |
| Modelos canónicos planos ya servidos sin prefijo hoy | [S-011] | HIGH | 6 IDs Antigravity planos observados |
| Cooldown nativo Antigravity honrado ~5.85 h, `scope=model` | [S-010] | HIGH | Observación única, un modelo |
| Cooldown Antigravity **no** es credential-scoped (bloqueo por modelo, no por familia) | [S-005][S-009][S-022] | MEDIUM-HIGH | Inferido de código; no se forzó 429 cross-modelo en vivo |
| Rotación proactiva no existe de forma nativa | [S-003][S-005][S-013] | HIGH | — |
| Cooldowns no persisten por defecto | [S-012][S-024] | HIGH | `save-cooldown-status=false`, Home off |
| Plugin visual-profile solo `management_api`, no enruta | [S-017][S-018] | HIGH | — |

---

## Trade-offs y Riesgos

- **A favor de B2:** `/model` limpio (solo IDs canónicos), sin reescrituras de prefijo,
  menor acoplamiento entre UI de modelos y plumbing de enrutamiento, uso de mecanismos
  nativos mantenidos por upstream.
- **En contra / riesgos:**
  - 429 de calentamiento por cada modelo hermano de la familia agotada (cooldown por modelo).
  - Ventana semanal posiblemente sub-cubierta por el hint de reset (INCÓGNITA).
  - Pérdida de cooldown ante reinicio si no se habilita la persistencia.
  - Necesidad de un nuevo canal de metadatos para el tag de familia (hoy codificado en el
    prefijo).
  - Riesgo de regresión en `internal/switcher` al cambiar el actuador (rotación mal
    aplicada podría dejar el líder equivocado o dos líderes por familia).

---

## Alternativas Consideradas

1. **B2 + plugin `scheduler` (híbrido recomendado si se busca `/model` limpio sin depender
   del switcher externo).** CLIProxyAPI expone una capacidad `scheduler` con
   `MethodSchedulerPick`; los candidatos incluyen `Priority`, `Attributes` y `Metadata`
   [S-023]. Un plugin `scheduler`+`management_api` podría implementar la lógica proactiva
   por umbrales server-side y elegir credencial por familia. Mayor esfuerzo, pero elimina el
   proceso externo y los 429 de calentamiento.
2. **Mantener el modelo de prefijos actual (statu quo).** Funciona y es proactivo, pero deja
   el problema de `/model` y el acoplamiento que motiva B2 [S-019][S-020].
3. **Decoración client-side en la extensión de Pi.** Ya recomendada en investigaciones
   previas para el indicador de líder (👑/⭐) sobre pools; complementa B2, no lo sustituye
   [S-020].
4. **`force-model-prefix: true`.** Registraría solo IDs con prefijo: empeora `/model`,
   descartado [S-008].

---

## Incógnitas y Límites

- **Comportamiento del reset hint en agotamiento semanal** (¿días o vuelta a backoff de
  ≤30 min?). No verificado en vivo; requiere forzar/reproducir agotamiento semanal.
- **Cooldown cross-modelo dentro de familia**: no se forzó un 429 en un modelo Gemini
  distinto sobre el mismo líder para confirmar que los hermanos **no** se bloquean. La
  conclusión se infiere de `isAuthBlockedForModel` + `credentialScoped=false` [S-003][S-009].
- **Selectores**: no se probó `fill-first` en vivo con tiers de `priority`; el efecto
  determinista está basado en código [S-003][S-021].
- **Home/KV**: no se verificó si `Home` está habilitado (no aparece en config), pero
  `save-cooldown-status=false` indica cooldowns en memoria [S-012][S-024].
- **Restricción de alcance respetada:** solo lectura del proyecto, servicio y endpoints; no
  se modificó ningún archivo/config/servicio. La clave de management local se usó en memoria
  y **no** se incluye en este informe.

---

## Próximas Acciones Recomendadas

1. Habilitar `routing.cooldown.save-cooldown-status: true` (y evaluar `fill-first`) en un
   entorno de prueba CLIProxyAPI.
2. Reproducir en staging: vaciar prefijos, fijar `priority` por familia, forzar 429 por
   modelo y medir (a) failover intra-petición, (b) ausencia de bloqueo de hermanos, (c)
   `/model` limpio.
3. Verificar el reset hint de la **ventana semanal** con una cuenta agotada semanalmente.
4. Implementar el cambio de actuador del switcher (`prefix`→`priority`) detrás de un flag,
   con tests de rotación por perfil.
5. Extender el plugin visual-profile para escribir `priority` si se decide gestionar B2
   desde su UI.
6. Decidir entre **B2 puro** (reactivo + switcher proactivo por `priority`) o **híbrido con
   plugin `scheduler`** según cuánto importe evitar los 429 de calentamiento.
