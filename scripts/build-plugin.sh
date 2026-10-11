#!/usr/bin/env bash
# scripts/build-plugin.sh
# Script canónico para compilar auto-switcher-pro como plugin C-shared de CPAMC.
# Garantiza que los binarios y cabeceras generadas (.so y .h) residan única y
# exclusivamente en bin/, evitando archivos huérfanos en carpetas de código fuente.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/plugins/auto-switcher-pro"
BIN_DIR="${REPO_ROOT}/bin"

mkdir -p "${BIN_DIR}"

ARCH="${1:-amd64}"
echo "==> Compilando Auto Switcher Pro (Linux ${ARCH}) hacia ${BIN_DIR}..."

cd "${PLUGIN_DIR}"

if [ "${ARCH}" = "amd64" ]; then
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -buildmode=c-shared -ldflags="-s -w" -o "${BIN_DIR}/auto-switcher-pro-linux-amd64.so" .
elif [ "${ARCH}" = "arm64" ]; then
    CC="${CC:-aarch64-linux-gnu-gcc}"
    CGO_ENABLED=1 GOOS=linux GOARCH=arm64 CC="${CC}" \
    go build -buildmode=c-shared -ldflags="-s -w" -o "${BIN_DIR}/auto-switcher-pro-linux-arm64.so" .
else
    echo "Arquitectura no soportada: ${ARCH}" >&2
    exit 1
fi

# Saneamiento de seguridad post-compilación:
# Si Go por cualquier motivo generó algún .h o .so suelto en PLUGIN_DIR,
# moverlo a BIN_DIR o limpiarlo para garantizar que el código fuente quede impecable.
find "${PLUGIN_DIR}" -maxdepth 1 -type f \( -name "*.h" -o -name "*.so" \) -exec mv -f {} "${BIN_DIR}/" \; 2>/dev/null || true

echo "==> Compilación exitosa en ${BIN_DIR}:"
ls -lh "${BIN_DIR}"/auto-switcher-pro-linux-${ARCH}.*
