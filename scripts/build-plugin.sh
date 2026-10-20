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

has_gcc() {
    command -v "${1:-gcc}" >/dev/null 2>&1
}

has_docker() {
    command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

if [ "${ARCH}" = "amd64" ]; then
    if has_gcc "gcc"; then
        CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
        go build -buildmode=c-shared -ldflags="-s -w" -o "${BIN_DIR}/auto-switcher-pro-linux-amd64.so" .
    elif has_docker; then
        echo "==> GCC no encontrado en el host. Compilando mediante contenedor Docker golang:1.24..."
        docker run --rm \
            --user "$(id -u):$(id -g)" \
            -v "${REPO_ROOT}:/workspace" \
            -w /workspace/plugins/auto-switcher-pro \
            -e CGO_ENABLED=1 \
            -e GOOS=linux \
            -e GOARCH=amd64 \
            golang:1.24 \
            go build -buildmode=c-shared -ldflags="-s -w" -o /workspace/bin/auto-switcher-pro-linux-amd64.so .
    else
        echo "Error: Se requiere 'gcc' en el host o un daemon de Docker activo para compilar con CGO." >&2
        exit 1
    fi
elif [ "${ARCH}" = "arm64" ]; then
    CC="${CC:-aarch64-linux-gnu-gcc}"
    if has_gcc "${CC}"; then
        CGO_ENABLED=1 GOOS=linux GOARCH=arm64 CC="${CC}" \
        go build -buildmode=c-shared -ldflags="-s -w" -o "${BIN_DIR}/auto-switcher-pro-linux-arm64.so" .
    elif has_docker; then
        echo "==> GCC ARM64 (${CC}) no encontrado en el host. Compilando mediante contenedor Docker..."
        docker run --rm \
            --user "$(id -u):$(id -g)" \
            -v "${REPO_ROOT}:/workspace" \
            -w /workspace/plugins/auto-switcher-pro \
            -e CGO_ENABLED=1 \
            -e GOOS=linux \
            -e GOARCH=arm64 \
            golang:1.24 \
            go build -buildmode=c-shared -ldflags="-s -w" -o /workspace/bin/auto-switcher-pro-linux-arm64.so .
    else
        echo "Error: Se requiere '${CC}' en el host o Docker para compilación cruzada ARM64." >&2
        exit 1
    fi
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
