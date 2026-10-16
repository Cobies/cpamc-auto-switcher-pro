import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initDynamicProvider } from "./src/provider.js";
import { initFailoverHook, scheduleAutoSwitcher } from "./src/failover.js";
import { registerModelPicker } from "./src/picker.js";
import { CpamcTuiAdapter } from "./src/adapter.js";
import { querySwitcherAccounts, checkProactivePoolRebalance } from "./src/store.js";
import { saveProjectModel, getProjectModel, clearProjectModel } from "./src/project-model-store.js";

/**
 * CPAMC Auto-Switcher Unified Extension for Pi & Gentle-Shell
 *
 * Módulos integrados:
 * 1. Dynamic Provider: Registra el proveedor `cpamc` con catálogo dinámico de CLIProxyAPI.
 * 2. Failover Hook: Detección instantánea de 429 / Rate Limit y rotación forzada automática.
 * 3. Runtime UI & Telemetry:
 *    - Fullscreen Sidebar: QuotaCard reactiva calibrada a 36 cols con barras (▰▰▰▱▱▱).
 *    - Regular Mode: Telemetría compacta en Footer.
 *    - Selector interactivo de modelos `/cpamc-model`.
 *
 * 100% Autocontenida: lista para clonar o copiar en ~/.gentle-shell/agent/extensions/
 */
export default function initCpamcUnifiedExtension(pi: ExtensionAPI): void {
	// 1. Inicializar proveedor dinámico de modelos
	try {
		initDynamicProvider(pi);
	} catch (err: any) {
		console.error("cpamc-auto-switcher: fallo al registrar provider cpamc:", err?.message || err);
	}

	// 2. Inicializar hook de failover y rotación automática
	try {
		initFailoverHook(pi);
	} catch (err: any) {
		console.error("cpamc-auto-switcher: fallo al registrar failover hook:", err?.message || err);
	}

	// 3. Inicializar selector complementario /cpamc-model
	registerModelPicker(pi);

	// 3b. Comando para restablecer el modelo del proyecto actual al default de Pi
	pi.registerCommand("model-default", {
		description: "Restablece el modelo del proyecto actual al default configurado en Pi",
		handler: async (_args, ctx) => {
			if (ctx.cwd) {
				clearProjectModel(ctx.cwd);
			}
			const settings = (ctx as any)?.settingsManager;
			const defaultProvider = settings?.getDefaultProvider?.() || "cpamc";
			const defaultModelId = settings?.getDefaultModel?.();
			if (defaultProvider && defaultModelId) {
				const target = ctx.modelRegistry?.find?.(defaultProvider, defaultModelId);
				if (target) {
					await pi.setModel(target);
					if (ctx.hasUI) {
						ctx.ui.notify?.(`✅ Modelo restablecido al default de Pi: ${defaultModelId}`, "info");
					}
					return;
				}
			}
			if (ctx.hasUI) {
				ctx.ui.notify?.("✅ Memoria de sesión restablecida para este proyecto.", "info");
			}
		},
	});

	// 4. Adaptador reactivo de UI (Sidebar QuotaCard + Footer)
	let adapter: CpamcTuiAdapter | null = null;
	let timer: NodeJS.Timeout | null = null;

	const clearTimer = (): void => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	pi.on("session_start", async (event: any, ctx: ExtensionContext) => {
		clearTimer();

		if (!adapter) {
			adapter = new CpamcTuiAdapter(ctx);
		} else {
			adapter.setContext(ctx);
		}

		// Rebalanceo proactivo en fronteras de ciclo de vida (/new, /reload, inicio de sesión)
		const reason = event?.reason;
		if (reason === "compact" && ctx?.hasUI) {
			ctx.ui.notify?.("✅ Contexto de sesión compactado y reanudado.", "info");
		}

		// Detección de reanudación de sesión en Herdr (snapshot previo restaurado)
		const isResumedSession =
			reason === "resume" || (reason === "startup" && (ctx.sessionManager?.getEntries?.()?.length ?? 0) > 0);
		if (isResumedSession) {
			if (ctx.cwd && ctx.model?.id && ctx.model?.provider) {
				saveProjectModel(ctx.cwd, ctx.model.provider, ctx.model.id);
			}
			if (ctx?.hasUI) {
				ctx.ui.notify?.(
					`ℹ️ Sesión previa de Herdr reanudada (${ctx.model?.id || "modelo de sesión"}). Usa /new para sesión limpia.`,
					"info",
				);
			}
		}

		// Restauración dinámica del modelo del proyecto al reiniciar sesión (/new)
		// Solo aplica en caliente durante la sesión activa en Herdr.
		// En arranque en frío (startup) siempre se inicia con el modelo default de Pi.
		if (reason === "new" && ctx.cwd) {
			try {
				const saved = getProjectModel(ctx.cwd);
				if (saved && (ctx.model?.id !== saved.modelId || ctx.model?.provider !== saved.provider)) {
					let targetModel = ctx.modelRegistry?.find?.(saved.provider, saved.modelId);
					// Contingencia cold boot: si no está en memoria y refresh está disponible, refrescar catálogo
					if (!targetModel && typeof ctx.modelRegistry?.refresh === "function") {
						await ctx.modelRegistry.refresh({ allowNetwork: true }).catch(() => {});
						targetModel = ctx.modelRegistry?.find?.(saved.provider, saved.modelId);
					}

					if (targetModel) {
						await pi.setModel(targetModel);
						if (ctx.hasUI) {
							ctx.ui.notify?.(`ℹ️ Manteniendo modelo de sesión: ${targetModel.id}`, "info");
						}
					} else if (saved && ctx.hasUI) {
						// Notificación informativa no invasiva si el modelo o pool guardado fue disuelto
						ctx.ui.notify?.(
							`⚠️ Modelo del proyecto (${saved.provider}/${saved.modelId}) no disponible. Usando default.`,
							"warning",
						);
					}
				} else if (saved && ctx.model?.id === saved.modelId) {
					// El modelo activo ya coincide con el modelo recordado de la sesión
					if (ctx.hasUI && ctx.model) {
						ctx.ui.notify?.(`ℹ️ Manteniendo modelo de sesión: ${ctx.model.id}`, "info");
					}
				} else if (ctx.hasUI && ctx.model) {
					ctx.ui.notify?.(`ℹ️ Sesión iniciada con modelo default: ${ctx.model.id}`, "info");
				}
			} catch {
				// Silencioso ante fallos al restaurar modelo de proyecto
			}
		}

		if (reason === "new" || reason === "reload" || reason === "startup") {
			try {
				await querySwitcherAccounts(true);
				const model = ctx.model;
				if (model) {
					const check = checkProactivePoolRebalance(model.id, model.provider);
					if (check.shouldSwitch) {
						scheduleAutoSwitcher(ctx, `proactive session rebalance (${reason})`, true);
					}
				}
			} catch {
				// Silencioso ante errores no críticos
			}
		}

		// Capturar la instancia viva de TUI y Theme, y registrar el decorador del sidebar
		if (ctx.hasUI) {
			ctx.ui.setWidget("cpamc-tui-hook", (tui: any, theme: any) => {
				adapter?.bindTui(tui, theme);
				void adapter?.update(false, ctx);
				return {
					render: () => [],
					invalidate: () => {},
				};
			});
		}

		// Actualización inicial segura
		await adapter.update(false, ctx);

		// Intervalo en segundo plano cada 25s protegido contra stale context
		let ticks = 0;
		timer = setInterval(async () => {
			try {
				await querySwitcherAccounts(true);
				await adapter?.update(false);

				// Cada ~75 segundos (3 ticks de 25s), refrescar catálogo de modelos en segundo plano
				ticks++;
				if (ticks % 3 === 0 && typeof ctx.modelRegistry?.refresh === "function") {
					void ctx.modelRegistry.refresh({ allowNetwork: true }).catch(() => {});
				}
			} catch {
				clearTimer();
			}
		}, 25_000);
	});

	// Reactividad ante eventos de sesión e interacción del usuario
	pi.on("session_info_changed", async (_event: any, ctx: ExtensionContext) => {
		await adapter?.update(false, ctx);
	});

	pi.on("ui_prompt_start", async (_event: any, ctx: ExtensionContext) => {
		await adapter?.update(false, ctx);
	});

	pi.on("turn_start", async (_event: any, ctx: ExtensionContext) => {
		await adapter?.update(true, ctx);
	});

	pi.on("turn_end", async (_event: any, ctx: ExtensionContext) => {
		// Mantener siempre actualizado el modelo con el que el usuario está trabajando activamente
		if (ctx.cwd && ctx.model?.id && ctx.model?.provider) {
			saveProjectModel(ctx.cwd, ctx.model.provider, ctx.model.id);
		}
		await adapter?.update(false, ctx);
	});

	// Persistir automáticamente el último modelo seleccionado por proyecto
	pi.on("model_select", async (event: any, ctx: ExtensionContext) => {
		const cwd = ctx.cwd;
		const model = event?.model;
		if (cwd && model?.id && model?.provider) {
			saveProjectModel(cwd, model.provider, model.id);
		}
		await adapter?.update(false, ctx);
	});

	// Limpieza en transiciones de sesión de Pi
	pi.on("session_before_switch", async (event: any, ctx?: ExtensionContext) => {
		clearTimer();
		// Capturar y registrar el modelo activo antes de que la sesión sea sustituida (/new o switch)
		if (event?.reason === "new" && ctx?.cwd && ctx?.model?.id && ctx?.model?.provider) {
			saveProjectModel(ctx.cwd, ctx.model.provider, ctx.model.id);
		}
		adapter?.setContext(null);
	});

	pi.on("session_before_fork", async () => {
		clearTimer();
		adapter?.setContext(null);
	});

	pi.on("session_before_compact", async (_event: any, ctx?: ExtensionContext) => {
		clearTimer();
		adapter?.setContext(null);
		try {
			if (ctx?.hasUI) {
				ctx.ui.notify?.("⚡ Optimizando contexto de sesión (compactación en curso)...", "info");
			}
		} catch {
			// Silencioso
		}
	});

	pi.on("session_before_tree", async () => {
		clearTimer();
		adapter?.setContext(null);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
		adapter?.setContext(null);
	});
}
