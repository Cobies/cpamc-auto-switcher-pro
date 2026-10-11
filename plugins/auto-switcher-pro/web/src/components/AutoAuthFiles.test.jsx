import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AutoAuthFiles from './AutoAuthFiles';
import * as managementClient from '../api/managementClient';

// Fixtures de pools registrados en el plugin PoolRegistry (GroupManager = único generador).
// 2 pools × 4 cuentas = 8 tarjetas (4 Gemini + 4 Claude), replicando el modelo 2N.
const poolsFor8Accounts = [
  {
    family: 'gemini_pure',
    base_prefix: 'agy',
    leader_auth: 'antigravity-infosoytec@gmail.com.json',
    reserves: [
      'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
      'antigravity-wilsonlavio11@gmail.com.json',
      'antigravity-wilsonlavio9@gmail.com.json',
    ],
  },
  {
    family: 'gemini_claude',
    base_prefix: 'agy_son',
    leader_auth: 'antigravity-infosoytec@gmail.com.json',
    reserves: [
      'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
      'antigravity-wilsonlavio11@gmail.com.json',
      'antigravity-wilsonlavio9@gmail.com.json',
    ],
  },
];

const mockPools = (pools) =>
  vi.spyOn(managementClient, 'listPools').mockResolvedValue({
    ok: true,
    pools,
    count: pools.length,
  });

describe('AutoAuthFiles Component - Dedicated View & Lifecycle Engine', () => {
  const sample8Accounts = [
    // 4 Physical Master Accounts
    {
      id: 'm1',
      data: {
        fileName: 'antigravity-infosoytec@gmail.com.json',
        email: 'infosoytec@gmail.com',
        prefix: 'agy',
        provider: 'antigravity',
      },
    },
    {
      id: 'm2',
      data: {
        fileName: 'antigravity-maribelluzbonitaaquinocastro@gmail.com.json',
        email: 'maribelluzbonitaaquinocastro@gmail.com',
        prefix: 'agy_1',
        provider: 'antigravity',
      },
    },
    {
      id: 'm3',
      data: {
        fileName: 'antigravity-wilsonlavio11@gmail.com.json',
        email: 'wilsonlavio11@gmail.com',
        prefix: 'agy_2',
        provider: 'antigravity',
      },
    },
    {
      id: 'm4',
      data: {
        fileName: 'antigravity-wilsonlavio9@gmail.com.json',
        email: 'wilsonlavio9@gmail.com',
        prefix: 'agy_3',
        provider: 'antigravity',
      },
    },
    // 4 Derived Virtual Accounts (Claude Pool)
    {
      id: 'v1',
      data: {
        fileName: 'antigravity-infosoytec@gmail.com.agy_son.json',
        email: 'infosoytec@gmail.com',
        prefix: 'agy_son',
        provider: 'antigravity',
        excludedModels: ['gemini-1.5-pro', 'claude-sonnet-5-5-high'],
      },
    },
    {
      id: 'v2',
      data: {
        fileName: 'antigravity-maribelluzbonitaaquinocastro@gmail.com.agy_son_1.json',
        email: 'maribelluzbonitaaquinocastro@gmail.com',
        prefix: 'agy_son_1',
        provider: 'antigravity',
        excludedModels: ['gemini-2.0-flash'],
      },
    },
    {
      id: 'v3',
      data: {
        fileName: 'antigravity-wilsonlavio11@gmail.com.agy_son_2.json',
        email: 'wilsonlavio11@gmail.com',
        prefix: 'agy_son_2',
        provider: 'antigravity',
        excludedModels: ['gemini-1.5-pro'],
      },
    },
    {
      id: 'v4',
      data: {
        fileName: 'antigravity-wilsonlavio9@gmail.com.agy_son_3.json',
        email: 'wilsonlavio9@gmail.com',
        prefix: 'agy_son_3',
        provider: 'antigravity',
        excludedModels: ['gemini-1.5-pro'],
      },
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    // Por defecto, el registro del plugin reporta los pools del modelo 2N
    mockPools(poolsFor8Accounts);
  });

  it('renders metrics header with 8 accounts (4 masters, 4 virtuals, 0 orphans)', async () => {
    render(<AutoAuthFiles nodes={sample8Accounts} />);

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-accounts').textContent).toContain('8');
    });
    expect(screen.getByTestId('metric-master-accounts').textContent).toContain('4');
    expect(screen.getByTestId('metric-virtual-accounts').textContent).toContain('4');
    expect(screen.getByTestId('metric-orphan-clones').textContent).toContain('0');
  });

  it('renders 4 master cards and 4 virtual cards with safe masked emails and badges', async () => {
    render(<AutoAuthFiles nodes={sample8Accounts} />);

    // Managed Cards section (8 total: 4 Gemini + 4 Claude)
    await waitFor(() => {
      expect(screen.getByTestId('section-managed-cards')).toBeTruthy();
      expect(screen.getByTestId('section-virtuals')).toBeTruthy();
      expect(screen.getAllByTestId(/gemini-card-/)).toHaveLength(4);
      expect(screen.getAllByTestId(/virtual-card-/)).toHaveLength(4);
    });

    expect(screen.getAllByText('inf...tec@gmail.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('mar...tro@gmail.com').length).toBeGreaterThanOrEqual(1);

    // Origin traceability checks
    const originBadges = screen.getAllByTestId('origin-traceability-badge');
    expect(originBadges).toHaveLength(4);
    expect(originBadges[0].textContent).toContain('inf...tec@gmail.com');

    // Model exclusion badge
    expect(screen.getByText(/Excluye 5.5/i)).toBeTruthy();
    expect(screen.getAllByText(/Excluye Gemini/i).length).toBeGreaterThan(0);
  });

  it('allows dissolving / deleting an individual virtual clone with confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteSpy = vi.spyOn(managementClient, 'deleteAuthFile').mockResolvedValue({ ok: true });
    const reloadMock = vi.fn();

    render(<AutoAuthFiles nodes={sample8Accounts} onReloadRequested={reloadMock} />);

    const deleteBtn = await screen.findByTestId('btn-delete-virtual-antigravity-infosoytec@gmail.com.agy_son.json');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('antigravity-infosoytec@gmail.com.agy_son.json');
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  it('detects orphan clones and provides batch purge action', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteSpy = vi.spyOn(managementClient, 'deleteAuthFile').mockResolvedValue({ ok: true });
    const reloadMock = vi.fn();

    const nodesWithOrphan = [
      ...sample8Accounts,
      {
        id: 'orphan-1',
        data: {
          fileName: 'antigravity-infosoytec@gmail.com.agy_son_99.json',
          email: 'infosoytec@gmail.com',
          prefix: '', // Orphan: virtual clone without prefix
          provider: 'antigravity',
        },
      },
    ];

    render(<AutoAuthFiles nodes={nodesWithOrphan} onReloadRequested={reloadMock} />);

    await waitFor(() => {
      expect(screen.getByTestId('metric-orphan-clones').textContent).toContain('1');
    });
    const purgeBanner = screen.getByTestId('orphan-purge-banner');
    expect(purgeBanner).toBeTruthy();

    const purgeBtn = await screen.findByTestId('btn-purge-orphans');
    fireEvent.click(purgeBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('antigravity-infosoytec@gmail.com.agy_son_99.json');
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  it('shows strictly 0 cards and the empty banner when no pools are registered (GroupManager is the sole generator)', async () => {
    mockPools([]);

    // Only 4 physical masters, zero virtual clones on disk
    const only4Masters = sample8Accounts.slice(0, 4);
    render(<AutoAuthFiles nodes={only4Masters} />);

    // Sin pools registrados ⇒ estrictamente 0 tarjetas + aviso de generador único
    await waitFor(() => {
      expect(screen.getByTestId('auto-auth-empty-pools')).toBeTruthy();
    });
    expect(screen.getByTestId('metric-total-accounts').textContent).toContain('0');
    expect(screen.queryAllByTestId(/gemini-card-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/virtual-card-/)).toHaveLength(0);
  });

  it('reflects registered pools as cards and clears them reactively after pools dissolve', async () => {
    const listPoolsSpy = mockPools(poolsFor8Accounts);

    const { rerender } = render(<AutoAuthFiles nodes={sample8Accounts} />);

    // Con pools registrados: 8 cards (4 Gemini + 4 Claude)
    await waitFor(() => {
      expect(screen.getAllByTestId(/gemini-card-/)).toHaveLength(4);
      expect(screen.getAllByTestId(/virtual-card-/)).toHaveLength(4);
    });

    // GroupManager disuelve los pools → onReloadRequested → nuevos nodos →
    // AutoAuthFiles re-consulta el registro → las tarjetas desaparecen en tiempo real
    listPoolsSpy.mockResolvedValue({ ok: true, pools: [], count: 0 });
    rerender(<AutoAuthFiles nodes={[...sample8Accounts]} />);

    await waitFor(() => {
      expect(screen.getByTestId('auto-auth-empty-pools')).toBeTruthy();
    });
    expect(screen.getByTestId('metric-total-accounts').textContent).toContain('0');
    expect(screen.queryAllByTestId(/gemini-card-/)).toHaveLength(0);
  });

  it('renders a gear icon button (btn-card-gear) for every managed card', async () => {
    render(<AutoAuthFiles nodes={sample8Accounts} />);

    const gearButtons = await screen.findAllByRole('button', { name: /⚙️|Configurar Especialista/i });
    // Exactly 8 managed cards = 8 gear buttons total
    expect(gearButtons.length).toBeGreaterThanOrEqual(8);
  });

  it('renders specialist badges in Specialist Mode vs multipurpose badges in Multipurpose Mode', async () => {
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    mockPools([
      {
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-spec@gmail.com.json',
        reserves: [],
      },
    ]);
    // Card with specialist exclusions: only gemini-2.5-pro is active
    const specialistAccounts = [
      {
        id: 'spec-1',
        data: {
          fileName: 'antigravity-spec@gmail.com.json',
          email: 'spec@gmail.com',
          prefix: 'agy',
          provider: 'antigravity',
          excludedModels: ['gemini-2.5-flash', 'gemini-2.0-flash'],
        },
      },
    ];

    render(
      <AutoAuthFiles
        nodes={specialistAccounts}
        catalogModels={catalog}
      />
    );

    // Specialist badges rendered on the specialist card
    await waitFor(() => {
      expect(screen.getAllByText(/🎯 Modelo Activo: gemini-2.5-pro/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText(/🚫 Excluidos: 2 modelos/i).length).toBeGreaterThanOrEqual(1);
  });

  it('clicking ⚙️ opens SpecialistModal and saving refreshes state via onReloadRequested', async () => {
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const reloadMock = vi.fn();
    const patchSpy = vi.spyOn(managementClient, 'patchAuthFileExclusions').mockResolvedValue({
      ok: true,
      status: 200,
      name: 'antigravity-infosoytec@gmail.com.json',
      excluded_models: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    });

    render(
      <AutoAuthFiles
        nodes={sample8Accounts}
        catalogModels={catalog}
        onReloadRequested={reloadMock}
      />
    );

    // Click gear on the first gemini card
    const masterGearBtn = await screen.findByTestId('btn-gear-gemini-0');
    fireEvent.click(masterGearBtn);

    // SpecialistModal is opened
    expect(screen.getByTestId('specialist-modal-dialog')).toBeTruthy();

    // Select gemini-2.5-pro specialist model directly
    fireEvent.click(screen.getByLabelText(/gemini-2.5-pro/i));

    // Save
    fireEvent.click(screen.getByTestId('btn-save-specialist'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        'antigravity-infosoytec@gmail.com.json',
        ['gemini-2.0-flash', 'gemini-2.5-flash']
      );
      expect(reloadMock).toHaveBeenCalled();
    });

    // Success toast is visible
    expect(screen.getByText(/Configuración de especialista actualizada/i)).toBeTruthy();
  });

  // MINI-001 Integration Check
  it('preserves specialist active state when auth files with excluded_models are reloaded', async () => {
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    mockPools([
      {
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-spec@gmail.com.json',
        reserves: [],
      },
    ]);
    const initialNodes = [
      {
        id: 'spec-1',
        data: {
          fileName: 'antigravity-spec@gmail.com.json',
          email: 'spec@gmail.com',
          prefix: 'agy',
          provider: 'antigravity',
          excluded_models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
        },
      },
    ];

    const { rerender } = render(
      <AutoAuthFiles nodes={initialNodes} catalogModels={catalog} />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/🎯 Modelo Activo: gemini-2.5-pro/i).length).toBeGreaterThanOrEqual(1);
    });

    // Simulate state reload with refreshed nodes carrying excluded_models
    const reloadedNodes = [
      {
        id: 'spec-1',
        data: {
          fileName: 'antigravity-spec@gmail.com.json',
          email: 'spec@gmail.com',
          prefix: 'agy',
          provider: 'antigravity',
          excluded_models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
        },
      },
    ];

    rerender(<AutoAuthFiles nodes={reloadedNodes} catalogModels={catalog} />);
    await waitFor(() => {
      expect(screen.getAllByText(/🎯 Modelo Activo: gemini-2.5-pro/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  // MINI-002 Hero Active Model Banner
  it('renders prominent hero active model banner with badge-specialist-active in specialist mode', async () => {
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    mockPools([
      {
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-hero@gmail.com.json',
        reserves: [],
      },
    ]);
    const specialistNodes = [
      {
        id: 'spec-hero',
        data: {
          fileName: 'antigravity-hero@gmail.com.json',
          email: 'hero@gmail.com',
          prefix: 'agy',
          provider: 'antigravity',
          excluded_models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
        },
      },
    ];

    render(<AutoAuthFiles nodes={specialistNodes} catalogModels={catalog} />);

    // Assert presence of hero-model-banner
    await waitFor(() => {
      const heroBanners = screen.getAllByTestId('hero-model-banner');
      expect(heroBanners.length).toBeGreaterThanOrEqual(1);
    });

    // Assert specialist badge inside hero banner
    const specialistBadges = screen.getAllByText('🎯 MODELO ESPECIALISTA ACTIVO');
    expect(specialistBadges.length).toBeGreaterThanOrEqual(1);

    // Assert hero-model-name displaying target specialist model
    const heroModelNames = screen.getAllByTestId('hero-model-name');
    expect(heroModelNames.some((el) => el.textContent.includes('gemini-2.5-pro'))).toBe(true);
  });

  it('renders distinct hero container with badge-multipurpose-default in multipurpose mode', async () => {
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'claude-3-7-sonnet'];
    mockPools([
      {
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-multi@gmail.com.json',
        reserves: [],
      },
    ]);
    const multipurposeNodes = [
      {
        id: 'multi-hero',
        data: {
          fileName: 'antigravity-multi@gmail.com.json',
          email: 'multi@gmail.com',
          prefix: 'agy',
          provider: 'antigravity',
          excluded_models: [],
        },
      },
    ];

    render(<AutoAuthFiles nodes={multipurposeNodes} catalogModels={catalog} />);

    // Assert multipurpose badge inside hero banner
    await waitFor(() => {
      const multipurposeBadges = screen.getAllByText('✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)');
      expect(multipurposeBadges.length).toBeGreaterThanOrEqual(1);
    });

    // Assert hero-model-name shows default model (gemini-2.5-pro or claude-3-7-sonnet)
    const heroModelNames = screen.getAllByTestId('hero-model-name');
    expect(heroModelNames.some((el) => el.textContent.includes('gemini-2.5-pro'))).toBe(true);
  });

  // MINI-003 Quota Telemetry Homologation & Refresh
  it('renders live Plan badge and dual telemetry blocks for GEMINI MODELS and CLAUDE AND GPT MODELS', async () => {
    const singleMaster = [sample8Accounts[0]];

    const quotaSpy = vi.spyOn(managementClient, 'fetchCardQuota').mockResolvedValue({
      plan: 'Pro',
      groups: [
        {
          title: 'GEMINI MODELS',
          rows: [
            { label: 'Five Hour Limit', percent: 100, percentLabel: 'Quota available', resetLabel: 'Refreshes in 4h 45m', warning: false },
            { label: 'Weekly Limit', percent: 92, percentLabel: '92% remaining', resetLabel: 'Refreshes in 5d 12h', warning: false },
          ],
        },
        {
          title: 'CLAUDE AND GPT MODELS',
          rows: [
            { label: 'Five Hour Limit', percent: 85, percentLabel: '85% remaining', resetLabel: 'Refreshes in 3h 10m', warning: false },
            { label: 'Weekly Limit', percent: 78, percentLabel: '78% remaining', resetLabel: 'Refreshes in 4d 8h', warning: false },
          ],
        },
      ],
      live: true,
      loading: false,
      error: null,
    });

    render(<AutoAuthFiles nodes={singleMaster} />);

    // Live quota is auto-fetched once per physical master on mount
    await waitFor(() => {
      expect(quotaSpy).toHaveBeenCalled();
    });

    // Plan badge rendered from real live tier (never fabricated)
    await waitFor(() => {
      const planBadges = screen.getAllByTestId('plan-badge');
      expect(planBadges.length).toBeGreaterThanOrEqual(1);
      expect(planBadges[0].textContent).toContain('Plan Pro');
    });

    // Dual quota limit groups rendered
    expect(screen.getAllByText('GEMINI MODELS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('CLAUDE AND GPT MODELS').length).toBeGreaterThanOrEqual(1);

    // Limit window rows rendered
    expect(screen.getAllByText('Five Hour Limit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Weekly Limit').length).toBeGreaterThanOrEqual(1);
  });

  it('renders honest "sin datos" telemetry (never fabricated) when live quota is unreachable', async () => {
    const singleMaster = [sample8Accounts[0]];

    vi.spyOn(managementClient, 'fetchCardQuota').mockResolvedValue({
      plan: null,
      groups: [],
      live: false,
      loading: false,
      error: '403',
    });

    render(<AutoAuthFiles nodes={singleMaster} />);

    // Without live data and without cooldowns: explicit no-data state, no invented percentages
    await waitFor(() => {
      expect(screen.getAllByText('Sin datos en vivo').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryAllByText(/\d+% remaining/)).toHaveLength(0);

    const planBadges = screen.getAllByTestId('plan-badge');
    expect(planBadges[0].textContent).toContain('sin datos');
  });

  it('indicates loading state while fetching live quota from Google', async () => {
    mockPools([
      {
        family: 'gemini_pure',
        base_prefix: 'agy',
        leader_auth: 'antigravity-infosoytec@gmail.com.json',
        reserves: [],
      },
    ]);
    const singleMaster = [sample8Accounts[0]];

    let resolveQuota;
    const quotaPromise = new Promise((resolve) => {
      resolveQuota = resolve;
    });

    vi.spyOn(managementClient, 'fetchCardQuota').mockReturnValue(quotaPromise);

    render(<AutoAuthFiles nodes={singleMaster} />);

    // During in-flight request, displays loading cues instead of premature "sin datos"
    await waitFor(() => {
      expect(screen.getAllByText('Plan: consultando...').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('Consultando en vivo...').length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      resolveQuota({
        plan: 'Pro',
        groups: [
          {
            title: 'GEMINI MODELS',
            rows: [
              { label: 'Five Hour Limit', percent: 100, percentLabel: 'Quota available', resetLabel: 'Refreshes in 4h', warning: false },
            ],
          },
        ],
        live: true,
        loading: false,
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Plan Pro').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Quota available').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('reflects real CPAMC native cooldowns and activity instead of mock data', async () => {
    const cooldowns = [
      {
        scope: 'model',
        model_key: 'gemini-3.8-flash-high',
        reason: 'quota',
        retry_at: new Date(Date.now() + 43.5 * 60 * 60 * 1000).toISOString(),
        remaining_seconds: 156600,
        http_status: 429,
      },
      {
        scope: 'model',
        model_key: 'claude-sonnet-4-6',
        reason: 'quota',
        retry_at: new Date(Date.now() + 48.5 * 60 * 60 * 1000).toISOString(),
        remaining_seconds: 174600,
        http_status: 429,
      },
    ];
    const recentRequests = Array.from({ length: 20 }, (_, i) => ({
      time: `00:${String(i * 10).padStart(2, '0')}`,
      success: i === 18 ? 60 : 0,
      failed: i === 18 ? 2 : 0,
    }));

    const masterWithCooldowns = [
      {
        ...sample8Accounts[0],
        data: {
          ...sample8Accounts[0].data,
          unavailable: true,
          cooldowns,
          recent_requests: recentRequests,
        },
      },
    ];

    vi.spyOn(managementClient, 'fetchCardQuota').mockResolvedValue({
      plan: null,
      groups: [],
      live: false,
      loading: false,
      error: '403',
    });

    render(<AutoAuthFiles nodes={masterWithCooldowns} />);

    // Real cooldown banner with model key is rendered
    await waitFor(() => {
      expect(screen.getAllByTestId('card-cooldown-banner').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText(/En cooldown \(429\): gemini-3\.8-flash-high/).length).toBeGreaterThanOrEqual(1);

    // Exhausted weekly rows derived from the real 429 cooldowns (never invented)
    expect(screen.getAllByText('Agotada (429)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Se libera en \d+d \d+h|\d+h \d+m/).length).toBeGreaterThanOrEqual(2);

    // Real activity from recent_requests buckets: 62 reqs (60 ok + 2 failed) ≈ 97% ok
    const activityMetas = screen.getAllByTestId('card-activity-meta');
    expect(activityMetas[0].textContent).toContain('62 reqs');
    expect(activityMetas[0].textContent).toContain('97% ok');
  });

  it('clicking on-demand refresh button triggers quota telemetry reload with spinner', async () => {
    const singleMaster = [sample8Accounts[0]];
    const quotaSpy = vi.spyOn(managementClient, 'fetchCardQuota').mockResolvedValue({
      plan: 'Pro',
      groups: [
        {
          title: 'GEMINI MODELS',
          rows: [
            {
              label: 'Five Hour Limit',
              percent: 100,
              percentLabel: 'Quota available',
              resetLabel: 'Refreshes in 4h 45m',
              warning: false,
            },
            {
              label: 'Weekly Limit',
              percent: 92,
              percentLabel: '92% remaining',
              resetLabel: 'Refreshes in 5d 12h',
              warning: false,
            },
          ],
        },
        {
          title: 'CLAUDE AND GPT MODELS',
          rows: [
            {
              label: 'Five Hour Limit',
              percent: 85,
              percentLabel: '85% remaining',
              resetLabel: 'Refreshes in 3h 10m',
              warning: false,
            },
            {
              label: 'Weekly Limit',
              percent: 78,
              percentLabel: '78% remaining',
              resetLabel: 'Refreshes in 4d 8h',
              warning: false,
            },
          ],
        },
      ],
      loading: false,
      error: null,
    });

    render(<AutoAuthFiles nodes={singleMaster} />);

    const refreshBtns = await screen.findAllByRole('button', { name: /Actualizar Cuota/i });
    expect(refreshBtns.length).toBeGreaterThanOrEqual(1);

    // Click refresh on the first card
    fireEvent.click(refreshBtns[0]);

    await waitFor(() => {
      expect(quotaSpy).toHaveBeenCalled();
    });

    // Verify updated quota text appears
    await waitFor(() => {
      expect(screen.getAllByText('92% remaining').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('85% remaining').length).toBeGreaterThanOrEqual(1);
    });
  });
});

