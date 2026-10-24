import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HomeCenter from './HomeCenter';
import * as managementClient from '../api/managementClient';

describe('HomeCenter Component - Portada Principal & Directorio de Menús', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(managementClient, 'fetchPluginVersion').mockResolvedValue({
      ok: true,
      current_version: '0.1.1',
      current_tag: 'v0.1.1',
      latest_tag: 'v0.1.1',
      update_available: false,
      github_repo: 'WiloxDev/cpamc-auto-switcher-pro',
      releases_url: 'https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases',
    });

    vi.spyOn(managementClient, 'fetchPluginHealth').mockResolvedValue({
      healthy: true,
      status: 'Online',
      active_pools: 2,
    });

    vi.spyOn(managementClient, 'fetchLicenseStatus').mockResolvedValue({
      ok: true,
      status: 'active',
      tier: 'PRO',
      machine_id: 'CPA-TEST-1234-ABCD',
      days_remaining: 365,
    });

    vi.spyOn(managementClient, 'fetchManifest').mockResolvedValue({
      ok: true,
      pools: [{ id: 'Pool-01-gemini' }, { id: 'Pool-02-gemini' }],
      accounts: [{ email: 'acc1@gmail.com', is_cooling: false }, { email: 'acc2@gmail.com', is_cooling: true }],
      telemetry: [],
    });

    vi.spyOn(managementClient, 'fetchAuditLog').mockResolvedValue({
      ok: true,
      timeline: [{ type: 'failover' }, { type: 'rotation' }, { type: 'survival' }],
    });

    vi.spyOn(managementClient, 'fetchAgentMatrix').mockResolvedValue({
      ok: true,
      harnesses: [{ id: 'gentle_shell' }, { id: 'gentle_pi' }],
    });
  });

  it('renders hero title, logo, and subtitle correctly', () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    expect(screen.getByTestId('home-hero-logo')).toBeTruthy();
    expect(screen.getByText('cpamc Auto Switcher Pro')).toBeTruthy();
    expect(screen.getByText(/¿De qué se trata\?/i)).toBeTruthy();
  });

  it('renders dynamic KPI cards (License, Machine ID, Version, Status, Pools, Telemetry)', async () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    expect(screen.getByTestId('kpi-license')).toBeTruthy();
    expect(screen.getByTestId('kpi-machine-id')).toBeTruthy();
    expect(screen.getByTestId('kpi-version')).toBeTruthy();
    expect(screen.getByTestId('kpi-status')).toBeTruthy();
    expect(screen.getByTestId('kpi-pools')).toBeTruthy();
    expect(screen.getByTestId('kpi-telemetry')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('CPA-TEST-1234-ABCD')).toBeDefined();
      expect(screen.getByText('v0.1.1')).toBeDefined();
      expect(screen.getByText('✓ Al día')).toBeDefined();
      expect(screen.getAllByText('2 Pools').length).toBeGreaterThan(0);
      expect(screen.getAllByText('3 Eventos').length).toBeGreaterThan(0);
    });
  });

  it('shows update available badge with link when a newer release exists on GitHub', async () => {
    vi.spyOn(managementClient, 'fetchPluginVersion').mockResolvedValue({
      ok: true,
      current_version: '0.1.1',
      current_tag: 'v0.1.1',
      latest_tag: 'v0.2.0',
      update_available: true,
      github_repo: 'WiloxDev/cpamc-auto-switcher-pro',
      releases_url: 'https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases',
    });

    render(<HomeCenter onNavigateTab={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/⚡ Actualizar a v0.2.0/i)).toBeDefined();
    });
  });

  it('allows copying the Machine ID to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<HomeCenter onNavigateTab={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('CPA-TEST-1234-ABCD')).toBeDefined();
    });

    const copyBtn = screen.getByTestId('btn-copy-machine-id');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('CPA-TEST-1234-ABCD');
  });

  it('renders all menu cards and triggers onNavigateTab on click', () => {
    const navigateMock = vi.fn();
    render(<HomeCenter onNavigateTab={navigateMock} />);

    // Test clicking on Crear Group / Perfiles card
    const cardGroup = screen.getByTestId('menu-card-create-groups');
    expect(cardGroup).toBeTruthy();
    fireEvent.click(cardGroup);
    expect(navigateMock).toHaveBeenCalledWith('create-groups');

    // Test clicking on Auto Auth Files card
    const cardAuth = screen.getByTestId('menu-card-auto-auth-files');
    fireEvent.click(cardAuth);
    expect(navigateMock).toHaveBeenCalledWith('auto-auth-files');

    // Test clicking on Control Switcher
    const cardSwitcher = screen.getByTestId('menu-card-switcher');
    fireEvent.click(cardSwitcher);
    expect(navigateMock).toHaveBeenCalledWith('switcher');
  });
});
