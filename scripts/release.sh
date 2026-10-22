#!/usr/bin/env bash
# ==============================================================================
# CPAMC AUTO-SWITCHER PRO · SCRIPT DE RELEASE AUTOMÁTICO
# Calcula la siguiente versión SemVer, actualiza los archivos del proyecto,
# valida los tests y prepara el release oficial para GitHub.
# Uso: ./scripts/release.sh [patch|minor|major|<version>] [--push]
# ==============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_GO="${REPO_ROOT}/plugins/auto-switcher-pro/internal/version/version.go"
PACKAGE_WEB="${REPO_ROOT}/plugins/auto-switcher-pro/web/package.json"
PACKAGE_EXT="${REPO_ROOT}/extensions/cpamc-auto-switcher/package.json"

BUMP_TYPE="${1:-minor}"
DO_PUSH=false
for arg in "$@"; do
    if [ "$arg" = "--push" ]; then
        DO_PUSH=true
    fi
done

# 1. Verificar estado de Git
BRANCH=$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)
if [ "${BRANCH}" != "main" ]; then
    echo "❌ ERROR: Los releases oficiales deben realizarse desde la rama 'main' (actual: ${BRANCH})." >&2
    exit 1
fi

if ! git -C "${REPO_ROOT}" diff-index --quiet HEAD --; then
    echo "❌ ERROR: El árbol de trabajo no está limpio. Haz commit o stash de tus cambios antes de lanzar un release." >&2
    exit 1
fi

# 2. Leer versión actual
CURRENT_VERSION=$(grep -E 'const Version = "[^"]+"' "${VERSION_GO}" | sed -E 's/.*"([^"]+)".*/\1/')
echo "==> Versión actual detectada: v${CURRENT_VERSION}"

# 3. Calcular nueva versión
IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT_VERSION}"

case "${BUMP_TYPE}" in
    patch)
        PATCH=$((PATCH + 1))
        NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
        ;;
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
        ;;
    v*|[0-9]*)
        # Versión manual explícita
        NEW_VERSION="${BUMP_TYPE#v}"
        ;;
    *)
        echo "❌ Tipo de versión desconocido: '${BUMP_TYPE}'. Usa 'patch', 'minor', 'major' o una versión explícita como '0.2.0'." >&2
        exit 1
        ;;
esac

TAG="v${NEW_VERSION}"
echo "==> Nueva versión calculada: ${TAG}"

# Verificar que el tag no exista ya localmente
if git -C "${REPO_ROOT}" rev-parse "${TAG}" >/dev/null 2>&1; then
    echo "❌ ERROR: El tag '${TAG}' ya existe localmente." >&2
    exit 1
fi

# 4. Actualizar versión en archivos del proyecto
echo "==> Actualizando archivos de versión..."

# Go internal version
sed -i -E "s/const Version = \"[^\"]+\"/const Version = \"${NEW_VERSION}\"/" "${VERSION_GO}"

# Web package.json
if [ -f "${PACKAGE_WEB}" ]; then
    node -e "
        const fs = require('fs');
        const p = '${PACKAGE_WEB}';
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
        pkg.version = '${NEW_VERSION}';
        fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    "
fi

# Extension package.json
if [ -f "${PACKAGE_EXT}" ]; then
    node -e "
        const fs = require('fs');
        const p = '${PACKAGE_EXT}';
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
        pkg.version = '${NEW_VERSION}';
        fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    "
fi

# 5. Compilar assets web actualizados para garantizar paridad
if [ -d "${REPO_ROOT}/plugins/auto-switcher-pro/web" ]; then
    echo "==> Compilando bundle de frontend web para release..."
    (
        cd "${REPO_ROOT}/plugins/auto-switcher-pro/web"
        npm run build >/dev/null 2>&1 || true
    )
fi

# 6. Ejecutar tests locales antes de commitear
echo "==> Ejecutando suites de validación..."
(cd "${REPO_ROOT}/extensions/cpamc-auto-switcher" && bun test)
(cd "${REPO_ROOT}/plugins/auto-switcher-pro" && go test ./...)

# 7. Crear commit de Release y Tag
echo "==> Creando commit y tag para ${TAG}..."
git -C "${REPO_ROOT}" add "${VERSION_GO}" "${PACKAGE_WEB}" "${PACKAGE_EXT}"
if [ -f "${REPO_ROOT}/plugins/auto-switcher-pro/internal/web/assets/index.html" ]; then
    git -C "${REPO_ROOT}" add "${REPO_ROOT}/plugins/auto-switcher-pro/internal/web/assets/index.html"
fi

git -C "${REPO_ROOT}" commit -m "chore(release): bump version to ${TAG}"
git -C "${REPO_ROOT}" tag -a "${TAG}" -m "Release ${TAG}: auto-switcher-pro"

echo "=============================================================================="
echo "🎉 ¡Release ${TAG} preparado localmente con éxito!"
echo "=============================================================================="
echo "Commit creado: $(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
echo "Tag creado:    ${TAG}"
echo ""

if [ "${DO_PUSH}" = true ]; then
    echo "==> Realizando push automático a origin/main..."
    git -C "${REPO_ROOT}" push origin main
    echo "🚀 ¡Push completado! GitHub Actions detectará la nueva versión ${TAG}, compilará los binarios y publicará el Release automáticamente en GitHub."
else
    echo "Para publicar este release automáticamente en GitHub, ejecuta:"
    echo "  git push origin main"
fi
