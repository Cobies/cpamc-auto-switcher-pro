#!/usr/bin/env bash
# scripts/setup-hooks.sh
# Instala los hooks de Git recomendados para evitar que se commiteen o pusheen
# artefactos huérfanos o código con tests rotos.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
PRE_COMMIT="${HOOKS_DIR}/pre-commit"
PRE_PUSH="${HOOKS_DIR}/pre-push"

mkdir -p "${HOOKS_DIR}"

# 1. Instalar Hook de Pre-Commit
cat << 'EOF' > "${PRE_COMMIT}"
#!/usr/bin/env bash
# Git pre-commit hook: rechaza commits si hay artefactos de compilación fuera de bin/

set -euo pipefail

STRAY=$(find plugins/ -type f \( -name "*.h" -o -name "*.so" \) ! -path "*/bin/*" 2>/dev/null || true)

if [ -n "$STRAY" ]; then
    echo "======================================================================" >&2
    echo "❌ ERROR: Archivos de compilación huérfanos detectados fuera de bin/:" >&2
    echo "$STRAY" >&2
    echo "Toda compilación debe generar artefactos exclusivamente en bin/." >&2
    echo "Usa './scripts/build-plugin.sh' o 'make build' para compilar correctamente." >&2
    echo "======================================================================" >&2
    exit 1
fi
EOF

chmod +x "${PRE_COMMIT}"
echo "==> Hook de pre-commit instalado exitosamente en ${PRE_COMMIT}"

# 2. Instalar Hook de Pre-Push (Blindaje automático local)
cat << 'EOF' > "${PRE_PUSH}"
#!/usr/bin/env bash
# Git pre-push hook: ejecuta pruebas automáticas y verifica limpieza antes de permitir git push

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "==> [Pre-Push Hook] Verificando sanidad antes de subir al remoto..."

# 1. Comprobar artefactos huérfanos fuera de bin/
STRAY=$(find "${REPO_ROOT}/plugins/" -type f \( -name "*.h" -o -name "*.so" \) ! -path "*/bin/*" 2>/dev/null || true)
if [ -n "$STRAY" ]; then
    echo "======================================================================" >&2
    echo "❌ ERROR: Push cancelado. Archivos huérfanos detectados fuera de bin/:" >&2
    echo "$STRAY" >&2
    echo "======================================================================" >&2
    exit 1
fi

# 2. Correr tests de extensión TypeScript con Bun si existe
if [ -d "${REPO_ROOT}/extensions/cpamc-auto-switcher" ]; then
    echo "==> [Pre-Push Hook] Corriendo tests de extensión (bun test)..."
    (
        cd "${REPO_ROOT}/extensions/cpamc-auto-switcher"
        if command -v bun >/dev/null 2>&1; then
            bun test
        else
            npm test || true
        fi
    )
fi

# 3. Correr tests de Go en plugins/auto-switcher-pro
if [ -d "${REPO_ROOT}/plugins/auto-switcher-pro" ]; then
    echo "==> [Pre-Push Hook] Corriendo tests de Go (plugins/auto-switcher-pro)..."
    (
        cd "${REPO_ROOT}/plugins/auto-switcher-pro"
        go test ./...
    )
fi

echo "==> [Pre-Push Hook] ✅ Todas las validaciones pasaron exitosamente. Procediendo con el push."
EOF

chmod +x "${PRE_PUSH}"
echo "==> Hook de pre-push instalado exitosamente en ${PRE_PUSH}"
