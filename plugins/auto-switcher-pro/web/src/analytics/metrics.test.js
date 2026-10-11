import { describe, it, expect } from 'vitest';
import {
  calculateTotalTokens,
  calculateCacheRate,
  calculateCacheSavings,
  calculateThinkingRatio,
  calculateSuccessRate,
  calculatePercentiles,
  calculateCost,
  calculateCostPer1M,
  calculateDelta,
  calculateEfficiencyScore,
} from './metrics';

describe('Metrics & Formulas Engine (SPEC §5.3)', () => {
  it('calculates total tokens matching the sample data (≈ 253.64M)', () => {
    // Totales mock del SPEC: Prompt 252.73M · Completion 671.5k · Thinking 246.0k
    const total = calculateTotalTokens({
      prompt_tokens: 252_730_000,
      completion_tokens: 671_500,
      thinking_tokens: 246_000,
    });
    // 252.73 + 0.6715 + 0.246 = 253.6475M
    expect(total).toBe(253_647_500);
    expect((total / 1_000_000).toFixed(2)).toBe('253.65');
  });

  it('calculates cache rate matching the sample data (≈ 86.1%)', () => {
    // Cached 217.67M / Prompt 252.73M ≈ 86.12%
    const rate = calculateCacheRate({
      cached_tokens: 217_670_000,
      prompt_tokens: 252_730_000,
    });
    expect((rate * 100).toFixed(1)).toBe('86.1');
  });

  it('calculates cache savings correctly in USD', () => {
    // 217.67M cached a $0.0354 input vs $0.00 cached -> 217.67 * 0.0354 ≈ $7.70
    const savings = calculateCacheSavings({
      cached_tokens: 217_670_000,
      inputPrice: 0.0354,
      inputCachedPrice: 0.0,
    });
    expect(savings.toFixed(2)).toBe('7.71');
  });

  it('calculates thinking ratio and success rate', () => {
    const thinkingRatio = calculateThinkingRatio({
      thinking_tokens: 246_000,
      completion_tokens: 671_500,
    });
    expect((thinkingRatio * 100).toFixed(1)).toBe('36.6');

    // 2316 ok / 2326 total
    const successRate = calculateSuccessRate({ ok: 2316, total: 2326 });
    expect((successRate * 100).toFixed(1)).toBe('99.6');
  });

  it('calculates percentiles excluding requests with 0 tokens', () => {
    const latencies = [1000, 2000, 3000, 4000, 5000, 10000, 15000, 20000, 25000, 30000];
    const res = calculatePercentiles(latencies, [50, 95, 99]);
    expect(res.min).toBe(1000);
    expect(res.max).toBe(30000);
    expect(res.p50).toBeGreaterThanOrEqual(5000);
    expect(res.p95).toBeGreaterThanOrEqual(25000);
    expect(res.p99).toBeGreaterThanOrEqual(29000);
  });

  it('calculates estimated cost and cost per 1M tokens', () => {
    const cost = calculateCost({
      prompt_tokens: 252_730_000,
      completion_tokens: 671_500,
      pricing: { input: 0.0354, output: 0.55 },
    });
    // Prompt: 252.73 * 0.0354 = $8.9466
    // Output: 0.6715 * 0.55 = $0.3693
    // Total ≈ $9.3159
    expect(cost.inCost.toFixed(2)).toBe('8.95');
    expect(cost.outCost.toFixed(2)).toBe('0.37');
    expect(cost.totalCost.toFixed(2)).toBe('9.32');

    const costPer1M = calculateCostPer1M(cost.totalCost, 253_647_500);
    expect(costPer1M.toFixed(4)).toBe('0.0367');
  });

  it('calculates deltas vs previous period correctly', () => {
    expect(calculateDelta(112, 100)).toBe(12);
    expect(calculateDelta(90, 100)).toBe(-10);
    expect(calculateDelta(50, 0)).toBe(100);
  });

  it('calculates efficiency score between 0 and 100', () => {
    const high = calculateEfficiencyScore({ costPer1M: 0.036, p50LatencyMs: 2000, successRate: 1.0 });
    const low = calculateEfficiencyScore({ costPer1M: 0.80, p50LatencyMs: 19000, successRate: 0.4 });
    expect(high).toBeGreaterThan(80);
    expect(low).toBeLessThan(50);
  });
});
