# Desincronización Visual y Lógica: Banner de Tarjeta en AutoAuthFiles vs Tuerca de Trabajo ⚙️ (SpecialistModal)

## Executive Summary

La discrepancia reportada entre la tarjeta de **AutoAuthFiles** (que muestra `gemini-3.8-flash-high` en letras grandes) y el modal **SpecialistModal / Tuerca de trabajo ⚙️** (que abre con `Permitir todos los modelos` seleccionado y `gemini-3.8-flash-high` deseleccionado) **no es un fallo de sincronización de red ni un error de caché**, sino un **desacople conceptual y visual introducido en la refactorización reciente (`commit 4f13679`) [S-007]**:

1. **En disco (`cli-proxy-api`)**, las cuentas tienen `excluded_models: []` [S-006]. Es decir, están en modo **Multipropósito Abierto** (responden a los 9 modelos de la familia Gemini sin restricción).
2. **En `AutoAuthFiles.jsx`**, cuando una tarjeta está en modo multipropósito, el banner hero (`renderHeroBanner`) imprime el modelo predeterminado (`defaultModel = 'gemini-3.8-flash-high'`) en el elemento principal de título tipográfico (`.hero-model-name`), exactamente en el mismo formato, tamaño y color que si fuera un especialista activo [S-001, S-003]. Esto induce al usuario a pensar que la cuenta está limitada o fijada a `gemini-3.8-flash-high`.
3. **En `SpecialistModal.jsx`**, el componente consulta el estado real en disco (`detectSpecialistState`) y, al no hallar exclusiones, selecciona correctamente `mode = 'all'` (`Permitir todos los modelos de gemini`) y deja la opción de radio de `gemini-3.8-flash-high` desmarcada [S-002, S-004].

El resultado es una contradicción visual directa: **la tarjeta aparenta ser especialista en `gemini-3.8-flash-high`, mientras que la tuerca revela con honestidad que la cuenta permite todos los modelos y no está limitada a ninguno**.

---

## Research Question

Investigar por qué la **Tuerca de trabajo ⚙️ (SpecialistModal)** está desincronizada con las tarjetas en **AutoAuthFiles** respecto a `gemini-3.8-flash-high`, inspeccionando las dos capturas de pantalla provistas en `/srv/share/`, verificando el código de `AutoAuthFiles.jsx`, `SpecialistModal.jsx` y `managementClient.js`, e identificando la causa raíz exacta y la solución técnica.

---

## Recommendation or Answer

1. **Alinear la semántica visual del banner en `AutoAuthFiles.jsx`**:
   Cuando una tarjeta está en modo multipropósito (`specState.isSpecialist === false`), el banner hero **no debe mostrar el nombre de un modelo individual como si fuera la identidad única de la tarjeta**. En su lugar, debe mostrar `Todos los modelos (9)` (o `Acceso Total / 9 Modelos Disponibles`) en `.hero-model-name`, indicando en el texto secundario que el tráfico es balanceado con `gemini-3.8-flash-high` como ruta recomendada/predeterminada.
2. **Reservar el nombre destacado de un solo modelo exclusivamente para el modo especialista real (`specState.isSpecialist === true`)**:
   Solo cuando el usuario haga clic en la Tuerca ⚙️, seleccione `gemini-3.8-flash-high` y presione *Guardar: Limitar a gemini-3.8-flash-high* (generando las exclusiones en disco), la tarjeta debe lucir el badge `🎯 MODELO ESPECIALISTA ACTIVO` y el nombre `gemini-3.8-flash-high`.
3. **Reforzar la claridad en `SpecialistModal.jsx`**:
   Indicar en la Opción 1 de la Tuerca (`Permitir todos los modelos`) que el modelo preferente de la familia es `gemini-3.8-flash-high`, para que el operador entienda inmediatamente la relación entre la recomendación y la apertura de cuota total.

---

## Key Findings

| ID | Hallazgo | Severidad | Evidencia |
|---|---|---|---|
| **K-01** | **Captura 1 (`135122.png`)**: Todas las tarjetas muestran `gemini-3.8-flash-high` bajo el badge `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)`. | Hecho visual | [S-001] |
| **K-02** | **Captura 2 (`135116.png`)**: La Tuerca ⚙️ de `mar...tro@gmail.com` abre con `Permitir todos los modelos` seleccionado (verde) y el radio de `gemini-3.8-flash-high` desmarcado (círculo vacío). | Hecho visual | [S-002] |
| **K-03** | **Estado en disco**: En Docker `cli-proxy-api`, `antigravity-maribelluzbonitaaquinocastro@gmail.com.json` y las demás cuentas tienen `excluded_models: []`. | Hecho en runtime | [S-006] |
| **K-04** | **`AutoAuthFiles.jsx`**: En modo multipropósito, asigna forzosamente `gemini-3.8-flash-high` a `hero-model-name` en vez de comunicar que es un pool multimodelo. | Causa raíz primaria | [S-003], L389-402, L951-965 |
| **K-05** | **`SpecialistModal.jsx`**: Tras el commit `4f13679`, el modal inicializa fielmente en `mode = 'all'` cuando `excluded_models` está vacío, rompiendo la "ilusión" que antes existía cuando forzaba `mode = 'single'`. | Causa raíz histórica | [S-004], [S-007] |
| **K-06** | **Contrato arquitectónico respetado en backend**: El backend C-ABI y el sistema de pools soportan tanto `Permitir todos` como `Limitar a un solo modelo` [S-010]. La desincronización es 100% de presentación en la UI frontend. | Arquitectura | [S-005], [S-010] |

---

## Evidence Review

### 1. Inspección de Capturas de Pantalla

#### Captura de Pantalla 1: `/srv/share/Captura de pantalla 2026-10-11 135122.png` [S-001]
- **Contexto**: Muestra la vista `AutoAuthFiles & Trazabilidad` con 4 tarjetas de pool:
  1. `mar...tro@gmail.com` (`[agy2]`, LÍDER)
  2. `wil...o11@gmail.com` (`[agy2_1]`, RESERVA)
  3. `inf...tec@gmail.com` (`[agy]`, LÍDER)
  4. `inf...vio@gmail.com` (`[agy_1]`, RESERVA)
- **Banner Hero en las 4 tarjetas**:
  - Badge superior: `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)`
  - Título central (22px bold cyan): **`gemini-3.8-flash-high`**
  - Subtítulo de apoyo: `Modo multipropósito balanceado · Tráfico distribuido entre modelos disponibles`
  - Badge de familia: `✨ Serves: Gemini 3.x Flash & Pro`
- **Impacto cognitivo**: El operador observa de inmediato la palabra `gemini-3.8-flash-high` como título de la tarjeta y asume: *"Esta cuenta está operando con gemini-3.8-flash-high"*.

#### Captura de Pantalla 2: `/srv/share/Captura de pantalla 2026-10-11 135116.png` [S-002]
- **Contexto**: El operador hace clic en el botón de tuerca ⚙️ de la tarjeta `mar...tro@gmail.com` (`antigravity-mar...tro@gmail.com.json`, familia `GEMINI`).
- **Estado de las opciones**:
  - Encabezado: `Elige el comportamiento de esta cuenta: 9 modelos en familia`.
  - **Opción 1 (ACTIVA / SELECCIONADA)**:
    - Radio botón con punto verde encendido.
    - Contorno verde y badge `ABIERTO`.
    - Texto: `🔓 Permitir todos los modelos de gemini (Sin restricciones)`.
    - Descripción: `La cuenta responderá a cualquier petición de los 9 modelos disponibles sin bloquear ninguno.`
  - Separador: `O LIMÍTALO EXCLUSIVAMENTE A UN SOLO MODELO:`.
  - **Opción 2 (INACTIVA / DESELECCIONADA)**:
    - Radio botón vacío (círculo gris).
    - Texto: `🔒 gemini-3.8-flash-high ⭐ RECOMENDADO`.
    - Descripción: `Solo responderá a gemini-3.8-flash-high. Bloquea automáticamente los otros 8 modelos.`
  - Banner inferior: `🔓 Acceso Total: Todos los modelos (9) permitidos. Ningún modelo bloqueado.`
  - Botón de guardado: `Guardar: Permitir Todos`.
- **Impacto cognitivo**: El operador experimenta frustración por desincronización: *"Si la tarjeta decía afuera `gemini-3.8-flash-high`, ¿por qué al abrir la tuerca no está marcado `gemini-3.8-flash-high` y dice que permite todos?"*.

---

### 2. Inspección del Estado Real en Disco (`cli-proxy-api`) [S-006]

Al consultar el contenedor Docker en ejecución `cli-proxy-api` y verificar los archivos físicos en `/root/.cli-proxy-api/*.json`:
```json
{
  "email": "maribelluzbonitaaquinocastro@gmail.com",
  "prefix": "agy2",
  "excluded_models": []
}
```
Todas las 4 cuentas tienen `excluded_models: []`.
**Conclusión técnica irrebatible**: En disco y en el runtime de CPAMC, ninguna de las cuentas está restringida a un solo modelo. Todas están configuradas en fábrica para admitir los 9 modelos de Gemini.

---

### 3. Anatomía del Código y Causa Raíz

#### A. ¿Cómo calcula `AutoAuthFiles.jsx` el banner? [S-003]
En `AutoAuthFiles.jsx`:
```javascript
// Línea 951
{renderHeroBanner(
  specState,
  isGemini
    ? cardInherited.includes('gemini-3.8-flash-high')
      ? 'gemini-3.8-flash-high'
      : cardInherited.find((m) => m.includes('3.8'))
      || (cardInherited.includes('gemini-2.5-pro') ? 'gemini-2.5-pro' : cardInherited[0] || 'gemini-3.8-flash-high')
    : cardInherited.includes('claude-3-7-sonnet')
    ? 'claude-3-7-sonnet'
    : cardInherited.find((m) => m.includes('3.7') || m.includes('sonnet'))
    || cardInherited[0]
    || 'claude-3-7-sonnet',
  poolGroupStyle
)}
```
Y en `renderHeroBanner`:
```javascript
// Líneas 389-401
if (specState.isSpecialist) {
  return (
    <div className="hero-model-banner specialist" ...>
      <span className="badge-specialist-active">🎯 MODELO ESPECIALISTA ACTIVO</span>
      <div className="hero-model-name">{specState.activeSpecialistModel}</div>
    </div>
  );
}
return (
  <div className="hero-model-banner multipurpose" data-testid="hero-model-banner">
    <div className="hero-model-badge-row">
      <span className="badge-multipurpose-default">✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)</span>
    </div>
    <div className="hero-model-name" data-testid="hero-model-name">
      {defaultModel}
    </div>
    <div className="hero-model-helper">
      Modo multipropósito balanceado · Tráfico distribuido entre modelos disponibles
    </div>
  </div>
);
```

**El error**: Cuando `specState.isSpecialist === false`, la función coloca `{defaultModel}` (`'gemini-3.8-flash-high'`) directamente en `<div className="hero-model-name">`. Esto hace que visualmente ambas tarjetas (especialista y multipropósito) muestren el nombre de un modelo específico en tipografía gigante.

#### B. ¿Cómo calcula `SpecialistModal.jsx` su estado inicial? [S-004]
```javascript
// Líneas 56-70
const specialistInfo = detectSpecialistState(card, inheritedModels);
if (specialistInfo.isSpecialist && specialistInfo.activeSpecialistModel) {
  setMode('single');
  setSelectedModel(specialistInfo.activeSpecialistModel);
} else {
  // Si la cuenta no está limitada en disco, reflejar fielmente el modo multipropósito abierto
  setMode('all');
  const defaultRecommendation = isGeminiFamily
    ? (sortedInheritedModels.find((m) => m.includes('3.8')) || sortedInheritedModels[0] || '')
    : (sortedInheritedModels[0] || '');
  setSelectedModel(defaultRecommendation);
}
```
Como la tarjeta tiene `excluded_models: []`, `specialistInfo.isSpecialist` es `false`. Por tanto:
- `mode` se establece en `'all'`.
- `selectedModel` se establece en `'gemini-3.8-flash-high'`.
- Pero en el renderizado de la lista de radios:
  ```javascript
  const isSelected = mode === 'single' && selectedModel === m;
  ```
  Dado que `mode === 'all'`, `isSelected` es **`false` para todos los modelos individuales**.
  Por lo tanto, el radio botón de `gemini-3.8-flash-high` queda desmarcado, mientras que el radio de `Permitir todos los modelos` (`isAllowAll = mode === 'all'`) queda marcado con el check verde.

#### C. El origen histórico del conflicto (Commit `4f13679`) [S-007]
Antes del commit `4f13679`:
- `SpecialistModal.jsx` forzaba artificialmente `if (isGeminiFamily) { setMode('single'); setSelectedModel(default38); }`.
- El commit `4f13679` eliminó ese falseamiento para reflejar la realidad del disco: si en disco no hay exclusiones, el modal debe abrir en `mode = 'all'`.
- Sin embargo, **se olvidó actualizar `AutoAuthFiles.jsx`**, que siguió mostrando `gemini-3.8-flash-high` en el banner de la tarjeta, rompiendo la coherencia entre ambos componentes.

---

## Trade-offs and Risks

| Decisión | Ventajas | Riesgos / Mitigaciones |
|---|---|---|
| **Ajustar banner en modo multipropósito a `Todos los modelos (9)`** | Elimina al 100% la confusión visual del operador; alinea la tarjeta con el modal de forma intuitiva e inmediata. | Los tests existentes en `AutoAuthFiles.test.jsx` esperan texto en `hero-model-name`. Se deben actualizar las aserciones de prueba para comprobar la nueva etiqueta de modo multipropósito. |
| **Forzar `mode: 'single'` en SpecialistModal por defecto** | Haría que el modal muestre `gemini-3.8-flash-high` marcado de entrada. | **Rechazado tajantemente**: Crearía una mentira técnica (fabricación de estado no persistido). Si el usuario cancela o no guarda, el archivo en disco seguiría siendo multipropósito. |
| **Persistir automáticamente exclusiones al crear el pool en GroupManager** | Convierte las cuentas en verdaderos especialistas desde su nacimiento. | Limita la versatilidad de Antigravity: las cuentas no podrían responder a otros modelos de Gemini sin desbloquearlas previamente en la Tuerca. |

---

## Alternatives Considered

1. **Alternativa A: Cambiar el banner multipropósito para indicar "Todos los modelos (9)" (Recomendada)**
   - En `AutoAuthFiles.jsx`: Si `!specState.isSpecialist`, el título del banner muestra `Todos los modelos de Gemini (${inheritedModels.length})` o `Multimodelo (9 disponibles)`.
   - El texto secundario conserva la referencia al modelo recomendado: `Tráfico balanceado · Predeterminado preferente: gemini-3.8-flash-high`.
   - Coherencia total con la Tuerca ⚙️.

2. **Alternativa B: Conservar el nombre del modelo pero añadir etiqueta explícita de rol**
   - Título: `gemini-3.8-flash-high (Ruta Predeterminada)`
   - Subtítulo: `Modo abierto: 9 modelos permitidos en esta cuenta`.
   - Tuerca: Se añade un badge en la Opción 1 indicando `(Ruta predeterminada actual: gemini-3.8-flash-high)`.

---

## Unknowns and Limits

- **Límites de alcance**: Este reporte es de estricta solo lectura. No se modificó ningún archivo en el workspace durante esta investigación.
- **Catálogo dinámico**: En el entorno auditado, la familia Gemini cuenta con exactamente 9 modelos reportados por Antigravity en CPAMC.

---

## Recommended Next Actions

1. **Aprobar la implementación de la Alternativa A en `AutoAuthFiles.jsx`**:
   Modificar `renderHeroBanner` para que en modo multipropósito (`specState.isSpecialist === false`):
   ```jsx
   <div className="hero-model-name" data-testid="hero-model-name">
     Todos los modelos ({inheritedCount || 9})
   </div>
   <div className="hero-model-helper">
     Modo abierto sin restricciones · Modelo preferente: {defaultModel}
   </div>
   ```
2. **Actualizar `SpecialistModal.jsx`**:
   Agregar en la descripción de la opción `Permitir todos`:
   `(Modelo preferente recomendado: ${selectedModel})` para vincular formalmente la recomendación con la apertura total.
3. **Actualizar y ejecutar los tests de Vitest**:
   Ajustar el caso de prueba `renders distinct hero container with badge-multipurpose-default in multipurpose mode` en `AutoAuthFiles.test.jsx` y verificar que los 376 tests pasen en verde.
