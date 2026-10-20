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
OS="${2:-linux}"

echo "==> Generando Release de Distribución (${OS} ${ARCH})..."

# 1. Compilar plugin CGO con script canónico
if [ "${OS}" = "windows" ]; then
    "${REPO_ROOT}/scripts/build-plugin.sh" "windows-amd64"
else
    "${REPO_ROOT}/scripts/build-plugin.sh" "${ARCH}"
fi

# 2. Preparar carpeta temporal limpia de release
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/bin"
mkdir -p "${PKG_DIR}/extensions"

# 3. Copiar ÚNICAMENTE los archivos de ejecución (Sin fuentes .go, .jsx, etc.)
if [ "${OS}" = "windows" ]; then
    DLL_NAME="auto-switcher-pro-windows-amd64.dll"
    cp -f "${REPO_ROOT}/bin/${DLL_NAME}" "${PKG_DIR}/bin/"
    
    # Copiar instalador de PowerShell
    cp -f "${REPO_ROOT}/scripts/install-windows.ps1" "${PKG_DIR}/instalar.ps1"

    cat << 'EOF' > "${PKG_DIR}/LEEME.txt"
==============================================================================
⚡ CPAMC AUTO-SWITCHER PRO · GUÍA RÁPIDA DE INSTALACIÓN (WINDOWS)
==============================================================================

Para instalar el plugin y la extensión automáticamente en Windows:

1. Abre PowerShell en esta carpeta descomprimida.
2. Ejecuta el instalador local:
   .\instalar.ps1

El instalador:
- Detectará automáticamente tus perfiles de Gentle-Shell y Pi (~/.gentle-shell y ~/.pi).
- Respaldará automáticamente cualquier versión anterior existente.
- Detectará tu servidor CPAMC (cli-proxy-api.exe o CLIProxyAPI.exe) e instalará la DLL.
- Activará la entrada correspondiente en tu config.yaml con respaldo previo.

Listo! Abre Gentle-Shell y escribe /model para comenzar.
==============================================================================
EOF
else
    SO_NAME="auto-switcher-pro-linux-${ARCH}.so"
    cp -f "${REPO_ROOT}/bin/${SO_NAME}" "${PKG_DIR}/bin/"

    # Copiar script instalador autónomo
    cp -f "${REPO_ROOT}/scripts/package-template/instalar.sh" "${PKG_DIR}/"
    chmod +x "${PKG_DIR}/instalar.sh"

    # Copiar README de instrucciones rápidas para el amigo
    cat << 'EOF' > "${PKG_DIR}/LEEME.txt"
==============================================================================
⚡ CPAMC AUTO-SWITCHER PRO · GUÍA RÁPIDA DE INSTALACIÓN (LINUX)
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
fi

# Copiar extensión lista para Pi
cp -r "${REPO_ROOT}/extensions/cpamc-auto-switcher" "${PKG_DIR}/extensions/"

# Limpiar posibles restos en la extensión
find "${PKG_DIR}/extensions" -name "*.test.ts" -delete 2>/dev/null || true
find "${PKG_DIR}/extensions" -name "node_modules" -exec rm -rf {} + 2>/dev/null || true

# 4. Crear archivo comprimido .tar.gz o .zip
cd "${DIST_DIR}"
if [ "${OS}" = "windows" ]; then
    ZIP_NAME="cpamc-auto-switcher-windows-amd64.zip"
    rm -f "${ZIP_NAME}"
    zip -r -q "${ZIP_NAME}" "cpamc-auto-switcher-release"
    echo ""
    echo "==> 🎉 Release Windows generado con éxito en:"
    echo "    ${DIST_DIR}/${ZIP_NAME}"
    echo "    Tamaño: $(du -h "${DIST_DIR}/${ZIP_NAME}" | cut -f1)"
else
    TAR_NAME="cpamc-auto-switcher-release-linux-${ARCH}.tar.gz"
    tar -czvf "${TAR_NAME}" "cpamc-auto-switcher-release"
    echo ""
    echo "==> 🎉 Release generado con éxito en:"
    echo "    ${DIST_DIR}/${TAR_NAME}"
    echo "    Tamaño: $(du -h "${DIST_DIR}/${TAR_NAME}" | cut -f1)"
fi
echo ""
