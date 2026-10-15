import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	normalizeCwd,
	saveProjectModel,
	getProjectModel,
	loadProjectModelsMap,
} from "./project-model-store.ts";

describe("Project Model Store & Persistence", () => {
	const testDir = path.join(os.tmpdir(), `cpamc-store-test-${Date.now()}-${process.pid}`);
	const testStoreFile = path.join(testDir, "test-project-models.json");

	before(() => {
		fs.mkdirSync(testDir, { recursive: true });
	});

	after(() => {
		try {
			fs.rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it("normalizes paths removing trailing slashes and resolving relative dots", () => {
		const raw1 = "/home/wilox/projects/cpamc-auto-switcher/";
		const raw2 = "/home/wilox/projects/cpamc-auto-switcher";
		assert.equal(normalizeCwd(raw1), normalizeCwd(raw2));
		assert.equal(normalizeCwd("/tmp/../tmp"), path.resolve("/tmp"));
	});

	it("saves and retrieves model by normalized cwd", () => {
		const cwd = "/home/wilox/projects/test-project/";
		saveProjectModel(cwd, "cpamc", "Pool-02-gemini", testStoreFile);

		const retrieved = getProjectModel("/home/wilox/projects/test-project", testStoreFile);
		assert.ok(retrieved);
		assert.equal(retrieved.provider, "cpamc");
		assert.equal(retrieved.modelId, "Pool-02-gemini");
		assert.ok(retrieved.updatedAt > 0);
	});

	it("updates existing cwd model without altering other projects", () => {
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-01-gemini", testStoreFile);
		saveProjectModel("/projects/proj-b", "cpamc", "claude-sonnet-4-6", testStoreFile);

		// Update proj-a
		saveProjectModel("/projects/proj-a", "cpamc", "Pool-03-codex", testStoreFile);

		const map = loadProjectModelsMap(testStoreFile);
		assert.equal(map[path.resolve("/projects/proj-a")]?.modelId, "Pool-03-codex");
		assert.equal(map[path.resolve("/projects/proj-b")]?.modelId, "claude-sonnet-4-6");
	});

	it("gracefully handles corrupt JSON and creates a backup", () => {
		const corruptFile = path.join(testDir, "corrupt.json");
		fs.writeFileSync(corruptFile, "{ invalid-json: true", "utf-8");

		const result = loadProjectModelsMap(corruptFile);
		assert.deepEqual(result, {});

		// Check backup was created
		const files = fs.readdirSync(testDir);
		const backupExists = files.some((f) => f.startsWith("corrupt.json.corrupt."));
		assert.ok(backupExists, "Expected backup of corrupt file to exist");
	});
});
