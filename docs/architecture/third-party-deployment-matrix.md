# Guía Canónica de Despliegue para Terceros y Asistentes AI

Esta guía documenta las respuestas y consideraciones operativas cuando un asistente AI (Gentle-Shell, Pi o Claude) de un cliente o colaborador despliega **Auto Switcher Pro**:

---

## 1. Matriz de Decisiones TUI / Asistente AI (4 Pasos)

Cuando el agente del cliente realiza las 4 preguntas de control previas al despliegue:

### [1/4] Código fuente vs Release compilado
- **Decisión**: Utilizar el release oficial empaquetado (`cpamc-auto-switcher-release-linux-amd64.tar.gz`).
- **Motivo**: No expone código fuente en Go ni TypeScript, incluye el plugin CGO optimizado y el frontend React empaquetado en singlefile.

### [2/4] Versión del binario
- **Opción seleccionada**: **`La que marque el repo de Wilox`** (`origin/main`).
- **Motivo**: Auto Switcher Pro está diseñado como un plugin modular no intrusivo y retrocompatible. Funciona tanto con CPAMC v7.3.3 como v8 sobre los endpoints nativos `/v0/management/`, sin necesidad de recompilar el binario core de CPAMC.

### [3/4] Gestión de Credenciales
- **Opción seleccionada**: **`Volumen separado (recomendado)`**.
- **Justificación de seguridad**: Reutilizar el directorio `auths/` nativo de producción es peligroso porque el proceso de refresco OAuth de Google rota tokens y puede invalidar sesiones concurrentes del servidor en producción. Un volumen separado aísla las credenciales de prueba y protege las cuentas reales.

### [4/4] Alcance de Integración
- **Opción seleccionada**: **`También apuntar mis agentes al dev`**.
- **Motivo**: Para que el usuario final pueda ver y utilizar de inmediato los Pools en `/model` dentro de Gentle-Shell o Pi, la extensión debe apuntar a la instancia que tiene cargado el plugin de Auto Switcher Pro. Si se selecciona "solo dev", los agentes seguirán consultando la instancia nativa sin balanceo ni pools.

---

## 2. Tipologías de Despliegue Detectadas

El instalador autónomo (`instalar.sh`) soporta automáticamente:

1. **Docker**: Contenedor `cli-proxy-api` con volúmenes montados en `/CLIProxyAPI/plugins` y `/CLIProxyAPI/config.yaml`.
2. **Systemd Bare-Metal**: Servicios `cli-proxy-api.service` o `cliproxy.service` (como en `/opt/fabrica/cli-proxy-api`), aplicando reinicios automáticos seguros sin interrumpir el daemon de docker.
3. **Instalación de Extensión Multi-Harness**: Detección dinámica de todas las instancias en `~/.gentle-shell/agent/extensions/` y `~/.pi/agent*/extensions/`.
