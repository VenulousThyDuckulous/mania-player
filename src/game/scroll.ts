import type { TimingPoint } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns a function mapping a chart time (ms) to accumulated scroll distance.
 * Differences between two times, scaled by pixels-per-ms, give on-screen offset,
 * so inherited timing points (scroll velocity) are respected.
 */
export function createScrollMap(
  points: TimingPoint[],
  startTime: number,
): (time: number) => number {
  const segments: { time: number; sv: number }[] = [{ time: startTime, sv: 1 }];

  const sorted = [...points].sort((a, b) => a.time - b.time);
  for (const point of sorted) {
    const sv = point.uninherited ? 1 : clamp(-100 / point.beatLength, 0.05, 10);
    if (!Number.isFinite(sv)) continue;

    const last = segments[segments.length - 1];
    if (point.time <= startTime || point.time === last.time) {
      last.sv = sv;
      continue;
    }
    segments.push({ time: point.time, sv });
  }

  const cumulative = new Float64Array(segments.length);
  for (let i = 1; i < segments.length; i += 1) {
    const previous = segments[i - 1];
    cumulative[i] = cumulative[i - 1] + (segments[i].time - previous.time) * previous.sv;
  }

  const first = segments[0];
  const lastIndex = segments.length - 1;

  return (time: number) => {
    if (time <= first.time) return cumulative[0] + (time - first.time) * first.sv;

    let low = 0;
    let high = lastIndex;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (segments[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return cumulative[low] + (time - segments[low].time) * segments[low].sv;
  };
}
