#!/usr/bin/env bash
# deploy-plugin-safe.sh - Despliegue atómico de plugins con reinicio ordenado
# Previene corrupción mmap y deadlocks en el runtime de Go (CGO / dlclose)
# Conforme a la política de ingeniería: compile -> test -> atomic mv -> docker restart

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/services/cliproxy/plugins"
ARCH="${1:-amd64}"
BINARY="auto-switcher-pro-linux-${ARCH}.so"
CONTAINER="cli-proxy-api"

echo "========================================================"
echo " [DEPLOY SEGURO] cpamc-auto-switcher -> ${BINARY}"
echo "========================================================"

# 1. Compilación canónica con script existente hacia bin/
cd "${REPO_ROOT}"
echo "==> [1/4] Compilando plugin (${ARCH})..."
./scripts/build-plugin.sh "${ARCH}"

SOURCE_BIN="${REPO_ROOT}/bin/${BINARY}"
if [ ! -f "${SOURCE_BIN}" ]; then
    echo "ERROR: No se encontró el binario generado: ${SOURCE_BIN}" >&2
    exit 1
fi

# 2. Verificación de tests de higiene
echo "==> [2/4] Verificando higiene..."
"${REPO_ROOT}/run.sh" hygiene

# 3. Despliegue atómico (evita truncado de memoria mmap)
echo "==> [3/4] Desplegando atómicamente en ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
TMP_DEST="${TARGET_DIR}/${BINARY}.tmp.$$"
cp "${SOURCE_BIN}" "${TMP_DEST}"
mv -f "${TMP_DEST}" "${TARGET_DIR}/${BINARY}"

# 4. Reinicio ordenado de CPAMC (garantiza un único runtime Go limpio)
echo "==> [4/4] Reiniciando contenedor ${CONTAINER}..."
if docker ps -q --filter "name=${CONTAINER}" | grep -q .; then
    docker restart "${CONTAINER}" >/dev/null
    echo "Contenedor ${CONTAINER} reiniciado exitosamente."
else
    echo "AVISO: Contenedor ${CONTAINER} no estaba en ejecución."
fi

# 5. Esperar a que el puerto HTTP esté activo y saludable
echo "==> Esperando confirmación de puerto HTTP (:8317)..."
MAX_WAIT=20
COUNT=0
READY=false
while [ "${COUNT}" -lt "${MAX_WAIT}" ]; do
    sleep 1
    if docker exec "${CONTAINER}" bash -c "exec 3<>/dev/tcp/127.0.0.1/8317 && echo -e 'GET /management.html HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' >&3 && head -n 1 <&3" 2>/dev/null | grep -q "200 OK"; then
        READY=true
        break
    fi
    COUNT=$((COUNT + 1))
done

if [ "${READY}" = "true" ]; then
    echo "========================================================"
    echo " ✅ DESPLIEGUE COMPLETADO Y VALIDADO EN :8317 (${COUNT}s)"
    echo "========================================================"
else
    echo "========================================================"
    echo " ⚠️ Despliegue aplicado pero el servicio tardó en responder."
    echo " Revisa 'docker logs ${CONTAINER}' para detalles."
    echo "========================================================"
fi
