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

const { CpamcTuiAdapter, formatFooterRotationBlock, formatSidebarQuotaCardLines, stripAnsi } = await import("./adapter.js");
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
		assert.match(text, /\[TRABAJANDO AHORA\]/);
		assert.match(text, /Correo\s+acc-1/);
		assert.match(text, /Cuota 5h:\s+10\/100/);
		assert.match(text, /Cuota Sem:\s+50\/500/);
		assert.match(text, /\[CUIDANDO EL CHAT\]/);
		assert.match(text, /○ Todo limpio/);
		assert.match(text, /\[LA QUE SIGUE\]/);
		assert.match(text, /Correo\s+acc-2/);
	});

	it("renders sidebar card in active execution state with LIVE indicator", () => {
		const lines = formatSidebarQuotaCardLines(mockPoolPair, 48, undefined, undefined, true);
		const text = lines.map((l: string) => stripAnsi(l)).join("\n");
		assert.match(text, /\[● Escribiendo\]/);
		assert.match(text, /\[CUIDANDO EL CHAT\]/);
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
});
