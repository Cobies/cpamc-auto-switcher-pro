import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ControlSwitcher from './ControlSwitcher';
import * as managementClient from '../api/managementClient';

describe('ControlSwitcher Component - TDD Contract & Reserves List', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all reserve accounts in queue for Gemini 1, Gemini 2, and Sonnet pools', async () => {
    // Mock apiFetch to supply realistic auth-files and quotas
    const mockAuthFiles = [
      // Gemini 1
      { name: 'antigravity-g1-maribelluz.json', email: 'mar...tro@gmail.com', note: 'agy_g1', provider: 'antigravity' },
      { name: 'antigravity-g1-wilsonlavio7.json', email: 'wil...io7@gmail.com', note: 'agy_g1_1', provider: 'antigravity' },
      { name: 'antigravity-g1-wilsonlavio11.json', email: 'wil...o11@gmail.com', note: 'agy_g1_2', provider: 'antigravity' },

      // Gemini 2
      { name: 'antigravity-g2-infosoytec.json', email: 'inf...tec@gmail.com', note: 'agy_g2', provider: 'antigravity' },
      { name: 'antigravity-g2-infowilsonlavio.json', email: 'inf...vio@gmail.com', note: 'agy_g2_1', provider: 'antigravity' },
      { name: 'antigravity-g2-wilsonlavio9.json', email: 'wil...io9@gmail.com', note: 'agy_g2_2', provider: 'antigravity' },

      // Sonnet
      { name: 'antigravity-son-infosoytec.json', email: 'inf...tec@gmail.com', note: 'agy_son', provider: 'antigravity' },
      { name: 'antigravity-son-maribelluz.json', email: 'mar...tro@gmail.com', note: 'agy_son_1', provider: 'antigravity' },
      { name: 'antigravity-son-wilsonlavio11.json', email: 'wil...o11@gmail.com', note: 'agy_son_2', provider: 'antigravity' },
      { name: 'antigravity-son-wilsonlavio7.json', email: 'wil...io7@gmail.com', note: 'agy_son_3', provider: 'antigravity' },
      { name: 'antigravity-son-infowilsonlavio.json', email: 'inf...vio@gmail.com', note: 'agy_son_4', provider: 'antigravity' },
      { name: 'antigravity-son-wilsonlavio9.json', email: 'wil...io9@gmail.com', note: 'agy_son_5', provider: 'antigravity' },
    ];

    vi.spyOn(managementClient, 'apiFetch').mockImplementation((endpoint) => {
      if (endpoint === '/v0/management/auth-files') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ files: mockAuthFiles }),
        });
      }
      if (endpoint.includes('/download')) {
        const url = new URL(endpoint, 'http://localhost');
        const name = url.searchParams.get('name');
        const item = mockAuthFiles.find((f) => f.name === name);
        return Promise.resolve({
          ok: true,
          json: async () => ({ prefix: item?.note || '', note: item?.note || '', email: item?.email }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    render(<ControlSwitcher />);

    // 1. Debe mostrar los títulos de pools
    expect(await screen.findByText('Gemini 1 (Subagentes & Velocidad)')).toBeTruthy();
    expect(screen.getByText('Gemini 2 (Chat & Interactivo)')).toBeTruthy();
    expect(screen.getByText('Sonnet (Arquitectura & Razonamiento)')).toBeTruthy();

    // 2. Debe mostrar la cabecera CUENTAS DE RESERVA en cada tarjeta
    const reserveHeaders = screen.getAllByText('CUENTAS DE RESERVA');
    expect(reserveHeaders.length).toBe(3);

    // 3. Debe mostrar los conteos exactos de la cola
    expect(screen.getAllByText('2 EN COLA').length).toBe(2);
    expect(screen.getByText('5 EN COLA')).toBeTruthy();

    // 4. Debe listar todas las cuentas de reserva con sus prefijos visibles
    expect(screen.getByText('agy_g1_1')).toBeTruthy();
    expect(screen.getByText('agy_g1_2')).toBeTruthy();
    expect(screen.getByText('agy_g2_1')).toBeTruthy();
    expect(screen.getByText('agy_g2_2')).toBeTruthy();
    expect(screen.getByText('agy_son_1')).toBeTruthy();
    expect(screen.getByText('agy_son_2')).toBeTruthy();
    expect(screen.getByText('agy_son_3')).toBeTruthy();
    expect(screen.getByText('agy_son_4')).toBeTruthy();
    expect(screen.getByText('agy_son_5')).toBeTruthy();

    // 5. Debe identificar y colocar la insignia ⭐ MEJOR CANDIDATA
    const bestBadges = screen.getAllByText('⭐ MEJOR CANDIDATA');
    expect(bestBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('dynamically discovers and renders custom pools beyond canonical g1, g2, son', async () => {
    const mockAuthFiles = [
      { name: 'antigravity-g1-main.json', email: 'g1@test.com', note: 'agy_g1', provider: 'antigravity' },
      // Custom pool g3
      { name: 'antigravity-g3-main.json', email: 'g3@test.com', note: 'agy_g3', provider: 'antigravity' },
      { name: 'antigravity-g3-res1.json', email: 'g3-res@test.com', note: 'agy_g3_1', provider: 'antigravity' },
      // Custom pool codex dev
      { name: 'codex-dev-main.json', email: 'codex@test.com', note: 'codex_dev', provider: 'codex' },
    ];

    vi.spyOn(managementClient, 'apiFetch').mockImplementation((endpoint) => {
      if (endpoint === '/v0/management/auth-files') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ files: mockAuthFiles }),
        });
      }
      if (endpoint.includes('/download')) {
        const url = new URL(endpoint, 'http://localhost');
        const name = url.searchParams.get('name');
        const item = mockAuthFiles.find((f) => f.name === name);
        return Promise.resolve({
          ok: true,
          json: async () => ({ prefix: item?.note || '', note: item?.note || '', email: item?.email }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    render(<ControlSwitcher />);

    // Debe descubrir dinámicamente el pool g3 y codex_dev
    expect(await screen.findByText(/Gemini 3|Pool G3/i)).toBeTruthy();
    expect(screen.getByText(/Codex \(DEV\)|Pool DEV/i)).toBeTruthy();
    // La reserva de g3 debe aparecer en cola
    expect(screen.getByText('agy_g3_1')).toBeTruthy();
  });

  it('renders Spectral TrueColor 8-cell gauge with ▰ and ▱ glyphs and dynamic percentage colors', async () => {
    const mockAuthFiles = [
      { name: 'antigravity-g1-main.json', email: 'g1@test.com', note: 'agy_g1', provider: 'antigravity' },
    ];

    vi.spyOn(managementClient, 'apiFetch').mockImplementation((endpoint) => {
      if (endpoint === '/v0/management/auth-files') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ files: mockAuthFiles }),
        });
      }
      if (endpoint.includes('/download')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ prefix: 'agy_g1', note: 'agy_g1', email: 'g1@test.com' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    render(<ControlSwitcher />);

    // Las barras espectrales deben estar renderizadas con los glifos ▰ y/o ▱
    const spectralBars = await screen.findAllByTestId(/spectral-gauge/i);
    expect(spectralBars.length).toBeGreaterThanOrEqual(2);

    // Debe contener glifos de barra espectral
    const textContent = spectralBars[0].textContent;
    expect(textContent.includes('▰') || textContent.includes('▱')).toBe(true);
  });
});
