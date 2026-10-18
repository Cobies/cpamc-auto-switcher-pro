document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const detectedText = document.getElementById('detectedAccountText');
  const btnSync = document.getElementById('btnSync');
  const btnSyncText = document.getElementById('btnSyncText');
  const statusMsg = document.getElementById('statusMsg');

  // Load saved server URL
  chrome.storage.local.get(['cpamc_server_url'], (res) => {
    if (res && res.cpamc_server_url) {
      serverInput.value = res.cpamc_server_url;
    }
  });

  serverInput.addEventListener('change', () => {
    const val = serverInput.value.trim().replace(/\/+$/, '');
    chrome.storage.local.set({ cpamc_server_url: val });
  });

  // Query active tab to detect account index /u/X
  let currentAuthUser = "0";
  let isGeminiTab = false;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url) {
      const url = new URL(tabs[0].url);
      if (url.hostname.includes('gemini.google.com')) {
        isGeminiTab = true;
        const uMatch = url.pathname.match(/\/u\/(\d+)/);
        if (uMatch) {
          currentAuthUser = uMatch[1];
        }
        detectedText.textContent = `gemini.google.com (Usuario /u/${currentAuthUser})`;
      } else {
        detectedText.textContent = `Pestaña: ${url.hostname} (No es Gemini)`;
      }
    }
  } catch (err) {
    detectedText.textContent = `Usuario /u/0 (Predeterminado)`;
  }

  function showStatus(type, msg) {
    statusMsg.className = `status-msg ${type}`;
    statusMsg.textContent = msg;
  }

  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    btnSyncText.textContent = 'Extrayendo cookies HttpOnly...';
    statusMsg.className = 'status-msg';

    try {
      const serverBase = serverInput.value.trim().replace(/\/+$/, '');
      if (!serverBase) {
        throw new Error('Por favor especifica la dirección de tu servidor CPAMC.');
      }

      // 1. Fetch all cookies for gemini.google.com and .google.com using Chrome Extension Cookie API
      const geminiCookies = await chrome.cookies.getAll({ domain: 'google.com' });
      const geminiSubCookies = await chrome.cookies.getAll({ domain: 'gemini.google.com' });

      const allCookiesMap = new Map();
      geminiCookies.forEach(c => allCookiesMap.set(c.name, c.value));
      geminiSubCookies.forEach(c => allCookiesMap.set(c.name, c.value));

      // 2. Validate essential Google credentials
      const secure1PSID = allCookiesMap.get('__Secure-1PSID') || allCookiesMap.get('SID');
      if (!secure1PSID) {
        throw new Error('No se detectó la cookie __Secure-1PSID ni SID en Chrome. Asegúrate de haber iniciado sesión en gemini.google.com en este navegador.');
      }

      // Build serialized cookie string
      const cookieEntries = [];
      allCookiesMap.forEach((val, name) => {
        cookieEntries.push(`${name}=${val}`);
      });
      const cookiePayloadString = cookieEntries.join('; ');

      btnSyncText.textContent = 'Enviando a Auto Switcher...';

      // 3. POST to Auto Switcher Pro Argon Gateway endpoint
      const targetEndpoint = `${serverBase}/auto-switcher-pro/argon/sync-session`;
      const response = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          cookies: cookiePayloadString,
          authuser: currentAuthUser,
          url: isGeminiTab ? 'https://gemini.google.com' : undefined,
          save_to_disk: true
        })
      });

      const data = await response.json();
      if (response.ok && data.ok) {
        showStatus('success', `✅ ¡Sesión /u/${currentAuthUser} sincronizada exitosamente en Auto Switcher Pro!`);
      } else {
        throw new Error(data.message || `Error del servidor (HTTP ${response.status})`);
      }
    } catch (err) {
      showStatus('error', `❌ ${err.message}`);
    } finally {
      btnSync.disabled = false;
      btnSyncText.textContent = 'Sincronizar Sesión en 1-Click';
    }
  });
});
