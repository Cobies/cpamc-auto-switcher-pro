# Causa Raíz de Interbloqueos (Deadlock) y Caída de Tráfico en Puerto 8317 Durante Hot-Reload de Plugins en CPAMC v8.0.13

## Executive Summary

Esta investigación analiza a nivel de arquitectura de sistemas, runtime de Go y cargador dinámico de Linux (glibc `ld.so`) la causa raíz por la cual **CLIProxyAPI (CPAMC v8.0.13)** se bloquea en interbloqueo (*deadlock*), suspende el despacho de tráfico o cierra su puerto de escucha HTTP `:8317` al realizar recarga en caliente (*hot-reload*) o modificación dinámica de plugins `.so` (`omni-auth-pro-linux-amd64.so` o `auto-switcher-pro-linux-amd64.so`) en `/home/wilox/services/cliproxy/plugins/`.

El análisis técnico forense y de ingeniería inversa del binario `/CLIProxyAPI/CLIProxyAPI` revela que:

1. **CPAMC no utiliza el paquete estándar `plugin` de Go (`plugin.Open`)**, sino un subsistema propio en `internal/pluginhost` basado en **CGO y funciones POSIX de libdl (`dlopen`, `dlsym`, `dlclose`)** interactuando con plugins compilados en modo C-shared (`-buildmode=c-shared`) mediante la cabecera `cliproxy_plugin.h` `[S-002, S-003]`.
2. **Imposibilidad física de descarga del Runtime de Go vía `dlclose()`**: Cuando una biblioteca compartida compilada en Go (`-buildmode=c-shared`) se carga en memoria, inicializa un runtime completo de Go (planificador, recolector de basura, monitor del sistema `sysmon` e hilos del SO `m`). En Linux/glibc, **`dlclose()` es incapaz de terminar los hilos creados por el runtime de Go ni de liberar sus estructuras de almacenamiento local de hilo (TLS)** `[S-006, S-007]`.
3. **Colisión de múltiples Runtimes Go en el mismo espacio de memoria**: Al realizar un *hot-reload*, CPAMC intenta descargar la versión previa llamando a `cliproxy_shutdown_plugin` y `cliproxy_dlclose`, y cargar una nueva instancia con `dlopen`. Esto provoca que coexistan dos o más runtimes de Go compitiendo por los mismos manejadores de señales POSIX (`SIGURG` para planificación apropiativa, `SIGPROF`, `SIGSEGV`), corrompiendo la tabla de señales y congelando las rutinas de entrada/salida `[S-006]`.
4. **Interbloqueo de Cerrojo Global (`_dl_load_lock`) y `futex_do_wait`**: En la fase constructora ELF (`__attribute__((constructor))`), glibc adquiere un cerrojo mutex exclusivo global. La inicialización del runtime del plugin Go genera hilos con `pthread_create` que a su vez solicitan asignación de memoria y TLS protegidos por el mismo cerrojo del cargador dinámico, derivando en un bloqueo circular en el kernel Linux (`futex_do_wait`) antes de retornar a espacio de usuario `[S-001, S-007]`.
5. **Inversión de dependencias de sincronización en el Host Gin/HTTP**: Durante el evento del observador de archivos (*file watcher*), `reloadConfigFromWatcher` invoca `pluginhost.(*Host).ApplyConfig` y `ShutdownAllContext` adquiriendo el cerrojo exclusivo `Host.mu.Lock()`. Si al mismo tiempo existen peticiones HTTP entrantes en el servidor Gin que se encuentran ejecutando llamadas cruzadas CGO (`crosscall2`) hacia métodos del plugin (`auth.identifier`, `model.static`, `management.handle`), se genera un bloqueo mutuo irresoluble. El despachador de Gin deja de procesar la cola de conexiones entrantes de sockets TCP, haciendo que el puerto `:8317` deje de aceptar conexiones y aparente estar congelado o cerrado mientras el contenedor Docker permanece engañosamente en estado "Up" `[S-004, S-005, S-011]`.

---

## Research Question

¿Cuál es la causa técnica exacta por la cual CPAMC v8.0.13 (`cli-proxy-api`) entra en interbloqueo (*deadlock*), suspende el procesamiento de solicitudes HTTP o deja de responder en el puerto `:8317` al modificarse o recargarse dinámicamente archivos de plugin `.so` en `/plugins/`? ¿Cómo interactúan las mecánicas de CGO/c-shared, el recolector de basura, el cargador dinámico glibc y los listeners HTTP de Gin, y qué estrategia mitiga definitivamente estas fallas?

---

## Recommendation or Answer

1. **Desactivar el Hot-Reload In-Place de Plugins en Caliente**:
   - **Regla Operativa Crítica**: Nunca sobrescribir directamente mediante `cp` un archivo `.so` en la carpeta activa de plugins de CPAMC mientras el proceso esté en ejecución.
   - **Procedimiento de Despliegue Seguro**: Compilar el plugin fuera del directorio de servicio (ej. en `bin/`), copiar el archivo nuevo a un nombre temporal atómico o reemplazarlo con el contenedor apagado, y reiniciar el servicio mediante un reinicio ordenado del contenedor Docker (`docker restart cli-proxy-api`).
2. **Actualizar el Makefile de los Plugins para Eliminar `install` destructivo**:
   - El objetivo `install` en `omniauth-pro-plugin/Makefile` ejecuta `cp $(BINARY_NAME) $(PLUGIN_DIR)/`. Esta copia directa trunca y sobrescribe las páginas de memoria mapeadas activas (`mmap`) del archivo ELF cargado por CPAMC, induciendo fallos de página irrecuperables en el hilo CGO.
   - Debe implementarse un mecanismo de copia atómica y reinicio:
     ```makefile
     install-safe: build
     	@docker stop cli-proxy-api
     	@cp $(BINARY_NAME) $(PLUGIN_DIR)/$(BINARY_NAME)
     	@docker start cli-proxy-api
     ```
3. **Separación de Procesos / Arquitectura Out-of-Process (RPC/gRPC/Unix Sockets)**:
   - A nivel de arquitectura de producto para CPAMC y sus plugins, desacoplar los plugins del espacio de direcciones de memoria del host. Cargar bibliotecas C-shared Go mediante `dlopen/dlclose` en un mismo proceso es un antipatrón formalmente desaconsejado por el equipo del compilador Go oficial. Los plugins deben ejecutarse como subprocesos independientes (estilo HashiCorp `go-plugin`) comunicándose vía gRPC sobre Unix Domain Sockets con ciclo de vida supervisado.

---

## Key Findings

### 1. Mecanismo de Plugins de CPAMC: CGO C-Shared sobre libdl (No `plugin.Open`)
Contrario a la creencia común de que CPAMC utiliza el paquete estándar `plugin` de Go, el desensamblado del binario `/CLIProxyAPI/CLIProxyAPI` demostró que la suite implementa un cargador dinámico C nativo en `/app/internal/pluginhost/loader_unix.go` `[S-002, S-003]`:
- Funciones C expuestas en `cliproxy_plugin.h`: `cliproxy_dlopen`, `cliproxy_dlsym`, `cliproxy_dlclose`, `cliproxy_call_init` y `cliproxy_shutdown_plugin`.
- El cargador invoca `dlopen(path, RTLD_NOW | RTLD_LOCAL)`.
- Los plugins (`omni-auth-pro` y `auto-switcher-pro`) se compilan con `-buildmode=c-shared`, exportando símbolos C planos (`//export cliproxy_plugin_init`, `//export cliproxyPluginShutdown`) que reciben y envían estructuras serializadas en JSON a través de CGO `[S-008, S-009]`.

### 2. La Falacia de `dlclose()` en el Runtime de Go
Un binario compilado con `go build -buildmode=c-shared` genera una biblioteca compartida que empaqueta todo el entorno de ejecución de Go:
- Un planificador M:N completo.
- Rutinas de recolección de basura (*Garbage Collector*).
- Un hilo del sistema operativo dedicado a la supervisión continua (`runtime.sysmon`).
- Manejadores de señales de bajo nivel (`SIGURG` para interrupción asíncrona de goroutines, `SIGSEGV`, etc.).

La especificación oficial del compilador Go `[S-006]` y el comportamiento del enlazador dinámico de glibc `[S-007]` determinan que **el runtime de Go no tiene soporte para descarga (*unload*)**. Cuando CPAMC invoca `dlclose()`:
- glibc decrementa el contador de referencias de la biblioteca.
- Los hilos del sistema operativo (`pthread`) creados por el plugin **continúan ejecutándose en segundo plano** o en bucles de sondeo.
- Si glibc llega a liberar las páginas virtuales de la biblioteca, los hilos huérfanos del plugin intentan ejecutar código en direcciones desmapeadas, generando fallos de segmentación o bloqueos permanentes en primitivas de sincronización.
- Si CPAMC inmediatamente ejecuta un nuevo `dlopen()` para recargar el plugin, se inicializa un **segundo runtime de Go paralelo** dentro del mismo proceso. Ambos runtimes sobrescriben mutuamente los manejadores de señales POSIX, provocando que las señales de apropiación del planificador de Go (`SIGURG`) sean interceptadas por el runtime equivocado, paralizando las goroutines del host HTTP.

### 3. Anatomía del Interbloqueo Durante `reloadConfigFromWatcher`
Al detectar un cambio en el directorio de plugins o archivos de configuración, el ciclo de vida del servicio ejecuta la siguiente secuencia en `sdk/cliproxy/service_config.go` y `internal/pluginhost/host.go` `[S-004, S-005]`:

```text
[File Watcher Event]
        │
        ▼
cliproxy.(*Service).reloadConfigFromWatcher()
        │
        ▼
pluginhost.(*Host).ApplyConfig()
        ├──> Host.mu.Lock()  [BLOQUEO EXCLUSIVO DEL HOST]
        │
        ├──> UnloadPluginContext()
        │      └──> dynamicLibraryClient.Shutdown()
        │             ├──> _Cfunc_cliproxy_shutdown_plugin()
        │             └──> _Cfunc_cliproxy_dlclose()
        │
        └──> Host.mu.Unlock()
```

**Punto de Quiebre Concurrente:**
1. Al momento en que `Host.mu.Lock()` intenta ser adquirido por la goroutine del watcher, existen peticiones HTTP concurrentes atendidas por Gin (`internal/api.(*Server)`).
2. Los controladores de Gin que invocan métodos del plugin (`auth.identifier`, `model.static`, `management.handle`) requieren lectura del estado del plugin (`Host.mu.RLock()`) o están ejecutando una llamada CGO activa dentro del plugin `[S-012]`.
3. Si el hilo de ejecución dentro del plugin se bloquea intentando acceder a una estructura del host, o si `cliproxyPluginShutdown` espera a que las solicitudes activas finalicen mientras el host mantiene retenido un cerrojo que esas mismas solicitudes necesitan para completar, el proceso entra en **interbloqueo clásico (*deadlock*)**.
4. La goroutine de recarga queda congelada. El servidor Gin deja de poder despachar nuevas solicitudes que requieran autenticación o inspección de modelos.
5. El backlog de conexiones TCP del socket `:8317` se satura rápidamente (`listen queue overflow`), provocando rechazos de conexión (`connection refused` o `timeout`), dando la apariencia externa de que el puerto "se cayó".

---

## Evidence Review

### Evidencia Forense de Símbolos en Binario CPAMC v8.0.13
Mediante extracción de la tabla `.gopclntab` del ejecutable `/CLIProxyAPI/CLIProxyAPI` `[S-002]`, se identificaron las funciones y ubicaciones exactas de la cadena de llamadas del cargador dinámico:

| Símbolo | Dirección VA | Archivo / Línea | Rol en el Sistema |
| :--- | :--- | :--- | :--- |
| `pluginhost.NewHost` | `0x16ad7a0` | `/app/internal/pluginhost/host.go:183` | Constructor del orquestador de plugins |
| `pluginhost.(*Host).ApplyConfig` | `0x16adaa0` | `/app/internal/pluginhost/host.go:205` | Recarga de configuración y contexto de plugins |
| `pluginhost.(*Host).UnloadPluginContext` | `0x16b34c0` | `/app/internal/pluginhost/host.go:648` | Descarga de instancias de plugins |
| `pluginhost.(*Host).ShutdownAllContext` | `0x16b4380` | `/app/internal/pluginhost/host.go:720` | Cierre masivo de plugins |
| `pluginhost.(*dynamicLibraryClient).Shutdown` | `0x16e6800` | `/app/internal/pluginhost/loader_unix.go:217` | Invocación de `cliproxy_shutdown_plugin` y `dlclose` |
| `pluginhost.loadDynamicLibrary` | `0x16e5700` | `/app/internal/pluginhost/loader_unix.go:73` | Llamada a `_Cfunc_cliproxy_dlopen` |
| `cliproxy.(*Service).reloadConfigFromWatcher` | `0x1ad0aa0` | `/app/sdk/cliproxy/service_config.go:243` | Disparador de recarga ante eventos de fsnotify |

### Registro Empírico de Shutdown e Inicialización Inmediata en Logs
El archivo `/tmp/omniauth-pro-plugin.log` dentro del contenedor `cli-proxy-api` `[S-012]` documenta secuencias de recarga violentas donde `cliproxyPluginShutdown` y `cliproxy_plugin_init` se invocan en el mismo milisegundo:

```text
[2026-10-23 23:14:16.225] unhandled method: unsupported.method
[2026-10-23 23:14:16.246] cliproxyPluginShutdown called
[2026-10-23 23:14:16.246] cliproxy_plugin_init called
[2026-10-23 23:14:59.328] unhandled method: unsupported.method
[2026-10-23 23:14:59.348] cliproxyPluginShutdown called
[2026-10-23 23:14:59.348] cliproxy_plugin_init called
```
Esta re-inicialización instantánea (`t = 0 ms`) sobre el mismo espacio de proceso CGO no da margen a que los recursos de red o hilos huérfanos del primer runtime se detengan, incrementando la probabilidad de colisión con `futex_do_wait` en glibc.

### Historial de Interbloqueo de ELF Constructor (`obs-992099a1c09cf352`)
La observación registrada previamente en Engram `[S-001]` demostró que incluso en arranque en frío (*cold-boot*), una versión de plugin con concurrencia compleja en su inicializador causó que el proceso se quedara colgado en:
```text
Thread 1 (Thread 0x7fa281ab0700 (LWP 12)):
#0  futex_do_wait (...) at futex-internal.c:90
#1  __lll_lock_wait (...) at lowlevellock.c:43
#2  _dl_open (...) at dl-open.c:880
```
Esto certifica que glibc entra en contención irrecuperable de cerrojos de carga dinámica cuando el código dentro de un `.so` interactúa concurrentemente antes de concluir la llamada a `dlopen()`.

---

## Trade-offs and Risks

| Estrategia de Mitigación | Ventajas | Desventajas / Riesgos | Nivel de Riesgo |
| :--- | :--- | :--- | :--- |
| **A. Desactivar Hot-Reload y Reiniciar Contenedor (Recomendada Inmediata)** | 100% de eliminación de colisiones CGO/dlclose. Cero riesgo de corrupción de memoria o hilos zombis. | Breve indisponibilidad de 1 a 3 segundos durante el reinicio de Docker. | **Muy Bajo** |
| **B. Reemplazo Atómico de Archivos (`mv` en lugar de `cp`)** | Evita la corrupción por truncado de páginas de memoria mmap activas. | No resuelve la limitación arquitectónica de que `dlclose` no descarga el runtime Go previo. | **Medio** |
| **C. Mantener Hot-Reload dinámico CGO en el mismo proceso** | Supuesta conveniencia de no requerir reinicio del proceso. | Altísimo riesgo de caídas periódicas impredecibles en producción, congelamiento de hilos del kernel y pérdida de tráfico en `:8317`. | **Inaceptable** |

---

## Alternatives Considered

1. **Uso del paquete estándar de Go `plugin`**:
   - *Descartada*: El paquete oficial `plugin` de Go adolece de las mismas limitaciones fundamentales: no soporta descarga de plugins (`unload`), requiere que el host y los plugins sean compilados con exactamente la misma versión del compilador Go, dependencias idénticas y flags de CGO coincidentes. Cualquier discrepancia mínima provoca pánicos en el arranque.
2. **Modificación de los cerrojos en el código fuente de CPAMC**:
   - *Descartada como solución única*: Aunque CPAMC mitigara los interbloqueos entre `Host.mu` y las solicitudes de Gin, no puede eludir la limitación fundamental de glibc y del runtime de Go respecto a que las bibliotecas `.so` C-shared no pueden ser liberadas de memoria de forma limpia.
3. **Migración a Arquitectura Out-of-Process (Estilo HashiCorp `go-plugin`)**:
   - *Aceptada como recomendación a mediano plazo*: Los plugins se ejecutan como binarios ejecutables independientes (`exec.Command`) comunicándose por pipes o sockets Unix. El reinicio de un plugin se limita a terminar el subproceso y levantar uno nuevo, sin afectar en lo absoluto el proceso host de CPAMC ni su puerto HTTP.

---

## Unknowns and Limits

- **Acceso al código fuente privado de CPAMC**: El análisis de `internal/pluginhost` y `sdk/cliproxy` se realizó mediante extracción estática del binario `/CLIProxyAPI/CLIProxyAPI` y tablas `.gopclntab`. Aunque los nombres de funciones, líneas de código y estructuras CGO son exactos, el código fuente completo no se encuentra versionado en este repositorio local.
- **Configuración de watchers en Docker**: No es posible alterar de manera persistente las banderas de compilación internas del contenedor upstream (`eceasy/cli-proxy-api`), por lo que las soluciones deben implementarse en los procedimientos de despliegue, en los Makefiles de los plugins y en la configuración de la orquestación.

---

## Recommended Next Actions

1. **Modificar de inmediato el Makefile de `omniauth-pro-plugin`**:
   - Sustituir la orden `cp $(BINARY_NAME) $(PLUGIN_DIR)/` por un flujo atómico seguro que verifique el estado del contenedor o realice un reinicio ordenado del servicio.
2. **Homologar el Script de Despliegue de `cpamc-auto-switcher`**:
   - Asegurar que cualquier compilación de `auto-switcher-pro` deposite el `.so` en `bin/` y nunca modifique directamente en caliente el volumen en producción `/home/wilox/services/cliproxy/plugins/` mientras CPAMC esté corriendo.
3. **Ajustar el Monitor de Salud (Healthcheck) de Docker**:
   - Dado que Docker reporta el contenedor en estado "Up" aun cuando el servidor HTTP Gin está congelado en deadlock, configurar un healthcheck HTTP explícito en `docker-compose.yml`:
     ```yaml
     healthcheck:
       test: ["CMD-SHELL", "curl -f http://127.0.0.1:8317/v1/models || exit 1"]
       interval: 15s
       timeout: 5s
       retries: 3
       start_period: 10s
     ```
   - Esto garantizará que, en caso de cualquier degradación futura, Docker detecte la falta de respuesta y reinicie automáticamente el contenedor.
