# Viabilidad de Indicador Visual (Ícono) de Cuenta Principal de Rotación en el Selector de Modelos de Pi

## Executive Summary

Esta investigación analiza de manera exhaustiva la viabilidad técnica de indicar visualmente —mediante un ícono inicial como 👑 o ⭐— qué cuenta o ruta corresponde a la **cuenta principal de rotación (líder activa del pool)** al invocar el comando `/model` (o selectores equivalentes) a través de los diferentes entornos de agente Pi del ecosistema local: **gentle-pi**, **gentle-shell** y **jok3r-pi**, consumiendo modelos servidos por **CLIProxyAPI (v8.0.13)** y orquestados por la suite **cpamc-auto-switcher** / **visual-profile**.

El análisis técnico concluye que **inyectar un ícono directamente desde el plugin en el identificador de modelo (`model.id`) es inviable y peligroso**, ya que `model.id` es la clave de enrutamiento wire de CLIProxyAPI y su alteración causaría la ruptura inmediata del enrutamiento HTTP hacia los proveedores upstream (error HTTP 404 Model Not Found). Asimismo, enviar el ícono en los campos descriptivos (`model.name`, `display_name` o `description`) dentro de `/v1/models` resulta **inefectivo en gentle-pi y gentle-shell**, debido a que el componente nativo de Pi (`ModelSelectorComponent`) renderiza exclusivamente el `id` plano en las filas de la lista, ignorando los nombres descriptivos en la vista de selección.

Por el contrario, la solución técnica **100% viable, no destructiva y de bajo riesgo** consiste en aplicar una **decoración visual en la capa cliente (TUI) de Pi**:
1. El backend (`cpamc-auto-switcher` / `visual-profile` / CLIProxyAPI) mantiene sus identificadores de enrutamiento canónicos intactos (`agy_g1/...`, `agy_son/...`).
2. El selector de modelo intercepta la presentación visual (patrón ya demostrado exitosamente en `j0k3r-model-picker`) para anteponer dinámicamente el glifo `👑 ` o `⭐ ` en la etiqueta del TUI según la regla estructural de pools: un prefijo sin sufijo numérico final `_(\d+)$` es **líder activo**, mientras que prefijos con `_1`, `_2` son **reservas**.
3. Al homologar e instalar esta extensión de selección tanto en el perfil de `jok3r-pi` (`~/.pi/agent-j0k3r`) como en el de `gentle-pi` / `gentle-shell` (`~/.pi/agent`), los tres entornos obtienen una experiencia visual coherente y en tiempo real sin arriesgar la estabilidad del proxy.

## Research Question

¿Es viable técnica y arquitectónicamente, desde el plugin `visual-profile` o CLIProxyAPI, enviar o inyectar un ícono inicial que identifique a la cuenta principal de rotación para que se visualice al ejecutar `/model` en los entornos de agente `gentle-pi`, `gentle-shell` y `jok3r-pi`? ¿Qué componentes intervienen, qué riesgos de rotura de enrutamiento existen y cuál es el diseño óptimo para lograrlo?

## Recommendation or Answer

1. **Inviabilidad en el cable (`model.id`)**: **No modificar `model.id` en CLIProxyAPI ni en el plugin visual-profile**. Inyectar un emoji (ej. `👑 agy_g1/gemini-2.5-pro`) rompe la resolución de prefijos en `service_models.go`, la compatibilidad del protocolo OpenAI y las llamadas HTTP de inferencia `[S-003, S-007]`.
2. **Insuficiencia de `display_name` en `/v1/models` para Pi nativo**: Modificar `display_name` desde un interceptor de CLIProxyAPI no resuelve el problema en `gentle-pi` ni `gentle-shell`, porque el componente `ModelSelectorComponent` de `@earendil-works/pi-coding-agent` solo pinta `item.id` en las líneas de la lista del TUI `[S-001]`.
3. **Estrategia Recomendada (Decoración en Capa Cliente)**: Adoptar una **decoración dinámica en el cliente Pi (TUI)** compartida entre `jok3r-pi` y `gentle-pi` / `gentle-shell`:
   - El cliente consulta `/v0/management/auth-files` (o lee dinámicamente los prefijos cargados) para determinar qué prefijos son líderes de pool (aquellos que no coinciden con la expresión regular `/_(\d+)$/`) `[S-006, S-010]`.
   - En el renderizado de la fila en pantalla, se antepone el glifo visual (ej. `👑 ` o `⭐ `) a la etiqueta en pantalla (`label`), preservando intacto el `model.id` para la asignación interna mediante `pi.setModel(model)` `[S-004, S-005]`.
   - Homologar el componente selector (basado en `j0k3r-model-picker`) para que esté activo como extensión compartida tanto en `~/.pi/agent` (`gentle-pi` / `gentle-shell`) como en `~/.pi/agent-j0k3r` (`jok3r-pi`) `[S-005, S-012]`.

---

## Key Findings

### 1. Disparidad de Arquitectura entre Perfiles Pi (`jok3r-pi` vs `gentle-pi` / `gentle-shell`)
El entorno local cuenta con dos configuraciones Pi desacopladas:
- **`jok3r-pi` (`~/.pi/agent-j0k3r`)**: Dispone de la extensión `j0k3r-model-picker` y del proveedor dinámico `cliproxyapi-dynamic-provider.ts` `[S-005, S-006]`. Este selector ya implementa un panel flotante TUI agrupado (Proveedor → Modelo Canónico → Cuentas) y contiene código preliminar en `modal.ts` que añade `roleIcon = "⭐ "` antes de `model.id`. Sin embargo, esta lógica estaba **estáticamente cableada** (*hardcoded*) solo para tres prefijos específicos (`agy_g1`, `agy_g2`, `agy_son`), ignorando otros pools o cuentas dinámicas `[S-005]`.
- **`gentle-pi` y `gentle-shell` (`~/.pi/agent`)**: Utilizan el runtime estándar de `pi-coding-agent` sin `j0k3r-model-picker` `[S-012]`. El comando `/model` ejecuta directamente el componente interno `ModelSelectorComponent` `[S-001, S-002]`.

### 2. Anatomía del Selector Nativo de Pi (`ModelSelectorComponent`)
En `pi-coding-agent`, el selector interactivo `/model` itera sobre los modelos disponibles con el siguiente formateo de línea `[S-001]`:
```typescript
const modelText = isSelected ? theme.fg("accent", item.id) : item.id;
const providerBadge = theme.fg("muted", `[${item.provider}]`);
const line = `${cursor}${currentMarker}${modelText} ${providerBadge}${defaultBadge}`;
this.listContainer.addChild(new Text(line, 0, 0));
```
- La línea visual es exclusivamente `${item.id} [${item.provider}]`.
- El campo `item.model.name` (o `display_name`) solo se muestra como texto estático informativo en el pie de página cuando un elemento está seleccionado: `Model Name: ${selected.model.name}` `[S-001]`.
- En consecuencia, **ninguna alteración de metadatos devuelta por el servidor HTTP `/v1/models` (salvo alterar el propio ID) puede hacer que aparezca un ícono al inicio de la fila en el selector nativo de Pi** `[S-001]`.

### 3. Estructura de Pools y Cuentas Líderes en `cpamc-auto-switcher`
En el backend y la CLI de auto-conmutación:
- Una cuenta es **Líder Activa** si su prefijo coincide con la base del pool (`baseActive`, ej. `agy_g1`, `agy_g2`, `agy_son`, `codex`) y no termina en sufijo numérico `_(\d+)$` `[S-010, S-011]`.
- Las cuentas con sufijo numérico (ej. `agy_g1_1`, `agy_g1_2`, `agy_son_1`) son **Cuentas de Reserva** ordenadas en cascada `[S-010]`.
- Cuando ocurre un cambio forzado o automático (por cuota 429 o agotamiento semanal), `cpamc-auto-switcher` ejecuta un intercambio de prefijos en CPAMC (`client.PatchAuthPrefix`): la reserva elegida se renombra al prefijo líder (ej. `agy_g1`), y el líder agotado pasa a ser una reserva (ej. `agy_g1_2`) `[S-010]`.
- **Invariante Crítico**: El prefijo de enrutamiento activo **nunca cambia de nombre**; siempre es `agy_g1`, `agy_g2`, `agy_son`, etc. Lo que rota silenciosamente detrás del prefijo es la credencial física subyacente `[S-010]`.

### 4. Filtrado Preventivo Existente en `cliproxyapi-dynamic-provider.ts`
El conector dinámico en `jok3r-pi` ya contiene una regla defensiva clave en `isCleanIncludedModel` `[S-006]`:
```typescript
// Omitir prefijos de cuentas de reserva (ej. agy_g1_1, agy_g1_2, agy_g2_1).
// Exponer únicamente las cuentas activas / raíz (ej. agy_g1, agy_g2, agy_son, ocgo, nv).
if (/_(\d+)$/.test(prefix)) {
    return false;
}
```
Esto significa que en `jok3r-pi`, las cuentas de reserva ya son filtradas y no saturan el catálogo, exponiendo únicamente las cuentas líderes/raíz. Sin embargo, el usuario no dispone de una señal visual evidente (como un ícono 👑) que le transmita certeza de que ese modelo pertenece a la ruta activa principal de rotación.

---

## Evidence Review

### Mecánica de Enrutamiento en CLIProxyAPI y el Wire Protocol
Al recibir una petición HTTP de inferencia (ej. `/v1/chat/completions` o `/v1/messages`), el cliente Pi envía el campo `model` tomado directamente de `model.id` `[S-003]`:
```json
{
  "model": "agy_g1/gemini-2.5-pro",
  "messages": [...]
}
```
En el servidor CLIProxyAPI:
1. `service_models.go` registra los modelos utilizando `applyModelPrefixes`, que genera IDs canónicos uniendo `trimmedPrefix + "/" + baseID` `[S-007]`.
2. Durante la ejecución de la petición, el enrutador inspecciona el segmento previo a la primera barra (`/`) y busca una credencial de autenticación cuyo campo `auth.Prefix` coincida con dicho segmento `[S-007]`.
3. Si un plugin o proxy alterara el ID a `👑 agy_g1/gemini-2.5-pro`:
   - El prefijo extraído sería `"👑 agy_g1"`.
   - La búsqueda en `GlobalModelRegistry().ClientSupportsModel(...)` fracasa porque ninguna credencial en el archivo de configuración tiene ese prefijo con emoji `[S-007]`.
   - Resultado: CLIProxyAPI rechaza la solicitud con error `HTTP 404 Model Not Found` o un fallo de enrutamiento upstream `[S-007]`.

### Capacidades del Plugin `visual-profile` (C-ABI)
La inspección de `plugins/visual-profile/internal/plugin/plugin.go` `[S-011]` y `sdk/pluginabi/types.go` `[S-009]` demuestra que:
- El plugin se registra exclusivamente con capacidad `management_api: true` para servir rutas bajo `/v0/resource/plugins/visual-profile/` (UI web de React con Control Switcher, Visual Profile y Pulse Tokens).
- No implementa la capacidad `response_interceptor` (`MethodResponseInterceptAfter`), por lo que actualmente **no intercepta ni transforma las respuestas de `/v1/models`** `[S-008, S-009]`.
- Incluso si se dotara al plugin de capacidad de interceptor de respuesta HTTP sobre `WriteModelListResponse` `[S-008]`, solo podría modificar el JSON devuelto por `/v1/models`. Como se evidenció en `S-001`, Pi ignora `display_name` en la lista TUI de `/model`.

### Experimento Previsto en `j0k3r-model-picker`
En `~/.pi/agent-j0k3r/extensions/j0k3r-model-picker/src/modal.ts` líneas 728-738 `[S-005]`:
```typescript
// Ícono guía visual para cuentas Padre / Activa vs Reserva
const slash = model.id.indexOf("/");
const prefix = slash > 0 ? model.id.slice(0, slash) : "";
const isParent = prefix === "agy_g1" || prefix === "agy_g2" || prefix === "agy_son";
const roleIcon = isParent ? "⭐ " : "";

const label = selected
    ? bold(theme, fg(theme, "text", `${roleIcon}${model.id}`))
    : fg(theme, hovered ? "text" : "muted", `${roleIcon}${model.id}`);
```
Este bloque de código prueba fehacientemente que:
1. Es enteramente factible anteponer un ícono (`roleIcon`) antes de `${model.id}` en la presentación de pantalla sin alterar el valor de `model.id` que se asigna a la sesión de Pi mediante `pi.setModel(model)` `[S-005]`.
2. El ícono se renderiza de forma limpia y nítida en el TUI sin producir desalineación ni romper el protocolo de comunicación.
3. El único defecto actual es que la condición `isParent` dependía de una lista estática en lugar de aplicar la regla general de detección de líderes de `cpamc-auto-switcher` (`!/_(\d+)$/.test(prefix)`).

---

## Trade-offs and Risks

| Enfoque / Mecanismo | Viabilidad | Riesgo Técnico | Impacto en `gentle-pi` / `gentle-shell` | Impacto en `jok3r-pi` |
|---|---|---|---|---|
| **Opción 1: Modificar `model.id` en backend (CLIProxyAPI / Plugin)** | **NULA (Inviable)** | **Crítico / Ruptura total**: Rompe el enrutamiento HTTP 404 en CLIProxyAPI y valida mal en clientes OpenAI `[S-003, S-007]`. | Rompe la capacidad de inferencia del agente. | Rompe la capacidad de inferencia del agente. |
| **Opción 2: Modificar `display_name` en `/v1/models` vía interceptor** | **Baja (Inefectiva)** | **Bajo**: El JSON es válido, pero el cliente nativo de Pi no lo renderiza en la lista de `/model` `[S-001]`. | Nulo (el usuario sigue sin ver el ícono en la lista). | Parcial (solo visible si el picker lee explícitamente `displayName`). |
| **Opción 3: Decoración dinámica en Cliente TUI (Extensión Pi compartida)** | **ALTA (Recomendada)** | **Mínimo**: El wire ID se conserva intacto. La presentación visual es desacoplada y reactiva `[S-004, S-005]`. | Requiere activar la extensión del selector en `~/.pi/agent`. | Inmediato y compatible con la estructura existente. |

### Matriz de Modos de Fallo
1. **Fallo de Enrutamiento por Caracteres Unicode en Wire ID**: Si se envía un emoji en el `id` hacia el proveedor upstream (ej. Google Vertex, Anthropic, OpenAI), los parsers de cabeceras HTTP y endpoints REST devuelven `400 Bad Request: Invalid model name pattern`.
2. **Desincronización tras Rotación**: Si la extensión cliente memoriza qué cuenta es líder de forma estática en memoria, tras una rotación automática ejecutada por `cpamc-auto-switcher` (por 429), la información visual quedaría desfasada. La comprobación dinámica por patrón de prefijo (`!/_(\d+)$/.test(prefix)`) resuelve este riesgo por completo, ya que la cuenta promovida adopta de inmediato el prefijo base `[S-010]`.

---

## Alternatives Considered

1. **Virtual Models de Pi (`pi.registerVirtualModel`)**:
   - *Concepto*: Registrar modelos virtuales como `cpamc/👑-gemini-pro` que apunten dinámicamente al modelo físico `agy_g1/gemini-2.5-pro` `[S-004]`.
   - *Evaluación*: Aunque la API de Pi soporta modelos virtuales, añade una capa innecesaria de indirección en la sesión de Pi y requeriría actualizar las entradas virtuales cada vez que cambien los modelos disponibles en el proxy.
2. **Modificación del Binario Nativo de Pi (`pi-coding-agent`)**:
   - *Concepto*: Parchear `model-selector.js` en `@earendil-works/pi-coding-agent` para que pinte `selected.model.name` en lugar de `item.id`.
   - *Evaluación*: No recomendable. Pi se distribuye como binario empaquetado con Bun o módulo npm empaquetado, lo que generaría deuda técnica y se perdería en cualquier actualización de versión.
3. **Extensión Decoradora Homologada (Propuesta Seleccionada)**:
   - *Concepto*: Emplear una extensión ligera para Pi (basada en el diseño probado de `j0k3r-model-picker`) que funcione como selector universal en ambos perfiles (`gentle-pi` y `jok3r-pi`).

---

## Unknowns and Limits

- **Soporte de Terminal para Emojis**: Aunque terminales modernas (Ghostty, Alacritty, Kitty, iTerm2, Windows Terminal) soportan caracteres anchos como `👑` o `⭐`, ciertas fuentes monoespaciadas sin parches de Nerd Fonts pueden desplazar el cursor 1 o 2 celdas. En `j0k3r-model-picker` se utiliza `visibleWidth` y sanitización ANSI para mitigar desalineaciones `[S-005]`.
- **Prevalencia del Handler de Editor de Pi**: En `pi-coding-agent`, el comando `/model` está cableado en el núcleo interactivo `[S-002]`. Para interceptar la pulsación exacta de `/model` (en lugar de obligar al usuario a escribir `/model-select` o `/ms`), la extensión debe instalar el reemplazo de `CustomEditor` (`installSubmitTrap`), el cual debe probarse en ambos entornos para garantizar que no entre en conflicto con extensiones de chat o banners de inicio `[S-005, S-012]`.

---

## Recommended Next Actions

1. **No tocar la capa de red ni la API `/v1/models` para inyectar íconos**: Mantener los identificadores `model.id` y los prefijos de las credenciales de autenticación libres de caracteres especiales y emojis para preservar la integridad operativa del enrutador de CLIProxyAPI `[S-007]`.
2. **Generalizar la Regla de Líder en `j0k3r-model-picker`**:
   - Reemplazar la comprobación estática:
     ```typescript
     // Reemplazar: const isParent = prefix === "agy_g1" || prefix === "agy_g2" || prefix === "agy_son";
     // Por la regla canónica del ecosistema cpamc-auto-switcher:
     const isParent = slash > 0 && !/_(\d+)$/.test(prefix);
     const roleIcon = isParent ? "👑 " : "";
     ```
   - Esto dotará automáticamente de ícono a cualquier pool actual o futuro (`agy_g1`, `agy_g2`, `agy_son`, `codex`, `ocgo`, `nv`) sin mantenimiento manual `[S-005, S-010]`.
3. **Homologar el Selector en `gentle-pi` y `gentle-shell`**:
   - Enlazar o empaquetar la extensión `j0k3r-model-picker` dentro del perfil común `~/.pi/agent/` (o incluirla en el settings de `gentle-pi`), permitiendo que los usuarios de `gentle-pi` y `gentle-shell` disfruten del mismo selector jerárquico con indicador de corona `👑` para la cuenta principal activa.
4. **Documentar la Convención Visual para el Usuario**:
   - Explicar en la documentación operativa que el ícono `👑 ` indica que la llamada viaja por la **cuenta activa principal del pool de rotación**, y que en caso de rotación (429), la nueva cuenta promovida heredará inmediatamente la corona sin requerir reconfiguración manual.
