# Sources

## Source Index

### S-001: plugins/visual-profile/main.go (exportaciones C-ABI)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/main.go
- Date/version: v0.1.0 (plugin), repo state 2026-10-03
- Access method: read (archivo local)
- Used for: ciclo de vida C-ABI (init/call/free/shutdown), structs cliproxy_host_api/plugin_api
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: fuente con build tag `cgo`; `main_nocgo.go` es stub. No se inspeccionó el `.so` binario.

### S-002: plugins/visual-profile/internal/plugin/plugin.go (despacho de métodos y servidor management.handle)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/internal/plugin/plugin.go
- Date/version: v0.1.0
- Access method: read
- Used for: registro (plugin.register líneas 52-72, management.register 74-109), MatchProfilesRoute (121-152), HandleManagementHTTP (168-288), envelope, metadatos "Auto switcher pro"/gonzalez962
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: el GitHubRepository del registro apunta a gonzalez962/cpamc-auto-switcher, no al remoto real del usuario (WiloxDev/cpamc-auto-switcher-pro) — inconsistencia menor registrada en el reporte.

### S-003: plugins/visual-profile/internal/handlers/resource.go (ResourceHandler net/http alternativo)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/internal/handlers/resource.go
- Date/version: v0.1.0
- Access method: read
- Used for: evidencia de doble implementación del servidor de estáticos y divergencia de códigos de error (404 vs 400 en traversal)
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: no se trazó en runtime cuál de los dos caminos usa el host; se marca como redundancia probable.

### S-004: plugins/visual-profile/README.md
- Family: PRIMARY
- URL or locator: plugins/visual-profile/README.md
- Date/version: v0.1.0
- Access method: read
- Used for: contrato declarado (rutas, convención de prefijos, justificación del reducer atómico, build Docker)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: el README sobreafirma "exact segment matching"; la implementación coincide con segmento en cualquier posición del path.

### S-005: web/src/api/managementClient.js (cliente Management API)
- Family: PRIMARY (código de aplicación; comportamiento verificado por lectura)
- URL or locator: plugins/visual-profile/web/src/api/managementClient.js
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: getManagementKey/deobfuscateCPAMC (120-260), apiFetch y sanitización (280-400), listAuthFiles/downloadAuthFilePrefix (404-500), loadAuthFilesWithPrefixes fail-closed (502-560), buildGraphFromAuthFiles e inferencia greedy (565-660, regex en 612), patchAuthFilePrefix (691-790), saveAuthFilePrefixes Promise.allSettled (791-831)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: base de las conclusiones F1, F5, F6, F7, F8, F18.

### S-006: web/src/graph/connection.js (funciones puras de topología)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/graph/connection.js
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: calculateChildPrefix (16), getNextChildNumber anti-colisión (66-100), validateConnection un-solo-padre (152-206), partitionEdgeRemovals poda iterativa (246-315)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-007: web/src/graph/graphReducer.js (reducer atómico)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/graph/graphReducer.js
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: connectNodesAtomic (46-115), removeEdgesAtomic/disconnect (117-210), UPDATE_NODE_PREFIX con desenganche silencioso de arista (236-310), RECONCILE_SAVED_NODES (414-470)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-008: web/src/components/ProfileGraph.jsx (editor visual y modal de grupos)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/components/ProfileGraph.jsx
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: handleSaveChanges y baseline (258-460), freeNodes (637-650), handleSubmitGroup staging local (742-807), handleDissolvePool solo root+reservas directas (809-855), onConnect (225-238), guard duplicado en handleNodePrefixChange (240-268)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-009: web/src/components/GroupManager.jsx (gestor de pools a pantalla completa)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/components/GroupManager.jsx
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: freeNodes sin aristas (25-33), filtro binario de proveedor (39-52), existingPools regex greedy (54-90), handleCreateGroup con PATCH inmediato e ignora `failed` (115-167, éxito en 153-161, `${base}_${idx+1}` en 145), handleDissolvePool (170-196)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: hallazgo crítico F5 se apoya en la combinación con S-005 (saveAuthFilePrefixes no lanza).

### S-010: web/src/components/ControlSwitcher.jsx (telemetría de pools)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/components/ControlSwitcher.jsx
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: polling 20 s (251), discovery de pools por prefijo (256-470), pools canónicos hardcodeados g1/g2/son (266-285, 333-342), resetDate literal '02 de Octubre' (416), métricas cuota vía api-call proxy (130-205)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-011: web/src/components/PrefixManager.jsx (asignación libre de prefijos)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/components/PrefixManager.jsx
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: clasificación de roles por prefijo (12-28), detección visual de colisiones (63-72, 292), PATCH inmediato (117-155)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM

### S-012: web/src/App.jsx (shell de la SPA y header)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/App.jsx
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: enrutado por pathname (10-31), carga de graphData (46-75), handleHeaderForceCheck que solo recarga (82-98), propiedad counts con fallback literal `|| 14`
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-013: web/src/graph/layout.js (layout determinista)
- Family: PRIMARY
- URL or locator: plugins/visual-profile/web/src/graph/layout.js
- Date/version: estado del repo 2026-10-03
- Access method: read (parcial, cabecera y constantes)
- Used for: contexto del AUTO_ARRANGE; sin hallazgos críticos
- Usefulness: CONTEXT
- Confidence impact: LOW

### S-014: internal/config/config.go (host: ParsePrefix y convenciones)
- Family: PRIMARY
- URL or locator: internal/config/config.go
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: ParsePrefix greedy (110-190) — resolución `base_perfil_N` y ambigüedad `team_2`; ConventionForProfile (204-213)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-015: internal/switcher/switcher.go (host: motor de rotación)
- Family: PRIMARY
- URL or locator: internal/switcher/switcher.go
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: descubrimiento de perfiles (285-310), error "multiple active accounts" (458-462), selección Policy 3B, swap 2 pasos Policy 4A (606-625)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-016: cmd/cpamc-auto-switcher/main.go (host: CLI y cooldown)
- Family: PRIMARY
- URL or locator: cmd/cpamc-auto-switcher/main.go
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: flags --force/--check/--switch, cooldown persistido en disco (246-280), flujo de rotación por CLI
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-017: README.md raíz del repo
- Family: PRIMARY
- URL or locator: README.md
- Date/version: estado del repo 2026-10-03
- Access method: read (cabecera)
- Used for: reglas de rotación declaradas (umbrales 90/95, políticas 1A/2A/3B/4A, jerarquía de pools)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM

### S-018: Engram memory — contexto de sesiones previas (deploy del plugin y diseño de submenús)
- Family: IMPLEMENTATION
- URL or locator: mem:context (proyecto cpamc-auto-switcher, sesiones 2026-10-02/03)
- Date/version: 2026-10-02 a 2026-10-03
- Access method: mem_context
- Used for: contexto de que el sidebar de CPAMC se puebla desde management.register del C-ABI, deploy del .so a /home/wilox/services/cliproxy/plugins, historial del feature "agrupar"/pools
- Usefulness: CONTEXT
- Confidence impact: LOW
- Notes: no se usó como prueba de comportamiento del código; solo orientación de investigación.

## Discarded / Low-value sources

- `plugins/visual-profile/web/src/analytics/*`, `PulseTokens.jsx` (1032 líneas): submenú de telemetría de tokens, fuera del foco "agrupar"; no leído en profundidad (solo listado).
- `plugins/visual-profile/web/src/components/*.test.jsx`, `graph/*.test.js`: tests leídos solo por conteo (confirman cobertura del reducer); no citados como evidencia de comportamiento.
- `internal/web/embed.go`, `internal/version/version.go`: triviales, consistentes con lo descrito; no aportan hallazgos.
- `visual-profile-linux-amd64.so` / `.h`: binario y cabecera generada; el `.h` coincide con el preámbulo de `main.go` (verificación de procedencia), no se desensambló el `.so`.
- `node_modules/` de `web/`: excluido del análisis.
