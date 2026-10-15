import path from "node:path";

export interface StoredProjectModel {
	provider: string;
	modelId: string;
	updatedAt: number;
}

/**
 * Almacén volátil en memoria (RAM del proceso activo de Pi / Herdr).
 * Ciclo de vida:
 * - Se inicializa vacío al arrancar el proceso de Pi / Herdr.
 * - Solo retiene el modelo si el usuario lo selecciona explícitamente en la sesión viva.
 * - Al salir de Herdr o terminar el proceso, el estado se descarta por completo.
 */
const volatileProjectModels = new Map<string, StoredProjectModel>();

/**
 * Normaliza canónicamente el cwd para evitar discordancias por barras finales o rutas relativas.
 */
export function normalizeCwd(cwd: string): string {
	if (!cwd) return "";
	return path.resolve(path.normalize(cwd));
}

/**
 * Guarda o actualiza en memoria RAM el último modelo seleccionado para el directorio de trabajo (cwd).
 */
export function saveProjectModel(cwd: string, provider: string, modelId: string): void {
	if (!cwd || !provider || !modelId) return;
	const normCwd = normalizeCwd(cwd);
	volatileProjectModels.set(normCwd, {
		provider,
		modelId,
		updatedAt: Date.now(),
	});
}

/**
 * Obtiene el último modelo registrado en memoria RAM para el cwd dado.
 * Retorna null si en la sesión activa no se ha cambiado el modelo para este proyecto.
 */
export function getProjectModel(cwd: string): StoredProjectModel | null {
	if (!cwd) return null;
	const normCwd = normalizeCwd(cwd);
	return volatileProjectModels.get(normCwd) || null;
}

/**
 * Retorna una instantánea del mapa en memoria (compatibilidad y depuración).
 */
export function loadProjectModelsMap(): Record<string, StoredProjectModel> {
	const result: Record<string, StoredProjectModel> = {};
	for (const [key, val] of volatileProjectModels.entries()) {
		result[key] = { ...val };
	}
	return result;
}

/**
 * Limpia el almacén en memoria (aislamiento para pruebas unitarias).
 */
export function clearProjectModels(): void {
	volatileProjectModels.clear();
}

