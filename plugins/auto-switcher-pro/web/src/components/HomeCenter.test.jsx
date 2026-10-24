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
    expect(screen.getByTestId('home-anatomy-box')).toBeTruthy();
    expect(screen.getByText(/ANATOMÍA TÉCNICA DEL CÓDIGO/i)).toBeTruthy();
  });

  it('renders Top Estrella pillar by default and expands all 13 pillars on toggle click', () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    // Por defecto muestra el Pilar 1 (Top Estrella)
    expect(screen.getByTestId('pillar-item-1')).toBeTruthy();
    expect(screen.getByText(/Rescate instantáneo ante 429/i)).toBeTruthy();
    expect(screen.getByText(/Pools Soberanos para NVIDIA NIM & DeepSeek/i)).toBeTruthy();
    expect(screen.queryByTestId('pillar-item-2')).toBeNull();

    // Botón de expansión
    const toggleBtn = screen.getByTestId('btn-toggle-all-pillars');
    expect(toggleBtn.textContent).toContain('Ver arquitectura completa');

    // Clic para desplegar todos los 13 pilares
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId('pillar-item-2')).toBeTruthy();
    expect(screen.getByTestId('pillar-item-13')).toBeTruthy();
    expect(toggleBtn.textContent).toContain('Plegar a vista Top Estrella');

    // Clic para plegar de nuevo a la vista Top Estrella
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId('pillar-item-2')).toBeNull();
    expect(screen.getByTestId('pillar-item-1')).toBeTruthy();
  });

  it('renders dynamic unified cockpit bar (Version, License, Host ID) and 4 operational/sponsor KPIs', async () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    expect(screen.getByTestId('home-cockpit-bar')).toBeTruthy();
    expect(screen.getByTestId('kpi-status')).toBeTruthy();
    expect(screen.getByTestId('kpi-sponsor')).toBeTruthy();
    expect(screen.getByTestId('btn-home-sponsor')).toBeTruthy();
    expect(screen.getByTestId('kpi-pools')).toBeTruthy();
    expect(screen.getByTestId('kpi-telemetry')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('CPA-TEST-1234-ABCD')).toBeDefined();
      expect(screen.getByText('v0.1.1')).toBeDefined();
      expect(screen.getByText('✓ Estable')).toBeDefined();
      expect(screen.getByText('Pro Vitalicia')).toBeDefined();
      expect(screen.getByText(/☕ ¿Te salvó de un 429\?/i)).toBeDefined();
      expect(screen.getByText(/💖 Invitar un Café al Creador/i)).toBeDefined();
      expect(screen.getAllByText('2 Pools').length).toBeGreaterThan(0);
      expect(screen.getAllByText('3 Eventos').length).toBeGreaterThan(0);
    });
  });

  it('shows Free Tier and Activar Pro button when user does not have a Pro license', async () => {
    vi.spyOn(managementClient, 'fetchLicenseStatus').mockResolvedValue({
      ok: true,
      status: 'trial',
      tier: 'FREE',
      machine_id: 'CPA-TRIAL-9999',
      days_remaining: 30,
    });

    const openModalMock = vi.fn();
    render(<HomeCenter onNavigateTab={vi.fn()} onOpenLicenseModal={openModalMock} />);

    await waitFor(() => {
      expect(screen.getByText('Free Tier')).toBeDefined();
      expect(screen.getByTestId('btn-home-open-license')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('btn-home-open-license'));
    expect(openModalMock).toHaveBeenCalled();
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
