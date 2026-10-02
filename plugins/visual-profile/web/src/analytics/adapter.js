/**
 * Capa Adaptadora de Pulso Tokens (Ego Analytics v2)
 * Provee getSnapshot({ range, compare }) desacoplado de la UI.
 * Banco de datos de alta fidelidad según SPEC_ego-analytics-v2.md (§9).
 */

import {
  calculateTotalTokens,
  calculateCacheRate,
  calculateCacheSavings,
  calculateCost,
  calculateCostPer1M,
  calculatePercentiles,
  calculateEfficiencyScore,
} from './metrics';

// Datos canónicos basados en §9 del SPEC
const CANONICAL_24H_MOCK = {
  totals: {
    prompt_tokens: 252_730_000,
    completion_tokens: 671_500,
    thinking_tokens: 246_000,
    cached_tokens: 217_670_000,
    requests_total: 2326,
    requests_ok: 2316,
    requests_error: 10,
    latency_avg_ms: 11107,
    latency_min_ms: 2,
    latency_max_ms: 133581,
    latency_p50_ms: 10785,
    latency_p95_ms: 14250,
    latency_p99_ms: 18500,
  },
  // Desglose horario aproximado (horas 15 a 14) que suma ≈ 253.64M
  // Horas: 15,16,17,18,19,20,21,22,23,00,01,02,03,04,05,06,07,08,09,10,11,12,13,14
  timelineHourly: [
    { hour: '15:00', tokensM: 0.0, promptM: 0.0, complK: 0, reqs: 0, p50: 0, errors: 0 },
    { hour: '16:00', tokensM: 0.0, promptM: 0.0, complK: 0, reqs: 0, p50: 0, errors: 0 },
    { hour: '17:00', tokensM: 0.0, promptM: 0.0, complK: 0, reqs: 0, p50: 0, errors: 0 },
    { hour: '18:00', tokensM: 0.0, promptM: 0.0, complK: 0, reqs: 2, p50: 4, errors: 2, error_type: 'auth' },
    { hour: '19:00', tokensM: 5.5, promptM: 5.48, complK: 20, reqs: 52, p50: 9800, errors: 0 },
    { hour: '20:00', tokensM: 5.5, promptM: 5.48, complK: 20, reqs: 50, p50: 10100, errors: 0 },
    { hour: '21:00', tokensM: 8.2, promptM: 8.17, complK: 30, reqs: 78, p50: 10400, errors: 0 },
    { hour: '22:00', tokensM: 2.3, promptM: 2.29, complK: 10, reqs: 24, p50: 9950, errors: 0 },
    { hour: '23:00', tokensM: 20.7, promptM: 20.64, complK: 60, reqs: 188, p50: 10600, errors: 3, error_type: '429' },
    { hour: '00:00', tokensM: 8.0, promptM: 7.97, complK: 30, reqs: 72, p50: 10200, errors: 0 },
    { hour: '01:00', tokensM: 8.0, promptM: 7.97, complK: 30, reqs: 74, p50: 10300, errors: 0 },
    { hour: '02:00', tokensM: 26.63, promptM: 26.54, complK: 90, reqs: 242, p50: 11200, errors: 1, error_type: '500' }, // Pico
    { hour: '03:00', tokensM: 15.6, promptM: 15.54, complK: 60, reqs: 145, p50: 10800, errors: 0 },
    { hour: '04:00', tokensM: 21.1, promptM: 21.03, complK: 70, reqs: 196, p50: 11400, errors: 1, error_type: 'timeout' },
    { hour: '05:00', tokensM: 10.8, promptM: 10.76, complK: 40, reqs: 98, p50: 10500, errors: 3, error_type: '429' },
    { hour: '06:00', tokensM: 11.2, promptM: 11.16, complK: 40, reqs: 102, p50: 10450, errors: 0 },
    { hour: '07:00', tokensM: 4.9, promptM: 4.88, complK: 20, reqs: 46, p50: 10100, errors: 0 },
    { hour: '08:00', tokensM: 13.3, promptM: 13.25, complK: 50, reqs: 124, p50: 10700, errors: 0 },
    { hour: '09:00', tokensM: 23.8, promptM: 23.72, complK: 80, reqs: 218, p50: 11500, errors: 0 },
    { hour: '10:00', tokensM: 17.1, promptM: 17.04, complK: 60, reqs: 156, p50: 10900, errors: 0 },
    { hour: '11:00', tokensM: 13.3, promptM: 13.25, complK: 50, reqs: 122, p50: 10750, errors: 0 },
    { hour: '12:00', tokensM: 10.8, promptM: 10.76, complK: 40, reqs: 99, p50: 10600, errors: 0 },
    { hour: '13:00', tokensM: 19.0, promptM: 18.94, complK: 60, reqs: 176, p50: 11100, errors: 0 },
    { hour: '14:00', tokensM: 8.2, promptM: 8.17, complK: 30, reqs: 68, p50: 10300, errors: 0 },
  ],
  providers: [
    {
      provider: 'antigravity',
      displayName: 'Antigravity',
      requests: 2322,
      total_tokens: 253_640_000,
      latency_avg_ms: 11125,
      latency_p95_ms: 14250,
      success_rate: 0.997,
      share_pct: 99.8,
      status: 'healthy',
    },
    {
      provider: 'openai-compatible-nvidia',
      displayName: 'OpenAI-Compatible (NVIDIA)',
      requests: 2,
      total_tokens: 0,
      latency_avg_ms: 1143,
      latency_p95_ms: 1143,
      success_rate: 0.0,
      share_pct: 0.1,
      status: 'exhausted',
      reason: '2 requests sin tokens, 0% éxito (Auth/Timeout)',
    },
    {
      provider: 'nvidia',
      displayName: 'NVIDIA NIM',
      requests: 2,
      total_tokens: 0,
      latency_avg_ms: 4,
      latency_p95_ms: 4,
      success_rate: 0.0,
      share_pct: 0.1,
      status: 'exhausted',
      reason: '2 requests sin tokens, 0% éxito (Error de conexión)',
    },
  ],
  models: [
    {
      model: 'gemini-3.8-flash-high',
      provider: 'antigravity',
      requests: 2322,
      total_tokens: 253_640_000,
      est_value_usd: 9.31,
      latency_avg_ms: 11125,
      latency_p50_ms: 10785,
      cost_per_req: 0.0040,
      efficiency_score: 94,
    },
    {
      model: 'mistralai/mistral-nemotron',
      provider: 'openai-compatible-nvidia',
      requests: 2,
      total_tokens: 0,
      est_value_usd: 0.0,
      latency_avg_ms: 1143,
      latency_p50_ms: 1143,
      cost_per_req: 0.0,
      efficiency_score: 40,
    },
    {
      model: 'mistralai/mistral-nemotron',
      provider: 'nvidia',
      requests: 2,
      total_tokens: 0,
      est_value_usd: 0.0,
      latency_avg_ms: 4,
      latency_p50_ms: 4,
      cost_per_req: 0.0,
      efficiency_score: 42,
    },
  ],
  accounts: [
    {
      credential: 'backup-6-accounts/antigravity-maribelluz@gmail.com.json',
      masked_credential: 'backup-6-accounts/antigravity-m***@gmail.com.json',
      email: 'maribelluz@gmail.com',
      masked_email: 'm***@gmail.com',
      provider: 'antigravity',
      requests: 894,
      prompt_tokens: 78_640_000,
      completion_tokens: 240_900,
      total_tokens: 78_880_900,
      latency_avg_ms: 10785,
      share_pct: 31.1,
      status: 'active',
      error_rate: 0.003,
    },
    {
      credential: 'antigravity-g2-infosoytec.json',
      masked_credential: 'antigravity-g2-info***.json',
      email: 'infosoytec@gmail.com',
      masked_email: 'i***@gmail.com',
      provider: 'antigravity',
      requests: 415,
      prompt_tokens: 70_760_000,
      completion_tokens: 158_300,
      total_tokens: 70_918_300,
      latency_avg_ms: 13629,
      share_pct: 27.9,
      status: 'active',
      error_rate: 0.004,
    },
    {
      credential: 'antigravity-g1-maribelluz.json',
      masked_credential: 'antigravity-g1-mari***.json',
      email: 'maribelluz@gmail.com',
      masked_email: 'm***@gmail.com',
      provider: 'antigravity',
      requests: 760,
      prompt_tokens: 64_560_000,
      completion_tokens: 179_500,
      total_tokens: 64_739_500,
      latency_avg_ms: 10184,
      share_pct: 25.5,
      status: 'active',
      error_rate: 0.002,
    },
    {
      credential: 'backup-6-accounts/antigravity-infosoytec@gmail.com.json',
      masked_credential: 'backup-6-accounts/antigravity-i***@gmail.com.json',
      email: 'infosoytec@gmail.com',
      masked_email: 'i***@gmail.com',
      provider: 'antigravity',
      requests: 253,
      prompt_tokens: 38_760_000,
      completion_tokens: 92_800,
      total_tokens: 38_852_800,
      latency_avg_ms: 11050,
      share_pct: 15.3,
      status: 'active',
      error_rate: 0.007,
    },
    {
      credential: 'nvidia-main.json',
      masked_credential: 'nvidia-main.json',
      email: 'nvidia-account',
      masked_email: 'n***@nim.com',
      provider: 'nvidia',
      requests: 2,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      latency_avg_ms: 4,
      share_pct: 0.0,
      status: 'error',
      error_rate: 1.0,
    },
    {
      credential: 'openai-compatibility:nvidia:087288f2a3ed',
      masked_credential: 'openai-compatibility:nvidia:087***',
      email: 'openai-nvidia',
      masked_email: 'o***@nvidia.com',
      provider: 'openai-compatible-nvidia',
      requests: 2,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      latency_avg_ms: 1143,
      share_pct: 0.0,
      status: 'error',
      error_rate: 1.0,
    },
  ],
  database: {
    path: 'plugins/ego.db',
    masked_path: 'plugins/****.db',
    mode: 'WAL',
    records: 10710,
    size_mb: 3.26,
    ingestion_active: true,
    growth_est_mb_30d: 14.2,
  },
  errors: [
    { type: '429', label: 'Rate Limit Exceeded', count: 6, provider: 'antigravity', credential: 'antigravity-g2-infosoytec.json', first_seen: '23:14', last_seen: '05:42' },
    { type: '500', label: 'Internal Server Error', count: 1, provider: 'antigravity', credential: 'antigravity-g1-maribelluz.json', first_seen: '02:18', last_seen: '02:18' },
    { type: 'timeout', label: 'Gateway Timeout', count: 1, provider: 'antigravity', credential: 'antigravity-m***@gmail.com', first_seen: '04:02', last_seen: '04:02' },
    { type: 'auth', label: 'Authentication Failed', count: 2, provider: 'nvidia', credential: 'nvidia-main.json', first_seen: '18:10', last_seen: '18:10' },
  ],
};

/**
 * Obtiene el Snapshot para el rango especificado con opción de comparación previa.
 * Toda la UI consume únicamente esta función.
 */
export async function getSnapshot({ range = '24h', compare = true } = {}) {
  // Simular pequeña latencia de API (50ms) para garantizar renderizado asíncrono limpio
  await new Promise((resolve) => setTimeout(resolve, 30));

  const totalTokens = calculateTotalTokens(CANONICAL_24H_MOCK.totals);
  const cacheRate = calculateCacheRate(CANONICAL_24H_MOCK.totals);
  const cacheSavings = calculateCacheSavings(CANONICAL_24H_MOCK.totals);
  const cost = calculateCost(CANONICAL_24H_MOCK.totals);
  const costPer1M = calculateCostPer1M(cost.totalCost, totalTokens);

  // Snapshot principal
  const snapshot = {
    range,
    totals: {
      ...CANONICAL_24H_MOCK.totals,
      total_tokens: totalTokens,
      cache_rate: cacheRate,
      cache_savings_usd: cacheSavings,
      est_value_usd: cost.totalCost,
      prompt_value_usd: cost.inCost,
      output_value_usd: cost.outCost,
      cost_per_1m: costPer1M,
      projected_daily_usd: cost.totalCost * 1.2,
    },
    timeline: CANONICAL_24H_MOCK.timelineHourly,
    providers: CANONICAL_24H_MOCK.providers,
    models: CANONICAL_24H_MOCK.models,
    accounts: CANONICAL_24H_MOCK.accounts,
    database: CANONICAL_24H_MOCK.database,
    errors: CANONICAL_24H_MOCK.errors,
    peakBucket: { hour: '02:00', tokensM: 26.63, label: 'Pico a las 02:00 (Gemini 1)' },
  };

  if (compare) {
    // Generar período anterior plausible para cálculo de deltas (SPEC §9: tokens -12.4%, latencia +8%, errores -20%)
    snapshot.previous = {
      totals: {
        total_tokens: Math.round(totalTokens / 1.124),
        prompt_tokens: Math.round(CANONICAL_24H_MOCK.totals.prompt_tokens / 1.124),
        completion_tokens: Math.round(CANONICAL_24H_MOCK.totals.completion_tokens / 1.1),
        cached_tokens: Math.round(CANONICAL_24H_MOCK.totals.cached_tokens / 1.15),
        requests_total: 2100,
        requests_ok: 2088,
        requests_error: 12,
        latency_p50_ms: 11200,
        est_value_usd: 8.60,
      },
      // Puntos anteriores para línea punteada
      timeline: CANONICAL_24H_MOCK.timelineHourly.map((b) => ({
        hour: b.hour,
        tokensM: Math.max(0, +(b.tokensM * 0.88).toFixed(1)),
      })),
    };
  }

  return snapshot;
}
