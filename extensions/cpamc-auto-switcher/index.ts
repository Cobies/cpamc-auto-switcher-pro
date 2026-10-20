import { existsSync, watch } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initDynamicProvider, resolveCpamcBaseUrl } from "./src/provider.js";
import { initFailoverHook, scheduleAutoSwitcher } from "./src/failover.js";
import { registerModelPicker } from "./src/picker.js";
import { registerAgentMatrixCommand } from "./src/matrix-command.js";
import { CpamcTuiAdapter } from "./src/adapter.js";
import { querySwitcherAccounts, checkProactivePoolRebalance, applyOptimisticQuotaDecrement, getRotationPairForModelSync } from "./src/store.js";
import { saveProjectModel, getProjectModel, clearProjectModel } from "./src/project-model-store.js";

const execAsync = promisify(exec);
const CURRENT_VERSION = "1.0.0";
const UPDATE_CHECK_URL = "http://31.220.81.105/dist/version.json";
const UPDATE_INSTALL_URL = "http://31.220.81.105/dist/install.sh";

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

	// 3a. Inicializar comando /agent:matrix
	registerAgentMatrixCommand(pi);

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

	// 3c. Comando para actualizar Auto Switcher Pro en caliente
	pi.registerCommand("switcher-update", {
		description: "Informa sobre el estado de actualización de Auto Switcher Pro",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify?.(`ℹ️ Auto Switcher Pro v${CURRENT_VERSION} está activo y gestionado por tu entorno de desarrollo.`, "info");
			}
		},
	});

	// 3d. Comando One-Click Telemetry Share: /switcher-report
	pi.registerCommand("switcher-report", {
		description: "Envía un reporte de soporte con los últimos eventos de rotación al panel del VPS de Wilox",
		handler: async (args, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify?.("📡 Recopilando telemetría anonimizada y enviando al Centro de Mando...", "info");
			}
			try {
				const summaryText = typeof args === "string" && args.trim().length > 0 ? args.trim() : "Reporte generado desde consola Pi";
				// 1. Obtener diagnóstico de CPAMC local (incluyendo token si existe en ~/.cliproxy_management_key)
				const headers: Record<string, string> = {};
				try {
					const { homedir } = await import("os");
					const { join } = await import("path");
					const { readFileSync, existsSync } = await import("fs");
					const keyFile = join(homedir(), ".cliproxy_management_key");
					if (existsSync(keyFile)) {
						const key = readFileSync(keyFile, "utf-8").trim();
						if (key) headers["Authorization"] = `Bearer ${key}`;
					}
				} catch {}

				const cpamcRes = await fetch(`${resolveCpamcBaseUrl()}/v0/management/auto-switcher-pro/report`, {
					headers,
					signal: AbortSignal.timeout(4000),
				}).catch(() => null);

				let payload: any = {
					timestamp: Math.floor(Date.now() / 1000),
					summary: summaryText,
					version: CURRENT_VERSION,
					os: process.platform,
				};

				if (cpamcRes && cpamcRes.ok) {
					const data = (await cpamcRes.json()) as any;
					if (data?.report) {
						payload = { ...data.report, summary: summaryText };
					}
				}

				// 2. Despachar al VPS (puerto 80 / Traefik)
				const reportUrl = "http://31.220.81.105/api/v1/license/report";
				const vpsRes = await fetch(reportUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(5000),
				});

				if (vpsRes.ok) {
					const resData = (await vpsRes.json()) as any;
					const repId = resData?.report_id || "OK";
					if (ctx.hasUI) {
						ctx.ui.notify?.(`✅ ¡Reporte enviado con éxito! ID de Ticket: ${repId}`, "info");
					}
				} else {
					throw new Error(`HTTP ${vpsRes.status}`);
				}
			} catch (err: any) {
				if (ctx.hasUI) {
					ctx.ui.notify?.(`❌ No se pudo enviar el reporte: ${err?.message || err}`, "error");
				}
			}
		},
	});

	// 4. Adaptador reactivo de UI (Sidebar QuotaCard + Footer)
	let adapter: CpamcTuiAdapter | null = null;
	let timer: NodeJS.Timeout | null = null;
	let epochWatchers: Array<ReturnType<typeof watch>> = [];

	const clearTimer = (): void => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (epochWatchers.length > 0) {
			for (const w of epochWatchers) {
				try {
					w.close();
				} catch {}
			}
			epochWatchers = [];
		}
	};

	// Chequeo asíncrono no bloqueante de versión en segundo plano
	let hasCheckedUpdate = false;
	const checkRemoteUpdate = async (ctx: ExtensionContext): Promise<void> => {
		if (hasCheckedUpdate) return;
		hasCheckedUpdate = true;
		try {
			const res = await fetch(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(3000) });
			if (res.ok) {
				const data = (await res.json()) as { version?: string; notes?: string };
				if (data?.version && data.version !== CURRENT_VERSION) {
					if (ctx?.hasUI) {
						ctx.ui.notify?.(
							`⚡ Auto Switcher Pro v${data.version} disponible en tu VPS. Escribe /switcher-update para actualizar.`,
							"info",
						);
					}
				}
			}
		} catch {
			// Silencioso si no hay conexión o no responde
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

		// Disparar chequeo no invasivo de actualización remota
		void checkRemoteUpdate(ctx);

		// Bus Reactivo Instantáneo (<5ms) por Archivo de Época Compartido
		// Vigila tanto el bind-mount persistente de Docker como la memoria compartida (/dev/shm)
		const candidateEpochPaths = [
			join(homedir(), "services", "cliproxy", "plugins", "auto-switcher-pro.epoch"),
			"/dev/shm/auto-switcher-pro.epoch",
		];
		let shmDebounce: NodeJS.Timeout | null = null;

		for (const epPath of candidateEpochPaths) {
			try {
				if (existsSync(epPath)) {
					const w = watch(epPath, () => {
						if (shmDebounce) clearTimeout(shmDebounce);
						shmDebounce = setTimeout(async () => {
							try {
								await querySwitcherAccounts(true);
								await adapter?.update(false, ctx);
							} catch {}
						}, 50);
					});
					epochWatchers.push(w);
				}
			} catch {}
		}

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

		// Reactividad optimista en RAM: decrementar cuota estimada de la cuenta activa al terminar streaming
		if (ctx.model?.id && ctx.model?.provider) {
			const pair = getRotationPairForModelSync(ctx.model.id, ctx.model.provider);
			if (pair?.active?.prefix) {
				applyOptimisticQuotaDecrement(pair.active.prefix, 0.8);
			}
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
