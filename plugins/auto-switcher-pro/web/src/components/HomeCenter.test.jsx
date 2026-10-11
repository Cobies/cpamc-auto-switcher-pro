import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomeCenter from './HomeCenter';

describe('HomeCenter Component - Portada Principal & Directorio de Menús', () => {
  it('renders hero title, logo, and subtitle correctly', () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    expect(screen.getByTestId('home-hero-logo')).toBeTruthy();
    expect(screen.getByText('cpamc Auto Switcher Pro')).toBeTruthy();
    expect(screen.getByText(/¿De qué se trata\?/i)).toBeTruthy();
  });

  it('renders the 4 KPI cards (License, Machine ID, Version, Status)', () => {
    render(<HomeCenter onNavigateTab={vi.fn()} />);

    expect(screen.getByTestId('kpi-license')).toBeTruthy();
    expect(screen.getByText('PRO Vitalicio')).toBeTruthy();

    expect(screen.getByTestId('kpi-machine-id')).toBeTruthy();
    expect(screen.getByText('ASP-8F2A-99B1-4CD3')).toBeTruthy();

    expect(screen.getByTestId('kpi-version')).toBeTruthy();
    expect(screen.getByText('v2.4.0')).toBeTruthy();

    expect(screen.getByTestId('kpi-status')).toBeTruthy();
    expect(screen.getByText('Conectado')).toBeTruthy();
  });

  it('allows copying the Machine ID to clipboard', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<HomeCenter onNavigateTab={vi.fn()} />);

    const copyBtn = screen.getByTestId('btn-copy-machine-id');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('ASP-8F2A-99B1-4CD3');
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
