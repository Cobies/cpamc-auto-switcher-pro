import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

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

const { AutoSwitcherRunawayGuard, MAX_BASH_EXPLORATION_PER_TURN, MAX_SUBAGENT_POLL_PER_TURN } = await import("./guards.js");

describe("AutoSwitcherRunawayGuard - Anti-Bucle y Protección de Contexto", () => {
	it("1. Bloquea introspección en .pi/agent/sessions o temporales", () => {
		const guard = new AutoSwitcherRunawayGuard();

		// Intentar leer sesión
		const res1 = guard.checkTool({
			toolName: "bash",
			input: { command: "cat /home/wilox/.pi/agent/sessions/xyz.jsonl" },
		});
		assert.ok(res1?.block);
		assert.match(res1.reason, /archivos internos de sesión/i);

		// Intentar leer archivo temporal de edición
		const res2 = guard.checkTool({
			toolName: "bash",
			input: { command: "cat /tmp/edit_temp-123.json" },
		});
		assert.ok(res2?.block);

		// Comandos normales no son bloqueados
		const resNormal = guard.checkTool({
			toolName: "bash",
			input: { command: "ls -la" },
		});
		assert.equal(resNormal, undefined);

		const tele = guard.getTelemetry();
		assert.equal(tele.blockedIntrospections, 2);
	});

	it("2. Limita la evasión de lecturas masivas por bash a MAX_BASH_EXPLORATION_PER_TURN", () => {
		const guard = new AutoSwitcherRunawayGuard();

		// Ejecutar hasta el límite permitido
		for (let i = 0; i < MAX_BASH_EXPLORATION_PER_TURN; i++) {
			const res = guard.checkTool({
				toolName: "bash",
				input: { command: `grep -rn "pattern_${i}" src/` },
			});
			assert.equal(res, undefined, `intento ${i + 1} no debe bloquear`);
		}

		// El intento 6 supera el límite y debe bloquear
		const blocked = guard.checkTool({
			toolName: "bash",
			input: { command: "cat src/large-file.ts" },
		});
		assert.ok(blocked?.block);
		assert.match(blocked.reason, /Presupuesto de terminal excedido/i);

		const tele = guard.getTelemetry();
		assert.equal(tele.bashExplorationCount, 6);
		assert.equal(tele.blockedBashEvasions, 1);

		// Documentación y markdown no cuentan para la evasión
		guard.resetTurn();
		const docRes = guard.checkTool({
			toolName: "bash",
			input: { command: "cat docs/guide.md" },
		});
		assert.equal(docRes, undefined);
		assert.equal(guard.getTelemetry().bashExplorationCount, 0);
	});

	it("3. Frena el bucle de polling a subagentes cuando supera MAX_SUBAGENT_POLL_PER_TURN en un turno", () => {
		const guard = new AutoSwitcherRunawayGuard();

		// Permitido 1 y 2
		const p1 = guard.checkTool({ toolName: "subagent_status", input: { task_id: "t1" } });
		assert.equal(p1, undefined);
		const p2 = guard.checkTool({ toolName: "subagent_result", input: { task_id: "t1" } });
		assert.equal(p2, undefined);

		// Tercero en el mismo turno bloquea
		const p3 = guard.checkTool({ toolName: "subagent_status", input: { task_id: "t1" } });
		assert.ok(p3?.block);
		assert.match(p3.reason, /Polling de subagente bloqueado/i);

		const tele = guard.getTelemetry();
		assert.equal(tele.blockedSubagentPolls, 1);

		// Al reiniciar turno, se reanuda el presupuesto de polling
		guard.resetTurn();
		const pAfterReset = guard.checkTool({ toolName: "subagent_status", input: { task_id: "t1" } });
		assert.equal(pAfterReset, undefined);
		assert.equal(guard.getTelemetry().subagentPollCount, 1);
		// El acumulado se mantiene para la UI
		assert.equal(guard.getTelemetry().blockedSubagentPolls, 1);
	});
});
