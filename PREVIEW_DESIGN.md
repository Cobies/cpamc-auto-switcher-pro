# Vista Previa — Diseño Limpio de Prefijos y Identificadores

> **Estado actual**: Ya implementado, validado por tests, cero cambios necesarios.
> Este documento muestra **qué ve el usuario** vs **qué ocurre internamente**.

---

## 🎯 Contrato Visual (Lo que ve el usuario en Pi / AutoAuthFiles)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🗂️ AUTO AUTH FILES & TRAZABILIDAD                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ 🔀 Cards Gestionadas en Pools (Modelo 2N: Gemini + Claude) ─────────┐  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 📦 Pool-01-gemini                    Base: [agy]  2 cuentas    │  │  │
│  │  │ 🎯 Objetivo: gemini-3.8-flash-high                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌──────────────────────┐  ┌────────────────────────────────────┐   │  │
│  │  │ 🏷️ [agy]  💎 Gemini    │  │ 🏷️ [agy]  🎭 Claude              │   │  │
│  │  │ antigravity-a@...      │  │ antigravity-b@...                │   │  │
│  │  │ antigravity-a.json     │  │ antigravity-claude.json          │   │  │
│  │  │                        │  │                                  │   │  │
│  │  │ 🟢 EN CALIENTE         │  │ ⏸️ EN BANQUILLO: RESERVA LISTA   │   │  │
│  │  │ 👑 Turno Activo (RAM)  │  │                                  │   │  │
│  │  │                        │  │                                  │   │  │
│  │  │ 🎯 MODELO ASIGNADO     │  │ 🎯 MODELO ASIGNADO               │   │  │
│  │  │ gemini-3.8-flash-high  │  │ claude-sonnet-4-6              │   │  │
│  │  │ Ruteo virtual · RAM    │  │ Ruteo virtual · RAM             │   │  │
│  │  │                        │  │                                  │   │  │
│  │  │ 🛡️ Aislamiento Virtual │  │ 🛡️ Aislamiento Virtual          │   │  │
│  │  │ (🚫 Excluidos: 12)     │  │ (🚫 Excluidos: 8)               │   │  │
│  │  │                        │  │                                  │   │  │
│  │  │ 🔄 Actualizar Cuota    │  │ 🔄 Actualizar Cuota             │   │  │
│  │  │ 🧹 Liberar Réplica     │  │ 🧹 Liberar Réplica              │   │  │
│  │  └──────────────────────┘  └────────────────────────────────────┘   │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ ⚡ Cuentas Directas / Standalone (Solo Lectura) ────────────────────┐  │
│  │  🔒 MODO SOLO LECTURA · ASISTIDO    [CUENTA FIJA · SIN FAILOVER]    │  │
│  │                                                                       │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 🏷️ [directo]  💎 Google Directo     CUENTA FIJA · SIN FAILOVER  │  │  │
│  │  │ usuario@gmail.com              Solo Lectura                    │  │  │
│  │  │ ⚡ ENRUTAMIENTO DIRECTO NATIVO                                   │  │  │
│  │  │ directo/*  (Modelos nativos CPAMC)                              │  │  │
│  │  │ Sin rotación · Conexión fija a cuenta física                    │  │  │
│  │  │ ⚡ CUENTA FIJA DIRECTA            [🛡️ Adoptar en Pool]          │  │  │
│  │  │ 🔄 Actualizar Cuota                                              │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎛️ Selector `/model` en Pi (Lo que ve el agente/usuario al elegir modelo)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  /model                                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📋 Modelos disponibles:                                                    │
│                                                                             │
│  ┌─ Pools Activos (Auto Switcher Pro) ─────────────────────────────────┐  │
│  │  cpamc/Pool-01-gemini       → Gemini 3.8 Flash High (líder actual)  │  │
│  │  cpamc/Pool-02-gemini       → Gemini 3.5 Flash Lite (líder actual)  │  │
│  │  cpamc/Pool-01-claude       → Claude Sonnet 4.6 (líder actual)      │  │
│  │  cpamc/Pool-01-codex        → GPT-6 Astra (líder actual)            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Cuentas Standalone (Nativas CPAMC) ────────────────────────────────┐  │
│  │  antigravity/usuario@gmail.com    → gemini-3.8-flash-high, ...       │  │
│  │  codex/otro@dominio.com           → gpt-6-astra, gpt-6-sol, ...      │  │
│  │  claude/anthropic@dominio.com     → claude-3-5-haiku, ...            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚙️ Mecánica Interna (OCULTA — Nunca expuesta al usuario)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INTERNO: PoolRegistry + Scheduler + Model Router                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Pool: Pool-01-gemini (ID soberano)                                        │
│  ├─ BasePrefix: "agy"              ← Identidad estable del pool            │
│  ├─ RouteSlug: "Pool-01-gemini"    ← Publicado en /model                   │
│  ├─ Family: "gemini_pure"                                                    │
│  ├─ Members (simétricos):                                                  │
│  │   ├─ antigravity-a@gmail.com.json   ← Cuenta física #1                  │
│  │   ├─ antigravity-b@gmail.com.json   ← Cuenta física #2                  │
│  │   └─ antigravity-c@gmail.com.json   ← Cuenta física #3                  │
│  ├─ MemberModels (per-account):                                            │
│  │   ├─ antigravity-a.json → "gemini-3.8-flash-high"                       │
│  │   ├─ antigravity-b.json → "gemini-3.5-flash-lite"                       │
│  │   └─ antigravity-c.json → "gemini-3.8-flash-high"                       │
│  ├─ Policy.TargetModels: ["gemini-3.8-flash-high"]                         │
│  └─ ActiveLeader (RAM, volátil): antigravity-b@gmail.com.json  ← ROTA     │
│                                                                             │
│  ┌─ Rotación interna (nunca visible) ─────────────────────────────────┐   │
│  │  Host CPAMC recibe prefix numérico para cada reserva:              │   │
│  │    antigravity-a.json  → prefix "agy"      (líder base)            │   │
│  │    antigravity-b.json  → prefix "agy_1"    (reserva #1)            │   │
│  │    antigravity-c.json  → prefix "agy_2"    (reserva #2)            │   │
│  │                                                                     │   │
│  │  prefixMatchesPool("agy_1", "agy")  → true  (reserva numérica)     │   │
│  │  prefixMatchesPool("agy_son", "agy") → false (pool HERMANO)        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Pool HERMANO: Pool-01-claude (BasePrefix: "agy_son")                     │
│  ├─ BasePrefix: "agy_son"         ← DISTINTO, pool separado              │
│  ├─ RouteSlug: "Pool-01-claude"                                           │
│  └─ Members: antigravity-d.json, antigravity-e.json                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Rotación (Transparente)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USUARIO PIDE: "Pool-01-gemini"                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. model.route("Pool-01-gemini")                                          │
│     └─► Registry.GetPool("Pool-01-gemini") → PoolDefinition                │
│                                                                             │
│  2. Lee ActiveLeader en RAM: "antigravity-b@gmail.com.json"               │
│     (era "antigravity-a.json", rotó por fatiga >80%)                       │
│                                                                             │
│  3. Resuelve modelo de ESA cuenta:                                         │
│     member_models["antigravity-b.json"] = "gemini-3.5-flash-lite"          │
│                                                                             │
│  4. Devuelve:                                                              │
│     { Handled: true, Target: "antigravity", TargetModel: "gemini-3.5-flash-lite" }
│                                                                             │
│  5. Host CPAMC usa prefix numérico interno "agy_1" para esa cuenta        │
│     (usuario NUNCA ve "agy_1")                                             │
│                                                                             │
│  6. UI actualiza badge: 🏷️ [agy]  🎯 gemini-3.5-flash-lite                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Resumen de Visibilidad

| Concepto | Nombre Interno | Nombre Usuario | ¿Visible? |
|----------|----------------|----------------|-----------|
| Pool Soberano | `Pool-01-gemini` | `Pool-01-gemini` | ✅ En `/model` |
| Prefijo Pool | `agy` | `🏷️ [agy]` | ✅ En cards |
| Pool Hermano | `agy_son` | `🏷️ [agy_son]` | ✅ En cards |
| Cuenta Física | `antigravity-a.json` | `antigravity-a@...` | ✅ En cards |
| Líder RAM | `ActiveLeader` | `🟢 EN CALIENTE` | ✅ Badge estado |
| **Reserva #1** | `agy_1` | — | ❌ **OCULTO** |
| **Reserva #2** | `agy_2` | — | ❌ **OCULTO** |
| Modelo activo | `member_models[leader]` | `🎯 gemini-3.8...` | ✅ Hero banner |

---

## ✅ Decisión

> **No se toca nada.** El diseño ya implementa exactamente esta separación:
> - **Contrato público limpio** (Pool ID, BasePrefix, Modelo líder)
> - **Mecánica privada encapsulada** (prefixes numéricos, rotación RAM, failover)

¿Documentamos esto en `ARCHITECTURE.md` o `DECISIONS.md` para el equipo?