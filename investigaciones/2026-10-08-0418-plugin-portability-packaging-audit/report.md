# Auditoría Integral de Portabilidad, Empaquetado 'Plug & Play' y Viabilidad de Despliegue Autocontenido de CPAMC Auto-Switcher y Auto Switcher Pro

## Executive Summary

La suite **CPAMC Auto-Switcher / AUTO SWITCHER PRO** ha alcanzado una madurez funcional y una cobertura de pruebas notable (100% en suites unitarias de Go y 275/275 pruebas aprobadas en el frontend de Vite/React). No obstante, tras una exhaustiva auditoría de código estático, rutas y dependencias de entorno, el veredicto técnico es concluyente: **en su estado actual, el proyecto NO es viable como un artefacto 'Plug & Play' de cero configuración para ser compartido con un amigo o tercero mediante una simple copia o symlink [S-001, S-006, S-013]**.

Si un usuario externo clona el repositorio o copia la extensión a su entorno local hoy, experimentará fallos silenciosos y roturas críticas inmediatas:
1. **Secuestro de Red Local (LAN IP Hijack)**: En `extensions/cpamc-auto-switcher/src/provider.ts`, la URL base por defecto está fijada a la IP privada del entorno de desarrollo (`http://192.168.10.150:8317`). Peor aún, la función de resolución reescribe activamente `localhost` o `127.0.0.1` forzándolos hacia dicha IP privada, haciendo imposible el uso local en la máquina del amigo [S-001].
2. **Desincronización y Omisión en Control de Versiones**: La extensión unificada canónica (`extensions/cpamc-auto-switcher/`) y la documentación de homologación (`docs/`) se encuentran **desindexadas (untracked)** en git [S-013]. Un tercero que clone el repositorio oficial solo recibirá la versión obsoleta y deprecada de septiembre (`pi extensions/cpamc-auto-switcher`) [S-012].
3. **Acoplamiento Duro a Subprocesos y Archivos Locales**: La extensión para Pi delega el cálculo de cuotas y la rotación al binario externo compilado `cpamc-auto-switcher` en `$PATH` [S-002, S-003]. Si este binario no está compilado o si falta el archivo `~/.local/share/cpamc-auto-switcher/config.json`, la telemetría del Sidebar y del Footer queda deshabilitada [S-005] y el auto-failover se pausa [S-002, S-006, S-007].
4. **Ruptura de Configuración Dividida (Split-Brain)**: El binario Go no lee las variables de entorno (`CLIPROXYAPI_BASE_URL` o `CLIPROXYAPI_MANAGEMENT_KEY`), mientras que la extensión sí las usa, creando una desincronización donde Pi y el switcher pueden apuntar a endpoints distintos [S-006, S-007].
5. **Restricción de Plataforma en el Plugin Host**: El archivo `auto-switcher-pro-linux-amd64.so` es una biblioteca compartida ELF para Linux x86_64 con `glibc` [S-008, S-010]. No puede cargarse en entornos nativos de macOS o Windows sin contenedores Linux/Docker.

Con un plan quirúrgico enfocado en un modo autónomo ("Pure-TypeScript Fallback") en la extensión de Pi y un asistente de instalación o plantilla de configuración unificada, la suite puede alcanzar el nivel deseado de portabilidad absoluta.

---

## Research Question

¿Es técnica y operativamente viable entregar la suite de **Auto Switcher Pro** (la extensión de Pi, el plugin host C-ABI `.so` para CLIProxyAPI y el binario Go) a un tercero o amigo para que funcione inmediatamente ("Plug & Play") con solo copiar o enlazar simbólicamente la carpeta, sin requerir configuraciones complejas, rutas absolutas rígidas ni dependencias externas invisibles?

---

## Recommendation or Answer

La respuesta técnica se divide en dos escenarios según el alcance de distribución:

### Dictamen para Escenario 1 (Amigo solo requiere la extensión de Pi)
- **Viabilidad Actual**: **INVIABLE / ROTA** sin modificaciones manuales previas.
- **Causas**: El hardcode de `192.168.10.150:8317`, la anulación de `localhost`, el fallo fatal si no se exporta `CLIPROXYAPI_API_KEY`, y la pérdida total de telemetría de cuotas al faltar el binario CLI en `$PATH` [S-001, S-003, S-004, S-005].
- **Recomendación**: Implementar en `extensions/cpamc-auto-switcher` un **Modo Autónomo sin Dependencia del CLI Go**. Dado que el cliente web de Visual Profile ya consulta cuotas exitosamente mediante peticiones HTTP nativas a `/v0/management/api-call` [S-009], la extensión de Pi puede incorporar ese mismo extractor nativo en TypeScript. Así, un amigo solo necesitará copiar la carpeta a `~/.pi/agent/extensions/cpamc-auto-switcher` y definir `CLIPROXYAPI_BASE_URL`.

### Dictamen para Escenario 2 (Amigo instala la suite completa: Host Plugin `.so` + CLI Go + Extensión Pi)
- **Viabilidad Actual**: **VIABLE CONDICIONADA** exclusivamente para hosts **Linux x86_64 / arm64**.
- **Causas**: El plugin C-ABI requiere Linux con glibc [S-008, S-010]; se requiere compilación manual del CLI Go, ejecución interactiva de `cpamc-auto-switcher --init` [S-006, S-007], sincronización manual del archivo `~/.cliproxy_management_key` y corrección del repositorio en GitHub Actions [S-010, S-013].
- **Recomendación**: Crear un script de despliegue automatizado (`install.sh`), corregir la prioridad de variables de entorno para evitar split-brain, eliminar código muerto/duplicado del repositorio y subir los cambios no indexados a la rama principal de git [S-011, S-012, S-013].

---

## Key Findings

### 1. Desglose de la Naturaleza Tri-Componente

La suite se compone de tres elementos con ciclos de vida y responsabilidades desacopladas:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          AUTO SWITCHER PRO                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│  Host Plugin │             │    Go CLI    │             │ Pi Extension │
│     .so      │             │    Binary    │             │  TypeScript  │
└──────┬───────┘             └──────┬───────┘             └──────┬───────┘
       │                            │                            │
  C-ABI v1 a                   Ejecutable en                Módulo para
 CLIProxyAPI                   $PATH para rotación         ~/.pi/agent/
 (Editor /profiles             y sondeo de cuotas           (UI, Provider,
 y virtualización)             (Cron / CLI manual)          Failover 429)
```

| Componente | Ubicación en Repo | Lenguaje / Runtime | Acoplamiento Externo | Portabilidad 'Out of the Box' |
| :--- | :--- | :--- | :--- | :--- |
| **Pi Extension** | `extensions/cpamc-auto-switcher/` | TypeScript (Node 20+ / ESM) | CLIProxyAPI HTTP, CLI `cpamc-auto-switcher`, Gentle-Shell | **Baja**: Asume rutas locales, IP LAN privada y CLI en `$PATH` [S-001, S-003, S-005]. |
| **Host Plugin** | `plugins/visual-profile/` (`auto-switcher-pro-linux-amd64.so`) | Go 1.22 (Cgo, `-buildmode=c-shared`) | CLIProxyAPI Host, Linux ELF / glibc | **Media**: Alta en Linux x86_64; Nula en macOS o Windows nativo [S-008, S-010]. |
| **Go CLI Binary** | `cmd/cpamc-auto-switcher/` | Go estándar (compilado estático) | Archivo `config.json` en `~/.local/share/` | **Media**: Requiere paso previo `--init` y no lee variables de entorno [S-006, S-007]. |

### 2. Auditoría Exhaustiva de Rutas Hardcodeadas y Dependencias de Entorno

#### A. Inyección forzada de IP Privada y rechazo de Localhost (`src/provider.ts`)
En `extensions/cpamc-auto-switcher/src/provider.ts` se observa:
```typescript
const DEFAULT_BASE_URL = "http://192.168.10.150:8317";
...
function resolveBaseUrl(): string {
    const raw = (process.env.CLIPROXYAPI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    if (raw.includes("127.0.0.1") || raw.includes("localhost")) {
        return DEFAULT_BASE_URL;
    }
    return raw;
}
```
**Impacto Crítico**: Si el amigo ejecuta CLIProxyAPI en su propia máquina e ingresa `http://localhost:8317` o `http://127.0.0.1:8317`, la función intercepta el valor y **lo reemplaza por la IP privada de Wilox (`192.168.10.150`)**, resultando en un `ECONNREFUSED` o timeout total [S-001].

#### B. Acoplamiento estricto a Gentle-Shell en Caché de Modelos
En `extensions/cpamc-auto-switcher/src/provider.ts`:
```typescript
const CACHE_PATH = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".gentle-shell", "agent"), "cpamc-models-cache.json");
...
const targets = new Set<string>([CACHE_PATH]);
const gentlePath = join(homedir(), ".gentle-shell", "agent", "cpamc-models-cache.json");
```
**Impacto**: En una instalación estándar de Pi (Vanilla: `~/.pi/agent` o Pi jok3r: `~/.pi/agent-j0k3r`), si no está definida `PI_CODING_AGENT_DIR` ni existe el directorio `~/.gentle-shell/agent`, la comprobación `existsSync(dir)` falla silenciosamente y los modelos **nunca se guardan en caché**, obligando a re-descargar todo en cada arranque o fallando si no hay red [S-001].

#### C. Error Fatal por Clave API Obligatoria en Modo Desprotegido
En `extensions/cpamc-auto-switcher/src/provider.ts`:
```typescript
function requireApiKey(): string {
    const apiKey = (process.env.CLIPROXYAPI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("CLIPROXYAPI_API_KEY is not set in the Pi process environment...");
    }
    return apiKey;
}
```
**Impacto**: CLIProxyAPI permite operar en redes locales sin clave de autenticación (`access.api-keys: []`). Forzar el lanzamiento de una excepción bloquea la carga de modelos a menos que el usuario defina un valor ficticio [S-001].

#### D. Desconexión de Configuración entre CLI y Extensión (Split-Brain)
- La extensión de Pi lee `CLIPROXYAPI_BASE_URL` y `CLIPROXYAPI_MANAGEMENT_KEY` [S-001].
- El binario Go ignora estas variables de entorno en su función `config.Load()` y depende exclusivamente de `~/.local/share/cpamc-auto-switcher/config.json` [S-006, S-007].
- Como consecuencia, si el amigo configura su entorno con variables, Pi consultará una instancia, pero las rotaciones y telemetría de cuotas ejecutarán contra lo que esté grabado en el JSON (o fallarán si el archivo no existe) [S-006].

### 3. Estado del Repositorio Git y Código Huérfano

El análisis del árbol de Git revela discrepancias severas que impiden la distribución limpia del proyecto [S-013]:

1. **Extensión Homologada Untracked**: La carpeta `extensions/cpamc-auto-switcher/` contiene todo el trabajo arquitectónico de octubre (ADRs 01 a 05) [S-011], pero **no está registrada en git**. En cambio, la carpeta deprecada `pi extensions/cpamc-auto-switcher` sí está trackeada [S-012]. Al hacer un `git clone`, el amigo no tendrá acceso a la extensión moderna.
2. **Documentación Untracked**: La carpeta `docs/` (incluyendo `unified-pi-extension-homologation.md`) no está añadida al repositorio [S-011, S-013].
3. **Carpetas de Investigación Divergentes**: Coexisten `investigacion/` (en singular, con un estudio desindexado) y `investigaciones/` (en plural, con 12 estudios).
4. **Binarios Huérfanos Duplicados**: En `plugins/visual-profile/`, existen dos archivos `.so` idénticos byte a byte: `visual-profile-linux-amd64.so` y `auto-switcher-pro-linux-amd64.so`. El primero es un rezago previo al renombramiento de la suite.
5. **Fallo en GitHub Actions por Repositorio Inconsistente**: El flujo `.github/workflows/visual-profile-release.yml` condiciona la ejecución a `github.repository == 'gonzalez962/cpamc-auto-switcher'` [S-010], pero el origen remoto activo está configurado como `git@github.com:WiloxDev/cpamc-auto-switcher-pro.git` [S-013]. Esto provoca un rechazo inmediato por `Unauthorized repository` en el pipeline de release.

---

## Evidence Review

### Tabla de Auditoría de Acoplamientos y Portabilidad

| Módulo / Archivo | Líneas Relevantes | Acoplamiento Detectado | Diagnóstico de Portabilidad |
| :--- | :--- | :--- | :--- |
| `extensions/cpamc-auto-switcher/src/provider.ts` | 34, 114–120 | `DEFAULT_BASE_URL = "http://192.168.10.150:8317"` y sustitución forzada de localhost [S-001]. | **CRÍTICO**. Desvía el tráfico local del amigo a la red interna de Wilox. |
| `extensions/cpamc-auto-switcher/src/provider.ts` | 38–40, 59–64 | `CACHE_PATH` atado a `.gentle-shell/agent` [S-001]. | **ALTO**. En Pi estándar o jok3r-pi no guarda caché si la carpeta no existe. |
| `extensions/cpamc-auto-switcher/src/provider.ts` | 122–130 | `requireApiKey()` arroja excepción si no hay variable [S-001]. | **MEDIO**. Rompe instalaciones de CLIProxyAPI sin autenticación configurada. |
| `extensions/cpamc-auto-switcher/src/failover.ts` | 4, 38–50 | `spawn("cpamc-auto-switcher", args)` [S-002]. | **ALTO**. Captura `ENOENT`, pero suspende el failover si el binario no está en PATH. |
| `extensions/cpamc-auto-switcher/src/store.ts` | 44–58 | `execFileAsync("cpamc-auto-switcher", ["-list"])` [S-003]. | **ALTO**. Falla silenciosamente; devuelve lista vacía y apaga la telemetría del Sidebar/Footer. |
| `extensions/cpamc-auto-switcher/src/picker.ts` | 27–42, 60–90 | Depende de `querySwitcherAccounts` para Least-Used y badges [S-004]. | **MEDIO**. Degradación visual: sin cuotas vivas muestra 0% y no puede auto-balancear. |
| `extensions/cpamc-auto-switcher/src/adapter.ts` | 141–180, 240–280 | QuotaCard y Footer supeditados a cuentas en caché [S-005]. | **MEDIO**. Muestra "Sin modelo con rotación activo" si el CLI no pobló cuentas. |
| `cmd/cpamc-auto-switcher/main.go` | 95–104 | Carga estricta de `~/.local/share/cpamc-auto-switcher/config.json` [S-006]. | **ALTO**. No lee variables de entorno; obliga a interactividad con `--init`. |
| `internal/config/config.go` | 230–235 | `management_key cannot be empty` en `Validate()` [S-007]. | **MEDIO**. No permite uso sin clave administrativa. |
| `plugins/visual-profile/internal/plugin/plugin.go` | 40–55 | Metadatos C-ABI v1 y registro de endpoints de UI [S-008]. | **BAJO**. Autocontenido a nivel Go; WebUI embebida correctamente en C-ABI. |
| `plugins/visual-profile/web/src/components/ControlSwitcher.jsx` | 680–710 | Consulta directa HTTP a `/v0/management/api-call` [S-009]. | **POSITIVO**. Prueba la viabilidad de sondeo de cuotas 100% en JS/TS sin binario Go. |
| `.github/workflows/visual-profile-release.yml` | 16, 26, 246, 252 | `gonzalez962/cpamc-auto-switcher` [S-010]. | **ALTO**. CI bloqueado si se dispara desde `WiloxDev/cpamc-auto-switcher-pro`. |
| Árbol de Git (`git status`) | Untracked files | `extensions/` y `docs/` no versionadas [S-011, S-013]. | **CRÍTICO**. Repositorio incompleto para terceros al clonar. |

---

## Trade-offs and Risks

### 1. Dependencia de CLI Subproceso vs Extractor Nativo en TypeScript
- **Mantener delegación en CLI Go (`cpamc-auto-switcher`)**:
  - *Ventaja*: Unificación del algoritmo de rotación y reglas de evaluación de cuotas en una sola biblioteca en Go.
  - *Riesgo*: Requiere que cada usuario compile el binario, lo coloque en `$PATH` y configure el archivo XDG JSON. Cualquier fallo en el proceso hijo desactiva la TUI sin aviso claro [S-003, S-006].
- **Implementar Sondeo Autónomo en TypeScript (Pure-TS)**:
  - *Ventaja*: La extensión se convierte en **100% Plug & Play**. Un amigo solo copia la carpeta a su directorio de Pi, configura la URL del proxy y obtiene telemetría, QuotaCard y selector interactivo de inmediato [S-004, S-005, S-009].
  - *Riesgo*: Duplicación ligera de lógica de consulta (`POST /v0/management/api-call`), aunque el cliente React de Visual Profile ya demuestra que esto son menos de 100 líneas de código [S-009].

### 2. Formato de Distribución del Host Plugin: Binario `.so` vs Docker
- **Distribuir `.so` precompilado**:
  - *Ventaja*: Rendimiento nativo sin sobrecarga en servidores Linux.
  - *Riesgo*: Incompatibilidad cruzada. Si el amigo utiliza macOS (Apple Silicon o Intel) o Windows nativo, CLIProxyAPI no podrá cargar la biblioteca ELF, limitando su adopción [S-008, S-010].
- **Distribuir plantilla Docker / Docker Compose**:
  - *Ventaja*: Portabilidad universal (macOS, Windows, Linux) encapsulando el binario ELF en un contenedor Debian/Ubuntu.
  - *Riesgo*: Requiere que el amigo tenga Docker en ejecución.

---

## Alternatives Considered

1. **Monolito en Go (Embeber todo dentro del binario CLIProxyAPI)**:
   - Descartado: CLIProxyAPI es un software host externo. El mecanismo canónico de extensión es el C-ABI v1 (`-buildmode=c-shared`), por lo que el plugin dinámico es la vía correcta [S-008].
2. **Empaquetar como paquete NPM publicado**:
   - Descartado temporalmente: Las extensiones de Pi se integran orgánicamente como subcarpetas o symlinks locales dentro de `~/.pi/agent/extensions/`. Publicar en npm añadiría fricción de tokens de registro innecesaria para compartir con amigos o equipos reducidos.
3. **Instalador unificado en Bash / Makefile**:
   - Altamente viable y recomendado como complemento para el Escenario 2, automatizando la compilación de Go, la creación del symlink y la plantilla de configuración.

---

## Unknowns and Limits

- **Soporte de C-ABI en macOS por CLIProxyAPI Host**: No se dispone de evidencia sobre si el host CLIProxyAPI compila y carga plugins `.dylib` en macOS. Actualmente, el flujo de release y el Makefile solo contemplan Linux amd64 y arm64 (`glibc`) [S-010].
- **Comportamiento ante CLIProxyAPI sin Autenticación**: Si el proxy no tiene `CLIPROXY_MANAGEMENT_KEY`, varios endpoints de gestión retornan HTTP 401 o se desactivan. La extensión carece de un modo "read-only básico" que omita llamadas administrativas si no hay clave.

---

## Recommended Next Actions

Para transformar la suite en un producto verdaderamente **Plug & Play** y homologado para terceros, se recomienda ejecutar los siguientes pasos organizados por prioridad:

### Fase 1: Correcciones Críticas Inmediatas (P0 - Zero Config Portability)
1. **Sanear `resolveBaseUrl()` en `src/provider.ts`**:
   - Cambiar `DEFAULT_BASE_URL` a `http://localhost:8317` [S-001].
   - Eliminar la reescritura que fuerza `192.168.10.150` cuando se detecta `localhost` o `127.0.0.1` [S-001].
   - Permitir que `CLIPROXYAPI_API_KEY` sea opcional (fallback a cadena vacía o `"none"`).
2. **Universalizar la Ruta de Caché**:
   - Resolver la ruta de caché comprobando sucesivamente: `process.env.PI_CODING_AGENT_DIR`, `~/.pi/agent/`, `~/.pi/agent-j0k3r/`, `~/.gentle-shell/agent/` y, en última instancia, el directorio temporal del sistema [S-001].
3. **Homologar Git y Control de Versiones**:
   - Ejecutar `git add extensions/ docs/` e incluir la suite unificada en el control de versiones [S-011, S-013].
   - Eliminar la carpeta deprecada `pi extensions/` del repositorio para erradicar confusiones [S-012].
   - Normalizar la carpeta `investigacion/` moviéndola a `investigaciones/`.

### Fase 2: Autonomía de la Extensión de Pi (P1 - Plug & Play Amigable)
4. **Modo Autónomo de Telemetría (Zero-CLI Fallback)**:
   - Si `cpamc-auto-switcher` no está presente en `$PATH`, la extensión debe realizar la consulta de cuotas directamente mediante HTTP (`/v0/management/auth-files` y `/v0/management/api-call`), exactamente igual que `ControlSwitcher.jsx` [S-003, S-009].
   - Esto permitirá que un amigo **solo copie la carpeta de la extensión** y disfrute inmediatamente de la QuotaCard, Footer y `/cpamc-model` con menor consumo (Least-Used) sin compilar Go [S-004, S-005].

### Fase 3: Paridad en el Binario Go y Flujo de Release (P2 - Enterprise Stack)
5. **Lectura de Variables de Entorno en el CLI Go**:
   - Modificar `config.Load()` para que, si el archivo `config.json` no existe, se inicialice automáticamente con las variables de entorno `CLIPROXYAPI_BASE_URL` y `CLIPROXYAPI_MANAGEMENT_KEY` [S-006, S-007].
6. **Corregir Repositorio en GitHub Actions**:
   - Reemplazar las cadenas duras `gonzalez962/cpamc-auto-switcher` en `.github/workflows/visual-profile-release.yml` por `${{ github.repository }}` para permitir releases fluidas desde `WiloxDev/cpamc-auto-switcher-pro` [S-010, S-013].
7. **Script Instalador Automatizado (`install.sh`)**:
   - Proveer un script simple de un solo paso:
     ```bash
     ./install.sh --extension-only   # Enlaza a ~/.pi/agent/extensions y genera config
     ./install.sh --full             # Compila Go CLI, copia .so al proxy y enlaza extensión
     ```
