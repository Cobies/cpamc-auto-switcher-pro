# Guía de Arquitectura: Configuración Multi-Proyecto y Preservación de Prompt Caching

**Fecha**: 2026-10-22  
**Estado**: Canónico y Homologado  
**Ámbito**: `cpamc-auto-switcher-pro` / `extensions/cpamc-auto-switcher` / Pi / Gentle-Shell  
**Referencia**: Issue #7 (`docs(architecture): add multi-project setup guide and clarify prompt cache impact on shared pools`)

---

## 1. Contexto y Diagnóstico del Problema

Auto Switcher Pro implementa en RAM un enrutamiento con **Líder Dinámico Adherente (`ActiveLeader`)** por cada pool soberano registrado (`Pool-01-gemini`, `Pool-02-gemini`, `Pool-03-codex`, etc.). Esta adherencia está diseñada para maximizar la tasa de acierto del **Prompt Caching** (KV Cache) en los proveedores aguas arriba (Google Cloud Code / Antigravity y Anthropic Claude).

Sin embargo, cuando los desarrolladores trabajan simultáneamente en **múltiples proyectos o repositorios locales**, la falta de una guía operacional explícita suele inducir a dirigir todas las instancias de trabajo hacia un único pool compartido (generalmente `Pool-01-gemini`).

### 1.1 El Fenómeno del *Prompt Cache Thrashing*
Cuando dos o más repositorios con bases de código dispares, árboles AST distintos y system prompts diferentes alternan peticiones sobre el mismo líder físico:
1. El proyecto Alpha envía un turno con 40k tokens de contexto local.
2. Google Antigravity o Anthropic construyen y calientan el KV Cache para ese prefijo en el servidor.
3. Segundos después, el proyecto Beta envía una petición a la misma cuenta con un contexto totalmente diferente (otros archivos, otro README, otro historial).
4. El proveedor **invalida el KV Cache previo**, descartando los bloques de memoria y recalculando los tokens desde cero.
5. Al volver Alpha, su caché también ha sido destruido.

**Consecuencias observadas**:
- **Picos de Latencia (x2 a x4)**: Cada turno sufre el costo completo de prefijo no cacheado (Time to First Token disparado).
- **Consumo Excesivo de Tokens**: Se pierde la bonificación de descuento de tokens cacheados (~90% de ahorro en tokens de lectura).
- **Concentración y Fatiga de Cuota**: La cuenta líder de ese único pool se agota prematuramente por absorber la carga combinada de proyectos inconexos, mientras que cuentas hermanas en otros pools o reservas permanecen ociosas.

---

## 2. Decisión de Arquitectura: 1 Pool Soberano por Proyecto / Repositorio

Para erradicar el *cache thrashing*, la regla de oro operativa es:

> **Un proyecto o repositorio activo = Un Pool Soberano dedicado.**

```text
┌────────────────────────┐      ┌────────────────────────┐
│   Proyecto Alpha       │      │   Proyecto Beta        │
│   (Backend Go / K8s)   │      │   (Frontend React/Vite)│
└───────────┬────────────┘      └───────────┬────────────┘
            │                               │
   cpamc/Pool-01-gemini            cpamc/Pool-02-gemini
            │                               │
            ▼                               ▼
   ┌─────────────────┐             ┌─────────────────┐
   │ ActiveLeader #1 │             │ ActiveLeader #2 │
   │ (Warm KV Cache) │             │ (Warm KV Cache) │
   └─────────────────┘             └─────────────────┘
```

### Beneficios Inmediatos:
1. **100% Cache Hit Rate**: Cada líder mantiene su memoria KV caliente con el contexto del proyecto correspondiente entre turnos consecutivos.
2. **Distribución Natural de Cuota**: Cada proyecto consume el presupuesto de cuota de su propio grupo de cuentas (5h y semanal).
3. **Aislamiento de Fallos y Rotaciones**: Si el Proyecto Alpha entra en un bucle intensivo y dispara un HTTP 429 o activa una rotación predictiva, el Proyecto Beta no experimenta interrupciones ni degradación.

---

## 3. Recetas de Configuración para Clientes (Pi / Gentle-Shell)

Para evitar la fricción de tener que cambiar manualmente el modelo en la interfaz de usuario al saltar de un directorio a otro, se proporcionan recetas directas para vincular la configuración local del repositorio al pool soberano deseado.

### Receta A: Configuración Local por Repositorio (`.pi/settings.json`)
En la raíz de cada proyecto, crea o edita `.pi/settings.json`:

**En el Proyecto Alpha (`/home/user/projects/alpha/.pi/settings.json`)**:
```json
{
  "defaultModel": "cpamc/Pool-01-gemini"
}
```

**En el Proyecto Beta (`/home/user/projects/beta/.pi/settings.json`)**:
```json
{
  "defaultModel": "cpamc/Pool-02-gemini"
}
```

Al abrir una terminal en la carpeta del proyecto y ejecutar `pi` o `gentle-shell`, la sesión se ancla automáticamente al pool asignado sin requerir intervención manual en `/model`.

### Receta B: Variables de Entorno y `direnv`
Si utilizas perfiles de shell o herramientas como `direnv`, define la variable de entorno en el archivo `.envrc` del directorio:

```bash
# .envrc en Proyecto Alpha
export PI_MODEL="cpamc/Pool-01-gemini"
```

```bash
# .envrc en Proyecto Beta
export PI_MODEL="cpamc/Pool-02-gemini"
```

### Receta C: Parámetro de Inicio en Línea de Comandos
Para scripts de CI/CD, tareas en segundo plano o subagentes dedicados:

```bash
pi --model cpamc/Pool-01-gemini
```

---

## 4. Mecánica de Desbordamiento por Concurrencia (Concurrency Spillover)

Incluso dentro de un mismo proyecto, el trabajo intensivo con múltiples subagentes concurrentes (p. ej. `00-discovery` y `deep-researcher` ejecutándose en paralelo) puede saturar las conexiones simultáneas permitidas por la cuenta de Google o Anthropic.

Auto Switcher Pro implementa el mecanismo **Concurrency Guard**:

### 4.1 Límite en Vuelo (`MaxInFlight = 2`)
- **Peticiones Secuenciales**: Todas las llamadas sucesivas del turno comparten el `ActiveLeader` oficial en RAM para preservar el KV Cache.
- **Detección de Ráfaga Concurrente**: En `plugins/auto-switcher-pro/internal/plugin/modelprovider.go`:
  ```go
  if activeStreams := getActiveInFlightSessions(mEmail, sessionID, 6*time.Second); activeStreams >= 2 {
      hasConcurrencyOverflow = true
      continue // Desborda a la Reserva #1
  }
  ```
  Si el líder ya tiene $\ge 2$ peticiones concurrentes en vuelo (ventana de 6 segundos) procedentes de otras sesiones o subagentes, la nueva petición se desvía temporalmente a la **Reserva #1** del pool.
- **Sin Pérdida de Liderazgo**: Este desbordamiento temporal (`hasConcurrencyOverflow = true`) **NO cambia el Líder Dinámico en RAM**. Una vez finalizada la ráfaga, las nuevas peticiones regresan al líder original.

### 4.2 Afinidad de Sesión de 5 Minutos (`SessionAffinity`)
Para evitar que una sesión o subagente desbordado salte erráticamente entre el líder y las reservas turno a turno (*flapping*):
- Se almacena una entrada de afinidad en la base de datos SQLite y memoria (`analytics.SessionAffinity`):
  - `session_id`: Identificador de la sesión del agente.
  - `pool_id`: Identificador canónico del pool.
  - `account_email`: Cuenta asignada durante la ráfaga.
  - `ttl`: 5 minutos desde el último turno (`last_turn_ms`).
- Mientras la sesión permanezca activa y emita turnos dentro de la ventana de 5 minutos, se mantiene anclada a esa cuenta específica para conservar su propio KV Cache.

---

## 5. Resumen de Invariantes Operativas

| Invariante | Regla de Oro |
| :--- | :--- |
| **Separación de Proyectos** | 1 proyecto = 1 pool soberano en `/model`. Nunca compartir el mismo pool entre repositorios activos simultáneos. |
| **Preservación de Caché** | El `ActiveLeader` absorbe el 100% de peticiones secuenciales. |
| **Protección contra Caídas** | Ráfagas de $\ge 2$ streams simultáneos desbordan temporalmente a la reserva más saludable sin destronar al líder. |
| **Estabilidad de Turnos** | `SessionAffinity` sostiene la sesión durante 5 minutos para maximizar la reutilización de tokens. |
