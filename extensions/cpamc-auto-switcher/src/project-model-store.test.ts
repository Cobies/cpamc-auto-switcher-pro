import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
	normalizeCwd,
	saveProjectModel,
	getProjectModel,
	loadProjectModelsMap,
	clearProjectModels,
} from "./project-model-store.ts";

describe("Project Model Store & Volatile Session Lifecycle", () => {
	beforeEach(() => {
		clearProjectModels();
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

	it("updates existing cwd model without altering other projects in the same process", () => {
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-01-gemini");
		saveProjectModel("/projects/proj-b", "cpamc", "claude-sonnet-4-6");

		// Update proj-a
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-03-codex");

		const map = loadProjectModelsMap();
		assert.equal(map[path.resolve("/projects/proj-a")]?.modelId, "Pool-03-codex");
		assert.equal(map[path.resolve("/projects/proj-b")]?.modelId, "claude-sonnet-4-6");
	});

	it("returns null for projects without explicit selection in the current session", () => {
		assert.equal(getProjectModel("/projects/unselected-proj"), null);
	});

	it("simulates Herdr process exit/restart returning to Pi default model (RAM cleared)", () => {
		const projectCwd = "/home/wilox/projects/sio-hotel";
		// Usuario cambia el modelo en caliente dentro de Herdr
		saveProjectModel(projectCwd, "cpamc", "Pool-01-gemini");
		assert.equal(getProjectModel(projectCwd)?.modelId, "Pool-01-gemini");

		// Se simula la salida de Herdr (muere el proceso y su memoria RAM)
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


