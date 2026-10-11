# Auditoría Arquitectural: Desglose de Consumo de `agy2` (32%) vs Reserva Fría `agy2_1` (100%) y Mecánica de Rotación

## Executive Summary

El usuario observa en el footer del TUI la telemetría:
```text
│▶ agy2 32% ↻ 3h/3d │ ⏭ agy2_1 100% ↻ 7d/7d
```
Y cuestiona:
1. ¿Por qué la cuenta activa `agy2` se sigue drenando (bajando al 32% disponible) mientras la reserva `agy2_1` permanece intocada al 100% con 7 días intactos?
2. ¿Por qué el sistema no conmutó automáticamente a la cuenta con mayor cuota disponible?
3. ¿Qué ocurrió con las mejoras de "Least-Used Routing" implementadas previamente?

Tras auditar exhaustivamente el código Go del motor (`internal/quota/quota.go`, `internal/switcher/switcher.go`), la configuración local (`~/.local/share/cpamc-auto-switcher/config.json`), las extensiones de Pi (`extensions/cpamc-auto-switcher/src/picker.ts`, `provider.ts`, `failover.ts`, `store.ts`), el componente de footer de `j0k3r-theme` (`src/quota.ts`) y los registros de arquitectura (ADR-06 y la auditoría previa `2026-10-07-0826`), las conclusiones técnicas son contundentes:

1. **`agy2` NO ha alcanzado el umbral de rotación**: El valor visual `32%` representa cuota **disponible** (remanente). El consumo acumulado semanal es del **68.6%**, y el de 5 horas es de apenas **14.6%** [S-001, S-002]. Los umbrales de disparo en `config.json` son **90.0%** (5 horas) y **95.0%** (semanal) [S-003]. Para el switcher, `agy2` está en estado **HEALTHY** y con 26.4% de margen semanal antes de disparar rotación [S-002, S-004].
2. **Naturaleza del Switcher: Failover (Active-Standby), NO Load Balancer (Active-Active)**: `cpamc-auto-switcher` nunca fue diseñado para balancear peticiones en vivo ni para alternar cuentas turno a turno. Es un demonio de rescate que conmuta por sustitución de prefijos cuando la cuenta activa cruza el 90%/95% de agotamiento [S-004, S-005]. `agy2_1` es estrictamente una **reserva fría (cold standby)** que no recibe tráfico hasta que el líder cae [S-005].
3. **Alcance real de las mejoras previas (ADR-06)**: Lo implementado en ADR-06 ("Least-Used Routing") fue un **ordenamiento en tiempo de selección interactiva de modelos** dentro de `/cpamc-model` (para elegir entre líderes de familias distintas como `agy` vs `agy2`), preservando explícitamente a las reservas frías para evitar el "Efecto Precipicio" (*The Cliff Effect*) [S-006, S-007]. No se modificó el despacho de peticiones HTTP en el proxy CLIProxyAPI ni se habilitó consumo simultáneo entre un líder y sus reservas [S-005, S-006].
4. **Desconexión entre el modelo mental y la realidad del código**: El usuario espera un balanceador dinámico que reparta el consumo por turnos o peticiones para gastar parejo. El sistema en ejecución es un router estático prefijo-credencial con un vigilante out-of-band que solo interviene en emergencias [S-004, S-005].

---

## Research Question

1. ¿Por qué las peticiones dentro de una sesión activa de Pi continúan impactando exclusivamente en `agy2` sin rotar a `agy2_1`?
2. ¿Cuáles son las condiciones matemáticas y lógicas exactas para que `cpamc-auto-switcher` ejecute una rotación automática?
3. ¿Por qué `agy2` con 32% disponible (68% consumido) no dispara el switcher si `agy2_1` tiene 100% de cuota?
4. ¿Cuál es la diferencia técnica entre el ranking de selección en `/cpamc-model` y el enrutamiento por petición en el proxy?
5. ¿Existe en CLIProxyAPI / Pi algún balanceador por petición entre reservas del mismo pool, o es `agy2_1` una reserva fría estricta?
6. ¿Cómo contrasta el modelo mental del usuario con la arquitectura real del sistema?

---

## Recommendation or Answer

### 1. La Causa Raíz Inmediata: Por qué `agy2` sigue drenándose

La telemetría viva extraída directamente de la CLI demuestra el estado real:
```text
STATUS      PROVIDER      PROFILE   ACCOUNT ID            PREFIX   5H CONSUMED   WEEKLY CONSUMED   MIN AVAILABLE
[ACTIVE]    antigravity   2         wil...o11@gmail.com   agy2     14.6%         68.6%             31.4% (≈32%)
[RESERVE]   antigravity   2         wil...io9@gmail.com   agy2_1   N/A           0.0%              100.0%
```

El cálculo del motor en `internal/quota/quota.go` (`ShouldRotate`) evalúa:
- `5h Consumed (14.6%) >= fiveHourThreshold (90.0%)` $\rightarrow$ **FALSO**
- `Weekly Consumed (68.6%) >= weeklyThreshold (95.0%)` $\rightarrow$ **FALSO**

Dado que ninguna condición se cumple, la función retorna `(false, "quotas within acceptable thresholds")` [S-002]. 

Para el demonio de rotación, la cuenta `agy2` tiene aún **31.4% de cuota disponible** (más de 3 días de vigencia antes del reset). El demonio no tiene ninguna instrucción de rotar solo porque exista una reserva al 100%. Las reservas están diseñadas para entrar únicamente cuando la cuenta en producción colapsa [S-004, S-005].

### 2. Diferencia entre Selección en `/cpamc-model` y Enrutamiento en el Proxy

| Capa | Qué hace | Momento de Ejecución | Qué cuentas evalúa |
| :--- | :--- | :--- | :--- |
| **Picker (`/cpamc-model`)** [S-006, S-008] | Ordena el menú interactivo de Pi colocando primero al líder con más cuota libre (ej. `agy2` vs `agy`). | **Una sola vez**, cuando el usuario escribe `/cpamc-model` o `/cpamc-model auto`. | Solo **Líderes Activos** (`👑`). Las reservas (`_1`, `_2`) están explícitamente excluidas o en el fondo. |
| **Data Plane (Proxy HTTP :8317)** [S-005, S-009] | Recibe `POST /v1/chat/completions` con `model="agy2/..."`. Busca la credencial cuyo prefijo sea exactamente `"agy2"` y le despacha el 100% de los tokens. | **En cada mensaje / turno del agente**. | **Ninguna**. Cero evaluación de cuota, cero comparación de candidatos, cero balanceo. |
| **Control Plane (`cpamc-auto-switcher`)** [S-004, S-010] | Monitorea si la cuenta activa superó el 90% (5h) o 95% (semanal). Si lo superó, renombra archivos (`agy2 <-> agy2_1`). | **Out-of-band**: al finalizar turnos en Pi (`turn_end`), por error 429, o manualmente. | Evalúa el líder; si y solo si el líder superó el umbral, busca la mejor reserva. |

Las mejoras de ADR-06 aportaron visibilidad y orden en el **Picker**, pero nunca crearon un balanceador en el **Data Plane** [S-005, S-006]. Una vez que el usuario eligió un modelo con prefijo `agy2`, la sesión entera enviará todas sus peticiones a la credencial física de `agy2` de manera determinista hasta que el demonio decida renombrar el archivo en disco [S-004, S-005].

---

## Key Findings

### 1. Umbrales de Disparo en la Configuración Real (`config.json`)
El archivo de configuración en `~/.local/share/cpamc-auto-switcher/config.json` define:
```json
{
  "endpoint": "http://localhost:8317",
  "provider": "antigravity",
  "active_prefix": "agy",
  "reserve_prefix_prefix": "agy_",
  "five_hour_threshold": 90.0,
  "weekly_threshold": 95.0,
  "cooldown_minutes": 5.0
}
```
- El umbral de rotación es de **90% de consumo en la ventana de 5 horas** o **95% de consumo en la ventana semanal** [S-003].
- Con `agy2` al 68.6% consumido (31.4% libre), la cuenta está aún **26.4 puntos porcentuales por debajo del límite semanal** y **75.4 puntos por debajo del límite de 5 horas** [S-001].
- Por tanto, la rotación automática no se ha activado porque **el sistema está operando exactamente conforme a su especificación de diseño** [S-002, S-004].

### 2. Por qué no se tocan las reservas frías: La Protección contra el "Efecto Precipicio" (*The Cliff Effect*)
El usuario percibe que tener una cuenta al 100% sin usar es un "desperdicio" o una falla de rotación. Sin embargo, en arquitecturas con ventanas de cuota fijas como Google Antigravity / Google Cloud Code, este comportamiento es una decisión deliberada de supervivencia [S-005, S-006]:
- **Ventanas rodantes de Antigravity**: Las cuotas de inferencia tienen una ventana corta de 5 horas y una ventana larga semanal (7 días) [S-001, S-011].
- **Si se aplicara rotación/balanceo prematuro (gasto uniforme)**: Si el sistema enviara 1 petición a `agy2` y 1 petición a `agy2_1` para "gastar parejo", ambas cuentas acumularían gasto a la par. En cuestión de días, **ambas cuentas cruzarían el 100% de agotamiento en la misma hora**, dejando al usuario sin ninguna cuenta disponible en todo el pool [S-005].
- **El modelo Active-Standby**: `agy2` asume todo el peso hasta llegar al 90%. En ese instante crítico, `agy2_1` (fresca al 100%) asume el relevo como cuenta activa. Mientras `agy2_1` se consume, `agy2` descansa en reposo total, lo que permite que su ventana de 5 horas se regenere al 100% [S-004, S-005].

### 3. El Catálogo de Modelos Oculta y Aísla las Reservas por Diseño
En `extensions/cpamc-auto-switcher/src/provider.ts` (líneas 376-382) y en la resolución dinámica de modelos:
```typescript
const prefix = trimmed.slice(0, slashIndex);

// Omitir prefijos de cuentas de reserva (ej. _1, _2)
if (/_(\d+)$/.test(prefix)) {
    return false;
}
```
- CLIProxyAPI y la extensión de Pi filtran activamente los prefijos que terminan en `_1`, `_2`, etc. [S-008].
- Ni el usuario ni Pi pueden enviar directamente una petición a `cpamc/agy2_1/gemini-3.8-flash-high` porque ese modelo no existe en el catálogo publicado [S-008].
- `agy2_1` no es una ruta alternativa de balanceo: es un token inactivo que solo cobra vida cuando el switcher renombra el archivo en el disco de CLIProxyAPI cambiando su prefijo de `agy2_1` a `agy2` [S-004, S-005].

### 4. Origen de la Indicación Visual en el Footer
En la extensión del tema de Pi (`~/.pi/agent-j0k3r/extensions/j0k3r-theme/src/quota.ts`), la función `computeProfileLoop` empareja la cuenta activa del perfil con su primera reserva [S-012]:
```typescript
const parent = profileAccounts.find((a) => a.status === "[ACTIVE]");
const reserves = profileAccounts.filter((a) => a.status === "[RESERVE]");
let nextAcc = reserves.length > 0 ? reserves[0]! : parent;
```
Y formatea la línea:
```text
│▶ agy2 32% ↻ 3h/3d │ ⏭ agy2_1 100% ↻ 7d/7d
```
- `▶ agy2 32% ↻ 3h/3d`: Cuenta activa en ejecución (`▶`), con 32% de cuota mínima restante, reseteo de 5h en 3 horas y reseteo semanal en 3 días [S-012, S-013].
- `⏭ agy2_1 100% ↻ 7d/7d`: Próxima en la cola de contingencia (`⏭`), en reposo al 100%, ventanas intactas a 7 días [S-012, S-013].
- El símbolo `⏭` significa **siguiente en la fila de relevo (standby)**, no "cuenta activa secundaria en rotación paralela".

---

## Evidence Review

| Afirmación | Fuente | Calidad | Justificación |
| :--- | :--- | :--- | :--- |
| `agy2` tiene 68.6% consumido semanal y 14.6% en 5h (31.4% libre) | [S-001] | PRIMARY | Salida en vivo de `cpamc-auto-switcher -list`. |
| La rotación automática requiere $\ge 90\%$ (5h) o $\ge 95\%$ (semanal) | [S-002], [S-003] | PRIMARY | Código fuente en `internal/quota/quota.go:277-295` y archivo `config.json`. |
| La evaluación de `agy2` en vivo reporta umbrales no superados | [S-004] | PRIMARY | Ejecución de `cpamc-auto-switcher --check -verbose --force` devuelve `[2] 5h 14.6%, weekly 68.6%` sin rotar. |
| ADR-06 implementó ranking en el selector, no balanceo en el proxy | [S-006], [S-007] | PRIMARY | `docs/architecture/smart-least-used-routing.md` documenta expresamente que las reservas frías quedan resguardadas. |
| CLIProxyAPI no balancea reservas per-request en el Data Plane | [S-005], [S-009] | IMPLEMENTATION | `investigaciones/2026-10-07-0826` y código de `conductor_selection.go` confirman mapeo 1:1 de prefijos. |
| El widget del footer muestra cuota remanente y cuenta siguiente en cola | [S-012], [S-013] | IMPLEMENTATION | Código en `j0k3r-theme/src/quota.ts` y memoria Engram obs-1822. |

---

## Trade-offs and Risks

### Enfoque Actual: Active-Standby con Umbral Alto (90%/95%)
- **Ventajas**:
  - **Cero Efecto Precipicio**: La reserva `agy2_1` está 100% limpia y garantiza continuidad total cuando `agy2` se agote.
  - **Localidad de Caché**: Todas las peticiones van a la misma credencial OAuth, maximizando la tasa de acierto de caché de contexto (Context Caching) en Google Cloud Code.
  - **Estabilidad de Sesión**: Cero fluctuación de identidades de cuenta durante el trabajo interactivo del agente.
- **Riesgos / Desventajas**:
  - **Drenaje visible asimétrico**: La cuenta activa baja visiblemente hacia el rojo mientras la reserva parece "olvidada", generando ansiedad en el usuario.
  - **Margen estrecho de maniobra ante ráfagas**: Si un subagente consume de golpe muchos tokens semanales cuando la cuenta ya está al 68%, se alcanzará el umbral del 95% más rápido de lo previsto.

### Enfoque Alternativo: Rotación Temprana o Balanceo Dinámico
- **Ventajas**:
  - Sensación psicológica de reparto equilibrado entre cuentas.
- **Riesgos Críticos**:
  - **Agotamiento simultáneo**: Al consumir `agy2` y `agy2_1` a la vez, ambas cuentas alcanzarán el límite semanal al mismo tiempo, apagando todo el pool de Gemini.
  - Incompatibilidad con el diseño actual de prefijos de CLIProxyAPI (requeriría reescribir el core del proxy a un scheduler activo).

---

## Alternatives Considered

1. **Bajar los umbrales de rotación en `config.json`**:
   - Cambiar `weekly_threshold` a 70.0% o `five_hour_threshold` a 80.0%.
   - *Impacto*: Haría que `agy2` rote inmediatamente hacia `agy2_1`. Sin embargo, esto reduciría la ventana de explotación de cada cuenta y provocaría rotaciones frecuentes innecesarias.
2. **Forzar rotación manual inmediata vía CLI**:
   - Ejecutar `cpamc-auto-switcher -switch agy2_1` o promoverlo desde la UI de visual-profile.
   - *Impacto*: Conmuta a la cuenta al 100% de inmediato sin alterar la lógica del sistema.
3. **Usar `/cpamc-model auto` para cambiar entre líderes**:
   - Si el usuario tiene disponible el pool `agy` (Gemini 1) con 87% libre y `agy2` con 31% libre, ejecutar `/cpamc-model auto` cambiará la sesión activa de `agy2` hacia `agy`, que es el líder óptimo con más cuota disponible.

---

## Unknowns and Limits

- **Consumo fuera de Pi**: Si la cuenta `wil...o11@gmail.com` (`agy2`) es utilizada por otras herramientas externas fuera de Pi, su cuota semanal seguirá bajando independientemente de los turnos de Pi.
- **Tiempo de regeneración semanal**: La ventana semanal no se resetea de golpe a las 00:00 UTC; es una ventana móvil rodante de 7 días exactos contados desde el momento en que se emitieron los tokens.

---

## Recommended Next Actions

1. **Claridad para el Usuario (Explicación Directa)**:
   - Explicar al usuario que el sistema está funcionando **100% de acuerdo a su diseño**: `32%` es cuota libre restante (no consumida), el umbral de disparo semanal es 95%, y la cuenta `agy2_1` es el salvavidas de reserva para cuando `agy2` llegue a menos del 5% libre.
2. **Acción Inmediata si el usuario desea usar la cuenta al 100% ya mismo**:
   - Opción A (Cambiar de líder en Pi): Ejecutar `/cpamc-model auto` o `/cpamc-model` y seleccionar `cpamc/agy/...` (que tiene 87% de cuota libre) o rotar el pool.
   - Opción B (Conmutar manualmente la reserva): Ejecutar en terminal:
     ```bash
     cpamc-auto-switcher -switch agy2_1
     ```
     Esto promoverá a `agy2_1` a activa (`agy2`), pasando la cuenta con 32% a reserva fría.
3. **Ajuste Opcional de Umbrales (Si se desea rotación más sensible)**:
   - Si el usuario prefiere que la rotación se dispare cuando la cuenta alcance el 70% o 75% consumido (en lugar del 90%/95%), modificar `~/.local/share/cpamc-auto-switcher/config.json` con:
     ```json
     "five_hour_threshold": 80.0,
     "weekly_threshold": 75.0
     ```
