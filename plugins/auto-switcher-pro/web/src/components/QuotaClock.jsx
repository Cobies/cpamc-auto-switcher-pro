import React, { useMemo } from 'react';
import './QuotaClock.css';

/**
 * Parses time remaining in minutes from a string like "4h 45m", "5d 12h", "50m", etc.
 * @param {string} label
 * @returns {number|null}
 */
export function parseRemainingMinutesFromLabel(label) {
  if (!label || typeof label !== 'string') return null;
  let total = 0;
  let matched = false;
  const dMatch = label.match(/(\d+)\s*d/i);
  const hMatch = label.match(/(\d+)\s*h/i);
  const mMatch = label.match(/(\d+)\s*m/i);
  if (dMatch) {
    total += parseInt(dMatch[1], 10) * 1440;
    matched = true;
  }
  if (hMatch) {
    total += parseInt(hMatch[1], 10) * 60;
    matched = true;
  }
  if (mMatch) {
    total += parseInt(mMatch[1], 10);
    matched = true;
  }
  return matched ? total : null;
}

/**
 * Formats minutes into human-readable duration matching spec ("Xh Ym" or "Xd Yh").
 * @param {number} minutes
 * @param {boolean} isWeekly
 * @returns {string}
 */
export function formatRemainingTime(minutes, isWeekly) {
  if (minutes === null || minutes === undefined || isNaN(minutes) || minutes < 0) {
    return '—';
  }
  const mins = Math.max(0, Math.round(minutes));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;

  if (isWeekly && days > 0) {
    return `${days}d ${hours}h`;
  }
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${remMins}m`;
  }
  return `${remMins}m`;
}

/**
 * QuotaClock: Reusable circular dual-ring gauge for quota windows.
 *
 * Outer ring (Blue): Window elapsed time (0-100%) starting at 12 o'clock with tick marks & needle dot.
 * Inner ring: Quota consumed (0-100%) with adaptive pace coloring (green/amber/red).
 *
 * @param {Object} props
 * @param {number} props.totalMinutes - Total duration of the window (e.g. 300 for 5h, 10080 for weekly).
 * @param {number|null} [props.remainingMinutes] - Minutes remaining until window resets.
 * @param {number|null} [props.consumedPercent] - Quota consumed percentage (0 to 100).
 * @param {string} props.label - Window title/label ("Ventana de 5 horas", "Semanal", or canonical label).
 * @param {string} [props.windowKey] - Window key identifier ("5h" | "weekly" | custom).
 * @param {string} [props.resetLabel] - Human reset label from backend/cooldown.
 * @param {string} [props.percentLabel] - Textual quota state (e.g. "Quota available", "85% remaining").
 * @param {boolean} [props.isLoading] - Loading indicator state.
 * @param {string} [props.testId] - Test identifier.
 */
export function QuotaClock({
  totalMinutes = 300,
  remainingMinutes = null,
  consumedPercent = null,
  label = 'Ventana de 5 horas',
  windowKey = '',
  resetLabel = '',
  percentLabel = '',
  isLoading = false,
  testId = 'quota-clock',
}) {
  const is5h =
    windowKey === '5h' ||
    label.toLowerCase().includes('5') ||
    label.toLowerCase().includes('five');
  const isWeekly =
    windowKey === 'weekly' ||
    label.toLowerCase().includes('week') ||
    label.toLowerCase().includes('seman');

  const resolvedTotalMins = totalMinutes || (isWeekly ? 10080 : 300);
  const tickCount = isWeekly ? 7 : 10;

  // Resolve effective remaining minutes from prop or fallback parsed from resetLabel
  const effectiveRemainingMinutes = useMemo(() => {
    if (remainingMinutes !== null && remainingMinutes !== undefined && !isNaN(remainingMinutes)) {
      return Math.max(0, remainingMinutes);
    }
    const parsed = parseRemainingMinutesFromLabel(resetLabel);
    if (parsed !== null) {
      return parsed;
    }
    // If no remaining minutes and consumed is 0 or 100% available
    if (consumedPercent === 0) {
      return resolvedTotalMins;
    }
    return null;
  }, [remainingMinutes, resetLabel, consumedPercent, resolvedTotalMins]);

  // Calculate elapsed time percentage (0-100%)
  const { timePercent, remainingFormatted } = useMemo(() => {
    if (effectiveRemainingMinutes === null) {
      return { timePercent: null, remainingFormatted: '—' };
    }
    const clampedRem = Math.max(0, Math.min(resolvedTotalMins, effectiveRemainingMinutes));
    const elapsed = resolvedTotalMins - clampedRem;
    const pct = Math.max(0, Math.min(100, Math.round((elapsed / resolvedTotalMins) * 100)));
    const formatted = formatRemainingTime(clampedRem, isWeekly);
    return { timePercent: pct, remainingFormatted: formatted };
  }, [effectiveRemainingMinutes, resolvedTotalMins, isWeekly]);

  // Effective consumed percent clamped 0 to 100 (null if no data)
  const effectiveConsumedPct = useMemo(() => {
    if (consumedPercent === null || consumedPercent === undefined || isNaN(consumedPercent)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(consumedPercent)));
  }, [consumedPercent]);

  // Pace evaluation based on specification:
  // diff = consumo% - tiempo%
  // diff <= 5: verde, "Ritmo holgado"
  // 5 < diff <= 20: ámbar, "Ritmo ajustado"
  // diff > 20: rojo, "Vas muy rápido"
  // consumo >= 100%: rojo fijo, "Cuota agotada"
  const pace = useMemo(() => {
    if (effectiveConsumedPct === null) {
      return {
        state: 'no-data',
        statusText: isLoading ? 'Consultando en vivo...' : 'Sin datos en vivo',
        secondaryText: '—',
        statusColor: '#64748b',
        ringColor: 'rgba(100, 116, 139, 0.3)',
      };
    }

    if (effectiveConsumedPct >= 100) {
      const resetText =
        resetLabel && resetLabel.startsWith('Se libera en')
          ? resetLabel
          : effectiveRemainingMinutes !== null && effectiveRemainingMinutes > 0
          ? `Reinicia en ${remainingFormatted}`
          : resetLabel
          ? `Reinicia: ${resetLabel.replace(/^Refreshes in\s*/i, '')}`
          : 'En cooldown';
      return {
        state: 'exhausted',
        statusText: 'Cuota agotada',
        secondaryText: resetText,
        statusColor: '#ef4444',
        ringColor: '#ef4444',
      };
    }

    const tPct = timePercent !== null ? timePercent : 0;
    const diff = effectiveConsumedPct - tPct;

    if (diff <= 5) {
      return {
        state: 'easy',
        statusText: 'Ritmo holgado',
        secondaryText: percentLabel || 'Consumo óptimo',
        statusColor: '#22c55e',
        ringColor: '#22c55e',
      };
    }
    if (diff <= 20) {
      return {
        state: 'moderate',
        statusText: 'Ritmo ajustado',
        secondaryText: percentLabel || 'Consumo al límite',
        statusColor: '#f59e0b',
        ringColor: '#f59e0b',
      };
    }
    return {
      state: 'fast',
      statusText: 'Vas muy rápido',
      secondaryText: percentLabel || 'Riesgo de agotamiento',
      statusColor: '#ef4444',
      ringColor: '#ef4444',
    };
  }, [
    effectiveConsumedPct,
    timePercent,
    isLoading,
    effectiveRemainingMinutes,
    remainingFormatted,
    resetLabel,
    percentLabel,
  ]);

  // Geometry configuration:
  // Center: (60, 60), Outer ring r = 46, Inner ring r = 37
  const cx = 60;
  const cy = 60;
  const rOuter = 46;
  const rInner = 37;
  const outerCircumference = 2 * Math.PI * rOuter; // ~289.03
  const innerCircumference = 2 * Math.PI * rInner; // ~232.48

  // Outer ring stroke-dashoffset (time elapsed, clockwise from top)
  const outerOffset =
    timePercent !== null
      ? outerCircumference * (1 - timePercent / 100)
      : outerCircumference;

  // Inner ring stroke-dashoffset (quota consumed, clockwise from top)
  const innerOffset =
    effectiveConsumedPct !== null
      ? innerCircumference * (1 - effectiveConsumedPct / 100)
      : innerCircumference;

  // Needle dot on outer ring marking current time elapsed position
  const dotCoords = useMemo(() => {
    if (timePercent === null) return null;
    const angleRad = (timePercent / 100) * 2 * Math.PI - Math.PI / 2;
    return {
      x: cx + rOuter * Math.cos(angleRad),
      y: cy + rOuter * Math.sin(angleRad),
    };
  }, [timePercent, rOuter, cx, cy]);

  // Ticks marks configuration (10 for 5h, 7 for weekly)
  const ticks = useMemo(() => {
    const list = [];
    const r1 = 51.5;
    const r2 = 54.5;
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * 2 * Math.PI - Math.PI / 2;
      list.push({
        x1: cx + r1 * Math.cos(angle),
        y1: cy + r1 * Math.sin(angle),
        x2: cx + r2 * Math.cos(angle),
        y2: cy + r2 * Math.sin(angle),
      });
    }
    return list;
  }, [tickCount, cx, cy]);

  // Display title text
  const displayTitle = is5h ? 'Ventana de 5 horas' : isWeekly ? 'Semanal' : label;
  const canonicalWindowName = is5h ? 'Five Hour Limit' : isWeekly ? 'Weekly Limit' : label;

  // Accessibility label
  const ariaLabel = useMemo(() => {
    if (effectiveConsumedPct === null) {
      return `${displayTitle}: ${pace.statusText}`;
    }
    if (effectiveConsumedPct >= 100) {
      return `${displayTitle}: Cuota agotada, ${pace.secondaryText}, 100% agotado`;
    }
    return `${displayTitle}: ${pace.statusText}, quedan ${remainingFormatted}, ${effectiveConsumedPct}% usado`;
  }, [displayTitle, effectiveConsumedPct, pace.statusText, pace.secondaryText, remainingFormatted]);

  return (
    <div
      className="quota-clock-wrapper"
      data-testid={testId}
      aria-label={ariaLabel}
      role="meter"
      aria-valuenow={effectiveConsumedPct !== null ? effectiveConsumedPct : 0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="quota-clock-svg-container">
        <svg
          className="quota-clock-svg"
          viewBox="0 0 120 120"
          width="114"
          height="114"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Tick marks around outer ring */}
          <g className="quota-clock-ticks" aria-hidden="true">
            {ticks.map((t, idx) => (
              <line
                key={idx}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke="rgba(148, 163, 184, 0.45)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* Outer ring track (Time window background) */}
          <circle
            cx={cx}
            cy={cy}
            r={rOuter}
            fill="none"
            stroke="rgba(56, 189, 248, 0.15)"
            strokeWidth="5"
          />

          {/* Outer ring fill (Elapsed time - sky blue) */}
          <circle
            className="quota-clock-ring outer-ring"
            cx={cx}
            cy={cy}
            r={rOuter}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="5"
            strokeDasharray={outerCircumference}
            strokeDashoffset={outerOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />

          {/* Dot (Needle indicator on outer ring) */}
          {dotCoords && (
            <circle
              className="quota-clock-needle-dot"
              cx={dotCoords.x}
              cy={dotCoords.y}
              r="3"
              fill="#38bdf8"
              stroke="#0f172a"
              strokeWidth="1.2"
            />
          )}

          {/* Inner ring track (Quota background) */}
          <circle
            cx={cx}
            cy={cy}
            r={rInner}
            fill="none"
            stroke="rgba(51, 65, 85, 0.4)"
            strokeWidth="5"
          />

          {/* Inner ring fill (Quota consumed - dynamic pace color) */}
          <circle
            className="quota-clock-ring inner-ring"
            cx={cx}
            cy={cy}
            r={rInner}
            fill="none"
            stroke={pace.ringColor}
            strokeWidth="5"
            strokeDasharray={innerCircumference}
            strokeDashoffset={innerOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />

          {/* Center Content */}
          {effectiveConsumedPct === null ? (
            <text
              x={cx}
              y={cy + 5}
              textAnchor="middle"
              className="quota-clock-center-empty"
              fill="#64748b"
              fontSize="16"
              fontWeight="600"
            >
              —
            </text>
          ) : (
            <g className="quota-clock-center-text" textAnchor="middle">
              <text
                x={cx}
                y="48"
                className="quota-clock-center-small"
                fill="#64748b"
                fontSize="8"
                fontWeight="500"
              >
                quedan
              </text>
              <text
                x={cx}
                y="62"
                className="quota-clock-center-large"
                fill="#f8fafc"
                fontSize="11.5"
                fontWeight="700"
              >
                {remainingFormatted}
              </text>
              <text
                x={cx}
                y="74"
                className="quota-clock-center-sub"
                fill={pace.statusColor}
                fontSize="8.5"
                fontWeight="600"
              >
                {effectiveConsumedPct >= 100
                  ? (percentLabel || '100% agotado')
                  : `${effectiveConsumedPct}% usado`}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Info beneath the clock */}
      <div className="quota-clock-details">
        <div className="quota-clock-title-wrap">
          <span className="quota-clock-title">{displayTitle}</span>
          <span className="quota-clock-canonical-label" title={canonicalWindowName}>
            {canonicalWindowName}
          </span>
        </div>
        <div
          className="quota-clock-status"
          style={{ color: pace.statusColor }}
          data-testid={`quota-clock-status-${windowKey || 'clock'}`}
        >
          {pace.statusText}
        </div>
        <div className="quota-clock-secondary">
          {pace.secondaryText}
        </div>
      </div>
    </div>
  );
}

export default QuotaClock;
