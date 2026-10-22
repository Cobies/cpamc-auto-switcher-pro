#!/usr/bin/env bash
# ==============================================================================
# CPAMC AUTO-SWITCHER PRO · INSTALADOR DE DISTRIBUCIÓN
# Instala el plugin compilado (.so) y la extensión de Pi sin requerir código fuente.
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "\n${CYAN}================================================================${RESET}"
echo -e "${BOLD}⚡ INSTALADOR AUTOMÁTICO · AUTO SWITCHER PRO ⚡${RESET}"
echo -e "${CYAN}================================================================${RESET}\n"

# ------------------------------------------------------------------------------
# 1. INSTALAR EL PLUGIN EN CPAMC (SYSTEMD/NATIVO, DOCKER O LOCAL)
# ------------------------------------------------------------------------------
echo -e "${BOLD}PASO 1: Detectando CPAMC (Systemd, Proceso Nativo o Docker)...${RESET}"

DOCKER_FOUND=false
DOCKER_CONTAINER=""
DOCKER_PLUGINS_HOST=""
CONFIG_FILE=""
SYSTEMD_SERVICE=""
RESTART_CMD=""

# A. Detección por servicio Systemd activo (ej: cli-proxy-api.service)
if command -v systemctl >/dev/null 2>&1; then
    for s_name in "cli-proxy-api.service" "cliproxy.service" "cliproxyapi.service"; do
        if systemctl is-active --quiet "$s_name" 2>/dev/null; then
            SYSTEMD_SERVICE="$s_name"
            RESTART_CMD="sudo systemctl restart $s_name"
            echo -e "${GREEN}  [✓] Servicio Systemd activo detectado:${RESET} ${BOLD}${s_name}${RESET}"
            break
        fi
    done
fi

# B. Detección por proceso nativo en ejecución (/proc/*/exe o ps)
NATIVE_DIR=""
if [ -z "$TARGET_PLUGIN_DIR" ]; then
    proc_pid=$(pgrep -f "cli-proxy-api" 2>/dev/null | head -n 1 || true)
    if [ -n "$proc_pid" ]; then
        proc_cwd=$(readlink -f "/proc/$proc_pid/cwd" 2>/dev/null || true)
        proc_exe=$(readlink -f "/proc/$proc_pid/exe" 2>/dev/null || true)
        proc_parent=$(dirname "$proc_exe")
        
        # Probar candidatos comunes del binario nativo (ej: /opt/fabrica/cli-proxy-api)
        for cand in "$proc_cwd" "$proc_parent" "$(dirname "$proc_parent")"; do
            if [ -f "$cand/config.yaml" ] || [ -d "$cand/plugins" ]; then
                NATIVE_DIR="$cand"
                CONFIG_FILE="$cand/config.yaml"
                break
            fi
        done
        if [ -n "$NATIVE_DIR" ]; then
            echo -e "${GREEN}  [✓] CPAMC nativo detectado en PID ${proc_pid}:${RESET} ${BOLD}${NATIVE_DIR}${RESET}"
        fi
    fi
fi

# C. Detección en Docker
if [ -z "$NATIVE_DIR" ] && command -v docker >/dev/null 2>&1; then
    cid=$(docker ps -q -f name=cli-proxy-api 2>/dev/null || true)
    if [ -z "$cid" ]; then
        cid=$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'cliproxy|cli-proxy' | awk '{print $1}' | head -n 1 || true)
    fi
    if [ -n "$cid" ]; then
        DOCKER_FOUND=true
        DOCKER_CONTAINER=$(docker inspect "$cid" --format '{{.Name}}' 2>/dev/null | tr -d '/')
        RESTART_CMD="docker restart $cid"
        inspect_mounts=$(docker inspect "$cid" --format '{{json .Mounts}}' 2>/dev/null || true)
        if [ -n "$inspect_mounts" ]; then
            DOCKER_PLUGINS_HOST=$(echo "$inspect_mounts" | grep -o '"Source":"[^"]*","Destination":"/CLIProxyAPI/plugins"' | cut -d'"' -f4 || true)
            CONFIG_FILE=$(echo "$inspect_mounts" | grep -o '"Source":"[^"]*","Destination":"/CLIProxyAPI/config.yaml"' | cut -d'"' -f4 || true)
        fi
    fi
fi

TARGET_PLUGIN_DIR=""

if [ -n "$NATIVE_DIR" ]; then
    TARGET_PLUGIN_DIR="${NATIVE_DIR}/plugins"
    mkdir -p "$TARGET_PLUGIN_DIR"
    echo -e "      Directorio de plugins nativo: ${CYAN}${TARGET_PLUGIN_DIR}${RESET}"
elif [ "$DOCKER_FOUND" = true ] && [ -n "$DOCKER_PLUGINS_HOST" ] && [ -d "$DOCKER_PLUGINS_HOST" ]; then
    TARGET_PLUGIN_DIR="$DOCKER_PLUGINS_HOST"
    echo -e "${GREEN}  [✓] Contenedor Docker detectado:${RESET} ${BOLD}${DOCKER_CONTAINER}${RESET}"
    echo -e "      Directorio de plugins: ${CYAN}${TARGET_PLUGIN_DIR}${RESET}"
elif [ -d "/opt/fabrica/cli-proxy-api/plugins" ]; then
    TARGET_PLUGIN_DIR="/opt/fabrica/cli-proxy-api/plugins"
    CONFIG_FILE="/opt/fabrica/cli-proxy-api/config.yaml"
    echo -e "${GREEN}  [✓] CPAMC en /opt/fabrica detectado:${RESET} ${TARGET_PLUGIN_DIR}"
elif [ -d "$HOME/services/cliproxy/plugins" ]; then
    TARGET_PLUGIN_DIR="$HOME/services/cliproxy/plugins"
    CONFIG_FILE="$HOME/services/cliproxy/config.yaml"
    echo -e "${GREEN}  [✓] Directorio CPAMC estándar detectado:${RESET} ${TARGET_PLUGIN_DIR}"
else
    echo -e "${YELLOW}  [?] No se detectó automáticamente el directorio de plugins de CPAMC.${RESET}"
    read -r -p "  👉 Ingresa la ruta completa a la carpeta 'plugins' de tu CPAMC: " user_plugin_dir
    TARGET_PLUGIN_DIR="$user_plugin_dir"
fi

if [ -n "$TARGET_PLUGIN_DIR" ]; then
    mkdir -p "$TARGET_PLUGIN_DIR" 2>/dev/null || true
    ARCH="amd64"
    uname_m=$(uname -m)
    if [ "$uname_m" = "aarch64" ] || [ "$uname_m" = "arm64" ]; then
        ARCH="arm64"
    fi

    SO_NAME="auto-switcher-pro-linux-${ARCH}.so"
    SRC_SO="${DIR}/bin/${SO_NAME}"

    if [ -f "$SRC_SO" ]; then
        # Copiar tanto el nombre con arquitectura como el nombre genérico
        cp -f "$SRC_SO" "${TARGET_PLUGIN_DIR}/${SO_NAME}" 2>/dev/null || sudo cp -f "$SRC_SO" "${TARGET_PLUGIN_DIR}/${SO_NAME}"
        cp -f "$SRC_SO" "${TARGET_PLUGIN_DIR}/auto-switcher-pro.so" 2>/dev/null || sudo cp -f "$SRC_SO" "${TARGET_PLUGIN_DIR}/auto-switcher-pro.so"
        echo -e "${GREEN}  [✓] Plugin copiado exitosamente en: ${TARGET_PLUGIN_DIR}/${SO_NAME}${RESET}"

        # Configurar config.yaml si existe
        if [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ]; then
            if ! grep -q "auto-switcher-pro" "$CONFIG_FILE"; then
                echo -e "      Habilitando plugin en config.yaml..."
                cp "$CONFIG_FILE" "${CONFIG_FILE}.bak-auto-switcher" 2>/dev/null || sudo cp "$CONFIG_FILE" "${CONFIG_FILE}.bak-auto-switcher"
                if grep -q "plugins:" "$CONFIG_FILE"; then
                    sed -i "/configs:/a \        auto-switcher-pro-linux-${ARCH}:\n            enabled: true" "$CONFIG_FILE" 2>/dev/null || sudo sed -i "/configs:/a \        auto-switcher-pro-linux-${ARCH}:\n            enabled: true" "$CONFIG_FILE" 2>/dev/null || true
                else
                    cat << EOY >> "$CONFIG_FILE"

plugins:
    enabled: true
    dir: plugins
    configs:
        auto-switcher-pro-linux-${ARCH}:
            enabled: true
EOY
                fi
                echo -e "${GREEN}      [✓] Activado en config.yaml (respaldo guardado en .bak)${RESET}"
            fi
        fi

        # Reiniciar servicio o contenedor automáticamente
        if [ -n "$RESTART_CMD" ]; then
            echo -e "      Reiniciando CPAMC ($RESTART_CMD)..."
            eval "$RESTART_CMD" >/dev/null 2>&1 || true
            echo -e "${GREEN}      [✓] CPAMC reiniciado con éxito.${RESET}"
        fi
    else
        echo -e "${RED}  [ERROR] No se encontró el binario ${SRC_SO} dentro del paquete.${RESET}"
    fi
else
    echo -e "${RED}  [ERROR] No se pudo instalar el plugin. Directorio no válido: ${TARGET_PLUGIN_DIR}${RESET}"
fi

# ------------------------------------------------------------------------------
# 2. INSTALAR LA EXTENSIÓN EN PI / GENTLE-SHELL (DETECCIÓN EXHAUSTIVA)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}PASO 2: Detectando y configurando agentes (Pi / Gentle-Shell)...${RESET}"

TARGET_AGENT_DIRS=()

# 1. Variables de entorno prioritarias
if [ -n "${PI_CODING_AGENT_DIR:-}" ] && [ -d "$PI_CODING_AGENT_DIR" ]; then
    TARGET_AGENT_DIRS+=("$PI_CODING_AGENT_DIR")
fi
if [ -n "${GENTLE_AGENT_DIR:-}" ] && [ -d "$GENTLE_AGENT_DIR" ]; then
    TARGET_AGENT_DIRS+=("$GENTLE_AGENT_DIR")
fi

# 2. Escaneo dinámico en ~/.pi/agent*
if [ -d "$HOME/.pi" ]; then
    for entry in "$HOME/.pi"/agent*; do
        if [ -d "$entry" ]; then
            TARGET_AGENT_DIRS+=("$entry")
        fi
    done
fi

# 3. Escaneo dinámico en ~/.gentle-shell/agent*
if [ -d "$HOME/.gentle-shell" ]; then
    for entry in "$HOME/.gentle-shell"/agent*; do
        if [ -d "$entry" ]; then
            TARGET_AGENT_DIRS+=("$entry")
        fi
    done
fi

# Deduplicar lista de directorios de agentes
UNIQUE_TARGETS=()
if [ ${#TARGET_AGENT_DIRS[@]} -gt 0 ]; then
    while IFS= read -r dir; do
        [ -n "$dir" ] && UNIQUE_TARGETS+=("$dir")
    done < <(printf "%s\n" "${TARGET_AGENT_DIRS[@]}" | sort -u)
fi

# Si no se encontró ningún agente, inicializar ~/.pi/agent por defecto
if [ ${#UNIQUE_TARGETS[@]} -eq 0 ]; then
    DEF_AGENT="$HOME/.pi/agent"
    mkdir -p "$DEF_AGENT"
    UNIQUE_TARGETS+=("$DEF_AGENT")
    echo -e "${YELLOW}  [i] No se detectó instalación previa de agente. Inicializando: ${DEF_AGENT}${RESET}"
fi

SRC_EXT="${DIR}/extensions/cpamc-auto-switcher"

if [ -d "$SRC_EXT" ]; then
    for agent_dir in "${UNIQUE_TARGETS[@]}"; do
        dest_ext="${agent_dir}/extensions/cpamc-auto-switcher"
        mkdir -p "${agent_dir}/extensions"
        rm -rf "$dest_ext"
        cp -r "$SRC_EXT" "$dest_ext"
        echo -e "${GREEN}  [✓] Extensión instalada y lista en:${RESET} ${BOLD}${dest_ext}${RESET}"
    done
else
    echo -e "${RED}  [ERROR] No se encontró la carpeta de extensión ${SRC_EXT} dentro del paquete.${RESET}"
fi

echo -e "\n${GREEN}================================================================${RESET}"
echo -e "${BOLD}🎉 ¡INSTALACIÓN COMPLETADA EXITOSAMENTE!${RESET}"
echo -e "${GREEN}================================================================${RESET}"
echo -e "  1. Inicia o reinicia tu agente en terminal: ${CYAN}${BOLD}pi${RESET} o ${CYAN}${BOLD}gentle-shell${RESET}"
echo -e "  2. En el chat escribe ${BOLD}/model${RESET} para ver tus pools y balanceo activo."
echo -e "${GREEN}================================================================${RESET}\n"
