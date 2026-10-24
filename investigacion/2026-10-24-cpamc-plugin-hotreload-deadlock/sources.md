# Sources

## Source Index

### S-001: Engram Memory Observation `obs-992099a1c09cf352`
- Family: IMPLEMENTATION
- URL or locator: `mem:obs-992099a1c09cf352`
- Date/version: 2026-10-23
- Access method: `mem_get_observation`
- Used for: Historial previo de bloqueos de arranque (cold-boot hang) en `omni-auth-pro v1.7.3 .so` en `futex_do_wait` durante la carga dinámica de ELF.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Registro forense que documentó el cuelgue en la fase constructora ELF antes de que se invocara `cliproxy_plugin_init`, demostrando la fragilidad del loader dinámico de glibc ante la inicialización de runtimes Go concurrentes.

### S-002: CPAMC Host Binary Symbol Table (`/CLIProxyAPI/CLIProxyAPI`)
- Family: PRIMARY
- URL or locator: `docker://eceasy/cli-proxy-api:latest:/CLIProxyAPI/CLIProxyAPI`
- Date/version: CPAMC v8.0.13 (Go 1.26.8 linux/amd64)
- Access method: `readelf`, `objdump`, `debug/gosym` en Go
- Used for: Mapeo de rutinas internas, estructuras de plugins, tablas de símbolos de runtime (`.gopclntab`) y desensamblado de hooks de carga/descarga.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Binario Go con símbolos ELF (`.symtab`) recortados (*stripped*), pero con tabla pclntab Go completamente intacta, permitiendo reconstruir nombres de paquetes, archivos fuente y números de línea exactos.

### S-003: CPAMC Dynamic Library Client & Unix Loader
- Family: PRIMARY
- URL or locator: `/app/internal/pluginhost/loader_unix.go` y `/app/internal/pluginhost/cliproxy_plugin.h` en binario CPAMC
- Date/version: v8.0.13
- Access method: Análisis estático de binario Go (`debug/gosym`, offsets de llamada `Cfunc_cliproxy_*`)
- Used for: Identificación del mecanismo de carga dinámica CGO/c-shared (`dlopen`, `dlsym`, `dlclose`, `cliproxy_call_init`, `cliproxy_shutdown_plugin`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que CPAMC no utiliza el paquete estándar `plugin` de Go (`plugin.Open`), sino una interfaz ABI C compartida construida sobre CGO y llamadas directas a libdl.

### S-004: CPAMC Plugin Host Engine (`host.go`, `registry.go`)
- Family: PRIMARY
- URL or locator: `/app/internal/pluginhost/host.go` (líneas 205-383, 648-857)
- Date/version: v8.0.13
- Access method: Extracción de flujo de control por PC a línea (`symTab.PCToLine`) y desensamblado
- Used for: Identificación de la secuencia de sincronización (`Host.mu.Lock()`), `ApplyConfig`, `UnloadPluginContext` y `ShutdownAllContext`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Revela que la recarga de configuración adquiere cerrojos exclusivos mientras invoca las funciones de apagado de plugins y recarga bibliotecas dinámicas.

### S-005: CPAMC Service Lifecycle & Config Watcher
- Family: PRIMARY
- URL or locator: `/app/sdk/cliproxy/service_lifecycle.go`, `service_config.go`, `service_plugins.go`
- Date/version: v8.0.13
- Access method: Desensamblado y trazado de símbolos `reloadConfigFromWatcher`, `syncPluginModelRuntime`, `(*Service).Run`
- Used for: Comprensión del bucle de eventos del servidor HTTP, el file watcher de configuración y la interacción entre el servidor Gin y el ciclo de vida de los plugins.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Muestra el mecanismo por el cual los eventos de modificación de archivos en el directorio de configuración o plugins desencadenan `reloadConfigFromWatcher`.

### S-006: Especificación Oficial del Runtime Go y Mecánica `-buildmode=c-shared`
- Family: PRIMARY
- URL or locator: `https://go.dev/cmd/cgo/` y documentación de `golang.org/x/mobile` / Go Runtime internals
- Date/version: Go 1.22 - Go 1.26
- Access method: Análisis de arquitectura del compilador Go
- Used for: Imposibilidad arquitectónica de descargar runtimes Go en memoria (`dlclose`), creación de hilos M/sysmon y multiplexación de manejadores de señales (`SIGURG`, `SIGSEGV`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: La especificación de Go establece formalmente que el runtime de Go inicializado dentro de una biblioteca C-shared no puede ser destruido ni descargado limpiamente por `dlclose()`.

### S-007: Mecánica del Cargador Dinámico de Linux glibc (`ld.so`)
- Family: PRIMARY
- URL or locator: glibc manual: Dynamic Linker Concurrency (`dlopen`, `dlclose`, `_dl_load_lock`)
- Date/version: glibc 2.36+ (Debian Bookworm base container)
- Access method: Documentación de estándares POSIX / GNU C Library
- Used for: Explicación de los bloqueos `futex_do_wait` por retención de `_dl_load_lock` durante constructores ELF que generan hilos o adquieren cerrojos del runtime.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Si una biblioteca compartida crea hilos de sistema operativo o ejecuta sincronizaciones complejas dentro de sus funciones de inicialización ELF, puede ocurrir un interbloqueo con el cerrojo global del cargador dinámico.

### S-008: Makefile de Compilación de OmniAuth Pro
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/omniauth-pro-plugin/Makefile`
- Date/version: v1.7.3 / HEAD
- Access method: `read` / `bash`
- Used for: Verificación de flags de compilación CGO (`CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -buildmode=c-shared`) y método de instalación (`cp $(BINARY_NAME) $(PLUGIN_DIR)/`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Revela que la instalación copia directamente el binario sobre el destino sin reemplazo atómico (`mv`), lo que puede corromper páginas de memoria activas si el archivo `.so` está abierto y mapeado (`mmap`).

### S-009: Script Canónico de Compilación de Auto Switcher Pro
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/scripts/build-plugin.sh`
- Date/version: HEAD
- Access method: `read` / `bash`
- Used for: Verificación de flags de compilación C-shared y aislamiento de artefactos en `bin/`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirma el uso de `golang:1.24` en Docker o host gcc para `-buildmode=c-shared`.

### S-010: Configuración Activa de CPAMC
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/services/cliproxy/config.yaml`
- Date/version: CPAMC v8.0.13
- Access method: Inspección de configuración local
- Used for: Verificación del puerto (`:8317`), configuración de watchers y rutas de montaje de plugins.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Define el directorio `/home/wilox/services/cliproxy/plugins/` mapeado hacia `/plugins/` en el contenedor.

### S-011: Inspección de Contenedor Docker `cli-proxy-api`
- Family: IMPLEMENTATION
- URL or locator: `docker inspect cli-proxy-api`
- Date/version: Docker Engine 28.5.1
- Access method: CLI de Docker
- Used for: Verificación de puertos mapeados (`0.0.0.0:8317->8317/tcp`), salud del contenedor y políticas de reinicio.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: El contenedor se mantiene en estado "Up" aun cuando el proceso principal queda bloqueado en CGO/futex sin poder aceptar conexiones entrantes.

### S-012: Registros de Ejecución de Plugins (`/tmp/omniauth-pro-plugin.log`)
- Family: IMPLEMENTATION
- URL or locator: `/tmp/omniauth-pro-plugin.log` dentro y fuera del contenedor Docker
- Date/version: 2026-10-23 - 2026-10-25
- Access method: `bash` tail y análisis temporal
- Used for: Registro empírico de eventos de invocación: `cliproxyPluginShutdown called`, `cliproxy_plugin_init called`, llamadas concurrentes a `model.static`, `auth.identifier` y `management.handle`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que en eventos de recarga anteriores se sucedieron secuencias inmediatas de Shutdown -> Init en el mismo milisegundo (ej. `23:14:16.246`), coincidiendo con las degradaciones de servicio.
