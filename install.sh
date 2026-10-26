#!/usr/bin/env bash
# ==============================================================================
# ⚡ AUTO SWITCHER PRO — Universal Plug & Play Installer
#
# Compatible con cualquier entorno de Pi:
# - Gentle-Shell (~/.gentle-shell/agent/extensions/)
# - Wilox-Pi (~/.pi/agent-wilox/extensions/)
# - Pi Vanilla (~/.pi/agent/extensions/ o ~/.pi/extensions/)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${SCRIPT_DIR}/extensions/cpamc-auto-switcher"

echo "=========================================================="
echo "⚡ Instalador Universal de CPAMC Auto-Switcher Pro"
echo "=========================================================="

if [ ! -d "${EXT_DIR}" ]; then
  echo "❌ Error: Directorio de extensión no encontrado en ${EXT_DIR}"
  exit 1
fi

# 1.1. Manejo de parámetro opcional de URL para servidores remotos (VPS / Proxmox / LAN)
# Uso opcional: ./install.sh [https://mi-vps.com:8317 o http://192.168.1.100:8317]
TARGET_URL="${1:-}"
if [ -n "${TARGET_URL}" ]; then
  CLEAN_URL="$(echo "${TARGET_URL}" | sed -e 's/\/\{1,\}$//' -e 's/\/v1$//')"
  echo "${CLEAN_URL}" > "${HOME}/.cliproxy_url"
  chmod 600 "${HOME}/.cliproxy_url" 2>/dev/null || true
  echo "🌐 Servidor CPAMC remoto configurado en ~/.cliproxy_url: ${CLEAN_URL}"
fi

# 1. Detectar o Compilar el Binario CLI de Go si 'go' está presente
if command -v go >/dev/null 2>&1; then
  echo "🔧 Compilando e instalando binario 'cpamc-auto-switcher'..."
  (cd "${SCRIPT_DIR}" && go install ./cmd/cpamc-auto-switcher)
  echo "✅ Binario 'cpamc-auto-switcher' instalado correctamente en PATH."
else
  echo "⚠️ Aviso: 'go' no está instalado en el sistema. Se utilizará la telemetría integrada de la extensión."
fi

# 2. Enlazar la extensión y sincronizar agentes en los entornos detectados
LINKED=0

sync_agents_and_subagents() {
  local agent_root="$1"
  local label="$2"

  if [ -d "${agent_root}" ]; then
    if [ -d "${SCRIPT_DIR}/subagents" ]; then
      mkdir -p "${agent_root}/subagents"
      cp -r "${SCRIPT_DIR}/subagents"/* "${agent_root}/subagents/" 2>/dev/null || true
      echo "🤖 Subagentes Planned Workflow sincronizados en [${label}]: ${agent_root}/subagents"
    fi
    if [ -d "${SCRIPT_DIR}/agents" ]; then
      mkdir -p "${agent_root}/agents"
      cp -r "${SCRIPT_DIR}/agents"/* "${agent_root}/agents/" 2>/dev/null || true
      echo "👥 Agentes Gentle AI sincronizados en [${label}]: ${agent_root}/agents"
    fi
  fi
}

link_extension() {
  local target_dir="$1"
  local label="$2"
  local agent_root="$(dirname "${target_dir}")"

  if [ -d "${agent_root}" ]; then
    mkdir -p "${target_dir}"
    ln -sfn "${EXT_DIR}" "${target_dir}/cpamc-auto-switcher"
    echo "🔗 Extensión vinculada con éxito en [${label}]: ${target_dir}/cpamc-auto-switcher"
    sync_agents_and_subagents "${agent_root}" "${label}"
    LINKED=1
  fi
}

# A. Gentle-Shell
link_extension "${HOME}/.gentle-shell/agent/extensions" "Gentle-Shell"

# B. Wilox-Pi
link_extension "${HOME}/.pi/agent-wilox/extensions" "Wilox-Pi"

# C. Pi Vanilla (~/.pi/agent/extensions o ~/.pi/extensions)
link_extension "${HOME}/.pi/agent/extensions" "Pi Vanilla (agent)"
link_extension "${HOME}/.pi/extensions" "Pi Vanilla (root)"

if [ "${LINKED}" -eq 0 ]; then
  # Si no existe ninguna de las carpetas anteriores, crear la ruta estándar de Pi
  DEFAULT_TARGET="${HOME}/.pi/agent/extensions"
  mkdir -p "${DEFAULT_TARGET}"
  ln -sfn "${EXT_DIR}" "${DEFAULT_TARGET}/cpamc-auto-switcher"
  echo "🔗 Extensión vinculada en la ruta predeterminada de Pi: ${DEFAULT_TARGET}/cpamc-auto-switcher"
fi

# ==============================================================================
# Parcheo idempotente y universal de Gentle-Shell layout (Linux y macOS M1-M4)
# ==============================================================================
patch_gentle_shell_layout() {
  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      try {
        const target = require.resolve('gentle-pi/lib/shell-sidebar-layout.ts');
        if (target && fs.existsSync(target)) {
          let content = fs.readFileSync(target, 'utf8');
          if (!content.includes('cpamc-quota-card')) {
            content = content.replace(/const sections = \[\"footer\",/, 'const sections = [\"footer\", \"cpamc-quota-card\",');
            fs.writeFileSync(target, content, 'utf8');
            console.log('  [✓] Layout de Gentle-Shell parcheado exitosamente en: ' + target);
          } else {
            console.log('  [✓] Gentle-Shell layout ya contiene cpamc-quota-card.');
          }
        }
      } catch {}
    " 2>/dev/null || true
  fi
}

patch_gentle_shell_layout

echo "=========================================================="
echo "🎉 ¡Instalación Completada con Éxito!"
echo ""
echo "Instrucciones de uso en tu sesión de Pi:"
echo "1. Ejecuta: /reload (o reinicia tu Pi)"
echo "2. Usa /model o /cpamc-model para seleccionar modelos con balanceo inteligente."
echo "=========================================================="
