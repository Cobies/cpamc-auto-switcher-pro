# Lógica Arquitectónica: Archivos de Autenticación CPAMC, Virtualización de Cuentas y Modelo de Tarjetas 2N

## Executive Summary

La infraestructura de **CLIProxyAPI (CPAMC)** y el plugin **Auto Switcher Pro (Visual Profile)** administran credenciales OAuth mediante dos capas: la **capa física de disco CPAMC** (`/root/.cli-proxy-api/*.json`) y la **capa de abstracción lógica de tarjetas ($N \to 2N$)** en el plugin.

Tras la inspección del código fuente en `GroupManager.jsx`, `managementClient.js`, `AutoAuthFiles.jsx` e `internal/plugin/virtualize.go`, se concluye lo siguiente:

1. **Por qué `GroupManager` crea archivos virtualizados en disco:** El motor Go nativo de CPAMC lee la configuración de enrutamiento (`prefix`) e imponen límites de cuota y exclusión de modelos (`excluded_models`) directamente desde archivos `.json` en `/root/.cli-proxy-api/` [S-001, S-005, S-008]. Para que una misma cuenta física de Google/Antigravity sirva simultáneamente a pools de Gemini (`agy`) y Claude (`agy_son`) sin mezclar sus reglas de enrutamiento ni contadores de peticiones, CPAMC requiere un archivo `.json` independiente en disco para cada prefijo activo [S-001, S-006].
2. **Visualización en "Auth Files" nativo de CPAMC:** El menú nativo de CPAMC lee directamente el directorio `/root/.cli-proxy-api/` (`GET /v0/management/auth-files`) sin discernir entre archivos maestros físicos y clones virtuales [S-002, S-008]. Por lo tanto, tener 4 cuentas maestras activas en Gemini y 4 clones virtuales activos en Claude genera **8 archivos `.json` en disco**, los cuales son listados en su totalidad por la API nativa de CPAMC [S-004, S-007].
3. **Falla arquitectónica actual en `GroupManager` (Clone Sprawl):** Al crear o reconfigurar un pool en "Crear Group/Perfiles", `GroupManager.jsx` evalúa la propiedad `isVirtualSource` como `true` para todas las asignaciones a pools de Claude, e invoca incondicionalmente a `virtualizeAccount` [S-003]. Esto provoca la creación/sobrescritura redundante de archivos `.json` en disco en lugar de **reutilizar los archivos virtuales ya existentes** en el modelo 2N mediante simples peticiones `PATCH` (`saveAuthFilePrefixes`) [S-002, S-003].
4. **Mapeo Ideal $N \to 2N$ sin acumulación de clones:**
   - **$N$ Cuentas Maestras Físicas (`antigravity-<email>.json`):** Mapean 1:1 a las **$N$ Tarjetas Gemini**. Se editan in situ vía `PATCH` sin clonación en disco.
   - **$N$ Cuentas Virtuales Derivadas (`antigravity-<email>.<prefix>.json`):** Mapean 1:1 a las **$N$ Tarjetas Claude**. Se crean una única vez vía `virtualizeAccount` al ser asignadas a Claude por primera vez, se actualizan vía `PATCH` al cambiar de prefijo Claude, y se eliminan del disco (`deleteAuthFile`) al disolver el pool o desasignar la tarjeta [S-002, S-004].

---

## Research Question

¿Cuál es la relación arquitectónica correcta entre los archivos `.json` físicos en `/root/.cli-proxy-api/`, las tarjetas gestionadas en el modelo 2N de Auto Auth Files, y la creación de pools en "Crear Group/Perfiles" (GroupManager), y cómo debe operar la virtualización para evitar la proliferación de archivos duplicados en disco?

---

## Recommendation or Answer

1. **Reutilización Obligatoria de Tarjetas Existentes (Virtualization Guard):** Modificar `GroupManager.jsx` para que verifique si la cuenta seleccionada ya posee un archivo virtual derivado activo en disco. Si el archivo virtual ya existe, se debe actualizar su prefijo mediante `PATCH` (`saveAuthFilePrefixes`) en lugar de invocar `virtualizeAccount` [S-002, S-003].
2. **Nomenclatura Determinista de Archivos Virtuales:** Garantizar que cada cuenta maestra física `$N$` genere a lo sumo **un archivo virtual derivado activo por familia** (p.ej., `antigravity-user@gmail.com.agy_son.json`), evitando la creación de sufijos volátiles o duplicados (`.agy_son_1.json`, `.agy_sonnet.json`) [S-001, S-002].
3. **Gestión de Ciclo de Vida y Limpieza Automática:**
   - **Asignación:** Si la tarjeta Claude no existe en disco al crear un pool de Claude, se llama a `virtualizeAccount` para crear el archivo virtual derivado.
   - **Reasignación:** Si la tarjeta Claude ya existe en disco, se actualiza su prefijo con `PATCH`.
   - **Disolución:** Al disolver un pool de Claude en `GroupManager`, se eliminan físicamente los archivos virtuales derivados del disco mediante `deleteAuthFile` [S-002, S-003].
4. **Respetar el Límite Estricto de $2N$ Archivos en Disco:** Para $N=4$ cuentas maestras de Antigravity, el estado productivo completo (4 Gemini + 4 Claude) debe contener exactamente **8 archivos `.json` en disco** [S-004, S-007]. El panel "Auto Auth Files" de Auto Switcher Pro continuará agrupando estos 8 archivos en 4 Gemini Cards y 4 Claude Cards para mantener una vista limpia y trazable [S-004].

---

## Key Findings

### 1. Por qué CPAMC Requiere Archivos Virtuales Físicos en Disco

El motor C/Go de CPAMC (`cmd/cli-proxy-api`) no posee un mecanismo de alias en memoria para asociar múltiples prefijos de enrutamiento o listas de exclusión de modelos a una sola credencial OAuth [S-005, S-008]. 

El flujo de procesamiento de peticiones en CPAMC funciona de la siguiente manera:
- Al arrancar o recibir cambios en el sistema de archivos (`fsnotify`), CPAMC escanea el directorio `/root/.cli-proxy-api/*.json` [S-005, S-008].
- Cada archivo `.json` es parseado de forma independiente e instanciado en el runtime con su respectivo campo `prefix` y su arreglo `excluded_models` [S-001, S-005].
- Para que las peticiones destinadas a Claude (`agy_son`, `agy_opus`) usen las cuotas de Google Cloud Code sin interferir con el grupo de rotación de Gemini (`agy`), CPAMC necesita leer un archivo `.json` que contenga explícitamente `prefix: "agy_son"` y las exclusiones de modelos correspondientes a Gemini [S-001, S-006].

Por lo tanto, la virtualización mediante `virtualizeAccount` no es una duplicación arbitraria de la interfaz gráfica, sino una **necesidad técnica del motor backend de CPAMC** para instanciar el canal de enrutamiento de Claude [S-001, S-005].

---

### 2. Comportamiento del Menú Nativo "Auth Files Management" vs. Auto Switcher Pro

- **API Nativa de CPAMC (`GET /v0/management/auth-files`):** Realiza un listado directo de todos los archivos `.json` presentes en `/root/.cli-proxy-api/` [S-002, S-008]. Para el motor nativo de CPAMC, no existe el concepto de "cuenta maestra" vs. "cuenta virtual"; cada archivo en disco es una credencial de ejecución independiente.
- **Auto Switcher Pro (Visual Profile):** Implementa el **Modelo de Tarjetas Gestionadas $N \to 2N$** (`buildManagedPoolCards` en `managementClient.js`) [S-002, S-004]. La función clasifica los archivos de disco analizando el nombre de archivo y la propiedad `masterOrigin` [S-002]:
  - Si el archivo es físico (`antigravity-user@gmail.com.json`), lo asigna a la **Gemini Card**.
  - Si el archivo es un clon derivado (`antigravity-user@gmail.com.agy_son.json`), lo asigna a la **Claude Card** correspondiente a la misma cuenta física.

Esto explica por qué el menú nativo de CPAMC muestra 8 archivos `.json` mientras que el panel Auto Auth Files de Auto Switcher Pro los presenta ordenadamente como 4 Gemini Cards + 4 Claude Cards [S-004, S-007].

---

### 3. Causa Raíz de la Proliferación de Archivos (Clone Sprawl en GroupManager)

Al inspeccionar `GroupManager.jsx` (líneas 290–330 y 550–575), se descubrió la causa exacta por la cual la creación de pools generaba acumulación de archivos en disco [S-003]:

```javascript
// GroupManager.jsx: isVirtualSource evalúa incondicionalmente true para pools no-Gemini
const isVirtualSource = useCallback(
  (node) => {
    if (!isGeminiPackageFamily || !node) return false;
    return effectiveFamily?.key !== 'gemini_pure';
  },
  [isGeminiPackageFamily, effectiveFamily]
);
```

Cuando el usuario crea un pool para Claude (p.ej., `agy_son`), `handleCreateGroup` ejecuta:

```javascript
const queueAssignment = (node, prefix) => {
  if (isVirtualSource(node)) {
    const classification = classifyAuthAccount(node);
    const sourceFile = classification.masterOrigin || node.data.fileName;
    virtualJobs.push({ sourceFile, prefix, email: node.data.email });
  } else {
    updates.push({ name: node.data.fileName, prefix });
  }
};
```

**Diagnóstico del Problema:**
1. Dado que `isVirtualSource` devuelve `true` para **cualquier** cuenta seleccionada en una familia de Claude, `GroupManager` siempre empuja la operación a `virtualJobs` e invoca `virtualizeAccount` [S-003].
2. Si la tarjeta virtual **ya existía en disco** (por ejemplo, `antigravity-infosoytec@gmail.com.agy_son.json`), en lugar de actualizar su prefijo con un simple `PATCH` (`updates.push`), `GroupManager` solicita al plugin Go clonar nuevamente la cuenta maestra física [S-001, S-003].
3. Si el nombre del nuevo pool o sufijo varía (p.ej., asignación manual de prefijos o pools secundarios), se genera un nuevo archivo `.json` en disco sin eliminar el anterior, causando que la cantidad de archivos crezca progresivamente de 8 a 12 o 16 archivos en `/root/.cli-proxy-api/` [S-007].

---

## Evidence Review

| Componente / Archivo | Función / Mecanismo | Comportamiento Actual | Comportamiento Ideal (Propuesto) |
| :--- | :--- | :--- | :--- |
| `internal/plugin/virtualize.go` | Cgo HostCall `Virtualize()` [S-001] | Clona el JSON fuente en `<base>.<prefix>.json` llamando a `host.auth.save`. | Mantener igual (creación de archivos en disco bajo demanda). |
| `managementClient.js` | `buildManagedPoolCards()` [S-002] | Consolida $N$ maestros y sus clones derivados en $2N$ tarjetas ordenadas. | Mantener igual (excelente abstracción $N \to 2N$). |
| `GroupManager.jsx` | `handleCreateGroup()` [S-003] | Invoca `virtualizeAccount` para toda cuenta en pools de Claude, ignorando clones existentes. | Comprobar si la tarjeta virtual existe: usar `PATCH` si existe, o `virtualizeAccount` si es nueva. |
| `GroupManager.jsx` | `handleDissolvePool()` [S-003] | Elimina archivos virtuales de disco al disolver pools de Claude mediante `deleteAuthFile`. | Mantener igual (limpieza correcta tras disolución). |
| `AutoAuthFiles.jsx` | `metric-orphan-clones` [S-004] | Detecta y purga clones residuales sin prefijo en 1 clic. | Mantener igual (red de seguridad para limpieza). |

---

## Trade-offs and Risks

1. **Riesgo de Modificación en `GroupManager.jsx`:**
   - *Riesgo:* Si se deshabilita la virtualización por completo, CPAMC no podrá aplicar exclusiones de modelos distintas para Gemini y Claude sobre la misma cuenta física de Antigravity [S-001, S-005].
   - *Mitigación:* No eliminar la virtualización, sino **condicionarla**: virtualizar solo cuando el archivo virtual derivado no exista previamente en disco.

2. **Sincronización con el runtime de CPAMC:**
   - *Riesgo:* Las peticiones `PATCH` (`saveAuthFilePrefixes`) sobre archivos virtuales existentes dependen del watcher `fsnotify` de CPAMC para re-sintetizar el runtime en ~1–2 segundos [S-005].
   - *Mitigación:* El cliente API ya incluye reintentos y recarga de catálogo tras la edición [S-002].

3. **Disolución e Inconsistencias de Estado:**
   - *Riesgo:* Si un usuario borra manualmente un pool desde otra extensión o edita el archivo en disco sin pasar por el plugin, pueden quedar clones huérfanos.
   - *Mitigación:* El panel "Auto Auth Files" posee el detector de clones huérfanos (`metric-orphan-clones`) que permite purgar en un solo clic cualquier archivo desasociado [S-004].

---

## Alternatives Considered

### Alternativa A: No crear archivos virtualizados en disco (Rechazada)
- **Idea:** Modificar el core de CPAMC para que un único archivo `.json` soporte múltiples prefijos en memoria (p.ej., `prefixes: ["agy", "agy_son"]`).
- **Por qué se rechazó:** Requeriría modificar el binario Go nativo de CPAMC (`cmd/cli-proxy-api`), rompiendo la compatibilidad con actualizaciones oficiales del proxy y violando el principio de diseño no intrusivo del plugin Visual Profile [S-005].

### Alternativa B: Reutilizar tarjetas $2N$ existentes vía `PATCH` en GroupManager (RECOMENDADA)
- **Idea:** Hacer que `GroupManager` respete el modelo $2N$. Al asignar una cuenta física a un pool de Claude, verifica si su tarjeta virtual derivada ya existe en disco (`virtualFileName`). Si existe, envía un `PATCH` a su archivo `.json`; si no existe, invoca `virtualizeAccount` para crearla [S-002, S-003].
- **Ventaja:** Garantiza exactamente **8 archivos en disco** para 4 cuentas maestras ($2N$), elimina el crecimiento descontrolado de clones y reutiliza la infraestructura probada de Auto Switcher Pro [S-004, S-007].

---

## Unknowns and Limits

- **Límite de la API Nativa de CPAMC:** El menú nativo "Auth Files Management" de CPAMC seguirá mostrando los 8 archivos `.json` (o el total de $2N$ archivos en disco) debido a que su endpoint realiza un `readdir` directo de `/root/.cli-proxy-api/` [S-008]. Esto no es un error, sino la representación real del sistema de archivos. La vista simplificada $2N$ está disponible en el sub-tab "Auto Auth Files" de Auto Switcher Pro [S-004].
- **Cuentas de proveedores no-Antigravity:** Cuentas como OpenAI Codex o Anthropic directa no requieren virtualización multi-familia ya que no comparten modelos heterogéneos bajo la misma credencial [S-002].

---

## Recommended Next Actions

1. **Actualizar la Lógica de Asignación en `GroupManager.jsx`:**
   - Refactorizar `queueAssignment` en `GroupManager.jsx` para evaluar si la cuenta elegida ya dispone de un `virtualFileName` asociado en `managedCards`.
   - Si `virtualFileName` existe, agregar a `updates` (para ejecución vía `saveAuthFilePrefixes` con `PATCH`).
   - Si `virtualFileName` no existe, agregar a `virtualJobs` (para ejecución vía `virtualizeAccount`).

2. **Validar la Suite de Pruebas Vitest:**
   - Ejecutar `cd plugins/visual-profile/web && npm test -- --run` para verificar que los 339 tests unitarios e integración permanezcan en verde tras el ajuste de `GroupManager`.

3. **Verificación en Producción:**
   - Confirmar que al crear o reconfigurar pools de Claude (`agy_son`), el conteo total de archivos `.json` en `/root/.cli-proxy-api/` se mantenga estrictamente en **8 archivos** (para 4 cuentas maestras físicamente autenticadas).
