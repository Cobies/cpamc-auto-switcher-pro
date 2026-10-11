#!/usr/bin/env bash
# run.sh - CLI unificado para cpamc-auto-switcher
# Funciona de manera idéntica a make pero sin requerir make instalado en el host.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${REPO_ROOT}"

show_help() {
    echo "Uso: ./run.sh <comando>"
    echo ""
    echo "Comandos disponibles:"
    echo "  build         - Compila el plugin para Linux amd64 hacia bin/"
    echo "  build-arm64   - Compila el plugin para Linux arm64 hacia bin/"
    echo "  test          - Ejecuta todas las pruebas (Go y Web) + check de higiene"
    echo "  test-go       - Ejecuta las pruebas unitarias de Go"
    echo "  test-web      - Ejecuta la suite de pruebas de Vitest"
    echo "  hygiene       - Verifica que no existan artefactos de compilación fuera de bin/"
    echo "  clean         - Limpia el directorio bin/"
}

CMD="${1:-help}"

case "${CMD}" in
    build)
        ./scripts/build-plugin.sh amd64
        ;;
    build-arm64)
        ./scripts/build-plugin.sh arm64
        ;;
    test-go)
        echo "==> Ejecutando pruebas de Go..."
        go test ./...
        go -C plugins/auto-switcher-pro test ./...
        ;;
    test-web)
        echo "==> Ejecutando pruebas de Vitest..."
        cd plugins/auto-switcher-pro/web && npx vitest run
        ;;
    hygiene)
        echo "==> Verificando higiene de código fuente..."
        STRAY=$(find plugins/ -type f \( -name "*.h" -o -name "*.so" \) ! -path "*/bin/*" 2>/dev/null || true)
        if [ -n "${STRAY}" ]; then
            echo "ERROR: Se detectaron artefactos huérfanos de compilación fuera de bin/:"
            echo "${STRAY}"
            exit 1
        fi
        echo "OK: Código fuente limpio (0 residuos fuera de bin/)."
        ;;
    test)
        "${REPO_ROOT}/run.sh" test-go
        "${REPO_ROOT}/run.sh" test-web
        "${REPO_ROOT}/run.sh" hygiene
        ;;
    clean)
        echo "==> Limpiando directorio bin/..."
        rm -rf bin/auto-switcher-pro-linux-*
        echo "Directorio bin/ limpio."
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Comando desconocido: ${CMD}"
        show_help
        exit 1
        ;;
esac
