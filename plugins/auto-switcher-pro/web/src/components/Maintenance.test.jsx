import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Maintenance from './Maintenance';
import * as managementClient from '../api/managementClient';

describe('Maintenance Component - Centro Dinámico de Acciones y Resolución', () => {
  it('renders header, phase selector starting ENABLED (4 of 4), and resolution center in standby', () => {
    render(<Maintenance />);
    expect(screen.getByText('Salud & Diagnóstico de la Plataforma')).toBeTruthy();
    expect(screen.getByTestId('maintenance-phase-selector')).toBeTruthy();
    expect(screen.getByTestId('resolution-center')).toBeTruthy();
    expect(screen.getByTestId('resolution-initial')).toBeTruthy();

    const chkAuth = screen.getByTestId('chk-phase-auth');
    const chkModels = screen.getByTestId('chk-phase-models');
    expect(chkAuth.checked).toBe(true);
    expect(chkModels.checked).toBe(true);

    const btnScan = screen.getByTestId('btn-scan-health');
    expect(btnScan.disabled).toBe(false);
    expect(btnScan.textContent).toContain('(4 de 4 módulos seleccionados)');
  });

  it('displays dynamic incident cards when problems exist across multiple modules', async () => {
    vi.spyOn(managementClient, 'scanSystemHealth').mockResolvedValue({
      ok: true,
      timestamp: '2026-10-10T12:00:00Z',
      total_auth_files: 8,
      orphan_clones: ['orphan_01.json'],
      active_pools_count: 2,
      residual_accounts: [
        {
          file_name: 'account-alpha.json',
          total_excluded: 244,
          foreign_excluded: 244,
          foreign_sample: ['provider/model-alpha'],
        },
      ],
      console_version_local: 'fc00ba93',
      console_latest_github: 'v1.27.0',
      console_update_available: true,
      message: 'Escaneo completado con observaciones',
    });

    render(<Maintenance />);
    fireEvent.click(screen.getByTestId('btn-scan-health'));

    await waitFor(() => {
      expect(screen.getByTestId('resolution-incidents-active')).toBeTruthy();
      expect(screen.getByTestId('incident-models')).toBeTruthy();
      expect(screen.getByTestId('incident-orphans')).toBeTruthy();
      expect(screen.getByTestId('incident-console')).toBeTruthy();

      expect(screen.getByTestId('console-current-version').textContent).toBe('fc00ba93');
      expect(screen.getByTestId('console-target-version').textContent).toBe('v1.27.0');

      const kpiConsole = screen.getByTestId('kpi-console');
      expect(kpiConsole.textContent).toContain('fc00ba93 ➔ v1.27.0');
      expect(kpiConsole.textContent).toContain('Instalada: fc00ba93 | Disponible: v1.27.0');

      const btnClean = screen.getByTestId('btn-clean-residuals');
      expect(btnClean.disabled).toBe(false);
      expect(btnClean.textContent).toContain('Depurar y Restaurar 1 Cuenta(s)');

      const btnPurge = screen.getByTestId('btn-purge-orphans');
      expect(btnPurge.disabled).toBe(false);
      expect(btnPurge.textContent).toContain('Purgar 1 Archivo(s) Huérfano(s)');

      const btnUpdate = screen.getByTestId('btn-update-console');
      expect(btnUpdate.disabled).toBe(false);
      expect(btnUpdate.textContent).toContain('Actualizar a v1.27.0');
    });
  });

  it('displays generic clean and healthy summary when all 4 modules are 100% optimal', async () => {
    vi.spyOn(managementClient, 'scanSystemHealth').mockResolvedValue({
      ok: true,
      total_auth_files: 4,
      orphan_clones: [],
      active_pools_count: 2,
      residual_accounts: [],
      console_version_local: 'fc00ba93',
      console_latest_github: 'fc00ba93',
      console_update_available: false,
    });

    render(<Maintenance />);
    fireEvent.click(screen.getByTestId('btn-scan-health'));

    await waitFor(() => {
      expect(screen.getByTestId('resolution-all-healthy')).toBeTruthy();
      expect(screen.getByText('Todos los Módulos Auditados en Estado Óptimo')).toBeTruthy();

      const btnStandby = screen.getByTestId('btn-clean-residuals');
      expect(btnStandby.disabled).toBe(true);
      expect(btnStandby.textContent).toContain('No se requiere ninguna acción correctiva');
    });
  });

  it('invokes cleanSystemResidues on click when model incidents exist after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(managementClient, 'scanSystemHealth').mockResolvedValue({
      ok: true,
      total_auth_files: 4,
      residual_accounts: [{ file_name: 'acc.json', foreign_excluded: 5 }],
    });
    const cleanSpy = vi.spyOn(managementClient, 'cleanSystemResidues').mockResolvedValue({
      ok: true,
      cleaned_files: ['acc.json'],
    });

    render(<Maintenance />);
    fireEvent.click(screen.getByTestId('btn-scan-health'));

    const cleanBtn = await screen.findByTestId('btn-clean-residuals');
    await waitFor(() => expect(cleanBtn.disabled).toBe(false));
    fireEvent.click(cleanBtn);

    await waitFor(() => {
      expect(cleanSpy).toHaveBeenCalled();
    });
  });

  it('invokes deleteAuthFile on orphan purge click after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(managementClient, 'scanSystemHealth').mockResolvedValue({
      ok: true,
      total_auth_files: 5,
      orphan_clones: ['clone-orphan.json'],
      residual_accounts: [],
    });
    const deleteSpy = vi.spyOn(managementClient, 'deleteAuthFile').mockResolvedValue({ ok: true });

    render(<Maintenance />);
    fireEvent.click(screen.getByTestId('btn-scan-health'));

    const purgeBtn = await screen.findByTestId('btn-purge-orphans');
    fireEvent.click(purgeBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('clone-orphan.json');
    });
  });

  describe('SUBTAB-001: Sub-pestañas Diagnóstico General / Sincronización Tuerca & /model', () => {
    it('renders general tab by default and switches to sync tab hiding the classic modules', () => {
      render(<Maintenance />);
      expect(screen.getByTestId('maintenance-phase-selector')).toBeTruthy();
      expect(screen.queryByTestId('sync-view')).toBeNull();

      fireEvent.click(screen.getByTestId('subtab-sync'));
      expect(screen.getByTestId('sync-view')).toBeTruthy();
      expect(screen.getByTestId('sync-audit-panel')).toBeTruthy();
      expect(screen.getByTestId('sync-resolution-center')).toBeTruthy();
      expect(screen.queryByTestId('maintenance-phase-selector')).toBeNull();

      fireEvent.click(screen.getByTestId('subtab-general'));
      expect(screen.getByTestId('maintenance-phase-selector')).toBeTruthy();
      expect(screen.queryByTestId('sync-view')).toBeNull();
    });

    it('sync audit elects canonical leader per family, detects specialist Tuerca and projects /model catalog', async () => {
      vi.spyOn(managementClient, 'listPools').mockResolvedValue({
        ok: true,
        count: 2,
        pools: [
          {
            id: 'pool-agy2',
            family: 'gemini_pure',
            base_prefix: 'agy2',
            leader_auth: 'b.json',
            leader_email: 'b@x.com',
            policy: { target_models: ['gemini-3-flash', 'gemini-3.8-flash-high'] },
          },
          {
            id: 'pool-agy',
            family: 'gemini_pure',
            base_prefix: 'agy',
            leader_auth: 'a.json',
            leader_email: 'a@x.com',
            policy: { target_models: ['gemini-3-flash', 'gemini-3.8-flash-high'] },
          },
        ],
      });
      vi.spyOn(managementClient, 'loadAuthFilesWithPrefixes').mockResolvedValue([
        { name: 'a.json', prefix: 'agy', excluded_models: ['gemini-3-flash'] },
        { name: 'b.json', prefix: 'agy2', excluded_models: [] },
      ]);

      render(<Maintenance />);
      fireEvent.click(screen.getByTestId('subtab-sync'));
      fireEvent.click(screen.getByTestId('btn-sync-audit'));

      await waitFor(() => {
        // Pilar 1: Tuerca especialista detectada (1 modelo permitido de 2)
        const pillarTuerca = screen.getByTestId('pillar-tuerca');
        expect(pillarTuerca.textContent).toContain('Especialista');
        expect(pillarTuerca.textContent).toContain('gemini_pure');

        // Pilar 2: líder electo 'agy' (canónico) y 'agy2' sombreado
        const pillarLeaders = screen.getByTestId('pillar-leaders');
        expect(pillarLeaders.textContent).toContain('agy2');

        // Pilar 3: proyección /model con solo el modelo permitido por la Tuerca
        const pillarWatchdog = screen.getByTestId('pillar-watchdog');
        expect(pillarWatchdog.textContent).toContain('agy/gemini-3.8-flash-high');
        expect(screen.getByTestId('sync-projected-count').textContent).toContain('1 modelo(s)');

        // Centro de re-alineación: sin inconsistencias -> estado saludable
        expect(screen.getByTestId('sync-healthy')).toBeTruthy();
      });
    });

    it('shows re-align action when a Tuerca inconsistency (0 allowed models) is detected', async () => {
      vi.spyOn(managementClient, 'listPools').mockResolvedValue({
        ok: true,
        count: 1,
        pools: [
          {
            id: 'pool-x',
            family: 'gemini_pure',
            base_prefix: 'xpool',
            leader_auth: 'x.json',
            policy: { target_models: ['gemini-3-flash'] },
          },
        ],
      });
      vi.spyOn(managementClient, 'loadAuthFilesWithPrefixes').mockResolvedValue([
        { name: 'x.json', prefix: 'xpool', excluded_models: ['gemini-3-flash'] },
      ]);

      render(<Maintenance />);
      fireEvent.click(screen.getByTestId('subtab-sync'));
      fireEvent.click(screen.getByTestId('btn-sync-audit'));

      await waitFor(() => {
        expect(screen.getByTestId('sync-incidents')).toBeTruthy();
        const btnRealign = screen.getByTestId('btn-realign-all');
        expect(btnRealign.disabled).toBe(false);
        expect(btnRealign.textContent).toContain('Re-Alinear');
      });
    });
  });

  describe('MINI-001: Auto-Update Console Preference Checkbox', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('renders checkbox defaulting to checked when unconfigured and persists toggle to false', () => {
      render(<Maintenance />);
      const chk = screen.getByTestId('chk-auto-update-console');
      expect(chk).toBeTruthy();
      expect(chk.checked).toBe(true);

      fireEvent.click(chk);
      expect(chk.checked).toBe(false);
      expect(window.localStorage.getItem('auto_update_console_on_boot')).toBe('false');
    });

    it('initializes to unchecked when localStorage has "false" and toggles back to "true"', () => {
      window.localStorage.setItem('auto_update_console_on_boot', 'false');
      render(<Maintenance />);
      const chk = screen.getByTestId('chk-auto-update-console');
      expect(chk.checked).toBe(false);

      fireEvent.click(chk);
      expect(chk.checked).toBe(true);
      expect(window.localStorage.getItem('auto_update_console_on_boot')).toBe('true');
    });
  });
});

