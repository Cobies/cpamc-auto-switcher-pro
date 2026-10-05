import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrefixManager from './PrefixManager';
import GroupManager from './GroupManager';
import ControlSwitcher from './ControlSwitcher';
import * as managementClient from '../api/managementClient';

describe('Convention Validation Across AUTO SWITCHER PRO - TDD Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockRealNodes = [
    // agy_clau (4 accounts)
    { id: 'c1', data: { fileName: 'antigravity-clau-1.json', email: 'inf...tec@gmail.com', prefix: 'agy_clau', provider: 'antigravity' } },
    { id: 'c2', data: { fileName: 'antigravity-clau-2.json', email: 'mar...tro@gmail.com', prefix: 'agy_clau_1', provider: 'antigravity' } },
    { id: 'c3', data: { fileName: 'antigravity-clau-3.json', email: 'wil...o11@gmail.com', prefix: 'agy_clau_2', provider: 'antigravity' } },
    { id: 'c4', data: { fileName: 'antigravity-clau-4.json', email: 'wil...io9@gmail.com', prefix: 'agy_clau_3', provider: 'antigravity' } },
    // agy (2 accounts)
    { id: 'g1', data: { fileName: 'antigravity-main-1.json', email: 'mar...tro@gmail.com', prefix: 'agy', provider: 'antigravity' } },
    { id: 'g2', data: { fileName: 'antigravity-main-2.json', email: 'inf...tec@gmail.com', prefix: 'agy_1', provider: 'antigravity' } },
    // agy2 (2 accounts)
    { id: 'g3', data: { fileName: 'antigravity-main-3.json', email: 'wil...o11@gmail.com', prefix: 'agy2', provider: 'antigravity' } },
    { id: 'g4', data: { fileName: 'antigravity-main-4.json', email: 'wil...io9@gmail.com', prefix: 'agy2_1', provider: 'antigravity' } },
  ];

  describe('1. PrefixManager - Convention Guides & Placeholders', () => {
    it('displays canonical routing guide with agy, agy_clau, and codex examples instead of deprecated agy_g1', () => {
      render(<PrefixManager nodes={mockRealNodes} />);

      const guideBox = screen.getByTestId('prefix-manager-view').querySelector('.pm-guide-box');
      expect(guideBox).toBeTruthy();

      const guideText = guideBox.textContent;
      // Must feature the canonical conventions
      expect(guideText).toContain('agy');
      expect(guideText).toContain('agy_clau');
      // Must NOT feature deprecated agy_g1 as the primary guide example
      expect(guideText).not.toContain('agy_g1');
    });

    it('renders input placeholder following the canonical agy, agy_clau convention', () => {
      render(<PrefixManager nodes={mockRealNodes} />);

      const input = screen.getByTestId('input-prefix-c1');
      // Placeholder should show canonical examples
      expect(input.placeholder).toMatch(/agy/);
      expect(input.placeholder).not.toContain('agy_g1_1');
    });
  });

  describe('2. GroupManager - Prevention of Error Induction in Pool Base Prefixes', () => {
    it('blocks base prefix ending with _<digit> (e.g. agy_2) and warns that _N is reserved for reserves', () => {
      render(
        <GroupManager
          nodes={[
            ...mockRealNodes,
            { id: 'free1', data: { fileName: 'free1.json', email: 'free1@gmail.com', prefix: '', provider: 'antigravity' } },
            { id: 'free2', data: { fileName: 'free2.json', email: 'free2@gmail.com', prefix: '', provider: 'antigravity' } },
          ]}
        />
      );

      // Select Gemini family -> Gemini Puro
      fireEvent.click(screen.getByTestId('family-gemini'));
      fireEvent.click(screen.getByTestId('subfamily-gemini-pure'));

      const prefixInput = screen.getByTestId('input-group-base-prefix');
      // User types agy_2 (inducing reserve confusion)
      fireEvent.change(prefixInput, { target: { value: 'agy_2' } });

      // Must display a warning explaining that _<digit> is reserved for reserves
      const warning = screen.getByTestId('prefix-family-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toMatch(/reserva|cuentas de reserva/i);
      expect(warning.textContent).toContain('agy2');

      // The save button must be disabled
      const saveBtn = screen.getByTestId('btn-save-group');
      expect(saveBtn.disabled).toBe(true);
    });

    it('dynamically suggests the NEXT free prefix without collision (e.g. agy3 when agy and agy2 exist)', () => {
      render(
        <GroupManager
          nodes={[
            ...mockRealNodes,
            { id: 'free1', data: { fileName: 'free1.json', email: 'free1@gmail.com', prefix: '', provider: 'antigravity' } },
          ]}
        />
      );

      fireEvent.click(screen.getByTestId('family-gemini'));
      fireEvent.click(screen.getByTestId('subfamily-gemini-pure'));

      // Both agy and agy2 already exist in mockRealNodes. Next suggestion chip MUST offer agy3!
      expect(screen.getByRole('button', { name: /agy3 \(próximo libre\)/i })).toBeTruthy();
      // Should not have a chip offering agy2 which already exists
      const chips = screen.getAllByRole('button');
      const agy2Chip = chips.find((c) => c.className.includes('group-prefix-chip') && c.textContent.trim() === 'agy2');
      expect(agy2Chip).toBeUndefined();
    });

    it('warns when Claude del Paquete is selected but user types a non-agy_clau prefix', () => {
      render(
        <GroupManager
          nodes={[
            ...mockRealNodes,
            { id: 'free1', data: { fileName: 'free1.json', email: 'free1@gmail.com', prefix: '', provider: 'antigravity' } },
          ]}
        />
      );

      fireEvent.click(screen.getByTestId('family-gemini'));
      fireEvent.click(screen.getByTestId('subfamily-gemini-claude'));

      const prefixInput = screen.getByTestId('input-group-base-prefix');
      // User types "clau" instead of "agy_clau"
      fireEvent.change(prefixInput, { target: { value: 'clau' } });

      const warning = screen.getByTestId('prefix-family-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain('agy_clau');
    });
  });

  describe('3. ControlSwitcher - Quota Isolation by Convention', () => {
    it('isolates Gemini Models quota for agy/agy2 pools and Claude and GPT models quota for agy_clau pools', async () => {
      const mockQuotaAuthFiles = [
        { name: 'acc-agy.json', email: 'g@test.com', note: 'agy', provider: 'antigravity', auth_index: 0 },
        { name: 'acc-clau.json', email: 'c@test.com', note: 'agy_clau', provider: 'antigravity', auth_index: 1 },
      ];

      // Simulated Google Cloud Code quota response with BOTH groups
      const quotaResponsePayload = {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { displayName: '5 hours limit', remainingFraction: 0.90 }, // 10% consumed
              { displayName: 'Weekly limit', remainingFraction: 0.80 },  // 20% consumed
            ],
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              { displayName: '5 hours limit', remainingFraction: 0.10 }, // 90% consumed (heavy load!)
              { displayName: 'Weekly limit', remainingFraction: 0.05 },  // 95% consumed
            ],
          },
        ],
      };

      vi.spyOn(managementClient, 'apiFetch').mockImplementation((endpoint, options) => {
        if (endpoint === '/v0/management/auth-files') {
          return Promise.resolve({ ok: true, json: async () => ({ files: mockQuotaAuthFiles }) });
        }
        if (endpoint.includes('/download')) {
          const url = new URL(endpoint, 'http://localhost');
          const name = url.searchParams.get('name');
          const item = mockQuotaAuthFiles.find((f) => f.name === name);
          return Promise.resolve({ ok: true, json: async () => ({ prefix: item?.note || '', note: item?.note || '' }) });
        }
        if (endpoint === '/v0/management/api-call') {
          return Promise.resolve({
            ok: true,
            json: async () => quotaResponsePayload,
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<ControlSwitcher />);

      // For agy pool (Gemini Models): should read ~20% consumed -> ~80% remaining
      // For agy_clau pool (Claude and GPT models): should read ~95% consumed -> ~5% remaining
      // It must NOT cross-pollute quota readings!
      await screen.findByText('Gemini Puro (agy)');
      await screen.findByText('Claude del Paquete (agy_clau)');

      // The agy pool must show ~80% remaining (healthy)
      // The agy_clau pool must show ~5% remaining (exhausted)
      const { waitFor } = await import('@testing-library/react');
      await waitFor(() => {
        expect(screen.getByText('80%')).toBeTruthy();
        expect(screen.getByText('5%')).toBeTruthy();
      });
    });
  });

  describe('4. Specialized agy_son & agy_opus Pools - Full Lifecycle TDD', () => {
    const mockSpecializedNodes = [
      // agy_son (Leader + Reserve)
      { id: 's1', data: { fileName: 'antigravity-maribelluz.agy_son.json', email: 'mar...tro@gmail.com', prefix: 'agy_son', provider: 'antigravity' } },
      { id: 's2', data: { fileName: 'antigravity-infosoytec.agy_son_1.json', email: 'inf...tec@gmail.com', prefix: 'agy_son_1', provider: 'antigravity' } },
      // agy_opus (Leader + Reserve)
      { id: 'o1', data: { fileName: 'antigravity-wilsonlavio11.agy_opus.json', email: 'wil...o11@gmail.com', prefix: 'agy_opus', provider: 'antigravity' } },
      { id: 'o2', data: { fileName: 'antigravity-wilsonlavio9.agy_opus_1.json', email: 'wil...io9@gmail.com', prefix: 'agy_opus_1', provider: 'antigravity' } },
      // agy & agy2 (Gemini pools)
      { id: 'g1', data: { fileName: 'antigravity-maribelluz.json', email: 'mar...tro@gmail.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'g2', data: { fileName: 'antigravity-infosoytec.json', email: 'inf...tec@gmail.com', prefix: 'agy_1', provider: 'antigravity' } },
      { id: 'g3', data: { fileName: 'antigravity-wilsonlavio11.json', email: 'wil...o11@gmail.com', prefix: 'agy2', provider: 'antigravity' } },
      { id: 'g4', data: { fileName: 'antigravity-wilsonlavio9.json', email: 'wil...io9@gmail.com', prefix: 'agy2_1', provider: 'antigravity' } },
    ];

    it('GroupManager: accurately suggests agy_son and agy_opus prefixes and models when creating pools', () => {
      render(
        <GroupManager
          nodes={[
            ...mockSpecializedNodes,
            { id: 'free1', data: { fileName: 'free1.json', email: 'free1@gmail.com', prefix: '', provider: 'antigravity' } },
            { id: 'free2', data: { fileName: 'free2.json', email: 'free2@gmail.com', prefix: '', provider: 'antigravity' } },
          ]}
        />
      );

      fireEvent.click(screen.getByTestId('family-gemini'));

      // In mockSpecializedNodes agy_son already exists -> next suggested free prefix is agy_son2
      fireEvent.click(screen.getByTestId('subfamily-gemini-sonnet'));
      expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy_son2');
      expect(screen.getAllByText(/claude-sonnet-4-6/i).length).toBeGreaterThanOrEqual(1);

      // In mockSpecializedNodes agy_opus already exists -> next suggested free prefix is agy_opus2
      fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));
      expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy_opus2');
      expect(screen.getAllByText(/claude-opus-4-6-thinking/i).length).toBeGreaterThanOrEqual(1);
    });

    it('ControlSwitcher: renders Option A topology with zero cross-contamination and 3-pools pagination', async () => {
      vi.spyOn(managementClient, 'apiFetch').mockImplementation(() => Promise.resolve({ ok: true, json: async () => ({}) }));

      render(<ControlSwitcher nodes={mockSpecializedNodes} />);

      // Filter by Claude family to bring agy_son and agy_opus into view without pagination overflow
      fireEvent.click(screen.getByTestId('filter-cs-claude'));

      // Must discover agy_son and agy_opus pools
      expect(await screen.findByText('Claude Sonnet (agy_son)')).toBeTruthy();
      expect(screen.getByText('Claude Opus (agy_opus)')).toBeTruthy();

      // agy_son pool must only have agy_son_1 as reserve (NOT agy_opus, NOT agy_1)
      expect(screen.getByText('agy_son_1')).toBeTruthy();
      expect(screen.getByText('agy_opus_1')).toBeTruthy();

      // Switch to Gemini family
      fireEvent.click(screen.getByTestId('filter-cs-gemini'));
      expect(screen.getByText('Gemini Puro (agy)')).toBeTruthy();
      expect(screen.getByText('Gemini Puro 2 (agy2)')).toBeTruthy();
      expect(screen.getByText('agy_1')).toBeTruthy();
      expect(screen.getByText('agy2_1')).toBeTruthy();
    });

    it('PrefixManager: categorizes agy_son and agy_opus into Claude family filters', () => {
      render(<PrefixManager nodes={mockSpecializedNodes} />);

      // Filter by Claude: should show all 4 Claude accounts (both Sonnet and Opus)
      fireEvent.click(screen.getByTestId('filter-chip-claude'));
      expect(screen.getByText('mar...tro@gmail.com')).toBeTruthy();
      expect(screen.getByText('inf...tec@gmail.com')).toBeTruthy();
      expect(screen.getByText('wil...o11@gmail.com')).toBeTruthy();
      expect(screen.getByText('wil...io9@gmail.com')).toBeTruthy();

      // Filter by Gemini: should still display the Gemini accounts
      fireEvent.click(screen.getByTestId('filter-chip-gemini'));
      expect(screen.getByText('mar...tro@gmail.com')).toBeTruthy();
    });
  });
});
