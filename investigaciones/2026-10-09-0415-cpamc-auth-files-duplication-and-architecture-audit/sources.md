# Fuentes y Evidencias de Investigación

- **Captura del Usuario**: `/srv/share/Captura de pantalla 2026-10-09 034843.png` (Selector de Grupo/Pool mostrando cuentas duplicadas con el mismo correo y opciones `— copia`).
- **Endpoint CPAMC Management**: `GET http://localhost:8317/v0/management/auth-files` (12 archivos físicos JSON registrados en `/root/.cli-proxy-api/`).
- **Código Fuente Plugin**:
  - `plugins/visual-profile/internal/plugin/virtualize.go` (lógica de clonado server-side de auth-files).
  - `plugins/visual-profile/web/src/components/GroupManager.jsx` (lógica de selección y guardado de pools que dispara `virtualizeAccount`).
  - `plugins/visual-profile/web/src/api/managementClient.js` (cliente API para `virtualize`).
