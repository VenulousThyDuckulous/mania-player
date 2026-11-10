export interface Settings {
  scrollSpeed: number;
  volume: number;
  autoplay: boolean;
  hitsounds: boolean;
}

const STORAGE_KEY = 'mania-player:settings';

export const DEFAULT_SETTINGS: Settings = {
  scrollSpeed: 12,
  volume: 0.8,
  autoplay: false,
  hitsounds: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      scrollSpeed:
        typeof parsed.scrollSpeed === 'number'
          ? Math.min(30, Math.max(3, parsed.scrollSpeed))
          : DEFAULT_SETTINGS.scrollSpeed,
      volume:
        typeof parsed.volume === 'number'
          ? Math.min(1, Math.max(0, parsed.volume))
          : DEFAULT_SETTINGS.volume,
      autoplay: parsed.autoplay === true,
      hitsounds: parsed.hitsounds !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function persistSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota or privacy-mode failures.
  }
}
