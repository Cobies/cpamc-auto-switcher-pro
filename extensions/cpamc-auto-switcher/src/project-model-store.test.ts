import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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

const {
	normalizeCwd,
	saveProjectModel,
	getProjectModel,
	loadProjectModelsMap,
	clearProjectModels,
	clearProjectModel,
	setCustomStorePath,
	getShmStorePath,
} = await import("./project-model-store.js");

describe("Project Model Store & Volatile Session Lifecycle", () => {
	const testStorePath = path.join(
		fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(),
		`test-herdr-${process.pid}-project-models.json`,
	);

	beforeEach(() => {
		setCustomStorePath(testStorePath);
		clearProjectModels();
	});

	afterEach(() => {
		clearProjectModels();
		setCustomStorePath(null);
	});

	it("normalizes paths removing trailing slashes and resolving relative dots", () => {
		const raw1 = "/home/wilox/projects/cpamc-auto-switcher/";
		const raw2 = "/home/wilox/projects/cpamc-auto-switcher";
		assert.equal(normalizeCwd(raw1), normalizeCwd(raw2));
		assert.equal(normalizeCwd("/tmp/../tmp"), path.resolve("/tmp"));
	});

	it("saves and retrieves model in volatile memory by normalized cwd", () => {
		const cwd = "/home/wilox/projects/test-project/";
		saveProjectModel(cwd, "cpamc", "Pool-02-gemini");

		const retrieved = getProjectModel("/home/wilox/projects/test-project");
		assert.ok(retrieved);
		assert.equal(retrieved.provider, "cpamc");
		assert.equal(retrieved.modelId, "Pool-02-gemini");
		assert.ok(retrieved.updatedAt > 0);
	});

	it("shares state across independent panes within the same Herdr workspace (/dev/shm)", () => {
		// Simula Pane 1 seleccionando un modelo para el proyecto
		saveProjectModel("/home/wilox/projects/sio-hotel", "cpamc", "Pool-04-claude");

		// Simula Pane 2 (otro proceso/instancia que lee la misma memoria compartida)
		const pane2Retrieved = getProjectModel("/home/wilox/projects/sio-hotel");
		assert.ok(pane2Retrieved);
		assert.equal(pane2Retrieved.modelId, "Pool-04-claude");
	});

	it("isolates different Herdr workspaces by workspace id", () => {
		const originalWsId = process.env.HERDR_WORKSPACE_ID;
		try {
			setCustomStorePath(null); // Usar resolución canónica basada en env
			process.env.HERDR_WORKSPACE_ID = "workspace-ALPHA";
			clearProjectModels();
			saveProjectModel("/projects/shared", "cpamc", "Pool-01-gemini");
			assert.equal(getProjectModel("/projects/shared")?.modelId, "Pool-01-gemini");

			// Cambiar a otro workspace
			process.env.HERDR_WORKSPACE_ID = "workspace-BETA";
			// El nuevo workspace debe estar limpio (sin modelo previo forzado)
			assert.equal(getProjectModel("/projects/shared"), null);

			// Volver al workspace ALPHA y verificar que su estado persiste
			process.env.HERDR_WORKSPACE_ID = "workspace-ALPHA";
			assert.equal(getProjectModel("/projects/shared")?.modelId, "Pool-01-gemini");
		} finally {
			process.env.HERDR_WORKSPACE_ID = "workspace-ALPHA";
			clearProjectModels();
			process.env.HERDR_WORKSPACE_ID = originalWsId;
		}
	});

	it("updates existing cwd model without altering other projects in the same process", () => {
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-01-gemini");
		saveProjectModel("/projects/proj-b", "cpamc", "claude-sonnet-4-6");

		// Update proj-a
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-03-codex");

		const map = loadProjectModelsMap();
		assert.equal(map[path.resolve("/projects/proj-a")]?.modelId, "Pool-03-codex");
		assert.equal(map[path.resolve("/projects/proj-b")]?.modelId, "claude-sonnet-4-6");
	});

	it("clears model for a specific cwd without affecting other projects", () => {
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-01-gemini");
		saveProjectModel("/projects/proj-b", "cpamc", "claude-sonnet-4-6");

		clearProjectModel("/projects/proj-a");

		assert.equal(getProjectModel("/projects/proj-a"), null);
		assert.equal(getProjectModel("/projects/proj-b")?.modelId, "claude-sonnet-4-6");
	});

	it("returns null for projects without explicit selection in the current session", () => {
		assert.equal(getProjectModel("/projects/unselected-proj"), null);
	});

	it("simulates Herdr process exit/restart returning to Pi default model (RAM cleared)", () => {
		const projectCwd = "/home/wilox/projects/sio-hotel";
		// Usuario cambia el modelo en caliente dentro de Herdr
		saveProjectModel(projectCwd, "cpamc", "Pool-01-gemini");
		assert.equal(getProjectModel(projectCwd)?.modelId, "Pool-01-gemini");

		// Se simula la salida de Herdr o reinicio del sistema (se purga el archivo volátil)
		clearProjectModels();

		// Al volver a iniciar Herdr, debe regresar al default de Pi (sin modelo previo forzado)
		assert.equal(getProjectModel(projectCwd), null);
	});

	it("simulates starting a brand new project in Herdr (always starts with Pi default model)", () => {
		saveProjectModel("/home/wilox/projects/project-a", "cpamc", "Pool-02-gemini");

		// Se abre un proyecto nuevo que no tiene selección en esta sesión
		const brandNewProject = "/home/wilox/projects/sio-mission-control";
		assert.equal(getProjectModel(brandNewProject), null);
	});

	it("simulates /new keeping the selected model during the active Herdr session", () => {
		const projectCwd = "/home/wilox/projects/sio-hotel";
		saveProjectModel(projectCwd, "cpamc", "Pool-01-gemini");

		// Dentro de la misma ejecución de Herdr, al ocurrir /new se consulta el modelo en memoria
		const sessionModel = getProjectModel(projectCwd);
		assert.ok(sessionModel);
		assert.equal(sessionModel.provider, "cpamc");
		assert.equal(sessionModel.modelId, "Pool-01-gemini");
	});
});



