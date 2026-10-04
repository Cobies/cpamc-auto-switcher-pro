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

  it('offers assigned antigravity accounts as virtualizable (🔀) candidates for the sibling Gemini subtype', async () => {
    const pureNodes = [
      { id: 'acc1', data: { fileName: 'antigravity-acc1.json', email: 'a...1@x.com', prefix: 'agy', provider: 'antigravity' } },
      { id: 'acc2', data: { fileName: 'antigravity-acc2.json', email: 'a...2@x.com', prefix: 'agy_1', provider: 'antigravity' } },
    ];

    vi.spyOn(managementClient, 'listModels').mockResolvedValue({
      models: ['agy/gemini-3.8-flash-high', 'claude-sonnet-4-6'],
    });
    const virtualizeSpy = vi
      .spyOn(managementClient, 'virtualizeAccount')
      .mockImplementation(({ sourceFileName, prefix }) =>
        Promise.resolve({ name: `${sourceFileName.replace(/\.json$/, '')}.${prefix}.json`, path: '', prefix })
      );

    render(<GroupManager nodes={pureNodes} />);

    // Aunque no hay cuentas libres, el builder aparece porque hay antigravity con virtualización posible.
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

    await waitFor(() => expect(virtualizeSpy).toHaveBeenCalledTimes(2));

    const firstCall = virtualizeSpy.mock.calls[0][0];
    expect(firstCall.sourceFileName).toBe('antigravity-acc1.json');
    expect(firstCall.prefix).toBe('agy_clau');
    expect(firstCall.targetPatterns).toEqual(['claude', 'gpt']);
    expect(firstCall.oppositeModels).toContain('gemini-3.8-flash-high');

    const secondCall = virtualizeSpy.mock.calls[1][0];
    expect(secondCall.sourceFileName).toBe('antigravity-acc2.json');
    expect(secondCall.prefix).toBe('agy_clau_1');
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

    // Sin cuentas libres antigravity: el formulario aparece pero con aviso explícito
    fireEvent.click(screen.getByTestId('family-gemini'));
    expect(screen.getByTestId('no-compatible-accounts-alert')).toBeTruthy();
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
});
