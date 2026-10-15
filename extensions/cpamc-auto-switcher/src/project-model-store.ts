import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface StoredProjectModel {
	provider: string;
	modelId: string;
	updatedAt: number;
}

const STORE_DIR = path.join(os.homedir(), ".config", "cpamc-auto-switcher");
const STORE_FILE = path.join(STORE_DIR, "project-models.json");

/**
 * Carga de forma segura el mapa de modelos por proyecto: { [cwd: string]: StoredProjectModel }
 */
export function loadProjectModelsMap(): Record<string, StoredProjectModel> {
	try {
		if (!fs.existsSync(STORE_FILE)) {
			return {};
		}
		const raw = fs.readFileSync(STORE_FILE, "utf-8");
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Guarda o actualiza el último modelo seleccionado para el directorio de trabajo actual (cwd).
 */
export function saveProjectModel(cwd: string, provider: string, modelId: string): void {
	if (!cwd || !provider || !modelId) return;

	try {
		if (!fs.existsSync(STORE_DIR)) {
			fs.mkdirSync(STORE_DIR, { recursive: true });
		}

		const map = loadProjectModelsMap();
		map[cwd] = {
			provider,
			modelId,
			updatedAt: Date.now(),
		};

		const tmpFile = `${STORE_FILE}.tmp.${Date.now()}`;
		fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2), "utf-8");
		fs.renameSync(tmpFile, STORE_FILE);
	} catch {
		// Silencioso ante fallos de I/O para no interrumpir el flujo principal
	}
}

/**
 * Obtiene el último modelo registrado para el cwd dado.
 */
export function getProjectModel(cwd: string): StoredProjectModel | null {
	if (!cwd) return null;
	const map = loadProjectModelsMap();
	return map[cwd] || null;
}
