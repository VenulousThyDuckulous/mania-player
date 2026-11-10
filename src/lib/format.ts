export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(2)} GB`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function difficultyLabel(od: number): string {
  if (od < 2.5) return 'Easy';
  if (od < 5) return 'Normal';
  if (od < 7) return 'Hard';
  if (od < 8.5) return 'Insane';
  return 'Expert';
}
