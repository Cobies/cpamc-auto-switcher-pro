# Cómo jok3r-pi compone el catálogo de `/model` y por qué aparecen modelos que no existen en CPAMC

> Investigación de solo lectura. No se modificó ningún archivo de configuración, extensión o runtime.
> Datos vivos consultados en modo lectura contra CLIProxyAPI (`192.168.10.150:8317`) el 2026-10-04.

## Resumen ejecutivo

`/model` **no es** "la lista de modelos de CPAMC". Es la agregación de **todos los providers autenticados** que Pi conoce (built-in empaquetados en `pi-ai`, overlays de pi.dev, `models.json`, providers virtuales y providers registrados por extensiones). CPAMC es solo **uno** de esos providers, registrado por la extensión `cliproxyapi-dynamic-provider.ts` con el id `cpamc`.

La regla efectiva de visibilidad es una sola [S-002][S-006]:

```
/model  =  { m ∈ allModels : provider(m) ∈ configuredProviders }
```

Por lo tanto, **cualquier modelo que no exista en CPAMC pero sí aparezca en `/model` pertenece, por construcción, a otro provider**. Los dos casos observados y confirmados son los providers built-in `nvidia` y `opencode-go`, más el id **legacy** `cliproxyapi`.

Corrección importante a la hipótesis previa ("los fantasmas son 48 filas pegadas en `models-store.json`; hay que borrar ese archivo"): **borrar `models-store.json` NO elimina esos modelos de `/model`**. Las apps built-in traen su catálogo **estático empaquetado** (`nvidia.json` = 19 modelos, `opencode-go.json` = 29 modelos) y el overlay de pi.dev almacenado en `models-store.json` tenía exactamente el mismo número de entradas (19 y 29). El único mecanismo que oculta esos modelos es **desautenticar el provider** (o acotar el scope); el archivo `models-store.json` no es la causa raíz.

Clase secundaria, distinta y también real: modelos **etiquetados `[cpamc]`** que tampoco existen en vivo en CPAMC. El catálogo de `cpamc` se siembra desde `~/.pi/agent-j0k3r/cpamc-models-cache.json` y se refresca en red; si el refresco falla o se degrada el filtro de prefijos, esas entradas pegan modelos obsoletos o de más.

## Pregunta de investigación

1. ¿Qué cadena exacta ensambla el catálogo que muestra `/model` en jok3r-pi?
2. ¿Qué extensión / provider / fuente inyecta cada modelo, y cómo atribuir cada modelo inesperado a su origen?
3. ¿Por qué hay modelos en `/model` que no existen en CPAMC?
4. ¿Qué runbook de depuración permite detectarlo y qué arreglos son priorizables?

## Recomendación o respuesta

**Respuesta corta.** Los modelos "que no están en CPAMC" son de otros providers de Pi (`nvidia`, `opencode-go`, `cliproxyapi` legacy, `opencode`, `z-ai`, …). Se ven porque esos providers **están/estuvieron autenticados** en jok3r-pi y Pi agrega *todos* los providers autenticados en `/model`. No hay una extensión "oculta" inyectando modelos: **la única extensión que registra un provider es `cliproxyapi-dynamic-provider.ts`** (id `cpamc`).

**Prioridad de acciones (detalle en "Acciones siguientes"):**

1. **No** seguir podando `models-store.json` (no sirve, es cosmético y se vuelve a poblar). En su lugar: **`/logout` de los providers no-CPAMC** (`nvidia`, `opencode-go`, …) y verificar que no haya `*_API_KEY` de otros providers en el entorno del proceso Pi.
2. **Acotar el scope** para que `/model` solo muestre CPAMC: `enabledModels: ["cpamc/*"]` en `settings.json` + `/scoped-models`. (Limitación: el selector nativo sigue mostrando el resto si se abre en modo "all".)
3. Para una solución determinista de producto: que el reemplazo de `/model` (`j0k3r-model-picker`) filtre por allowlist de providers (solo `cpamc`). Esto es un cambio de código, fuera del alcance de esta investigación.
4. Higiene de CPAMC: TTL/validación de `cpamc-models-cache.json`, evitar el fallback amplio de prefijos, y tratar los duplicados `nan/nan/*`.

## Hallazgos clave

### 1. Cadena de composición de `/model` (de abajo hacia arriba)

| # | Etapa | Fuente | Efecto |
|---|---|---|---|
| 1 | Catálogo estático built-in | `pi-ai/dist/providers/data/*.json` (42 providers) [S-007] | Modelos base de cada provider empaquetado |
| 2 | Overlay remoto pi.dev | `remote-catalog-provider.js` → `~/.pi/agent-j0k3r/models-store.json` [S-016][S-009] | Añade/actualiza modelos sobre el estático (ventana de refresco 4 h) |
| 3 | `models.json` (custom providers) | Ruta Pi `models.json` [S-008] | **Ausente** en este entorno (verificado) |
| 4 | Provider registrado por extensión | `pi.registerProvider("cpamc", …)` [S-001] | Si `config.models` existe → **reemplaza** toda la lista; si solo hay `baseUrl` → remapea; si no → passthrough [S-003] |
| 5 | `extension.oauth.modifyModels` | composer [S-003] | Ninguna extensión lo usa aquí |
| 6 | `modelOverrides` (`models.json`) | composer [S-003] | Sin overrides aquí |
| 7 | Providers virtuales | `registerVirtualModel` [S-002] | Ninguna extensión los usa aquí |
| 8 | **Filtro de visibilidad** | `configuredProviders` [S-002][S-006] | Solo pasan modelos de providers **autenticados** |

El paso 8 es el que responde la pregunta del usuario. `/model` nativo usa `getAvailableSnapshot()` = `snapshot.available` [S-004]; el picker de j0k3r usa `getAvailable()` [S-013], que recomputa y devuelve lo mismo. En ambos casos el hint del UI es literalmente *"Only showing models from configured providers. Use /login to add providers."* [S-004].

### 2. Inventario de fuentes que pueden inyectar modelos

| Fuente | Provider(s) | Registra provider? | Escribe en `/model`? | Evidencia |
|---|---|---|---|---|
| `cliproxyapi-dynamic-provider.ts` (j0k3r) | `cpamc` | **Sí** (`registerProvider`, línea 438) | Sí (35 modelos filtrados) | [S-001] |
| Built-in `pi-ai` (`nvidia.json`) | `nvidia` | No (empaquetado) | Sí **si está autenticado** (19 modelos) | [S-007] |
| Built-in `pi-ai` (`opencode-go.json`) | `opencode-go` | No | Sí si autenticado (29 modelos) | [S-007] |
| Built-in `opencode.json` | `opencode` | No | Sí si autenticado (81 modelos) | [S-007] |
| Built-in `zai.json`/`zai-coding-cn.json` | `z-ai`, … | No | Sí si autenticado | [S-007] |
| Overlay pi.dev | por provider | No | Refuerza el estático | [S-016] |
| `models.json` | custom | — | **No presente** | [S-009] |
| `j0k3r-model-picker` | — | No | Reemplaza el render de `/model`; oculta el provider fantasma `cliproxyapi` | [S-013] |
| `cpamc-runtime-ui` | — | No | No toca `/model`; registra `/cpamc-model` aparte | [S-014] |
| `cpamc-auto-switcher` | — | No | No; solo reacciona a 429 | [S-019] |
| `pi-subagents-j0k3r`, `gentle-engram`, `pi-mcp-adapter`, `typesafe`, … | — | No | No | [S-019] |

**Conclusión:** el grep de `registerProvider`/`registerVirtualModel` sobre el árbol de extensiones de j0k3r solo encuentra `cliproxyapi-dynamic-provider.ts:438`. No hay inyecciones ocultas de modelos.

### 3. El provider `cliproxyapi` legacy (otro "fantasma", id distinto)

Hay sesiones de j0k3r con modelos `cliproxyapi/agy3/gemini-3.8-flash-high` (80), `cliproxyapi/agyB1/…` (9), `cliproxyapi/gemini-3.8-flash-high` (4) — es decir, existió una versión de la extensión que registraba el id **`cliproxyapi`** (histórico, ≤ 2026-09-28) [S-012]. Si quedara una credencial `cliproxyapi` en `auth.json`, esos modelos volverían a `/model`. Hoy `auth.json` de j0k3r = `{}` [S-009]. El picker de j0k3r sí filtra explícitamente el fantasma `cliproxyapi`; el selector nativo **no** [S-013][S-004].

### 4. Catálogo de CPAMC: caché vs. vivo

* Live `GET /v1/models?client_version=1` → **218** entradas, campo `slug` [S-010].
* Prefijos en vivo: `nv`=79, `nvidia`=33, `nan`=26, `google`=9, `meta`=6, `mistralai`=6, `agy_clau`=5, `agy_clau_1/2/3`=5 c/u, `ibm`=4, `writer`=4, `agy`=2, `agy2`=2, `agy2_1`=2, `agy_1`=2, + singletons (incl. slugs sin `/`) [S-010].
* Prefijos de cuentas válidas (Management `/v0/management/auth-files` + `download`): `agy, agy2, agy2_1, agy_1, agy_clau, agy_clau_1, agy_clau_2, agy_clau_3, nan, ocgo` [S-011].
* Filtro de la extensión: exige `/`; descarta prefijos con sufijo `_(\d+)$` (pools de reserva); luego valida contra `validPrefixes` + `excluded_models` [S-001, líneas 337-380].
* Resultado filtrado en vivo = **35** = `agy`(2) + `agy2`(2) + `agy_clau`(5) + `nan`(26). **Coincide exactamente** con `cpamc-models-cache.json` (35) [S-001][S-010].

→ **Hoy no hay obsolescencia en el catálogo `cpamc`.** Los "48 fantasmas" no provienen del caché de CPAMC.

### 5. Por qué los ghosts `nvidia/*` y `opencode-go/*` no se iban con la poda

* `nvidia/nemotron-3-super-120b-a12b` (580 usos en sesiones), `nvidia/nemotron-3-ultra-550b-a55b` (190), `nvidia/nemotron-3.5-lightning-30b-a3b` (39), `nvidia/llama-3.1-nemotron-ultra-253b-v1` (1) [S-012].
* **Todos esos ids están en el catálogo estático empaquetado** `pi-ai/dist/providers/data/nvidia.json` (19 modelos) [S-007].
* `opencode-go/deepseek-v4-pro` está en `opencode-go.json` (29 modelos) [S-007][S-012].
* `models-store.json` tenía 19 (nvidia) y 29 (opencode-go) → **mismo cardinal que el estático**, por lo que el overlay no añadía modelos nuevos; podarlo no cambia nada.
* La razón por la que aparecían es que esos providers **estaban autenticados**: hay sesiones con el modelo activo `nvidia/...` y el picker llegó a mostrar `actual: opencode-go/gpt-5.6-luna` con `3 proveedores · 21 cuentas · 41 modelos` [S-012].
* Estado actual: `auth.json` de j0k3r = `{}` (2 bytes, mtime 2026-10-04 03:27) y **no** hay `NVIDIA_API_KEY`/`OPENCODE_API_KEY` en `.bashrc` ni en el entorno de los procesos Pi vivos [S-009][S-015][S-020]. Por eso **ahora** esos providers no deberían aparecer; aparecieron mientras tenían credencial.
* Nota histórica: `~/.pi/agent/auth.json` (agente "gentle") y el backup `agent-j0k3r-backup-20260924-131802/auth.json` sí conservan `opencode-go` almacenado [S-018].

### 6. Ruta de fuga secundaria: el fallback de prefijos del filtro `cpamc`

`fetchAccountPrefixesAndExclusions()` devuelve `null` si no hay `CLIPROXYAPI_MANAGEMENT_KEY`, si el endpoint falla o si expira el timeout de 5 s [S-001, líneas 279-335]. Cuando `filterData == null`, `isCleanIncludedModel` cae a:

```
KNOWN_ACCOUNT_PREFIXES = { agy_g1, agy_g2, agy_son, agy, agy2, agy_clau, nan, nv, ocgo }
```

`sensors` → **`nv` está en la lista** [S-001, líneas 359-363]. Consecuencia: si el Management no responde en el primer refresco tras arrancar (`cachedFilterData` está en memoria y arranca en `null`), se aceptarían hasta **79 modelos `nv/*` y 33 `nvidia/*`** (éstos no: `nvidia` ≠ `nv`, pero `nv/…` sí) además de `agy_g1/agy_g2/agy_son`. Es un candidato real para "modelos `[cpamc]` que no existen en CPAMC".

Además, `refreshModels` **solo persiste si la lista es no vacía** (`saveCachedModels` retorna temprano con `length === 0`) [S-001, líneas 54-58] y en el registro inyecta `models: cachedModels` (si hay caché) [S-001, línea 443]. Combinado: un refresco fallido deja el caché viejo pegado indefinidamente, y el arranque siembra ese caché como catálogo `cpamc` antes de cualquier validación en vivo.

### 7. Duplicados `nan/nan/*`

CPAMC expone simultáneamente `nan/<model>` y `nan/nan/<model>` (13 pares: `deepseek-v4-flash`, `flux-2-klein`, `gemma4`, `glm5.3-flash`, `kokoro`, `mimo-v2.6-flash`, `minimax-h3`, `qwen-image-2.1`, `qwen3-embedding`, `qwen3.6`, `qwen3.8-flash`, `rerank`, `whisper`) [S-010]. El filtro toma el primer segmento (`nan`), que es válido en ambos casos, así que **ambos pasan**. No es un provider extra: es el mismo modelo replicado en la fuente. `excluded_models` de la cuenta `nan` es la vía prevista para excluirlos [S-001][S-011].

## Revisión de evidencia

| # | Afirmación | Fuentes | Confianza | Límites / desacuerdo |
|---|---|---|---|---|
| 1 | `/model` solo muestra providers autenticados (`configuredProviders`) | [S-002][S-004][S-006] | HIGH | Derivado de código; verificado en dos componentes distintos |
| 2 | `nvidia` (19) y `opencode-go` (29) son catálogos **estáticos built-in**, no derivados de CPAMC | [S-007] | HIGH | Conteos idénticos al store; diff id-a-id no posible (store ya vaciado) |
| 3 | Borrar `models-store.json` no elimina esos modelos | [S-007][S-016] | HIGH | — |
| 4 | Los ghosts aparecieron porque esos providers estaban autenticados | [S-012][S-018][S-019] | MEDIUM-HIGH | No hay captura del `auth.json` del momento 07:25; se infiere de sesiones + backups |
| 5 | `nv/*` puede filtrarse cuando Management no responde | [S-001] | HIGH (código) / MEDIUM (frecuencia) | No se observó el leak activo; es condición de fallo |
| 6 | El catálogo `cpamc` actual (35) coincide con el vivo filtrado | [S-001][S-010][S-011] | HIGH | Verificado hoy |
| 7 | Abrir `/model` dispara refresco de red y re-persiste overlays built-in | [S-005][S-016][S-006] | MEDIUM | El mecanismo está claro; no observé la repoblación en el archivo (estaba `{}` al cierre) |
| 8 | Ninguna otra extensión registra providers/modelos virtuales | [S-019] | HIGH | Grep sobre el árbol de extensiones de j0k3r |
| 9 | Id legacy `cliproxyapi` existió y está oculto solo en el picker de j0k3r | [S-012][S-013] | MEDIUM-HIGH | Evidencia de sesiones histograma; no hay commit/fecha exacta |
| 10 | `nan/nan/*` son duplicados de la fuente, no providers extra | [S-010] | HIGH | — |

**Contradicción registrada (no suavizada):** la sesión previa (07:25) afirmó que los 48 ghosts eran "filas pegadas en `models-store.json`" y que "se listan pero no servirían". La primera parte es incompleta (el catálogo estático empaquetado los aporta igual) y la segunda es **incorrecta**: si aparecen en `/model`, por la regla de `configuredProviders` estaban autenticados y sí eran utilizables. El paso 1 del runbook resuelve la ambigüedad en el caso concreto.

## Trade-offs y riesgos

* **Desautenticar providers** limpia `/model` pero pierde acceso a `nvidia`/`opencode-go` (que pueden ser legítimos como respaldo económico). Alternativa: dejarlos autenticados y acotar el scope.
* **Scope `enabledModels: ["cpamc/*"]`** limita el *ciclo* y la selección inicial, pero el selector nativo abierto en modo "all" sigue listando todo. No es un candado duro.
* **Filtrar por allowlist en el picker** (código) es la única solución determinista, pero cambia comportamiento de producto y requiere definir si el objetivo es "solo CPAMC" o "CPAMC primero".
* **Endurecer el filtro `cpamc`** (quitar `nv` del fallback) puede ocultar modelos legítimos si algún día se quiere exponer la cuenta `nv` vía CPAMC.
* **TTL de caché `cpamc`**: un TTL agresivo deja `/model` vacío de `cpamc` cuando Management/`/v1/models` no responde; conviene TTL + marca de "stale" en vez de borrado.

## Alternativas consideradas

1. **Podar `models-store.json`** (lo hecho antes): descartado — no elimina nada del catálogo estático y se repuebla en el siguiente refresco con red.
2. **`PI_OFFLINE=1`**: evita el overlay de red y los refrescos, pero también congela el catálogo de CPAMC (no actualiza `cpamc-models-cache.json`). Válido como diagnóstico, no como solución.
3. **Editar `pi-ai` data JSON** para borrar `nvidia.json`/`opencode-go.json`: no recomendado — altera artefactos de terceros, se pierde en cada actualización y rompe la resolución de credenciales.
4. **`apiKey` inexistente + `/logout`**: limpia por credencial, es la vía nativa y reversible.
5. **Allowlist en `j0k3r-model-picker`**: solución de producto determinista; requiere decisión del usuario.

## Incógnitas y límites

* No existe captura del `auth.json` de jok3r exactamente en el instante del síntoma (07:25); la atribución de "estaba autenticado" es inferencial (sesiones + backups + picker mostrando `opencode-go` como modelo actual).
* No se reprodujo experimentalmente el leak `nv/*` por fallo de Management (no se provocó el fallo; es una condición de error).
* No se ejecutó `pi --list-models` en vivo para no arriesgar escrituras del runtime fuera del directorio de esta investigación. Cualquier ejecución del runbook puede reescribir `models-store.json`/`cpamc-models-cache.json`.
* No se pudo hacer diff id-a-id entre `models-store.json` pre-poda y el estático (el archivo fue vaciado en 08:21); sólo se compararon cardinales.
* La fecha/commit exacto del renombrado `cliproxyapi` → `cpamc` no se determinó.

## Acciones siguientes recomendadas

| Prioridad | Acción | Comando / archivo | Por qué |
|---|---|---|---|
| P1 | Listar providers autenticados y confirmar cuáles son no-CPAMC | `pi --list-models` (ver Anexo A, paso 1) | Atribuir cada modelo inesperado |
| P1 | Cerrar sesión de providers no deseados | `/logout nvidia`, `/logout opencode-go` (dentro de Pi) + verificar `~/.pi/agent-j0k3r/auth.json` | Causa raíz real de la visibilidad |
| P2 | Acotar scope a CPAMC | `settings.json`: `"enabledModels": ["cpamc/*"]` + `/scoped-models` | Limita ciclo/selector sin tocar credenciales |
| P2 | Verificar entorno de Pi para claves built-in | `tr '\0' '\n' < /proc/<pid>/environ \| grep -E 'NVIDIA\|OPENCODE\|ANTHROPIC'` | Un `*_API_KEY` exportado re-autentica el provider |
| P3 | Endurecer `cpamc`: no incluir `nv` en el fallback y exponer estado "stale" | `cliproxyapi-dynamic-provider.ts` (líneas 359-363, 54-58, 443) | Evita modelos `[cpamc]` inexistentes |
| P3 | Deduplicar `nan/nan/*` | `excluded_models` de la cuenta `nan` en CPAMC | Ruido y ambigüedad de selección |
| P4 | Allowlist de providers en el picker (código) | `j0k3r-model-picker/src/*` | Solución determinista de producto |

---

## Anexo A — Runbook de depuración (atribuir cada modelo a su origen)

> Ejecutar dentro del directorio de trabajo de esta investigación. Reconstruir el entorno antes de cualquier `curl`.

```bash
# 0) Cargar variables de CPAMC (solo variables, sin imprimir secretos)
set -a; . /home/wilox/.bashrc; set +a
AGENT=/home/wilox/.pi/agent-j0k3r
```

### Paso 1 — ¿Qué providers están autenticados?

```bash
# 1a) Credenciales almacenadas (lo más determinante)
python3 -c "import json;print(list(json.load(open('$AGENT/auth.json')).keys()))"
#     -> []  significa "ningún provider con credencial almacenada"

# 1b) Claves en el entorno del proceso Pi VIVO (el que renderiza /model)
for p in $(pgrep -f "pi|agent-j0k3r"); do
  echo "== PID $p =="
  tr '\0' '\n' < /proc/$p/environ 2>/dev/null \
    | grep -E '^(NVIDIA_API_KEY|OPENCODE_API_KEY|ANTHROPIC_API_KEY|CLIPROXYAPI_[A-Z_]+|PI_CODING_AGENT_DIR|PI_OFFLINE)=' \
    | sed -E 's/=(.{0,4}).*/=\1…(redactado)/'
done

# 1c) Listado autoritativo de lo que vería /model  (⚠ reescribe cachés de modelos)
pi --list-models            # añadir un término de búsqueda para acotar, p.ej. "nvidia"
```

**Interpretación:** si un provider aparece aquí pero no en `auth.json`, está autenticado por variable de entorno. Si no aparece en ninguno, NO puede estar en `/model`.

### Paso 2 — Atribución por modelo: ¿de dónde sale cada id?

```bash
PI_AI=$AGENT/pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist

# 2a) ¿Es catálogo estático built-in?  (el proveedor se deduce del archivo donde aparezca)
grep -rl "nemotron-3-super-120b-a12b" $PI_AI/providers/data/*.json

# 2b) ¿Hay conteos por provider built-in?
python3 - <<'PY'
import json,glob,os
D=os.environ['PI_AI']+'/providers/data'
for f in sorted(glob.glob(D+'/*.json')):
    j=json.load(open(f)); ids=set()
    def w(o):
        if isinstance(o,dict):
            if isinstance(o.get('id'),str): ids.add(o['id'])
            for k,v in o.items():
                if k!='id': w(v)
        elif isinstance(o,list):
            for v in o: w(v)
    w(j); print(os.path.basename(f), len(ids))
PY

# 2c) ¿Viene del overlay pi.dev?  (buscar el id en la tienda de modelos)
grep -o '"[^"]*nemotron-3-super-120b-a12b[^"]*"' $AGENT/models-store.json | head

# 2d) ¿Viene del catálogo/caché de CPAMC?
grep -o '"[^"]*nemotron[^"]*"' $AGENT/cpamc-models-cache.json | head
```

Regla de atribución:

| Observación | Origen | Provider en `/model` |
|---|---|---|
| Id presente en `providers/data/*.json` | Catálogo built-in de Pi | El dueño de ese archivo (`nvidia`, `opencode-go`, …) |
| Id presente sólo en `models-store.json` | Overlay pi.dev | Igual, provider built-in |
| Id presente en `cpamc-models-cache.json` | Extensión `cliproxyapi-dynamic-provider` | `cpamc` |
| Id presente en `models.json` | Custom provider | El declarado en `models.json` (no existe aquí) |

### Paso 3 — ¿El modelo `[cpamc]` existe realmente en CPAMC?

```bash
# 3a) Catálogo vivo enriquecido (campo "slug")
curl -s "http://192.168.10.150:8317/v1/models?client_version=1" \
     -H "Authorization: Bearer $CLIPROXYAPI_API_KEY" -o live.json -w 'http=%{http_code}\n'
python3 -c "
import json,collections
a=json.load(open('live.json'))['models']
print('total',len(a))
print(dict(collections.Counter(m['slug'].split('/')[0] for m in a)))
"

# 3b) Prefijos de cuentas válidas (Management)
curl -s "http://192.168.10.150:8317/v0/management/auth-files" \
     -H "Authorization: Bearer $CLIPROXYAPI_MANAGEMENT_KEY" \
     | python3 -c "import json,sys;print([f['name'] for f in json.load(sys.stdin)['files']])"

# 3c) ¿Qué ids del caché NO existen en vivo?  (detecta obsolescencia del caché cpamc)
python3 - <<'PY'
import json
live={m['slug'] for m in json.load(open('live.json'))['models']}
cache=json.load(open('/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json'))
ids=sorted({x.get('id') if isinstance(x,dict) else x for x in cache})
print('cache',len(ids),'faltan en vivo:',[i for i in ids if i not in live])
PY
```

### Paso 4 — Simular el filtro `isCleanIncludedModel` (detectar fallback amplio y duplicados)

```bash
python3 - <<'PY'
import json,re
live=[m['slug'] for m in json.load(open('live.json'))['models']]
# Prefijos válidos obtenidos del paso 3b/descarga; pegar aquí
VALID={'agy','agy2','agy2_1','agy_1','agy_clau','agy_clau_1','agy_clau_2','agy_clau_3','nan','ocgo'}
FALLBACK={'agy_g1','agy_g2','agy_son','agy','agy2','agy_clau','nan','nv','ocgo'}
def keep(ids,valid):
    out=[]
    for s in ids:
        i=s.find('/')
        if i<=0 or i>=len(s)-1: continue
        p=s[:i]
        if re.search(r'_\d+$',p): continue
        if p in valid: out.append(s)
    return out
print('con filterData  ->',len(keep(live,VALID)))
print('con FALLBACK nv ->',len(keep(live,FALLBACK)),'  <-- incluye nv/*')
n=keep(live,VALID)
print('duplicados nan/nan:',sorted({x.split('/',1)[1] for x in n if x.startswith('nan/nan/')}))
PY
```

* Si el resultado con **fallback** es mucho mayor (≈ +79) y `/model` mostraba esos `nv/*` como `[cpamc]`, la causa es el fallback amplio (Paso 3b falló o `CLIPROXYAPI_MANAGEMENT_KEY` no estaba en el entorno del proceso).

### Paso 5 — ¿Qué componente renderizó el selector?

```bash
# El picker de j0k3r reemplaza /model; el nativo usa getAvailableSnapshot()
grep -rn "getAvailable\|getProviderAuthStatus\|cliproxyapi" \
  $AGENT/extensions/j0k3r-model-picker/src/*.ts | head
grep -n "Only showing models from configured providers" \
  $AGENT/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/model-selector.js
# Si el fantasma 'cliproxyapi' aparece -> renderizó el selector NATIVO (el picker lo oculta)
```

### Paso 6 — Registro de la verdad (evidencia para el informe)

```bash
{ echo "### $(date -Is)"; \
  echo "auth.json: $(cat $AGENT/auth.json)"; \
  echo "defaultProvider/defaultModel:"; grep -E 'default(Provider|Model)' $AGENT/settings.json; \
  echo "cpamc cache n: $(python3 -c "import json;print(len(json.load(open('$AGENT/cpamc-models-cache.json'))))")"; \
  echo "models-store keys: $(python3 -c "import json;print(list(json.load(open('$AGENT/models-store.json')).keys()))")"; \
} | tee /tmp/model-attribution-$(date +%H%M).log
```

## Anexo B — Tabla de atribución rápida

| Etiqueta en `/model` | ¿Existe en CPAMC vivo? | Origen | Causa | Arreglo |
|---|---|---|---|---|
| `[nvidia] nvidia/…` | No | Built-in `pi-ai` + credencial `nvidia` | Provider `nvidia` autenticado | `/logout nvidia`; quitar `NVIDIA_API_KEY` |
| `[opencode-go] …` | No | Built-in `pi-ai` + credencial `opencode-go` | Provider `opencode-go` autenticado | `/logout opencode-go` |
| `[cliproxyapi] …` | No | Id legacy de la extensión | Credencial histórica `cliproxyapi` | `/logout cliproxyapi` |
| `[cpamc] nv/…` | Sí, pero excluido por `validPrefixes` | Extensión `cpamc` con fallback | Management inaccesible → `KNOWN_ACCOUNT_PREFIXES` | Asegurar `CLIPROXYAPI_MANAGEMENT_KEY`; quitar `nv` del fallback |
| `[cpamc] agy_g1/…`, `agy_son/…` | Según pools | Extensión `cpamc` con fallback | Igual que el anterior | Igual |
| `[cpamc] nan/nan/…` | Sí (duplicado) | Extensión `cpamc` (fuente CPAMC) | Prefijo doble en la cuenta NAN | `excluded_models` en `nan` |
| `[cpamc] <id no vivo>` | No | `cpamc-models-cache.json` | Caché obsoleto (refresco fallido) | Invalidar/validar caché; TTL |
| `<cualquiera> [provider]` en `models.json` | — | `models.json` | Custom provider | **No aplica**: `models.json` ausente |
