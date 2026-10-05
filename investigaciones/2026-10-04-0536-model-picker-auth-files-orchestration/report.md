# Diagnóstico de `/model` y Orquestación entre Auth Files Management y Auto Switcher Pro

## Executive Summary

La discrepancia observada por el usuario entre el estado del plugin (**Auto switcher pro v0.1.0**, archivo `plugins/visual-profile-linux-amd64.so`) y el listado presentado en el comando `/model` de Pi (con prefijos crudos como `agy/`, `agy2/`, `agy_clau/` bajo la etiqueta `[cpamc]`) se debe a una **fuga de fontanería interna de enrutamiento hacia la capa de presentación de la interfaz de usuario**.

El plugin **Auto switcher pro** y el binario **cpamc-auto-switcher** gestionan pools de cuentas rotativas mediante una convención de prefijos sobre los archivos de credenciales de CPAMC (`base` para la cuenta activa líder y `base_N` para las reservas). Sin embargo, la extensión de Pi `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts` consume directamente el endpoint `/v1/models` de CLIProxyAPI. Dado que CLIProxyAPI expone nativamente cada modelo tanto en su forma base como en la forma `prefijo/modelo` para cada archivo de credencial cargado, la extensión de Pi filtra únicamente los sufijos de reserva (`_(\d+)$`), pero **vuelca sin procesar todos los prefijos activos (`agy`, `agy2`, `agy_clau`, `nan`, `ocgo`) al selector `/model` de Pi bajo el identificador de proveedor `[cpamc]`** [S-001, S-002, S-004].

Esto rompe el modelo mental esperado:
1. El usuario instaló un "Auto Switcher" con la expectativa de que el sistema elija y rote cuentas automáticamente entre bastidores.
2. En la práctica, el selector `/model` obliga al usuario a elegir manualmente entre prefijos crudos (`agy/claude-...` vs `agy2/claude-...` vs `agy_clau/claude-...`), transformando una rotación automática en una selección manual confusa y triplicada.
3. Además, los pools físicos `agy` y `agy2` no tenían excluidos los modelos Claude en su campo `excluded_models` (solo 12 exclusiones frente a las 218 de `agy_clau`), provocando que `claude-opus-5-5-high` aparezca repetido tres veces [S-002, S-003].

Se proponen tres escenarios de orquestación arquitectónica para unificar la solución:
- **Escenario 1 (Recomendado, Inmediato)**: Normalización y abstracción en la extensión de Pi (`cliproxyapi-dynamic-provider.ts`). El usuario solo ve nombres canónicos limpios (`claude-sonnet-4-6 [cpamc]`, `gemini-3.8-flash-high [cpamc]`), mientras la extensión adjunta transparentemente el prefijo del pool activo (`agy_clau/` o `agy/`) al comunicarse con CLIProxyAPI.
- **Escenario 2 (Estructural / Integrado)**: Auto Switcher Pro como Autoridad de Catálogo Virtual. El plugin expone un endpoint de catálogo curado que Pi consume directamente.
- **Escenario 3 (Nativo CLIProxyAPI)**: Enrutamiento transparente por modelo base con prioridades nativas y cooldowns, eliminando los prefijos en peticiones de cliente.

---

## Research Question

1. ¿Por qué en el comando `/model` de Pi aparecen modelos con prefijos como `agy_clau/claude-opus-4-6-thinking [cpamc]`, `agy/claude-opus-5-5-high [cpamc]`, `agy2/...`, mientras que en CPAMC el plugin figura como `Auto switcher pro v0.1.0 (visual-profile-linux-amd64.so)`?
2. ¿Cómo interactúan actualmente **Auth Files Management** (almacenamiento de credenciales en CLIProxyAPI), **Auto switcher pro** (plugin C-ABI y orquestador de perfiles), **cpamc-auto-switcher** (motor CLI de rotación) y **Pi** (cliente de IA)?
3. ¿Cuáles son los escenarios y propuestas concretas para que Auth Files Management y Auto switcher pro orquesten una solución limpia, coherente y unificada sin obligar al usuario a manipular prefijos internos?

---

## Recommendation or Answer

### Diagnóstico Causal Inmediato
El listado de `/model` no es un fallo del plugin ni de CLIProxyAPI; es el resultado de **cuatro factores superpuestos**:

1. **El proveedor en Pi se llama `cpamc`**: Registrado por `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts` (`PROVIDER_ID = "cpamc"`). Pi siempre añade la etiqueta `[cpamc]` a la derecha del nombre del modelo para indicar el proveedor configurado [S-001].
2. **Doble registro nativo en CLIProxyAPI**: Por diseño (`sdk/cliproxy/service_models.go`), toda credencial con prefijo registra sus modelos tanto de forma plana como `prefijo/modelo` [S-007].
3. **Filtro incompleto en la extensión de Pi**: `cliproxyapi-dynamic-provider.ts` descarta prefijos con sufijo numérico de reserva (`_(\d+)$`), pero deja pasar cualquier prefijo raíz activo. Al existir en el sistema tres prefijos raíz activos (`agy`, `agy2` y `agy_clau`), Pi muestra los modelos de los tres de forma independiente [S-001, S-003].
4. **Contaminación cruzada de familias**: Los archivos físicos de Gemini (`antigravity-infosoytec@gmail.com.json` y `antigravity-wilsonlavio11@gmail.com.json`) no excluyeron `claude-opus-5-5-high`. Por ello, dicho modelo se registró bajo `agy/`, bajo `agy2/` y bajo `agy_clau/` [S-002, S-003].

### Ruta Recomendada: Escenario 1 (Abstracción en el Proveedor Dinámico de Pi)
La solución más limpia, rápida y de menor riesgo técnico consiste en desacoplar la **interfaz de usuario de Pi** de la **técnica de enrutamiento por prefijo** de CPAMC:
1. **Corregir exclusiones en Auth Files**: Aplicar el patrón de exclusión completo a los archivos físicos de `agy` y `agy2` para que excluyan todos los modelos Claude/GPT (`claude-*`, `gpt-*`), dejando a `agy_clau` como el único pool que expone Claude.
2. **Consolidar cuentas Gemini**: Unificar las 4 cuentas físicas en un único pool Gemini `agy` (1 líder `agy` + 3 reservas `agy_1`, `agy_2`, `agy_3`), eliminando el pool redundante `agy2`.
3. **Mapeo transparente en `cliproxyapi-dynamic-provider.ts`**:
   - La extensión presenta en `/model` modelos con nombres limpios y canónicos (ej. `Claude Sonnet 4.6`, `Claude Opus 5.5`, `Gemini 3.8 Flash`).
   - Internamente, la extensión mantiene la tabla de resolución: si el usuario pide `Claude Sonnet 4.6`, envía la petición a CLIProxyAPI como `agy_clau/claude-sonnet-4-6`. Si pide `Gemini 3.8 Flash`, la envía como `agy/gemini-3.8-flash-high`.
   - `cpamc-auto-switcher` continúa rotando automáticamente las reservas ante 429 de manera transparente en segundo plano.

---

## Key Findings

### F1: Origen exacto del texto `[cpamc]` y de los modelos en `/model`
La extensión `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts` define explícitamente:
```typescript
const PROVIDER_ID = "cpamc";
// ...
pi.registerProvider(PROVIDER_ID, {
    name: "CPAMC",
    baseUrl: `${resolveBaseUrl()}/v1`,
    // ...
});
```
Pi utiliza el `PROVIDER_ID` como tag visual entre corchetes (`[cpamc]`) en el selector `/model`. El catálogo local en caché `/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json` contiene textualmente los 8 modelos observados por el usuario [S-001, S-004].

### F2: Verificación en vivo de modelos registrados en CLIProxyAPI
Una inspección en vivo de solo lectura al endpoint `http://127.0.0.1:8317/v1/models` confirmó que existen 276 modelos registrados, de los cuales 242 son prefijados. Para los prefijos observados [S-002]:
- **`agy/`** (2 modelos): `agy/claude-opus-5-5-high`, `agy/gemini-3.8-flash-high`.
- **`agy2/`** (2 modelos): `agy2/claude-opus-5-5-high`, `agy2/gemini-3.8-flash-high`.
- **`agy_clau/`** (5 modelos): `agy_clau/claude-opus-5-5-high`, `agy_clau/claude-sonnet-5-5-high`, `agy_clau/claude-sonnet-4-6`, `agy_clau/claude-opus-4-6-thinking`, `agy_clau/gpt-oss-120b-medium`.

Esta lista coincide de forma exacta, modelo por modelo, con la captura proporcionada en el prompt del usuario.

### F3: Lógica de filtrado en Pi (`isCleanIncludedModel`)
En `cliproxyapi-dynamic-provider.ts` (líneas 330-365), la función encargada de decidir qué modelos mostrar en `/model` hace lo siguiente:
```typescript
// Omitir prefijos de cuentas de reserva (ej. agy_g1_1, agy_g1_2, agy_g2_1).
if (/_(\d+)$/.test(prefix)) {
    return false;
}
```
El filtro descarta las reservas (`agy_1`, `agy2_1`, `agy_clau_1`, etc.), pero asume que **todo prefijo sin sufijo `_\d+` es una cuenta independiente que el usuario debe poder elegir directamente**. Como consecuencia, `agy`, `agy2` y `agy_clau` se exponen como opciones separadas en el menú [S-001].

### F4: Causa de la triplicación de `claude-opus-5-5-high`
Los archivos de credenciales físicos (`antigravity-infosoytec@...json` y `antigravity-wilsonlavio11@...json`) solo cuentan con 12 modelos en su lista `excluded_models`. Esta lista omite los identificadores de Claude 5.5. Por el contrario, los archivos virtuales `agy_clau` cuentan con 218 exclusiones calculadas matemáticamente al clonar (excluyendo toda la familia Gemini) [S-003, S-008].
Al no estar excluido en los archivos físicos de Gemini, CLIProxyAPI registra `claude-opus-5-5-high` tanto bajo `agy/` como bajo `agy2/`, generando una triple presencia en `/model` [S-002, S-003].

### F5: Ruptura de la orquestación ante la selección del usuario
Cuando el usuario selecciona en Pi `→ agy_clau/claude-sonnet-4-6 [cpamc]`, la petición HTTP enviada a CLIProxyAPI contiene:
`"model": "agy_clau/claude-sonnet-4-6"`.
- CLIProxyAPI busca credenciales cuyo prefijo coincida con `agy_clau` [S-007].
- Si esa cuenta líder se satura (429), la extensión `pi extensions/cpamc-auto-switcher/index.ts` intercepta el 429 y ejecuta `cpamc-auto-switcher --force` [S-006].
- El switcher promueve una reserva (`agy_clau_1` → `agy_clau`) y degrada la líder agotada (`agy_clau` → `agy_clau_3`) [S-009].
- Como el cliente sigue llamando a `agy_clau/...`, el cambio de cuenta es transparente dentro del pool `agy_clau`.
- **El problema surge si el usuario selecciona `agy/claude-opus-5-5-high`**: esa petición va al pool `agy`, que está pensado para Gemini, agotando la cuota de Claude de la cuenta líder de Gemini y desincronizando la telemetría del switcher.

---

## Evidence Review

| # | Afirmación / Hallazgo | Fuentes | Nivel Confianza | Notas y Limitaciones |
|---|---|---|---|---|
| C1 | Pi registra el proveedor bajo el ID `cpamc` y muestra `[cpamc]` en `/model` | [S-001], [S-004] | HIGH | Verificado en código TypeScript y archivo JSON de caché local. |
| C2 | `/v1/models` contiene exactamente los 8 modelos reportados bajo `agy/`, `agy2/` y `agy_clau/` | [S-002] | HIGH | Consulta HTTP en vivo ejecutada el 2026-10-04 contra `127.0.0.1:8317`. |
| C3 | `cliproxyapi-dynamic-provider.ts` solo excluye sufijos `_(\d+)$`, dejando visibles todos los líderes de pool | [S-001] | HIGH | Verificado en la función `isCleanIncludedModel`. |
| C4 | Los archivos de `agy` y `agy2` solo tienen 12 exclusiones y no filtran Claude Opus 5.5 | [S-003] | HIGH | Descarga y análisis de metadatos de los 10 auth-files activos vía Management API. |
| C5 | El plugin C-ABI se identifica como "Auto switcher pro v0.1.0" pero no controla el catálogo de Pi | [S-005] | HIGH | El plugin registra rutas de gestión y UI web, no intercepta `/v1/models`. |
| C6 | `cpamc-auto-switcher` rota prefijos líder/reserva en base a cuota y eventos 429 | [S-006], [S-009] | HIGH | Confirmado en `switcher.go` y la extensión de eventos de Pi. |

---

## Propuestas y Escenarios de Orquestación

Para resolver la desconexión entre **Auth Files Management**, **Auto switcher pro** y el comando `/model` de Pi, se analizan tres escenarios:

```
+-----------------------------------------------------------------------------------+
| ACTUAL: Fontanería expuesta al usuario                                             |
|                                                                                   |
|  [Usuario en Pi] ---> /model ---> Elige "agy_clau/claude-sonnet-4-6 [cpamc]"      |
|                                         ^                                         |
|  [cliproxyapi-dynamic-provider.ts] -----+ (Vuelca todos los prefijos activos)     |
|                                         |                                         |
|  [CLIProxyAPI] <------------------------+ (Doble registro crudo en /v1/models)     |
|    |-- agy/ (Gemini pool 1)                                                       |
|    |-- agy2/ (Gemini pool 2)                                                      |
|    `-- agy_clau/ (Claude virtual pool)                                            |
+-----------------------------------------------------------------------------------+
```

### Escenario 1: Normalización y Abstracción en Pi Provider (Recomendado)

En este escenario, el plugin y Auth Files Management mantienen la convención de pools por prefijo, pero la extensión de Pi actúa como una capa de abstracción limpia:

```
+-----------------------------------------------------------------------------------+
| ESCENARIO 1: Capa de Abstracción en el Cliente (Pi Provider)                      |
|                                                                                   |
|  [Usuario en Pi] ---> /model ---> Ve solo:                                        |
|                                    • Claude Sonnet 4.6 [cpamc]                    |
|                                    • Claude Opus 4.6 (Thinking) [cpamc]           |
|                                    • Gemini 3.8 Flash High [cpamc]                |
|                                    • GPT-5.6-Luna [cpamc]                         |
|                                                                                   |
|  [cliproxyapi-dynamic-provider.ts]                                                |
|    1. Deduplica modelos idénticos entre pools.                                    |
|    2. Oculta el prefijo interno en `name` y `displayName`.                        |
|    3. Mantiene tabla interna: Claude -> `agy_clau/`, Gemini -> `agy/`.            |
|    4. Reescribe la petición al vuelo al enviar a CLIProxyAPI.                     |
|                                                                                   |
|  [Auto Switcher Pro / CLI] ---> Rota reservas (agy_clau_1, agy_1) transparentemente|
+-----------------------------------------------------------------------------------+
```

- **Cómo funciona**:
  1. `cliproxyapi-dynamic-provider.ts` inspecciona los modelos de `/v1/models`.
  2. En lugar de mostrar `agy_clau/claude-sonnet-4-6`, genera un ID canónico o muestra el nombre limpio `Claude Sonnet 4.6`.
  3. Si un modelo está presente en múltiples prefijos (`agy` y `agy_clau`), prioriza el prefijo de la familia nativa (`agy_clau` para Claude, `agy` para Gemini).
  4. Al despachar la llamada a `/v1/chat/completions`, inyecta el prefijo de enrutamiento adecuado.
- **Ventajas**:
  - Implementación 100 % desacoplada de CLIProxyAPI.
  - Elimina de inmediato la triplicación y la confusión visual en `/model`.
  - No requiere alterar la arquitectura de virtualización del plugin ni recompilar binarios `.so`.
- **Desventajas**:
  - La lógica de mapeo reside en la extensión de TypeScript de Pi. Otros clientes OpenAI que se conecten directamente a CLIProxyAPI seguirán viendo los prefijos a menos que usen clientes configurados.

---

### Escenario 2: Auto Switcher Pro como Autoridad Central de Catálogo (Integración de Plugin)

En este escenario, Auto Switcher Pro no solo es una interfaz visual de configuración, sino el proveedor oficial del catálogo de modelos para clientes IA.

- **Cómo funciona**:
  1. El plugin C-ABI declara un nuevo recurso o ruta: `GET /v0/resource/plugins/visual-profile-linux-amd64/catalog`.
  2. Este endpoint consulta el estado de los pools activos (`agy_clau`, `agy`, etc.), sus cuotas actuales y devuelve una lista filtrada, sanitizada y categorizada de modelos disponibles, asignando a cada modelo el pool que tenga mayor cuota disponible.
  3. `cliproxyapi-dynamic-provider.ts` en Pi apunta a este endpoint del plugin en lugar de consultar `/v1/models` y `/v0/management/auth-files` por separado.
- **Ventajas**:
  - La verdad única del catálogo proviene de Auto Switcher Pro (coincide exactamente lo que se ve en la web de CPAMC con lo que se ve en Pi).
  - Permite conmutación inteligente a nivel de catálogo (si el pool Claude está al 0%, el plugin puede marcarlo temporalmente como no disponible o desviar a un fallback).
- **Desventajas**:
  - Requiere extender el código Go del plugin (`plugins/visual-profile`), recompilar el `.so` con Docker y redesplegarlo en CLIProxyAPI.

---

### Escenario 3: Enrutamiento Transparente por Modelo Base con Prioridades Nativas de CLIProxyAPI

En este escenario, se eliminan completamente los prefijos de cuenta en las peticiones cliente, aprovechando las capacidades nativas de prioridad y cooldown de CLIProxyAPI.

- **Cómo funciona**:
  1. Cada archivo de credencial en Auth Files Management tiene `excluded_models` estricto según su familia (Gemini excluye Claude/GPT; Claude excluye Gemini).
  2. En lugar de usar prefijos diferenciados (`base` vs `base_1`), todas las cuentas de una misma familia tienen el mismo prefijo o ninguno.
  3. La cuenta activa se marca con `priority: 100` y las reservas con `priority: 10`.
  4. Cuando Pi o cualquier cliente pide `claude-sonnet-4-6` (sin prefijo), CLIProxyAPI (`sdk/cliproxy/auth/selector.go`) selecciona automáticamente la cuenta del tier de prioridad más alto (la activa).
  5. Cuando la cuenta activa entra en 429/cooldown, CLIProxyAPI conmuta automáticamente a la siguiente cuenta disponible del tier inferior.
- **Ventajas**:
  - Estándar OpenAI 100 % puro: ningún cliente necesita saber qué es un prefijo ni qué es un pool.
  - Elimina por completo los prefijos en `/v1/models`.
- **Desventajas**:
  - Requiere reescribir la lógica central de `cpamc-auto-switcher` (que actualmente opera intercambiando strings de prefijo).
  - Los cooldowns nativos de CLIProxyAPI son por tiempo fijo, mientras que las cuotas de Antigravity son ventanas de 5 horas o semanales.

---

## Comparativa de Escenarios

| Criterio | Escenario 1: Normalización en Pi Provider | Escenario 2: Plugin como Autoridad de Catálogo | Escenario 3: Prioridades Nativas CLIProxyAPI |
|---|---|---|---|
| **Esfuerzo de implementación** | **Bajo** (solo modificar `cliproxyapi-dynamic-provider.ts`) | **Medio** (Go C-ABI plugin + TS en Pi) | **Alto** (reescribir motor de switcher) |
| **Riesgo operativo** | **Mínimo** (no toca Docker ni C-ABI) | **Bajo** (añade endpoint sin romper existentes) | **Alto** (cambio de paradigma de routing) |
| **Limpieza en `/model`** | **Excelente** (nombres limpios sin prefijos) | **Excelente** (catálogo dinámico sincronizado) | **Excelente** (catálogo OpenAI estándar) |
| **Soporte multi-cliente** | Solo Pi (otros clientes verían prefijos) | Clientes adaptados al endpoint | Todos los clientes estándar OpenAI |
| **Tiempo de resolución** | Inmediato (< 1 hora) | 1-2 días | Varios días / testing intensivo |

---

## Trade-offs and Risks

- **Riesgo de desincronización de cuota si se llama al prefijo incorrecto**: Mientras persista `agy/claude-opus-5-5-high`, llamadas a ese modelo consumen el bucket de Claude de la cuenta líder de Gemini. Es imperativo limpiar los `excluded_models` en los archivos físicos de Gemini.
- **Persistencia de la caché en Pi (`cpamc-models-cache.json`)**: Pi almacena los modelos en caché. Aunque se corrijan las exclusiones o se reconfigure el plugin, Pi mantendrá los modelos anteriores hasta que se invoque `refreshModels()` o se limpie el archivo de caché.
- **Riesgo de fragmentación en múltiples pools Gemini (`agy` y `agy2`)**: Mantener dos líderes Gemini con 1 reserva cada uno duplica los modelos en el catálogo y reduce la resiliencia (cada pool solo tolera 1 fallo antes de agotarse). Consolidar en un único pool de 4 cuentas (1 líder + 3 reservas) ofrece 3 conmutaciones automáticas consecutivas sin intervención.

---

## Alternatives Considered

1. **Activar `force-model-prefix: true` en CLIProxyAPI**: Se analizó si forzar prefijos resolvía el problema. Conclusión: empora la situación para el usuario, ya que elimina los modelos base de `/v1/models` y obliga obligatoriamente a usar la sintaxis `prefijo/modelo` en todas las herramientas.
2. **Eliminar el plugin Auto switcher pro**: Descartado; el plugin proporciona la interfaz gráfica necesaria para gestionar topología, telemetría espectral TrueColor y la virtualización multi-prefijo (Mecanismo A).
3. **Dejar que el usuario elija manualmente**: Descartado; contradice directamente la petición del usuario y la premisa de automatización de la suite.

---

## Unknowns and Limits

- **Entorno de ejecución de Pi**: La investigación se realizó de forma estrictamente de solo lectura; no se modificó ningún archivo en `~/.pi/agent-j0k3r/` ni en `~/services/cliproxy/`.
- **Comportamiento ante reinicio de Pi**: No se forzó el refresco dinámico de Pi para no interrumpir la sesión actual del usuario.

---

## Recommended Next Actions

1. **Fase 1 (Limpieza de Exclusiones en Auth Files Management)**:
   - Actualizar el campo `excluded_models` de las cuentas físicas de Gemini (`antigravity-infosoytec@...json` y `antigravity-wilsonlavio11@...json`) para incluir explícitamente `claude-*` y `gpt-*`. Esto eliminará de raíz la presencia de modelos Claude bajo `agy/` y `agy2/`.
2. **Fase 2 (Consolidación de Pools Gemini)**:
   - En la UI de Auto Switcher Pro (`🛠️ Crear Group/Perfiles`), disolver el pool redundante `agy2` y fusionar sus cuentas en el pool `agy` (resultando en 1 líder `agy` y 3 reservas `agy_1`, `agy_2`, `agy_3`).
3. **Fase 3 (Implementación del Escenario 1 en `cliproxyapi-dynamic-provider.ts`)**:
   - Ajustar la lógica de presentación de modelos para ocultar prefijos de pool a los usuarios de Pi y deduplicar nombres.
   - Forzar el refresco de modelos en Pi para regenerar `cpamc-models-cache.json`.
