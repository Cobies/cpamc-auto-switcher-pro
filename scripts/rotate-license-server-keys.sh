#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE ROTACIÓN DE CLAVES Y HARDENING (PHASE 0) · LICENSE HUB
# ==============================================================================
# Uso: ./scripts/rotate-license-server-keys.sh [target_dir]
# ==============================================================================
set -euo pipefail

TARGET_DIR="${1:-cmd/license-server}"
ENV_FILE="${TARGET_DIR}/.env"

echo "=== [Phase 0] Blindaje Operativo del Servidor de Licencias ==="

if [ ! -d "${TARGET_DIR}" ]; then
  echo "Error: Directorio ${TARGET_DIR} no encontrado."
  exit 1
fi

echo "1. Generando nuevo ADMIN_TOKEN de alta entropía (48 caracteres hex)..."
NEW_ADMIN_TOKEN=$(openssl rand -hex 24)

echo "2. Verificando o generando semilla Ed25519 V2..."
NEW_SEED=$(openssl rand -hex 32)

echo "3. Generando archivo de configuración seguro en ${ENV_FILE}..."
cat <<EOF > "${ENV_FILE}"
# CPAMC Cloud License Hub - Producción Segura
PORT=8444
DB_PATH=/data/licenses.json

# Clave de administración para la UI y API interna
ADMIN_TOKEN=${NEW_ADMIN_TOKEN}

# Semilla privada Ed25519 para firma de licencias
PRIVATE_SEED_HEX=${NEW_SEED}
EOF

chmod 600 "${ENV_FILE}"
echo "✅ ${ENV_FILE} creado con permisos 600 (lectura/escritura exclusiva)."
echo ""
echo "Resumen de Credenciales Generadas:"
echo "--------------------------------------------------"
echo "ADMIN_TOKEN:      ${NEW_ADMIN_TOKEN}"
echo "PRIVATE_SEED_HEX: (Almacenada de forma segura en .env)"
echo "--------------------------------------------------"
echo "Instrucciones de Despliegue en VPS:"
echo "  1. En el VPS, copiar cmd/license-server completo y ejecutar este script."
echo "  2. Verificar que el registro DNS A 'hub.wiloxdev.com' apunte a la IP pública del VPS."
echo "  3. Iniciar servicios con TLS automático:"
echo "     docker compose down && docker compose up -d --build"
echo "  4. Verificar logs de Caddy y License Hub:"
echo "     docker compose logs -f caddy"
echo "=================================================="
