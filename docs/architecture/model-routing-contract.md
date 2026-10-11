# Contrato Arquitectónico Canónico: Catálogo /model y Enrutamiento de Pools ($N \to \infty$)

## 1. El Concepto Fundamental: Fachada Virtual ("Líder Ficticio")

En el selector `/model` de Pi, **el usuario nunca interactúa directamente con una cuenta física fija**.

1. Cada entrada en `/model` representa una **Fachada Virtual (un Pool Activo)** registrado en Auto Switcher Pro.
2. Pi invoca la ruta estable del pool: `cpamc/<pool_prefix>/<modelo>`.
3. En el backend, Auto Switcher Pro resuelve esa fachada hacia la credencial física que actualmente ejerce de Líder.
4. Cuando dicha credencial se agota (por ventana de 5h, límite semanal o código HTTP 429), Auto Switcher Pro **intercambia dinámicamente el Líder y su Reserva** (`_1`, `_2`, etc.) en caliente con **cero caídas (zero-downtime)**.
5. Para Pi, la llamada continúa de forma transparente e ininterrumpida a través de la misma fachada virtual.

---

## 2. Los Cuatro Mandamientos Arquitectónicos Inmutables

### Mandamiento I: 1 Entrada en `/model` = 1 Pool Activo ($N \to \infty$)
- Cada grupo / pool / perfil registrado en Auto Switcher Pro (`base_prefix`) tiene **su propia entrada independiente** en `/model`.
- Si existen $N$ pools ($1, 2, 5, 20 \dots \infty$), `/model` publica **los $N$ pools**.
- **PROHIBICIÓN ESTRICTA**: Ninguna regla de código ni agente de IA puede colapsar, fusionar o "sombrear" (`shadow`) pools hermanos bajo la premisa de "pertenecer a la misma familia". Cada pool es una unidad de enrutamiento autónoma.

### Mandamiento II: Independencia de Modelos por Pool (La Tuerca ⚙️)
- Cada pool administra sus propios modelos permitidos y excluidos según las exclusiones físicas (`excluded_models`) de su cuenta Líder.
- Si el pool `agy` es especialista en `gemini-3.8-flash-high`, expone únicamente ese modelo.
- Si el pool hermano `agy2` es multipropósito, expone todos los modelos de la familia.
- Los pools jamás se interfieren ni se imponen políticas entre sí.

### Mandamiento III: Diferenciación Estricta de Claude
Claude tiene dos orígenes técnicos totalmente distintos que **nunca deben mezclarse**:
1. **Google Antigravity Package (Cloud Code / Cuentas Google)**:
   - Prefijo obligatorio con `agy_`.
   - Estrictamente dividido en dos niveles:
     - `agy_son*` $\to$ Únicamente modelos **Sonnet** (`claude-sonnet-4-6`).
     - `agy_opus*` $\to$ Únicamente modelos **Opus** (`claude-opus-4-6`).
     - *Google Cloud Code no ofrece Claude genérico ni Haiku.*
2. **Claude Directo (Anthropic Oficial)**:
   - Prefijo obligatorio: `clau*` o `claude*` (NUNCA empieza con `agy_`).
   - Expone el catálogo oficial completo de Anthropic (`claude-3-5-haiku`, `claude-3-7-sonnet`, `claude-3-opus`).

### Mandamiento IV: Invisibilidad Absoluta de Reservas
- Todo prefijo que termine en un sufijo numérico de reserva (`_1`, `_2`, `_3`...) pertenece a la infraestructura interna del banquillo de rotación.
- **JAMÁS debe aparecer en `/model`**.

---

## 3. Matriz Universal de Proyección en `/model`

```text
/model en Pi (Directorio Universal de Fachadas de Pools Activos)

📦 GOOGLE ANTIGRAVITY (Gemini & Claude del Paquete)
 ├── 💎 agy/gemini-3.8-flash-high       ➔ Fachada Pool 1 (Auto Switcher rota inf...tec ⇄ inf...vio)
 ├── 💎 agy2/gemini-3.8-flash-high      ➔ Fachada Pool 2 (Auto Switcher rota mar...tro ⇄ wil...o11)
 ├── 💎 agyN/...                        ➔ Fachada Pool N (Escalabilidad infinita)
 ├── 🔶 agy_son/claude-sonnet-4-6       ➔ Especialista Sonnet (Rota cuentas Google autorizadas)
 └── 🟣 agy_opus/claude-opus-4-6        ➔ Especialista Opus (Rota cuentas Google autorizadas)

🏢 ANTHROPIC NATIVO (Claude Directo)
 ├── 🏷️ clau/claude-3-5-haiku           ➔ Fachada Pool Claude Directo #1 (Catálogo completo)
 ├── 🏷️ clau/claude-3-7-sonnet
 ├── 🏷️ clau/claude-3-opus
 └── 🏷️ clauN/...                       ➔ Fachada Pool Claude Directo #N (Escalabilidad infinita)

🧩 OPENAI (Codex Directo)
 ├── 🧩 codex/gpt-5.6-codex             ➔ Fachada Pool Codex #1 (Rota cuentas OpenAI)
 └── 🧩 codexN/...                      ➔ Fachada Pool Codex #N (Escalabilidad infinita)
```
