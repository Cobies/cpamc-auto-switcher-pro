import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface StoredProjectModel {
	provider: string;
	modelId: string;
	updatedAt: number;
}

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".config", "cpamc-auto-switcher");
const DEFAULT_STORE_FILE = path.join(DEFAULT_STORE_DIR, "project-models.json");

/**
 * Obtiene la ruta física del archivo de persistencia (soporta override para pruebas aisladas).
 */
export function getStoreFilePath(): string {
	return process.env.CPAMC_PROJECT_MODELS_FILE || DEFAULT_STORE_FILE;
}

/**
 * Normaliza canónicamente el cwd para evitar discordancias por barras finales o rutas relativas.
 */
export function normalizeCwd(cwd: string): string {
	if (!cwd) return "";
	return path.resolve(path.normalize(cwd));
}

/**
 * Carga de forma segura el mapa de modelos por proyecto: { [normalizedCwd: string]: StoredProjectModel }
 */
export function loadProjectModelsMap(storeFile = getStoreFilePath()): Record<string, StoredProjectModel> {
	try {
		if (!fs.existsSync(storeFile)) {
			return {};
		}
		const raw = fs.readFileSync(storeFile, "utf-8");
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch (err) {
		// Protección ante corrupción: si el archivo existe pero el JSON es inválido, respaldar como .corrupt
		try {
			if (fs.existsSync(storeFile)) {
				const backup = `${storeFile}.corrupt.${Date.now()}`;
				fs.copyFileSync(storeFile, backup);
			}
		} catch {
			// Silencioso ante errores de respaldo
		}
		return {};
	}
}

/**
 * Guarda o actualiza el último modelo seleccionado para el directorio de trabajo actual (cwd).
 */
export function saveProjectModel(cwd: string, provider: string, modelId: string, storeFile = getStoreFilePath()): void {
	if (!cwd || !provider || !modelId) return;

	try {
		const targetDir = path.dirname(storeFile);
		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
		}

		const normCwd = normalizeCwd(cwd);
		const map = loadProjectModelsMap(storeFile);
		map[normCwd] = {
			provider,
			modelId,
			updatedAt: Date.now(),
		};

		// Archivo temporal atómico blindado por PID y timestamp
		const tmpFile = `${storeFile}.tmp.${process.pid}.${Date.now()}`;
		fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2), "utf-8");
		fs.renameSync(tmpFile, storeFile);
	} catch {
		// Silencioso ante fallos de I/O para no interrumpir el flujo principal
	}
}

/**
 * Obtiene el último modelo registrado para el cwd dado.
 */
export function getProjectModel(cwd: string, storeFile = getStoreFilePath()): StoredProjectModel | null {
	if (!cwd) return null;
	const normCwd = normalizeCwd(cwd);
	const map = loadProjectModelsMap(storeFile);
	return map[normCwd] || null;
}
