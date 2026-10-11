import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 6000;
export const QUOTA_REFRESH_MS = 25_000;

export interface SwitcherAccount {
	status: string; // "[ACTIVE]" | "[RESERVE]" | "[OTHER]"
	provider: string;
	profile: string; // "default" (Gemini), "clau" (Claude), etc.
	accountId: string;
	prefix: string; // "agy", "agy_1", "agy_clau", "agy_clau_1", etc.
	consumed5h: string;
	consumedWeekly: string;
	minAvailable: string;
}

export interface PoolRotationPair {
	poolKey: string;
	familyName: string;
	familyIcon: string;
	active: SwitcherAccount;
	next?: SwitcherAccount;
	totalAccounts: number;
}

export interface ModelPoolClassification {
	isCpamc: boolean;
	prefix: string;
	isLeader: boolean;
	isReserve: boolean;
	roleIcon: string; // "👑 " | "🔄 " | "⚡ "
	familyIcon: string; // "✨ " | "🔶 " | "🤖 " | "🧩 "
	familyLabel: string;
	canonicalModelId: string;
	poolBase: string;
}

let cachedAccounts: SwitcherAccount[] = [];
let lastFetchTime = 0;
let isFetching = false;

/**
 * Consulta el estado real de cuentas y rotación vía `cpamc-auto-switcher -list`.
 * Implementa caché en memoria para no saturar procesos ni CPU.
 */
export async function querySwitcherAccounts(force = false): Promise<SwitcherAccount[]> {
	const now = Date.now();
	if (!force && cachedAccounts.length > 0 && now - lastFetchTime < QUOTA_REFRESH_MS) {
		return cachedAccounts;
	}

	if (isFetching && cachedAccounts.length > 0) {
		return cachedAccounts;
	}

	isFetching = true;
	try {
		const { stdout } = await execFileAsync("cpamc-auto-switcher", ["-list"], { timeout: TIMEOUT_MS });
		const lines = stdout.split("\n");
		const list: SwitcherAccount[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("STATUS")) continue;
			const parts = trimmed.split(/\s+/);
			if (parts.length >= 8) {
				list.push({
					status: parts[0] || "",
					provider: parts[1] || "",
					profile: parts[2] || "",
					accountId: parts[3] || "",
					prefix: parts[4] || "",
					consumed5h: parts[5] || "",
					consumedWeekly: parts[6] || "",
					minAvailable: parts[7] || "",
				});
			}
		}

		if (list.length > 0) {
			cachedAccounts = list;
			lastFetchTime = Date.now();
		}
		return cachedAccounts;
	} catch {
		return cachedAccounts;
	} finally {
		isFetching = false;
	}
}

/**
 * Clasifica cualquier modelo (sea de CPAMC o de /login directo)
 * determinando si es líder activo (👑), reserva (🔄) o directo (⚡).
 */
export function classifyModel(modelId: string, provider: string): ModelPoolClassification {
	let trimmed = (modelId || "").trim();
	const isCpamc =
		provider === "cpamc" ||
		provider === "cliproxyapi" ||
		trimmed.startsWith("cpamc/") ||
		trimmed.startsWith("cliproxyapi/");

	if (!isCpamc) {
		return {
			isCpamc: false,
			prefix: "",
			isLeader: false,
			isReserve: false,
			roleIcon: "⚡ ",
			familyIcon: "⚡ ",
			familyLabel: "Directo (/login)",
			canonicalModelId: trimmed,
			poolBase: "",
		};
	}

	// Normalizar: remover prefijo de proveedor si viene en modelId
	if (trimmed.startsWith("cpamc/")) {
		trimmed = trimmed.slice(6);
	} else if (trimmed.startsWith("cliproxyapi/")) {
		trimmed = trimmed.slice(12);
	}

	const slash = trimmed.indexOf("/");
	const prefix = slash > 0 ? trimmed.slice(0, slash) : "";
	const canonical = slash > 0 ? trimmed.slice(slash + 1) : trimmed;

	// Si no tiene prefijo, es un modelo servido por el proxy sin pool específico
	if (!prefix) {
		return {
			isCpamc: true,
			prefix: "",
			isLeader: false,
			isReserve: false,
			roleIcon: "⚡ ",
			familyIcon: "🌐 ",
			familyLabel: "Proxy General",
			canonicalModelId: canonical,
			poolBase: "",
		};
	}

	// Regla de reserva: prefijo terminado en _\d+ (ej. agy_1, agy_clau_2)
	const reserveMatch = prefix.match(/^(.*)_(\d+)$/);
	const isReserve = Boolean(reserveMatch);
	const isLeader = !isReserve;
	const poolBase = reserveMatch ? reserveMatch[1]! : prefix;

	// Detección de Familia de Cuota con precedencia estricta
	let familyIcon = "🌐 ";
	let familyLabel = "General";

	if (poolBase.startsWith("agy_opus") || poolBase.startsWith("opus")) {
		familyIcon = "🟣 ";
		familyLabel = "Claude Opus";
	} else if (poolBase.startsWith("agy_son") || poolBase.startsWith("son")) {
		familyIcon = "🔶 ";
		familyLabel = "Claude Sonnet";
	} else if (poolBase.startsWith("agy_clau") || poolBase.startsWith("clau")) {
		familyIcon = "🤖 ";
		familyLabel = "Claude (Nativo)";
	} else if (poolBase.startsWith("agy") || poolBase.startsWith("g")) {
		familyIcon = "✨ ";
		familyLabel = "Gemini Puro";
	} else if (poolBase.startsWith("codex")) {
		familyIcon = "🧩 ";
		familyLabel = "Codex (GPT)";
	}

	const roleIcon = isLeader ? "👑 " : "🔄 ";

	return {
		isCpamc: true,
		prefix,
		isLeader,
		isReserve,
		roleIcon,
		familyIcon,
		familyLabel,
		canonicalModelId: canonical,
		poolBase,
	};
}

/**
 * Calcula de forma síncrona la pareja de rotación usando las cuentas en memoria caché.
 * Ideal para llamadas dentro del ciclo de render/digest del TUI.
 */
export function getRotationPairForModelSync(modelId: string, provider: string): PoolRotationPair | null {
	const info = classifyModel(modelId, provider);
	if (!info.isCpamc || !info.poolBase) return null;

	const accounts = cachedAccounts;
	if (accounts.length === 0) return null;

	// Filtrar cuentas que pertenecen a esta misma base de pool (ej. agy_clau, agy_clau_1, agy_clau_2...)
	const poolAccounts = accounts.filter((a) => {
		const p = a.prefix.trim();
		if (p === info.poolBase) return true;
		if (p.startsWith(`${info.poolBase}_`)) {
			const suffix = p.slice(info.poolBase.length + 1);
			return /^\d+$/.test(suffix);
		}
		return false;
	});

	if (poolAccounts.length === 0) return null;

	// Cuenta activa: la que tenga status [ACTIVE] o el prefijo base exacto
	const active = poolAccounts.find((a) => a.status === "[ACTIVE]" || a.prefix === info.poolBase) || poolAccounts[0]!;

	// Reservas ordenadas por número en cascada (_1, _2, _3...)
	const reserves = poolAccounts
		.filter((a) => a.prefix !== active.prefix)
		.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));

	const next = reserves.length > 0 ? reserves[0] : undefined;

	return {
		poolKey: info.poolBase,
		familyName: info.familyLabel,
		familyIcon: info.familyIcon,
		active,
		next,
		totalAccounts: poolAccounts.length,
	};
}

/**
 * Extrae el porcentaje de cuota libre remanente de una cuenta por su prefijo exacto.
 */
export function getAvailableQuotaForPrefix(prefix: string): number {
	if (!prefix) return 0;
	const account = cachedAccounts.find((a) => a.prefix.trim() === prefix.trim());
	if (!account) return 0;
	const raw = account.minAvailable.replace("%", "").trim();
	const val = parseFloat(raw);
	return Number.isFinite(val) ? val : 0;
}

/**
 * Retorna el mejor candidato líder de rotación (con mayor porcentaje disponible) para una familia dada.
 */
export function getBestCandidateLeader(prefixCandidates: string[]): string | null {
	if (!prefixCandidates || prefixCandidates.length === 0) return null;
	let bestPrefix = prefixCandidates[0]!;
	let bestQuota = -1;

	for (const p of prefixCandidates) {
		const q = getAvailableQuotaForPrefix(p);
		if (q > bestQuota) {
			bestQuota = q;
			bestPrefix = p;
		}
	}
	return bestPrefix;
}

/**
 * Evalúa si un pool amerita rebalanceo proactivo en el arranque o recarga de sesión:
 * Regla de Histéresis:
 * 1. Cuenta activa fatigada: cuota libre < 50%
 * 2. Reserva candidata con ventaja significativa: cuota(reserva) - cuota(activa) >= 30%
 */
export function checkProactivePoolRebalance(modelId: string, provider: string): { shouldSwitch: boolean; bestReservePrefix?: string } {
	const pair = getRotationPairForModelSync(modelId, provider);
	if (!pair || !pair.next) return { shouldSwitch: false };

	const activeQuota = getAvailableQuotaForPrefix(pair.active.prefix);
	const reserveQuota = getAvailableQuotaForPrefix(pair.next.prefix);

	// 1. Piso de agotamiento: la activa debe tener menos del 50% disponible
	if (activeQuota >= 50) return { shouldSwitch: false };

	// 2. Margen de ventaja: la reserva debe sacarle al menos 30 puntos porcentuales
	if (reserveQuota - activeQuota >= 30) {
		return {
			shouldSwitch: true,
			bestReservePrefix: pair.next.prefix,
		};
	}

	return { shouldSwitch: false };
}

/**
 * Consulta las cuentas más recientes si es necesario y calcula la pareja de rotación.
 */
export async function getRotationPairForModel(modelId: string, provider: string): Promise<PoolRotationPair | null> {
	await querySwitcherAccounts();
	return getRotationPairForModelSync(modelId, provider);
}
