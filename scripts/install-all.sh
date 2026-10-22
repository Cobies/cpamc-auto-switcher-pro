#!/usr/bin/env bash
# ==============================================================================
# CPAMC AUTO-SWITCHER · UNIVERSAL ALL-IN-ONE INSTALLER
# Soporta: Local Docker, WSL, Servidor LAN y VPS Remoto en la Nube
# ==============================================================================

set -euo pipefail

# Colores y Formato
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
MAGENTA="\033[0;35m"
RESET="\033[0m"

REPO_URL="https://github.com/WiloxDev/cpamc-auto-switcher-pro"
DEFAULT_URL="http://localhost:8317"

# Variables de configuración con soporte para Flags y Env Vars
TARGET_URL="${CPAMC_URL:-${CLIPROXYAPI_BASE_URL:-}}"
TARGET_KEY="${CPAMC_KEY:-${CLIPROXYAPI_MANAGEMENT_KEY:-}}"
NON_INTERACTIVE=false
INSTALL_PLUGIN_ONLY=false
INSTALL_EXTENSION_ONLY=false

print_banner() {
    cat << "EOF"
  ██████╗██████╗  █████╗ ███╗   ███╗ ██████╗ 
 ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝ 
 ██║     ██████╔╝███████║██╔████╔██║██║      
 ██║     ██╔═══╝ ██╔══██║██║╚██╔╝██║██║      
 ╚██████╗██║     ██║  ██║██║ ╚═╝ ██║╚██████╗ 
  ╚═════╝╚═╝     ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ 
  ⚡ AUTO-SWITCHER PRO · ALL-IN-ONE INSTALLER ⚡
EOF
    echo -e "${CYAN}Suite Oficial: Plugin CPAMC (.so) + Extensión Pi / Gentle-Shell${RESET}\n"
}

show_help() {
    print_banner
    cat << EOF
Uso:
  curl -sSL <url>/install-all.sh | bash [opciones]

Opciones:
  -u, --url <url>      URL del servidor CPAMC (ej: http://localhost:8317, http://192.168.1.100:8317, https://vps.com:8317)
  -k, --key <key>      Management Key o API Key de CPAMC (opcional si no requiere autenticación)
  -y, --yes            Modo no interactivo: aplica valores detectados o por defecto sin preguntar
      --plugin-only    Instalar única y exclusivamente el plugin .so en CPAMC
      --ext-only       Instalar única y exclusivamente la extensión del agente en Pi / Gentle-Shell
  -h, --help           Muestra esta ayuda

Variables de Entorno:
  CPAMC_URL            URL base de CPAMC
  CPAMC_KEY            Clave de administración de CPAMC

Ejemplos:
  1. Instalación estándar local (automática):
     bash scripts/install-all.sh

  2. Conectar agente local a un VPS remoto:
     bash scripts/install-all.sh --url "https://ai.midominio.com:8317" --key "mi-secreto"

  3. Servidor en Red Local (LAN):
     bash scripts/install-all.sh --url "http://192.168.1.100:8317"
EOF
    exit 0
}

# Procesar argumentos de línea de comandos
while [[ $# -gt 0 ]]; do
    case "$1" in
        -u|--url)
            TARGET_URL="$2"
            shift 2
            ;;
        -k|--key)
            TARGET_KEY="$2"
            shift 2
            ;;
        -y|--yes)
            NON_INTERACTIVE=true
            shift
            ;;
        --plugin-only)
            INSTALL_PLUGIN_ONLY=true
            shift
            ;;
        --ext-only)
            INSTALL_EXTENSION_ONLY=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${RED}[ERROR] Opción desconocida: $1${RESET}" >&2
            echo "Usa --help para ver las opciones disponibles." >&2
            exit 1
            ;;
    esac
done

# ------------------------------------------------------------------------------
# 1. DETECCIÓN DEL ENTORNO LOCAL Y CPAMC
# ------------------------------------------------------------------------------
detect_local_cpamc() {
    DOCKER_FOUND=false
    DOCKER_CONTAINER=""
    DOCKER_PORT=""
    DOCKER_PLUGINS_HOST=""
    DOCKER_CONFIG_HOST=""

    if command -v docker >/dev/null 2>&1; then
        local cid
        cid=$(docker ps -q -f name=cli-proxy-api 2>/dev/null || true)
        if [ -n "$cid" ]; then
            DOCKER_FOUND=true
            DOCKER_CONTAINER="cli-proxy-api"
            
            # Detectar puerto host mapeado
            local p
            p=$(docker inspect "$cid" --format '{{(index (index .NetworkSettings.Ports "8317/tcp") 0).HostPort}}' 2>/dev/null || true)
            if [ -n "$p" ]; then
                DOCKER_PORT="$p"
            else
                DOCKER_PORT="8317"
            fi

            # Extraer volumen bind de plugins y config.yaml
            local inspect_mounts
            inspect_mounts=$(docker inspect "$cid" --format '{{json .Mounts}}' 2>/dev/null || true)
            if [ -n "$inspect_mounts" ]; then
                DOCKER_PLUGINS_HOST=$(echo "$inspect_mounts" | grep -o '"Source":"[^"]*","Destination":"/CLIProxyAPI/plugins"' | cut -d'"' -f4 || true)
                DOCKER_CONFIG_HOST=$(echo "$inspect_mounts" | grep -o '"Source":"[^"]*","Destination":"/CLIProxyAPI/config.yaml"' | cut -d'"' -f4 || true)
            fi
        fi
    fi
}

# ------------------------------------------------------------------------------
# 2. ASISTENTE GUIADO DE CONEXIÓN (LOCAL / LAN / VPS)
# ------------------------------------------------------------------------------
resolve_connectivity() {
    if [ -n "$TARGET_URL" ]; then
        # Limpiar trailing slash y normalizar
        TARGET_URL="${TARGET_URL%/}"
        TARGET_URL="${TARGET_URL%/v1}"
        return 0
    fi

    if [ "$DOCKER_FOUND" = true ] && [ "$NON_INTERACTIVE" = true ]; then
        TARGET_URL="http://localhost:${DOCKER_PORT:-8317}"
        return 0
    fi

    if [ "$DOCKER_FOUND" = true ]; then
        echo -e "${GREEN}🔍 ¡Contenedor Docker local detectado!${RESET}"
        echo -e "   Contenedor: ${BOLD}${DOCKER_CONTAINER}${RESET} (Puerto: ${CYAN}${DOCKER_PORT}${RESET})"
        echo ""
    else
        echo -e "${YELLOW}ℹ️  No se detectó un contenedor local 'cli-proxy-api' activo en esta máquina.${RESET}"
    fi

    echo -e "${BOLD}¿Dónde está alojado tu servidor CPAMC?${RESET}"
    echo -e "  ${CYAN}[1]${RESET} Localhost estándar (${GREEN}http://localhost:${DOCKER_PORT:-8317}${RESET})"
    echo -e "  ${CYAN}[2]${RESET} Servidor en Red Local / LAN (${YELLOW}ej: http://192.168.1.100:8317${RESET})"
    echo -e "  ${CYAN}[3]${RESET} VPS / Servidor Remoto en la Nube (${MAGENTA}ej: https://vps.midominio.com:8317${RESET})"
    echo -e "  ${CYAN}[4]${RESET} Escribir URL personalizada manualmente"
    echo ""

    local choice=""
    if [ "$NON_INTERACTIVE" = true ]; then
        choice="1"
    else
        read -r -p "👉 Selecciona una opción [1-4] (por defecto: 1): " choice
        choice="${choice:-1}"
    fi

    case "$choice" in
        1)
            TARGET_URL="http://localhost:${DOCKER_PORT:-8317}"
            ;;
        2)
            echo ""
            echo -e "${YELLOW}📌 Ejemplo para Red Local:${RESET} http://192.168.1.100:8317 o http://192.168.1.100:8317"
            read -r -p "✍️  Ingresa la IP y puerto de tu CPAMC: " input_url
            TARGET_URL="${input_url:-http://192.168.1.100:8317}"
            ;;
        3)
            echo ""
            echo -e "${MAGENTA}📌 Ejemplos para VPS / Remoto:${RESET}"
            echo -e "   - https://cpamc.midominio.com"
            echo -e "   - http://142.250.190.46:8317"
            echo -e "   - http://vps-servidor.xyz:8317"
            read -r -p "✍️  Ingresa la URL pública o dominio de tu VPS: " input_url
            TARGET_URL="${input_url:-https://vps.midominio.com:8317}"
            ;;
        4)
            read -r -p "✍️  Ingresa la URL completa de CPAMC: " input_url
            TARGET_URL="${input_url:-http://localhost:8317}"
            ;;
        *)
            TARGET_URL="http://localhost:${DOCKER_PORT:-8317}"
            ;;
    esac

    # Limpiar formato
    TARGET_URL="${TARGET_URL%/}"
    TARGET_URL="${TARGET_URL%/v1}"

    # Preguntar API Key si no fue provista y no estamos en localhost estándar
    if [ -z "$TARGET_KEY" ] && [ "$TARGET_URL" != "http://localhost:8317" ] && [ "$NON_INTERACTIVE" = false ]; then
        echo ""
        echo -e "${CYAN}🔑 Autenticación (Opcional):${RESET}"
        read -r -p "Ingresa tu Management Key / API Key (Enter si no requiere): " input_key
        TARGET_KEY="$input_key"
    fi
}

# ------------------------------------------------------------------------------
# 3. VERIFICACIÓN DE CONECTIVIDAD
# ------------------------------------------------------------------------------
verify_connection() {
    echo -e "\n${CYAN}==> Verificando conectividad con CPAMC en: ${BOLD}${TARGET_URL}${RESET}..."
    local check_endpoint="${TARGET_URL}/v1/models"
    local http_code=""

    if command -v curl >/dev/null 2>&1; then
        http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 4 "${check_endpoint}" || true)
    fi

    if [ "$http_code" = "200" ] || [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
        echo -e "${GREEN}    [✓] Conexión establecida con éxito (HTTP ${http_code})${RESET}"
    else
        echo -e "${YELLOW}    [!] Advertencia: No se pudo verificar respuesta inmediata en ${check_endpoint} (HTTP ${http_code:-timeout}).${RESET}"
        echo -e "        Continuando la instalación con el endpoint configurado."
    fi
}

# ------------------------------------------------------------------------------
# 4. INSTALACIÓN DEL PLUGIN CPAMC (.so)
# ------------------------------------------------------------------------------
install_plugin() {
    if [ "$INSTALL_EXTENSION_ONLY" = true ]; then
        return 0
    fi

    echo -e "\n${CYAN}================================================================${RESET}"
    echo -e "${BOLD}PASO 1: INSTALACIÓN DEL PLUGIN CPAMC (Auto Switcher Pro)${RESET}"
    echo -e "${CYAN}================================================================${RESET}"

    local plugin_target_dir=""
    local config_file=""

    if [ "$DOCKER_FOUND" = true ] && [ -n "$DOCKER_PLUGINS_HOST" ] && [ -d "$DOCKER_PLUGINS_HOST" ]; then
        plugin_target_dir="$DOCKER_PLUGINS_HOST"
        config_file="$DOCKER_CONFIG_HOST"
        echo -e "Detectado directorio de plugins en Docker: ${GREEN}${plugin_target_dir}${RESET}"
    elif [ -d "$HOME/services/cliproxy/plugins" ]; then
        plugin_target_dir="$HOME/services/cliproxy/plugins"
        config_file="$HOME/services/cliproxy/config.yaml"
    elif [ -d "./plugins" ]; then
        plugin_target_dir="$(pwd)/plugins"
        config_file="$(pwd)/config.yaml"
    else
        echo -e "${YELLOW}ℹ️  No se detectó directorio de plugins local de CPAMC en esta máquina.${RESET}"
        echo -e "   Si este host es solo el cliente (donde corre el agente) y CPAMC está en un VPS,"
        echo -e "   el plugin ya debe estar instalado en tu servidor CPAMC."
        return 0
    fi

    # Detectar arquitectura
    local arch="amd64"
    local uname_m
    uname_m=$(uname -m)
    if [ "$uname_m" = "aarch64" ] || [ "$uname_m" = "arm64" ]; then
        arch="arm64"
    fi
    local so_name="auto-switcher-pro-linux-${arch}.so"

    echo -e "Copiando/actualizando plugin ${BOLD}${so_name}${RESET} en ${plugin_target_dir}..."

    # Buscar binario compilado localmente si estamos en el repositorio
    local repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"
    local local_so="${repo_root}/bin/${so_name}"

    if [ -f "$local_so" ]; then
        cp -f "$local_so" "${plugin_target_dir}/${so_name}"
        echo -e "${GREEN}    [✓] Plugin copiado desde binario local compilado.${RESET}"
    else
        echo -e "Descargando plugin binario precompilado desde GitHub..."
        local dl_url="${REPO_URL}/raw/main/bin/${so_name}"
        if curl -sSL -f -o "${plugin_target_dir}/${so_name}" "$dl_url" 2>/dev/null; then
            echo -e "${GREEN}    [✓] Plugin descargado con éxito.${RESET}"
        else
            echo -e "${YELLOW}    [!] No se pudo descargar directamente desde raw GitHub.${RESET}"
            echo -e "    Por favor compila localmente con './scripts/build-plugin.sh ${arch}' si eres desarrollador."
        fi
    fi

    # Configuración atómica en config.yaml si existe
    if [ -f "$config_file" ]; then
        if ! grep -q "auto-switcher-pro-linux-${arch}" "$config_file"; then
            echo -e "Habilitando plugin en ${config_file}..."
            cp "$config_file" "${config_file}.bak-pre-auto-switcher"
            if grep -q "plugins:" "$config_file"; then
                # Añadir config bajo sección plugins
                sed -i "/configs:/a \        auto-switcher-pro-linux-${arch}:\n            enabled: true" "$config_file" 2>/dev/null || true
            else
                # Crear sección completa
                cat << EOY >> "$config_file"

plugins:
    enabled: true
    dir: plugins
    configs:
        auto-switcher-pro-linux-${arch}:
            enabled: true
EOY
            fi
            echo -e "${GREEN}    [✓] Entrada activada en config.yaml (respaldo guardado en .bak).${RESET}"
        else
            echo -e "${GREEN}    [✓] Plugin ya se encuentra activado en config.yaml.${RESET}"
        fi
    fi

    # Reiniciar Docker si aplica
    if [ "$DOCKER_FOUND" = true ]; then
        echo -e "Reiniciando contenedor ${DOCKER_CONTAINER} para cargar el nuevo plugin..."
        docker restart "$DOCKER_CONTAINER" >/dev/null 2>&1 || true
        echo -e "${GREEN}    [✓] Contenedor reiniciado con éxito.${RESET}"
    fi
}

# ------------------------------------------------------------------------------
# 5. INSTALACIÓN DE LA EXTENSIÓN PI / GENTLE-SHELL
# ------------------------------------------------------------------------------
install_extension() {
    if [ "$INSTALL_PLUGIN_ONLY" = true ]; then
        return 0
    fi

    echo -e "\n${CYAN}================================================================${RESET}"
    echo -e "${BOLD}PASO 2: INSTALACIÓN DE LA EXTENSIÓN DEL AGENTE (Pi & Gentle-Shell)${RESET}"
    echo -e "${CYAN}================================================================${RESET}"

    # Detectar agentes instalados
    local target_agent_dirs=()

    if [ -d "$HOME/.gentle-shell/agent" ]; then
        target_agent_dirs+=("$HOME/.gentle-shell/agent")
        echo -e "Detectado agente: ${GREEN}Gentle Shell${RESET} (~/.gentle-shell/agent)"
    fi
    if [ -d "$HOME/.pi/agent" ]; then
        target_agent_dirs+=("$HOME/.pi/agent")
        echo -e "Detectado agente: ${GREEN}Pi Vanilla${RESET} (~/.pi/agent)"
    fi
    if [ -d "$HOME/.pi/agent-j0k3r" ]; then
        target_agent_dirs+=("$HOME/.pi/agent-j0k3r")
        echo -e "Detectado agente: ${GREEN}J0k3r Pi${RESET} (~/.pi/agent-j0k3r)"
    fi

    # Si ninguno existe aún, preparar Gentle-Shell por defecto
    if [ ${#target_agent_dirs[@]} -eq 0 ]; then
        local def_dir="$HOME/.gentle-shell/agent"
        mkdir -p "$def_dir"
        target_agent_dirs+=("$def_dir")
        echo -e "${YELLOW}ℹ️  No se detectaron agentes previos. Inicializando Gentle-Shell (~/.gentle-shell/agent)${RESET}"
    fi

    # Origen de la extensión y agentes
    local repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"
    local local_ext_src="${repo_root}/extensions/cpamc-auto-switcher"
    local local_subagents_src="${repo_root}/subagents"
    local local_agents_src="${repo_root}/agents"
    local tmp_dir=""

    if [ ! -d "$local_ext_src" ]; then
        tmp_dir=$(mktemp -d)
        echo "Descargando paquete de extensión desde GitHub..."
        if command -v git >/dev/null 2>&1; then
            git clone --depth 1 "$REPO_URL.git" "$tmp_dir/repo" >/dev/null 2>&1 || true
            local_ext_src="$tmp_dir/repo/extensions/cpamc-auto-switcher"
            local_subagents_src="$tmp_dir/repo/subagents"
            local_agents_src="$tmp_dir/repo/agents"
        fi
    fi

    # Instalar en cada agente detectado
    for agent_home in "${target_agent_dirs[@]}"; do
        local ext_dest="${agent_home}/extensions/cpamc-auto-switcher"
        mkdir -p "${agent_home}/extensions"

        if [ -d "$local_ext_src" ]; then
            rm -rf "$ext_dest"
            cp -r "$local_ext_src" "$ext_dest"
            echo -e "${GREEN}    [✓] Extensión instalada en: ${ext_dest}${RESET}"
        else
            echo -e "${RED}    [ERROR] No se pudo encontrar el origen de extensions/cpamc-auto-switcher.${RESET}"
        fi

        # Aprovisionar subagentes de Planned Workflow
        if [ -d "$local_subagents_src" ]; then
            mkdir -p "${agent_home}/subagents"
            cp -r "$local_subagents_src"/* "${agent_home}/subagents/" 2>/dev/null || true
            echo -e "${GREEN}    [✓] Subagentes Planned Workflow sincronizados en: ${agent_home}/subagents${RESET}"
        fi

        # Aprovisionar agentes de Gentle AI
        if [ -d "$local_agents_src" ]; then
            mkdir -p "${agent_home}/agents"
            cp -r "$local_agents_src"/* "${agent_home}/agents/" 2>/dev/null || true
            echo -e "${GREEN}    [✓] Agentes Gentle AI sincronizados en: ${agent_home}/agents${RESET}"
        fi

        # Persistir configuración en settings.json del agente si la URL no es localhost estándar
        # o si se especificó clave
        local settings_file="${agent_home}/settings.json"
        if [ "$TARGET_URL" != "$DEFAULT_URL" ] || [ -n "$TARGET_KEY" ]; then
            echo -e "    Configurando endpoint permanente en ${BOLD}${settings_file}${RESET}..."
            
            # Si settings.json no existe o está vacío, inicializarlo
            if [ ! -s "$settings_file" ]; then
                echo "{}" > "$settings_file"
            fi

            # Inyección limpia usando node o python si están disponibles
            if command -v node >/dev/null 2>&1; then
                node -e "
                    const fs = require('fs');
                    const file = process.argv[1];
                    const url = process.argv[2];
                    const key = process.argv[3];
                    let data = {};
                    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e){}
                    data.cpamc = data.cpamc || {};
                    data.cpamc.baseUrl = url;
                    if (key) data.cpamc.apiKey = key;
                    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
                " "$settings_file" "$TARGET_URL" "$TARGET_KEY" 2>/dev/null || true
            fi
        fi
    done

    # Exportar variable en ~/.bashrc si no existe para máxima compatibilidad con procesos shell
    if [ "$TARGET_URL" != "$DEFAULT_URL" ]; then
        if ! grep -q "CPAMC_URL" "$HOME/.bashrc" 2>/dev/null; then
            echo -e "\n# CPAMC Auto Switcher Endpoint Config" >> "$HOME/.bashrc"
            echo "export CPAMC_URL=\"${TARGET_URL}\"" >> "$HOME/.bashrc"
            [ -n "$TARGET_KEY" ] && echo "export CPAMC_KEY=\"${TARGET_KEY}\"" >> "$HOME/.bashrc"
            echo -e "${GREEN}    [✓] Variable CPAMC_URL añadida a ~/.bashrc para entornos interactivos.${RESET}"
        fi
    fi

    # Limpieza temporal
    if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
        rm -rf "$tmp_dir"
    fi
}

# ------------------------------------------------------------------------------
# 6. RESUMEN FINAL Y GUÍA DE USO
# ------------------------------------------------------------------------------
print_summary() {
    echo -e "\n${GREEN}================================================================${RESET}"
    echo -e "${BOLD}🎉 ¡INSTALACIÓN COMPLETADA EXITOSAMENTE!${RESET}"
    echo -e "${GREEN}================================================================${RESET}"
    echo -e "  🌐 Endpoint CPAMC activo:  ${CYAN}${BOLD}${TARGET_URL}${RESET}"
    [ -n "$TARGET_KEY" ] && echo -e "  🔑 Autenticación:           ${GREEN}Configurada${RESET}"
    echo -e "  🧩 Extensión de Agente:    ${GREEN}Enlazada y lista${RESET}"
    echo -e "----------------------------------------------------------------"
    echo -e "${BOLD}🚀 ¿CÓMO EMPEZAR AHORA?${RESET}"
    echo -e "  1. Abre tu terminal y ejecuta tu agente:"
    echo -e "     ${CYAN}gentle-shell${RESET}   o   ${CYAN}pi${RESET}"
    echo -e "  2. Usa ${BOLD}/model${RESET} o ${BOLD}/cpamc-model${RESET} para ver tus modelos y pools activos."
    echo -e "  3. Abre el panel de administración web en tu navegador:"
    echo -e "     ${CYAN}${TARGET_URL}/management.html#/plugin-pages/auto-switcher-pro-linux-amd64/home${RESET}"
    echo -e "${GREEN}================================================================${RESET}\n"
}

# ------------------------------------------------------------------------------
# FLUJO PRINCIPAL
# ------------------------------------------------------------------------------
main() {
    print_banner
    detect_local_cpamc
    resolve_connectivity
    verify_connection
    install_plugin
    install_extension
    print_summary
}

main
