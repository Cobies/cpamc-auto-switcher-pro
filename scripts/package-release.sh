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
elif [ "${OS}" = "darwin" ] || [ "${OS}" = "mac" ] || [ "${OS}" = "macos" ]; then
    "${REPO_ROOT}/scripts/build-plugin.sh" "darwin-arm64"
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

    # Lanzador ejecutable de 1 clic para Windows (Doble clic directo)
    cat << 'EOF' > "${PKG_DIR}/instalar.bat"
@echo off
setlocal
cd /d "%~dp0"
echo ==============================================================================
echo   CPAMC AUTO-SWITCHER PRO - INSTALADOR DE 1 CLIC (WINDOWS)
echo ==============================================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] La instalacion termino con codigo de error %ERRORLEVEL%.
)
echo.
echo Presione cualquier tecla para cerrar esta ventana...
pause >nul
EOF

    cat << 'EOF' > "${PKG_DIR}/LEEME.txt"
==============================================================================
⚡ CPAMC AUTO-SWITCHER PRO · GUÍA RÁPIDA DE INSTALACIÓN (WINDOWS)
==============================================================================

Para instalar el plugin y la extensión automáticamente en Windows:

Opción A (Recomendada - 1 solo clic):
- Haz doble clic en el archivo:
  instalar.bat

Opción B (Desde PowerShell):
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
elif [ "${OS}" = "darwin" ] || [ "${OS}" = "mac" ] || [ "${OS}" = "macos" ]; then
    # Copiar binario nativo dylib (si existe) y binario linux arm64 para Docker Desktop en Mac
    if [ -f "${REPO_ROOT}/bin/auto-switcher-pro-darwin-arm64.dylib" ]; then
        cp -f "${REPO_ROOT}/bin/auto-switcher-pro-darwin-arm64.dylib" "${PKG_DIR}/bin/"
    fi
    if [ -f "${REPO_ROOT}/bin/auto-switcher-pro-linux-arm64.so" ]; then
        cp -f "${REPO_ROOT}/bin/auto-switcher-pro-linux-arm64.so" "${PKG_DIR}/bin/"
    fi

    # Lanzador ejecutable de 1 clic para macOS Finder (Doble clic directo)
    cat << 'EOF' > "${PKG_DIR}/instalar.command"
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
echo "=============================================================================="
echo "⚡ CPAMC AUTO-SWITCHER PRO · INSTALADOR DE 1 CLIC (macOS Apple Silicon M1-M4)"
echo "=============================================================================="
echo ""
chmod +x ./instalar.sh
bash ./instalar.sh
echo ""
read -p "Presione [Enter] para cerrar esta ventana..."
EOF
    chmod +x "${PKG_DIR}/instalar.command"

    # Copiar script instalador autónomo
    cp -f "${REPO_ROOT}/scripts/package-template/instalar.sh" "${PKG_DIR}/"
    chmod +x "${PKG_DIR}/instalar.sh"

    # Copiar README de instrucciones rápidas
    cat << 'EOF' > "${PKG_DIR}/LEEME.txt"
==============================================================================
⚡ CPAMC AUTO-SWITCHER PRO · GUÍA RÁPIDA DE INSTALACIÓN (macOS Apple Silicon M1-M4)
==============================================================================

Para instalar el plugin y la extensión automáticamente en macOS:

Opción A (Recomendada - 1 solo clic):
- Haz doble clic en Finder sobre el archivo:
  instalar.command

Opción B (Desde Terminal):
1. Abre tu Terminal en esta carpeta descomprimida.
2. Ejecuta el instalador:
   bash instalar.sh

El script:
- Detectará si ejecutas CPAMC en Docker Desktop (Linux ARM64) o Nativo (.dylib).
- Instalará el plugin correspondiente en tu carpeta de plugins.
- Instalará y enlazará la extensión en Gentle-Shell o Pi (~/.gentle-shell o ~/.pi).
- Reiniciará CPAMC automáticamente.

Listo! Abre Gentle-Shell o Pi y escribe /model para comenzar.
==============================================================================
EOF
else
    SO_NAME="auto-switcher-pro-linux-${ARCH}.so"
    cp -f "${REPO_ROOT}/bin/${SO_NAME}" "${PKG_DIR}/bin/"

    # Copiar script instalador autónomo
    cp -f "${REPO_ROOT}/scripts/package-template/instalar.sh" "${PKG_DIR}/"
    chmod +x "${PKG_DIR}/instalar.sh"

    # Copiar README de instrucciones rápidas
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

# ------------------------------------------------------------------------------
# EMPAQUETADO Y OFUSCACIÓN DE LA EXTENSIÓN (ZERO PLAIN-TEXT SOURCE CODE)
# ------------------------------------------------------------------------------
echo "==> Empaquetando y ofuscando extensión para distribución comercial..."
mkdir -p "${PKG_DIR}/extensions/cpamc-auto-switcher"

ESBUILD_BIN="${REPO_ROOT}/plugins/auto-switcher-pro/web/node_modules/.bin/esbuild"
if [ ! -f "${ESBUILD_BIN}" ]; then
    ESBUILD_BIN="$(command -v esbuild 2>/dev/null || echo "")"
fi

if [ -n "${ESBUILD_BIN}" ] && [ -x "${ESBUILD_BIN}" ]; then
    "${ESBUILD_BIN}" "${REPO_ROOT}/extensions/cpamc-auto-switcher/index.ts" \
        --bundle \
        --platform=node \
        --format=esm \
        --target=node18 \
        --minify \
        --outfile="${PKG_DIR}/extensions/cpamc-auto-switcher/index.js"
    echo "    [✓] Extensión compilada y minificada en un único archivo index.js (sin fuentes TypeScript)"
else
    echo "    [!] Aviso: esbuild no encontrado, copiando extensión en modo compatible..."
    cp -r "${REPO_ROOT}/extensions/cpamc-auto-switcher" "${PKG_DIR}/extensions/"
    find "${PKG_DIR}/extensions" -name "*.test.ts" -delete 2>/dev/null || true
    find "${PKG_DIR}/extensions" -name "node_modules" -exec rm -rf {} + 2>/dev/null || true
fi

# Generar package.json cerrado de distribución
cat << 'EOF' > "${PKG_DIR}/extensions/cpamc-auto-switcher/package.json"
{
  "name": "cpamc-auto-switcher",
  "version": "1.0.0",
  "description": "Unified CPAMC Extension for Gentle-Shell & Pi (Commercial Release)",
  "type": "module",
  "main": "index.js",
  "pi": {
    "extensions": [
      "index.js"
    ]
  }
}
EOF

# Copiar README de la extensión si existe
if [ -f "${REPO_ROOT}/extensions/cpamc-auto-switcher/README.md" ]; then
    cp -f "${REPO_ROOT}/extensions/cpamc-auto-switcher/README.md" "${PKG_DIR}/extensions/cpamc-auto-switcher/"
fi

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
elif [ "${OS}" = "darwin" ] || [ "${OS}" = "mac" ] || [ "${OS}" = "macos" ]; then
    ZIP_NAME="cpamc-auto-switcher-darwin-arm64.zip"
    rm -f "${ZIP_NAME}"
    zip -r -q "${ZIP_NAME}" "cpamc-auto-switcher-release"
    echo ""
    echo "==> 🎉 Release macOS Apple Silicon (M1-M4) generado con éxito en:"
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
