import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrefixManager from './PrefixManager';
import * as managementClient from '../api/managementClient';

describe('PrefixManager Component - Full Screen Prefix & Accounts Engine', () => {
  const mockNodes = [
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
    {
      id: 'acc3',
      data: {
        fileName: 'antigravity-son-infowilsonlavio.json',
        email: 'inf...vio@gmail.com',
        prefix: 'agy_son',
        provider: 'antigravity',
      },
    },
    {
      id: 'acc4',
      data: {
        fileName: 'unlinked-account.json',
        email: 'free@test.com',
        prefix: '',
        provider: 'antigravity',
      },
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all accounts and filters dynamically by Gemini and Claude families', () => {
    render(<PrefixManager nodes={mockNodes} />);

    expect(screen.getByTestId('prefix-manager-view')).toBeTruthy();
    expect(screen.getByText('wil...io7@gmail.com')).toBeTruthy();
    expect(screen.getByText('mar...tro@gmail.com')).toBeTruthy();
    expect(screen.getByText('inf...vio@gmail.com')).toBeTruthy();

    // Filtro por Gemini
    fireEvent.click(screen.getByTestId('filter-chip-gemini'));
    expect(screen.getByText('wil...io7@gmail.com')).toBeTruthy();
    expect(screen.getByText('mar...tro@gmail.com')).toBeTruthy();
    expect(screen.queryByText('inf...vio@gmail.com')).toBeNull();

    // Filtro por Claude
    fireEvent.click(screen.getByTestId('filter-chip-claude'));
    expect(screen.getByText('inf...vio@gmail.com')).toBeTruthy();
    expect(screen.queryByText('wil...io7@gmail.com')).toBeNull();
  });

  it('allows editing an individual prefix and saves via PATCH API', async () => {
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'unlinked-account.json', prefix: 'agy_g2' }],
      failed: [],
    });

    render(<PrefixManager nodes={mockNodes} />);

    const input = screen.getByTestId('input-prefix-acc4');
    fireEvent.change(input, { target: { value: 'agy_g2' } });

    const saveBtn = screen.getByTestId('btn-save-row-acc4');
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'unlinked-account.json', prefix: 'agy_g2' },
      ]);
    });
  });

  it('detects batch changes and enables Save Batch button', async () => {
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [
        { name: 'antigravity-g1-wilsonlavio7.json', prefix: 'agy_g1_custom' },
      ],
      failed: [],
    });

    render(<PrefixManager nodes={mockNodes} />);

    const input1 = screen.getByTestId('input-prefix-acc1');
    fireEvent.change(input1, { target: { value: 'agy_g1_custom' } });

    const batchSaveBtn = screen.getByTestId('btn-save-batch-prefixes');
    expect(batchSaveBtn).toBeTruthy();

    fireEvent.click(batchSaveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalled();
    });
  });
});
