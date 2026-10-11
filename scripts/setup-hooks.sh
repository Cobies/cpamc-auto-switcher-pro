#!/usr/bin/env bash
# scripts/setup-hooks.sh
# Instala los hooks de Git recomendados para evitar que se commiteen
# artefactos huérfanos (.h o .so) fuera de bin/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
PRE_COMMIT="${HOOKS_DIR}/pre-commit"

mkdir -p "${HOOKS_DIR}"

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
