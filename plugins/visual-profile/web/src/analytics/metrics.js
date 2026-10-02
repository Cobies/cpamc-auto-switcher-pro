/**
 * Módulo de Fórmulas y Métricas de Pulso Tokens (Ego Analytics v2 Kaizen)
 * Especificación formal según SPEC_ego-analytics-v2.md (§5.3)
 */

export const DEFAULT_PRICING = {
  default: { input: 0.0354, inputCached: 0.0354, output: 0.55 },
  antigravity: { input: 0.0354, inputCached: 0.00, output: 0.55 },
  nvidia: { input: 0.05, inputCached: 0.01, output: 0.70 },
  'openai-compatible-nvidia': { input: 0.05, inputCached: 0.01, output: 0.70 },
};

/**
 * Total de tokens: prompt + completion + thinking
 */
export function calculateTotalTokens({ prompt_tokens = 0, completion_tokens = 0, thinking_tokens = 0 } = {}) {
  return Number(prompt_tokens || 0) + Number(completion_tokens || 0) + Number(thinking_tokens || 0);
}

/**
 * Tasa de caché: cached_tokens / prompt_tokens (0.0 a 1.0)
 */
export function calculateCacheRate({ cached_tokens = 0, prompt_tokens = 0 } = {}) {
  const p = Number(prompt_tokens || 0);
  if (p <= 0) return 0;
  return Math.min(1, Math.max(0, Number(cached_tokens || 0) / p));
}

/**
 * Ahorro en USD gracias al caché
 */
export function calculateCacheSavings({ cached_tokens = 0, inputPrice = 0.0354, inputCachedPrice = 0.0 } = {}) {
  const cached = Number(cached_tokens || 0);
  const diffPer1M = Math.max(0, Number(inputPrice) - Number(inputCachedPrice));
  return (cached / 1_000_000) * diffPer1M;
}

/**
 * Ratio de tokens de razonamiento vs tokens de salida
 */
export function calculateThinkingRatio({ thinking_tokens = 0, completion_tokens = 0 } = {}) {
  const c = Number(completion_tokens || 0);
  if (c <= 0) return 0;
  return Number(thinking_tokens || 0) / c;
}

/**
 * Tasa de éxito: requests_ok / requests_total
 */
export function calculateSuccessRate({ ok = 0, total = 0 } = {}) {
  const t = Number(total || 0);
  if (t <= 0) return 0;
  return Math.min(1, Math.max(0, Number(ok || 0) / t));
}

/**
 * Percentiles de latencia (p50, p95, p99).
 * EXCLUYE requests sin tokens (> 0 tokens).
 */
export function calculatePercentiles(latencies = [], percentiles = [50, 95, 99]) {
  if (!Array.isArray(latencies) || latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }

  const valid = latencies
    .filter((n) => typeof n === 'number' && !isNaN(n) && n >= 0)
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }

  const min = valid[0];
  const max = valid[valid.length - 1];
  const sum = valid.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / valid.length);

  const getP = (p) => {
    const idx = (p / 100) * (valid.length - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return valid[low];
    return valid[low] + (valid[high] - valid[low]) * (idx - low);
  };

  const res = { min, max, avg };
  percentiles.forEach((p) => {
    res[`p${p}`] = Math.round(getP(p));
  });

  return res;
}

/**
 * Cálculo de costo retail estimado
 */
export function calculateCost({ prompt_tokens = 0, completion_tokens = 0, pricing = DEFAULT_PRICING.default } = {}) {
  const p = Number(prompt_tokens || 0);
  const c = Number(completion_tokens || 0);
  const inCost = (p / 1_000_000) * (pricing.input || 0.0354);
  const outCost = (c / 1_000_000) * (pricing.output || 0.55);
  return {
    inCost,
    outCost,
    totalCost: inCost + outCost,
  };
}

/**
 * Costo promedio por 1M de tokens
 */
export function calculateCostPer1M(totalCost = 0, totalTokens = 0) {
  const t = Number(totalTokens || 0);
  if (t <= 0) return 0;
  return Number(totalCost || 0) / (t / 1_000_000);
}

/**
 * Delta porcentual entre actual y previo: (actual - previo) / previo
 */
export function calculateDelta(current = 0, previous = 0) {
  const prev = Number(previous || 0);
  const curr = Number(current || 0);
  if (prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

/**
 * Score de eficiencia para modelos (0 - 100):
 * Combinación de costo/1M (40%), latencia p50 (30%) y tasa de éxito (30%)
 */
export function calculateEfficiencyScore({ costPer1M = 0.036, p50LatencyMs = 10000, successRate = 1.0 } = {}) {
  // Costo: menor es mejor (benchmark 0.03 USD -> 100, 1.00 USD -> 0)
  const costScore = Math.max(0, Math.min(100, (1 - Math.min(1, costPer1M / 1.0)) * 100));

  // Latencia: menor es mejor (benchmark <2s -> 100, >20s -> 0)
  const latSeconds = p50LatencyMs / 1000;
  const latScore = Math.max(0, Math.min(100, (1 - Math.min(1, latSeconds / 20)) * 100));

  // Éxito: mayor es mejor (1.0 -> 100)
  const successScore = Math.max(0, Math.min(100, successRate * 100));

  const total = costScore * 0.4 + latScore * 0.3 + successScore * 0.3;
  return Math.round(total);
}
