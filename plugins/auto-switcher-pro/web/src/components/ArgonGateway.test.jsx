import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ArgonGateway from './ArgonGateway';
import * as managementClient from '../api/managementClient';

describe('ArgonGateway Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header and offline daemon status when daemon is offline', async () => {
    vi.spyOn(managementClient, 'getArgonStatus').mockResolvedValue({
      ok: true,
      daemon_status: 'offline',
      daemon_url: 'http://127.0.0.1:8319',
      is_busy: false,
      memory_mb: 0,
      accounts: [
        {
          account_id: 'argon_u0',
          authuser: '0',
          email: 'gemini-argon-default@google.com',
          status: 'ready',
          quota_pct: 100,
          has_cookies: false,
        },
      ],
      total_active: 1,
      in_cooldown: 0,
      message: 'Daemon companion Playwright offline en puerto 8319.',
    });

    render(<ArgonGateway />);

    expect(screen.getByTestId('argon-gateway')).toBeTruthy();
    expect(screen.getByText('Gemini 4 Argon Gateway')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Playwright Daemon Offline')).toBeTruthy();
    });

    expect(screen.getByText(/Sincronizador 1-Click/i)).toBeTruthy();
    expect(screen.getByText(/Normalización Sintética de Herramientas Activa/i)).toBeTruthy();
    expect(screen.getByTestId('argon-faq-section')).toBeTruthy();
    expect(screen.getByText(/Gemini Web vs Flota Antigravity/i)).toBeTruthy();
    expect(screen.getByText(/Latencia Honesta \(15s – 60s\)/i)).toBeTruthy();
    expect(screen.getByText(/Ciclo de Vida de Cookies/i)).toBeTruthy();
    expect(screen.getByText('gemini-argon-default@google.com')).toBeTruthy();
  });

  it('renders online daemon status with accounts in cooldown', async () => {
    vi.spyOn(managementClient, 'getArgonStatus').mockResolvedValue({
      ok: true,
      daemon_status: 'online',
      daemon_url: 'http://127.0.0.1:8319',
      is_busy: false,
      memory_mb: 135.5,
      accounts: [
        {
          account_id: 'argon_u0',
          authuser: '0',
          email: 'user1@google.com',
          status: 'ready',
          quota_pct: 100,
          has_cookies: true,
        },
        {
          account_id: 'argon_u1',
          authuser: '1',
          email: 'user2@google.com',
          status: 'cooldown',
          quota_pct: 0,
          reset_at: '19:45:00',
          reset_seconds: 1800,
          has_cookies: true,
          error_message: 'Has alcanzado el límite diario',
        },
      ],
      total_active: 1,
      in_cooldown: 1,
      message: 'Argon Gateway activo.',
    });

    render(<ArgonGateway />);

    await waitFor(() => {
      expect(screen.getByText('Playwright Daemon Activo')).toBeTruthy();
      expect(screen.getByText('19:45:00')).toBeTruthy();
      expect(screen.getByText('user2@google.com')).toBeTruthy();
    });
  });

  it('allows opening manual cookie input and submitting a session', async () => {
    vi.spyOn(managementClient, 'getArgonStatus').mockResolvedValue({
      ok: true,
      daemon_status: 'offline',
      accounts: [],
      total_active: 0,
      in_cooldown: 0,
    });

    const syncSpy = vi.spyOn(managementClient, 'syncArgonSession').mockResolvedValue({
      ok: true,
      account: {
        account_id: 'argon_u0',
        authuser: '0',
        email: 'manual@google.com',
        status: 'ready',
        quota_pct: 100,
      },
      message: 'Sesión sincronizada exitosamente.',
    });

    render(<ArgonGateway />);

    // Click open manual input
    const toggleBtn = screen.getByText('🔑 Pegado Manual de Cookies');
    fireEvent.click(toggleBtn);

    const textarea = screen.getByPlaceholderText(/Pega aquí document.cookie/i);
    fireEvent.change(textarea, { target: { value: '__Secure-1PSID=token_abc_123;' } });

    const submitBtn = screen.getByText('Sincronizar Sesión en Caliente');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cookies: '__Secure-1PSID=token_abc_123;',
          authuser: '0',
          save_to_disk: true,
        })
      );
    });
  });
});
