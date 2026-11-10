const LAYOUTS: Record<number, string[]> = {
  1: [' '],
  2: ['d', 'k'],
  3: ['d', ' ', 'k'],
  4: ['d', 'f', 'j', 'k'],
  5: ['d', 'f', ' ', 'j', 'k'],
  6: ['s', 'd', 'f', 'j', 'k', 'l'],
  7: ['s', 'd', 'f', ' ', 'j', 'k', 'l'],
  8: ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'],
  9: ['a', 's', 'd', 'f', ' ', 'j', 'k', 'l', ';'],
  10: ['a', 's', 'd', 'f', 'v', 'n', 'j', 'k', 'l', ';'],
};

const POOL = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', 'q', 'w', 'e', 'r', 'u', 'i', 'o', 'p'];

export function keyLabelsFor(keys: number): string[] {
  const preset = LAYOUTS[keys];
  if (preset) return preset;
  return POOL.slice(0, Math.max(1, Math.min(keys, POOL.length)));
}

export function displayKey(label: string): string {
  if (label === ' ') return 'SPACE';
  return label.toUpperCase();
}
