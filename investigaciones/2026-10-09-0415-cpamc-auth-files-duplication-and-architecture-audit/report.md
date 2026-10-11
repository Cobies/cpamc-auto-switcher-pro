# Investigación: Causa Raíz de Duplicidad de Auth Files y Arquitectura Escalable de Cuentas

**Fecha:** 2026-10-09  
**Investigador:** j0k3r-pi  
**Objetivo:** Investigar por qué tras activar "Excluir versiones 5.5" se duplicaron cuentas en CPAMC y en Auto Switcher Pro, pasando de 8 a 9/12 tarjetas físicas, y definir la arquitectura óptima, limpia y escalable para la gestión de cuentas y auth files.

---

## 1. Evidencia Directa y Síntomas Observados

### 1.1. Captura de Pantalla (`Captura de pantalla 2026-10-09 034843.png`)
En el selector de "② Cuenta Principal (Activa / Leader)":
- Se listan 8 cuentas con corona (`👑`) y 4 cuentas con icono de bifurcación (`🔀 ... — copia`).
- Total en el dropdown: **12 opciones**.
- Las cuentas duplicadas son:
  1. `inf...tec@gmail.com` (repetida)
  2. `mar...tro@gmail.com` (repetida)
  3. `wil...o11@gmail.com` (repetida)
  4. `wil...io9@gmail.com` (repetida)
  + Sus versiones `— copia`.

### 1.2. Inspección del Backend (`cli-proxy-api`) vía `/v0/management/auth-files`
El contenedor Docker `cli-proxy-api` contiene físicamente en `/root/.cli-proxy-api/` exactamente **12 archivos de autenticación**:
1. `antigravity-infosoytec@gmail.com.json` (original)
2. `antigravity-infosoytec@gmail.com.agy_son.json` (virtualizado / clonado server-side)
3. `antigravity-infosoytec@gmail.com.agy_son_1.json` (virtualizado / clonado server-side)
4. `antigravity-maribelluzbonitaaquinocastro@gmail.com.json` (original)
5. `antigravity-maribelluzbonitaaquinocastro@gmail.com.agy_son.json` (virtualizado)
6. `antigravity-maribelluzbonitaaquinocastro@gmail.com.agy_son_2.json` (virtualizado)
7. `antigravity-wilsonlavio11@gmail.com.json` (original)
8. `antigravity-wilsonlavio11@gmail.com.agy_opus.json` (virtualizado)
9. `antigravity-wilsonlavio11@gmail.com.agy_son_3.json` (virtualizado)
10. `antigravity-wilsonlavio9@gmail.com.json` (original)
11. `antigravity-wilsonlavio9@gmail.com.agy_opus_1.json` (virtualizado)
12. `antigravity-wilsonlavio9@gmail.com.agy_son_4.json` (virtualizado)

Son **4 correos únicos**:
- `infosoytec@gmail.com` (3 archivos físicos)
- `maribelluzbonitaaquinocastro@gmail.com` (3 archivos físicos)
- `wilsonlavio11@gmail.com` (3 archivos físicos)
- `wilsonlavio9@gmail.com` (3 archivos físicos)

---

## 2. Causa Raíz de la Duplicación

### ¿Qué hace la opción "Excluir versiones 5.5"?
En `plugins/visual-profile/web/src/components/GroupManager.jsx`:
- El checkbox `excludeVersion55` simplemente establece un booleano en el estado de React.
- **La casilla en sí NO crea archivos por marcarla**.
- Sin embargo, cuando se pulsa el botón **"Armar y Guardar Pool"**:
  ```javascript
  const queueAssignment = (node, prefix) => {
    if (isVirtualSource(node)) {
      virtualJobs.push({ sourceFile: node.data.fileName, prefix, email: node.data.email });
    } else {
      updates.push({ name: node.data.fileName, prefix });
    }
  };
  ```
  Al guardar el pool, cualquier cuenta detectada como `isVirtualSource` ejecuta `virtualizeAccount(...)`.
- `virtualizeAccount` invoca el endpoint POST `/v0/management/auto-switcher-pro/virtualize`, el cual toma el archivo origen en disco y **crea un archivo físico nuevo en disco** con el nombre `${base}.${prefix}.json` y con listas de modelos excluidos calculadas (incluyendo o excluyendo la versión 5.5 según el checkbox).

### ¿Por qué se multiplicaron las tarjetas en CPAMC y en Auto Switcher Pro?
1. **En CPAMC (Panel nativo `CLIProxyAPI` -> Auth Files):**
   - CPAMC no conoce el concepto de "virtualización". Para CPAMC, cada archivo `.json` en `/root/.cli-proxy-api/` es una tarjeta física e independiente de credencial.
   - Si se tenían 4 correos y se virtualizaron para pools `agy_son` y `agy_opus`, el plugin generó físicamente copias de los archivos JSON en el directorio de CPAMC.
   - Como resultado, el dashboard nativo de CPAMC muestra 9 (o 12) tarjetas porque está leyendo cada archivo generado.

2. **En Auto Switcher Pro ("Crear Group / Perfiles"):**
   - El componente `GroupManager.jsx` calcula los candidatos a líder y reservas combinando:
     - Cuentas no asignadas (`familyCompatibleNodes`)
     - Cuentas virtualizables del paquete Gemini (`virtualizableSourceNodes`)
   - Cuando ya existen en el disco tanto la cuenta física original (`.json`) como las cuentas ya virtualizadas (`.agy_son.json`, etc.), el backend las devuelve todas como nodos individuales.
   - Si el usuario además selecciona en el dropdown una cuenta y presiona guardar varias veces o con diferentes pools, se van generando nuevos clones (`.agy_son_2.json`, `.agy_son_3.json`, `.agy_son_4.json`), acumulando archivos duplicados.
   - De ahí que aparezcan cuentas con el mismo correo 2 y hasta 3 veces en la lista regular, y además las opciones `— copia`.

---

## 3. Análisis de la Propuesta de Wilox

### Lo que propuso Wilox:
1. En **CPAMC nativo (Auth Files)**: Deberían verse únicamente las **4 cuentas físicas maestras** (1 por cada cuenta/correo real).
2. En **Auto Switcher Pro**: Debería existir una sección dedicada (un submenú en el dashboard, ej: **"Auto Auth Files"** o similar) donde se gestionen las credenciales derivadas/virtualizadas (las 8 tarjetas lógicas: 4 líderes + 4 reservas / gemini + claude).
3. Todo el manejo de virtualización y duplicidad controlada debe administrarse desde allí y no contaminar la vista base ni generar archivos huérfanos descontrolados.

### Evaluación Técnica y Viabilidad:
- **¿Es viable y correcto?** **Totalmente SÍ**, y de hecho es la única forma de tener una arquitectura limpia y profesional.
- **Problema actual del diseño (Acoplamiento en disco de CPAMC):**
  - Actualmente, `virtualize.go` clona el archivo JSON directamente en `/root/.cli-proxy-api/`.
  - Como el servidor `cli-proxy-api` escanea todo `/root/.cli-proxy-api/*.json`, cualquier clon que cree Auto Switcher Pro se convierte inmediatamente en un Auth File visible y activo en CPAMC.
  - Esto ensucia la pantalla de Auth Files de CPAMC, genera confusión sobre cuál es la cuenta real, y causa que las listas desplegables muestren 12 cuentas cuando el usuario sólo posee 4 cuentas de Google/Antigravity.
- **La Solución Arquitectónica Escalable:**
  1. **Separación de Capas (Physical Master vs Virtual Pools):**
     - **Auth Files de CPAMC**: Debe contener únicamente las **4 cuentas maestras** (las credenciales OAuth originales).
     - **Auto Switcher Pro (Auto Auth Files / Virtual Hub)**:
       - No debe duplicar ciegamente archivos con sufijos arbitrarios (`_1`, `_2`, `_3`, `_4`) en el directorio maestro sin control del ciclo de vida.
       - Debe tener una vista dedicada donde se vea claramente:
         * **4 Cuentas Maestras (Físicas)**
         * **8 Roles Asignados (4 Gemini / 4 Claude)**
       - Cuando se disuelve un pool o se reorganiza, las copias virtuales deben purgarse limpiamente de disco (`host.auth.delete` o borrado del archivo temporal/virtual) para que no queden 12 archivos basura.
  2. **Limpieza de Archivos Residuales:**
     - Actualmente hay archivos como `antigravity-wilsonlavio9@gmail.com.agy_son_4.json`, `antigravity-infosoytec@gmail.com.agy_son_1.json`, etc., generados por guardados previos.
     - Se requiere una función de consolidación/limpieza para devolver las 12 tarjetas a las 4 originales maestras (o las 8 requeridas para los 2 pools: 4 en `agy` y 4 en `agy_son`/`agy_opus`).
