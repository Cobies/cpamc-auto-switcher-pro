# Auditoría Arquitectural: Re-evaluación Proactiva de Candidatos y Rotación de Líderes en Eventos del Ciclo de Vida de Sesión

## Executive Summary

El usuario reporta un problema operacional concreto y recurrente en el ecosistema Auto Switcher Pro / Pi Coding Agent:
En configuraciones con telemetría visual tipo `│▶ agy2 25% ↻ 3h/3d │ ⏭ agy2_1 100% ↻ 7d/7d`, la cuenta activa principal (`agy2`) absorbe el 100% de las peticiones. Tras horas de inactividad (ej. 5 a 6 horas), pausas entre prompts, o tras emitir comandos de ciclo de vida como `/new`, `/reload` o reiniciar Pi, el sistema mantiene anclado al usuario en la cuenta agotada (`agy2` con 25% libre restante), provocando un desgaste severo y asimétrico sobre dicha cuenta mientras la reserva de contingencia (`agy2_1`) permanece intacta al 100% con su ventana completa de 7 días sin usar.

La propuesta bajo análisis consiste en: **en eventos del ciclo de vida de sesión (`/new`, `session_start`, `/reload`, cambio de sesión), re-evaluar quién es el mejor candidato del pool (por cuota remanente y frescura de la ventana de reseteo) y promoverlo proactivamente como líder activo del pool, sin romper la filosofía de continuidad Active-Standby**.

Tras una investigación exhaustiva de código en el motor en Go (`cmd/cpamc-auto-switcher/`, `internal/switcher/`, `internal/quota/`, `internal/config/`), la extensión TypeScript de Pi (`extensions/cpamc-auto-switcher/`), el núcleo del runtime de `@earendil-works/pi-coding-agent` y la telemetría viva de producción, los hallazgos concluyen que **la implementación es 100% factible, técnicamente viable y altamente beneficiosa**, con las siguientes precisiones arquitecturales:

1. **Ganchos de Ciclo de Vida Nativos Disponibles**: El runtime de Pi expone formalmente en `ExtensionAPI` el hook `session_start` con el payload tipado `SessionStartEvent`, el cual incluye de forma explícita la propiedad `reason: "startup" | "reload" | "new" | "resume" | "fork"` [S-006, S-007]. Esto permite diferenciar inequívocamente cuándo el usuario inicia una sesión limpia (`new`), recarga el agente (`reload`) o arranca la CLI (`startup`), de cuándo continúa un turno interactivo ordinario.
2. **Cero Impacto en Prompt Caching (Google Context Cache)**: A diferencia de un balanceo reactivo por petición (que destruiría los 228k+ tokens de caché de contexto en Antigravity en cada mensaje [S-012, S-015]), una rotación proactiva en las fronteras de sesión (`/new`, `/reload`, o tras 5-6 horas de inactividad) ocurre cuando el contexto está vacío o cuando el Time-To-Live (TTL) de la caché en la nube de Google (5 a 60 minutos) ya expiró por completo [S-012].
3. **Cero Desincronización en el Catálogo de Modelos de Pi**: Al ejecutar una promoción intra-pool (ej. ascender `agy2_1` a activo e intercambiarla con `agy2`), el prefijo activo en CLIProxyAPI pasa a ser asignado a la credencial fresca, manteniendo el nombre del prefijo público (`agy2`) inalterado [S-002, S-004]. Pi continúa despachando a `cpamc/agy2/gemini-3.8-flash-high` sin requerir reinicios de modelo ni alertas de desincronización [S-004, S-005].
4. **Protección contra la Trampa del "Efecto Precipicio" (Histeresis y Depletion Floor)**: Para no degenerar el modelo en un round-robin prematuro que desgaste ambas cuentas en paralelo hasta dejarlas vacías a la vez [S-013], la promoción proactiva debe estar gobernada por un **umbral de desgaste mínimo (Depletion Floor $\le 50\%$ disponible)** y un **margen de ventaja significativo (Advantage Delta $\ge 30\%$)**. Si la cuenta activa tiene 75% y la reserva tiene 100%, la activa se mantiene; si la activa cae al 25% y la reserva tiene 100%, la reserva se promueve de inmediato.
5. **Arquitectura Quirúrgica Recomendada**: Se descarta implementar la lógica de comparación heurística en scripts sueltos o en TypeScript. Se recomienda agregar al motor en Go el comando nativo `cpamc-auto-switcher --rebalance` (o `--proactive`), el cual es invocado de manera segura y serializada por la extensión de Pi en el evento `session_start` [S-001, S-002, S-008].

---

## Research Question

1. ¿Es factible implementar una re-evaluación automática de candidatos y rotación de líderes en los eventos del ciclo de vida de sesión (`/new`, `/reload`, `session_start`, cambio de sesión) entre Auto Switcher Pro y la extensión de Pi?
2. ¿Qué hooks y contratos expone el runtime `@earendil-works/pi-coding-agent` para detectar estos eventos con sus metadatos y discriminación de causa?
3. ¿Qué componentes y comandos requiere el motor Go de `cpamc-auto-switcher` para ejecutar una promoción proactiva limpia y atómica?
4. ¿Cuáles son los obstáculos técnicos críticos: concurrencia, cooldowns, invalidación de prompt caching en Antigravity, bloqueo de archivos en CLIProxyAPI, consistencia del catálogo de modelos y aislamiento de subagentes?
5. ¿Cómo diseñar una actualización quirúrgica y sin regresiones que resuelva el estancamiento en cuentas drenadas preservando la visión Active-Standby?

---

## Recommendation or Answer

### 1. Veredicto de Factibilidad: Totalmente Viable y Arquitectónicamente Óptimo
La propuesta no solo es factible, sino que resuelve la principal debilidad del esquema Active-Standby estricto: **la inercia hacia cuentas degradadas**. 
Bajo el esquema actual, una cuenta al 25% de cuota semanal (75% consumida) nunca rota porque el umbral de failover semanal es 95% [S-002, S-003, S-015]. Si el usuario se ausenta 5 horas y regresa a programar un feature grande con `/new`, el sistema somete a la cuenta de 25% a una sobrecarga que provocará un 429 o rotación de emergencia forzada a mitad de sesión.
Promover al candidato más fresco al arrancar una nueva sesión previene el colapso a mitad de tarea y permite que la cuenta fatigada descanse en reserva fría para regenerar su ventana rodante de 7 días [S-003, S-012].

### 2. Puntos de Anclaje Exactos en el Ciclo de Vida de Pi
En `@earendil-works/pi-coding-agent`, el gancho óptimo es `session_start` [S-006]:
```typescript
pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    // Discriminar explícitamente eventos de inicio o reemplazo de sesión
    if (event.reason === "new" || event.reason === "reload" || event.reason === "startup") {
        await triggerProactiveRebalance(ctx, event.reason);
    }
    // Continuar con el montaje de UI y sincronización
});
```
`SessionStartEvent.reason` provee la señal exacta [S-006, S-007]:
- `"new"`: El usuario escribió `/new` para comenzar una sesión desde cero.
- `"reload"`: El usuario ejecutó `/reload` para recargar el entorno.
- `"startup"`: Proceso de Pi recién arrancado en terminal.
- `"resume"`: Cambio a otra sesión persistida mediante `/resume` o navegador de sesiones.

Los turnos conversacionales regulares (`turn_start`, `turn_end`) y las llamadas a subagentes (`subagent_run` en `tool_result`) **NO** disparan `session_start`, garantizando que la rotación jamás interrumpa una conversación en curso [S-005, S-008].

### 3. Modelo de Decisión Histerético (Preservando Active-Standby)
Para impedir la oscilación continua (*thrashing*) entre sesiones cortas, el motor debe aplicar la siguiente regla matemática de rebalanceo proactivo en el perfil:

$$\text{Rotar a Reserva } R \iff (\text{Disp}(A) < \theta_{\text{floor}}) \land (\text{Disp}(R) - \text{Disp}(A) \ge \Delta_{\text{margin}})$$

Donde:
- $\text{Disp}(A)$: Cuota mínima remanente de la cuenta activa actual (ej. `25.0%`).
- $\theta_{\text{floor}}$: Umbral de agotamiento base (Depletion Floor), por defecto `50.0%` (o ventana de 5h consumida $\ge 80\%$).
- $\text{Disp}(R)$: Cuota mínima remanente de la mejor reserva candidata (ej. `100.0%`).
- $\Delta_{\text{margin}}$: Margen de ventaja necesario (Advantage Margin), por defecto `30.0%`.

**Evaluación del caso real del usuario (`agy2` 25% vs `agy2_1` 100%)**:
1. $\text{Disp}(agy2) = 25.0\% < 50.0\%$ $\rightarrow$ **Verdadero** (Activa fatigada).
2. $\text{Disp}(agy2\_1) - \text{Disp}(agy2) = 100\% - 25\% = 75.0\% \ge 30.0\%$ $\rightarrow$ **Verdadero** (Ventaja masiva).
3. **Decisión**: Promover `agy2_1` a activa (`agy2`), pasando el titular desgastado a reserva fría (`agy2_1`).
4. **Efecto de descanso**: Durante los próximos días, la cuenta desgastada no recibe peticiones, permitiendo que sus ventanas rodantes de Antigravity recuperen capacidad de forma natural.

---

## Key Findings

### 1. El Estado en Vivo de Producción Confirma la Asimetría
La ejecución de `cpamc-auto-switcher -list` en el entorno actual muestra la discrepancia en vivo [S-015]:
```text
STATUS      PROVIDER      PROFILE   ACCOUNT ID            PREFIX       5H CONSUMED   WEEKLY CONSUMED   MIN AVAILABLE
[ACTIVE]    antigravity   default   inf...tec@gmail.com   agy          11.7%         6.6%              88.3%
[RESERVE]   antigravity   default   mar...tro@gmail.com   agy_1        0.0%          47.3%             52.7%
[ACTIVE]    antigravity   2         wil...o11@gmail.com   agy2         23.0%         75.0%             25.0%
[RESERVE]   antigravity   2         wil...io9@gmail.com   agy2_1       N/A           0.0%              100.0%
```
- `agy2` tiene 75.0% consumido semanal (25.0% disponible).
- `agy2_1` tiene 0.0% consumido semanal (100.0% disponible).
- El comando `cpamc-auto-switcher --check -verbose --force` reporta: `[2] 5h 22.1%, weekly 74.3%` y **no conmuta** porque los umbrales de failover de emergencia son 90% (5h) y 95% (semanal) [S-003, S-015].
- Como resultado, cualquier sesión nueva o reinicio mantiene a `agy2` en el frente de batalla.

### 2. Contratos de Ciclo de Vida en `@earendil-works/pi-coding-agent`
La inspección de `types.d.ts` y `agent-session-runtime.ts` revela el ciclo de vida exacto de las sesiones en Pi [S-006, S-007]:
```typescript
export interface SessionStartEvent {
    type: "session_start";
    /** Why this session start happened. */
    reason: "startup" | "reload" | "new" | "resume" | "fork";
    /** Previously active session file. Present for "new", "resume", and "fork". */
    previousSessionFile?: string;
}

export interface SessionBeforeSwitchEvent {
    type: "session_before_switch";
    reason: "new" | "resume";
    targetSessionFile?: string;
}

export interface SessionShutdownEvent {
    type: "session_shutdown";
    reason: "startup" | "reload" | "new" | "resume" | "fork" | "quit";
    targetSessionFile?: string;
}
```
Flujo de ejecución en `/new` y `/reload` [S-007]:
1. El usuario invoca `/new` o `/reload`.
2. Pi emite `session_before_switch` (`reason: "new"`).
3. Pi ejecuta `teardownCurrent()` y emite `session_shutdown`.
4. Se destruye el runtime saliente y se instancia el nuevo `SessionManager`.
5. Pi emite `session_start` (`reason: "new"` o `"reload"`).
6. **Momento Crítico**: Los manejadores registrados con `pi.on("session_start", ...)` se ejecutan antes de que el usuario envíe su primer mensaje en la nueva sesión.

### 3. Anatomía del Mecanismo de Promoción en `cpamc-auto-switcher`
En `internal/switcher/switcher.go`, la función `SwitchToAccount` ya contiene la lógica certificada para conmutar cualquier cuenta por prefijo, ID o correo [S-002]:
```go
// Step 1: Promover cuenta objetivo al prefijo activo
s.client.PatchAuthPrefix(ctx, nameTarget, activePrefix)

// Step 2: Degradar cuenta activa anterior al prefijo de reserva
s.client.PatchAuthPrefix(ctx, nameActive, newReservePrefix)
```
- La conmutación actualiza el campo `prefix` y `note` en el almacenamiento de credenciales de CLIProxyAPI mediante `PATCH /v0/management/auth-files/fields` [S-001, S-002].
- El proceso es seguro, incluye rollback si el segundo paso falla, y se ejecuta en menos de 100 ms [S-002].
- Lo que **carece** actualmente la CLI de Go es un flag para disparar esta evaluación proactiva de forma desatendida (`--rebalance` o `--proactive`), ya que hoy solo admite `--switch <identificador_manual>` o `--check` (que evalúa failover de emergencia) [S-001].

### 4. Aislamiento entre Promoción Intra-Pool y Selección Inter-Pool
Es fundamental distinguir las dos capas del sistema:

| Dimensión | Capa Operativa | Qué Cuentas Evalúa | Impacto en el Modelo de Pi | Dónde se Ejecuta |
| :--- | :--- | :--- | :--- | :--- |
| **Promoción Intra-Pool (Líder vs Reserva)** | Plano de Credenciales (CLIProxyAPI) | Cuentas del mismo perfil (ej. `agy2` vs `agy2_1`). | **Nulo**. El modelo de Pi sigue siendo `cpamc/agy2/gemini-3.8-flash-high`. CLIProxyAPI entrega la nueva credencial física tras el prefijo. | Go Core (`cpamc-auto-switcher --rebalance`) disparado por `session_start`. |
| **Selección Inter-Pool (Líder A vs Líder B)** | Plano de Aplicación (Pi TUI) | Líderes activos de distintas familias (ej. `cpamc/agy/...` al 88% libre vs `cpamc/agy2/...` al 25% libre). | **Activo**. Cambia el modelo configurado en Pi invocando `pi.setModel(bestLeader)`. | Extension TS (`picker.ts` / `/cpamc-model auto`) [S-009, S-010]. |

El problema específico planteado por el usuario (`agy2 25% │ agy2_1 100%`) corresponde al **100% a la Promoción Intra-Pool**. Al intercambiar los prefijos físicos en CLIProxyAPI, la reserva fresca pasa a ser `agy2` y asume el liderazgo sin que Pi deba modificar su configuración de modelo [S-002, S-004].

---

## Evidence Review

| Afirmación / Requisito | Fuente | Nivel de Evidencia | Justificación |
| :--- | :--- | :--- | :--- |
| Pi emite `session_start` con `reason` tipado (`startup`, `reload`, `new`, `resume`) | [S-006], [S-007] | PRIMARY | Definición estricta de TypeScript en `SessionStartEvent` en `@earendil-works/pi-coding-agent`. |
| `agy2` se encuentra estancada en 25% disponible mientras `agy2_1` está al 100% | [S-015] | PRIMARY | Salida viva de `cpamc-auto-switcher -list` ejecutada en la máquina local. |
| La rotación automática actual exige 90% (5h) o 95% (semanal) | [S-002], [S-003] | PRIMARY | Implementación de `ShouldRotate` en `internal/quota/quota.go` y validación de `config.json`. |
| La mutación de prefijos en CLIProxyAPI es soportada nativamente vía PATCH | [S-001], [S-002] | PRIMARY | Método `PatchAuthPrefix` probado y operativo en `internal/client/client.go`. |
| La rotación mid-session invalida el Context Caching (228k+ tokens por turno) | [S-012], [S-015] | IMPLEMENTATION | Telemetría de sesiones anteriores muestra `cacheRead: 228,309 tokens` ligados a la credencial OAuth. |
| La rotación en `session_start` o tras inactividad no afecta la caché | [S-007], [S-012] | IMPLEMENTATION | La caché en sesión nueva arranca en 0, y tras 5-6 horas la caché de Google expira por TTL de inactividad. |
| Los subagentes no disparan `session_start` | [S-006], [S-008] | IMPLEMENTATION | Los subagentes se ejecutan como eventos `tool_result` (`subagent_run`), desacoplados de `session_start`. |

---

## Trade-offs and Risks

### 1. Riesgo de Oscilación Continua (*Thrashing*) y "Efecto Precipicio"
- **Riesgo**: Si el rebalanceo proactivo promoviera cuentas por diferencias marginales (ej. cuenta A tiene 49% y cuenta B tiene 51%), cada `/new` o `/reload` alternaría de cuenta. Esto desgastaría ambas cuentas en paralelo y provocaría que ambas agoten su cuota semanal al mismo tiempo (*The Cliff Effect*) [S-012, S-013].
- **Mitigación Quirúrgica**: Implementar un filtro histerético de dos etapas:
  1. *Depletion Floor*: La cuenta activa DEBE tener menos del 50% de cuota remanente (o ventana 5h $\ge 80\%$ consumida). Si la activa tiene 70%, no se rota aunque la reserva tenga 100%.
  2. *Advantage Margin*: La reserva DEBE superar a la activa por al menos 30 puntos porcentuales de cuota libre.

### 2. Concurrencia y Bloqueos de Archivo en CLIProxyAPI
- **Riesgo**: Si `session_start` dispara una conmutación de prefijos en segundo plano mientras otra rutina (como el monitor de 25s o la detección de 429) ejecuta `cpamc-auto-switcher`, dos procesos podrían parchear los archivos en paralelo generando estados inconsistentes [S-002, S-008].
- **Mitigación**: 
  - En TypeScript: Integrar la llamada dentro de la cola serializada de Promesas ya existente en `failover.ts` (`queue = queue.then(...)`) [S-008].
  - En Go: Utilizar el archivo de estado `state.json` con cooldown mínimo (ej. 2 minutos) para impedir ejecuciones redundantes ráfaga tras ráfaga [S-001].

### 3. Límites de Tasa de la API de Cuotas de Google (*RetrieveUserQuotaSummary*)
- **Riesgo**: Si el usuario emite `/reload` repetidamente tres veces en 10 segundos, consultar las cuotas a Google en cada recarga podría disparar un error 429 en el endpoint de gestión de Google Cloud Code [S-001, S-003].
- **Mitigación**: Respetar una ventana de frescura en caché (ej. si las cuotas fueron consultadas hace menos de 90 segundos en `state.json`, reutilizar la lectura en memoria o salir inmediatamente de forma no bloqueante) [S-001, S-010].

### 4. Límites de Subagentes y Tareas en Segundo Plano
- **Riesgo**: Si un subagente finaliza una tarea y Pi emite eventos internos, ¿podría dispararse una rotación inesperada a mitad del turno del agente principal?
- **Mitigación**: No. La inspección del código confirma que los subagentes operan bajo `tool_execution_start` y `tool_result` (`subagent_run`), los cuales no emiten `session_start` [S-006, S-008]. La rotación proactiva solo escucha eventos donde `event.reason` sea `"new"`, `"reload"` o `"startup"`.

---

## Alternatives Considered

### Alternativa 1: Balanceo por Petición Round-Robin en CLIProxyAPI (Active-Active)
- **Mecánica**: Configurar CLIProxyAPI para repartir cada prompt 50/50 entre `agy2` y `agy2_1`.
- **Por qué se descarta**: 
  1. Destruye el Context Caching de Google (perdiendo cientos de miles de tokens de caché por turno, aumentando latencia 3x) [S-012].
  2. Provoca el colapso simultáneo de todas las cuentas al final de la semana (*The Cliff Effect*) [S-012, S-013].

### Alternativa 2: Implementación Exclusiva en TypeScript dentro de la Extensión de Pi
- **Mecánica**: La extensión de Pi ejecuta `cpamc-auto-switcher -list`, parsea el texto con expresiones regulares en TypeScript, decide quién es el mejor candidato y luego llama a `cpamc-auto-switcher -switch <candidato>`.
- **Por qué es subóptima**:
  1. Frágil: depende del formato de columnas de la salida estándar de la CLI [S-001, S-010].
  2. Carece de tipos seguros sobre las marcas temporales `ResetTime` de cada bucket [S-003].
  3. No protege contra rollbacks fallidos en el plano de red [S-002].
  4. Queda acoplada exclusivamente a Pi, impidiendo que herramientas CLI o gentle-shell se beneficien del rebalanceo.

### Alternativa 3: Rebalanceo Nativo en Go (`--rebalance`) con Hook Limpio en Pi (Solución Recomendada)
- **Mecánica**: El motor Go implementa `RebalanceProvider` con cálculo preciso de cuotas, histeresis matemática y rollback atómico. La extensión de Pi simplemente invoca `cpamc-auto-switcher --rebalance` al recibir `session_start` (`reason: "new" | "reload" | "startup"`).
- **Ventajas**:
  1. Robusta, compilada y tipada en Go con 0 dependencia de parsing de texto [S-002].
  2. Protegida con tests unitarios en `switcher_test.go` [S-002].
  3. Ejecutable tanto desde Pi como desde la terminal o scripts de mantenimiento.

---

## Unknowns and Limits

- **Ventana Rodante Semanal vs Ventana Fija de 5 Horas**: En Google Antigravity, la ventana de 5 horas se resetea 5 horas después del último uso. La ventana semanal es rodante (cada token expira exactamente a los 7 días de haberse emitido). Por ello, si una cuenta tiene 25% de cuota semanal, permanecerá en 25% hasta que se cumplan 7 días de las peticiones que consumieron el 75% previo. Dejarla en reposo en reserva fría es la única forma efectiva de permitir que esos tokens expiren y la cuenta se recupere.
- **Cuentas utilizadas fuera de Pi**: Si el usuario utiliza `wil...o11@gmail.com` en otra herramienta externa fuera del ecosistema CLIProxyAPI, su cuota semanal variará independientemente del switcher.

---

## Recommended Next Actions

### Fase 1: Extensión del Motor Go (`cpamc-auto-switcher`)
1. **Añadir flag `--rebalance` (o `--proactive`) en `cmd/cpamc-auto-switcher/main.go`** [S-001]:
   - Flags configurables con defaults sensatos:
     - `--min-advantage`: Default `30.0` (% de cuota disponible adicional que debe ofrecer la reserva).
     - `--depletion-floor`: Default `50.0` (% de cuota disponible por debajo del cual la activa se considera fatigada).
2. **Implementar método `RebalanceProvider` en `internal/switcher/switcher.go`** [S-002]:
   - Evaluar para cada perfil:
     - Si la cuenta activa está por debajo de `depletionFloor` (o tiene 5h $\ge 80\%$ consumido):
       - Buscar la reserva con mayor cuota disponible (`MinAvailableRemaining()`).
       - Si `reserva.MinAvailableRemaining() - activa.MinAvailableRemaining() >= minAdvantage`:
         - Ejecutar el swap de 2 pasos vía `PatchAuthPrefix`.
         - Devolver `[REBALANCED] promoted <reserva> (<quota>%) to <activePrefix>, demoted <activa> (<quota>%)`.
3. **Añadir Tests Unitarios en `internal/switcher/switcher_test.go`** [S-002]:
   - Caso 1: Activa al 25%, Reserva al 100% $\rightarrow$ Promoción ejecutada exitosamente.
   - Caso 2: Activa al 75%, Reserva al 100% $\rightarrow$ Sin conmutación (preserva activo).
   - Caso 3: Activa al 25%, Reserva al 35% $\rightarrow$ Sin conmutación (ventaja insuficiente de 10% $< 30\%$).
   - Caso 4: Aislamiento estricto de perfiles (rebalancear perfil `2` no afecta perfil `default` ni `son`).

### Fase 2: Integración en la Extensión de Pi (`extensions/cpamc-auto-switcher`)
1. **Hook de Ciclo de Vida en `extensions/cpamc-auto-switcher/index.ts`** [S-005, S-006]:
   - Modificar el listener de `session_start` para capturar `event.reason`:
     ```typescript
     pi.on("session_start", async (event: any, ctx: ExtensionContext) => {
         clearTimer();

         if (event?.reason === "new" || event?.reason === "reload" || event?.reason === "startup") {
             await scheduleProactiveRebalance(ctx, event.reason);
         }

         // Inicialización y refresco normal del adaptador visual
         if (!adapter) {
             adapter = new CpamcTuiAdapter(ctx);
         } else {
             adapter.setContext(ctx);
         }
         ...
     });
     ```
2. **Encolamiento Seguro en `extensions/cpamc-auto-switcher/src/failover.ts`** [S-008]:
   - Implementar `scheduleProactiveRebalance(ctx, reason)` utilizando la misma cola de ejecución serializada de `failover.ts`, ejecutando `cpamc-auto-switcher --rebalance`.
   - Si la salida contiene `[REBALANCED]`, emitir notificación no intrusiva al usuario:
     `ctx.ui.notify("🔄 Rebalanceo de sesión: reserva fresca promovida a líder activo", "info")`.
3. **Actualización Inmediata de Telemetría**:
   - Forzar la actualización del almacén `querySwitcherAccounts(true)` y del adaptador TUI para que el footer refleje instantáneamente el nuevo líder al 100%.
