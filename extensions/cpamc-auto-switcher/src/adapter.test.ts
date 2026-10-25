import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && specifier.startsWith(".")) {
    try {
      const resolvedUrl = new URL(specifier, context.parentURL);
      const filePath = fileURLToPath(resolvedUrl);
      if (!existsSync(filePath)) {
        const tsPath = filePath.replace(/\\.js$/, ".ts");
        if (existsSync(tsPath)) {
          return {
            shortCircuit: true,
            url: pathToFileURL(tsPath).href,
          };
        }
      }
    } catch {}
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode));

const {
	CpamcTuiAdapter,
	formatFooterRotationBlock,
	formatSidebarQuotaCardLines,
	calculateQuotaPace,
	parseConsumedNumber,
	stripAnsi,
} = await import("./adapter.js");
import type { PoolRotationPair } from "./store.js";

describe("Adapter Footer Formatting & Origin Indicator", () => {
	const mockNativePair: PoolRotationPair = {
		poolKey: "native",
		familyName: "Antigravity",
		familyIcon: "✨",
		totalAccounts: 1,
		isNativeReadOnly: true,
		active: {
			status: "[ACTIVE]",
			provider: "cpamc",
			profile: "default",
			accountId: "native-1",
			prefix: "agy",
			consumed5h: "0/100",
			consumedWeekly: "0/500",
			minAvailable: "100%",
		},
	};

	const mockPoolPair: PoolRotationPair = {
		poolKey: "Pool-01-gemini",
		familyName: "Gemini",
		familyIcon: "✨",
		totalAccounts: 2,
		isNativeReadOnly: false,
		active: {
			status: "[ACTIVE]",
			provider: "cpamc",
			profile: "default",
			accountId: "acc-1",
			prefix: "agy",
			consumed5h: "10/100",
			consumedWeekly: "50/500",
			minAvailable: "95%",
		},
		next: {
			status: "[RESERVE]",
			provider: "cpamc",
			profile: "default",
			accountId: "acc-2",
			prefix: "agy_1",
			consumed5h: "0/100",
			consumedWeekly: "0/500",
			minAvailable: "100%",
		},
	};

	it("renders footer block without originTag when not provided", () => {
		const out = formatFooterRotationBlock(mockPoolPair, false);
		const clean = stripAnsi(out);
		assert.match(clean, /⏸ agy 95%/);
		assert.match(clean, /⏭ agy_1 100%/);
		assert.doesNotMatch(clean, /· default/);
		assert.doesNotMatch(clean, /· sesión/);
	});

	it("renders persistent origin indicator '· default' in rotation block", () => {
		const out = formatFooterRotationBlock(mockPoolPair, false, "default");
		const clean = stripAnsi(out);
		assert.match(clean, /⏸ agy 95%/);
		assert.match(clean, /⏭ agy_1 100%/);
		assert.match(clean, /· default/);
	});

	it("renders persistent origin indicator '· sesión' in rotation block", () => {
		const out = formatFooterRotationBlock(mockPoolPair, true, "sesión");
		const clean = stripAnsi(out);
		assert.match(clean, /▶ agy 95%/);
		assert.match(clean, /· sesión/);
	});

	it("renders origin indicator on native read-only accounts", () => {
		const out = formatFooterRotationBlock(mockNativePair, false, "default");
		const clean = stripAnsi(out);
		assert.match(clean, /⚡ agy 100%/);
		assert.match(clean, /· default/);
	});

	it("renders standalone origin indicator when current pair is null", () => {
		const out = formatFooterRotationBlock(null, false, "sesión");
		const clean = stripAnsi(out);
		assert.match(clean, /· sesión/);
	});

	it("returns empty string when pair is null and originTag is undefined", () => {
		const out = formatFooterRotationBlock(null, false);
		assert.equal(out, "");
	});

	it("renders sidebar card with colloquial unified labels and CUIDANDO EL CHAT block", () => {
		const lines = formatSidebarQuotaCardLines(mockPoolPair, 48);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /Modelo\s+Pool-01-gemini/);
		assert.match(text, /Cuentas:\s+2\s+· listas/);
		assert.match(text, /⚡ acc-1/);
		assert.match(text, /5 HORAS/);
		assert.match(text, /SEMANAL/);
		assert.match(text, /Quedan 5h 0m/);
		assert.match(text, /⏱\s+/);
		assert.match(text, /Uso/);
		assert.match(text, /90% libre/);
		assert.match(text, /Ritmo/);
		assert.match(text, /\[SIGUIENTE\]\s+acc-2/);
		assert.match(text, /\[CUIDANDO EL CHAT\]/);
		assert.match(text, /○ Blindaje Activo/);
		assert.match(text, /Presupuesto Turno/);
		assert.match(text, /Microcortes:\s+0\/2/);
		assert.match(text, /Subagentes:\s+0\/2/);
		assert.match(text, /Introspecc:\s+Ok/);
		assert.match(text, /Poda:\s+\+32k tk/);
	});

	it("renders sidebar card in active execution state with LIVE indicator", () => {
		const lines = formatSidebarQuotaCardLines(mockPoolPair, 48, undefined, undefined, true);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /\[● Escribiendo\]/);
		assert.match(text, /\[CUIDANDO EL CHAT\]/);
		assert.match(text, /● Escribiendo/);
	});

	it("renders sidebar card in intercepted runaway loop state", () => {
		const alertTelemetry = {
			bashExplorationCount: 5,
			subagentPollCount: 1,
			blockedIntrospections: 1,
			blockedBashEvasions: 1,
			blockedSubagentPolls: 0,
			lastBlockedReason: "Evasión por bash bloqueada",
		};
		const lines = formatSidebarQuotaCardLines(mockPoolPair, 48, undefined, undefined, false, alertTelemetry);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /Frenando bucles/);
		assert.match(text, /⚡ Bucle Interceptado/);
		assert.match(text, /🛑 5\/5 Bloqueado/);
		assert.match(text, /🛑 Bloqueado \(1\)/);
	});

	it("renders sidebar card in tripped circuit breaker state with hyperlink and tokens saved", () => {
		const trippedTelemetry = {
			bashExplorationCount: 0,
			subagentPollCount: 0,
			totalToolCount: 15,
			circuitBreakerTripped: true,
			circuitBreakerReason: "CYCLE_DETECTED" as const,
			incidentId: "cb_test123",
			tokensSavedEstimate: 85000,
			blockedIntrospections: 0,
			blockedBashEvasions: 0,
			blockedSubagentPolls: 0,
			blockedProhibitedCommands: 0,
		};
		const lines = formatSidebarQuotaCardLines(mockPoolPair, 48, undefined, undefined, false, trippedTelemetry);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /🛑 DISPARADO/);
		assert.match(text, /Ciclo repetitivo \(x3\)/);
		assert.match(text, /Tokens protegidos\s+~85k tokens/);
		assert.match(text, /Diagnóstico\s+\[Ver detalles \(3\) ↗\]/);
		assert.match(text, /O escribe\s+\/incident/);
		assert.match(text, /\[ACCIÓN REQUERIDA\]/);
		assert.match(text, /Dar orden directa/);

		// Verificar que el formato OSC 8 esté presente en las líneas sin stripAnsi
		const rawText = lines.join("\n");
		assert.match(rawText, /\x1b\]8;;http:\/\/127\.0\.0\.1:8317\/management\.html#\/plugin-pages\/auto-switcher-pro-linux-amd64\/2#incident-cb_test123\x1b\\/);
	});

	it("handles malformed pair with missing active account safely without throwing", () => {
		const malformedPair: any = {
			poolKey: "Pool-01-gemini",
			familyName: "Gemini Fleet",
			familyIcon: "✨",
			totalAccounts: 1,
			active: null,
			next: null,
		};
		const footer = formatFooterRotationBlock(malformedPair, false);
		assert.equal(footer, "");

		const lines = formatSidebarQuotaCardLines(malformedPair, 48);
		assert.ok(lines.length > 0);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /Sin cuentas con rotación activa/);
	});

	it("guards sidebar widget render and digest against invalidated context and null pairs", () => {
		let throwOnAccess = true;
		const mockContext: any = {
			get model() {
				if (throwOnAccess) {
					throw new Error("ExtensionContext is invalidated");
				}
				return { id: "gemini-3.8-flash-high", provider: "cpamc" };
			},
		};

		const adapter = new CpamcTuiAdapter(mockContext);
		const parts = new Map<string, any>();
		const gentleState = { parts };

		// Invalidate and inject
		(adapter as any).injectIntoSidebar(gentleState);

		const quotaWidget = parts.get("cpamc-quota-card");
		assert.ok(quotaWidget, "quota widget must be registered");

		// Even when accessing model throws an error, render and digest MUST return safely without throwing
		const renderedLines = quotaWidget.render();
		assert.ok(Array.isArray(renderedLines));

		const digestStr = quotaWidget.digest();
		assert.equal(typeof digestStr, "string");
		assert.ok(digestStr.includes("none"));
	});

	it("satisfies Acceptance Criteria 1: 40% time elapsed and 25% consumed -> Ritmo holgado", () => {
		const dummyStyler: any = {
			easy: (t: string) => t,
			amber: (t: string) => t,
			error: (t: string) => t,
		};
		// total 300 mins (18000s), 40% elapsed means 60% remaining = 18000 * 0.6 = 10800s
		const pace = calculateQuotaPace("25%", 10800, 300, dummyStyler);
		assert.equal(pace.state, "easy");
		assert.match(pace.pillLabel, /Ritmo holgado/);
		assert.equal(pace.consumedPct, 25);
		assert.equal(pace.remainingPct, 75);
	});

	it("satisfies Acceptance Criteria 2: 30% time elapsed and 62% consumed -> Vas muy rápido", () => {
		const dummyStyler: any = {
			easy: (t: string) => t,
			amber: (t: string) => t,
			error: (t: string) => t,
		};
		// total 300 mins (18000s), 30% elapsed means 70% remaining = 18000 * 0.7 = 12600s
		const pace = calculateQuotaPace("62%", 12600, 300, dummyStyler);
		assert.equal(pace.state, "fast");
		assert.match(pace.pillLabel, /Vas muy rápido/);
		assert.equal(pace.consumedPct, 62);
		assert.equal(pace.remainingPct, 38);
	});

	it("satisfies Acceptance Criteria 3: 100% consumed before reset -> Cuota agotada", () => {
		const dummyStyler: any = {
			easy: (t: string) => t,
			amber: (t: string) => t,
			error: (t: string) => t,
		};
		const pace = calculateQuotaPace("100%", 7200, 300, dummyStyler);
		assert.equal(pace.state, "exhausted");
		assert.match(pace.pillLabel, /Cuota agotada/);
		assert.equal(pace.consumedPct, 100);
		assert.equal(pace.remainingPct, 0);
	});

	it("satisfies Acceptance Criteria 4: 5h 0m remaining and 0% consumed -> Ritmo holgado and clock empty", () => {
		const dummyStyler: any = {
			easy: (t: string) => t,
			amber: (t: string) => t,
			error: (t: string) => t,
		};
		const pace = calculateQuotaPace("0%", 18000, 300, dummyStyler);
		assert.equal(pace.state, "easy");
		assert.match(pace.pillLabel, /Ritmo holgado/);
		assert.equal(pace.consumedPct, 0);
		assert.equal(pace.remainingPct, 100);
		assert.equal(pace.remainingFormatted, "5h 0m");
	});
});
