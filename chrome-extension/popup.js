document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const keyInput = document.getElementById('managementKey');
  const authUserInput = document.getElementById('authUser');
  const emailInput = document.getElementById('accountEmail');
  const detectedText = document.getElementById('detectedAccountText');
  const btnSync = document.getElementById('btnSync');
  const btnSyncText = document.getElementById('btnSyncText');
  const statusMsg = document.getElementById('statusMsg');

  const DEFAULT_KEY = "+e8NlHZe1FdygMmo1uboxIIR24F+9vvxWCDteJq2zOc=";

  // Load saved config for this Chrome Profile
  chrome.storage.local.get(['cpamc_server_url', 'cpamc_management_key', 'cpamc_auth_user', 'cpamc_account_email'], (res) => {
    if (res && res.cpamc_server_url) {
      serverInput.value = res.cpamc_server_url;
    }
    if (res && res.cpamc_management_key) {
      keyInput.value = res.cpamc_management_key;
    } else {
      keyInput.value = DEFAULT_KEY;
    }
    if (res && res.cpamc_auth_user !== undefined) {
      authUserInput.value = res.cpamc_auth_user;
    }
    if (res && res.cpamc_account_email) {
      emailInput.value = res.cpamc_account_email;
    }
  });

  serverInput.addEventListener('change', () => {
    const val = serverInput.value.trim().replace(/\/+$/, '');
    chrome.storage.local.set({ cpamc_server_url: val });
  });

  keyInput.addEventListener('change', () => {
    const val = keyInput.value.trim();
    chrome.storage.local.set({ cpamc_management_key: val });
  });

  authUserInput.addEventListener('change', () => {
    const val = authUserInput.value.trim().replace(/[^0-9a-zA-Z_]/g, '');
    authUserInput.value = val || '0';
    chrome.storage.local.set({ cpamc_auth_user: authUserInput.value });
  });

  emailInput.addEventListener('change', () => {
    const val = emailInput.value.trim();
    chrome.storage.local.set({ cpamc_account_email: val });
  });

  // Query active tab to detect account index /u/X or profile information
  let detectedAuthUser = "0";
  let isGeminiTab = false;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url) {
      const url = new URL(tabs[0].url);
      if (url.hostname.includes('gemini.google.com')) {
        isGeminiTab = true;
        const uMatch = url.pathname.match(/\/u\/(\d+)/);
        if (uMatch) {
          detectedAuthUser = uMatch[1];
          // Solo actualizar si el usuario no ha ingresado un authuser manual previamente
          if (!authUserInput.value || authUserInput.value === '0') {
            authUserInput.value = detectedAuthUser;
          }
        }
        detectedText.textContent = `gemini.google.com (Pestaña /u/${detectedAuthUser})`;
      } else {
        detectedText.textContent = `Pestaña: ${url.hostname} (No es Gemini)`;
      }
    }
  } catch (err) {
    detectedText.textContent = `Usuario /u/0`;
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

      const mgmtKey = (keyInput.value || '').trim() || DEFAULT_KEY;
      const targetAuthUser = (authUserInput.value || '0').trim().replace(/[^0-9a-zA-Z_]/g, '') || '0';
      const targetEmail = (emailInput.value || '').trim();

      // Guardar en el storage del perfil actual
      chrome.storage.local.set({
        cpamc_auth_user: targetAuthUser,
        cpamc_account_email: targetEmail
      });

      // 1. Fetch all cookies for google.com and gemini.google.com using Chrome Extension Cookie API
      const geminiCookies = await chrome.cookies.getAll({ domain: 'google.com' });
      const geminiSubCookies = await chrome.cookies.getAll({ domain: 'gemini.google.com' });

      const allCookiesMap = new Map();
      geminiCookies.forEach(c => allCookiesMap.set(c.name, c.value));
      geminiSubCookies.forEach(c => allCookiesMap.set(c.name, c.value));

      // 2. Validate essential Google credentials
      const secure1PSID = allCookiesMap.get('__Secure-1PSID') || allCookiesMap.get('SID');
      if (!secure1PSID) {
        throw new Error('No se detectó la cookie __Secure-1PSID ni SID en Chrome. Asegúrate de tener abierta la pestaña de gemini.google.com con tu sesión iniciada.');
      }

      // Build serialized cookie string
      const cookieEntries = [];
      allCookiesMap.forEach((val, name) => {
        cookieEntries.push(`${name}=${val}`);
      });
      const cookiePayloadString = cookieEntries.join('; ');

      btnSyncText.textContent = 'Enviando a Auto Switcher...';

      // 3. POST to canonical CPAMC Management API route with Authorization Bearer header
      const targetEndpoint = `${serverBase}/v0/management/auto-switcher-pro/argon/sync-session`;
      const response = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${mgmtKey}`
        },
        body: JSON.stringify({
          cookies: cookiePayloadString,
          authuser: targetAuthUser,
          email: targetEmail || undefined,
          url: isGeminiTab ? 'https://gemini.google.com' : undefined,
          save_to_disk: true
        })
      });

      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Respuesta inválida del servidor (HTTP ${response.status}): ${text.slice(0, 100)}`);
      }

      if (response.ok && data.ok) {
        const displayEmail = targetEmail ? `(${targetEmail})` : '';
        showStatus('success', `✅ ¡Cuenta /u/${targetAuthUser} ${displayEmail} sincronizada exitosamente como argon_u${targetAuthUser}!`);
      } else {
        throw new Error(data.message || data.error || `Error del servidor (HTTP ${response.status})`);
      }
    } catch (err) {
      showStatus('error', `❌ ${err.message}`);
    } finally {
      btnSync.disabled = false;
      btnSyncText.textContent = 'Sincronizar Sesión en 1-Click';
    }
  });
});
