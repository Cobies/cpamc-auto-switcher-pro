# ⚡ CPAMC Session Syncer Pro (Extensión de Chrome)

Mini-extensión oficial de Google Chrome para sincronizar cookies de sesión protegidas con `HttpOnly` (`__Secure-1PSID`, `__Secure-1PSIDTS`, `SID`) desde `gemini.google.com` hacia **Auto Switcher Pro** con 1 solo clic.

---

## 🚀 Cómo instalarla en Google Chrome (30 segundos)

1. En tu navegador Google Chrome, abre una nueva pestaña y escribe en la barra de direcciones:
   ```text
   chrome://extensions
   ```
2. En la esquina superior derecha de esa pantalla, activa el interruptor:
   **`Modo de desarrollador`** (o *Developer mode*).
3. En la esquina superior izquierda aparecerán tres botones. Haz clic en:
   **`Cargar descomprimida`** (o *Load unpacked*).
4. Selecciona la carpeta **`chrome-extension`** que se encuentra en este proyecto (`/home/wilox/projects/cpamc-auto-switcher/chrome-extension`).
5. ¡Listo! Verás el icono del rayo ⚡ en la barra de herramientas de tu navegador.

---

## 🎯 Cómo usarla

1. Abre tu pestaña habitual de [gemini.google.com](https://gemini.google.com) donde ya tienes tu sesión de Google iniciada.
2. Haz clic en el icono del rayo ⚡ de la extensión en la barra de Chrome.
3. Verifica que la URL del servidor apunte a tu CPAMC (`http://192.168.10.150:8317`).
4. Haz clic en el botón azul: **`⚡ Sincronizar Sesión en 1-Click`**.
5. ¡Eso es todo! La extensión leerá las cookies `HttpOnly` de Google y las enviará directamente a Auto Switcher Pro.
   - En tu consola web de CPAMC (`⚡ Gemini 4 Argon`), tu tarjeta aparecerá lista con sus relojes circulares de cuota y modelo de razonamiento en RAM.
