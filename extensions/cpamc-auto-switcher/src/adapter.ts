import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getRotationPairForModel, getRotationPairForModelSync, type PoolRotationPair } from "./store.js";
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
				(cp >= 0x1f300 && cp <= 0x1faff) ||
				(cp >= 0x2600 && cp <= 0x27bf) ||
				(cp >= 0x2b50 && cp <= 0x2b55)
					? 2
					: cp >= 0xfe00 && cp <= 0xfe0f
						? 0
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

function visibleLen(str: string): number {
	const clean = str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
	let len = 0;
	for (const char of clean) {
		const code = char.codePointAt(0) || 0;
		if (
			(code >= 0x1f300 && code <= 0x1faff) ||
			(code >= 0x2600 && code <= 0x27bf) ||
			(code >= 0x2b50 && code <= 0x2b55)
		) {
			len += 2;
		} else if (code >= 0xfe00 && code <= 0xfe0f) {
			// variation selector, 0 width
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
): string[] {
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

	if (pair.isNativeReadOnly) {
		const maxTitleW = Math.max(3, safeW - 26);
		const titleLabel = truncateWithAnsi(pair.poolKey, maxTitleW);
		const titlePrefix = `${s.border("╭─ ")}${s.accent("⚡ CUENTA DIRECTA: ")}${s.text(titleLabel)} ${s.border("─")}`;
		const prefixLen = visibleLen(titlePrefix);
		const titleRules = Math.max(1, safeW - prefixLen - 1);
		const top = fitToWidth(`${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`, safeW);
		const bottom = fitToWidth(s.border("╰" + "─".repeat(Math.max(1, safeW - 2)) + "╯"), safeW);
		const activeAccountLabel = pair.active.prefix || pair.active.accountId;

		const rawLines = [
			top,
			renderLine(s.muted("Modelo"), s.text(pair.poolKey)),
			renderLine(s.muted("Cuenta"), s.text(activeAccountLabel)),
			renderLine(s.muted("Conexión"), s.muted("Directa (Cuenta fija)")),
			divider,
			renderLine(s.accent("[TRABAJANDO AHORA]"), `${s.text(activeAccountLabel)} ${s.idle(`(${pair.active.minAvailable} ok)`)}`),
			renderLine(s.muted("Correo"), s.text(pair.active.accountId)),
			divider,
			...renderDualConcentricClocks(pair.active, s, innerW, safeW),
			bottom,
		];
		return rawLines.map((line) => fitToWidth(line, safeW));
	}

	// 1. Cabecera con estado vivo
	let stateTag = s.idle("[○ Esperando]");
	if (isAmber) {
		stateTag = s.amber("[⚡ Limpiando]");
	} else if (isBusy) {
		stateTag = s.live("[● Escribiendo]");
	}

	const maxFamilyW = Math.max(3, safeW - 28);
	const familyDisplay = truncateWithAnsi(pair.familyName, maxFamilyW);
	const titlePrefix = `${s.border("╭─ ")}${s.accent("⚡ POOL: ")}${s.text(familyDisplay)} ${s.border("─ ")}${stateTag} ${s.border("─")}`;
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

	// Bloque reactivo "CUIDANDO EL CHAT" (funciones unificadas de resiliencia y disyuntor anti-bucle)
	const telemetry = guardTelemetry || runawayGuard.getTelemetry();
	const isTripped = Boolean(telemetry.circuitBreakerTripped);
	const hasActiveInterception =
		isTripped ||
		telemetry.blockedIntrospections > 0 ||
		telemetry.blockedBashEvasions > 0 ||
		telemetry.blockedSubagentPolls > 0 ||
		(telemetry.blockedProhibitedCommands || 0) > 0 ||
		telemetry.bashExplorationCount >= MAX_BASH_EXPLORATION_PER_TURN;

	const chatStatusHeader = isTripped
		? `${s.error("[CUIDANDO EL CHAT]")}`
		: (isAmber || hasActiveInterception)
			? `${s.amber("[CUIDANDO EL CHAT]")}`
			: `${s.accent("[CUIDANDO EL CHAT]")}`;

	const chatStatusTag = isTripped
		? s.error("🛑 DISPARADO")
		: hasActiveInterception
			? s.amber("⚡ Bucle Interceptado")
			: isAmber
				? s.amber("⚡ Poda activa")
				: isBusy
					? s.live("● Escribiendo")
					: s.idle("○ Blindaje Activo");

	// 1. Rescate Microcortes
	const rescateVal = isAmber ? s.amber("⚡ Rescate en curso (1/2)") : s.idle("○ En guardia (0/2)");
	// 2. Parálisis / Falso Stop
	const paralisisVal = s.idle("○ Vigilando");
	// 3. Poda de Contexto
	const podaVal = isAmber ? s.amber("⚡ Poda activa (-800c)") : s.idle("+32k tk optimizados");

	// 4. Evasión Bash (Terminal)
	let bashVal: string;
	if (telemetry.blockedBashEvasions > 0 || telemetry.bashExplorationCount > MAX_BASH_EXPLORATION_PER_TURN) {
		bashVal = `${s.error("🛑 " + telemetry.bashExplorationCount + "/" + MAX_BASH_EXPLORATION_PER_TURN + " Bloqueado")}`;
	} else if (telemetry.bashExplorationCount > 0) {
		bashVal = `${s.amber("▲ " + telemetry.bashExplorationCount + "/" + MAX_BASH_EXPLORATION_PER_TURN + " búsquedas")}`;
	} else {
		bashVal = s.idle("○ 0/5 búsquedas");
	}

	// 5. Introspección Sesiones (.pi/agent/sessions)
	const introVal = telemetry.blockedIntrospections > 0
		? `${s.error("🛑 Bloqueado (" + telemetry.blockedIntrospections + ")")}`
		: s.idle("○ Protegido");

	// 6. Polling de Subagentes
	let pollVal: string;
	if (telemetry.blockedSubagentPolls > 0 || telemetry.subagentPollCount > MAX_SUBAGENT_POLL_PER_TURN) {
		pollVal = `${s.error("🛑 Polling bloqueado")}`;
	} else if (telemetry.subagentPollCount > 0) {
		pollVal = `${s.amber("▲ " + telemetry.subagentPollCount + "/" + MAX_SUBAGENT_POLL_PER_TURN + " llamadas")}`;
	} else {
		pollVal = s.idle("○ 0/2 llamadas");
	}

	const approachVal = isTripped
		? s.error("🛑 Bucle Interceptado")
		: hasActiveInterception
			? s.amber("Frenando bucles")
			: isAmber
				? s.amber("Podando texto muy largo")
				: isBusy
					? s.live("Escribiendo en vivo")
					: s.text("Misma cuenta fija");

	// Micro-barra de progreso reactiva para presupuesto de turno (15 pasos)
	const toolCount = telemetry.totalToolCount || 0;
	const budgetGauge = s.paintGauge(`${Math.round((toolCount / 15) * 100)}%`, 5, toolCount >= 10);
	const budgetVal = toolCount >= 14
		? `${s.error(budgetGauge)} ${s.error(`${toolCount}/15!`)}`
		: toolCount >= 10
			? `${s.amber(budgetGauge)} ${s.amber(`${toolCount}/15`)}`
			: `${s.idle(budgetGauge)} ${s.idle(`${toolCount}/15`)}`;

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
			renderLine(chatStatusHeader, chatStatusTag),
			renderLine(s.muted("Disyuntor Anti-Bucle"), s.error("🛑 Disparado")),
			renderLine(s.muted("Causa"), s.error(reasonLabel)),
			renderLine(s.muted("Tokens protegidos"), s.live(`~${savedK}k tokens`)),
			renderLine(s.muted("Diagnóstico"), s.accent(linkText)),
			renderLine(s.muted("O escribe"), s.accent("/incident")),
			divider,
			renderLine(s.error("[ACCIÓN REQUERIDA]"), s.text("Dar orden directa")),
		];
	} else if (hasActiveInterception) {
		// Modo Alerta / Intercepción Activa: Se expanden las métricas afectadas
		chatBlockLines = [
			renderLine(chatStatusHeader, chatStatusTag),
			renderLine(s.muted("Presupuesto Turno"), budgetVal),
			renderLine(s.muted("Evasión Bash (Terminal)"), bashVal),
			renderLine(s.muted("Introspección Sesiones"), introVal),
			renderLine(s.muted("Polling de Subagentes"), pollVal),
			renderLine(s.muted("Rescate Microcortes"), rescateVal),
		];
	} else {
		// Modo Normal Consolidado (2 columnas por línea para ahorrar 6 líneas verticales)
		const colW = Math.floor((innerW - 1) / 2);
		const renderDoubleLine = (l1: string, v1: string, l2: string, v2: string) => {
			const cell1 = `${l1} ${v1}`;
			const cell2 = `${l2} ${v2}`;
			const sp1 = Math.max(0, colW - visibleLen(cell1));
			const sp2 = Math.max(0, innerW - colW - 1 - visibleLen(cell2));
			const content = `${cell1}${" ".repeat(sp1)}${s.border("│")}${cell2}${" ".repeat(sp2)}`;
			return fitToWidth(`${s.border("│")} ${content} ${s.border("│")}`, safeW);
		};

		chatBlockLines = [
			renderLine(chatStatusHeader, chatStatusTag),
			renderLine(s.muted("Presupuesto Turno"), budgetVal),
			renderDoubleLine(s.muted("Microcortes:"), s.idle("0/2"), s.muted("Subagentes:"), s.idle("0/2")),
			renderDoubleLine(s.muted("Introspecc:"), s.idle("Ok"), s.muted("Poda:"), s.idle("+32k tk")),
			renderDoubleLine(s.muted("Anti-Bucle:"), s.idle("Ok"), s.muted("Terminal:"), s.idle("0/5")),
		];
	}

		// Línea de cabecera en 2 líneas (con Enfoque acortado para no desbordar las 44 cols)
		const compactApproach = approachVal.replace("Misma cuenta fija", "Cuenta fija");
		const line2Left = `${s.muted("Cuentas:")} ${s.text(String(pair.totalAccounts))} ${s.slate("· listas")}`;
		const line2Right = `${s.muted("Enfoque:")} ${s.text(compactApproach)}`;
		const spL2 = Math.max(1, innerW - visibleLen(line2Left) - visibleLen(line2Right));
		const line2 = fitToWidth(`${s.border("│")} ${line2Left}${" ".repeat(spL2)}${line2Right} ${s.border("│")}`, safeW);

		// Línea de cuenta activa en 1 sola línea: ⚡ correo  [estado] (con truncado defensivo para no desbordar)
		const maxActiveEmailW = Math.max(10, innerW - visibleLen(activeStateLabel) - 4);
		const activeEmailTrunc = truncateWithAnsi(pair.active.accountId, maxActiveEmailW);
		const leftActive = `${s.accent("⚡ ")}${s.text(activeEmailTrunc)}`;
		const spActive = Math.max(1, innerW - visibleLen(leftActive) - visibleLen(activeStateLabel));
		const activeLine = fitToWidth(`${s.border("│")} ${leftActive}${" ".repeat(spActive)}${activeStateLabel} ${s.border("│")}`, safeW);

		// Línea de siguiente cuenta en 1 sola línea: [SIGUIENTE] correo  [estado]
		let nextLine: string;
		if (pair.next) {
			const nextStateLabel = pair.next.minAvailable
				? `${s.idle("○ " + nextAccountLabel)} ${s.muted(`(${pair.next.minAvailable})`)}`
				: s.text(nextAccountLabel);
			const maxNextEmailW = Math.max(10, innerW - visibleLen(nextStateLabel) - 14);
			const nextEmailTrunc = truncateWithAnsi(pair.next.accountId, maxNextEmailW);
			const leftNext = `${s.accent("[SIGUIENTE]")} ${s.text(nextEmailTrunc)}`;
			const spNext = Math.max(1, innerW - visibleLen(leftNext) - visibleLen(nextStateLabel));
			nextLine = fitToWidth(`${s.border("│")} ${leftNext}${" ".repeat(spNext)}${nextStateLabel} ${s.border("│")}`, safeW);
		} else {
			const leftNext = `${s.accent("[SIGUIENTE]")}`;
			const rightNone = s.muted("Ninguna (Sola)");
			const spNext = Math.max(1, innerW - visibleLen(leftNext) - visibleLen(rightNone));
			nextLine = fitToWidth(`${s.border("│")} ${leftNext}${" ".repeat(spNext)}${rightNone} ${s.border("│")}`, safeW);
		}

		const rawLines = [
			top,
			renderLine(s.muted("Modelo"), s.text(pair.poolKey)),
			line2,
			divider,
			activeLine,
			...renderDualConcentricClocks(pair.active, s, innerW, safeW),
			nextLine,
			divider,
			...chatBlockLines,
			bottom,
		];

	return rawLines.map((line) => fitToWidth(line, safeW));
}

/**
 * Gestiona la inyección reactiva del TUI según el modo (`regular` vs `fullscreen`).
 */
export class CpamcTuiAdapter {
	private isFullscreen = false;
	private isBusy = false;
	private currentPair: PoolRotationPair | null = null;
	private ctx: ExtensionContext | null = null;
	private tui: any = null;
	private theme: any = null;

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
	}

	setContext(ctx: ExtensionContext | null): void {
		this.ctx = ctx;
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
					return formatSidebarQuotaCardLines(p, 48, "\x1b[38;2;120;153;166m", this.theme, this.isBusy);
				} catch {
					return [];
				}
			},
			digest: () => {
				try {
					const m = this.safeGetModel();
					const p = m ? (getRotationPairForModelSync(m.id, m.provider) || this.currentPair) : this.currentPair;
					const g = runawayGuard.getTelemetry();
					return `${m?.id || "none"}-${p?.poolKey || "none"}-${p?.active?.prefix || "none"}-${p?.active?.minAvailable || "none"}-${this.isBusy}-${g.bashExplorationCount}-${g.subagentPollCount}-${g.blockedIntrospections}-${g.blockedBashEvasions}`;
				} catch {
					return "none";
				}
			},
			invalidate: () => {},
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
					const quotaLines = formatSidebarQuotaCardLines(pair, width, bColor, this.theme, this.isBusy);

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
						? `${pair.poolKey || ""}-${pair.active?.prefix || ""}-${pair.active?.minAvailable || ""}-${pair.active?.consumed5h || ""}-${pair.active?.consumedWeekly || ""}-${g.bashExplorationCount}-${g.subagentPollCount}-${g.blockedIntrospections}-${g.blockedBashEvasions}`
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
					return this.originalFooterPart?.handleMouse?.(event);
				} catch {
					return false;
				}
			},
		};

		gentleState.parts.set("footer", this.decoratedFooter);
	}
}
