#!/usr/bin/env bash
# ==============================================================================
# ⚡ AUTO SWITCHER PRO — Universal Plug & Play Installer
#
# Compatible con cualquier entorno de Pi:
# - Gentle-Shell (~/.gentle-shell/agent/extensions/)
# - J0k3r-Pi (~/.pi/agent-j0k3r/extensions/)
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

# 1. Detectar o Compilar el Binario CLI de Go si 'go' está presente
if command -v go >/dev/null 2>&1; then
  echo "🔧 Compilando e instalando binario 'cpamc-auto-switcher'..."
  (cd "${SCRIPT_DIR}" && go install ./cmd/cpamc-auto-switcher)
  echo "✅ Binario 'cpamc-auto-switcher' instalado correctamente en PATH."
else
  echo "⚠️ Aviso: 'go' no está instalado en el sistema. Se utilizará la telemetría integrada de la extensión."
fi

# 2. Enlazar la extensión en los entornos detectados
LINKED=0

link_extension() {
  local target_dir="$1"
  local label="$2"

  if [ -d "$(dirname "${target_dir}")" ]; then
    mkdir -p "${target_dir}"
    ln -sfn "${EXT_DIR}" "${target_dir}/cpamc-auto-switcher"
    echo "🔗 Extensión vinculada con éxito en [${label}]: ${target_dir}/cpamc-auto-switcher"
    LINKED=1
  fi
}

# A. Gentle-Shell
link_extension "${HOME}/.gentle-shell/agent/extensions" "Gentle-Shell"

# B. J0k3r-Pi
link_extension "${HOME}/.pi/agent-j0k3r/extensions" "J0k3r-Pi"

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

echo "=========================================================="
echo "🎉 ¡Instalación Completada con Éxito!"
echo ""
echo "Instrucciones de uso en tu sesión de Pi:"
echo "1. Ejecuta: /reload (o reinicia tu Pi)"
echo "2. Usa /model o /cpamc-model para seleccionar modelos con balanceo inteligente."
echo "=========================================================="
