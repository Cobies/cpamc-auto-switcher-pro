import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AgentMatrix from './AgentMatrix';
import * as managementClient from '../api/managementClient';

describe('AgentMatrix Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially and then displays orchestrators, subagents, and clarity badges', async () => {
    vi.spyOn(managementClient, 'fetchAgentMatrix').mockResolvedValue({
      ok: true,
      available_pools: ['Pool-01-gemini', 'Pool-03-codex', 'Pool-04-claude'],
      pool_capabilities: {
        'Pool-01-gemini': true,
        'Pool-03-codex': false,
        'Pool-04-claude': true,
      },
      pool_details: {
        'Pool-01-gemini': {
          id: 'Pool-01-gemini',
          target_model: 'gemini-3.8-flash-high',
          leader_email: 'antigravity-master1@gmail.com',
          total_members: 4,
          reserves_count: 3,
        },
        'Pool-03-codex': {
          id: 'Pool-03-codex',
          target_model: 'gpt-4o',
          leader_email: 'codex-master.json',
          total_members: 2,
          reserves_count: 1,
        },
        'Pool-04-claude': {
          id: 'Pool-04-claude',
          target_model: 'claude-sonnet-4-6',
          leader_email: 'antigravity-claude@gmail.com',
          total_members: 4,
          reserves_count: 3,
        },
      },
      gentle_agents: [
        {
          universe: 'gentle_ai',
          agent_id: 'orchestrator',
          displayName: '👑 ORQUESTADOR GENTLE',
          is_orchestrator: true,
          primary_pool: 'Pool-04-claude',
          fallback_pool: 'Pool-01-gemini',
          thinking_level: 'high',
          description: 'Cerebro senior de Gentle-AI',
        },
        {
          universe: 'gentle_ai',
          agent_id: 'gentle-ai-worker',
          displayName: '🛠️ gentle-ai-worker',
          is_orchestrator: false,
          primary_pool: 'Pool-03-codex', // Non-reasoning pool
          fallback_pool: 'Pool-01-gemini',
          thinking_level: 'none',
          concurrency: 1,
          description: 'Implementador fullstack',
        },
      ],
      jok3r_agents: [
        {
          universe: 'jok3r_pi',
          agent_id: 'orchestrator',
          displayName: '👑 ORQUESTADOR J0K3R',
          is_orchestrator: true,
          primary_pool: 'Pool-04-claude',
          fallback_pool: 'Pool-01-gemini',
          thinking_level: 'high',
          description: 'Cerebro de j0k3r-pi',
        },
      ],
    });

    render(<AgentMatrix />);

    await waitFor(() => {
      expect(screen.getByText('Matriz de Agentes & Orquestación')).toBeDefined();
    });

    // 1. Check Orchestrator and Agent Rendering
    expect(screen.getByText('👑 ORQUESTADOR GENTLE')).toBeDefined();
    expect(screen.getByText('👑 ORQUESTADOR J0K3R')).toBeDefined();
    expect(screen.getByText('🛠️ gentle-ai-worker')).toBeDefined();

    // 2. Check Clarity Item 1: OpenCode + Gentle-Shell dual runtime clarity
    expect(screen.getByText('💻 OpenCode Editor')).toBeDefined();
    expect(screen.getByText('📟 Gentle-Shell CLI')).toBeDefined();
    expect(screen.getByText(/Sincronización Simultánea/i)).toBeDefined();

    // 3. Check Clarity Item 2: Rescate Failover 429 clarity
    expect(screen.getAllByText(/RESCATE EN CALIENTE \(FAILOVER 429\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Standby · 0% tokens hasta 429/i).length).toBeGreaterThan(0);

    // 4. Check Clarity Item 3: Sovereign Facade -> Physical Reality transparency
    expect(screen.getAllByText('claude-sonnet-4-6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(4 cuentas)').length).toBeGreaterThan(0);

    // 5. Check Non-reasoning Thinking N/A Badge
    expect(screen.getByText('🚫 N/A')).toBeDefined();

    // 6. Check Dry-Run Ping button existence
    expect(screen.getAllByText('⚡ Test Route').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⚡ Test').length).toBeGreaterThan(0);
  });
});
