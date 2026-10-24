# Guía de Gobernanza y Protección de Ramas (GitHub Rulesets)

## 1. Contexto y Diagnóstico
Durante la auditoría quirúrgica de protección de ramas en la organización/usuario `WiloxDev`, se comprobó que todos los repositorios públicos operaban con `"protected": false` en la rama predeterminada `main`. Esto permitió que commits con fallos de compilación o tests entraran directamente a producción sin pasar por Pull Request ni validación de CI.

## 2. Aplicación del Ruleset "Production Integrity Gate"

Para blindar `cpamc-auto-switcher-pro` (y el resto de repositorios de `WiloxDev`), aplicar las siguientes reglas:

### Opción A — Configuración vía GitHub Web UI (Recomendada)
1. Navegar al repositorio en GitHub: `https://github.com/WiloxDev/cpamc-auto-switcher-pro/settings/rules`.
2. Hacer clic en **New ruleset** > **New branch ruleset**.
3. **Ruleset Name:** `Production Integrity Gate`.
4. **Enforcement status:** Cambiar a `Active`.
5. **Target branches:** Seleccionar `Add target` > `Include default branch` (`main`).
6. **Branch protections:**
   - [x] **Restrict deletions:** Evita que la rama `main` sea eliminada.
   - [x] **Block force pushes:** Evita que se sobreescriba la historia con `git push --force`.
   - [x] **Require a pull request before merging:**
     - *Required approvals:* `0` (permite mergear tus propios PRs como único mantenedor sin depender de terceros, forzando la trazabilidad).
     - [x] *Require conversation resolution.*
   - [x] **Require status checks to pass before merging:**
     - Buscar y marcar los checks de GitHub Actions:
       - `Go tests (.)`
       - `Web tests`
       - `Build and Validate Linux Plugin`
       - `Go tests (plugins/auto-switcher-pro)`
7. Hacer clic en **Create**.

### Opción B — Importación vía GitHub REST API
Si disponés de un Personal Access Token (PAT) con permisos de `repo` o `admin:repo_hook`:
```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <TU_GITHUB_TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/WiloxDev/cpamc-auto-switcher-pro/rulesets \
  -d @docs/github-ruleset-production-gate.json
```

## 3. Procedimiento de Emergencia (Rollback)
Si un incidente en producción requiere un hotfix urgente y los checks de CI están bloqueados por un falso positivo externo:
1. Ir a `Settings > Rules > Rulesets`.
2. Entrar en `Production Integrity Gate`.
3. Cambiar `Enforcement status` a `Disabled`.
4. Aplicar el hotfix y **reactivar inmediatamente** el ruleset.
