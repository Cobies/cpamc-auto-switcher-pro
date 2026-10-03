import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GroupManager from './GroupManager';
import * as managementClient from '../api/managementClient';

describe('GroupManager Component - Dedicated Full Screen Pool & Group Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockFullyAssignedNodes = [
    {
      id: 'acc1',
      data: {
        fileName: 'antigravity-g1-wilsonlavio7.json',
        email: 'wil...io7@gmail.com',
        prefix: 'agy_g1',
        provider: 'antigravity',
      },
    },
    {
      id: 'acc2',
      data: {
        fileName: 'antigravity-g1-maribelluz.json',
        email: 'mar...tro@gmail.com',
        prefix: 'agy_g1_1',
        provider: 'antigravity',
      },
    },
  ];

  it('renders the exact high-contrast empty notice when no free accounts are available', () => {
    render(<GroupManager nodes={mockFullyAssignedNodes} />);

    expect(screen.getByTestId('empty-free-nodes-alert')).toBeTruthy();
    expect(screen.getByText('No hay cuentas libres disponibles')).toBeTruthy();
    expect(
      screen.getByText(/Todas las cuentas están asignadas a grupos existentes/i)
    ).toBeTruthy();
  });

  it('allows structuring a new pool when free accounts exist and generates cascade previews', async () => {
    const nodesWithFree = [
      ...mockFullyAssignedNodes,
      {
        id: 'free1',
        data: {
          fileName: 'account-free-1.json',
          email: 'free1@test.com',
          prefix: '',
          provider: 'antigravity',
        },
      },
      {
        id: 'free2',
        data: {
          fileName: 'account-free-2.json',
          email: 'free2@test.com',
          prefix: '',
          provider: 'antigravity',
        },
      },
    ];

    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'account-free-1.json', prefix: 'agy_g3' }],
      failed: [],
    });

    render(<GroupManager nodes={nodesWithFree} />);

    // Renders builder card
    expect(screen.getByTestId('input-group-base-prefix')).toBeTruthy();

    // Fill base prefix
    const baseInput = screen.getByTestId('input-group-base-prefix');
    fireEvent.change(baseInput, { target: { value: 'agy_g3' } });

    // Select Principal / Root account
    const selectActive = screen.getByTestId('select-active-account');
    fireEvent.change(selectActive, { target: { value: 'free1' } });

    // Check Live Preview displays root
    expect(screen.getByTestId('preview-node-root')).toBeTruthy();

    // Select free2 as reserve
    const reserveItem = screen.getByTestId('reserve-item-free2');
    fireEvent.click(reserveItem);

    // Live preview shows reserve with _1
    expect(screen.getByTestId('preview-node-reserve-0')).toBeTruthy();

    // Submit group
    const saveBtn = screen.getByTestId('btn-save-group');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'account-free-1.json', prefix: 'agy_g3' },
        { name: 'account-free-2.json', prefix: 'agy_g3_1' },
      ]);
    });
  });

  it('allows switching to dissolve tab and releasing existing pool accounts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [],
      failed: [],
    });

    render(<GroupManager nodes={mockFullyAssignedNodes} />);

    // Click on dissolve tab
    fireEvent.click(screen.getByTestId('tab-disolver-pools'));

    expect(screen.getByTestId('dissolve-pools-grid')).toBeTruthy();
    expect(screen.getByTestId('pool-card-agy_g1')).toBeTruthy();

    const dissolveBtn = screen.getByTestId('btn-dissolve-pool-agy_g1');
    fireEvent.click(dissolveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'antigravity-g1-wilsonlavio7.json', prefix: '' },
        { name: 'antigravity-g1-maribelluz.json', prefix: '' },
      ]);
    });
  });
});
