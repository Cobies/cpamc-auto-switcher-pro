# Análisis Crítico y Arquitectural de Enrutamiento en CPAMC / Auto Switcher Pro: Del Modelo Active-Standby (Failover) al Balanceo de Carga Activo (Active-Active)

## Executive Summary

El usuario ha planteado una interrogante fundamental sobre la lógica interna de **Auto Switcher Pro**:
> *"¿Cómo se maneja el reluteo? Si bien es cierto hay una cuenta principal de ruteo y veo cada vez que escojo, no veo que compare quién es el candidato ideal que debe pasar para el ruteo y de frente escoge inicial al padre. ¿Es así la lógica? Según tu punto crítico y juicio, ¿cómo está y qué se podría mejorar del 'AUTO SWITCHER PRO' o está bien así? No me complazcas diciéndome que está bien; debes examinar con criterio y lógica, ya que se espera que se gaste uniforme las cuentas de Gemini y no esté en una sola cuenta el peso."*

Tras una auditoría exhaustiva del código fuente del backend Go (`internal/switcher/`, `internal/quota/`), la extensión del cliente (`extensions/cpamc-auto-switcher/src/`), el plugin C-ABI (`plugins/visual-profile/`) y el motor upstream de CLIProxyAPI (`sdk/cliproxy/`), la conclusión técnica es rotunda:

1. **La observación del usuario es 100% exacta y correcta**: En el diseño actual, **NO existe ninguna evaluación de candidatos en el momento de procesar una petición**. El cliente solicita un modelo con un prefijo explícito (ej. `cpamc/agy/gemini-3.8-flash-high`) y CLIProxyAPI lo enruta directamente y de forma determinista a la credencial que posee dicho prefijo (`agy`). Todas las peticiones van al 100% hacia esa cuenta "padre" [S-004, S-006, S-007].
2. **Confusión de Paradigma (Causa Raíz)**: Auto Switcher Pro fue diseñado e implementado como un sistema **Active-Standby (Failover por Agotamiento)**, no como un **Load Balancer (Active-Active / Round-Robin)**. Las cuentas de reserva (`agy_1`, `agy_2`) no participan en el tráfico: son reservas frías ocultas que solo entran cuando la cuenta activa alcanza un umbral crítico de agotamiento (90% de 5h o 95% semanal) [S-001, S-002, S-004].
3. **El Juicio Crítico del CTO (Veredicto Técnico)**:
   - **Lo que está mal**: Vender o percibir el sistema como un "distribuidor inteligente de cuotas" cuando en realidad es un *renombrador reactivo de prefijos en segundo plano*. Concentrar todo el tráfico en una sola cuenta agota agresivamente sus límites de ráfaga (5h) y genera fallos cuando hay ráfagas de agentes o subagentes concurrentes.
   - **El riesgo oculto del "Gasto Uniforme Puro" (The Cliff Effect)**: El usuario asume que un gasto 100% uniforme es el escenario ideal. **Esto es una trampa arquitectural en Google Antigravity**. Antigravity funciona con ventanas fijas de reseteo (5 horas y 7 días) [S-008, S-012]. Si 4 cuentas se consumen exactamente a la vez (Round-Robin puro al 25% c/u), **las 4 cuentas se agotarán en el mismo minuto**. Cuando eso ocurra, la infraestructura completa quedará paralizada sin cuentas de reemplazo. En cambio, el modelo Active-Standby permite que la Cuenta A se recupere durante su ventana de 5h mientras la Cuenta B asume la carga.
4. **La Solución Arquitectural Recomendada**: El camino óptimo no es ni el Active-Standby primitivo actual ni el Round-Robin ciego, sino un **Balanceador Proactivo por Cuota Residual Escalonada (Tiered / Weighted Least-Used)** implementado en el plano de datos (Data Plane) mediante la capacidad nativa `scheduler` de CLIProxyAPI [S-009, S-011].

---

## Research Question

1. ¿Por qué las peticiones de inferencia impactan siempre inicialmente en la cuenta "padre" o activa sin comparar en tiempo real a los candidatos ideales?
2. ¿Cómo y en qué momento exacto se evalúan los candidatos para la rotación frente a la selección de ruta inicial?
3. ¿Por qué el consumo de cuota no se distribuye de manera uniforme entre las cuentas de Gemini en el ecosistema actual?
4. Desde un juicio crítico e imparcial de CTO: ¿cuáles son los defectos, limitaciones y fortalezas de la arquitectura de Auto Switcher Pro, y qué mejoras concretas deben implementarse?

---

## Recommendation or Answer

### 1. Desmitificando la Lógica Actual: ¿Por qué va de frente al padre?

El flujo de una petición en el sistema actual es el siguiente:

```
[Usuario / Agente Pi]
        │
        ▼ (Selecciona 'cpamc/agy/gemini-3.8-flash-high' en /cpamc-model)
[Dynamic Provider (provider.ts)]
        │  * Filtra todas las reservas (regex /_(\d+)$/ oculta agy_1, agy_2).
        │  * Expone ÚNICAMENTE el prefijo padre ('agy').
        ▼ (Envía HTTP POST a :8317 con model="agy/gemini-3.8-flash-high")
[CLIProxyAPI Engine]
        │  * Lee prefijo 'agy'.
        │  * Busca en su ModelRegistry la credencial con prefix="agy".
        │  * Despacha el 100% del tráfico a esa credencial física.
        │  * Cero comparación de candidatos. Cero balanceo.
        ▼
[Google Cloud Code / Antigravity Upstream]
        │ (Cuenta física de 'agy' absorbe 100% del consumo)
```

La comparación de candidatos **NO existe en el Data Plane (la ruta de la petición)**. Solo existe en el **Control Plane (el demonio de rotación)** cuando ocurre una de dos cosas:
- El hook de Pi (`failover.ts`) detecta un HTTP 429 o finaliza un turno y llama a `cpamc-auto-switcher` [S-003].
- Se ejecuta manualmente o por cron `cpamc-auto-switcher` [S-001].

Cuando ese demonio corre, mira la cuenta activa. Si la cuenta activa está por debajo del 90% (5h) y 95% (semanal), **el demonio no hace nada** y retorna `[OK]`. Solo si supera el umbral, busca la mejor reserva por cuota disponible y hace un intercambio de prefijos (`agy_1 <-> agy`) [S-001].

### 2. Veredicto y Juicio Crítico de CTO

| Dimensión | Estado Actual en Auto Switcher Pro | Juicio Crítico de CTO |
|---|---|---|
| **Arquitectura de Enrutamiento** | Active-Standby reactivo (1 activo, N reservas frías) [S-001, S-004]. | **Rudimentaria**. Funciona para failover de emergencia, pero es engañosa para quien espera balanceo inteligente de carga. |
| **Punto de Decisión** | Out-of-band (después de la petición o por error 429) [S-003]. | **Tardío**. Si la cuenta líder entra en un 429 brusco, la petición en curso falla o sufre latencia antes de que el script externo despierte. |
| **Distribución de Carga** | 100% sobre la cuenta activa, 0% en reservas [S-001, S-006]. | **Asimétrica**. Provoca estrangulamiento prematuro de ráfagas (RPM/TPM y cuota de 5 horas). |
| **Efecto Cliff (Riesgo de Agotamiento Simultáneo)** | Protegido por diseño (las reservas no se tocan hasta que el líder cae) [S-001]. | **Ventaja no intencional**. Si se implementara un Round-Robin ingenuo, todas las cuentas caerían a la vez a 0% cuota. |
| **Acoplamiento con la UI** | Fuerte: los prefijos mutan en los auth files (`agy` pasa a `agy_1`) [S-001, S-010]. | **Frágil**. El renombrado muta archivos en disco y puede provocar desincronización con el catálogo en caché de Pi [S-004]. |

---

## Key Findings

### 1. El Catálogo Oculta Deliberadamente a los Candidatos (`provider.ts:376-382` y `picker.ts:70-90`)
En la extensión de Pi (`extensions/cpamc-auto-switcher/src/provider.ts` y `cliproxyapi-dynamic-provider.ts`):
```typescript
const prefix = trimmed.slice(0, slashIndex);

// Omitir prefijos de cuentas de reserva (ej. _1, _2)
if (/_(\d+)$/.test(prefix)) {
    return false;
}
```
- Cualquier cuenta que tenga sufijo `_1`, `_2`, etc., es **eliminada del menú de selección** [S-004].
- Aunque el selector `/cpamc-model` decora visualmente al líder con una corona (`👑`) y a las reservas con (`🔄`) [S-005], las reservas ni siquiera aparecen como opciones ejecutables directas para el usuario.
- El usuario solo puede escoger `agy`, `agy2`, `agy_son`, `agy_opus`.
- Dado que CLIProxyAPI solo asigna `agy` a **un único archivo de autenticación**, cada vez que el usuario elige `agy/...`, el enrutador no tiene ninguna alternativa: solo hay un candidato visible y disponible [S-004, S-006].
- Esta estructura proviene del motor de virtualización (`virtualize.go` [S-010]), que clona credenciales físicas imponiendo prefijos rígidos con listas de `excluded_models`.

### 2. Restricción Estricta de Cuenta Activa Única (`internal/switcher/switcher.go:444-448`)
En el motor backend Go:
```go
if parsed.IsActive {
    if active != nil {
        return nil, fmt.Errorf("multiple active accounts found with prefix %q for profile %q (provider %s): %s and %s",
            activePrefix, profile, provider, active.Entry.ID, acc.Entry.ID)
    }
    active = acc
}
```
- El backend aborta con un error fatal si más de una cuenta comparte el prefijo activo `agy`.
- La arquitectura prohíbe explícitamente que dos cuentas coexistan bajo la misma ruta pública. Esto imposibilita que el selector nativo de CLIProxyAPI haga round-robin entre cuentas del mismo pool [S-001, S-007, S-012].

### 3. La Lógica de Evaluación de Candidatos es Exclusivamente de Rescate (`internal/switcher/switcher.go:527-580`)
La función `RunProvider` ejecuta los siguientes pasos:
1. **Paso 1**: Descarga cuotas de todas las cuentas del proveedor [S-001].
2. **Paso 2**: Verifica la salud de la cuenta `active`.
3. **Paso 3**: Evalúa `active.Quota.ShouldRotate(fiveHourThreshold, weeklyThreshold)`.
   - Si `shouldRotate == false`: **Retorna de inmediato sin tocar nada**.
   - Las reservas no se inspeccionan ni se tocan [S-001, S-002].
4. **Paso 4**: Solo si `shouldRotate == true`:
   - Filtra reservas cuyo umbral no esté superado.
   - Ordena reservas por mayor cuota disponible (`minRemain`).
   - Selecciona `bestReserve` y ejecuta el intercambio directo de 2 pasos (`PatchAuthPrefix`) [S-001].

### 4. La Trampa del Gasto Uniforme: El "Efecto Precipicio" (The Cliff Effect)
El usuario solicita que el consumo sea uniforme entre todas las cuentas de Gemini. Es imperativo analizar las implicaciones matemáticas y operativas de esta solicitud:

- En Google Cloud Code / Antigravity, la cuota tiene dos cubos compartidos por familia [S-008, S-012]:
  1. **Límite de 5 Horas**: Ventana rodante de recuperación rápida.
  2. **Límite Semanal**: Ventana de volumen global de 7 días.
- **Caso A (Active-Standby Actual)**:
  - Cuenta 1 (`agy`) asume el 100% de la carga. Se consume en 2 horas y alcanza el 90%.
  - Se conmuta a Cuenta 2 (`agy_1`). Cuenta 2 pasa a ser `agy`.
  - Durante las siguientes 3 horas, el tráfico drena la Cuenta 2.
  - **Mientras tanto, la Cuenta 1 está en reposo**: Su ventana de 5 horas se regenera. Cuando la Cuenta 2 se agota, la Cuenta 1 ya ha recuperado cuota fresca.
- **Caso B (Gasto Uniforme Puro / Round-Robin 50/50 o 33/33/33)**:
  - Se envían peticiones alternadas a Cuenta 1, Cuenta 2 y Cuenta 3.
  - Las 3 cuentas acumulan tokens a la misma velocidad. Ninguna entra en reposo suficiente para regenerar completamente.
  - Al cabo de $X$ horas o días, **las 3 cuentas cruzan el 100% de consumo exactamente al mismo tiempo**.
  - **Consecuencia**: El usuario se queda con **cero cuentas utilizables** y debe esperar horas o días para que el reseteo semanal o de 5h se cumpla.

---

## Evidence Review

| Afirmación | Fuentes | Confianza | Justificación Técnica |
|---|---|---|---|
| CLIProxyAPI enruta `prefijo/modelo` a la única credencial con ese prefijo | [S-006][S-007][S-012] | HIGH | Código `service_models.go` y `conductor_selection.go`. No hay selección aleatoria si solo un auth-file posee el prefijo. |
| Las reservas están ocultas del selector de Pi por diseño | [S-004][S-005] | HIGH | `provider.ts` descarta `/_(\d+)$/`. Pi nunca ve `agy_1` ni `agy_2`. |
| La evaluación de candidatos no ocurre en la llamada de inferencia | [S-001][S-003] | HIGH | La inferencia viaja directo a :8317; el switcher se invoca en hooks de eventos posteriores o por CLI. |
| El backend prohíbe múltiples cuentas con el mismo prefijo activo | [S-001][S-010] | HIGH | `switcher.go:445` retorna error explícito ante duplicados de `activePrefix`. |
| Las cuotas de Antigravity son compartidas por familia y gobernadas por ventanas 5h/semanal | [S-002][S-008][S-012] | HIGH | Confirmado en vivo y por código en investigaciones previas (`retrieveUserQuotaSummary`). |

---

## Trade-offs and Risks

### Enfoque 1: Active-Standby con Failover (Statu Quo)
- **Ventajas**:
  - Maximiza la regeneración de la ventana de 5 horas en las cuentas de reserva que están descansando.
  - Localidad de caché contextual: la cuenta líder mantiene caliente la caché de prompts en los servidores de Google/Antigravity.
  - Comportamiento predecible y trazable: siempre se sabe exactamente qué cuenta está respondiendo.
- **Desventajas**:
  - Fatiga prematura de la cuenta activa ante ráfagas cortas de tokens.
  - Vulnerabilidad a errores transitorios: si la cuenta activa recibe un 429 inesperado, el agente experimenta interrupción hasta que el hook rota los prefijos.
  - Percepción de ineficiencia por parte del usuario (las reservas se ven "ociosas").

### Enfoque 2: Balanceo Activo Uniforme Puro (Round-Robin Ciego)
- **Ventajas**:
  - Consumo aparentemente equilibrado entre cuentas.
  - Multiplica el throughput instantáneo (RPM/TPM) al distribuir peticiones concurrentes entre múltiples credenciales.
- **Desventajas (Riesgo Crítico)**:
  - **Efecto Precipicio**: Agotamiento simultáneo de todas las cuentas del pool sin reservas de contingencia.
  - Pérdida de acierto de caché de contexto (ping-pong de sesiones entre diferentes tokens).
  - Incompatibilidad directa con la lógica actual de `switcher.go` (que exige prefijos únicos).

---

## Alternatives Considered

1. **Mantener el sistema tal como está (Rechazado)**: La queja del usuario es legítima; la arquitectura actual es frágil ante picos de uso y carece de arbitraje en el Data Plane.
2. **Convertir el pool a prefijo compartido con Round-Robin nativo de CLIProxyAPI**: Modificar `switcher.go` para permitir que varias cuentas tengan el prefijo `agy`, dejando que CLIProxyAPI use su `routing.strategy: round-robin`.
   - *Viabilidad*: Media. Requiere reescribir la convención de prefijos y mitigar el Efecto Precipicio.
3. **Migración a Escenario B2 (Prioridades Nativas + Cooldown)**: Eliminar prefijos y usar tiers nativos de prioridad [S-011].
   - *Viabilidad*: Parcial. Persisten los 429 de calentamiento por familia de Antigravity.

---

## Unknowns and Limits

- **Políticas de Cache de Contexto en Antigravity**: No está documentado públicamente si Google Cloud Code retiene caché de prompt a nivel de credencial OAuth o a nivel de modelo global. Si es por credencial, el Round-Robin incrementará el consumo total de tokens.
- **Comportamiento del Reseteo Semanal**: Cuando una cuenta agota su límite semanal, la regeneración no es continua sino escalonada en función de cuándo se consumieron los tokens hace 7 días.

---

## Recommended Next Actions: Propuesta Arquitectural de Mejora

Para responder con criterio de CTO y transformar "Auto Switcher Pro" en una solución de nivel empresarial, se recomiendan tres fases de evolución:

### Fase 1: Arquitectura Recomendada — Balanceador Inteligente "Least-Used Escalado" vía Plugin `scheduler`

En lugar de intercambiar prefijos en archivos JSON desde un proceso externo, se debe aprovechar la capacidad `scheduler` que ya posee el runtime de CLIProxyAPI [S-009, S-011]:

```
[Petición Entrante: /v1/chat/completions (Pool 'gemini')]
                     │
                     ▼
       [CLIProxyAPI Request Pipeline]
                     │
                     ▼ Invoca C-ABI: MethodSchedulerPick
         ┌───────────────────────────────────────────────┐
         │     Plugin 'Auto Switcher Pro' (Scheduler)     │
         │                                               │
         │  1. Lee cuotas en memoria del pool Gemini     │
         │  2. Descarta cuentas en cooldown o >90%       │
         │  3. Selecciona la cuenta con MENOR USO        │
         │     (Least-Used) con desfase intencional      │
         └───────────────────────────────────────────────┘
                     │ Retorna Credencial Elegida
                     ▼
       [Despacho directo a la mejor cuenta física]
```

**Ventajas de esta arquitectura**:
1. **Verdadera Comparación de Candidatos en Tiempo Real**: Cada petición evalúa quién es el mejor candidato antes de salir.
2. **Distribución Suave sin Efecto Precipicio**: El algoritmo no reparte 50/50 ciego; prioriza la cuenta con más cuota disponible pero mantiene un desfase para asegurar que nunca mueran todas al mismo tiempo.
3. **Eliminación de la Mutación de Prefijos**: No más escrituras en disco ni reemplazos de `agy` por `agy_1`. Las credenciales conservan su identidad fija.
4. **Resiliencia Instantánea a Errores 429**: Si una cuenta devuelve 429, el selector de CLIProxyAPI la enfría de inmediato y redirige la petición a la siguiente mejor cuenta sin intervención manual ni hooks externos [S-007, S-011].

### Fase 2: Mejora Inmediata en el Stack Actual (Sin romper la compatibilidad)

Si se desea optimizar el sistema actual de forma inmediata sin reescribir el motor C-ABI:
1. **Configurar dos Pools Activos Paralelos (`agy` y `agy2`)**:
   - Asignar cuentas físicas diferentes a `agy` y `agy2`.
   - En Pi o en los flujos de trabajo, distribuir las tareas (ej. agente principal en `agy`, subagentes o revisiones en `agy2`). Esto distribuye el peso de forma natural entre dos cuentas activas simultáneas.
2. **Ajustar Umbrales de Rotación Escalonados**:
   - Configurar el umbral de 5 horas a 80% en lugar de 90%. Esto fuerza la rotación antes de que la cuenta entre en estrangulamiento severo de ráfaga, permitiendo que la cuenta saliente se recupere con holgura mientras la reserva asume el turno.
3. **Persistir el Cooldown en CLIProxyAPI**:
   - Activar `routing.cooldown.save-cooldown-status: true` en `/home/wilox/services/cliproxy/config.yaml` para que las cuentas en enfriamiento no se reactiven erróneamente tras reinicios del contenedor [S-011, S-013].
