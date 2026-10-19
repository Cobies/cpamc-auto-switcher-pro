#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const pluginDir = path.join(home, 'services', 'cliproxy', 'plugins');
const harnessesDir = path.join(pluginDir, '.harnesses');
fs.mkdirSync(harnessesDir, { recursive: true });

function parseMarkdownMetadata(filePath, defaultId) {
  let displayName = defaultId;
  let description = 'Agente detectado en disco';
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 35);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('# ') && displayName === defaultId) {
        displayName = line.replace(/^#\s*/, '').trim();
      } else if (line.toLowerCase().startsWith('description:')) {
        const desc = line.replace(/^description:\s*/i, '').trim().replace(/^["'`]|["'`]$/g, '');
        if (desc) description = desc;
      }
    }
  } catch {}
  return { displayName, description };
}

function deriveRole(agentId) {
  const l = agentId.toLowerCase();
  if (l.includes('explore') || l.includes('discover') || l.includes('search')) return 'discovery';
  if (l.includes('plan')) return 'planning';
  if (l.includes('apply') || l.includes('worker') || l.includes('fix')) return 'apply';
  if (l.includes('verify') || l.includes('test')) return 'verify';
  if (l.includes('review') || l.includes('judge') || l.includes('audit')) return 'review';
  if (l.includes('research') || l.includes('news')) return 'research';
  return 'general';
}

function scanHostHarnesses() {
  const detectedHarnesses = [];

  // 1. Gentle-Shell CLI
  const gentleDir = path.join(home, '.gentle-shell', 'agent');
  if (fs.existsSync(gentleDir)) {
    const agentsDir = path.join(gentleDir, 'agents');
    const agents = [];

    // Orchestrator
    agents.push({
      agent_id: 'orchestrator',
      display_name: '👑 ORQUESTADOR GENTLE',
      role_type: 'orchestrator',
      is_orchestrator: true,
      description: 'Cerebro senior interactivo de Gentle-Shell CLI',
      default_primary: 'Pool-04-claude',
      default_fallback: 'Pool-01-gemini',
      default_thinking: 'high',
      concurrency: 1,
    });

    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir).sort()) {
        if (f.endsWith('.md')) {
          const id = f.replace(/\.md$/, '');
          const meta = parseMarkdownMetadata(path.join(agentsDir, f), id);
          agents.push({
            agent_id: id,
            display_name: meta.displayName,
            role_type: deriveRole(id),
            is_orchestrator: false,
            description: meta.description,
            default_primary: id.includes('verify') ? 'Pool-02-gemini' : (id.includes('plan') || id.includes('worker') || id.includes('fix') ? 'Pool-04-claude' : 'Pool-01-gemini'),
            default_fallback: 'Pool-02-gemini',
            default_thinking: id.includes('verify') ? 'low' : 'medium',
            concurrency: (id.includes('explore') || id.includes('verify')) ? 2 : 1,
          });
        }
      }
    }

    detectedHarnesses.push({
      id: 'gentle_shell',
      name: 'Gentle-Shell CLI',
      icon: '📟',
      badge: '📟 Gentle-Shell Terminal CLI',
      config_path: '~/.gentle-shell/agent/profiles.json',
      subtitle: '⚡ Terminal CLI Soberana: Arnés independiente para desarrollo ágil en consola con streaming nativo.',
      agents,
    });
  }

  // 2. j0k3r-pi
  const jok3rDir = path.join(home, '.pi', 'agent-j0k3r');
  if (fs.existsSync(jok3rDir)) {
    const subagentsDir = path.join(jok3rDir, 'subagents');
    const agents = [];

    // Orchestrator
    agents.push({
      agent_id: 'orchestrator',
      display_name: '👑 ORQUESTADOR J0K3R',
      role_type: 'orchestrator',
      is_orchestrator: true,
      description: 'Cerebro principal interactivo de j0k3r-pi que coordina el ciclo de vida',
      default_primary: 'Pool-04-claude',
      default_fallback: 'Pool-01-gemini',
      default_thinking: 'high',
      concurrency: 1,
    });

    if (fs.existsSync(subagentsDir)) {
      for (const f of fs.readdirSync(subagentsDir).sort()) {
        if (f.endsWith('.md')) {
          const id = f.replace(/\.md$/, '');
          const meta = parseMarkdownMetadata(path.join(subagentsDir, f), id);
          agents.push({
            agent_id: id,
            display_name: meta.displayName,
            role_type: deriveRole(id),
            is_orchestrator: false,
            description: meta.description,
            default_primary: id.includes('verify') ? 'Pool-02-gemini' : (id.includes('plan') || id.includes('apply') ? 'Pool-04-claude' : 'Pool-01-gemini'),
            default_fallback: 'Pool-02-gemini',
            default_thinking: id.includes('verify') ? 'low' : 'medium',
            concurrency: (id.includes('discovery') || id.includes('verify') || id.includes('research')) ? 2 : 1,
          });
        }
      }
    }

    detectedHarnesses.push({
      id: 'jok3r_pi',
      name: 'j0k3r-pi',
      icon: '⚡',
      badge: '⚡ j0k3r-pi Orchestrator',
      config_path: '~/.pi/agent-j0k3r/subagents.json',
      subtitle: '⚡ Suite Todo-en-Uno Soberana: Orquestador interactivo de terminal y escuadrón de subagentes Planned Workflow.',
      agents,
    });
  }

  const manifest = {
    version: '1.0.0',
    scanned_at_ms: Date.now(),
    detected_harnesses: detectedHarnesses,
  };

  const manifestPath = path.join(harnessesDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return { manifestPath, detectedHarnesses };
}

if (require.main === module) {
  const { manifestPath, detectedHarnesses } = scanHostHarnesses();
  console.log('Manifest written successfully to:', manifestPath);
  console.log('Harnesses count:', detectedHarnesses.length);
  for (const h of detectedHarnesses) {
    console.log(` - ${h.name} (${h.id}): ${h.agents.length} agentes`);
  }
}

module.exports = { scanHostHarnesses };
