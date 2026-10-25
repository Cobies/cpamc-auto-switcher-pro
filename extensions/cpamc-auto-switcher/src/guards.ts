export const MAX_BASH_EXPLORATION_PER_TURN = 5;
export const MAX_SUBAGENT_POLL_PER_TURN = 2;

export interface RunawayGuardTelemetry {
	// Volátiles del turno
	bashExplorationCount: number;
	subagentPollCount: number;
	// Acumulados de la sesión
	blockedIntrospections: number;
	blockedBashEvasions: number;
	blockedSubagentPolls: number;
	// Estado descriptivo para la UI
	lastBlockedReason?: string;
	lastBlockedAt?: number;
}

export class AutoSwitcherRunawayGuard {
	private bashCount = 0;
	private pollCount = 0;
	private introspectionsBlocked = 0;
	private bashEvasionsBlocked = 0;
	private pollsBlocked = 0;
	private lastReason?: string;
	private lastTimestamp?: number;

	checkTool(event: { toolName: string; input?: unknown }): { block: true; reason: string } | undefined {
		if (!event || typeof event.toolName !== "string") {
			return undefined;
		}

		const input = event.input as Record<string, unknown> | undefined;

		// 1. Bloqueo de auto-introspección en sesiones internas o archivos temporales
		if (event.toolName === "bash" && typeof input?.command === "string") {
			const cmd = input.command.trim();

			if (/(?:\.pi\/agent\/sessions|\/tmp\/edit_[\w.-]+\.json)/i.test(cmd)) {
				this.introspectionsBlocked++;
				this.lastReason = "Introspección de sesiones bloqueada";
				this.lastTimestamp = Date.now();
				return {
					block: true,
					reason: "Bloqueado por Auto Switcher Pro: No inspecciones archivos internos de sesión (.pi/agent/sessions) o temporales vía bash. Enfócate en la tarea o delega la investigación a un subagente.",
				};
			}

			// 2. Control de evasión por bash (búsquedas masivas de código para saltarse delegación)
			if (
				/\b(?:git\s+(?:grep|log|show)|grep\b|find\b|cat\b|sed\s+-n)\b/i.test(cmd) &&
				!/\b(?:odd\/|docs\/|\.md\b)/i.test(cmd)
			) {
				this.bashCount++;
				if (this.bashCount > MAX_BASH_EXPLORATION_PER_TURN) {
					this.bashEvasionsBlocked++;
					this.lastReason = "Evasión por bash bloqueada";
					this.lastTimestamp = Date.now();
					return {
						block: true,
						reason: `Presupuesto de terminal excedido (${this.bashCount}/${MAX_BASH_EXPLORATION_PER_TURN} consultas consecutivas): Has realizado demasiadas lecturas/búsquedas de código inline vía bash. Delega la exploración a un subagente para proteger la ventana de contexto.`,
					};
				}
			}
		}

		// 3. Freno a bucle de polling excesivo a subagentes en el mismo turno
		if (event.toolName === "subagent_status" || event.toolName === "subagent_result") {
			this.pollCount++;
			if (this.pollCount > MAX_SUBAGENT_POLL_PER_TURN) {
				this.pollsBlocked++;
				this.lastReason = "Polling excesivo de subagente bloqueado";
				this.lastTimestamp = Date.now();
				return {
					block: true,
					reason: `Polling de subagente bloqueado: Has consultado subagent_status/result ${this.pollCount} veces en el mismo turno. Finaliza tu turno y espera la notificación automática de finalización en background o utiliza mode: 'task'.`,
				};
			}
		}

		return undefined;
	}

	resetTurn(): void {
		this.bashCount = 0;
		this.pollCount = 0;
	}

	resetSession(): void {
		this.resetTurn();
		this.introspectionsBlocked = 0;
		this.bashEvasionsBlocked = 0;
		this.pollsBlocked = 0;
		this.lastReason = undefined;
		this.lastTimestamp = undefined;
	}

	getTelemetry(): RunawayGuardTelemetry {
		return {
			bashExplorationCount: this.bashCount,
			subagentPollCount: this.pollCount,
			blockedIntrospections: this.introspectionsBlocked,
			blockedBashEvasions: this.bashEvasionsBlocked,
			blockedSubagentPolls: this.pollsBlocked,
			lastBlockedReason: this.lastReason,
			lastBlockedAt: this.lastTimestamp,
		};
	}
}

// Instancia global compartida entre los hooks de evento y el adaptador de TUI
export const runawayGuard = new AutoSwitcherRunawayGuard();
