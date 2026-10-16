import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export interface StoredProjectModel {
	provider: string;
	modelId: string;
	updatedAt: number;
}

/**
 * Almacén volátil en memoria compartida (/dev/shm) con fallback a RAM.
 * Ciclo de vida:
 * - Se almacena en tmpfs (/dev/shm), accesible entre todos los splits y panes del workspace activo de Herdr.
 * - Solo retiene el modelo si el usuario lo selecciona explícitamente en la sesión viva.
 * - Desaparece automáticamente al reiniciar el sistema o cerrar el workspace (sin tocar disco persistente).
 */
let customStorePath: string | null = null;
const memoryFallback = new Map<string, StoredProjectModel>();

/**
 * Permite sobrescribir la ruta del almacén (utilizado en pruebas unitarias para aislamiento).
 */
export function setCustomStorePath(p: string | null): void {
	customStorePath = p;
}

/**
 * Determina la ruta en memoria compartida volátil (/dev/shm) para el workspace de Herdr o sesión actual.
 */
export function getShmStorePath(): string {
	if (customStorePath) return customStorePath;
	if (process.env.HERDR_PROJECT_MODELS_PATH) return process.env.HERDR_PROJECT_MODELS_PATH;

	const wsId = process.env.HERDR_WORKSPACE_ID?.trim();
	const user = process.env.USER || "user";
	const baseDir = fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir();
	const fileKey = wsId ? `herdr-${user}-${wsId}` : `pi-${user}-session`;
	return path.join(baseDir, `${fileKey}-project-models.json`);
}

/**
 * Normaliza canónicamente el cwd para evitar discordancias por barras finales o rutas relativas.
 */
export function normalizeCwd(cwd: string): string {
	if (!cwd) return "";
	return path.resolve(path.normalize(cwd));
}

function readStoreFromDisk(): Record<string, StoredProjectModel> {
	try {
		const filePath = getShmStorePath();
		if (!fs.existsSync(filePath)) {
			if (memoryFallback.size > 0 && !fs.existsSync("/dev/shm") && !fs.existsSync(os.tmpdir())) {
				const fallbackObj: Record<string, StoredProjectModel> = {};
				for (const [k, v] of memoryFallback.entries()) {
					fallbackObj[k] = { ...v };
				}
				return fallbackObj;
			}
			return {};
		}
		const raw = fs.readFileSync(filePath, "utf-8");
		if (!raw.trim()) return {};
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, StoredProjectModel>;
		}
		return {};
	} catch {
		const fallbackObj: Record<string, StoredProjectModel> = {};
		for (const [k, v] of memoryFallback.entries()) {
			fallbackObj[k] = { ...v };
		}
		return fallbackObj;
	}
}

function writeStoreToDisk(data: Record<string, StoredProjectModel>): void {
	const filePath = getShmStorePath();
	const tempPath = `${filePath}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 7)}.tmp`;
	try {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
		fs.renameSync(tempPath, filePath);
	} catch {
		// Fallback a Map en memoria RAM si el sistema de archivos no estuviera disponible
		try {
			if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
		} catch {}
		memoryFallback.clear();
		for (const [k, v] of Object.entries(data)) {
			memoryFallback.set(k, { ...v });
		}
	}
}

/**
 * Guarda o actualiza en memoria compartida volátil el último modelo seleccionado para el cwd dado.
 */
export function saveProjectModel(cwd: string, provider: string, modelId: string): void {
	if (!cwd || !provider || !modelId) return;
	const normCwd = normalizeCwd(cwd);
	const store = readStoreFromDisk();
	store[normCwd] = {
		provider,
		modelId,
		updatedAt: Date.now(),
	};
	writeStoreToDisk(store);
}

/**
 * Obtiene el último modelo registrado en memoria compartida volátil para el cwd dado.
 * Retorna null si en la sesión activa no se ha cambiado el modelo para este proyecto.
 */
export function getProjectModel(cwd: string): StoredProjectModel | null {
	if (!cwd) return null;
	const normCwd = normalizeCwd(cwd);
	const store = readStoreFromDisk();
	return store[normCwd] || null;
}

/**
 * Limpia el modelo guardado en memoria para un proyecto específico (cwd).
 */
export function clearProjectModel(cwd: string): void {
	if (!cwd) return;
	const normCwd = normalizeCwd(cwd);
	const store = readStoreFromDisk();
	if (store[normCwd]) {
		delete store[normCwd];
		writeStoreToDisk(store);
	}
	memoryFallback.delete(normCwd);
}

/**
 * Retorna una instantánea del almacén volátil en memoria.
 */
export function loadProjectModelsMap(): Record<string, StoredProjectModel> {
	return readStoreFromDisk();
}

/**
 * Limpia el almacén volátil completo (aislamiento para pruebas unitarias y reinicio de ciclo de vida).
 */
export function clearProjectModels(): void {
	memoryFallback.clear();
	const filePath = getShmStorePath();
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch {}
}


