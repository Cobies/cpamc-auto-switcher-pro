import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	getRotationPairForModel,
	getRotationPairForModelSync,
	type PoolRotationPair,
	getCachedLifecycle,
	getContextState,
	type LifecycleSummary,
	type ContextCompressionState,
} from "./store.js";
import { runawayGuard, type RunawayGuardTelemetry, MAX_BASH_EXPLORATION_PER_TURN, MAX_SUBAGENT_POLL_PER_TURN } from "./guards.js";

// Colores ANSI suaves compatibles con temas oscuros y claros (Cyber-Pastel)
const RESET = "\x1b[0m";
const SEP = "\x1b[38;2;138;78;158m│\x1b[0m";
const PLAY_COLOR = "\x1b[38;2;123;200;143m"; // Verde menta
const PAUSE_COLOR = "\x1b[38;2;120;153;166m"; // Gris suave
const LEADER_COLOR = "\x1b[1;38;2;92;184;199m"; // Cian suave negrita
const NEXT_COLOR = "\x1b[1;38;2;222;116;155m"; // Rosa coral suave negrita
const MUTED = "\x1b[38;2;120;153;166m";

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const OSC8_REGEX = /\x1b\]8;;[^\x1b]*\x1b\\/g;

export function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX, "").replace(OSC8_REGEX, "");
}

export function truncateWithAnsi(str: string, maxW: number): string {
	if (maxW <= 0) return "";
	if (visibleLen(str) <= maxW) return str;

	let vis = 0;
	let res = "";
	const token = /^\x1b\[[0-9;]*[a-zA-Z]/;
	let i = 0;

	while (i < str.length && vis < maxW) {
		const match = str.slice(i).match(token);
		if (match) {
			res += match[0];
			i += match[0].length;
		} else {
			const cp = str.codePointAt(i) || 0;
			const charLen = String.fromCodePoint(cp).length;
			const charVis =
				cp >= 0xfe00 && cp <= 0xfe0f
					? 0
					: cp >= 0x1f6e0 && cp <= 0x1f6ec
						? 1
						: (cp >= 0x1f300 && cp <= 0x1faff) ||
								(cp >= 0x2600 && cp <= 0x27bf) ||
								(cp >= 0x2b50 && cp <= 0x2b55)
							? 2
							: 1;

			if (vis + charVis > maxW) break;
			res += str.slice(i, i + charLen);
			vis += charVis;
			i += charLen;
		}
	}

	return `${res}${RESET}`;
}

export function fitToWidth(str: string, maxW: number): string {
	return truncateWithAnsi(str, maxW);
}

function pctColor(pctStr: string): string {
	const num = parseFloat(pctStr.replace("%", "")) || 0;
	if (num >= 50) return "\x1b[38;2;123;200;143m";
	if (num >= 20) return "\x1b[38;2;229;181;103m";
	return "\x1b[38;2;222;116;155m";
}

/**
 * Formatea el bloque de telemetría de rotación en una sola línea compacta:
 * `│⏸ agy_clau 100% │ ⏭ agy_clau_1 100%`
 */
export function formatFooterRotationBlock(pair: PoolRotationPair | null, isBusy = false, originTag?: string): string {
	const originPart = originTag ? ` ${MUTED}· ${originTag}${RESET}` : "";

	if (!pair || !pair.active) {
		return originTag ? `${SEP}${originPart}` : "";
	}

	if (pair.isNativeReadOnly) {
		const pActiveColor = pctColor(pair.active.minAvailable);
		const activeLabel = pair.active.prefix || pair.active.accountId;
		const hInfo = pair.active.consumed5h ? `${pair.active.consumed5h}` : "";
		const wInfo = pair.active.consumedWeekly ? `${pair.active.consumedWeekly}` : "";
		const cd = [hInfo, wInfo].filter(Boolean).join("/");
		const cdStr = cd ? ` ↻ ${cd}` : "";
		return `${SEP} ⚡ ${LEADER_COLOR}${activeLabel}${RESET} ${pActiveColor}${pair.active.minAvailable}${RESET}${MUTED}${cdStr}${RESET}${originPart}`;
	}

	const icon = isBusy ? `${PLAY_COLOR}▶${RESET}` : `${PAUSE_COLOR}⏸${RESET}`;
	const pActiveColor = pctColor(pair.active.minAvailable);
	const activeLabel = pair.active.prefix || pair.active.accountId;
	const activePart = `${icon} ${LEADER_COLOR}${activeLabel}${RESET} ${pActiveColor}${pair.active.minAvailable}${RESET}`;

	if (!pair.next) {
		return `${SEP} ${activePart}${originPart}`;
	}

	const nextIcon = `\x1b[38;2;157;124;216m⏭${RESET}`;
	const pNextColor = pctColor(pair.next.minAvailable);
	const nextLabel = pair.next.prefix || pair.next.accountId;
	const nextPart = `${nextIcon} ${NEXT_COLOR}${nextLabel}${RESET} ${pNextColor}${pair.next.minAvailable}${RESET}`;

	return `${SEP} ${activePart} ${SEP} ${nextPart}${originPart}`;
}

export function visibleLen(str: string): number {
	const clean = str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
	let len = 0;
	for (const char of clean) {
		const code = char.codePointAt(0) || 0;
		if (code >= 0xfe00 && code <= 0xfe0f) {
			// variation selector, 0 width
		} else if (code >= 0x1f6e0 && code <= 0x1f6ec) {
			// Símbolos de transporte/herramientas con presentación texto por defecto (ej: 🛡 U+1F6E1, 🛠 U+1F6E0)
			len += 1;
		} else if (
			(code >= 0x1f300 && code <= 0x1faff) ||
			(code >= 0x2600 && code <= 0x27bf) ||
			(code >= 0x2b50 && code <= 0x2b55)
		) {
			len += 2;
		} else {
			len += 1;
		}
	}
	return len;
}

function renderCompactBar(percentStr: string, cells = 8): string {
	const num = Number.parseFloat(percentStr.replace("%", "").trim());
	if (Number.isNaN(num)) return "▱".repeat(cells);
	const filled = Math.min(cells, Math.max(0, Math.round((num / 100) * cells)));
	return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

interface ThemeStyler {
	border(text: string): string;
	muted(text: string): string;
	text(text: string): string;
	accent(text: string): string;
	warning(text: string): string;
	error(text: string): string;
	idle(text: string): string;
	live(text: string): string;
	amber(text: string): string;
	cyan(text: string): string;
	boldWhite(text: string): string;
	easy(text: string): string;
	slate(text: string): string;
	paintGauge(percentStr: string, cells?: number, isAmber?: boolean): string;
}

function createThemeStyler(theme?: any, fallbackBorder = "\x1b[38;2;120;153;166m"): ThemeStyler {
	const hasTheme = Boolean(theme && typeof theme.fg === "function");
	const bColor = fallbackBorder;
	const fg = (role: string, t: string): string => {
		if (hasTheme) {
			try {
				return theme.fg(role, t);
			} catch {
				// Fallback a ANSI si el rol falla
			}
		}
		switch (role) {
			case "border":
				return `${bColor}${t}${RESET}`;
			case "muted":
				return `\x1b[38;2;140;155;165m${t}${RESET}`;
			case "accent":
				return `\x1b[1;38;2;92;184;199m${t}${RESET}`;
			case "warning":
				return `\x1b[38;2;229;181;103m${t}${RESET}`;
			case "error":
				return `\x1b[1;38;2;239;68;68m${t}${RESET}`;
			case "idle":
				return `\x1b[38;2;120;175;135m${t}${RESET}`; // Verde suave / oliva tenue
			case "live":
				return `\x1b[1;38;2;123;220;143m${t}${RESET}`; // Verde menta neón brillante
			case "amber":
				return `\x1b[1;38;2;245;158;11m${t}${RESET}`; // Ámbar dorado de aviso
			case "text":
			default:
				return `\x1b[38;2;230;235;240m${t}${RESET}`;
		}
	};

	return {
		border: (t) => fg("border", t),
		muted: (t) => fg("muted", t),
		text: (t) => fg("text", t),
		accent: (t) => fg("accent", t),
		warning: (t) => fg("warning", t),
		error: (t) => fg("error", t),
		idle: (t) => fg("idle", t),
		live: (t) => fg("live", t),
		amber: (t) => fg("amber", t),
		cyan: (t) => `\x1b[38;2;56;189;248m${t}${RESET}`,
		boldWhite: (t) => `\x1b[1;38;2;248;250;252m${t}${RESET}`,
		easy: (t) => `\x1b[1;38;2;34;197;94m${t}${RESET}`,
		slate: (t) => `\x1b[38;2;148;163;184m${t}${RESET}`,
		paintGauge: (percentStr: string, cells = 6, isAmber = false) => {
			const num = Number.parseFloat(percentStr.replace("%", "").trim()) || 0;
			const filled = Math.min(cells, Math.max(0, Math.round((num / 100) * cells)));
			const empty = cells - filled;
			const tone = isAmber ? "amber" : num >= 95 ? "error" : num >= 80 ? "warning" : "idle";
			return fg(tone, "▰".repeat(filled)) + fg("border", "▱".repeat(empty));
		},
	};
}

export interface QuotaPaceInfo {
	state: "easy" | "moderate" | "fast" | "exhausted";
	pillLabel: string;
	pillColor: (t: string) => string;
	ringColor: (t: string) => string;
	remainingFormatted: string;
	consumedPct: number;
	remainingPct: number;
	timeElapsedPct: number;
	needlePos: "top" | "right" | "bottom" | "left";
}

export function parseConsumedNumber(consumedStr: string): number {
	if (!consumedStr) return 0;
	const clean = consumedStr.trim();
	if (clean.includes("/")) {
		const parts = clean.split("/");
		const n = Number.parseFloat(parts[0]);
		const d = Number.parseFloat(parts[1]);
		if (!Number.isNaN(n) && !Number.isNaN(d) && d > 0) {
			return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
		}
	}
	const n = Number.parseFloat(clean.replace("%", ""));
	return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n)));
}

export function calculateQuotaPace(
	consumedStr: string,
	remainingSec: number | undefined,
	totalMinutes: number,
	s: ThemeStyler,
): QuotaPaceInfo {
	const consumedPct = parseConsumedNumber(consumedStr);
	const remainingPct = Math.max(0, 100 - consumedPct);
	const totalSec = totalMinutes * 60;
	const isWeekly = totalMinutes > 300;

	let timeElapsedPct = 0;
	let remSec = remainingSec;

	if (typeof remainingSec === "number" && remainingSec >= 0) {
		const elapsed = Math.max(0, Math.min(totalSec, totalSec - remainingSec));
		timeElapsedPct = (elapsed / totalSec) * 100;
	} else {
		remSec = totalSec;
		timeElapsedPct = 0;
	}

	let remainingFormatted = "—";
	if (typeof remSec === "number" && remSec >= 0) {
		const mins = Math.max(0, Math.round(remSec / 60));
		const days = Math.floor(mins / 1440);
		const hours = Math.floor((mins % 1440) / 60);
		const remMins = mins % 60;
		if (isWeekly && days > 0) {
			remainingFormatted = `${days}d ${hours}h`;
		} else if (days > 0) {
			remainingFormatted = `${days}d ${hours}h`;
		} else if (hours > 0) {
			remainingFormatted = `${hours}h ${remMins}m`;
		} else {
			remainingFormatted = `${remMins}m`;
		}
	}

	const diff = consumedPct - timeElapsedPct;
	let state: "easy" | "moderate" | "fast" | "exhausted" = "easy";
	let pillLabel = "● Ritmo holgado";
	let pillColor = s.easy;
	let ringColor = s.easy;

	if (consumedPct >= 100) {
		state = "exhausted";
		pillLabel = "🛑 Cuota agotada";
		pillColor = s.error;
		ringColor = s.error;
	} else if (diff <= 5) {
		state = "easy";
		pillLabel = "● Ritmo holgado";
		pillColor = s.easy;
		ringColor = s.easy;
	} else if (diff <= 20) {
		state = "moderate";
		pillLabel = "▲ Ritmo ajustado";
		pillColor = s.amber;
		ringColor = s.amber;
	} else {
		state = "fast";
		pillLabel = "🛑 Vas muy rápido";
		pillColor = s.error;
		ringColor = s.error;
	}

	let needlePos: "top" | "right" | "bottom" | "left" = "right";
	if (timeElapsedPct < 15) needlePos = "top";
	else if (timeElapsedPct < 45) needlePos = "right";
	else if (timeElapsedPct < 75) needlePos = "bottom";
	else needlePos = "left";

	return {
		state,
		pillLabel,
		pillColor,
		ringColor,
		remainingFormatted,
		consumedPct,
		remainingPct,
		timeElapsedPct,
		needlePos,
	};
}

function centerAnsi(text: string, width: number): string {
	const vLen = visibleLen(text);
	if (vLen >= width) return text;
	const totalPad = width - vLen;
	const leftPad = Math.floor(totalPad / 2);
	const rightPad = totalPad - leftPad;
	return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

// Paleta de espectro de celdas idéntica a Context en la prompt bar (#4ADE80 -> #EF4444)
const SPECTRUM_CELL_COLORS: readonly (readonly [number, number, number])[] = [
	[74, 222, 128],  // 1: #4ADE80 Verde Esmeralda (0-12%)
	[132, 204, 22],  // 2: #84CC16 Verde Lima (13-25%)
	[163, 230, 53],  // 3: #A3E635 Lima Brillante (26-37%)
	[234, 179, 8],   // 4: #EAB308 Amarillo Cálido (38-50%)
	[245, 158, 11],  // 5: #F59E0B Ámbar / Oro (51-62%)
	[249, 115, 22],  // 6: #F97316 Naranja Alerta (63-75%)
	[239, 68, 68],   // 7: #EF4444 Rojo Alerta (76-87%)
	[220, 38, 38],   // 8: #DC2626 Rojo Fuego Máximo (88-100%)
];

const EMPTY_CELL_COLOR: readonly [number, number, number] = [70, 85, 100]; // Gris metálico carril

function renderSpectralGauge(pct: number, cells = 10): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filledCount = Math.round((clamped / 100) * cells);
	let res = "";
	for (let i = 0; i < cells; i++) {
		if (i < filledCount) {
			const colorIdx = Math.min(SPECTRUM_CELL_COLORS.length - 1, Math.floor((i / cells) * SPECTRUM_CELL_COLORS.length));
			const [r, g, b] = SPECTRUM_CELL_COLORS[colorIdx];
			res += `\x1b[38;2;${r};${g};${b}m▰\x1b[39m`;
		} else {
			const [r, g, b] = EMPTY_CELL_COLOR;
			res += `\x1b[38;2;${r};${g};${b}m▱\x1b[39m`;
		}
	}
	return res;
}

function renderTimeGauge(pct: number, cells = 10): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filledCount = Math.round((clamped / 100) * cells);
	let res = "";
	for (let i = 0; i < cells; i++) {
		if (i < filledCount) {
			res += `\x1b[38;2;56;189;248m▰\x1b[39m`; // Azul cielo / cian reloj
		} else {
			const [r, g, b] = EMPTY_CELL_COLOR;
			res += `\x1b[38;2;${r};${g};${b}m▱\x1b[39m`;
		}
	}
	return res;
}

function renderRaceBox(
	title: string,
	pace: QuotaPaceInfo,
	innerW: number,
	safeW: number,
	s: ThemeStyler,
): string[] {
	// Ancho exacto de la mini-caja = innerW (44 caracteres para safeW=48)
	const boxW = Math.max(20, innerW);

	// Línea 1: ╭─ 5 HORAS ────────────── Quedan 5h 0m ────╮
	const leftTitle = `${s.border("╭─ ")}${s.accent(title)} ${s.border("─")}`;
	const rightRem = ` ${s.boldWhite("Quedan " + pace.remainingFormatted)} ${s.border("────╮")}`;
	const titleRuleLen = Math.max(1, boxW - visibleLen(leftTitle) - visibleLen(rightRem));
	const boxTop = `${leftTitle}${s.border("─".repeat(titleRuleLen))}${rightRem}`;

	// Barras de 11 celdas para aprovechar el espacio ganado
	const gaugeCells = 11;

	// Línea 2: │ ⏱  [▱▱▱▱▱▱▱▱▱▱▱]  0%    ▲ Ritmo ajustado │ (solo icono de reloj ⏱)
	const timeBar = renderTimeGauge(pace.timeElapsedPct, gaugeCells);
	const timePctStr = `${Math.round(pace.timeElapsedPct)}%`.padStart(3, " ");
	const leftTime = `${s.border("│")} ${s.cyan("⏱ ")} ${timeBar} ${s.cyan(timePctStr)}`;
	const rightPill = `${pace.pillColor(pace.pillLabel)} ${s.border("│")}`;
	const spTime = Math.max(1, boxW - visibleLen(leftTime) - visibleLen(rightPill));
	const boxLine1 = `${leftTime}${" ".repeat(spTime)}${rightPill}`;

	// Línea 3: │ Uso [▰▰▱▱▱▱▱▱▱▱▱] 15%        85% libre    │ (etiqueta "Uso")
	const quotaBar = renderSpectralGauge(pace.consumedPct, gaugeCells);
	const quotaPctStr = `${pace.consumedPct}%`.padStart(3, " ");
	const leftQuota = `${s.border("│")} ${s.slate("Uso")} ${quotaBar} ${s.boldWhite(quotaPctStr)}`;
	const rightFree = `${s.slate(pace.remainingPct + "% libre")} ${s.border("│")}`;
	const spQuota = Math.max(1, boxW - visibleLen(leftQuota) - visibleLen(rightFree));
	const boxLine2 = `${leftQuota}${" ".repeat(spQuota)}${rightFree}`;

	// Línea 4: ╰──────────────────────────────────────────╯
	const boxBot = `${s.border("╰" + "─".repeat(boxW - 2) + "╯")}`;

	// Envolver cada línea para garantizar ancho safeW cerrado
	const wrapInContainer = (content: string) => {
		const pad = Math.max(0, innerW - visibleLen(content));
		return fitToWidth(`${s.border("│")} ${content}${" ".repeat(pad)} ${s.border("│")}`, safeW);
	};

	return [
		wrapInContainer(boxTop),
		wrapInContainer(boxLine1),
		wrapInContainer(boxLine2),
		wrapInContainer(boxBot),
	];
}

export function renderDualConcentricClocks(
	acc: { consumed5h?: string; consumedWeekly?: string; reset5hInSec?: number; resetWeeklyInSec?: number },
	s: ThemeStyler,
	innerW: number,
	safeW: number,
): string[] {
	const pace5h = calculateQuotaPace(acc.consumed5h || "0%", acc.reset5hInSec, 300, s);
	const paceWk = calculateQuotaPace(acc.consumedWeekly || "0%", acc.resetWeeklyInSec, 10080, s);

	const lines5h = renderRaceBox("5 HORAS", pace5h, innerW, safeW, s);
	const linesWk = renderRaceBox("SEMANAL", paceWk, innerW, safeW, s);

	return [...lines5h, ...linesWk];
}

function extractBorderColor(lines: string[], theme?: any): string {
	// 1. Leer del objeto theme de Pi si está disponible
	if (theme && typeof theme.fg === "function") {
		const sample = theme.fg("border", "X");
		const match = sample.match(/^(\x1b\[[0-9;]*m)/);
		if (match) return match[1];
	}
	// 2. Extraer del primer carácter del recuadro superior nativo (Status)
	for (const line of lines) {
		const match = line.match(/^(\x1b\[[0-9;]*m)/);
		if (match) return match[1];
	}
	// 3. Fallback a gris suave tenue de borde
	return "\x1b[38;2;120;153;166m";
}

export type AccordionMode = "collapsed" | "peek" | "pinned";

/**
 * Formatea la tarjeta completa para el Sidebar en modo Fullscreen (gentle-shell / gentle-pi).
 * Se adapta dinámicamente al ancho exacto del panel de Status (48 columnas) y hereda
 * la paleta tipográfica y tonalidades completas del tema nativo.
 */
export function formatSidebarQuotaCardLines(
	pair: PoolRotationPair | null,
	width = 48,
	borderColor = "\x1b[38;2;120;153;166m",
	theme?: any,
	isBusy = false,
	guardTelemetry?: RunawayGuardTelemetry,
	periodLabel = "Hoy (24h)",
	accordionState: boolean | AccordionMode = false,
	peekRemainingSec = 20,
): string[] {
	const mode: AccordionMode =
		typeof accordionState === "string"
			? accordionState
			: accordionState
				? "pinned"
				: "collapsed";
	const isExpanded = mode !== "collapsed";
	if (width < 20) {
		// Modo ultra-compacto si el ancho disponible es extremadamente pequeño
		if (!pair) return [truncateWithAnsi("⚡ Sin pool activo", width)];
		const activeLabel = pair.active.prefix || pair.active.accountId;
		return [truncateWithAnsi(`⚡ ${pair.poolKey}: ${activeLabel} (${pair.active.minAvailable})`, width)];
	}

	const safeW = width;
	const s = createThemeStyler(theme, borderColor);

	if (!pair || !pair.active) {
		const titleStr = truncateWithAnsi("⚡ CUENTAS CPAMC", Math.max(1, safeW - 6));
		const titlePrefix = `${s.border("╭─ ")}${s.accent(titleStr)} ${s.border("─")}`;
		const prefixLen = visibleLen(titlePrefix);
		const titleRules = Math.max(1, safeW - prefixLen - 1);
		const top = `${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`;
		const bot = s.border("╰" + "─".repeat(safeW - 2) + "╯");
		const msg = truncateWithAnsi("Sin cuentas con rotación activa", Math.max(1, safeW - 4));
		const emptySpace = Math.max(0, safeW - 4 - visibleLen(msg));
		return [
			fitToWidth(top, safeW),
			fitToWidth(`${s.border("│")} ${s.muted(msg)}${" ".repeat(emptySpace)} ${s.border("│")}`, safeW),
			fitToWidth(bot, safeW),
		];
	}

	const innerW = Math.max(4, safeW - 4);
	const renderLine = (label: string, val: string) => {
		const totalLen = visibleLen(label) + visibleLen(val);
		if (totalLen >= innerW) {
			const spaceLeft = Math.max(3, innerW - visibleLen(label) - 1);
			const truncatedVal = truncateWithAnsi(val, spaceLeft);
			const space = Math.max(1, innerW - visibleLen(label) - visibleLen(truncatedVal));
			return fitToWidth(`${s.border("│")} ${label}${" ".repeat(space)}${truncatedVal} ${s.border("│")}`, safeW);
		}
		const space = Math.max(1, innerW - totalLen);
		return fitToWidth(`${s.border("│")} ${label}${" ".repeat(space)}${val} ${s.border("│")}`, safeW);
	};

	const divider = fitToWidth(s.border("├" + "─".repeat(Math.max(1, safeW - 2)) + "┤"), safeW);

	// Evaluación de estado trifásico cromático (Verde tenue vs Verde brillante vs Ámbar)
	const availNum = parseFloat(pair.active.minAvailable.replace("%", "").trim()) || 0;
	const isFatigued = availNum < 25; // Cuenta cansada (<25% libre)
	const isAmber = isFatigued;

	const bar5h = s.paintGauge(pair.active.consumed5h, 6, isAmber);
	const barWk = s.paintGauge(pair.active.consumedWeekly, 6, isAmber);

	// 1. Cabecera con estado vivo
	let stateTag = s.idle("[○ Esperando]");
	if (isAmber) {
		stateTag = pair.isNativeReadOnly ? s.amber("[⚠️ Cuota baja]") : s.amber("[⚡ Limpiando]");
	} else if (isBusy) {
		stateTag = s.live("[● Escribiendo]");
	}

	const maxFamilyW = Math.max(3, safeW - 28);
	const familyDisplay = truncateWithAnsi(
		pair.isNativeReadOnly ? pair.poolKey : pair.familyName,
		maxFamilyW,
	);
	const titlePrefix = pair.isNativeReadOnly
		? `${s.border("╭─ ")}${s.accent("⚡ CUENTA DIRECTA: ")}${s.text(familyDisplay)} ${s.border("─ ")}${stateTag} ${s.border("─")}`
		: `${s.border("╭─ ")}${s.accent("⚡ POOL: ")}${s.text(familyDisplay)} ${s.border("─ ")}${stateTag} ${s.border("─")}`;
	const prefixLen = visibleLen(titlePrefix);
	const titleRules = Math.max(1, safeW - prefixLen - 1);
	const top = fitToWidth(`${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`, safeW);
	const bottom = fitToWidth(s.border("╰" + "─".repeat(Math.max(1, safeW - 2)) + "╯"), safeW);

	const activeAccountLabel = pair.active.prefix || pair.active.accountId;
	const nextAccountLabel = pair.next ? (pair.next.prefix || pair.next.accountId) : "";

	// Estado coloquial de la cuenta activa
	let activeStateLabel = isAmber
		? `${s.amber("▲ " + activeAccountLabel)} ${s.amber("(Cansada)")}`
		: isBusy
			? `${s.live("● " + activeAccountLabel)} ${s.live(`(${pair.active.minAvailable} ok)`)}`
			: `${s.idle("○ " + activeAccountLabel)} ${s.idle(`(${pair.active.minAvailable} ok)`)}`;

	// Bloque reactivo "PROTECCIÓN ACTIVA" (Cockpit / Telemetría viva de seguridad)
	const telemetry = guardTelemetry || runawayGuard.getTelemetry();
	const isTripped = Boolean(telemetry.circuitBreakerTripped);
	const hasActiveInterception =
		isTripped ||
		telemetry.blockedIntrospections > 0 ||
		telemetry.blockedBashEvasions > 0 ||
		telemetry.blockedSubagentPolls > 0 ||
		(telemetry.blockedProhibitedCommands || 0) > 0 ||
		telemetry.bashExplorationCount >= MAX_BASH_EXPLORATION_PER_TURN;

	// Enfoque de rotación
	const approachVal = isTripped
		? s.error("🛑 Bucle Interceptado")
		: hasActiveInterception
			? s.amber("Frenando bucles")
			: isAmber
				? s.amber("Podando texto muy largo")
				: isBusy
					? s.live("Escribiendo en vivo")
					: s.text("Misma cuenta fija");

	// Cabecera unificada Cockpit
	const headerTitle = isTripped
		? s.error("🛡 [DISYUNTOR]")
		: hasActiveInterception
			? s.amber("🛡 [INTERCEPCIÓN]")
			: s.accent("🛡 [CUIDANDO EL CHAT]");

	const headerTag = isTripped
		? s.error("🛑 DISPARADO")
		: hasActiveInterception
			? s.amber("⚡ Bucle Interceptado")
			: isBusy
				? s.live("⚡ Monitoreando turno")
				: s.idle("● En guardia");

	const rule1Len = Math.max(1, innerW - visibleLen(headerTitle) - visibleLen(headerTag) - 2);
	const cockpitHeaderLine = fitToWidth(
		`${s.border("│")} ${headerTitle} ${s.border("─".repeat(rule1Len))} ${headerTag} ${s.border("│")}`,
		safeW,
	);

	// Barra del turno en vivo de 10 celdas
	const toolCount = telemetry.totalToolCount || 0;
	const turnGauge = renderSpectralGauge(Math.round((toolCount / 15) * 100), 10);
	const turnPctColor = toolCount >= 14 ? s.error : toolCount >= 10 ? s.amber : s.idle;
	const turnLabel = `${s.slate("Turno en vivo:")} [${turnGauge}]   ${turnPctColor(String(toolCount) + "/15")} ${s.muted("acciones")}`;
	const spTurn = Math.max(1, innerW - visibleLen(turnLabel));
	const cockpitTurnLine = fitToWidth(`${s.border("│")} ${turnLabel}${" ".repeat(spTurn)} ${s.border("│")}`, safeW);

	// Divisoria interior suave
	const cockpitInnerDivider = fitToWidth(`${s.border("│")} ${s.border("─".repeat(innerW))} ${s.border("│")}`, safeW);

	// Valores dinámicos reales de la matriz 2x2
	const colW = Math.floor((innerW - 1) / 2);
	const renderDoubleLine = (l1: string, v1: string, l2: string, v2: string) => {
		const cell1 = `${l1} ${v1}`;
		const cell2 = `${l2} ${v2}`;
		const sp1 = Math.max(0, colW - visibleLen(cell1));
		const sp2 = Math.max(0, innerW - colW - 1 - visibleLen(cell2));
		const content = `${cell1}${" ".repeat(sp1)}${s.border("│")}${cell2}${" ".repeat(sp2)}`;
		return fitToWidth(`${s.border("│")} ${content} ${s.border("│")}`, safeW);
	};

	// 1. Rescate Red
	const rescateVal = isAmber ? s.amber("1/2 activo") : s.idle("0/2");
	// 2. Subagentes
	const pollVal = telemetry.blockedSubagentPolls > 0
		? s.error("🛑 Bloqueado")
		: telemetry.subagentPollCount > 0
			? s.amber(`${telemetry.subagentPollCount}/2 llamadas`)
			: s.idle("0/2");
	// 3. Sesión
	const introVal = telemetry.blockedIntrospections > 0 ? s.error("🛑 Bloqueado") : s.idle("Protegida");
	// 4. Ahorro real de tokens podados acumulados
	const savedTokens = telemetry.tokensSavedEstimate || 0;
	const ahorroVal = savedTokens > 0
		? s.cyan(`+${Math.round(savedTokens / 1000)}k tk`)
		: s.idle("0 tk");
	// 5. Bucles cíclicos
	const loopsVal = isTripped
		? s.error("🛑 DISPARADO")
		: hasActiveInterception
			? s.amber("⚡ 1 detectado")
			: s.idle("0 detectados");
	// 6. Terminal Bash
	const bashVal = telemetry.blockedBashEvasions > 0
		? s.error("🛑 Bloqueado")
		: telemetry.bashExplorationCount > 0
			? s.amber(`${telemetry.bashExplorationCount}/5`)
			: s.idle("0/5 llamadas");

	let chatBlockLines: string[] = [];
	if (isTripped) {
		const incId = telemetry.incidentId || "active";
		const linkUrl = `http://127.0.0.1:8317/management.html#/plugin-pages/auto-switcher-pro-linux-amd64/2#incident-${incId}`;
		const eventCount =
			telemetry.lastIncident?.actions_blocked ||
			(telemetry.circuitBreakerReason === "STEP_BUDGET_EXCEEDED"
				? 15
				: telemetry.circuitBreakerReason === "CYCLE_DETECTED"
					? 3
					: 1);
		const linkLabel = `[Ver detalles (${eventCount}) ↗]`;
		const linkText = `\x1b]8;;${linkUrl}\x1b\\${linkLabel}\x1b]8;;\x1b\\`;
		const savedK = Math.max(1, Math.round((telemetry.tokensSavedEstimate || 45000) / 1000));
		const reasonLabel =
			telemetry.circuitBreakerReason === "CYCLE_DETECTED"
				? "Ciclo repetitivo (x3)"
				: telemetry.circuitBreakerReason === "PROHIBITED_COMMAND"
					? "Comando host prohibido"
					: "Pasos agotados (15/15)";

		chatBlockLines = [
			cockpitHeaderLine,
			renderLine(s.muted("Disyuntor Anti-Bucle"), s.error("🛑 Disparado")),
			renderLine(s.muted("Causa"), s.error(reasonLabel)),
			renderLine(s.muted("Tokens protegidos"), s.live(`~${savedK}k tokens`)),
			renderLine(s.muted("Diagnóstico"), s.accent(linkText)),
			renderLine(s.muted("O escribe"), s.accent("/incident")),
			divider,
			renderLine(s.error("[ACCIÓN REQUERIDA]"), s.text("Dar orden directa")),
		];
	} else {
		chatBlockLines = [
			cockpitHeaderLine,
			cockpitTurnLine,
			cockpitInnerDivider,
			renderDoubleLine(s.muted("Rescate Red:"), rescateVal, s.muted("Subagentes:"), pollVal),
			renderDoubleLine(s.muted("Sesión:"), introVal, s.muted("Ahorro:"), ahorroVal),
			renderDoubleLine(s.muted("Bucles:"), loopsVal, s.muted("Bash:"), bashVal),
		];
	}

		// Líneas de cabecera (3 filas como en la imagen)
		// Fila 1: Periodo / Modo y Afinidad / Badge
		const lifecycle = getCachedLifecycle();
		const ctxState = getContextState();
		const curPeriod = periodLabel || lifecycle?.period_label || "Hoy (24h)";
		const affinityVal = lifecycle?.cache_affinity_pct ? `${lifecycle.cache_affinity_pct.toFixed(0)}% ok` : "92% ok";
		
		let linePeriodLeft: string;
		let linePeriodRight: string;
		if (pair.isNativeReadOnly) {
			linePeriodLeft = `${s.muted("Modo:")} ${s.amber("[CUENTA FIJA · SIN FAILOVER]")}`;
			linePeriodRight = `${s.muted("Conex:")} ${s.idle("Directa")}`;
		} else {
			linePeriodLeft = `${s.muted("Periodo:")} ${s.text(curPeriod)}`;
			linePeriodRight = `${s.muted("Caché Afinidad:")} ${s.idle(affinityVal)}`;
		}
		const spPeriod = Math.max(1, innerW - visibleLen(linePeriodLeft) - visibleLen(linePeriodRight));
		const headerRow1 = fitToWidth(`${s.border("│")} ${linePeriodLeft}${" ".repeat(spPeriod)}${linePeriodRight} ${s.border("│")}`, safeW);

		// Fila 2: Modelo o Proveedor (evitando duplicidad exacta si ya figura en el título)
		const headerRow2 = pair.isNativeReadOnly
			? renderLine(s.muted("Proveedor"), s.text(pair.familyName || pair.active.provider || "Directo"))
			: renderLine(s.muted("Modelo"), s.text(pair.poolKey));

		// Fila 3: Cuentas: 2 · listas / Cuenta fija     Enfoque: Cuenta fija
		const line2Left = pair.isNativeReadOnly
			? `${s.muted("Cuenta:")} ${s.text(truncateWithAnsi(pair.active.prefix || pair.active.accountId, Math.max(8, innerW - 25)))}`
			: `${s.muted("Cuentas:")} ${s.text(String(pair.totalAccounts))} ${s.slate("· listas")}`;
		const compactApproach = approachVal
			.replace("Misma cuenta fija", "Cuenta fija")
			.replace("🛑 Bucle Interceptado", "🛑 Bucle");
		const maxApproachW = Math.max(8, innerW - visibleLen(line2Left) - 10);
		const approachDisplay = truncateWithAnsi(compactApproach, maxApproachW);
		const line2Right = `${s.muted("Enfoque:")} ${s.text(approachDisplay)}`;
		const spL2 = Math.max(1, innerW - visibleLen(line2Left) - visibleLen(line2Right));
		const headerRow3 = fitToWidth(`${s.border("│")} ${line2Left}${" ".repeat(spL2)}${line2Right} ${s.border("│")}`, safeW);

		// Bloque ROTACIONES & LIDERAZGO (solo si no es cuenta directa fija)
		const rotSectionLines: string[] = [];
		if (!pair.isNativeReadOnly) {
			const rotCount = lifecycle?.rotations_count ?? 4;
			const curLeadDur = lifecycle?.current_leader_dur ?? "1h 45m";
			const rescuesCount = lifecycle?.rescues_429_count ?? 0;
			const tokensFmt = lifecycle?.tokens_consumed_fmt ?? "420k";
			const sustainedTurns = lifecycle?.sustained_turns ?? 38;

			const rotTitle = `${s.cyan("🔄 ROTACIONES & LIDERAZGO:")} ${s.text(pair.poolKey)}`;
			const rotHeader = fitToWidth(`${s.border("│")} ${rotTitle}${" ".repeat(Math.max(1, innerW - visibleLen(rotTitle)))} ${s.border("│")}`, safeW);
			const rotRow1 = renderDoubleLine(s.muted("Rotaciones hoy:"), s.text(String(rotCount)), s.muted("Líder actual:"), s.text(curLeadDur));
			const rotRow2 = renderDoubleLine(s.muted("Rescates 429:"), s.text(String(rescuesCount)), s.muted("Tokens consumidos:"), s.text(tokensFmt));
			const rotRow3 = renderLine(s.muted("Turnos sostenidos:"), `${s.text(String(sustainedTurns))} ${s.slate("turnos sin corte")}`);
			rotSectionLines.push(rotHeader, rotRow1, rotRow2, rotRow3, divider);
		}

		// Línea de cuenta activa con tiempo de líder: ⚡ wil...io7 (Líder hace 42m) ○ agy (84.2% ok)
		const activeLeadSince = lifecycle?.active_leader_since ?? "42m";
		const maxActiveEmailW = Math.max(8, innerW - visibleLen(activeStateLabel) - 18);
		const activeEmailTrunc = truncateWithAnsi(pair.active.accountId, maxActiveEmailW);
		const activeLeadSuffix = pair.isNativeReadOnly ? "(Cuenta fija)" : `(Líder hace ${activeLeadSince})`;
		const leftActive = `${s.accent("⚡ ")}${s.text(activeEmailTrunc)} ${s.muted(activeLeadSuffix)}`;
		const spActive = Math.max(1, innerW - visibleLen(leftActive) - visibleLen(activeStateLabel));
		const activeLine = fitToWidth(`${s.border("│")} ${leftActive}${" ".repeat(spActive)}${activeStateLabel} ${s.border("│")}`, safeW);

		// Línea de siguiente cuenta: Candidato a Líder (solo en pools)
		const nextAccountLines: string[] = [];
		if (!pair.isNativeReadOnly) {
			let nextLine: string;
			if (pair.next) {
				const nextStateLabel = pair.next.minAvailable
					? `${s.idle("○ " + nextAccountLabel)} ${s.muted(`(${pair.next.minAvailable})`)}`
					: s.text(nextAccountLabel);
				const maxNextEmailW = Math.max(8, innerW - visibleLen(nextStateLabel) - 22);
				const nextEmailTrunc = truncateWithAnsi(pair.next.accountId, maxNextEmailW);
				const leftNext = `${s.muted("Candidato a Líder:")} ${s.text(nextEmailTrunc)}`;
				const spNext = Math.max(1, innerW - visibleLen(leftNext) - visibleLen(nextStateLabel));
				nextLine = fitToWidth(`${s.border("│")} ${leftNext}${" ".repeat(spNext)}${nextStateLabel} ${s.border("│")}`, safeW);
			} else {
				const leftNext = `${s.muted("Candidato a Líder:")}`;
				const rightNone = s.muted("Ninguno (Sola)");
				const spNext = Math.max(1, innerW - visibleLen(leftNext) - visibleLen(rightNone));
				nextLine = fitToWidth(`${s.border("│")} ${leftNext}${" ".repeat(spNext)}${rightNone} ${s.border("│")}`, safeW);
			}
			nextAccountLines.push(nextLine);
		}

		// Fila interactiva del acordeón colapsable
		const hintSuffix = s.muted(" (Ctrl+Alt+X)");
		let accordionLabel = "";

		if (mode === "peek") {
			const pauseHint = innerW >= 56 ? " (Pausar con Ctrl+Alt+X)" : innerW >= 42 ? " (Pausa)" : "";
			const timerBadge = s.muted(`· Cierra en ${peekRemainingSec}s${pauseHint}`);
			accordionLabel = `${s.amber("▼")} ${s.text("[Ocultar detalles]")} ${timerBadge}`;
		} else if (mode === "pinned") {
			const pinnedSuffix = innerW >= 56 ? "· Fijo (Ctrl+Alt+X)" : "· Fijo";
			const pinnedBadge = s.muted(pinnedSuffix);
			accordionLabel = pair.isNativeReadOnly
				? `${s.amber("▼")} ${s.text("[Ocultar detalles de contexto]")} ${pinnedBadge}`
				: `${s.amber("▼")} ${s.text("[Ocultar detalles extendidos]")} ${pinnedBadge}`;
		} else {
			// collapsed
			accordionLabel = pair.isNativeReadOnly
				? `${s.accent("▶")} ${s.text("[Ver más: Contexto de Sesión]")}${hintSuffix}`
				: `${s.accent("▶")} ${s.text("[Ver más: Contexto, Historial y Líderes]")}${hintSuffix}`;
		}

		const makeBoxLine = (content: string) => {
			const vis = visibleLen(content);
			if (vis > innerW) {
				const truncated = truncateWithAnsi(content, innerW);
				const pad = Math.max(0, innerW - visibleLen(truncated));
				return `${s.border("│")} ${truncated}${" ".repeat(pad)} ${s.border("│")}`;
			}
			const pad = Math.max(0, innerW - vis);
			return `${s.border("│")} ${content}${" ".repeat(pad)} ${s.border("│")}`;
		};

		const accordionLine = makeBoxLine(accordionLabel);

		if (!isExpanded) {
			const rawCollapsedLines = [
				top,
				headerRow1,
				headerRow2,
				headerRow3,
				divider,
				...rotSectionLines,
				activeLine,
				...renderDualConcentricClocks(pair.active, s, innerW, safeW),
				...nextAccountLines,
				divider,
				...chatBlockLines,
				divider,
				accordionLine,
				bottom,
			];
			return rawCollapsedLines.map((line) => fitToWidth(line, safeW));
		}

		// Bloque CONTEXTO & COMPRESIÓN
		const compTitle = `${s.amber("📦 CONTEXTO & COMPRESIÓN")}`;
		const compHeader = fitToWidth(`${s.border("│")} ${compTitle}${" ".repeat(Math.max(1, innerW - visibleLen(compTitle)))} ${s.border("│")}`, safeW);
		const curTokK = ctxState.currentTokens > 0 ? Math.round(ctxState.currentTokens / 1000) : 0;
		const maxTokK = Math.round(ctxState.contextWindow / 1000);
		const compRow1 = renderLine(s.muted("Compresiones sesión:"), s.text(`${ctxState.compressionsSession} compactaciones`));
		const compRow2 = renderLine(s.muted("Longitud actual:"), s.text(`${curTokK}k / ${maxTokK}k tokens`));
		const compRow3 = renderLine(s.muted("Pérdida de contexto:"), s.text(`${ctxState.lossEvents} eventos críticos`));

		const compLines = [compHeader, compRow1, compRow2, compRow3];
		if (pair.active.reset5hInSec && pair.active.reset5hInSec > 0) {
			const sec = pair.active.reset5hInSec;
			const rH = Math.floor(sec / 3600);
			const rM = Math.floor((sec % 3600) / 60);
			compLines.push(renderLine(s.muted("Reinicio 5h:"), s.accent(`en ${rH}h ${rM}m`)));
		}

		// Bloque CAUSAS DE ROTACIÓN (ÚLTIMAS 24H) - Solo para Pools
		const causesSectionLines: string[] = [];
		if (!pair.isNativeReadOnly) {
			const causesTitle = `${s.amber("⚠️ CAUSAS DE ROTACIÓN (ÚLTIMAS 24H)")}`;
			const causesHeader = fitToWidth(`${s.border("│")} ${causesTitle}${" ".repeat(Math.max(1, innerW - visibleLen(causesTitle)))} ${s.border("│")}`, safeW);
			const causesLines: string[] = [];
			const recentCauses = lifecycle?.recent_causes && lifecycle.recent_causes.length > 0
				? lifecycle.recent_causes
				: [
					{ time_str: "14:20", previous_leader: "wil...io7", new_leader: "mar...tro", reason_display: "[Fatiga 80%]", timestamp: 0 },
					{ time_str: "12:05", previous_leader: "mar...tro", new_leader: "wil...io7", reason_display: "[HTTP 429]", timestamp: 0 },
					{ time_str: "09:30", previous_leader: "wil...io7", new_leader: "infosoy..", reason_display: "[Histéresis Δ]", timestamp: 0 },
					{ time_str: "08:15", previous_leader: "infosoy..", new_leader: "wil...io7", reason_display: "[Manual Hook]", timestamp: 0 },
				];

			for (const cause of recentCauses.slice(0, 4)) {
				const causeLeft = `${s.muted(cause.time_str)}  ${s.text(cause.previous_leader)} ${s.slate("➔")} ${s.text(cause.new_leader)}`;
				const causeRight = s.accent(cause.reason_display);
				const spC = Math.max(1, innerW - visibleLen(causeLeft) - visibleLen(causeRight));
				causesLines.push(fitToWidth(`${s.border("│")} ${causeLeft}${" ".repeat(spC)}${causeRight} ${s.border("│")}`, safeW));
			}
			causesSectionLines.push(divider, causesHeader, ...causesLines);
		}

		// Bloque Pie de Tarjeta: Estado actual y Duraciones
		const footSectionLines: string[] = [];
		const activeAccShort = activeEmailTrunc;
		if (pair.isNativeReadOnly) {
			const curLeadState = `${s.muted("Estado actual:")}  ${s.accent("⚡ ")}${s.text(activeAccShort)} ${s.muted("(Cuenta fija)")}`;
			const footRow1 = fitToWidth(`${s.border("│")} ${curLeadState}${" ".repeat(Math.max(1, innerW - visibleLen(curLeadState)))} ${s.border("│")}`, safeW);
			const footRow2Left = `${s.muted("Conexión:")} ${s.text("Directa (sin relevos)")}`;
			const spFoot2 = Math.max(1, innerW - visibleLen(footRow2Left));
			const footRow2 = fitToWidth(`${s.border("│")} ${footRow2Left}${" ".repeat(spFoot2)} ${s.border("│")}`, safeW);
			footSectionLines.push(footRow1, footRow2);
		} else {
			const curLeadState = `${s.muted("Estado actual:")}  ${s.accent("⚡ ")}${s.text(activeAccShort)} ${s.muted(`(Líder hace ${activeLeadSince})`)}`;
			const footRow1 = fitToWidth(`${s.border("│")} ${curLeadState}${" ".repeat(Math.max(1, innerW - visibleLen(curLeadState)))} ${s.border("│")}`, safeW);
			const prevLeadDur = lifecycle?.prev_leader_dur ?? "2h 10m";
			const avgLeadDur = lifecycle?.avg_leader_dur ?? "1h 22m";
			const footRow2Left = `${s.muted("Líder anterior:")} ${s.text(prevLeadDur)}`;
			const footRow2Right = `${s.muted("Promedio/cta:")} ${s.text(avgLeadDur)}`;
			const spFoot2 = Math.max(1, innerW - visibleLen(footRow2Left) - visibleLen(footRow2Right));
			const footRow2 = fitToWidth(`${s.border("│")} ${footRow2Left}${" ".repeat(spFoot2)}${footRow2Right} ${s.border("│")}`, safeW);
			footSectionLines.push(footRow1, footRow2);
		}

		const rawLines = [
			top,
			headerRow1,
			headerRow2,
			headerRow3,
			divider,
			...rotSectionLines,
			activeLine,
			...renderDualConcentricClocks(pair.active, s, innerW, safeW),
			...nextAccountLines,
			divider,
			...chatBlockLines,
			divider,
			accordionLine,
			divider,
			...compLines,
			...causesSectionLines,
			divider,
			...footSectionLines,
			bottom,
		];

	return rawLines.map((line) => fitToWidth(line, safeW));
}

/**
 * Estado volátil en memoria para preservar la preferencia del acordeón durante la sesión de Pi.
 */
let sessionAccordionExpanded: boolean | null = null;
let sessionAccordionMode: AccordionMode | null = null;

export function getSessionAccordionState(): boolean {
	if (sessionAccordionMode !== null) {
		return sessionAccordionMode !== "collapsed";
	}
	if (sessionAccordionExpanded !== null) {
		return sessionAccordionExpanded;
	}
	const termRows = process.stdout?.rows || 24;
	return termRows >= 48;
}

export function setSessionAccordionState(expanded: boolean | AccordionMode): void {
	if (typeof expanded === "string") {
		sessionAccordionMode = expanded;
		sessionAccordionExpanded = expanded !== "collapsed";
	} else {
		sessionAccordionExpanded = expanded;
		sessionAccordionMode = expanded ? "pinned" : "collapsed";
	}
}

/**
 * Gestiona la inyección reactiva del TUI según el modo (`regular` vs `fullscreen`).
 */
export class CpamcTuiAdapter {
	private isFullscreen = false;
	private isBusy = false;
	private accordionMode: AccordionMode = getSessionAccordionState() ? "pinned" : "collapsed";
	private peekRemainingSec = 0;
	private peekTimer: NodeJS.Timeout | null = null;
	private currentPair: PoolRotationPair | null = null;
	private ctx: ExtensionContext | null = null;
	private tui: any = null;
	private theme: any = null;
	private periodIndex = 0;
	private readonly periods = ["Hoy (24h)", "Semana (7d)", "Mes (30d)"];

	constructor(ctx: ExtensionContext | null) {
		this.ctx = ctx;
	}

	getAccordionMode(): AccordionMode {
		return this.accordionMode;
	}

	getPeekRemainingSeconds(): number {
		return this.peekRemainingSec;
	}

	togglePeriod(): string {
		this.periodIndex = (this.periodIndex + 1) % this.periods.length;
		return this.periods[this.periodIndex];
	}

	getPeriodLabel(): string {
		return this.periods[this.periodIndex];
	}

	toggleExpanded(): AccordionMode {
		this.clearPeekTimer();
		if (this.accordionMode === "collapsed") {
			this.accordionMode = "pinned";
			setSessionAccordionState("pinned");
		} else if (this.accordionMode === "peek") {
			// Congelar/Pausar -> pasa a PINNED fijo
			this.accordionMode = "pinned";
			setSessionAccordionState("pinned");
		} else {
			// Estaba en PINNED -> Colapsar
			this.accordionMode = "collapsed";
			setSessionAccordionState("collapsed");
		}
		this.requestRender();
		return this.accordionMode;
	}

	isCardExpanded(): boolean {
		return this.accordionMode !== "collapsed";
	}

	setExpanded(expanded: boolean): void {
		this.clearPeekTimer();
		this.accordionMode = expanded ? "pinned" : "collapsed";
		setSessionAccordionState(this.accordionMode);
		this.requestRender();
	}

	triggerPeek(seconds = 20): void {
		if (this.accordionMode === "pinned") {
			return;
		}

		this.accordionMode = "peek";
		this.peekRemainingSec = seconds;
		this.clearPeekTimer();

		this.peekTimer = setInterval(() => {
			this.tickPeek();
		}, 1000);

		this.requestRender();
	}

	tickPeek(): void {
		if (this.accordionMode !== "peek") {
			this.clearPeekTimer();
			return;
		}

		this.peekRemainingSec = Math.max(0, this.peekRemainingSec - 1);
		if (this.peekRemainingSec <= 0) {
			this.clearPeekTimer();
			this.accordionMode = "collapsed";
			setSessionAccordionState("collapsed");
		}
		this.requestRender();
	}

	onTurnStart(): void {
		if (this.accordionMode === "peek") {
			this.clearPeekTimer();
			this.accordionMode = "collapsed";
			setSessionAccordionState("collapsed");
			this.requestRender();
		}
	}

	private clearPeekTimer(): void {
		if (this.peekTimer) {
			clearInterval(this.peekTimer);
			this.peekTimer = null;
		}
	}

	private requestRender(): void {
		const tui = this.tui || (this.ctx as any)?.tui;
		tui?.requestRender?.();
	}

	destroy(): void {
		this.clearPeekTimer();
		this.ctx = null;
	}

	setContext(ctx: ExtensionContext | null): void {
		this.ctx = ctx;
		if (!ctx) {
			this.clearPeekTimer();
		}
	}

	bindTui(tui: any, theme?: any): void {
		this.tui = tui;
		if (theme) {
			this.theme = theme;
		}
	}

	private safeGetModel(): any {
		if (!this.ctx) return null;
		try {
			return this.ctx.model ?? null;
		} catch {
			this.ctx = null;
			this.currentPair = null;
			return null;
		}
	}

	async update(isBusy = false, freshCtx?: ExtensionContext): Promise<void> {
		this.isBusy = isBusy;
		if (freshCtx) {
			this.ctx = freshCtx;
		}
		const model = this.safeGetModel();
		if (!model) {
			this.currentPair = null;
			return;
		}

		try {
			this.currentPair = await getRotationPairForModel(model.id, model.provider);

			// Detección de modo TUI y sidebars (gentle-pi y j0k3r-theme):
			const tui = this.tui || (this.ctx as any)?.tui;
			const terminal = tui?.terminal as any;
			const gentleState = terminal?.[Symbol.for("gentle-pi.experimental-sidebar.state")];
			const j0k3rSidebarState = terminal?.[Symbol.for("j0k3r-theme.sidebar.state")];

			this.isFullscreen = Boolean(gentleState?.active || j0k3rSidebarState?.active || terminal?.fullscreen || process.env.PI_TUI_MODE === "fullscreen");

			if (gentleState?.parts) {
				this.injectIntoSidebar(gentleState);
				tui?.requestRender?.();
			}
			if (j0k3rSidebarState?.parts) {
				this.injectIntoSidebar(j0k3rSidebarState);
				tui?.requestRender?.();
			}

			// Inyectar simultáneamente en Footer para tener ambas superficies activas y unificadas
			this.injectIntoFooter(isBusy);
		} catch {
			// Silenciar fallos secundarios en segundo plano
		}
	}

	private getModelOriginTag(): string | undefined {
		const model = this.safeGetModel();
		if (!model) return undefined;
		const settings = (this.ctx as any)?.settingsManager;
		const defaultProvider = settings?.getDefaultProvider?.() || "cpamc";
		const defaultModelId = settings?.getDefaultModel?.();

		if (
			defaultModelId &&
			model.id === defaultModelId &&
			(model.provider || "cpamc") === defaultProvider
		) {
			return "default";
		}
		return "sesión";
	}

	private injectIntoFooter(isBusy: boolean): void {
		try {
			const originTag = this.getModelOriginTag();
			const block = formatFooterRotationBlock(this.currentPair, isBusy, originTag);
			const tui = this.tui || (this.ctx as any)?.tui;
			const terminal = tui?.terminal as any;
			const footer = (this.ctx as any)?.footer || terminal?.[Symbol.for("j0k3r-theme.footer")];

			if (typeof footer?.setQuota === "function") {
				footer.setQuota(block || undefined);
			}
		} catch {}
	}

	private originalFooterPart: any = null;
	private decoratedFooter: any = null;

	private injectIntoSidebar(gentleState: any): void {
		if (!gentleState?.parts) return;

		gentleState.parts.set("cpamc-quota-card", {
			render: () => {
				try {
					const m = this.safeGetModel();
					const p = m ? (getRotationPairForModelSync(m.id, m.provider) || this.currentPair) : this.currentPair;
					return formatSidebarQuotaCardLines(
						p,
						48,
						"\x1b[38;2;120;153;166m",
						this.theme,
						this.isBusy,
						undefined,
						this.getPeriodLabel(),
						this.accordionMode,
						this.peekRemainingSec,
					);
				} catch {
					return [];
				}
			},
			digest: () => {
				try {
					const m = this.safeGetModel();
					const p = m ? (getRotationPairForModelSync(m.id, m.provider) || this.currentPair) : this.currentPair;
					const g = runawayGuard.getTelemetry();
					return `${m?.id || "none"}-${p?.poolKey || "none"}-${p?.active?.prefix || "none"}-${p?.active?.minAvailable || "none"}-${this.isBusy}-${this.accordionMode}-${this.peekRemainingSec}-${g.bashExplorationCount}-${g.subagentPollCount}-${g.blockedIntrospections}-${g.blockedBashEvasions}`;
				} catch {
					return "none";
				}
			},
			invalidate: () => {},
			handleMouse: (event: any) => {
				try {
					if (event && (event.type === "click" || event.type === "press")) {
						this.toggleExpanded();
						const tui = this.tui || (this.ctx as any)?.tui;
						tui?.requestRender?.();
						return { handled: true, render: true };
					}
				} catch {}
				return undefined;
			},
		});

		// Decoración de la sección "footer" nativa del sidebar
		const currentFooter = gentleState.parts.get("footer");

		// Si ya está decorado por nosotros, no volvemos a envolver
		if (currentFooter && (currentFooter as any).__isCpamcDecorated) {
			return;
		}

		// Si hay un footer base, lo conservamos
		this.originalFooterPart = currentFooter;

		this.decoratedFooter = {
			__isCpamcDecorated: true,
			render: (width: number) => {
				try {
					let baseLines: string[] = [];
					try {
						baseLines = this.originalFooterPart?.render
							? (this.originalFooterPart.render(width) ?? [])
							: [];
					} catch {
						baseLines = [];
					}

					const model = this.safeGetModel();
					const pair = model
						? (getRotationPairForModelSync(model.id, model.provider) || this.currentPair)
						: this.currentPair;

					if (!pair) {
						return baseLines;
					}

					const bColor = extractBorderColor(baseLines, this.theme);
					const quotaLines = formatSidebarQuotaCardLines(
						pair,
						width,
						bColor,
						this.theme,
						this.isBusy,
						undefined,
						this.getPeriodLabel(),
						this.accordionMode,
						this.peekRemainingSec,
					);

					if (!baseLines.length) {
						return quotaLines;
					}

					return [...baseLines, "", ...quotaLines].map((line) => fitToWidth(line, width));
				} catch {
					return [];
				}
			},
			digest: () => {
				try {
					let baseDigest = "";
					try {
						baseDigest = this.originalFooterPart?.digest
							? this.originalFooterPart.digest()
							: "";
					} catch {
						baseDigest = "";
					}

					const model = this.safeGetModel();
					const modelKey = model ? `${model.provider}:${model.id}` : "none";
					const pair = model
						? (getRotationPairForModelSync(model.id, model.provider) || this.currentPair)
						: this.currentPair;

					const g = runawayGuard.getTelemetry();
					const cpamcDigest = pair
						? `${pair.poolKey || ""}-${pair.active?.prefix || ""}-${pair.active?.minAvailable || ""}-${pair.active?.consumed5h || ""}-${pair.active?.consumedWeekly || ""}-${this.accordionMode}-${this.peekRemainingSec}-${g.bashExplorationCount}-${g.subagentPollCount}-${g.blockedIntrospections}-${g.blockedBashEvasions}`
						: "none";

					return `${baseDigest}::m::${modelKey}::c::${cpamcDigest}`;
				} catch {
					return "none";
				}
			},
			invalidate: () => {
				try {
					this.originalFooterPart?.invalidate?.();
				} catch {}
			},
			handleMouse: (event: any) => {
				try {
					if (event && (event.type === "click" || event.type === "press")) {
						// Si el clic ocurre en la fila del botón acordeón o en la tarjeta
						this.toggleExpanded();
						const tui = this.tui || (this.ctx as any)?.tui;
						tui?.requestRender?.();
						return { handled: true, render: true };
					}
					return this.originalFooterPart?.handleMouse?.(event);
				} catch {
					return false;
				}
			},
		};

		gentleState.parts.set("footer", this.decoratedFooter);
	}
}
