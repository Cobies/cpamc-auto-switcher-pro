# Sources

## Source Index

### S-001: Backend Switcher Implementation (`internal/switcher/switcher.go`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/switcher/switcher.go`
- Date/version: v0.1.0 (2026-10-05)
- Access method: Direct file read
- Used for: Restricción estricta de cuenta activa única (línea 445), evaluación out-of-band de cuotas (`RunProvider`), Policy 3B y Policy 4A de intercambio de prefijos de 2 pasos.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que la comparación de candidatos solo ocurre cuando la cuenta activa supera los umbrales configurados; si la cuenta activa está por debajo del umbral, no se evalúan ni se tocan las reservas.

### S-002: Quota Parser and Rotation Policy (`internal/quota/quota.go`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/quota/quota.go`
- Date/version: v0.1.0 (2026-10-05)
- Access method: Direct file read
- Used for: Parseo de `retrieveUserQuotaSummary`, cálculo de peor caso (Policy 2A) y lógica de decisión `ShouldRotate` sobre ventanas de 5h y semanal.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Aísla familias por prefijo (`g*` para Gemini, `son*`/`opus*`/`clau*` para Claude).

### S-003: Pi Extension Failover Trigger Hook (`extensions/cpamc-auto-switcher/src/failover.ts`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/failover.ts`
- Date/version: v0.1.0 (2026-10-05)
- Access method: Direct file read
- Used for: Análisis del momento exacto en que se invoca la rotación (después de respuesta con 429, al final del mensaje de error, o al final de turno).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Prueba documental de que la rotación se ejecuta fuera de la ruta de datos HTTP y solo ante fallos o conclusiones de turnos.

### S-004: Dynamic Provider Catalog Filtering (`extensions/cpamc-auto-switcher/src/provider.ts`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/provider.ts`
- Date/version: v0.1.0 (2026-10-07)
- Access method: Direct file read
- Used for: Filtrado estricto de cuentas de reserva mediante la expresión regular `/_(\d+)$/`, impidiendo que aparezcan en el catálogo de Pi.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Garantiza que el usuario solo pueda enviar peticiones con el prefijo padre (`agy`), delegando el 100% del tráfico a la credencial asociada.

### S-005: Model Picker User Interface (`extensions/cpamc-auto-switcher/src/picker.ts`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-auto-switcher/src/picker.ts`
- Date/version: v0.1.0 (2026-10-07)
- Access method: Direct file read
- Used for: Lógica de presentación de modelos con etiquetas de rol (👑 Líder vs 🔄 Reserva) en el comando `/cpamc-model`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Muestra la jerarquía visual que induce la expectativa de enrutamiento en la experiencia de usuario.

### S-006: CLIProxyAPI Model Prefixing Logic (`sdk/cliproxy/service_models.go`)
- Family: IMPLEMENTATION
- URL or locator: Upstream repo `router-for-me/CLIProxyAPI` @ v8.0.13 (`sdk/cliproxy/service_models.go`)
- Date/version: v8.0.13 (commit `d7914af`)
- Access method: Prior investigation code analysis (`investigaciones/2026-10-03-2351-quota-groups-routing`)
- Used for: Doble registro de modelos (base sin prefijo y `prefix/model`) y asignación 1 a 1 de rutas de prefijo por credencial.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra cómo el enrutador resuelve peticiones prefijadas despachándolas exclusivamente a la credencial coincidente.

### S-007: CLIProxyAPI Selector & Routing Engine (`sdk/cliproxy/auth/selector.go` y `conductor_selection.go`)
- Family: IMPLEMENTATION
- URL or locator: Upstream repo `router-for-me/CLIProxyAPI` @ v8.0.13 (`sdk/cliproxy/auth/`)
- Date/version: v8.0.13 (commit `d7914af`)
- Access method: Prior investigation code analysis (`investigaciones/2026-10-04-0738-cliproxyapi-prioridades-nativas-b2`)
- Used for: Mecanismos de selección de candidatos (`RoundRobinSelector`, `FillFirstSelector`), prioridad y filtrado por cooldown.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que la selección multi-cuenta solo opera sobre modelos compartidos sin prefijo o cuando múltiples credenciales comparten el mismo identificador.

### S-008: Antigravity Quota Windows Definition (`retrieveUserQuotaSummary`)
- Family: PRIMARY
- URL or locator: `daily-cloudcode-pa.googleapis.com` capturado vía CLIProxyAPI Management API
- Date/version: Observado 2026-10-03
- Access method: Prior investigation live payload capture (`investigaciones/2026-10-03-2351-quota-groups-routing/report.md`)
- Used for: Estructura de cuotas en Antigravity: dos familias fijas (`Gemini Models` y `Claude and GPT models`) con ventanas de 5h y semanal.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Fundamento para la demostración del "Efecto Precipicio" ante consumo uniforme.

### S-009: Visual Profile Plugin C-ABI Interface (`plugins/visual-profile/internal/plugin/plugin.go`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/plugin.go`
- Date/version: v0.1.0 (2026-10-04)
- Access method: Direct file read
- Used for: Auditoría de capacidades del plugin actual (`management_api: true`), confirmando la ausencia de implementación de la capacidad `scheduler`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Evidencia clave de que el plugin actual es una interfaz de gestión y no un despachador de tráfico.

### S-010: Virtualization Engine (`plugins/visual-profile/internal/plugin/virtualize.go`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/virtualize.go`
- Date/version: v0.1.0 (2026-10-05)
- Access method: Direct file read
- Used for: Generación de credenciales virtuales con exclusiones de modelos (`excluded_models`) para aislar familias Claude/Gemini.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Explica por qué cada pool físico se virtualiza con un prefijo individual.

### S-011: Investigación Previa sobre Prioridades Nativas B2
- Family: RESEARCH
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-04-0738-cliproxyapi-prioridades-nativas-b2/report.md`
- Date/version: 2026-10-04
- Access method: Direct file read
- Used for: Análisis del soporte de prioridad nativa, capacidad `scheduler` (MethodSchedulerPick) y cooldowns en CLIProxyAPI.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Provee la base teórica para la arquitectura propuesta de balanceador `scheduler`.

### S-012: Investigación Previa sobre Grupos de Cuota y Enrutamiento
- Family: RESEARCH
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-03-2351-quota-groups-routing/report.md`
- Date/version: 2026-10-03
- Access method: Direct file read
- Used for: Corroboración de la coexistencia de modelos base y prefijados con `force-model-prefix: false`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Contexto operativo de la configuración de CLIProxyAPI.

### S-013: Configuración Local de CLIProxyAPI (`/home/wilox/services/cliproxy/config.yaml`)
- Family: PRIMARY
- URL or locator: `/home/wilox/services/cliproxy/config.yaml`
- Date/version: Modificado 2026-10-05
- Access method: Direct file read
- Used for: Parámetros en vivo de enrutamiento (`routing.cooldown.disable-cooling: false`, `retry.request-retry: 0`).
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Muestra el estado del entorno de producción local del usuario.
