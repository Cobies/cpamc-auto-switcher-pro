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

  it('renders the exact high-contrast empty notice when no free accounts and no antigravity accounts exist', () => {
    const codexOnlyNodes = [
      { id: 'cx1', data: { fileName: 'codex-1.json', email: 'c...1@test.com', prefix: 'codex_p1', provider: 'codex' } },
      { id: 'cx2', data: { fileName: 'codex-2.json', email: 'c...2@test.com', prefix: 'codex_p1_1', provider: 'codex' } },
    ];
    render(<GroupManager nodes={codexOnlyNodes} />);

    expect(screen.getByTestId('empty-free-nodes-alert')).toBeTruthy();
    expect(screen.getByText('No hay cuentas libres disponibles')).toBeTruthy();
    expect(
      screen.getByText(/Todas las cuentas están asignadas a grupos existentes/i)
    ).toBeTruthy();
  });

  it('offers assigned antigravity accounts as candidates for in-place re-assignment to the sibling Gemini subtype', async () => {
    const pureNodes = [
      { id: 'acc1', data: { fileName: 'antigravity-acc1.json', email: 'a...1@x.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'acc2', data: { fileName: 'antigravity-acc2.json', email: 'a...2@x.com', prefix: 'agy_1', provider: 'antigravity' } },
    ];

    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: ['agy/gemini-3.8-flash-high', 'claude-sonnet-4-6'],
    });
    const patchPrefixesSpy = vi
      .spyOn(managementClient, 'saveAuthFilePrefixes')
      .mockResolvedValue({
        successful: [],
        failed: [],
      });
    vi.spyOn(managementClient, 'patchAuthFileExclusions').mockResolvedValue({ ok: true });
    const savePoolSpy = vi
      .spyOn(managementClient, 'savePool')
      .mockResolvedValue({
        ok: true,
        pool: { id: 'pool-1', base_prefix: 'agy_clau' },
        message: 'Pool agy_clau saved',
      });

    render(<GroupManager nodes={pureNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-claude'));

    const selectActive = screen.getByTestId('select-active-account');
    const optionIds = Array.from(selectActive.options).map((o) => o.value);
    expect(optionIds).toContain('acc1');
    expect(optionIds).toContain('acc2');

    fireEvent.change(selectActive, { target: { value: 'acc1' } });
    fireEvent.change(screen.getByTestId('input-group-base-prefix'), { target: { value: 'agy_clau' } });
    fireEvent.click(screen.getByTestId('reserve-item-acc2'));
    fireEvent.click(screen.getByTestId('btn-save-group'));

    // Los pools se guardan en el registro del plugin (savePool), sin clonar archivos físicos en disco
    await waitFor(() => expect(savePoolSpy).toHaveBeenCalledTimes(1));

    const savedPool = savePoolSpy.mock.calls[0][0];
    expect(savedPool.base_prefix).toBe('agy_clau');
    expect(savedPool.leader_auth).toBe('antigravity-acc1.json');
    expect(savedPool.reserves).toContain('antigravity-acc2.json');
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
      successful: [{ name: 'account-free-1.json', prefix: 'g3' }],
      failed: [],
    });

    render(<GroupManager nodes={nodesWithFree} />);

    // Family is now mandatory: pick Gemini first
    fireEvent.click(screen.getByTestId('family-gemini'));

    // Renders builder card
    expect(screen.getByTestId('input-group-base-prefix')).toBeTruthy();

    // Fill base prefix (family convention: g*)
    const baseInput = screen.getByTestId('input-group-base-prefix');
    fireEvent.change(baseInput, { target: { value: 'g3' } });

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
        { name: 'account-free-1.json', prefix: 'g3' },
        { name: 'account-free-2.json', prefix: 'g3_1' },
      ]);
    });
  });

  it('keeps account selector disabled until a family is chosen and lists swap dynamically when the leader changes', () => {
    const dynNodes = [
      { id: 'free1', data: { fileName: 'free1.json', email: 'free1@test.com', prefix: '', provider: 'antigravity' } },
      { id: 'free2', data: { fileName: 'free2.json', email: 'free2@test.com', prefix: '', provider: 'antigravity' } },
      { id: 'codex1', data: { fileName: 'codex1.json', email: 'codex1@test.com', prefix: '', provider: 'codex' } },
    ];
    render(<GroupManager nodes={dynNodes} />);

    // ② is disabled on load with a guiding placeholder
    const selectActive = screen.getByTestId('select-active-account');
    expect(selectActive.disabled).toBe(true);
    expect(selectActive.textContent).toContain('Elige primero la familia');

    // Reserves section also stays empty without family
    fireEvent.click(screen.getByTestId('family-claude'));
    expect(selectActive.disabled).toBe(false);

    // Claude family: only antigravity accounts, codex hidden
    fireEvent.change(selectActive, { target: { value: 'free1' } });
    expect(selectActive.value).toBe('free1');
    const reserveList = screen.getByTestId('reserves-container');
    expect(reserveList.textContent).not.toContain('free1@test.com'); // current leader never listed as its own reserve
    expect(reserveList.textContent).toContain('free2@test.com');
    expect(reserveList.textContent).not.toContain('codex1@test.com');

    // Switching the leader swaps the lists dynamically: free1 comes back as reserve candidate
    fireEvent.change(selectActive, { target: { value: 'free2' } });
    expect(screen.getByTestId('reserves-container').textContent).not.toContain('free2@test.com');
    expect(screen.getByTestId('reserves-container').textContent).toContain('free1@test.com');

    // Changing family invalidates the previous account selection
    fireEvent.click(screen.getByTestId('family-gemini'));
    expect(screen.getByTestId('select-active-account').value).toBe('');
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

  it('displays the actual parent/root prefix (e.g. [sonet]) with leader badge instead of bare literal [leader]', () => {
    const mockSonetPoolNodes = [
      {
        id: 'acc1',
        data: {
          fileName: 'antigravity-son-infosoytec.json',
          email: 'infosoytec@gmail.com',
          prefix: 'sonet',
          provider: 'antigravity',
        },
      },
      {
        id: 'acc2',
        data: {
          fileName: 'antigravity-son-infowilsonlavio.json',
          email: 'infowilsonlavio@gmail.com',
          prefix: 'sonet_1',
          provider: 'antigravity',
        },
      },
      {
        id: 'acc3',
        data: {
          fileName: 'antigravity-son-maribelluz.json',
          email: 'maribelluzbonita@gmail.com',
          prefix: 'sonet_2',
          provider: 'antigravity',
        },
      },
    ];

    render(<GroupManager nodes={mockSonetPoolNodes} />);

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));

    // Debe mostrar la tarjeta del pool "sonet"
    expect(screen.getByTestId('pool-card-sonet')).toBeTruthy();

    // El padre debe mostrar su prefijo explícito [sonet] y NO el texto plano [leader]
    expect(screen.getByText('[sonet]')).toBeTruthy();
    expect(screen.getByText('LEADER')).toBeTruthy();
    expect(screen.queryByText('[leader]')).toBeNull();

    // Las reservas deben mostrar sus prefijos respectivos
    expect(screen.getByText('[sonet_1]')).toBeTruthy();
    expect(screen.getByText('[sonet_2]')).toBeTruthy();
  });
});

describe('GroupManager - family-aware pools, honest failures & isolated routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const makeFreeNode = (id, email, provider = 'antigravity') => ({
    id,
    data: {
      fileName: `${id}.json`,
      email,
      prefix: '',
      provider,
    },
  });

  const baseNodes = [
    makeFreeNode('free1', 'free1@test.com'),
    makeFreeNode('free2', 'free2@test.com'),
    makeFreeNode('free3', 'free3@test.com'),
    makeFreeNode('codex1', 'codex1@test.com', 'codex'),
  ];

  it('shows family hint validation and hides incompatible provider accounts from the selectors', () => {
    render(<GroupManager nodes={baseNodes} />);

    // Select Gemini family via segmented control
    fireEvent.click(screen.getByTestId('family-gemini'));

    // Name that does not honor the g* convention triggers an inline warning
    const baseInput = screen.getByTestId('input-group-base-prefix');
    fireEvent.change(baseInput, { target: { value: 'team1' } });
    expect(screen.getByTestId('prefix-family-warning')).toBeTruthy();

    // Honor the convention -> warning disappears
    fireEvent.change(baseInput, { target: { value: 'g7' } });
    expect(screen.queryByTestId('prefix-family-warning')).toBeNull();

    // Codex accounts are excluded from the active-account selector for a Gemini family
    const options = Array.from(screen.getByTestId('select-active-account').options);
    expect(options.some((o) => o.value === 'codex1')).toBe(false);
    expect(options.some((o) => o.value === 'free1')).toBe(true);
  });

  it('skips reserve numbers whose prefixes already exist in the system', async () => {
    const nodesWithOrphanReserve = [
      {
        id: 'taken',
        data: { fileName: 'taken.json', email: 'taken@test.com', prefix: 'g9_1', provider: 'antigravity' },
      },
      makeFreeNode('free1', 'free1@test.com'),
      makeFreeNode('free2', 'free2@test.com'),
    ];

    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [],
      failed: [],
    });

    render(<GroupManager nodes={nodesWithOrphanReserve} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.change(screen.getByTestId('input-group-base-prefix'), { target: { value: 'g9' } });
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    fireEvent.click(screen.getByTestId('reserve-item-free2'));

    // Live preview shows the collision-free number _2 (g9_1 already taken)
    expect(screen.getByTestId('preview-node-reserve-0').textContent).toContain('g9_2');

    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'free1.json', prefix: 'g9' },
        { name: 'free2.json', prefix: 'g9_2' },
      ]);
    });
  });

  it('reports per-account failures with retry instead of fake success', async () => {
    const patchSpy = vi
      .spyOn(managementClient, 'saveAuthFilePrefixes')
      .mockResolvedValueOnce({
        successful: [{ name: 'free1.json', prefix: 'g8' }],
        failed: [{ name: 'free2.json', prefix: 'g8_1', error: '401 Unauthorized: key expired' }],
      })
      .mockResolvedValueOnce({
        successful: [
          { name: 'free1.json', prefix: 'g8' },
          { name: 'free2.json', prefix: 'g8_1' },
        ],
        failed: [],
      });

    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.change(screen.getByTestId('input-group-base-prefix'), { target: { value: 'g8' } });
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    fireEvent.click(screen.getByTestId('reserve-item-free2'));
    fireEvent.click(screen.getByTestId('btn-save-group'));

    // Honest partial-failure panel appears; no fake success message
    await waitFor(() => {
      expect(screen.getByTestId('pool-save-errors')).toBeTruthy();
    });
    expect(screen.getByTestId('pool-save-errors').textContent).toContain('free2.json');
    expect(screen.queryByText(/creado y guardado con éxito/i)).toBeNull();

    // Retry only re-sends the failed accounts
    fireEvent.click(screen.getByTestId('btn-retry-failed'));
    await waitFor(() => {
      expect(patchSpy).toHaveBeenLastCalledWith([{ name: 'free2.json', prefix: 'g8_1' }]);
    });
    await waitFor(() => {
      expect(screen.getByText(/creado y guardado con éxito/i)).toBeTruthy();
    });
  });

  it('dissolves deep descendants (grandchildren) together with direct members to avoid ghost pools', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [],
      failed: [],
    });

    const nodesWithGrandchild = [
      {
        id: 'root',
        data: { fileName: 'root.json', email: 'root@test.com', prefix: 'g1', provider: 'antigravity' },
      },
      {
        id: 'res1',
        data: { fileName: 'res1.json', email: 'res1@test.com', prefix: 'g1_1', provider: 'antigravity' },
      },
      {
        id: 'grand1',
        data: { fileName: 'grand1.json', email: 'grand1@test.com', prefix: 'g1_1_1', provider: 'antigravity' },
      },
      {
        id: 'other',
        data: { fileName: 'other.json', email: 'other@test.com', prefix: 'son1', provider: 'antigravity' },
      },
    ];

    render(<GroupManager nodes={nodesWithGrandchild} />);
    fireEvent.click(screen.getByTestId('tab-disolver-pools'));
    fireEvent.click(screen.getByTestId('btn-dissolve-pool-g1'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'root.json', prefix: '' },
        { name: 'res1.json', prefix: '' },
        { name: 'grand1.json', prefix: '' },
      ]);
    });

    // Unrelated pool (son1) must remain untouched
    expect(patchSpy.mock.calls[0][0].some((u) => u.name === 'other.json')).toBe(false);
  });

  it('smoke: with live-like data (no free antigravity accounts) the builder shows the info alert and never crashes', () => {
    const consoleErrors = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrors.push(args.map(String).join(' '));
    });

    const liveNodes = [
      { id: 'a1', data: { fileName: 'antigravity-maribelluz@gmail.com.json', email: 'maribelluz@gmail.com', prefix: 'g1', provider: 'antigravity' } },
      { id: 'a2', data: { fileName: 'antigravity-wilsonlavio7@gmail.com.json', email: 'wilsonlavio7@gmail.com', prefix: 'son1', provider: 'antigravity' } },
      { id: 'oc1', data: { fileName: 'opencode-go-e86ad5f80809.json', email: '', prefix: '', provider: 'opencode' } },
    ];

    render(
      <React.StrictMode>
        <GroupManager nodes={liveNodes} edges={[]} />
      </React.StrictMode>
    );

    // Sin cuentas gemini libres: solo la tarjeta Gemini LIBRE del master claude (modelo 2N)
    // se ofrece como candidata virtualizable; la de a1 ya está asignada a [g1].
    fireEvent.click(screen.getByTestId('family-gemini'));
    expect(screen.queryByTestId('no-compatible-accounts-alert')).toBeNull();
    const optionIds = Array.from(screen.getByTestId('select-active-account').options).map((o) => o.value);
    expect(optionIds).toContain('a2');
    expect(optionIds).not.toContain('a1');
    expect(screen.queryByTestId('btn-save-group').disabled).toBe(true);

    // Y no hay errores de consola reales
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('not wrapped in act') && !e.includes('Each child in a list')
    );
    expect(realErrors).toEqual([]);
    errSpy.mockRestore();
  });

  it('smoke: full real sequence (family -> leader -> reserve -> save -> routes) with free accounts logs no console errors', async () => {
    const consoleErrors = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrors.push(args.map(String).join(' '));
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Escenario armable: líder ocupado + dos cuentas antigravity libres (mínimo 2 requeridas)
    const liveNodes = [
      { id: 'a2', data: { fileName: 'antigravity-wilsonlavio7@gmail.com.json', email: 'wilsonlavio7@gmail.com', prefix: 'son1', provider: 'antigravity' } },
      { id: 'free1', data: { fileName: 'antigravity-newaccount@gmail.com.json', email: 'newaccount@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'free2', data: { fileName: 'antigravity-newaccount2@gmail.com.json', email: 'newaccount2@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'oc1', data: { fileName: 'opencode-go-e86ad5f80809.json', email: '', prefix: '', provider: 'opencode' } },
    ];

    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [
        { name: 'antigravity-newaccount@gmail.com.json', prefix: 'agy' },
        { name: 'antigravity-newaccount2@gmail.com.json', prefix: 'agy_1' },
      ],
      failed: [],
    });
    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: ['agy/gemini-3.8-flash-high', 'gemini-3.8-flash-high'],
    });

    const { unmount } = render(
      <React.StrictMode>
        <GroupManager nodes={liveNodes} edges={[]} onReloadRequested={async () => {}} />
      </React.StrictMode>
    );

    // Secuencia completa del usuario cumpliendo la regla de mínimo 2 cuentas
    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    fireEvent.click(screen.getByTestId('reserve-item-free2'));
    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalled();
    });

    unmount();
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('not wrapped in act') && !e.includes('Each child in a list')
    );
    expect(realErrors).toEqual([]);

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('reserves list stays empty until a leader is selected (family chosen but no leader yet)', () => {
    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));

    // Familia elegida pero SIN líder: no debe listarse ninguna reserva
    expect(screen.queryByTestId('reserves-container')).toBeNull();
    expect(screen.getByText('Selecciona primero una cuenta principal.')).toBeTruthy();

    // Tras elegir líder, las reservas compatibles aparecen (sin incluir al líder)
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    const reserveList = screen.getByTestId('reserves-container');
    expect(reserveList.textContent).toContain('free2@test.com');
    expect(reserveList.textContent).not.toContain('free1@test.com');
  });

  it('shows isolated prefix/model routes after a fully successful save', async () => {
    vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'free1.json', prefix: 'g5' }],
      failed: [],
    });
    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: [
        'g5/gemini-3.8-flash-high',
        'g5/gemini-3.7-flash-high',
        'g5/claude-opus-5-5-high',
        'g5/claude-sonnet-5-5-high',
        'gemini-3.8-flash-high',
        'son1/claude-sonnet-4-5',
      ],
    });

    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.change(screen.getByTestId('input-group-base-prefix'), { target: { value: 'g5' } });
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    fireEvent.click(screen.getByTestId('reserve-item-free2')); // Cumple regla de mínimo 2 cuentas
    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => {
      expect(screen.getByTestId('model-routes-panel')).toBeTruthy();
    });
    expect(screen.getByTestId('model-routes-panel').textContent).toContain('g5/gemini-3.8-flash-high');
    expect(screen.getByTestId('model-routes-panel').textContent).toContain('g5/gemini-3.7-flash-high');
    expect(screen.getByTestId('model-routes-panel').textContent).not.toContain('g5/claude'); // rutas filtradas por familia Gemini
    expect(screen.getByTestId('model-routes-panel').textContent).not.toContain('son1/claude');
    expect(screen.getByText(/la cuota NO se aísla/i)).toBeTruthy();
  });

  it('renders Gemini sub-families in the same column, switches to agy_clau and auto-increments for N groups', () => {
    const nodesWithExistingAgyClau = [
      { id: 'leader1', data: { fileName: 'ac1.json', email: 'ac1@test.com', prefix: 'agy_clau', provider: 'antigravity' } },
      { id: 'res1', data: { fileName: 'ac2.json', email: 'ac2@test.com', prefix: 'agy_clau_1', provider: 'antigravity' } },
      { id: 'free1', data: { fileName: 'free1.json', email: 'free1@test.com', prefix: '', provider: 'antigravity' } },
      { id: 'free2', data: { fileName: 'free2.json', email: 'free2@test.com', prefix: '', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={nodesWithExistingAgyClau} />);

    // Al seleccionar Gemini, se renderiza el sub-selector dentro de la misma columna
    fireEvent.click(screen.getByTestId('family-gemini'));
    expect(screen.getByTestId('gemini-subfamily-container')).toBeTruthy();
    expect(screen.getByTestId('subfamily-gemini-pure')).toBeTruthy();
    expect(screen.getByTestId('subfamily-gemini-claude')).toBeTruthy();

    // Por defecto es Gemini Puro -> sugiere agy
    expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy');

    // Cambiar a Claude del Paquete en la misma columna
    fireEvent.click(screen.getByTestId('subfamily-gemini-claude'));
    // Como 'agy_clau' ya existe en nodes, autoincrementa inteligentemente a 'agy_clau2'
    expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy_clau2');
  });

  it('provides model policy checkboxes to exclude 5.5 versions or disable isolation (wildcard mode)', async () => {
    let capturedExclusions = [];
    vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'leader.json', prefix: 'agy_son' }],
      failed: [],
    });
    vi.spyOn(managementClient, 'patchAuthFileExclusions').mockImplementation((fileName, oppositeModels) => {
      capturedExclusions = oppositeModels;
      return Promise.resolve({ ok: true });
    });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({
      ok: true,
      pool: { id: 'pool-1', base_prefix: 'agy_son' },
      message: 'Pool agy_son saved',
    });
    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: [
        'claude-sonnet-4-6',
        'claude-sonnet-5-5-high',
        'claude-opus-4-6-thinking',
        'claude-opus-5-5-high',
        'gemini-3.8-flash-high',
      ],
    });

    const testNodes = [
      { id: 'leader', data: { fileName: 'leader.json', email: 'leader@test.com', prefix: '', provider: 'antigravity' } },
      { id: 'occup', data: { fileName: 'occup.json', email: 'occup@test.com', prefix: 'agy', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={testNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-sonnet'));

    const chk55 = screen.getByTestId('checkbox-exclude-55');
    const selectSpec = screen.getByTestId('select-specialist-model');
    expect(chk55.checked).toBe(false);
    expect(selectSpec).toBeTruthy();

    fireEvent.click(chk55);
    expect(chk55.checked).toBe(true);

    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'leader' } });
    fireEvent.click(screen.getByTestId('reserve-item-occup'));

    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => {
      expect(screen.getByText(/creado y guardado con éxito/i)).toBeTruthy();
    });

    // En gobernanza virtual pura, las exclusiones de modelos no mutilan el archivo físico
    // sino que se guardan en la definición del pool en el registro del plugin
    await waitFor(() => expect(savePoolSpy).toHaveBeenCalledTimes(1));
    const savedPool = savePoolSpy.mock.calls[0][0];
    expect(savedPool.base_prefix).toBe('agy_son');
    expect(savedPool.policy.exclude_55).toBe(true);
    expect(savedPool.policy.excluded_models).toContain('claude-sonnet-5-5-high');
  });

  it('enforces specialist model selection (1 Pool = 1 Specialist Model) and computes opposite models in pool policy', async () => {
    vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'leader.json', prefix: 'agy_son' }],
      failed: [],
    });
    const patchExclusionsSpy = vi.spyOn(managementClient, 'patchAuthFileExclusions').mockResolvedValue({ ok: true });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({
      ok: true,
      pool: { id: 'pool-1', base_prefix: 'agy_son' },
      message: 'Pool agy_son saved',
    });
    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: [
        'claude-sonnet-4-6',
        'claude-sonnet-5-5-high',
        'claude-opus-4-6-thinking',
        'claude-opus-5-5-high',
        'gemini-3.8-flash-high',
      ],
    });

    const testNodes = [
      { id: 'leader', data: { fileName: 'leader.json', email: 'leader@test.com', prefix: '', provider: 'antigravity' } },
      { id: 'occup', data: { fileName: 'occup.json', email: 'occup@test.com', prefix: 'agy', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={testNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-sonnet'));

    const selectSpec = screen.getByTestId('select-specialist-model');
    fireEvent.change(selectSpec, { target: { value: 'claude-sonnet-4-6' } });
    expect(selectSpec.value).toBe('claude-sonnet-4-6');

    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'leader' } });
    fireEvent.click(screen.getByTestId('reserve-item-occup'));

    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => {
      expect(screen.getByText(/creado y guardado con éxito/i)).toBeTruthy();
    });

    // En gobernanza virtual pura, NO se parchea excluded_models en el disco para no mutilar
    // las credenciales nativas de CPAMC
    expect(patchExclusionsSpy).not.toHaveBeenCalled();

    // Y el registro del pool guarda target_models con exactamente 1 modelo y disable_isolation: false
    await waitFor(() => expect(savePoolSpy).toHaveBeenCalledTimes(1));
    const savedPool = savePoolSpy.mock.calls[0][0];
    expect(savedPool.policy.disable_isolation).toBe(false);
    expect(savedPool.policy.target_models).toEqual(['claude-sonnet-4-6']);
    expect(savedPool.policy.excluded_models).toContain('claude-sonnet-5-5-high');
  });

  it('unifies capacity calculation combining free and available accounts with accurate group count', () => {
    const occupiedNodes = [
      { id: 'a1', data: { fileName: 'a1.json', email: 'a1@test.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'a2', data: { fileName: 'a2.json', email: 'a2@test.com', prefix: 'agy_1', provider: 'antigravity' } },
      { id: 'a3', data: { fileName: 'a3.json', email: 'a3@test.com', prefix: 'agy2', provider: 'antigravity' } },
      { id: 'a4', data: { fileName: 'a4.json', email: 'a4@test.com', prefix: 'agy2_1', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={occupiedNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));

    const capacityBadge = screen.getByTestId('capacity-badge');
    expect(capacityBadge.textContent).toContain('Capacidad máxima: 2');
    expect(capacityBadge.textContent).toContain('4');
  });

  it('preserves user typed prefix when selecting a virtual source account (no input clobbering)', () => {
    const occupiedNodes = [
      { id: 'a1', data: { fileName: 'a1.json', email: 'a1@test.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'a2', data: { fileName: 'a2.json', email: 'a2@test.com', prefix: 'agy_1', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={occupiedNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));

    // Usuario escribe su propio prefijo deseado
    const prefixInput = screen.getByTestId('input-group-base-prefix');
    fireEvent.change(prefixInput, { target: { value: 'mi_opus_custom' } });
    expect(prefixInput.value).toBe('mi_opus_custom');

    // Luego selecciona cuenta líder virtual
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'a1' } });

    // NO debe machacar el input si ya tenía texto
    expect(screen.getByTestId('input-group-base-prefix').value).toBe('mi_opus_custom');
  });

  it('hides 5.5 exclusion checkbox on Gemini Puro and displays dynamic reactive note on Claude', () => {
    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));

    // 1. En Gemini Puro: NO debe mostrar checkbox 5.5
    fireEvent.click(screen.getByTestId('subfamily-gemini-pure'));
    expect(screen.queryByTestId('checkbox-exclude-55')).toBeNull();

    // 2. En Claude Opus: SÍ debe mostrar checkbox 5.5
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));
    const chk55 = screen.getByTestId('checkbox-exclude-55');
    expect(chk55).toBeTruthy();

    // Nota antes de marcar
    expect(screen.getByTestId('group-family-note').textContent).toContain('claude-opus-5-5-high');

    // Al marcar checkbox 5.5: nota reacciona dinámicamente
    fireEvent.click(chk55);
    expect(screen.getByTestId('group-family-note').textContent).toContain('(versión 5.5 excluida)');
  });

  it('supports specialized sonnet and opus subtypes in Antigravity package with dedicated models including 5.5 versions', () => {
    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    expect(screen.getByTestId('subfamily-gemini-sonnet')).toBeTruthy();
    expect(screen.getByTestId('subfamily-gemini-opus')).toBeTruthy();

    // Select Claude Sonnet -> suggests agy_son
    fireEvent.click(screen.getByTestId('subfamily-gemini-sonnet'));
    expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy_son');

    // Note should highlight Sonnet 4.6 & 5.5
    expect(screen.getAllByText(/claude-sonnet/i).length).toBeGreaterThanOrEqual(1);

    // Select Claude Opus -> suggests agy_opus
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));
    expect(screen.getByTestId('input-group-base-prefix').value).toBe('agy_opus');

    // Note should highlight Opus 4.6 Thinking & Opus 5.5 High
    expect(screen.getAllByText(/claude-opus/i).length).toBeGreaterThanOrEqual(1);
  });

  it('enforces strict minimum 2 accounts rule (1 leader + >=1 reserve) with visual warnings', () => {
    render(<GroupManager nodes={baseNodes} />);

    fireEvent.click(screen.getByTestId('family-gemini'));
    const saveBtn = screen.getByTestId('btn-save-group');

    // Sin líder seleccionado -> botón deshabilitado
    expect(saveBtn.disabled).toBe(true);

    // Con líder seleccionado pero 0 reservas -> botón sigue deshabilitado con advertencia de mínimo 2
    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'free1' } });
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByTestId('min-reserves-warning')).toBeTruthy();
    expect(screen.queryByTestId('pool-ready-banner')).toBeNull();

    // Al marcar al menos 1 reserva -> cumple regla (1 líder + 1 reserva = 2), se habilita botón y muestra banner listo
    fireEvent.click(screen.getByTestId('reserve-item-free2'));
    expect(saveBtn.disabled).toBe(false);
    expect(screen.queryByTestId('min-reserves-warning')).toBeNull();
    expect(screen.getByTestId('pool-ready-banner')).toBeTruthy();
    expect(screen.getByTestId('pool-ready-banner').textContent).toContain('1 líder + 1 reserva(s)');
  });

  it('dissolving pool agy never dissolves pool agy_clau (strict numeric descendant rule)', async () => {
    const mixedNodes = [
      { id: 'ag1', data: { fileName: 'ag1.json', email: 'ag1@test.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'ag2', data: { fileName: 'ag2.json', email: 'ag2@test.com', prefix: 'agy_1', provider: 'antigravity' } },
      { id: 'cl1', data: { fileName: 'cl1.json', email: 'cl1@test.com', prefix: 'agy_clau', provider: 'antigravity' } },
      { id: 'cl2', data: { fileName: 'cl2.json', email: 'cl2@test.com', prefix: 'agy_clau_1', provider: 'antigravity' } },
    ];

    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'ag1.json', prefix: '' }, { name: 'ag2.json', prefix: '' }],
      failed: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<GroupManager nodes={mixedNodes} />);

    // Ir a pestaña Disolver
    fireEvent.click(screen.getByTestId('tab-disolver-pools'));

    // Disolver pool agy
    const dissolveAgyBtn = screen.getByTestId('btn-dissolve-pool-agy');
    fireEvent.click(dissolveAgyBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'ag1.json', prefix: '' },
        { name: 'ag2.json', prefix: '' },
      ]);
    });
    // Verificamos que cl1 (agy_clau) y cl2 (agy_clau_1) NUNCA fueron incluidos en la disolución de agy
    expect(patchSpy).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'cl1.json' })
    ]));
  });

  it('dissolving pool with 2 master and 2 virtual accounts deletes virtual files from disk and resets master accounts', async () => {
    const mixedPoolNodes = [
      { id: 'm1', data: { fileName: 'antigravity-m1@gmail.com.json', email: 'm1@gmail.com', prefix: 'agy_mix', provider: 'antigravity' } },
      { id: 'm2', data: { fileName: 'antigravity-m2@gmail.com.json', email: 'm2@gmail.com', prefix: 'agy_mix_1', provider: 'antigravity' } },
      { id: 'v1', data: { fileName: 'antigravity-m1@gmail.com.agy_mix_2.json', email: 'm1@gmail.com', prefix: 'agy_mix_2', provider: 'antigravity' } },
      { id: 'v2', data: { fileName: 'antigravity-m2@gmail.com.agy_mix_3.json', email: 'm2@gmail.com', prefix: 'agy_mix_3', provider: 'antigravity' } },
    ];

    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'antigravity-m1@gmail.com.json', prefix: '' }, { name: 'antigravity-m2@gmail.com.json', prefix: '' }],
      failed: [],
    });
    const deleteSpy = vi.spyOn(managementClient, 'deleteAuthFile').mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<GroupManager nodes={mixedPoolNodes} />);
    fireEvent.click(screen.getByTestId('tab-disolver-pools'));
    fireEvent.click(screen.getByTestId('btn-dissolve-pool-agy_mix'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('antigravity-m1@gmail.com.agy_mix_2.json');
      expect(deleteSpy).toHaveBeenCalledWith('antigravity-m2@gmail.com.agy_mix_3.json');
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'antigravity-m1@gmail.com.json', prefix: '' },
        { name: 'antigravity-m2@gmail.com.json', prefix: '' },
      ]);
    });
  });

  it('MINI-003 acceptance: for 4 master accounts, Gemini and Claude dropdowns show strictly 4 candidates with zero duplicates', () => {
    // 4 physical master accounts
    const fourMasters = [
      { id: 'm1', data: { fileName: 'antigravity-u1@gmail.com.json', email: 'u1@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'm2', data: { fileName: 'antigravity-u2@gmail.com.json', email: 'u2@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'm3', data: { fileName: 'antigravity-u3@gmail.com.json', email: 'u3@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'm4', data: { fileName: 'antigravity-u4@gmail.com.json', email: 'u4@gmail.com', prefix: '', provider: 'antigravity' } },
    ];

    const { rerender } = render(<GroupManager nodes={fourMasters} />);

    // 1. When selecting Gemini (gemini_pure)
    fireEvent.click(screen.getByTestId('family-gemini'));
    fireEvent.click(screen.getByTestId('subfamily-gemini-pure'));

    const geminiSelect = screen.getByTestId('select-active-account');
    const geminiOptions = Array.from(geminiSelect.options).filter((o) => o.value !== '');
    // Exactly 4 candidates (m1, m2, m3, m4)
    expect(geminiOptions).toHaveLength(4);
    expect(geminiOptions.map((o) => o.value)).toEqual(['m1', 'm2', 'm3', 'm4']);

    // 2. When selecting Claude (gemini_opus / sonnet)
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));

    const claudeSelect = screen.getByTestId('select-active-account');
    const claudeOptions = Array.from(claudeSelect.options).filter((o) => o.value !== '');
    // Exactly 4 candidates (1 per physical master account)
    expect(claudeOptions).toHaveLength(4);
    expect(claudeOptions.map((o) => o.value)).toEqual(['m1', 'm2', 'm3', 'm4']);

    // 3. Even with 4 derived virtual files already on disk (8 total files in CPAMC)
    const nodes8 = [
      ...fourMasters,
      { id: 'v1', data: { fileName: 'antigravity-u1@gmail.com.agy_son.json', email: 'u1@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'v2', data: { fileName: 'antigravity-u2@gmail.com.agy_son_1.json', email: 'u2@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'v3', data: { fileName: 'antigravity-u3@gmail.com.agy_son_2.json', email: 'u3@gmail.com', prefix: '', provider: 'antigravity' } },
      { id: 'v4', data: { fileName: 'antigravity-u4@gmail.com.agy_son_3.json', email: 'u4@gmail.com', prefix: '', provider: 'antigravity' } },
    ];

    rerender(<GroupManager nodes={nodes8} />);

    // In Gemini: Virtual Claude files are completely hidden
    fireEvent.click(screen.getByTestId('subfamily-gemini-pure'));
    const gemini8Options = Array.from(screen.getByTestId('select-active-account').options).filter((o) => o.value !== '');
    expect(gemini8Options).toHaveLength(4);
    expect(gemini8Options.some((o) => o.value.startsWith('v'))).toBe(false);

    // In Claude: all 4 claude cards are now assigned to agy_son virtuals → zero free candidates
    fireEvent.click(screen.getByTestId('subfamily-gemini-opus'));
    const claude8Options = Array.from(screen.getByTestId('select-active-account').options).filter((o) => o.value !== '');
    expect(claude8Options).toHaveLength(0);
    expect(claude8Options.some((o) => o.value.startsWith('v'))).toBe(false);
    expect(screen.getByTestId('no-compatible-accounts-alert')).toBeTruthy();
  });
});

describe('GroupManager - PoolRegistry como fuente única de verdad', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mastersWithoutPrefix = [
    { id: 'm1', data: { fileName: 'antigravity-infosoytec@gmail.com.json', email: 'inf...tec@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm2', data: { fileName: 'antigravity-maribelluzbonitaaquinocastro@gmail.com.json', email: 'mar...tro@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm3', data: { fileName: 'antigravity-wilsonlavio11@gmail.com.json', email: 'wil...io11@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm4', data: { fileName: 'antigravity-wilsonlavio9@gmail.com.json', email: 'wil...io9@gmail.com', prefix: '', provider: 'antigravity' } },
  ];

  const registryClauPool = [
    {
      family: 'claude',
      base_prefix: 'clau',
      leader_auth: 'antigravity-infosoytec@gmail.com.json',
      reserves: [
        'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
        'antigravity-wilsonlavio11@gmail.com.json',
        'antigravity-wilsonlavio9@gmail.com.json',
      ],
      policy: { disable_isolation: false, exclude_55: false },
    },
  ];

  it('shows registry pools in the Dissolve tab even when disk prefixes are empty (registry is source of truth)', async () => {
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true,
      pools: registryClauPool,
      count: 1,
    });

    render(<GroupManager nodes={mastersWithoutPrefix} />);

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));

    // Esperar a que el registro se sincronice y mostrar 1 pool en Disolver
    await waitFor(() => {
      expect(screen.getByTestId('pool-card-clau')).toBeTruthy();
    });
    expect(screen.getByText(/Disolver \/ Desagrupar Pools \(1\)/)).toBeTruthy();
  });

  it('excludes registry pool members from free candidates (prevents duplicate assignment)', async () => {
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true,
      pools: registryClauPool,
      count: 1,
    });

    render(<GroupManager nodes={mastersWithoutPrefix} />);

    // Las 4 cuentas son miembros del pool clau registrado → cero candidatos libres
    await waitFor(() => {
      expect(screen.getByText(/Disolver \/ Desagrupar Pools \(1\)/)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('family-claude'));
    const options = Array.from(screen.getByTestId('select-active-account').options).filter((o) => o.value !== '');
    expect(options).toHaveLength(0);
    expect(screen.getByTestId('no-compatible-accounts-alert')).toBeTruthy();
  });

  it('degrades gracefully to disk-derived pools when the registry is unreachable', async () => {
    vi.spyOn(managementClient, 'listPools').mockRejectedValue(
      new Error('Management key not found.')
    );

    const legacyNodes = mastersWithoutPrefix.map((n, idx) => ({
      ...n,
      data: { ...n.data, prefix: idx === 0 ? 'legacy' : `legacy_${idx}` },
    }));

    render(<GroupManager nodes={legacyNodes} />);

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));

    // Sin registro: el pool legacy derivado de prefijos en disco sigue visible
    await waitFor(() => {
      expect(screen.getByTestId('pool-card-legacy')).toBeTruthy();
    });
  });
});

describe('GroupManager - Homologación 2N (dual-familia por rol de cuota)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mastersWithoutPrefix = [
    { id: 'm1', data: { fileName: 'antigravity-infosoytec@gmail.com.json', email: 'inf...tec@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm2', data: { fileName: 'antigravity-maribelluzbonitaaquinocastro@gmail.com.json', email: 'mar...tro@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm3', data: { fileName: 'antigravity-wilsonlavio11@gmail.com.json', email: 'wil...io11@gmail.com', prefix: '', provider: 'antigravity' } },
    { id: 'm4', data: { fileName: 'antigravity-wilsonlavio9@gmail.com.json', email: 'wil...io9@gmail.com', prefix: '', provider: 'antigravity' } },
  ];

  const geminiPooledNodes = mastersWithoutPrefix.map((n, idx) => ({
    ...n,
    data: { ...n.data, prefix: idx === 0 ? 'agy' : `agy_${idx}` },
  }));

  const registryGeminiPool = [{
    family: 'gemini_pure',
    base_prefix: 'agy',
    leader_auth: 'antigravity-infosoytec@gmail.com.json',
    reserves: [
      'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
      'antigravity-wilsonlavio11@gmail.com.json',
      'antigravity-wilsonlavio9@gmail.com.json',
    ],
    policy: {
      disable_isolation: false,
      exclude_55: false,
      target_models: ['gemini-3-flash', 'gemini-3.8-flash-high'],
    },
  }];

  const registryClaudePool = [{
    family: 'claude',
    base_prefix: 'clau',
    leader_auth: 'antigravity-infosoytec@gmail.com.json',
    reserves: [
      'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
      'antigravity-wilsonlavio11@gmail.com.json',
      'antigravity-wilsonlavio9@gmail.com.json',
    ],
    policy: { disable_isolation: false, exclude_55: false },
  }];

  it('builds a second-family pool with accounts already serving another family (2N) without cloning or overwriting prefixes', async () => {
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true, pools: registryGeminiPool, count: 1,
    });
    // Catálogo base: 3 targets de familias (2 gemini del pool existente + 1 claude nuevo) + 1 foreign antigravity junk
    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: ['agy/gemini-3-flash', 'agy/gemini-3.8-flash-high', 'clau/claude-sonnet-4-6', 'agy/gemini-junk-model-1'],
    });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({
      ok: true, pool: { base_prefix: 'clau' }, message: 'Pool clau saved',
    });
    const patchPrefixesSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({ successful: [], failed: [] });
    const patchExclusionsSpy = vi.spyOn(managementClient, 'patchAuthFileExclusions').mockResolvedValue({ ok: true });
    const virtualizeSpy = vi.spyOn(managementClient, 'virtualizeAccount').mockResolvedValue({ name: 'x.json', prefix: 'clau' });

    render(<GroupManager nodes={geminiPooledNodes} />);

    await waitFor(() => {
      expect(screen.getByText(/Disolver \/ Desagrupar Pools \(1\)/)).toBeTruthy();
    });

    // Familia Claude: los masters del pool Gemini DEBEN aparecer como candidatos (2N)
    fireEvent.click(screen.getByTestId('family-claude'));
    await waitFor(() => {
      const opts = Array.from(screen.getByTestId('select-active-account').options).filter((o) => o.value !== '');
      expect(opts.length).toBe(4);
    });

    fireEvent.change(screen.getByTestId('select-active-account'), { target: { value: 'm1' } });
    fireEvent.click(screen.getByTestId('reserve-item-m2'));
    fireEvent.change(screen.getByTestId('input-group-base-prefix'), { target: { value: 'clau' } });
    fireEvent.click(screen.getByTestId('btn-save-group'));

    await waitFor(() => expect(savePoolSpy).toHaveBeenCalledTimes(1));
    const payload = savePoolSpy.mock.calls[0][0];
    expect(payload.family).toBe('claude');
    expect(payload.base_prefix).toBe('clau');
    expect(payload.leader_auth).toBe('antigravity-infosoytec@gmail.com.json');
    expect(payload.reserves).toContain('antigravity-maribelluzbonitaaquinocastro@gmail.com.json');

    // Zero clones / zero prefix overwrite: la familia Gemini en disco queda intacta
    expect(virtualizeSpy).not.toHaveBeenCalled();
    expect(patchPrefixesSpy).not.toHaveBeenCalled();

    // En gobernanza virtual pura, no mutamos los excluded_models en disco para no mutilar
    // las credenciales nativas de CPAMC
    expect(patchExclusionsSpy).not.toHaveBeenCalled();
  });

  it('still blocks accounts already in a same-family registered pool (gemini side)', async () => {
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true, pools: registryGeminiPool, count: 1,
    });

    render(<GroupManager nodes={mastersWithoutPrefix} />);

    await waitFor(() => {
      expect(screen.getByText(/Disolver \/ Desagrupar Pools \(1\)/)).toBeTruthy();
    });

    // Familia Gemini (puro por defecto): los 4 masters ya están en el pool agy → 0 candidatos
    fireEvent.click(screen.getByTestId('family-gemini'));
    await waitFor(() => {
      const opts = Array.from(screen.getByTestId('select-active-account').options).filter((o) => o.value !== '');
      expect(opts.length).toBe(0);
    });
    expect(screen.getByTestId('no-compatible-accounts-alert')).toBeTruthy();
  });

  it('dissolving a registry-only second-family pool does not touch other-family disk prefixes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true, pools: registryClaudePool, count: 1,
    });
    const dissolveSpy = vi.spyOn(managementClient, 'dissolvePool').mockResolvedValue({ ok: true });
    const patchPrefixesSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({ successful: [], failed: [] });
    const deleteSpy = vi.spyOn(managementClient, 'deleteAuthFile').mockResolvedValue({ ok: true });

    render(<GroupManager nodes={geminiPooledNodes} />);

    await waitFor(() => {
      expect(screen.getByText(/Disolver \/ Desagrupar Pools \(1\)/)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));
    fireEvent.click(screen.getByTestId('btn-dissolve-pool-clau'));

    await waitFor(() => expect(dissolveSpy).toHaveBeenCalledWith('clau'));

    // Los prefijos agy* del pool Gemini quedan intactos (solo se libera la membresía claude)
    expect(patchPrefixesSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('allows adopting a single newly added free account into an existing pool as an extra reserve', async () => {
    const existingPoolsData = [
      {
        id: 'pool-agy-1',
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-leader@gmail.com.json',
        reserves: ['antigravity-res1@gmail.com.json'],
        policy: { disable_isolation: false, target_models: ['gemini-3.8-flash-high'] },
      },
    ];
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true,
      pools: existingPoolsData,
      count: 1,
    });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({ ok: true });
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'antigravity-newfree@gmail.com.json', prefix: 'agy_2' }],
      failed: [],
    });

    const nodesWithNewFree = [
      {
        id: 'antigravity-leader@gmail.com.json',
        data: { fileName: 'antigravity-leader@gmail.com.json', email: 'leader@gmail.com', prefix: 'agy', provider: 'antigravity' },
      },
      {
        id: 'antigravity-res1@gmail.com.json',
        data: { fileName: 'antigravity-res1@gmail.com.json', email: 'res1@gmail.com', prefix: 'agy_1', provider: 'antigravity' },
      },
      {
        id: 'antigravity-newfree@gmail.com.json',
        data: { fileName: 'antigravity-newfree@gmail.com.json', email: 'newfree@gmail.com', prefix: '', provider: 'antigravity' },
      },
    ];

    render(<GroupManager nodes={nodesWithNewFree} />);

    // Ir directamente a la nueva pestaña dedicada de Adopción
    await waitFor(() => {
      expect(screen.getByTestId('tab-adoptar-reserva')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('tab-adoptar-reserva'));

    await waitFor(() => {
      expect(screen.getByTestId('adopt-reserves-view')).toBeTruthy();
      expect(screen.getByTestId('select-adopt-specialist-model')).toBeTruthy();
    });

    // Verifica que preselecciona el modelo especialista por defecto del pool (gemini-3.8-flash-high)
    const modelSelect = screen.getByTestId('select-adopt-specialist-model');
    expect(modelSelect.value).toBe('gemini-3.8-flash-high');

    fireEvent.click(screen.getByTestId('btn-quick-adopt'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'antigravity-newfree@gmail.com.json', prefix: 'agy_2' },
      ]);
      expect(savePoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_prefix: 'agy',
          reserves: ['antigravity-res1@gmail.com.json', 'antigravity-newfree@gmail.com.json'],
          policy: expect.objectContaining({
            target_models: ['gemini-3.8-flash-high'],
          }),
        })
      );
    });
  });

  it('allows releasing an individual reserve account from a pool in the Dissolve tab', async () => {
    const existingPoolsData = [
      {
        id: 'pool-agy-1',
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'acc-leader.json',
        reserves: ['acc-res1.json', 'acc-res2.json'],
        members: ['acc-leader.json', 'acc-res1.json', 'acc-res2.json'],
        member_models: {
          'acc-leader.json': 'gemini-3.8-flash-high',
          'acc-res1.json': 'gemini-3.7-flash-high',
          'acc-res2.json': 'gemini-2.5-flash',
        },
      },
    ];
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true,
      pools: existingPoolsData,
      count: 1,
    });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({ ok: true });
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [{ name: 'acc-res1.json', prefix: '' }],
      failed: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const poolNodes = [
      { id: 'acc-leader.json', data: { fileName: 'acc-leader.json', email: 'leader@test.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'acc-res1.json', data: { fileName: 'acc-res1.json', email: 'res1@test.com', prefix: 'agy_1', provider: 'antigravity' } },
      { id: 'acc-res2.json', data: { fileName: 'acc-res2.json', email: 'res2@test.com', prefix: 'agy_2', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={poolNodes} />);

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));
    await waitFor(() => {
      expect(screen.getByTestId('pool-card-agy')).toBeTruthy();
    });

    const releaseBtn = screen.getByTestId('btn-release-reserve-agy-acc-res1.json');
    expect(releaseBtn).toBeTruthy();
    fireEvent.click(releaseBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith([{ name: 'acc-res1.json', prefix: '' }]);
      expect(savePoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_prefix: 'agy',
          reserves: ['acc-res2.json'],
          members: ['acc-leader.json', 'acc-res2.json'],
          member_models: expect.not.objectContaining({
            'acc-res1.json': expect.anything(),
          }),
        })
      );
    });
  });

  it('allows releasing the leader account and promotes first reserve to leader', async () => {
    const existingPoolsData = [
      {
        id: 'pool-agy-1',
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'acc-leader.json',
        reserves: ['acc-res1.json', 'acc-res2.json'],
        members: ['acc-leader.json', 'acc-res1.json', 'acc-res2.json'],
        member_models: {
          'acc-leader.json': 'gemini-3.8-flash-high',
          'acc-res1.json': 'gemini-3.7-flash-high',
          'acc-res2.json': 'gemini-2.5-flash',
        },
      },
    ];
    vi.spyOn(managementClient, 'listPools').mockResolvedValue({
      ok: true,
      pools: existingPoolsData,
      count: 1,
    });
    const savePoolSpy = vi.spyOn(managementClient, 'savePool').mockResolvedValue({ ok: true });
    const patchSpy = vi.spyOn(managementClient, 'saveAuthFilePrefixes').mockResolvedValue({
      successful: [],
      failed: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const poolNodes = [
      { id: 'acc-leader.json', data: { fileName: 'acc-leader.json', email: 'leader@test.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'acc-res1.json', data: { fileName: 'acc-res1.json', email: 'res1@test.com', prefix: 'agy_1', provider: 'antigravity' } },
      { id: 'acc-res2.json', data: { fileName: 'acc-res2.json', email: 'res2@test.com', prefix: 'agy_2', provider: 'antigravity' } },
    ];

    render(<GroupManager nodes={poolNodes} />);

    fireEvent.click(screen.getByTestId('tab-disolver-pools'));
    await waitFor(() => {
      expect(screen.getByTestId('pool-card-agy')).toBeTruthy();
    });

    const releaseLeaderBtn = screen.getByTestId('btn-release-leader-agy');
    expect(releaseLeaderBtn).toBeTruthy();
    fireEvent.click(releaseLeaderBtn);

    await waitFor(() => {
      // Leader becomes free, res1 promoted to agy, res2 remains agy_1
      expect(patchSpy).toHaveBeenCalledWith([
        { name: 'acc-leader.json', prefix: '' },
        { name: 'acc-res1.json', prefix: 'agy' },
        { name: 'acc-res2.json', prefix: 'agy_1' },
      ]);
      expect(savePoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_prefix: 'agy',
          leader_auth: 'acc-res1.json',
          active_leader: 'acc-res1.json',
          members: ['acc-res1.json', 'acc-res2.json'],
          reserves: ['acc-res2.json'],
          member_models: expect.not.objectContaining({
            'acc-leader.json': expect.anything(),
          }),
        })
      );
    });
  });
});
