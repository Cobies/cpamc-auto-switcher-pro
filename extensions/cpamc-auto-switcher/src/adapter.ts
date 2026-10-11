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

	const icon = isBusy ? `${PLAY_COLOR}▶${RESET}` : `${PAUSE_COLOR}⏸${RESET}`;
	const pActiveColor = pctColor(pair.active.minAvailable);
	const activePart = `${icon} ${LEADER_COLOR}${pair.active.prefix}${RESET} ${pActiveColor}${pair.active.minAvailable}${RESET}`;

	if (!pair.next) {
		return `${SEP} ${activePart}`;
	}

	const nextIcon = `\x1b[38;2;157;124;216m⏭${RESET}`;
	const pNextColor = pctColor(pair.next.minAvailable);
	const nextPart = `${nextIcon} ${NEXT_COLOR}${pair.next.prefix}${RESET} ${pNextColor}${pair.next.minAvailable}${RESET}`;

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
	const safeW = Math.max(34, width);
	const s = createThemeStyler(theme, borderColor);

	if (!pair) {
		const top = `${s.border("╭─ ")}${s.accent("⚡ CPAMC AUTO-SWITCHER ")}${s.border("─".repeat(Math.max(1, safeW - 27)) + "╮")}`;
		const bot = s.border("╰" + "─".repeat(safeW - 2) + "╯");
		return [
			top,
			`${s.border("│")} ${s.muted("Sin modelo con rotación activo")}${" ".repeat(Math.max(1, safeW - 35))}${s.border("│")}`,
			bot,
		];
	}

	const innerW = safeW - 4;
	const renderLine = (label: string, val: string) => {
		const totalLen = visibleLen(label) + visibleLen(val);
		const space = Math.max(1, innerW - totalLen);
		return `${s.border("│")} ${label}${" ".repeat(space)}${val} ${s.border("│")}`;
	};

	const divider = s.border("├" + "─".repeat(safeW - 2) + "┤");
	const bar5h = s.paintGauge(pair.active.consumed5h, 6);
	const barWk = s.paintGauge(pair.active.consumedWeekly, 6);

	const titlePrefix = `${s.border("╭─ ")}${s.accent("⚡ CPAMC POOL: ")}${s.text(pair.poolKey)} ${s.border("─")}`;
	const prefixLen = visibleLen(titlePrefix);
	const titleRules = Math.max(1, safeW - prefixLen - 1);
	const top = `${titlePrefix}${s.border("─".repeat(titleRules) + "╮")}`;
	const bottom = s.border("╰" + "─".repeat(safeW - 2) + "╯");

	return [
		top,
		renderLine(s.muted("Familia"), `${pair.familyIcon}${s.text(pair.familyName)}`),
		renderLine(s.muted("Cuentas en Pool"), s.text(String(pair.totalAccounts))),
		divider,
		renderLine(s.accent("[LÍDER ACTIVA]"), `${s.text(pair.active.prefix)} ${s.muted(`(${pair.active.minAvailable})`)}`),
		renderLine(s.muted(`5h: ${pair.active.consumed5h}`), bar5h),
		renderLine(s.muted(`Sem: ${pair.active.consumedWeekly}`), barWk),
		divider,
		renderLine(
			s.accent("[SIGUIENTE EN COLA]"),
			pair.next ? `${s.text(pair.next.prefix)} ${s.muted(`(${pair.next.minAvailable})`)}` : s.muted("Ninguna (Pool único)"),
		),
		bottom,
	];
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

			// Detección de modo TUI:
			// 1. Symbol global de Gentle
			// 2. Variable host.mode o settings
			const tui = this.tui || (this.ctx as any)?.tui;
			const terminal = tui?.terminal as any;
			const gentleState = terminal?.[Symbol.for("gentle-pi.experimental-sidebar.state")];

			this.isFullscreen = Boolean(gentleState?.active || terminal?.fullscreen || process.env.PI_TUI_MODE === "fullscreen");

			if (gentleState?.parts) {
				// Inyectar en Sidebar de Gentle
				this.injectIntoSidebar(gentleState);
				tui?.requestRender?.();
			} else {
				// Inyectar en Footer
				this.injectIntoFooter(isBusy);
			}
		} catch {
			// Silenciar fallos secundarios en segundo plano
		}
	}

	private injectIntoFooter(isBusy: boolean): void {
		const block = formatFooterRotationBlock(this.currentPair, isBusy);
		if (!block) return;

		// Si j0k3r-theme está presente con setQuota
		const footer = (this.ctx as any)?.footer;
		if (typeof footer?.setQuota === "function") {
			footer.setQuota(block);
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

				const cardWidth = Math.max(34, width);
				const bColor = extractBorderColor(baseLines, this.theme);
				const quotaLines = formatSidebarQuotaCardLines(pair, cardWidth, bColor, this.theme);

				if (!baseLines.length) {
					return quotaLines;
				}

				return [...baseLines, "", ...quotaLines];
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
