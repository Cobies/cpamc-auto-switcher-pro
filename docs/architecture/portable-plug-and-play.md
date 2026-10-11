# Registro de Arquitectura (ADR-07): Portabilidad Universal 'Plug & Play' y Rebalanceo Proactivo de Sesión

**Fecha**: 2026-10-08  
**Estado**: Homologado y en Producción  
**Autor**: CTO & Engineering Team  
**Ámbito**: `cpamc-auto-switcher-pro` / `extensions/cpamc-auto-switcher` / Despliegue Universal

---

## 1. Contexto y Diagnóstico Previo

Durante la auditoría de portabilidad para distribución a terceros, se identificaron 4 barreras críticas que impedían que un amigo o colega utilizara el plugin mediante una copia o clonación directa:

1. **Secuestro de Red Local (LAN IP Hijack)**: En `provider.ts`, la URL por defecto forzaba `192.168.10.150:8317` e interceptaba activamente `localhost` o `127.0.0.1`, desviando el tráfico de la máquina local del amigo hacia la red privada del desarrollador original.
2. **Caché Confinada a Gentle-Shell**: Las rutas de persistencia asumían la existencia obligatoria de `~/.gentle-shell/agent/`, fallando silenciosamente en Pi Vanilla (`~/.pi/agent`) o `jok3r-pi`.
3. **Inercia Hacia Cuentas Fatigadas**: Al pasar horas entre turnos o arrancar sesiones nuevas con `/new` o `/reload`, el usuario quedaba atrapado en la cuenta activa desgastada (ej. `agy2` al 25%) mientras la reserva fresca permanecía intacta al 100%.
4. **Binarios Huérfanos Duplicados**: Coexistían `visual-profile-linux-amd64.so` y `auto-switcher-pro-linux-amd64.so` en el árbol de archivos.

---

## 2. Decisiones de Arquitectura Tomadas

### ADR-07.1: Desacoplamiento de Red y Resolución Universal de Base URL
- Se redefinió `DEFAULT_BASE_URL = "http://localhost:8317"`.
- Se eliminó la reescritura forzada de localhost/127.0.0.1. El sistema respeta limpiamente `CLIPROXYAPI_BASE_URL` o cae al puerto estándar de CLIProxyAPI en la máquina local.
- La clave `CLIPROXYAPI_API_KEY` se flexibilizó como opcional para proxies locales desprotegidos.

### ADR-07.2: Caché Multi-Entorno Universal
- Función `resolveCacheTargets()` inspecciona y escribe atómicamente en todos los directorios activos detectados en la máquina:
  - `PI_CODING_AGENT_DIR` (si está presente)
  - `~/.pi/agent/` (Pi Vanilla)
  - `~/.pi/agent-j0k3r/` (J0k3r Pi)
  - `~/.gentle-shell/agent/` (Gentle Shell)
- Creación segura y recursiva de directorios padre (`mkdirSync`).

### ADR-07.3: Rebalanceo Proactivo de Sesión en `session_start`
- En el gancho `session_start`, cuando el evento indique inicio o reinicio de sesión (`reason: "new" | "reload" | "startup"`):
  - Se evalúa la regla histerética: si la cuenta activa tiene menos del **50% de cuota libre** y la reserva más cercana le saca al menos **30% de ventaja**, se dispara una rotación proactiva automática.
  - Al ocurrir en la frontera de sesión, la rotación no destruye la caché de contexto (Prompt Caching) en curso.

### ADR-07.4: Instalador Unificado y Purgado de Huérfanos
- Creación de `install.sh` (instalador bash ejecutable en 1 paso que compila el CLI si Go existe y crea los symlinks automáticamente en cualquier entorno de Pi detectado).
- Eliminación del binario huérfano `visual-profile-linux-amd64.so`.

---

## 3. Matriz de Validación de Calidad

| Capa | Herramienta / Prueba | Resultado |
| :--- | :--- | :--- |
| **TypeScript Bundle** | `esbuild --bundle` | **0 Errores** (construcción limpia y rápida) |
| **Go Core Tests** | `go test ./...` | **100% PASS** (todos los paquetes) |
| **Web UI Tests** | `vitest run` | **100% PASS** (14 suites, 275 tests) |
| **Script Instalador** | `bash install.sh` | **100% OK** (detección multi-entorno y enlace atómico) |

---

## 4. Guía para Terceros (Instalación en 1 Línea)

Para que un amigo use el proyecto en su máquina:
```bash
git clone <repo-url> ~/projects/cpamc-auto-switcher
cd ~/projects/cpamc-auto-switcher
./install.sh
```
¡Listo! No requiere configuración adicional.
