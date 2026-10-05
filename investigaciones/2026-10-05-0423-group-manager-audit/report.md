# Auditoría Crítica y Juicio CTO de GroupManager: Flujo de Estructuración de Grupo & Pool

## Executive Summary

Esta auditoría técnica y de experiencia de usuario (UX) analiza de manera exhaustiva el flujo de **"Estructuración de Grupo & Pool"** dentro del componente `GroupManager.jsx` [S-001] y su interacción con el backend en Go (`virtualize.go`) [S-003] y el cliente de gestión (`managementClient.js`) [S-004].

El análisis revela inconsistencias cognitivas críticas, fallos de cálculo de capacidad y una desconexión arquitectónica de severidad P0:

1. **Desconexión Arquitectónica P0 (Falsa exclusión en cuentas físicas):** Las dos casillas de política de modelo (`excludeVersion55` y `disableIsolation`) únicamente tienen efecto operativo sobre **cuentas virtualizadas** (clonadas vía `virtualizeAccount` / `virtualize.go`). Cuando el usuario arma un pool utilizando cuentas físicas libres (`updates`), el cliente ejecuta `saveAuthFilePrefixes`, el cual únicamente envía `{ name, prefix }` a CLIProxyAPI [S-004]. En consecuencia, en cuentas físicas las versiones 5.5 **nunca son excluidas en disco**, a pesar de que el usuario marcó la casilla y la UI posterior enmascara falsamente las rutas 5.5 en la columna de vista previa.
2. **Disonancia Cognitiva en Métricas de Capacidad (P1):** Cuando todas las cuentas Antigravity están asignadas a una familia hermana (por ejemplo `agy` o `agy_clau`), el badge de métricas reporta: `Cuentas compatibles libres: 0 · Capacidad máxima: 0 grupo(s) de rotación · Virtualizables del paquete: 4`. El usuario interpreta que es imposible crear el grupo ("Capacidad máxima: 0"), a pesar de que el selector inferior ofrece de inmediato 4 cuentas virtualizables para actuar como líder y reservas en cascada [S-001].
3. **Sobreescritura destructiva de entrada del usuario (P1):** Si el usuario escribe manualmente un prefijo en el campo de texto y posteriormente selecciona una cuenta líder que proviene del pool de virtualización, `handleSelectActiveNode` sobrescribe inmediatamente el texto del usuario con una sugerencia automática autoincrementada (`suggestNextBasePrefix`), destruyendo la intención del operador sin confirmación [S-001].
4. **Copywriting desfasado y notas estáticas contradictorias (P2):** El chip de familia superior mantiene el texto arcaico `Gemini: agy* · Claude: agy_clau*` ignorando los nuevos subtipos `agy_son*` y `agy_opus*`. Adicionalmente, al activar la casilla "Excluir versiones 5.5", la nota informativa de Claude Opus continúa diciendo estáticamente *"con claude-opus-4-6-thinking y claude-opus-5-5-high"*, contradiciendo en pantalla la selección activa del usuario.
5. **Fricción en el Modelo Mental de Edición vs. Creación (P3):** El formulario está concebido exclusivamente como creación inicial (`Armar Nuevo Pool`). Si un usuario ya posee un pool `agy_opus` y desea reconfigurarlo o rearmarlo, el sistema sugiere `agy_opus2` y bloquea cualquier intento de escribir `agy_opus` con un error de colisión, forzando un flujo destructivo de "Disolver primero en otra pestaña para poder rearmar".

---

## Research Question

¿Cuáles son las fallas semánticas, disonancias lógicas de capacidad, incoherencias de reactividad de interfaz y desalineaciones arquitectónicas entre el frontend `GroupManager.jsx` y el motor backend `virtualize.go` al estructurar pools especializados de modelos (como Claude Opus, Sonnet y Gemini), y cómo resolverlas bajo un enfoque estricto de mínima ingeniería (KISS / YAGNI)?

---

## Recommendation or Answer

Se recomienda una intervención quirúrgica focalizada en el frontend (`GroupManager.jsx`) y en la alineación del contrato con el backend, sin introducir abstracciones innecesarias ni reescribir flujos consolidados:

1. **Unificar la fórmula de capacidad máxima:** `Capacidad máxima = Math.floor((cuentasLibres + cuentasVirtualizables) / 2)`. Presentar claramente: `Cuentas disponibles: X (Y libres + Z virtualizables) · Capacidad: K grupo(s)`.
2. **Condicionar reactivamente las casillas de política:**
   - Ocultar `excludeVersion55` cuando la familia seleccionada sea `gemini_pure` o `codex`, ya que dichas familias no poseen versiones 5.5.
   - Si se opera sobre cuentas físicas y el backend no admite `excluded_models` en `PATCH /v0/management/auth-files`, advertir explícitamente al usuario o condicionar la exclusión a clones virtualizados.
3. **Dinamizar las notas informativas según el estado de las casillas:** El texto descriptivo debe reflejar reactivamente si la versión 5.5 está excluida o activa.
4. **Preservar el prefijo escrito por el usuario en `handleSelectActiveNode`:** No sobreescribir el input de prefijo si el usuario ya ha introducido un valor no vacío.
5. **Actualizar el hint textual del chip de familia:** Cambiar `Gemini: agy* · Claude: agy_clau*` por `Gemini: agy* · Claude: agy_son*, agy_opus*, agy_clau*`.
6. **Orientar al usuario ante prefijos existentes:** Si el prefijo base existe (ej. `agy_opus`), mostrar una alerta contextual: *"El pool agy_opus ya existe. Sugiriendo agy_opus2 para un pool adicional, o ve a Disolver si deseas rearmar el existente"*.

---

## Key Findings

### Categoría 1: Semántica, Copywriting y Fricción Cognitiva de UI

#### 1.1. Hint arcaico e incompleto en el selector de familia principal
- **Ubicación:** `GroupManager.jsx` (línea 865) [S-001].
- **Código actual:**
  ```jsx
  <span className="group-family-hint">
    {key === 'gemini' ? 'Gemini: agy* · Claude: agy_clau*' : `prefijo ${fam.hintPrefix}*`}
  </span>
  ```
- **Problema:** Tras la evolución de la arquitectura de cuotas documentada en `mem:1639` [S-006], la familia Antigravity se subdividió en cuatro subtipos (`pure` -> `agy`, `sonnet` -> `agy_son`, `opus` -> `agy_opus`, `claude` -> `agy_clau`). El hint del botón principal sigue mostrando `Claude: agy_clau*`. Esto desorienta al usuario que busca configurar pools dedicados para Opus o Sonnet, haciéndole dudar de si ha entrado en la categoría correcta antes de hacer clic.

#### 1.2. Contradicción directa entre nota estática y casilla de política
- **Ubicación:** `MODEL_FAMILIES.gemini.subtypes.opus.note` vs. renderizado en línea 921 [S-001].
- **Texto en pantalla cuando `excludeVersion55` está activado:**
  - Casilla: `[X] Excluir versiones 5.5 (Mantener solo versión 4.6 / Estable sin duplicidad)`
  - Nota inmediatamente superior: `ℹ️ Pool de razonamiento profundo con claude-opus-4-6-thinking y claude-opus-5-5-high. Convención: agy_opus, agy_opus2...`
- **Problema:** La nota es una cadena estática. Al marcar la casilla de exclusión, la interfaz no reacciona, presentando una afirmación explícitamente contradictoria. El operador técnico asume que la casilla fue ignorada o que la configuración no tendrá efecto.

#### 1.3. Modelo mental de Edición vs. Creación y sugerencia de `agy_opus2`
- **Ubicación:** `suggestNextBasePrefix` (línea 123) y `familyMismatch` (línea 360) [S-001].
- **Problema:** En el flujo actual, cuando existe un pool previo `agy_opus`, la UI sugiere automáticamente `agy_opus2`. Si la intención del usuario es modificar, ampliar reservas o cambiar la política de `agy_opus`, borra el `2` y escribe `agy_opus`. De inmediato recibe el error:
  `⚠️ El prefijo "agy_opus" ya está asignado a otra cuenta. Elige el siguiente libre (ej. agy_opus2).`
- El componente no ofrece una vía de edición ni clarifica que los pools son inmutables en esta pantalla. El operador se ve obligado a deducir que debe ir a la pestaña "Disolver / Desagrupar Pools", borrar el pool en producción y volver a empezar.

---

### Categoría 2: Lógica de Capacidad y Métricas en Tiempo Real

#### 2.1. El badge de capacidad ignora las cuentas virtualizables
- **Ubicación:** `GroupManager.jsx` (líneas 970–979) [S-001]:
  ```jsx
  {family && (
    <div className="group-capacity-badge" data-testid="capacity-badge">
      <span>📊 Cuentas compatibles libres: <strong>{familyCompatibleNodes.length}</strong></span>
      <span> · Capacidad máxima: <strong>{Math.floor(familyCompatibleNodes.length / 2)}</strong> grupo(s) de rotación (mínimo 2 cuentas/grupo)</span>
      {isGeminiPackageFamily && (
        <span> · 🔀 Virtualizables del paquete: <strong>{virtualizableSourceNodes.length}</strong></span>
      )}
    </div>
  )}
  ```
- **El caso de prueba real:**
  - 4 cuentas Antigravity asignadas actualmente a `agy` (Gemini puro) [S-006].
  - Cuentas físicas libres: 0 (`familyCompatibleNodes.length === 0`).
  - Cuentas virtualizables hacia Claude Opus: 4 (`virtualizableSourceNodes.length === 4`).
- **Resultado en pantalla:**
  `📊 Cuentas compatibles libres: 0 · Capacidad máxima: 0 grupo(s) de rotación (mínimo 2 cuentas/grupo) · 🔀 Virtualizables del paquete: 4`
- **Impacto:** "Capacidad máxima: 0" es falso. Justo debajo del badge, el desplegable de Cuenta Principal contiene 4 cuentas candidatas (`leaderCandidates`) y la lista de reservas contiene las 3 restantes (`reserveCandidates`). La capacidad máxima real es de **2 grupos de 2 cuentas** o **1 grupo robusto de 4 cuentas**. Informar capacidad cero induce a creer que el sistema está bloqueado o que faltan licencias.

---

### Categoría 3: Reactividad de UI y Aplicabilidad de Políticas de Modelo

#### 3.1. Fugas de abstracción: casillas mostradas donde no aplican
- **Ubicación:** `group-model-policy-card` (líneas 926–968) [S-001].
- **Problema:** La tarjeta de políticas se renderiza incondicionalmente para cualquier `family` seleccionada:
  1. **Familia Gemini Puro (`gemini_pure`):** Google Cloud Code sirve `gemini-2.5-pro`, `gemini-3.7-flash-high`, `gemini-3.8-flash-high` [S-005]. No existe ninguna versión 5.5. Ofrecer "Excluir versiones 5.5" en Gemini Puro es un absurdo técnico que confunde al administrador.
  2. **Familia Codex (`codex`):** El catálogo de OpenAI/Codex ofrece `gpt-5.6-codex` o modelos GPT [S-005]. La casilla 5.5 no tiene significado alguno.
- **Sobrecarga de `disableIsolation`:** "Modo Comodín / Servir todas las familias sin bloqueo". Al armar un pool de Gemini, desactivar el aislamiento permite que clientes con prefijo `agy/` consuman modelos Claude y GPT. Como la cuota de Antigravity en Google Cloud Code separa estrictamente el balde de Gemini del balde de Claude/GPT [S-005, S-006], el modo comodín provoca que peticiones descontroladas agoten cuotas ajenas sin advertencia clara de riesgo.

#### 3.2. Sobreescritura no solicitada del prefijo introducido (Input Clobbering)
- **Ubicación:** `handleSelectActiveNode` (líneas 444–451) [S-001]:
  ```javascript
  if (chosenNode && isVirtualSource(chosenNode)) {
    if (effectiveFamily) {
      setGroupBasePrefix(suggestNextBasePrefix(nodes, effectiveFamily.hintPrefix));
    }
    return;
  }
  ```
- **Problema:** Si el usuario primero escribió cuidadosamente un prefijo deseado (por ejemplo `agy_opus_lab`), y luego hace clic en el selector para designar la cuenta líder, esta función detecta que el nodo es virtual y **machaca** el campo de texto con la sugerencia por defecto (`agy_opus` o `agy_opus2`), forzando al usuario a volver a escribir su prefijo.

---

### Categoría 4: Armonía Backend / Frontend y Disconexión Arquitectónica

#### 4.1. FALLA CRÍTICA: Las casillas de política son inertes para cuentas físicas
- **Ubicación:** `handleCreateGroup` en `GroupManager.jsx` (líneas 524–572) [S-001] vs `managementClient.js` [S-004] vs `virtualize.go` [S-003].
- **Mecanismo:**
  1. Cuando un nodo **no** es virtual (`!isVirtualSource(node)`), se encola en `updates`:
     ```javascript
     updates.push({ name: node.data.fileName, prefix });
     ```
  2. Luego se despacha a:
     ```javascript
     const patchReport = updates.length > 0
       ? await saveAuthFilePrefixes(updates)
       : { successful: [], failed: [] };
     ```
  3. En `managementClient.js` [S-004], `saveAuthFilePrefixes` invoca `patchAuthFilePrefix`, que envía exclusivamente:
     ```javascript
     const body = JSON.stringify({ name: exactName, prefix: cleanPrefix });
     PATCH /v0/management/auth-files
     ```
  4. El endpoint estándar de CLIProxyAPI **no recibe ni procesa** `excluded_models`.
  5. En cambio, únicamente las cuentas que entran por `virtualJobs` invocan `virtualizeAccount` hacia `/v0/management/visual-profile/virtualize` [S-003], donde el plugin Go ejecuta `computeVirtualExclusions` y escribe `metadata["excluded_models"]`.
- **Impacto Operativo:**
  - Si un usuario tiene cuentas físicas libres y estructura un pool marcando "Excluir versiones 5.5", la petición se completa con éxito (`✅ Pool creado`), pero el archivo de autenticación físico **nunca recibe la exclusión de 5.5**.
  - Además, la interfaz realiza un falso positivo visual: la lista de rutas mostrada al finalizar (`modelRoutes`) se filtra en el cliente con `matchesFamilyModel(trimmedBase, id, excludeVersion55)` [S-001], ocultando la ruta 5.5 de la vista. El usuario queda convencido de que 5.5 está excluido, cuando en realidad CLIProxyAPI seguirá sirviendo peticiones a `claude-opus-5-5-high`.

---

## Matriz de Severidad

| ID | Hallazgo | Severidad | Impacto | Componente Afectado |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | Políticas de exclusión (`excludeVersion55`) son ignoradas en cuentas físicas pero simuladas en la UI | **P0 (Crítico)** | Falsa sensación de aislamiento; cuentas físicas siguen respondiendo a modelos teóricamente bloqueados | `GroupManager.jsx`, `managementClient.js` |
| **UX-01** | Badge de capacidad marca "Capacidad máxima: 0" teniendo 4 cuentas virtualizables operativas | **P1 (Alto)** | Parálisis en la toma de decisiones del operador; contradicción entre métrica y desplegables | `GroupManager.jsx` (línea 972) |
| **UX-02** | Sobreescritura destructiva del input de prefijo al elegir cuenta líder virtual | **P1 (Alto)** | Pérdida de datos introducidos por el usuario; frustración de interfaz | `GroupManager.jsx` (línea 444) |
| **SEM-01**| Nota estática informativa contradice el estado del checkbox de exclusión 5.5 | **P2 (Medio)** | Pérdida de confianza en la configuración activa en pantalla | `GroupManager.jsx` (línea 921) |
| **UI-01**  | Casillas de versión 5.5 mostradas en familias donde no existen (Gemini y Codex) | **P2 (Medio)** | Ruido visual y confusión semántica sobre modelos inexistentes | `GroupManager.jsx` (línea 926) |
| **SEM-02**| Hint del botón principal Antigravity desactualizado (`Gemini: agy* · Claude: agy_clau*`) | **P2 (Medio)** | Visibilidad nula de los subtipos `agy_son*` y `agy_opus*` en primer nivel | `GroupManager.jsx` (línea 865) |
| **ARC-01**| Sugerencia forzada de `agy_opus2` por falta de flujo de rearmado/edición de pools | **P3 (Bajo)** | Fricción operativa que obliga a disolver manualmente para reconfigurar | `GroupManager.jsx` (líneas 123, 360) |

---

## Evidence Review

### Evidencia de la Falla en el Cálculo de Capacidad (UX-01)
En `GroupManager.jsx` [S-001]:
- `freeNodes` filtra únicamente cuentas con prefijo vacío o `unlinked_` (línea 168).
- `familyCompatibleNodes` filtra sobre `freeNodes` (línea 204).
- En el badge (líneas 971–974):
  `Capacidad máxima: Math.floor(familyCompatibleNodes.length / 2)`
- Si hay 0 cuentas libres físicas pero 4 cuentas Antigravity asignadas a Gemini (`agy`), `familyCompatibleNodes.length` es 0. La capacidad mostrada es 0.
- Sin embargo, `leaderCandidates` (línea 291) concatena:
  `[...familyCompatibleNodes, ...virtualizableSourceNodes]`.
  Ambos grupos de cuentas son técnicamente aptos para conformar pools mediante clonación en el backend [S-003]. La capacidad real debe reflejar los candidatos totales disponibles.

### Evidencia de la Desconexión de Políticas en Cuentas Físicas (SEC-01)
En `GroupManager.jsx` [S-001]:
- Líneas 519–527:
  ```javascript
  const queueAssignment = (node, prefix) => {
    if (isVirtualSource(node)) {
      virtualJobs.push({ sourceFile: node.data.fileName, prefix, email: node.data.email });
    } else {
      updates.push({ name: node.data.fileName, prefix });
    }
  };
  ```
- Líneas 570–574:
  ```javascript
  const patchReport = updates.length > 0
    ? await saveAuthFilePrefixes(updates)
    : { successful: [], failed: [] };
  ```
- En `managementClient.js` [S-004] (líneas 700–740):
  El método `patchAuthFilePrefix` solo envía `{ name, prefix }`. El endpoint de la API de gestión no recibe `targetModels`, `oppositeModels` ni `excluded_models`.
- En `virtualize.go` [S-003] (líneas 83–95):
  La exclusión de modelos reside únicamente dentro del método `Virtualize`, aplicable solo a llamadas POST a `/v0/management/visual-profile/virtualize`.
- **Conclusión:** Para cuentas físicas, las casillas de política son totalmente inoperantes en el almacenamiento persistente.

### Evidencia del Input Clobbering (UX-02)
En `GroupManager.jsx` [S-001] (líneas 444–450):
```javascript
if (chosenNode && isVirtualSource(chosenNode)) {
  if (effectiveFamily) {
    setGroupBasePrefix(suggestNextBasePrefix(nodes, effectiveFamily.hintPrefix));
  }
  return;
}
```
Si el usuario introduce en el input un prefijo personalizado y luego elige la cuenta líder, esta guarda se ejecuta incondicionalmente, sustituyendo el valor del estado `groupBasePrefix` sin comprobar si ya contenía una entrada intencional del usuario.

---

## Trade-offs and Risks

1. **Soporte de `excluded_models` en cuentas físicas vs. Virtualización pura:**
   - *Riesgo:* Intentar modificar la API nativa de CPAMC `/v0/management/auth-files` para aceptar `excluded_models` en llamadas `PATCH` requeriría modificar el binario central de CLIProxyAPI fuera del plugin, violando el principio de diseño no invasivo del proyecto.
   - *Solución recomendada (KISS):* Si el pool contiene cuentas físicas y se seleccionan exclusiones de modelos, el plugin puede utilizar la virtualización para crear credenciales aisladas, o bien la UI debe deshabilitar la casilla en cuentas físicas con una explicación clara: *"La exclusión granular de modelos requiere clonación virtualizada"*.
2. **Capacidad compartida entre múltiples pools:**
   - *Trade-off:* Una cuenta Antigravity asignada a `agy` puede ser virtualizada para `agy_son` y para `agy_opus` simultáneamente (generando clones con distintos prefijos en `/root/.cli-proxy-api/`). Calcular la capacidad máxima combinando físicas y virtualizables debe ser claro para no dar a entender que las cuentas se multiplican físicamente.

---

## Alternatives Considered

1. **Reescribir el gestor para incluir pestañas de "Editar / Reconfigurar Pool":**
   - *Descartada por sobreingeniería inmediata:* Violaría la regla KISS / YAGNI del skill `anti-overengineering`. En este momento, el ciclo de vida actual de CPAMC funciona limpiamente con disolución y creación atómica de credenciales. Basta con mejorar los mensajes de colisión e indicar al usuario cómo rearmar el pool existente.
2. **Forzar siempre la virtualización de todas las cuentas (incluso libres):**
   - *Descartada:* Si una cuenta está 100% libre, asignar su prefijo físico directo es el camino más limpio y evita la proliferación de archivos clonados (`.json.agy_xxx.json`) en el disco del contenedor.

---

## Unknowns and Limits

- **Límites de concurrencia en clones virtuales:** Si una misma cuenta física es virtualizada en 3 pools distintos (`agy`, `agy_son`, `agy_opus`), todas comparten la cuota física semanal ante Google Cloud Code [S-005, S-006]. La interfaz no muestra una advertencia de saturación cruzada si el usuario virtualiza la misma cuenta en múltiples pools que compiten por el mismo bucket de cuota.
- **Soporte de exclusión en CLIProxyAPI core:** Se asume como límite conocido que `PATCH /v0/management/auth-files` no admite el campo `excluded_models`, delegando dicha responsabilidad al motor del plugin `virtualize.go`.

---

## Recommended Next Actions

Para subsanar los hallazgos con máxima eficiencia y mínima perturbación del código base:

1. **Corrección de Lógica de Capacidad (`GroupManager.jsx`):**
   - Modificar el cálculo del badge de capacidad para computar:
     ```javascript
     const totalEligibleCount = familyCompatibleNodes.length + virtualizableSourceNodes.length;
     const maxGroups = Math.floor(totalEligibleCount / 2);
     ```
   - Actualizar el texto del badge:
     `📊 Cuentas disponibles: ${totalEligibleCount} (${familyCompatibleNodes.length} libres, ${virtualizableSourceNodes.length} virtualizables) · Capacidad máx: ${maxGroups} grupo(s)`
2. **Corrección de Input Clobbering (`GroupManager.jsx`):**
   - En `handleSelectActiveNode`, condicionar la sugerencia automática:
     ```javascript
     if (chosenNode && isVirtualSource(chosenNode)) {
       if (effectiveFamily && !groupBasePrefix.trim()) {
         setGroupBasePrefix(suggestNextBasePrefix(nodes, effectiveFamily.hintPrefix));
       }
       return;
     }
     ```
3. **Condicionamiento Reactivo de Políticas de Modelo:**
   - Renderizar `excludeVersion55` únicamente cuando la familia activa sea `gemini_sonnet`, `gemini_opus`, `gemini_claude` o `claude`.
   - Dinamizar la nota explicativa de `effectiveFamily.note`: si `excludeVersion55` está activo, concatenar `(versiones 5.5 excluidas)`.
4. **Actualización de Copywriting de Familia Principal:**
   - En `MODEL_FAMILIES.gemini`, actualizar el hint a:
     `Gemini: agy* · Claude: agy_son*, agy_opus*, agy_clau*`
5. **Mitigación Arquitectónica de Cuentas Físicas vs Exclusiones:**
   - Si se marcan políticas de filtrado (`excludeVersion55` o `disableIsolation`) y las cuentas seleccionadas no son virtuales, mostrar un aviso informativo en el banner de preparación del pool alertando sobre el comportamiento en cuentas físicas.
