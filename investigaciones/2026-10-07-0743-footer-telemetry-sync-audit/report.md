# Auditoría Técnica y Desglose de Telemetría: Sincronización de Cuotas en Footer TUI (CPAMC, Auto Switcher Pro y Pi Agent)

## Executive Summary

Esta investigación exhaustiva y de solo lectura analizó el origen, cálculo, canal de transmisión y estado de sincronización de la telemetría proyectada en el pie de página (footer) de la TUI en el entorno del agente:
```text
│⏸  agy 44% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d
```

La auditoría reveló un hallazgo arquitectural crítico: **coexisten dos motores de telemetría independientes en competencia directa dentro del entorno del usuario**:
1. **El motor primario nativo del tema (`j0k3r-theme/src/quota.ts`)** [S-008]: Es el responsable exacto de la cadena auditada (incluyendo los glifos `↻`, las cuentas regresivas `3h/4d` y la lógica `formatMultimediaQuota`).
2. **El motor homologado de la extensión (`extensions/cpamc-auto-switcher/src/adapter.ts` y `src/store.ts`)** [S-001][S-002]: Consulta `cpamc-auto-switcher -list` [S-005], calcula correctamente los pares de rotación para todos los pools (`agy`, `agy2`, `agy_son`, `agy_opus`), pero **su salida en el footer regular es eclipsada / solapada por precedencia de código en `J0k3rThemeFooter.ts`** [S-009].

### Hallazgos Clave

1. **Desglose Exacto de la Cadena**:
   - `⏸`: Estado de ejecución (`idle` = pausa `#7899A6`; `busy` = ejecución `▶` `#7BC88F`).
   - `agy` / `agy_1`: Prefijo de la cuenta activa (líder) y de la primera reserva en cascada.
   - `44%` / `100%`: **Porcentaje de cuota RESTANTE mínima** ($\min(\text{pct5h}, \text{pctSemanal})$), NO cuota consumida. 44% significa que la cuenta consumió el 56% y le queda el 44%.
   - `↻ 3h/4d`: Cuenta regresiva de reinicio: `3h` para el reseteo de la ventana móvil de 5 horas (`5h Limit`), y `4d` para la ventana semanal (`Weekly Limit`).
   - `↻ 5h/7d`: En la reserva `agy_1`, faltan 5 horas y 7 días completos porque la cuenta está intacta al 100%.
2. **Causa Raíz de por qué se muestra `agy`/`agy_1` fijamente (Bug de Clasificación en `j0k3r-theme`)**:
   - En `j0k3r-theme/src/quota.ts`, la función `resolveProfileFromModelId` [S-008] contiene fallas lógicas de precedencia y nomenclatura:
     - Tanto `agy2` como `agy_opus` comienzan con `"agy"`, por lo que se clasifican erróneamente como perfil `"default"` (Gemini 1).
     - Al buscar en `switcherAccounts`, el perfil `"default"` sólo contiene `agy` y `agy_1`. `agy2` (perfil `"2"`) y `agy_opus` (perfil `"opus"`) no coinciden y el sistema retrocede al líder por defecto (`agy`).
     - Para `agy_son`, la función devuelve perfil `"clau"`, pero en el backend Go el perfil se denomina `"son"` [S-004][S-005][S-006]. La búsqueda retorna 0 cuentas (`null`), provocando que `formatMultimediaQuota` falle y caiga al texto simple de `adapter.ts` (sin símbolos `↻`).
   - Adicionalmente, en CLIProxyAPI [S-012], los archivos `antigravity-wilsonlavio11@gmail.com.json` y `antigravity-wilsonlavio9@gmail.com.json` tienen `note: null`. Mientras el cliente Go descarga el JSON completo e inspecciona el campo `prefix` directamente [S-007], `j0k3r-theme` mapea prefijos basándose únicamente en `file.note` sin descargar los JSONs [S-008], quedando ciego ante las cuentas de `agy2`.
3. **Contraste con Auto Switcher Pro y Backend Go**:
   - En el backend Go (`cpamc-auto-switcher -list`) [S-005], en `extensions/cpamc-auto-switcher/src/store.ts` [S-002] y en la interfaz web de Auto Switcher Pro (`ControlSwitcher.jsx`) [S-011], **los 4 pools están 100% identificados y sincronizados**:
     - `agy` (`default`): 40.4% libre (40.6% sem, 59.6% 5h) ➔ Reserva `agy_1` (100.0% libre).
     - `agy2` (`2`): 44.0% libre (56.0% sem, 5.1% 5h) ➔ Reserva `agy2_1` (100.0% libre).
     - `agy_son` (`son`): 32.9% libre (67.1% sem, 0.0% 5h) ➔ Reserva `agy_son_1` (48.1% libre).
     - `agy_opus` (`opus`): 0.0% libre (100.0% sem agotada) ➔ Reserva `agy_opus_1` (0.0% libre agotada).
   - La suite homologada `extensions/cpamc-auto-switcher` en modo fullscreen (Gentle-Shell) proyecta la tarjeta de sidebar [S-001] reactiva al modelo activo sin sufrir los errores de `j0k3r-theme`.

---

## Research Question

1. ¿Cómo se originan y calculan exactamente cada uno de los valores y glifos del string de telemetría del footer (`│⏸  agy 44% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d`)?
2. ¿Por qué el footer muestra específicamente `agy`/`agy_1` en lugar de adaptarse al modelo activo (`agy2`, `agy_son`, `agy_opus`)?
3. ¿Cómo fluyen los datos entre CLIProxyAPI, el backend en Go (`internal/quota`, `internal/switcher`, `cmd/cpamc-auto-switcher`), Auto Switcher Pro (`ControlSwitcher.jsx`) y la extensión TypeScript (`adapter.ts`, `store.ts`, `j0k3r-theme`)?
4. ¿Qué componentes están actualmente sincronizados y cuáles desincronizados entre los 4 pools disponibles?

---

## Recommendation or Answer

### 1. Desglose Anatómico del String de Telemetría

La línea de telemetría está construida por la función `formatMultimediaQuota` en `~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts` [S-008]:

| Segmento | Valor de Ejemplo | Componente / Origen | Significado Físico / Algorítmico |
| :--- | :--- | :--- | :--- |
| `│` | `\x1b[0;38;2;138;78;158m│` | Separador de bloque | Delimitador visual ANSI TrueColor violeta (`#8A4E9E`). |
| `⏸` / `▶` | `⏸` (`#7899A6`) | `activeIcon` (`isIdle ? ⏸ : ▶`) | Estado del bucle del agente. `⏸` indica que el agente está esperando input (`idle`); `▶` (`#7BC88F`) indica procesamiento de turnos / subagentes (`busy`). |
| `agy` | `\x1b[1;38;2;92;184;199magy` | `active.prefix` | Prefijo asignado a la cuenta principal activa (Líder en Producción) en CLIProxyAPI. Formato negrita cian (`#5CB8C7`). |
| `44%` | `\x1b[0;38;2;229;181;103m44%` | `Math.round(active.pct)` | **Cuota Restante Mínima** ($\min(\text{pct5h}, \text{pctSemanal})$). Representa el 43.95% de capacidad disponible antes del agotamiento. Color ámbar (20%–49%). |
| `↻` | `\x1b[0;38;2;120;153;166m↻` | `COUNTDOWN_COLOR` | Glifo de reciclaje / ventana de reinicio cíclico. |
| `3h/4d` | `3h/4d` | `${data.cd5h}/${data.cdSem}` | Tiempos restantes para el reseteo: `3h` hasta el reinicio de la ventana de 5 horas; `4d` hasta el reseteo de la cuota semanal. |
| `⏭` | `\x1b[0;38;2;157;124;216m⏭` | `nextIcon` | Glifo indicador de reserva en cola / cascada de rotación (lavanda `#9D7CD8`). |
| `agy_1` | `\x1b[1;38;2;222;116;155magy_1` | `next.prefix` | Prefijo de la primera cuenta candidata para promoción inmediata ante un error HTTP 429 o saturación. Rosa coral negrita (`#DE749B`). |
| `100%` | `\x1b[0;38;2;123;200;143m100%` | `Math.round(next.pct)` | Cuota restante disponible en la cuenta de reserva (100% libre en ambas ventanas). Verde menta (`#7BC88F`). |
| `↻ 5h/7d` | `5h/7d` | `${data.cd5h}/${data.cdSem}` | Ventanas completas sin uso: la ventana de 5 horas tiene sus 5 horas intactas; el ciclo semanal tiene sus 7 días intactos. |

### 2. Acciones Recomendadas para Restaurar Reactividad Dinámica

1. **Corregir `resolveProfileFromModelId` en `j0k3r-theme/src/quota.ts` (P0 Inmediata)**:
   - Eliminar el prefijo de proveedor `cpamc/` o `cliproxyapi/` antes de procesar slashes.
   - Evaluar `agy_opus` y `opus` antes de la comprobación general de `agy`.
   - Mapear perfiles de acuerdo a la convención del backend Go (`"son"`, `"opus"`, `"2"`, `"default"` en lugar de `"clau"`).
2. **Alinear Mapeo de Archivos de Autenticación con `prefix` Real en CLIProxyAPI (P0 Inmediata)**:
   - CLIProxyAPI no siempre define `note` en `GET /v0/management/auth-files`. Es imperativo que la lectura inspeccione tanto `file.note` como el campo interno `file.prefix` (o realizar la consulta ligera a `/download`).
3. **Unificar el Renderizado del Footer TUI bajo la Suite Homologada (P1 Arquitectural)**:
   - Conforme al registro ADR-01 [S-014], la suite `extensions/cpamc-auto-switcher` es la única fuente de verdad (SSOT). Se debe transferir el formateo enriquecido con cuentas regresivas `↻` a `formatFooterRotationBlock` en `adapter.ts` y desacoplar a `j0k3r-theme` de la consulta directa a Google Cloud Code.

---

## Key Findings

### 1. El Conflicto de Doble Telemetría: Sombreado en `J0k3rThemeFooter`

En el entorno interactivo de Pi (`j0k3r-pi`), existen dos extensiones ejecutando bucles de telemetría en paralelo [S-008][S-009][S-013]:

```
[ EXTENSIÓN 1: extensions/cpamc-auto-switcher ]
  src/store.ts ──► Ejecuta "cpamc-auto-switcher -list" cada 25s
  src/adapter.ts ──► Calcula PoolRotationPair dinámicamente según ctx.model
  adapter.ts ──► Inyecta texto simple: activeFooter.setQuota("│⏸ agy_son 32.9% │ ⏭ agy_son_1 48.1%")

[ EXTENSIÓN 2: ~/.pi/agent-j0k3r/extensions/j0k3r-theme ]
  index.ts ──► Polling cada 30s vía refreshQuota()
  src/quota.ts ──► Llama fetchModelQuota() ──► Consulta Google Cloud Code vía cpamc-usage
  src/quota.ts ──► Genera: "│⏸  agy 44% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d"

[ PUNTO DE COLISIÓN EN J0k3rThemeFooter.ts (Línea 495) ]
  render(width):
    const dynamicQuota = isCpa ? (
        formatMultimediaQuota(this.activeConsumer, this.ctx.model?.id) ?? 
        (this.quota ? electric(VIOLET, this.quota) : "")
    ) : "";
```

**Mecanismo de Sombreado**: `formatMultimediaQuota` tiene prioridad absoluta mediante el operador de coalescencia nula (`??`). Mientras `formatMultimediaQuota` retorne una cadena válida, `this.quota` (enviado por la extensión homologada `cpamc-auto-switcher`) **es completamente ignorado y descartado del renderizado** [S-009].

---

### 2. Causas Raíz del Congelamiento en `agy`/`agy_1`

Aun cuando el usuario configure en `settings.json` o seleccione en `/model` cualquiera de los otros pools (`agy2`, `agy_son`, `agy_opus`), la telemetría del footer se comporta de manera anómala debido a 5 fallos en cadena en `j0k3r-theme/src/quota.ts` [S-008]:

#### Causa A: Normalización Inexistente de Proveedor en `resolveProfileFromModelId`
El código original extrae el prefijo evaluando el primer slash [S-008]:
```typescript
const trimmed = modelId.trim();
const slash = trimmed.indexOf("/");
if (slash > 0) {
    const prefix = trimmed.slice(0, slash);
    ...
```
Si el modelo activo es referenciado con el slug del proveedor (por ejemplo `cpamc/agy_son/claude-sonnet-4-6`), `slash` apunta a la posición 5 (`"cpamc"`). La variable `prefix` adquiere el valor `"cpamc"`, el cual no coincide con ninguna regla de prefijos y cae al selector heurístico de texto general.

#### Causa B: Colisión de Prefijos (Opus Clasificado como Gemini)
En `resolveProfileFromModelId` [S-008]:
```typescript
if (prefix.startsWith("agy_clau") || prefix.startsWith("clau") || prefix.startsWith("son") || prefix.startsWith("agy_son")) {
    return "clau";
}
if (prefix.startsWith("agy") || prefix.startsWith("g")) {
    return "default";
}
```
Cuando el modelo es `agy_opus/claude-opus-4-6-thinking`:
- No coincide con `agy_clau` ni `agy_son`.
- La comprobación siguiente `prefix.startsWith("agy")` es evaluada como **VERDADERA** (`"agy_opus"` empieza por `"agy"`).
- Retorna `"default"` (Gemini).
- En consecuencia, ¡un modelo de Claude Opus es evaluado contra las cuotas de Gemini y proyecta el pool de Gemini (`agy`/`agy_1`)!

#### Causa C: Discordancia de Nombres de Perfil entre TypeScript y Go Backend
- `resolveProfileFromModelId` asigna a los modelos de Claude el nombre de perfil `"clau"` [S-008].
- Sin embargo, en el backend Go `cpamc-auto-switcher` [S-004][S-005][S-006], los perfiles asignados son `"son"` (para `agy_son`) y `"opus"` (para `agy_opus`).
- Al ejecutarse `computeProfileLoop("clau", switcherAccounts)`:
  ```typescript
  const profileAccounts = switcherAccounts.filter((a) => a.profile === profile);
  ```
  `profileAccounts` resulta en una lista vacía `[]`.
- `computeProfileLoop` devuelve `{ activeAcc: null }`, provocando que `fetchModelQuota` devuelva `undefined`.
- Al retornar `undefined`, `formatMultimediaQuota` falla y el footer retrocede a `this.quota` (donde se muestra el texto simple de `adapter.ts` sin las cuentas regresivas `↻`).

#### Causa D: Asignación Errónea del Pool `agy2`
- Para el pool `agy2/gemini-3.8-flash-high`, `prefix` es `"agy2"`.
- `"agy2".startsWith("agy")` es verdadero, por lo que retorna `"default"`.
- Pero en el backend Go, `agy2` tiene asignado el perfil `"2"` (para aislarlo de `agy` [S-006]).
- Al filtrar por `profile === "default"`, las cuentas resultantes son únicamente `agy` y `agy_1`.
- `computeProfileLoop` no encuentra `agy2` dentro del perfil `"default"`, por lo que regresa la cuenta raíz `agy`. El usuario ve `agy` a pesar de estar usando `agy2`.

#### Causa E: Pérdida de Metadatos (`note: null`) en CLIProxyAPI
En `j0k3r-theme/src/quota.ts` [S-008]:
```typescript
const data = (await res.json()) as { files?: Array<{ name?: string; note?: string }> };
for (const file of data.files || []) {
    if (file.name && file.note) {
        map.set(file.name, file.note.trim());
    }
}
```
En la base de datos de CLIProxyAPI [S-012]:
- `antigravity-wilsonlavio11@gmail.com.json` tiene `"note": null` y `"prefix": "agy2"`.
- `antigravity-wilsonlavio9@gmail.com.json` tiene `"note": null` y `"prefix": "agy2_1"`.
Dado que `file.note` es nulo, `map` no registra las cuentas de `agy2`. Las métricas de uso devueltas por Google Cloud Code no pueden asociarse al prefijo `agy2`, dejando a `j0k3r-theme` ciego frente a este pool. Por el contrario, el cliente Go de `cpamc-auto-switcher` descarga el archivo completo mediante `/download` y lee directamente el atributo `prefix` [S-007], asegurando que `cpamc-auto-switcher -list` reconozca siempre `agy2` [S-005].

---

### 3. Matriz de Reactividad Empírica: Comportamiento por Modelo

Se ejecutó una prueba empírica en caliente contrastando los resultados de ambos motores para los cuatro modelos de producción:

```text
Prueba en Caliente: Motor j0k3r-theme vs Motor cpamc-auto-switcher
────────────────────────────────────────────────────────────────────────────────
Modelo Invocado               Resultado j0k3r-theme (Prioritario)            Resultado cpamc-auto-switcher (SSOT)
────────────────────────────────────────────────────────────────────────────────
agy/gemini-3.8-flash-high     │⏸  agy 37% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d   │⏸ agy 37.2% │ ⏭ agy_1 100.0%
agy2/gemini-3.8-flash-high    │⏸  agy 37% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d   │⏸ agy2 44.0% │ ⏭ agy2_1 100.0%
agy_opus/claude-opus-4-6      │⏸  agy 37% ↻ 3h/4d │ ⏭  agy_1 100% ↻ 5h/7d   │⏸ agy_opus 0.0% │ ⏭ agy_opus_1 0.0%
agy_son/claude-sonnet-4-6     undefined (Cae a cpamc-auto-switcher)         │⏸ agy_son 32.9% │ ⏭ agy_son_1 48.1%
```

**Diagnóstico Inmediato**:
- `extensions/cpamc-auto-switcher` (`store.ts` + `adapter.ts`) tiene **100% de reactividad dinámica y clasifica los 4 pools con precisión exacta**.
- `j0k3r-theme` congela la telemetría en `agy` para 3 de los 4 modelos, y se apaga en el cuarto (`agy_son`).

---

### 4. Estado de Sincronización entre CPAMC Local y Auto Switcher Pro

A continuación se detalla la comparativa entre las 4 capas del sistema respecto a los pools configurados:

| Capa del Sistema | Pool `agy` | Pool `agy2` | Pool `agy_son` | Pool `agy_opus` | Estado de Sincronización |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Cloud Code API** (`retrieveUserQuotaSummary`) | 5h: 62% cons.<br>Sem: 41% cons.<br>Disp: 38% | 5h: 5% cons.<br>Sem: 56% cons.<br>Disp: 44% | 5h: 0% cons.<br>Sem: 67% cons.<br>Disp: 33% | 5h: 0% cons.<br>Sem: 100% cons.<br>Disp: 0% (Agotada) | **Sincronizado al 100%** (Datos brutos en tiempo real) [S-010]. |
| **CLIProxyAPI Host** (`:8317`) | Activo (`agy`)<br>Reserva (`agy_1`) | Activo (`agy2`)<br>Reserva (`agy2_1`) | Activo (`agy_son`)<br>Reserva (`agy_son_1`) | Activo (`agy_opus`)<br>Reserva (`agy_opus_1`) | **Sincronizado al 100%** (8 credenciales activas) [S-012]. |
| **Go CLI Switcher** (`cpamc-auto-switcher -list`) | `[ACTIVE]` agy (40%)<br>`[RESERVE]` agy_1 (100%) | `[ACTIVE]` agy2 (44%)<br>`[RESERVE]` agy2_1 (100%) | `[ACTIVE]` agy_son (33%)<br>`[RESERVE]` agy_son_1 (48%) | `[ACTIVE]` agy_opus (0%)<br>`[RESERVE]` agy_opus_1 (0%) | **Sincronizado al 100%** (4 pools aislados por perfil) [S-004][S-005]. |
| **Auto Switcher Pro Web** (`ControlSwitcher.jsx`) | Card Gemini Puro<br>Gauges 5h/Sem en vivo | Card Gemini 2<br>Gauges 5h/Sem en vivo | Card Sonnet<br>Gauges 5h/Sem en vivo | Card Claude Opus<br>Badge AGOTADA | **Sincronizado al 100%** (Proyecta los 4 pools con gauges TrueColor) [S-011]. |
| **Pi Extension Suite** (`store.ts` + `adapter.ts`) | Detecta `agy`<br>Líder + Reserva | Detecta `agy2`<br>Líder + Reserva | Detecta `agy_son`<br>Líder + Reserva | Detecta `agy_opus`<br>Líder + Reserva | **Sincronizado al 100%** (TUI Sidebar y memoria reactiva) [S-001][S-002]. |
| **TUI Footer Renderer** (`j0k3r-theme/src/quota.ts`) | **OK** (`agy 44% ↻ 3h/4d`) | **DESINCRONIZADO** (Muestra `agy` en vez de `agy2`) | **DESINCRONIZADO** (Cae a texto plano sin `↻`) | **DESINCRONIZADO** (Muestra `agy` en vez de `agy_opus`) | **DESINCRONIZADO**: 3 de 4 pools rotos por bugs en `quota.ts` [S-008]. |

---

## Evidence Review

| # | Afirmación / Hallazgo | Fuentes | Nivel de Confianza | Justificación Empírica / Código |
|---|---|---|---|---|
| E-01 | El string auditado proviene de `j0k3r-theme/src/quota.ts` | [S-008], [S-009] | **HIGH** | Líneas 261–280 de `quota.ts`: plantilla literal `${iconStr} ${nameColor}${data.prefix} ${pColor}${Math.round(data.pct)}% ${COUNTDOWN_COLOR}↻ ${cd}` produce textualmente la cadena. |
| E-02 | Los porcentajes representan cuota disponible restante, no consumo | [S-003], [S-008], [S-010] | **HIGH** | `extractQuotaForProfile` computa `min(pct5h, pctSem)`. Para `wilsonlavio11`, la cuota semanal consumida es 56.0%, resultando en `remainingFraction = 43.95%` (44% libre). |
| E-03 | `3h/4d` son las cuentas regresivas calculadas de las marcas de tiempo de reinicio | [S-008], [S-010] | **HIGH** | `formatShortCountdown` calcula $\Delta t$ entre `now` (07:57 UTC) y `resetAt` (10:58 UTC = ~3h; 11 de octubre = ~4d). |
| E-04 | `formatMultimediaQuota` eclipsa la salida de `adapter.ts` en el footer | [S-001], [S-009] | **HIGH** | `J0k3rThemeFooter.ts` línea 495 antepone `formatMultimediaQuota(...)` a `this.quota`. Si el primero retorna string, el segundo jamás se renderiza. |
| E-05 | `resolveProfileFromModelId` clasifica `agy_opus` y `agy2` como `"default"` | [S-008] | **HIGH** | Verificado en vivo mediante ejecución Node/TSX: `agy_opus` y `agy2` retornan `"default"`, provocando que el bucle devuelva siempre `agy` y `agy_1`. |
| E-06 | El backend Go y Auto Switcher Pro gestionan correctamente los 4 pools | [S-004], [S-005], [S-006], [S-011] | **HIGH** | La ejecución de `cpamc-auto-switcher -list` clasifica con éxito `default` (`agy`), `2` (`agy2`), `son` (`agy_son`) y `opus` (`agy_opus`). |
| E-07 | `wilsonlavio11` carece de atributo `note` en CLIProxyAPI | [S-007], [S-012] | **HIGH** | Consulta HTTP a `/v0/management/auth-files` arroja `"note": null` para las credenciales física de Wilson Lavio, impidiendo su mapeo en `j0k3r-theme`, mientras que `client.go` lo resuelve con `/download`. |

---

## Trade-offs and Risks

1. **Mantener dos extensiones de telemetría vs. Unificación estricta en `cpamc-auto-switcher`**:
   - *Riesgo*: Mantener `j0k3r-theme` consultando directamente la API de Google duplica las peticiones de red hacia CLIProxyAPI (una consulta desde el binario Go cada 25s y otra desde Node cada 30s).
   - *Compensación*: La unificación bajo `adapter.ts` (conforme al ADR-01) reduce la sobrecarga de red al 50% y asegura una única fuente de verdad, pero requiere portar el formato con cuentas regresivas `↻` a `adapter.ts`.
2. **Consultar Cuotas en Línea vs. Consultar Caché del Binario Go**:
   - *Riesgo*: Ejecutar `cpamc-auto-switcher -list` requiere lanzar un subproceso (`execFileAsync`).
   - *Compensación*: `src/store.ts` ya implementa una caché en memoria de 25 segundos (`QUOTA_REFRESH_MS`), garantizando costo cero de CPU durante los ciclos de renderizado del TUI.

---

## Alternatives Considered

1. **Parchear únicamente `resolveProfileFromModelId` en `j0k3r-theme`**:
   - *Descartada como solución definitiva*: Aunque corregiría los nombres de perfiles, mantendría la duplicidad de llamadas HTTP hacia Google Cloud Code y dejaría sin resolver el fallo de las credenciales con `note: null`.
2. **Desactivar el footer de `j0k3r-theme` y usar solo la tarjeta de Sidebar**:
   - *Descartada*: En modo regular (`tuiMode: "regular"`, común en terminales compactas o ventanas estándar), no hay sidebar disponible. El footer es el canal crítico de observabilidad para el desarrollador.

---

## Unknowns and Limits

1. **Frecuencia de Actualización de ResetAt en Google Cloud Code**: Google renueva la marca temporal `resetTime` en el encabezado de respuesta sólo cuando ocurren solicitudes reales o en intervalos fijos del servidor. Puede observarse una discrepancia de hasta 60 segundos entre el cálculo local y el reseteo efectivo.
2. **Límite de Consultas Simultáneas a Management API**: Si ambas extensiones consultan de forma desincronizada, CLIProxyAPI puede registrar picos de concurrencia al interactuar con el endpoint interno de Docker.

---

## Recommended Next Actions

### Plan de Corrección en 3 Fases

```
[ FASE 1: Solución Inmediata en j0k3r-theme (Hotfix P0) ]
  Archivo: ~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts
  ├─ 1. Corregir resolveProfileFromModelId():
  │     - Quitar prefijos "cpamc/" y "cliproxyapi/".
  │     - Evaluar "agy_opus" -> perfil "opus".
  │     - Evaluar "agy_son" -> perfil "son".
  │     - Evaluar "agy2" -> perfil "2".
  │     - Evaluar "agy" -> perfil "default".
  └─ 2. Corregir fetchAuthFilePrefixMap():
        - Si file.note es nulo, parsear file.name o consultar prefix real.

[ FASE 2: Homologación de Telemetría Enriquecida en adapter.ts (P1) ]
  Archivo: extensions/cpamc-auto-switcher/src/adapter.ts
  ├─ 1. Incorporar el formateo con glifo "↻" y tiempos de reseteo en formatFooterRotationBlock().
  └─ 2. Garantizar que adapter.ts entregue el bloque completo y enriquecido a footer.setQuota().

[ FASE 3: Desactivación de Lógica Redundante en j0k3r-theme (P2) ]
  Archivo: ~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/J0k3rThemeFooter.ts
  └─ 1. Eliminar formatMultimediaQuota() y permitir que this.quota (de adapter.ts) gobierne
        la telemetría del footer de manera limpia y soberana.
```
