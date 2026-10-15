import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getRotationPairForModel, getRotationPairForModelSync, type PoolRotationPair } from "./store.js";

// Colores ANSI suaves compatibles con temas oscuros y claros (Cyber-Pastel)
const RESET = "\x1b[0m";
const SEP = "\x1b[38;2;138;78;158m│\x1b[0m";
const PLAY_COLOR = "\x1b[38;2;123;200;143m"; // Verde menta
const PAUSE_COLOR = "\x1b[38;2;120;153;166m"; // Gris suave
const LEADER_COLOR = "\x1b[1;38;2;92;184;199m"; // Cian suave negrita
const NEXT_COLOR = "\x1b[1;38;2;222;116;155m"; // Rosa coral suave negrita
const MUTED = "\x1b[38;2;120;153;166m";

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX, "");
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
export function formatFooterRotationBlock(pair: PoolRotationPair | null, isBusy = false): string {
	if (!pair) return "";

	if (pair.isNativeReadOnly) {
		const pActiveColor = pctColor(pair.active.minAvailable);
		const activeLabel = pair.active.prefix || pair.active.accountId;
		const hInfo = pair.active.consumed5h ? `${pair.active.consumed5h}` : "";
		const wInfo = pair.active.consumedWeekly ? `${pair.active.consumedWeekly}` : "";
		const cd = [hInfo, wInfo].filter(Boolean).join("/");
		const cdStr = cd ? ` ↻ ${cd}` : "";
		return `${SEP} ⚡ ${LEADER_COLOR}${activeLabel}${RESET} ${pActiveColor}${pair.active.minAvailable}${RESET}${MUTED}${cdStr}${RESET}`;
	}

	const icon = isBusy ? `${PLAY_COLOR}▶${RESET}` : `${PAUSE_COLOR}⏸${RESET}`;
	const pActiveColor = pctColor(pair.active.minAvailable);
	const activeLabel = pair.active.prefix || pair.active.accountId;
	const activePart = `${icon} ${LEADER_COLOR}${activeLabel}${RESET} ${pActiveColor}${pair.active.minAvailable}${RESET}`;

	if (!pair.next) {
		return `${SEP} ${activePart}`;
	}

	const nextIcon = `\x1b[38;2;157;124;216m⏭${RESET}`;
	const pNextColor = pctColor(pair.next.minAvailable);
	const nextLabel = pair.next.prefix || pair.next.accountId;
	const nextPart = `${nextIcon} ${NEXT_COLOR}${nextLabel}${RESET} ${pNextColor}${pair.next.minAvailable}${RESET}`;

	return `${SEP} ${activePart} ${SEP} ${nextPart}`;
}

function visibleLen(str: string): number {
	const clean = str.replace(/\x1b\[[0-9;]*m/g, "");
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
	paintGauge(percentStr: string, cells?: number): string;
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
				return `\x1b[38;2;222;116;155m${t}${RESET}`;
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
		paintGauge: (percentStr: string, cells = 6) => {
			const num = Number.parseFloat(percentStr.replace("%", "").trim()) || 0;
			const filled = Math.min(cells, Math.max(0, Math.round((num / 100) * cells)));
			const empty = cells - filled;
			const tone = num >= 95 ? "error" : num >= 80 ? "warning" : "accent";
			return fg(tone, "▰".repeat(filled)) + fg("border", "▱".repeat(empty));
		},
	};
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
): string[] {
	if (width < 20) {
		// Modo ultra-compacto si el ancho disponible es extremadamente pequeño
		if (!pair) return [truncateWithAnsi("⚡ Sin pool activo", width)];
		const activeLabel = pair.active.prefix || pair.active.accountId;
		return [truncateWithAnsi(`⚡ ${pair.poolKey}: ${activeLabel} (${pair.active.minAvailable})`, width)];
	}

	const safeW = width;
	const s = createThemeStyler(theme, borderColor);

	if (!pair) {
		const titleStr = truncateWithAnsi("⚡ CPAMC AUTO-SWITCHER", Math.max(1, safeW - 6));
		const titlePrefix = `${s.border("╭─ ")}${s.accent(titleStr)} ${s.border("─")}`;
		const prefixLen = visibleLen(titlePrefix);
		const titleRules = Math.max(1, safeW - prefixLen - 1);
		const top = `${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`;
		const bot = s.border("╰" + "─".repeat(safeW - 2) + "╯");
		const msg = truncateWithAnsi("Sin modelo con rotación activo", Math.max(1, safeW - 4));
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
	const bar5h = s.paintGauge(pair.active.consumed5h, 6);
	const barWk = s.paintGauge(pair.active.consumedWeekly, 6);

	if (pair.isNativeReadOnly) {
		const maxTitleW = Math.max(3, safeW - 22);
		const titleLabel = truncateWithAnsi(pair.poolKey, maxTitleW);
		const titlePrefix = `${s.border("╭─ ")}${s.accent("⚡ CPAMC DIRECTO: ")}${s.text(titleLabel)} ${s.border("─")}`;
		const prefixLen = visibleLen(titlePrefix);
		const titleRules = Math.max(1, safeW - prefixLen - 1);
		const top = fitToWidth(`${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`, safeW);
		const bottom = fitToWidth(s.border("╰" + "─".repeat(Math.max(1, safeW - 2)) + "╯"), safeW);
		const activeAccountLabel = pair.active.prefix || pair.active.accountId;

		const rawLines = [
			top,
			renderLine(s.muted("Modelo"), s.text(pair.poolKey)),
			renderLine(s.muted("Cuenta"), s.text(activeAccountLabel)),
			renderLine(s.muted("Conexión"), s.muted("Directa (Cuenta Nativa)")),
			divider,
			renderLine(s.accent("[ESTADO CUOTA]"), `${s.text(activeAccountLabel)} ${s.muted(`(${pair.active.minAvailable})`)}`),
			renderLine(s.muted(`5h: ${pair.active.consumed5h}`), bar5h),
			renderLine(s.muted(`Sem: ${pair.active.consumedWeekly}`), barWk),
			bottom,
		];
		return rawLines.map((line) => fitToWidth(line, safeW));
	}

	const maxPoolKeyW = Math.max(3, safeW - 24);
	const poolKeyLabel = truncateWithAnsi(pair.poolKey, maxPoolKeyW);
	const titlePrefix = `${s.border("╭─ ")}${s.accent("⚡ CPAMC POOL: ")}${s.text(poolKeyLabel)} ${s.border("─")}`;
	const prefixLen = visibleLen(titlePrefix);
	const titleRules = Math.max(1, safeW - prefixLen - 1);
	const top = fitToWidth(`${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`, safeW);
	const bottom = fitToWidth(s.border("╰" + "─".repeat(Math.max(1, safeW - 2)) + "╯"), safeW);

	const activeAccountLabel = pair.active.prefix || pair.active.accountId;
	const nextAccountLabel = pair.next ? (pair.next.prefix || pair.next.accountId) : "";

	const rawLines = [
		top,
		renderLine(s.muted("Familia"), `${pair.familyIcon}${s.text(pair.familyName)}`),
		renderLine(s.muted("Cuentas en Pool"), s.text(String(pair.totalAccounts))),
		divider,
		renderLine(s.accent("[LÍDER ACTIVA]"), `${s.text(activeAccountLabel)} ${s.muted(`(${pair.active.minAvailable})`)}`),
		renderLine(s.muted(`5h: ${pair.active.consumed5h}`), bar5h),
		renderLine(s.muted(`Sem: ${pair.active.consumedWeekly}`), barWk),
		divider,
		renderLine(
			s.accent("[SIGUIENTE EN COLA]"),
			pair.next ? `${s.text(nextAccountLabel)} ${s.muted(`(${pair.next.minAvailable})`)}` : s.muted("Ninguna (Pool único)"),
		),
		bottom,
	];

	return rawLines.map((line) => fitToWidth(line, safeW));
}

/**
 * Gestiona la inyección reactiva del TUI según el modo (`regular` vs `fullscreen`).
 */
export class CpamcTuiAdapter {
	private isFullscreen = false;
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

	async update(isBusy = false, freshCtx?: ExtensionContext): Promise<void> {
		if (freshCtx) {
			this.ctx = freshCtx;
		}
		if (!this.ctx) return;

		let model: any = null;
		try {
			model = this.ctx.model;
		} catch {
			// Context is stale or invalidated after session replacement/reload.
			// Invalidate local reference safely without throwing uncaughtException.
			this.ctx = null;
			this.currentPair = null;
			return;
		}

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

	private injectIntoFooter(isBusy: boolean): void {
		const block = formatFooterRotationBlock(this.currentPair, isBusy);
		const tui = this.tui || (this.ctx as any)?.tui;
		const terminal = tui?.terminal as any;
		const footer = (this.ctx as any)?.footer || terminal?.[Symbol.for("j0k3r-theme.footer")];

		if (typeof footer?.setQuota === "function") {
			footer.setQuota(block || undefined);
		}
	}

	private originalFooterPart: any = null;
	private decoratedFooter: any = null;

	private injectIntoSidebar(gentleState: any): void {
		const currentModel = this.ctx?.model;
		const initialPair = currentModel
			? (getRotationPairForModelSync(currentModel.id, currentModel.provider) || this.currentPair)
			: this.currentPair;

		gentleState.parts.set("cpamc-quota-card", {
			render: () => {
				const m = this.ctx?.model;
				const p = m ? (getRotationPairForModelSync(m.id, m.provider) || this.currentPair) : this.currentPair;
				return formatSidebarQuotaCardLines(p);
			},
			digest: () => {
				const m = this.ctx?.model;
				const p = m ? (getRotationPairForModelSync(m.id, m.provider) || this.currentPair) : this.currentPair;
				return `${m?.id}-${p?.poolKey}-${p?.active.prefix}-${p?.active.minAvailable}`;
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
				const baseLines = this.originalFooterPart?.render
					? (this.originalFooterPart.render(width) ?? [])
					: [];

				const model = this.ctx?.model;
				const pair = model
					? (getRotationPairForModelSync(model.id, model.provider) || this.currentPair)
					: this.currentPair;

				if (!pair) {
					return baseLines;
				}

				const bColor = extractBorderColor(baseLines, this.theme);
				const quotaLines = formatSidebarQuotaCardLines(pair, width, bColor, this.theme);

				if (!baseLines.length) {
					return quotaLines;
				}

				return [...baseLines, "", ...quotaLines].map((line) => fitToWidth(line, width));
			},
			digest: () => {
				const baseDigest = this.originalFooterPart?.digest
					? this.originalFooterPart.digest()
					: "";

				const model = this.ctx?.model;
				const modelKey = model ? `${model.provider}:${model.id}` : "none";
				const pair = model
					? (getRotationPairForModelSync(model.id, model.provider) || this.currentPair)
					: this.currentPair;

				const cpamcDigest = pair
					? `${pair.poolKey}-${pair.active.prefix}-${pair.active.minAvailable}-${pair.active.consumed5h}-${pair.active.consumedWeekly}`
					: "none";

				return `${baseDigest}::m::${modelKey}::c::${cpamcDigest}`;
			},
			invalidate: () => {
				this.originalFooterPart?.invalidate?.();
			},
			handleMouse: (event: any) => {
				return this.originalFooterPart?.handleMouse?.(event);
			},
		};

		gentleState.parts.set("footer", this.decoratedFooter);
	}
}
