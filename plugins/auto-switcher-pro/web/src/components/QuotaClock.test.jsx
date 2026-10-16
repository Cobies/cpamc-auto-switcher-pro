import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  QuotaClock,
  parseRemainingMinutesFromLabel,
  formatRemainingTime,
} from './QuotaClock';

describe('QuotaClock Component & Utilities', () => {
  describe('Helper Functions', () => {
    it('parseRemainingMinutesFromLabel correctly parses various time string formats', () => {
      expect(parseRemainingMinutesFromLabel('Refreshes in 4h 45m')).toBe(285);
      expect(parseRemainingMinutesFromLabel('Refreshes in 5d 12h')).toBe(5 * 1440 + 12 * 60);
      expect(parseRemainingMinutesFromLabel('Se libera en 2h 15m')).toBe(135);
      expect(parseRemainingMinutesFromLabel('Refreshes in 5h 0m')).toBe(300);
      expect(parseRemainingMinutesFromLabel('30m')).toBe(30);
      expect(parseRemainingMinutesFromLabel('—')).toBeNull();
      expect(parseRemainingMinutesFromLabel(null)).toBeNull();
    });

    it('formatRemainingTime formats durations accurately for 5h and weekly', () => {
      expect(formatRemainingTime(285, false)).toBe('4h 45m');
      expect(formatRemainingTime(5 * 1440 + 12 * 60, true)).toBe('5d 12h');
      expect(formatRemainingTime(45, false)).toBe('45m');
      expect(formatRemainingTime(0, false)).toBe('0m');
      expect(formatRemainingTime(null, false)).toBe('—');
    });
  });

  describe('Acceptance Criteria & Visual States', () => {
    it('Criterion 1: With 40% time elapsed and 25% quota consumed -> green inner ring and "Ritmo holgado"', () => {
      // 5h window (300 min total). 40% elapsed means 60% remaining = 180 min remaining.
      render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={180}
          consumedPercent={25}
          label="Ventana de 5 horas"
          windowKey="5h"
          testId="test-clock-c1"
        />
      );

      expect(screen.getByText('Ritmo holgado')).toBeTruthy();
      expect(screen.getByText('Ventana de 5 horas')).toBeTruthy();
      expect(screen.getByText('Five Hour Limit')).toBeTruthy();
      expect(screen.getByText('3h 0m')).toBeTruthy(); // 180 min = 3h 0m
      expect(screen.getByText('25% usado')).toBeTruthy();

      const meter = screen.getByTestId('test-clock-c1');
      expect(meter.getAttribute('aria-label')).toContain('Ritmo holgado');
      expect(meter.getAttribute('aria-label')).toContain('quedan 3h 0m');
    });

    it('Criterion 2: With 30% time elapsed and 62% quota consumed -> red inner ring and "Vas muy rápido"', () => {
      // 5h window (300 min total). 30% elapsed means 70% remaining = 210 min remaining.
      // diff = 62 - 30 = 32 > 20 -> fast / red
      render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={210}
          consumedPercent={62}
          label="Ventana de 5 horas"
          windowKey="5h"
          testId="test-clock-c2"
        />
      );

      expect(screen.getByText('Vas muy rápido')).toBeTruthy();
      expect(screen.getByText('3h 30m')).toBeTruthy(); // 210 min = 3h 30m
      expect(screen.getByText('62% usado')).toBeTruthy();

      const meter = screen.getByTestId('test-clock-c2');
      expect(meter.getAttribute('aria-label')).toContain('Vas muy rápido');
    });

    it('Criterion 3: With 100% quota consumed before reset -> solid red, "Cuota agotada", and "Reinicia en ..."', () => {
      // 5h window with 1h 20m remaining (80 min remaining) and 100% consumed
      render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={80}
          consumedPercent={100}
          label="Ventana de 5 horas"
          windowKey="5h"
          testId="test-clock-c3"
        />
      );

      expect(screen.getByText('Cuota agotada')).toBeTruthy();
      expect(screen.getByText(/Reinicia en 1h 20m/)).toBeTruthy();
      expect(screen.getByText('100% agotado')).toBeTruthy();

      const meter = screen.getByTestId('test-clock-c3');
      expect(meter.getAttribute('aria-label')).toContain('Cuota agotada');
      expect(meter.getAttribute('aria-label')).toContain('100% agotado');
    });

    it('Criterion 4: With 5h 0m remaining and quota available (0% consumed) -> almost empty rings in green', () => {
      render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={300}
          consumedPercent={0}
          label="Ventana de 5 horas"
          windowKey="5h"
          resetLabel="Refreshes in 5h 0m"
          percentLabel="Quota available"
          testId="test-clock-c4"
        />
      );

      expect(screen.getByText('Ritmo holgado')).toBeTruthy();
      expect(screen.getByText('5h 0m')).toBeTruthy();
      expect(screen.getByText('0% usado')).toBeTruthy();
    });

    it('Criterion 5: Without quota data (null) -> empty gray rings with "—" in the center and "Sin datos en vivo"', () => {
      render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={null}
          consumedPercent={null}
          label="Ventana de 5 horas"
          windowKey="5h"
          testId="test-clock-c5"
        />
      );

      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Sin datos en vivo')).toBeTruthy();
      expect(screen.queryByText('quedan')).toBeNull();

      const meter = screen.getByTestId('test-clock-c5');
      expect(meter.getAttribute('aria-label')).toContain('Sin datos en vivo');
    });

    it('Criterion 6: Tick marks count corresponds to 10 for 5h window and 7 for weekly window', () => {
      const { container: container5h } = render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={150}
          consumedPercent={50}
          label="Ventana de 5 horas"
          windowKey="5h"
        />
      );
      const ticks5h = container5h.querySelectorAll('.quota-clock-ticks line');
      expect(ticks5h.length).toBe(10);

      const { container: containerWeekly } = render(
        <QuotaClock
          totalMinutes={10080}
          remainingMinutes={5040}
          consumedPercent={50}
          label="Semanal"
          windowKey="weekly"
        />
      );
      const ticksWeekly = containerWeekly.querySelectorAll('.quota-clock-ticks line');
      expect(ticksWeekly.length).toBe(7);
    });

    it('renders needle dot marking current elapsed time position', () => {
      const { container } = render(
        <QuotaClock
          totalMinutes={300}
          remainingMinutes={150}
          consumedPercent={50}
          label="Ventana de 5 horas"
          windowKey="5h"
        />
      );
      const dot = container.querySelector('.quota-clock-needle-dot');
      expect(dot).toBeTruthy();
    });
  });
});
