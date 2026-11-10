import { unzipSync } from 'fflate';
import type { Beatmap, HitObject, TimingPoint } from '../types';

const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;
const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

export interface ImportedSet {
  maps: Beatmap[];
  cover: Blob | null;
  entries: string[];
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

export function dirOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function findEntry(
  entries: Record<string, Uint8Array>,
  wanted: string,
  baseDir: string,
): string | null {
  const keys = Object.keys(entries);
  const normalizedWanted = normalizePath(wanted);
  const target = normalizePath(baseDir ? `${baseDir}/${normalizedWanted}` : normalizedWanted);

  const exact = keys.find((key) => normalizePath(key) === target);
  if (exact) return exact;

  const baseName = normalizedWanted.split('/').pop();
  if (!baseName) return null;
  return (
    keys.find((key) => normalizePath(key).split('/').pop() === baseName) ?? null
  );
}

export function unzipOsz(data: ArrayBuffer): Record<string, Uint8Array> {
  try {
    return unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('That file is not a valid .osz archive');
  }
}

function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

function imageMimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function primaryBpm(points: TimingPoint[]): number {
  const uninherited = points
    .filter((point) => point.uninherited && point.beatLength > 0)
    .sort((a, b) => a.time - b.time);
  if (uninherited.length === 0) return 0;

  const weights = new Map<number, number>();
  for (let i = 0; i < uninherited.length; i += 1) {
    const point = uninherited[i];
    const next = uninherited[i + 1];
    const duration = (next ? next.time : point.time + 15000) - point.time;
    const bpm = Math.round(60000 / point.beatLength);
    if (bpm < 20 || bpm > 600) continue;
    weights.set(bpm, (weights.get(bpm) ?? 0) + Math.max(0, duration));
  }

  let best = 0;
  let bestWeight = -1;
  for (const [bpm, weight] of weights) {
    if (weight > bestWeight) {
      best = bpm;
      bestWeight = weight;
    }
  }
  if (best > 0) return best;
  return Math.round(60000 / uninherited[0].beatLength);
}

export function parseOsuFile(text: string, fileName: string): Beatmap | null {
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

  const general: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  const difficulty: Record<string, string> = {};
  const timingPoints: TimingPoint[] = [];
  const notes: HitObject[] = [];
  let backgroundFile: string | null = null;
  let section = '';

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      continue;
    }

    if (section === 'General' || section === 'Metadata' || section === 'Difficulty') {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      const target =
        section === 'General' ? general : section === 'Metadata' ? metadata : difficulty;
      target[key] = value;
      continue;
    }

    if (section === 'Events') {
      const parts = line.split(',');
      const type = parts[0]?.trim();
      if ((type === '0' || type === 'Background') && parts[2]) {
        backgroundFile = parts[2].trim().replace(/^"|"$/g, '');
      }
      continue;
    }

    if (section === 'TimingPoints') {
      const fields = line.split(',');
      const time = Number(fields[0]);
      const beatLength = Number(fields[1]);
      if (!Number.isFinite(time) || !Number.isFinite(beatLength) || beatLength === 0) continue;
      const uninherited = fields.length >= 7 ? fields[6].trim() !== '0' : beatLength > 0;
      timingPoints.push({ time, beatLength, uninherited });
      continue;
    }

    if (section === 'HitObjects') {
      const fields = line.split(',');
      if (fields.length < 5) continue;
      const x = Number(fields[0]);
      const time = Number(fields[2]);
      const type = Number(fields[3]);
      if (!Number.isFinite(x) || !Number.isFinite(type) || !Number.isFinite(time)) continue;

      const isCircle = (type & 1) !== 0;
      const isSlider = (type & 2) !== 0;
      const isHold = (type & 128) !== 0;
      if (!isCircle && !isSlider && !isHold) continue;

      const keysGuess = clamp(Math.round(Number(difficulty.CircleSize || '4')), 1, 18);
      const column = clamp(Math.floor((x * keysGuess) / 512), 0, keysGuess - 1);

      let endTime: number | null = null;
      if (isHold) {
        const rawEnd = (fields[5] ?? '').split(':')[0];
        const parsedEnd = Number(rawEnd);
        if (!Number.isFinite(parsedEnd) || parsedEnd <= time) continue;
        endTime = parsedEnd;
      }

      notes.push({ column, time, endTime });
      continue;
    }
  }

  const mode = Number(general.Mode ?? '0');
  if (mode !== 3) return null;

  const keys = clamp(Math.round(Number(difficulty.CircleSize || '4')), 1, 18);
  if (!Number.isFinite(keys) || keys < 1) return null;
  if (notes.length === 0) return null;

  // Column indexes were computed with the same key count, so nothing to remap.
  notes.sort((a, b) => a.time - b.time || a.column - b.column);

  let length = 0;
  let holds = 0;
  for (const note of notes) {
    const end = note.endTime ?? note.time;
    if (end > length) length = end;
    if (note.endTime !== null) holds += 1;
  }

  const fallbackName = fileName.split('/').pop()?.replace(/\.osu$/i, '') ?? 'Unknown';
  const od = clamp(Number(difficulty.OverallDifficulty ?? '5'), 0, 10);

  return {
    fileName,
    title: metadata.Title || metadata.TitleUnicode || fallbackName,
    titleUnicode: metadata.TitleUnicode || metadata.Title || fallbackName,
    artist: metadata.Artist || metadata.ArtistUnicode || 'Unknown artist',
    artistUnicode: metadata.ArtistUnicode || metadata.Artist || 'Unknown artist',
    creator: metadata.Creator || 'Unknown mapper',
    version: metadata.Version || 'Normal',
    keys,
    od,
    hp: clamp(Number(difficulty.HPDrainRate ?? '5'), 0, 10),
    audioFile: general.AudioFilename ?? '',
    backgroundFile,
    previewTime: Number(general.PreviewTime ?? '-1'),
    bpm: primaryBpm(timingPoints),
    notes,
    length,
    totalNotes: notes.length,
    totalHolds: holds,
    timingPoints,
  };
}

export function readOsz(data: ArrayBuffer): ImportedSet {
  const entries = unzipOsz(data);
  const names = Object.keys(entries);
  const maps: Beatmap[] = [];

  for (const name of names) {
    if (!name.toLowerCase().endsWith('.osu')) continue;
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(entries[name]);
    } catch {
      continue;
    }
    const map = parseOsuFile(text, name);
    if (map) maps.push(map);
  }

  maps.sort(
    (a, b) =>
      a.keys - b.keys || a.notes[0].time - b.notes[0].time || a.version.localeCompare(b.version),
  );

  let cover: Blob | null = null;
  for (const map of maps) {
    if (!map.backgroundFile) continue;
    const key = findEntry(entries, map.backgroundFile, dirOf(map.fileName));
    if (!key) continue;
    cover = toBlob(entries[key], imageMimeFor(key));
    break;
  }

  if (!cover) {
    const fallbackImage = names.find((name) => IMAGE_RE.test(name));
    if (fallbackImage) cover = toBlob(entries[fallbackImage], imageMimeFor(fallbackImage));
  }

  return { maps, cover, entries: names };
}

export function readAudioBuffer(data: ArrayBuffer, map: Beatmap): ArrayBuffer | null {
  const entries = unzipOsz(data);
  // Charts that point at a full archive path (Psych Engine mods keep one audio file
  // per song folder) resolve exactly first, so same-named tracks never collide.
  const wanted = map.audioFile ? normalizePath(map.audioFile) : '';
  let key = wanted
    ? (Object.keys(entries).find((name) => normalizePath(name) === wanted) ?? null)
    : null;
  if (!key && map.audioFile) key = findEntry(entries, map.audioFile, dirOf(map.fileName));
  if (!key) key = Object.keys(entries).find((name) => AUDIO_RE.test(name)) ?? null;
  if (!key) return null;

  const bytes = entries[key];
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
