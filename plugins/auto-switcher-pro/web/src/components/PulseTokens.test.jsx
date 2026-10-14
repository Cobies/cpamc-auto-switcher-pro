import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PulseTokens from './PulseTokens';

describe('PulseTokens Component - Telemetry Dashboard & Kaizen Engine', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders all 5 KPI cards with canonical calculations', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('pulse-tokens-view')).toBeTruthy();
    });

    // KPI 1: Tokens Quemados ≈ 253.65M
    const kpiTokens = screen.getByTestId('kpi-total-tokens');
    expect(kpiTokens.textContent).toContain('253.65 M');
    expect(kpiTokens.textContent).toContain('252.73M');

    // KPI 2: Valor Retail ≈ $9.32
    const kpiRetail = screen.getByTestId('kpi-retail-value');
    expect(kpiRetail.textContent).toContain('$9.32');

    // KPI 3: Latencia percentil p50 ≈ 10.79s
    const kpiLatency = screen.getByTestId('kpi-latency');
    expect(kpiLatency.textContent).toContain('10.79 s');

    // KPI 4: Requests atendidos ≈ 2,326
    const kpiReqs = screen.getByTestId('kpi-requests');
    expect(kpiReqs.textContent).toContain('2,326');
    expect(kpiReqs.textContent).toContain('10 ⚠️');

    // KPI 5: Eficiencia de caché ≈ 86.1%
    const kpiCache = screen.getByTestId('kpi-cache-efficiency');
    expect(kpiCache.textContent).toContain('86.1 %');
    expect(kpiCache.textContent).toContain('$7.71');
  });

  it('renders timeline, providers, models, and accounts sections', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-section')).toBeTruthy();
      expect(screen.getByTestId('providers-section')).toBeTruthy();
      expect(screen.getByTestId('models-section')).toBeTruthy();
      expect(screen.getByTestId('accounts-section')).toBeTruthy();
      expect(screen.getByTestId('maintenance-section')).toBeTruthy();
    });

    // Comprobar que Antigravity está en la tabla de proveedores
    expect(screen.getByText('Antigravity')).toBeTruthy();
    // Comprobar que Gemini está en la tabla de modelos
    expect(screen.getByText('gemini-3.8-flash-high')).toBeTruthy();
  });

  it('toggles stream-safe mode and masks sensitive credentials', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('accounts-section')).toBeTruthy();
    });

    // Con stream-safe activo por defecto, el email está enmascarado
    expect(screen.getAllByText(/m\*\*\*@gmail\.com/).length).toBeGreaterThan(0);

    // Apagar stream-safe
    const toggleBtn = screen.getByTestId('toggle-stream-safe');
    fireEvent.click(toggleBtn);

    // Debe mostrar el email real
    expect(screen.getAllByText(/maribelluz@gmail\.com/).length).toBeGreaterThan(0);
  });

  it('opens and interacts with the Export dropdown menu', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-export-dropdown')).toBeTruthy();
    });

    const exportBtn = screen.getByTestId('btn-export-dropdown');
    fireEvent.click(exportBtn);

    // Comprobar las 4 opciones de exportación
    expect(screen.getByTestId('export-json')).toBeTruthy();
    expect(screen.getByTestId('export-csv-timeline')).toBeTruthy();
    expect(screen.getByTestId('export-csv-accounts')).toBeTruthy();
    expect(screen.getByTestId('export-markdown')).toBeTruthy();

    // Simular clic en exportar JSON
    fireEvent.click(screen.getByTestId('export-json'));
  });

  it('supports drill-down filtering by provider and hour', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByText('Antigravity')).toBeTruthy();
    });

    // Clic en Antigravity para filtrar
    fireEvent.click(screen.getByText('Antigravity'));

    // Debe aparecer la barra de chips de filtro
    await waitFor(() => {
      expect(screen.getByTestId('active-drill-filters').textContent).toContain('Proveedor: antigravity');
    });

    // Limpiar filtros
    fireEvent.click(screen.getByText('Limpiar filtros'));
    expect(screen.queryByTestId('active-drill-filters')).toBeNull();
  });

  it('opens error inspection modal when clicking on failed requests', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('kpi-requests')).toBeTruthy();
    });

    const failCount = screen.getByText(/10 ⚠️/);
    fireEvent.click(failCount);

    await waitFor(() => {
      expect(screen.getByTestId('error-modal')).toBeTruthy();
      expect(screen.getByText('Rate Limit Exceeded')).toBeTruthy();
    });
  });

  it('requires two-step RESET confirmation before enabling database wipe', async () => {
    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-open-reset-modal')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('btn-open-reset-modal'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-modal')).toBeTruthy();
    });

    const confirmBtn = screen.getByTestId('btn-confirm-reset');
    expect(confirmBtn.disabled).toBe(true);

    // Escribir texto erróneo
    const input = screen.getByTestId('input-reset-confirm');
    fireEvent.change(input, { target: { value: 'borrar' } });
    expect(confirmBtn.disabled).toBe(true);

    // Escribir RESET
    fireEvent.change(input, { target: { value: 'RESET' } });
    expect(confirmBtn.disabled).toBe(false);
  });

  it('homologates sovereign pools and live metrics from rotations.db', async () => {
    const mgmt = await import('../api/managementClient');
    vi.spyOn(mgmt, 'apiFetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        totals: {
          total_requests: 120,
          leader_requests: 115,
          failover_rescues: 5,
          failover_rate_pct: 4.16,
        },
        timeline_hourly: [
          { hour: '14:00', requests: 120, failovers: 5 }
        ],
        pools: [
          {
            pool_id: 'Pool-01-gemini',
            pool_prefix: 'agy',
            family: 'gemini_pure',
            model: 'gemini-3.8-flash-high',
            requests: 120,
            failovers: 5,
          }
        ],
        accounts: [
          {
            email: 'active-leader@gmail.com',
            pool_id: 'Pool-01-gemini',
            pool_prefix: 'agy',
            role: 'Líder (Pool-01-gemini)',
            requests: 115,
            share_pct: 95.8,
            status: 'Activa',
          },
          {
            email: 'reserve-one@gmail.com',
            pool_id: 'Pool-01-gemini',
            pool_prefix: 'agy',
            role: 'Reserva 1 (Pool-01-gemini)',
            requests: 5,
            share_pct: 4.2,
            status: 'Rescató peticiones por 429',
          }
        ],
        database: {
          path: 'plugins/rotations.db',
          mode: 'WAL',
          records: 120,
          size_kb: 48,
        }
      })
    });

    render(<PulseTokens />);

    await waitFor(() => {
      expect(screen.getByTestId('pulse-tokens-view')).toBeTruthy();
    });

    // Validar que se renderiza el pool soberano con su badge
    expect(screen.getAllByText(/Pool-01-gemini/).length).toBeGreaterThan(0);
    // Validar que se muestran las cuentas reales vinculadas al pool
    expect(screen.getByText(/Líder \(Pool-01-gemini\)/)).toBeTruthy();
  });
});
