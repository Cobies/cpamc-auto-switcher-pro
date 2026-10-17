#!/usr/bin/env bash
# ==============================================================================
# CPAMC AUTO-SWITCHER PRO · GENERADOR DE RELEASE DE DISTRIBUCIÓN
# Compila el plugin y empaqueta exclusivamente binarios y extensión.
# Cero código fuente en Go o React expuesto.
# ==============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"
PKG_DIR="${DIST_DIR}/cpamc-auto-switcher-release"
ARCH="${1:-amd64}"

echo "==> Generando Release de Distribución (Linux ${ARCH})..."

# 1. Compilar plugin CGO con script canónico
"${REPO_ROOT}/scripts/build-plugin.sh" "${ARCH}"

# 2. Preparar carpeta temporal limpia de release
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/bin"
mkdir -p "${PKG_DIR}/extensions"

# 3. Copiar ÚNICAMENTE los archivos de ejecución (Sin fuentes .go, .jsx, etc.)
SO_NAME="auto-switcher-pro-linux-${ARCH}.so"
cp -f "${REPO_ROOT}/bin/${SO_NAME}" "${PKG_DIR}/bin/"

# Copiar extensión lista para Pi
cp -r "${REPO_ROOT}/extensions/cpamc-auto-switcher" "${PKG_DIR}/extensions/"

# Limpiar posibles restos en la extensión
find "${PKG_DIR}/extensions" -name "*.test.ts" -delete 2>/dev/null || true
find "${PKG_DIR}/extensions" -name "node_modules" -exec rm -rf {} + 2>/dev/null || true

# Copiar script instalador autónomo
cp -f "${REPO_ROOT}/scripts/package-template/instalar.sh" "${PKG_DIR}/"
chmod +x "${PKG_DIR}/instalar.sh"

# Copiar README de instrucciones rápidas para el amigo
cat << 'EOF' > "${PKG_DIR}/LEEME.txt"
==============================================================================
⚡ CPAMC AUTO-SWITCHER PRO · GUÍA RÁPIDA DE INSTALACIÓN
==============================================================================

Para instalar el plugin y la extensión automáticamente:

1. Abre tu terminal en esta carpeta.
2. Ejecuta el instalador:
   bash instalar.sh

El script:
- Detectará tu contenedor Docker de CPAMC e instalará el plugin.
- Instalará y enlazará la extensión en tu Pi / Gentle-Shell (~/.pi o ~/.gentle-shell).
- Reiniciará el contenedor automáticamente.

Listo! Abre Pi o Gentle-Shell y escribe /model para comenzar.
==============================================================================
EOF

# 4. Crear archivo comprimido .tar.gz
TAR_NAME="cpamc-auto-switcher-release-linux-${ARCH}.tar.gz"
cd "${DIST_DIR}"
tar -czvf "${TAR_NAME}" "cpamc-auto-switcher-release"

echo ""
echo "==> 🎉 Release generado con éxito en:"
echo "    ${DIST_DIR}/${TAR_NAME}"
echo "    Tamaño: $(du -h "${DIST_DIR}/${TAR_NAME}" | cut -f1)"
echo ""
