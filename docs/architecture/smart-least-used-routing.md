# Registro de Arquitectura (ADR-06): Balanceo Proactivo de Carga por Menor Uso (Least-Used Routing)

**Fecha**: 2026-10-07  
**Estado**: Homologado y en Producción  
**Autor**: CTO & Engineering Team  
**Ámbito**: `cpamc-auto-switcher-pro` / `extensions/cpamc-auto-switcher` / Pi TUI

---

## 1. Contexto y Diagnóstico del Problema

### El Cuello de Botella del Modelo Active-Standby Primitivo
Históricamente, Auto Switcher Pro operaba bajo un esquema estricto de **Active-Standby (Failover Reactivo)**:
- El usuario seleccionaba un prefijo padre (ej. `agy`), y el 100% de las peticiones recaía sobre esa única cuenta.
- Las cuentas de reserva (`agy_1`, `agy_2`) permanecían al 100% ociosas y ocultas.
- El switcher solo conmutaba cuando el padre alcanzaba el 90% (5h) o 95% (semanal).
- Al coexistir múltiples pools para la misma familia (ej. `agy` con 10% libre y `agy2` con 43% libre para Gemini 3.8 Flash), el selector mostraba las opciones alfabéticamente a ciegas, induciendo al usuario a quemar la cuenta más agotada.

### La Trampa del "Gasto Uniforme Ciego" (The Cliff Effect)
La alternativa de alternar peticiones al 50/50 por Round-Robin puro fue rechazada porque en Google Cloud Code / Antigravity las ventanas de reseteo son fijas (5 horas y 7 días). Consumir todas las cuentas a la misma velocidad provocaría que todas alcancen el 0% en el mismo instante, dejando la infraestructura sin reservas.

---

## 2. Decisión de Arquitectura: Tiered Least-Used Selection

Se homologó e implementó un mecanismo de **Selección Proactiva por Menor Uso (Least-Used)** en la capa de interacción y despacho:

1. **Visibilidad en Tiempo Real de Cuota Libre (`getAvailableQuotaForPrefix`)**:
   - Cada líder expone su porcentaje remanente real extraído de la telemetría viva (`cpamc-auto-switcher -list`).
2. **Ranking Dinámico (Least-Used First)**:
   - Al abrir `/cpamc-model`, los líderes de la misma familia se ordenan automáticamente de mayor a menor cuota libre.
   - El líder más saludable es destacado con la insignia `⭐ Recomendado` y encabeza la lista.
   - Ejemplo: `agy2` (43% libre) encabeza la lista sobre `agy` (10% libre).
3. **Comando de Auto-Balance Rápido (`/cpamc-model auto`)**:
   - Permite al usuario o a scripts fijar directamente el líder óptimo con mayor cuota disponible sin intervención manual.
4. **Preservación del Colchón de Contingencia**:
   - Las reservas frías (`_1`, `_2`) se mantienen resguardadas para failover de emergencia, evitando el Efecto Precipicio.

---

## 3. Matriz de Validación de Calidad

| Prueba | Comando / Herramienta | Resultado |
| :--- | :--- | :--- |
| **Detección de Cuota** | `store.getAvailableQuotaForPrefix` | `agy` (10.8%), `agy2` (42.5%), `agy_son` (32.9%) |
| **Ranking Óptimo** | `store.getBestCandidateLeader(["agy", "agy2"])` | Selecciona `agy2` (42.5% > 10.8%) con éxito |
| **Compilación TypeScript** | `esbuild --bundle` | **0 Errores** |
| **Integración TUI** | `/cpamc-model` | Muestra badges `43% libre · ⭐ Recomendado` |

---

## 4. Guía de Mantenimiento

- Para añadir nuevos pools a la evaluación de candidatos, basta con que estén registrados en `cpamc-auto-switcher -list`. La función `classifyModel` y `getBestCandidateLeader` los integrará automáticamente.
- Las reservas frías continúan bajo la protección del demonio Go de rotación reactiva.
