import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CPAModel = {
    slug?: string;
    id?: string;
    display_name?: string;
    owned_by?: string;
    context_window?: number;
    max_tokens?: number;
    input_modalities?: string[];
    default_reasoning_level?: string | null;
    supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
};

type FallbackOpenAIModel = {
    id?: unknown;
    owned_by?: unknown;
    context_length?: unknown;
    max_input_tokens?: unknown;
    max_output_tokens?: unknown;
    capabilities?: {
        reasoning?: unknown;
        thinking?: unknown;
        vision?: unknown;
        image?: unknown;
        images?: unknown;
    };
};

const PROVIDER_ID = "cpamc";
const DEFAULT_BASE_URL = "http://localhost:8317";
const DEFAULT_MAX_TOKENS = 16_384;
const MAX_SAFE_OUTPUT_TOKENS = 65_536;

/**
 * Resuelve las rutas de caché de forma dinámica y universal:
 * - PI_CODING_AGENT_DIR si está definido
 * - ~/.gentle-shell/agent (Gentle Shell)
 * - Escaneo dinámico de carpetas de agentes en ~/.pi/ sin rutas fijas
 */
function resolveCacheTargets(): string[] {
    const targets = new Set<string>();
    if (process.env.PI_CODING_AGENT_DIR) {
        targets.add(join(process.env.PI_CODING_AGENT_DIR, "cpamc-models-cache.json"));
    }
    const home = homedir();
    const gentleAgentDir = join(home, ".gentle-shell", "agent");
    if (existsSync(gentleAgentDir)) {
        targets.add(join(gentleAgentDir, "cpamc-models-cache.json"));
    }
    const piDir = join(home, ".pi");
    if (existsSync(piDir)) {
        const standardAgent = join(piDir, "agent");
        targets.add(join(standardAgent, "cpamc-models-cache.json"));
        try {
            const entries = require("node:fs").readdirSync(piDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith("agent")) {
                    targets.add(join(piDir, entry.name, "cpamc-models-cache.json"));
                }
            }
        } catch {}
    }
    return Array.from(targets);
}

const PRIMARY_CACHE_PATH = process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "cpamc-models-cache.json")
    : join(homedir(), ".pi", "agent", "cpamc-models-cache.json");

function loadCachedModels(): ReturnType<typeof toPiModelFromCPA>[] {
    const candidates = resolveCacheTargets();
    for (const p of candidates) {
        try {
            if (existsSync(p)) {
                const raw = readFileSync(p, "utf-8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch {}
    }
    return [];
}

function saveCachedModels(models: unknown[]): void {
    if (!Array.isArray(models) || models.length === 0) return;
    const candidates = resolveCacheTargets();

    for (const target of candidates) {
        try {
            const dir = dirname(target);
            if (!existsSync(dir)) {
                // Solo crear si el padre principal existe (~/.pi o ~/.gentle-shell)
                const grandParent = dirname(dir);
                if (existsSync(grandParent)) {
                    mkdirSync(dir, { recursive: true });
                }
            }
            if (existsSync(dir)) {
                writeFileSync(target, JSON.stringify(models, null, 2), "utf-8");
            }
        } catch {
            // Silencioso ante errores de I/O
        }
    }
}

// Caché en memoria para retener los prefijos válidos y modelos excluidos
let cachedFilterData: {
    validPrefixes: Set<string>;
    prefixExclusions: Map<string, Set<string>>;
    familyActiveLeaderPrefix: Map<string, string>; // family -> primary active leader base_prefix
    prefixToFamily: Map<string, string>; // base_prefix -> family
} | null = null;

function buildStrictThinkingLevelMap(levels: string[]): Record<string, string | null> {
    if (!levels || levels.length === 0) {
        return {
            off: null,
            minimal: null,
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: null,
            max: null,
        };
    }

    const set = new Set(levels.map((lvl) => lvl.toLowerCase()));

    return {
        off: null,
        minimal: set.has("minimal") ? "minimal" : null,
        low: set.has("low") ? "low" : null,
        medium: set.has("medium") ? "medium" : null,
        high: set.has("high") ? "high" : null,
        xhigh: set.has("xhigh") ? "xhigh" : null,
        max: set.has("max") ? "max" : null,
    };
}

function resolveRecommendedContextWindow(modelId: string, reportedContext?: number): number {
    const id = modelId.toLowerCase();
    let recommendedCap = 128_000;

    if (id.includes("gpt") || id.includes("codex") || id.includes("openai")) {
        recommendedCap = 272_000;
    } else if (id.includes("claude")) {
        recommendedCap = 200_000;
    } else if (id.includes("gemini")) {
        recommendedCap = 370_000;
    }

    if (typeof reportedContext === "number" && Number.isFinite(reportedContext) && reportedContext > 0) {
        return Math.min(Math.floor(reportedContext), recommendedCap);
    }
    return recommendedCap;
}

function resolveBaseUrl(): string {
    const raw = (process.env.CLIPROXYAPI_BASE_URL || process.env.CPAMC_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    return raw || DEFAULT_BASE_URL;
}

function requireApiKey(): string {
    const apiKey = (process.env.CLIPROXYAPI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error(
            "CLIPROXYAPI_API_KEY is not set in the Pi process environment. Export the CLIProxyAPI endpoint API key before starting pi.",
        );
    }
    return apiKey;
}

/**
 * Conjugación de pools: deriva para cada prefijo su etiqueta de pool y rol.
 * `agy` → "P1·LÍDER agy"; `agy_1` → "P1·RESERVA agy_1"; `agy2` → "P2·LÍDER agy2"...
 * Las bases de pool se numeran por orden alfabético determinista (P1, P2, ...).
 */
function buildPoolLabelMap(prefixes: Iterable<string>): Map<string, string> {
    const bases = new Map<string, { leaders: string[]; reserves: string[] }>();
    for (const raw of prefixes) {
        const prefix = typeof raw === "string" ? raw.trim() : "";
        if (!prefix) continue;
        const match = prefix.match(/^(.*)_(\d+)$/);
        const base = match ? match[1] : prefix;
        if (!bases.has(base)) bases.set(base, { leaders: [], reserves: [] });
        const entry = bases.get(base)!;
        (match ? entry.reserves : entry.leaders).push(prefix);
    }
    const labels = new Map<string, string>();
    [...bases.keys()].sort().forEach((base, idx) => {
        const poolNum = `P${idx + 1}`;
        const entry = bases.get(base)!;
        entry.leaders.forEach((p) => labels.set(p, `${poolNum}·LÍDER ${p}`));
        entry.reserves.forEach((p) => labels.set(p, `${poolNum}·RESERVA ${p}`));
    });
    return labels;
}

function toPiModelFromCPA(model: CPAModel, poolLabels?: Map<string, string>) {
    const id = typeof model.slug === "string" && model.slug.trim()
        ? model.slug.trim()
        : (typeof model.id === "string" ? model.id.trim() : "");
    if (!id) return undefined;

    const lowerId = id.toLowerCase();
    const contextWindow = resolveRecommendedContextWindow(id, model.context_window);
    const maxTokens = Math.min(
        typeof model.max_tokens === "number" && Number.isFinite(model.max_tokens) && model.max_tokens > 0
            ? Math.floor(model.max_tokens)
            : DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );

    const levels = (model.supported_reasoning_levels || [])
        .map((lvl) => (typeof lvl?.effort === "string" ? lvl.effort.trim().toLowerCase() : ""))
        .filter((effort): effort is string => Boolean(effort));

    const isReasoning = levels.length > 0 ||
        Boolean(model.default_reasoning_level) ||
        lowerId.includes("thinking") ||
        (model.display_name?.toLowerCase().includes("thinking") ?? false);

    const thinkingLevelMap = isReasoning
        ? buildStrictThinkingLevelMap(levels)
        : undefined;

    const supportsImages = (model.input_modalities?.includes("image") ?? false) ||
        lowerId.includes("vision") ||
        lowerId.includes("image") ||
        lowerId.includes("gemini") ||
        lowerId.includes("claude") ||
        lowerId.includes("gpt");

    const owner = typeof model.owned_by === "string" && model.owned_by.trim() ? model.owned_by.trim() : "CLIProxyAPI";
    const displayName = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : id;

    // Si es un Identificador Limpio de Pool (p. ej. Pool-01-gemini)
    if (/^pool-\d+-/i.test(id)) {
        return {
            id,
            name: `${id} (Pool Soberano · Auto Switcher Pro)`,
            provider: PROVIDER_ID,
            reasoning: true,
            input: ["text", "image"] as ("text" | "image")[],
            contextWindow,
            maxTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
            reasoningEfforts: levels,
            description: `Grupo/Pool virtual activo ${id} con balanceo predictivo y failover en caliente`,
            displayName: id,
        };
    }

    const slash = id.indexOf("/");
    const prefix = slash > 0 ? id.slice(0, slash) : "";
    const isParent = prefix === "agy" || prefix === "agy2" || prefix === "agy_son" || prefix === "agy_opus";
    const poolLabel = poolLabels?.get(prefix) ?? null;
    const rolePrefix = poolLabel
        ? (poolLabel.includes("LÍDER") ? `⭐ [${poolLabel}] ` : `[${poolLabel}] `)
        : (isParent ? "⭐ [ACTIVA] " : "");

    return {
        id,
        name: displayName !== id ? `${rolePrefix}${displayName} (${id})` : `${rolePrefix}${id} (${owner})`,
        provider: PROVIDER_ID,
        reasoning: isReasoning,
        input: supportsImages ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        reasoningEfforts: levels,
        description: typeof (model as any).description === "string" ? (model as any).description.trim() : undefined,
        displayName: typeof model.display_name === "string" ? model.display_name.trim() : undefined,
    };
}

function toPiModelFromOpenAI(model: FallbackOpenAIModel, poolLabels?: Map<string, string>) {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return undefined;

    const capabilities = model.capabilities ?? {};
    const lowerId = id.toLowerCase();
    const slashIdx = id.indexOf("/");
    const modelPrefix = slashIdx > 0 ? id.slice(0, slashIdx) : "";
    const poolLabel = poolLabels?.get(modelPrefix) ?? null;
    const labelPrefix = poolLabel ? `[${poolLabel}] ` : "";
    const reportedContext = typeof model.context_length === "number"
        ? model.context_length
        : (typeof model.max_input_tokens === "number" ? model.max_input_tokens : undefined);
    const contextWindow = resolveRecommendedContextWindow(id, reportedContext);
    const maxTokens = Math.min(
        typeof model.max_output_tokens === "number" && model.max_output_tokens > 0
            ? Math.floor(model.max_output_tokens)
            : DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );
    const owner = typeof model.owned_by === "string" && model.owned_by.trim() ? model.owned_by.trim() : "CLIProxyAPI";
    const supportsImages = Boolean(
        capabilities.vision ||
        capabilities.image ||
        capabilities.images ||
        lowerId.includes("image") ||
        lowerId.includes("vision") ||
        lowerId.includes("gemini") ||
        lowerId.includes("claude") ||
        lowerId.includes("gpt"),
    );

    const isReasoning = Boolean(
        capabilities.reasoning ||
        capabilities.thinking ||
        lowerId.includes("thinking") ||
        lowerId.includes("high") ||
        lowerId.includes("pro") ||
        lowerId.includes("sol") ||
        lowerId.includes("luna") ||
        lowerId.includes("terra") ||
        lowerId.includes("o1") ||
        lowerId.includes("o3") ||
        lowerId.includes("gpt-5"),
    );

    const openAiEfforts = isReasoning ? ["low", "medium", "high"] : [];
    const thinkingLevelMap = isReasoning ? buildStrictThinkingLevelMap(openAiEfforts) : undefined;

    // Si es un Identificador Limpio de Pool (p. ej. Pool-01-gemini)
    if (/^pool-\d+-/i.test(id)) {
        return {
            id,
            name: `${id} (Pool Soberano · Auto Switcher Pro)`,
            provider: PROVIDER_ID,
            reasoning: isReasoning,
            input: supportsImages ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
            contextWindow,
            maxTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
            reasoningEfforts: openAiEfforts,
        };
    }

    return {
        id,
        name: `${labelPrefix}${id} (${owner})`,
        provider: PROVIDER_ID,
        reasoning: isReasoning,
        input: supportsImages ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        reasoningEfforts: openAiEfforts,
    };
}

function resolveManagementKey(): string {
    const keyFile = join(homedir(), ".cliproxy_management_key");
    try {
        if (existsSync(keyFile)) {
            const diskKey = readFileSync(keyFile, "utf-8").trim();
            if (diskKey) return diskKey;
        }
    } catch {}
    return (process.env.CLIPROXYAPI_MANAGEMENT_KEY || "").trim();
}

type AuthFileSummary = {
    name?: string;
    note?: string;
    prefix?: string;
};

type DownloadedAuthFile = {
    prefix?: string;
    note?: string;
    excluded_models?: string[];
};

async function fetchAccountPrefixesAndExclusions(baseUrl: string, signal?: AbortSignal): Promise<{
    validPrefixes: Set<string>;
    prefixExclusions: Map<string, Set<string>>;
    familyActiveLeaderPrefix: Map<string, string>;
    prefixToFamily: Map<string, string>;
} | null> {
    const mgmtKey = resolveManagementKey();
    if (!mgmtKey) return null;

    try {
        const timeout = AbortSignal.timeout(10000);
        const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(`${baseUrl}/v0/management/auth-files`, {
            headers: {
                Authorization: `Bearer ${mgmtKey}`,
                Accept: "application/json",
            },
            signal: combinedSignal,
        });

        if (!res.ok) return null;
        const data = (await res.json()) as { files?: AuthFileSummary[] };
        const files = Array.isArray(data.files) ? data.files : [];

        const validPrefixes = new Set<string>();
        const prefixExclusions = new Map<string, Set<string>>();
        const authFileExclusions = new Map<string, Set<string>>();

        // Pre-poblar prefijos descubiertos directamente desde la metadata de los archivos
        for (const file of files) {
            const rawNote = typeof file.note === "string" ? file.note.trim() : "";
            const rawPref = typeof file.prefix === "string" ? file.prefix.trim() : "";
            const candidate = rawPref || rawNote;
            if (candidate) {
                validPrefixes.add(candidate);
            }
        }

        await Promise.allSettled(
            files.map(async (file) => {
                if (!file.name || file.name.includes("/")) return;
                const dlRes = await fetch(`${baseUrl}/v0/management/auth-files/download?name=${encodeURIComponent(file.name)}`, {
                    headers: {
                        Authorization: `Bearer ${mgmtKey}`,
                        Accept: "application/json",
                    },
                    signal: combinedSignal,
                });
                if (!dlRes.ok) return;
                const dlData = (await dlRes.json()) as DownloadedAuthFile;
                const pref = (typeof dlData.prefix === "string" && dlData.prefix.trim())
                    ? dlData.prefix.trim()
                    : (typeof dlData.note === "string" && dlData.note.trim())
                        ? dlData.note.trim()
                        : (typeof file.note === "string" ? file.note.trim() : "");
                
                const exSet = new Set(Array.isArray(dlData.excluded_models) ? dlData.excluded_models : []);
                authFileExclusions.set(file.name, exSet);

                if (pref) {
                    validPrefixes.add(pref);
                    prefixExclusions.set(pref, exSet);
                }
            })
        );

        const familyActiveLeaderPrefix = new Map<string, string>();
        const prefixToFamily = new Map<string, string>();

        const activePoolFamilies = new Set<string>();
        const poolAssignedPrefixes = new Set<string>();
        const poolsRes = await fetch(`${baseUrl}/v0/management/auto-switcher-pro/pools`, {
            headers: {
                Authorization: `Bearer ${mgmtKey}`,
                Accept: "application/json",
            },
            signal: combinedSignal,
        });
        if (poolsRes.ok) {
            const poolsData = (await poolsRes.json()) as {
                pools?: Array<{
                    base_prefix?: string;
                    family?: string;
                    leader_auth?: string;
                    reserves?: string[];
                    members?: string[];
                    policy?: { excluded_models?: string[] };
                }>;
            };
            const pools = Array.isArray(poolsData.pools) ? poolsData.pools : [];
            
            // Mapeo ordenado determinista: el pool base canónico (ej. 'agy' frente a 'agy2')
            for (const pool of pools) {
                const basePref = typeof pool.base_prefix === "string" ? pool.base_prefix.trim() : "";
                if (!basePref) continue;

                // Marcar el prefijo base del pool como asignado a un pool activo
                poolAssignedPrefixes.add(basePref.toLowerCase());

                const fam = (typeof pool.family === "string" && pool.family.trim()) ? pool.family.trim() : "default";
                activePoolFamilies.add(fam);
                prefixToFamily.set(basePref, fam);
                validPrefixes.add(basePref);

                // Determinar el líder representativo activo para la familia
                if (!familyActiveLeaderPrefix.has(fam)) {
                    familyActiveLeaderPrefix.set(fam, basePref);
                } else {
                    const existing = familyActiveLeaderPrefix.get(fam)!;
                    // Priorizar prefijo canónico más corto o alfabéticamente superior ('agy' antes que 'agy2')
                    if (basePref.length < existing.length || (basePref.length === existing.length && basePref < existing)) {
                        familyActiveLeaderPrefix.set(fam, basePref);
                    }
                }

                // Sincronizar exclusiones de la Tuerca ⚙️ de la cuenta líder del pool
                if (pool.leader_auth && authFileExclusions.has(pool.leader_auth)) {
                    prefixExclusions.set(basePref, authFileExclusions.get(pool.leader_auth)!);
                } else if (Array.isArray(pool.policy?.excluded_models)) {
                    prefixExclusions.set(basePref, new Set(pool.policy.excluded_models));
                }
            }
        }

        const result = { validPrefixes, prefixExclusions, familyActiveLeaderPrefix, prefixToFamily, activePoolFamilies, poolAssignedPrefixes };
        cachedFilterData = result;
        return result;
    } catch {
        return cachedFilterData;
    }
}

function isKnownFallbackPrefix(prefix: string): boolean {
    return /^agy\d*$/.test(prefix) ||
        prefix === "agy_son" || /^agy_son\d+$/.test(prefix) ||
        prefix === "agy_opus" || /^agy_opus\d+$/.test(prefix) ||
        ((prefix.startsWith("clau") || prefix.startsWith("claude")) && !prefix.startsWith("agy_")) ||
        prefix === "codex" || /^codex\d+$/.test(prefix);
}

function isCleanIncludedModel(id: string, filterData: {
    validPrefixes: Set<string>;
    prefixExclusions: Map<string, Set<string>>;
    familyActiveLeaderPrefix?: Map<string, string>;
    prefixToFamily?: Map<string, string>;
    activePoolFamilies?: Set<string>;
    poolAssignedPrefixes?: Set<string>;
} | null): boolean {
    const trimmed = id.trim();

    // 0. Si es un Identificador Limpio de Pool Canónico (p. ej. Pool-01-gemini, Pool-02-gemini)
    if (/^pool-\d+-/i.test(trimmed)) {
        return true;
    }

    const slashIndex = trimmed.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
        return false;
    }

    const prefix = trimmed.slice(0, slashIndex);

    // 1. Filtrar reservas numéricas (_1, _2...) para exponer SOLO rutas líderes dinámicas
    if (/_(\d+)$/.test(prefix)) {
        return false;
    }

    // 1.5. REGLA ARQUITECTÓNICA SAGRADA (Máscara Virtual Pura y Coexistencia Granular por Cuenta):
    // - Si este prefijo físico está ASIGNADO a un pool activo (ej. "agy", "agy2"), SE OCULTA de /model
    //   porque ya está gobernado y enmascarado limpiamente por su Pool-XX-<familia>.
    // - Si este prefijo NO está asignado a ningún pool (cuenta libre / nueva del mismo o de otro proveedor),
    //   NO SE OCULTA: se respeta su comportamiento 100% nativo de CPAMC ("Auth Files Management") y pasa
    //   a /model con sus exclusiones de disco.
    if (filterData?.poolAssignedPrefixes && filterData.poolAssignedPrefixes.has(prefix.toLowerCase())) {
        return false; // Enmascarado bajo su respectivo Pool-XX
    }

    // 2. Comprobar validez de prefijo (validPrefixes del backend o fallback por convención N -> ∞)
    if (filterData) {
        if (!filterData.validPrefixes.has(prefix)) {
            return false;
        }
    } else if (!isKnownFallbackPrefix(prefix)) {
        return false;
    }

    // 3. Aislamiento estricto por familia de pool (Escalabilidad N -> ∞)
    const modelSlug = trimmed.slice(slashIndex + 1).toLowerCase();
    const isAgyGemini = /^agy\d*$/.test(prefix);
    const isAgySonnet = prefix === "agy_son" || /^agy_son\d+$/.test(prefix);
    const isAgyOpus = prefix === "agy_opus" || /^agy_opus\d+$/.test(prefix);
    const isDirectClaude = (prefix.startsWith("clau") || prefix.startsWith("claude")) && !prefix.startsWith("agy_");
    const isCodex = prefix === "codex" || /^codex\d+$/.test(prefix);

    if (isAgyGemini && !modelSlug.includes("gemini")) {
        return false;
    }
    if (isAgySonnet && (!modelSlug.includes("sonnet") || modelSlug.includes("opus"))) {
        return false;
    }
    if (isAgyOpus && (!modelSlug.includes("opus") || modelSlug.includes("sonnet"))) {
        return false;
    }
    if (isDirectClaude && !modelSlug.includes("claude") && !modelSlug.includes("anthropic")) {
        return false;
    }
    if (isCodex && !modelSlug.includes("codex") && !modelSlug.includes("gpt") && !modelSlug.includes("openai")) {
        return false;
    }

    // 4. Tuerca ⚙️ de Especialista: Si el modelo fue excluido en la cuenta física / líder, no pasa
    if (filterData) {
        const exSet = filterData.prefixExclusions.get(prefix);
        if (exSet) {
            if (exSet.has(trimmed)) return false;
            const unprefixed = trimmed.slice(slashIndex + 1);
            if (exSet.has(unprefixed)) return false;
        }

        // INVARIANTE AGENTS.md (Escalabilidad N -> ∞):
        // Cada pool activo registrado (base_prefix) es su propia fachada virtual independiente.
        // NUNCA colapsar o sombrear pools hermanos (agy, agy2, agy3... codex, codex2... clau, clau2...).
    }

    return true;
}

export async function fetchCLIProxyModels(signal?: AbortSignal) {
    const baseUrl = resolveBaseUrl();
    const apiKey = requireApiKey();

    const filterData = await fetchAccountPrefixesAndExclusions(baseUrl, signal);
    const prefixOf = (id: string) => {
        const idx = id.indexOf("/");
        return idx > 0 ? id.slice(0, idx) : "";
    };

    try {
        const response = await fetch(`${baseUrl}/v1/models?client_version=1`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        });

        if (response.ok) {
            const payload = (await response.json()) as { models?: CPAModel[] };
            if (Array.isArray(payload.models) && payload.models.length > 0) {
                const included = payload.models.filter((model) => {
                    const id = typeof model.slug === "string" ? model.slug.trim()
                        : (typeof model.id === "string" ? model.id.trim() : "");
                    return isCleanIncludedModel(id, filterData);
                });
                const poolLabels = buildPoolLabelMap(
                    filterData ? [...filterData.validPrefixes] : included.map((m) => prefixOf(typeof m.slug === "string" ? m.slug : (m.id ?? "")))
                );
                return included
                    .map((m) => toPiModelFromCPA(m, poolLabels))
                    .filter((model): model is NonNullable<ReturnType<typeof toPiModelFromCPA>> => Boolean(model));
            }
        }
    } catch {
        // Fallback al endpoint estándar
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 300)}` : "";
        throw new Error(`CLIProxyAPI /v1/models failed with HTTP ${response.status}${detail}`);
    }

    const payload = (await response.json()) as { data?: FallbackOpenAIModel[] };
    const includedFallback = (payload.data ?? []).filter((model) => {
        const id = typeof model.id === "string" ? model.id.trim() : "";
        return isCleanIncludedModel(id, filterData);
    });
    const poolLabelsFallback = buildPoolLabelMap(
        filterData ? [...filterData.validPrefixes] : includedFallback.map((m) => prefixOf(typeof m.id === "string" ? m.id : ""))
    );
    return includedFallback
        .map((m) => toPiModelFromOpenAI(m, poolLabelsFallback))
        .filter((model): model is NonNullable<ReturnType<typeof toPiModelFromOpenAI>> => Boolean(model));
}

export function initDynamicProvider(pi: ExtensionAPI): void {
    const cachedModels = loadCachedModels();

    // Refresco asíncrono en segundo plano al arrancar la extensión
    fetchCLIProxyModels().then((models) => {
        if (Array.isArray(models) && models.length > 0) {
            saveCachedModels(models);
        }
    }).catch(() => {});

    pi.registerProvider(PROVIDER_ID, {
        name: "CPAMC",
        baseUrl: `${resolveBaseUrl()}/v1`,
        apiKey: "$CLIPROXYAPI_API_KEY",
        api: "openai-completions",
        models: cachedModels.length > 0 ? (cachedModels as any) : undefined,
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: true,
            supportsUsageInStreaming: true,
            maxTokensField: "max_tokens",
        },
        async refreshModels({ signal }: { signal?: AbortSignal } = {}) {
            const models = await fetchCLIProxyModels(signal);
            if (Array.isArray(models) && models.length > 0) {
                saveCachedModels(models);
            }
            return models;
        },
    });
}

export default initDynamicProvider;
