import { unzipOsz, normalizePath } from './osz';
import type { Beatmap, HitObject } from '../types';

const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;
const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'erect', 'nightmare'];
const PSYCH_OD = 6;

const CHARACTER_NAMES: Record<string, string> = {
  bf: 'Boyfriend',
  boy: 'Boyfriend',
  boyfriend: 'Boyfriend',
  gf: 'Girlfriend',
  girlfriend: 'Girlfriend',
  dad: 'Dad',
  daddy: 'Dad',
  mom: 'Mom',
  mommy: 'Mom',
  pico: 'Pico',
  parents: 'Parents',
  spooky: 'Spooky Kids',
  monster: 'Monster',
  senpai: 'Senpai',
  spirit: 'Spirit',
};

export interface PsychSongGroup {
  key: string;
  title: string;
  artist: string;
  /** Every playable chart: each difficulty, for each side that has notes. */
  maps: Beatmap[];
}

export interface PsychMod {
  songs: PsychSongGroup[];
  cover: Blob | null;
}

interface ParsedChart {
  path: string;
  songKey: string;
  difficulty: string;
  song: Record<string, unknown>;
  playerNotes: HitObject[];
  opponentNotes: HitObject[];
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value: string): string {
  const trimmed = value.replace(/[_-]+/g, ' ').trim();
  if (!trimmed) return value;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function characterLabel(value: unknown, fallback: string): string {
  const raw = stringOf(value).split('-')[0].toLowerCase();
  if (!raw) return fallback;
  return CHARACTER_NAMES[raw] ?? titleCase(raw);
}

/** Finds the song folder a chart lives in, e.g. `mod/data/bopeebo/charts/x.json` → `bopeebo`. */
function songKeyFromPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/');
  const dataIndex = parts.findIndex((part) => part.toLowerCase() === 'data');
  if (dataIndex < 0) return null;
  const between = parts.slice(dataIndex + 1, -1).filter((part) => part.toLowerCase() !== 'charts');
  return between[0] ?? null;
}

/**
 * Psych charts store both sides in one note list: data 0-3 are the player's lanes and
 * data 4-7 are the opponent's. Older builds wrapped notes in sections, so flatten both.
 */
function flattenNotes(raw: unknown): unknown[][] {
  if (!Array.isArray(raw)) return [];
  const notes: unknown[][] = [];
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      notes.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const sectionNotes = (entry as { sectionNotes?: unknown }).sectionNotes;
      if (Array.isArray(sectionNotes)) notes.push(...flattenNotes(sectionNotes));
    }
  }
  return notes;
}

function sideNotes(entries: unknown[][], opponent: boolean): HitObject[] {
  const notes: HitObject[] = [];
  for (const entry of entries) {
    const time = toNumber(entry[0]);
    const data = toNumber(entry[1]);
    const sustain = Math.max(0, toNumber(entry[2]));
    if (data < 0) continue;
    const isOpponent = Math.floor(data) >= 4;
    if (isOpponent !== opponent) continue;
    if (time < 0) continue;
    const column = Math.floor(data) % 4;
    notes.push({ column, time, endTime: sustain > 0 ? time + sustain : null });
  }
  notes.sort((a, b) => a.time - b.time || a.column - b.column);
  return notes;
}

function difficultyFromPath(path: string, songKey: string, title: string): string {
  const stem = (path.split('/').pop() ?? '').replace(/\.json$/i, '');
  const lower = stem.toLowerCase();
  const keyLower = songKey.toLowerCase();
  const titleLower = title.toLowerCase();
  if (lower === keyLower || lower === titleLower) return 'Normal';

  const prefix = titleLower && lower.startsWith(titleLower) ? title : songKey;
  if (lower.startsWith(prefix.toLowerCase())) {
    const suffix = stem
      .slice(prefix.length)
      .replace(/^[\s._-]+/, '')
      .trim();
    if (suffix) return titleCase(suffix);
  }
  return titleCase(stem);
}

function difficultyRank(name: string): number {
  const index = DIFFICULTY_ORDER.indexOf(name.toLowerCase());
  return index >= 0 ? index : DIFFICULTY_ORDER.length;
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

function findCover(names: string[], entries: Record<string, Uint8Array>): Blob | null {
  const candidates = [
    /\/images\/menubg\.[a-z]+$/,
    /images\/menubg\.[a-z]+$/,
    /\/images\/menudesat\.[a-z]+$/,
  ];
  for (const pattern of candidates) {
    const key = names.find(
      (name) => IMAGE_RE.test(name) && pattern.test(normalizePath(name)),
    );
    if (key) return toBlob(entries[key], imageMimeFor(key));
  }
  const fallback = names.find(
    (name) => normalizePath(name).includes('/images/') && IMAGE_RE.test(name),
  );
  return fallback ? toBlob(entries[fallback], imageMimeFor(fallback)) : null;
}

function findAudio(names: string[], songKey: string): string | null {
  const folder = `songs/${songKey.toLowerCase()}/`;
  const inside = names.filter(
    (name) => AUDIO_RE.test(name) && normalizePath(name).includes(folder),
  );
  if (inside.length === 0) return null;
  return inside.find((name) => /\/inst\./i.test(name)) ?? inside[0];
}

/**
 * Reads a Psych Engine mod archive (any .zip that contains `data/**` charts and
 * `songs/**` audio). Returns null when the archive is not a Psych mod.
 */
export function readPsychMod(data: ArrayBuffer): PsychMod | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipOsz(data);
  } catch {
    return null;
  }

  const names = Object.keys(entries);
  const metadataBySong = new Map<string, Record<string, unknown>>();
  const charts: ParsedChart[] = [];

  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const songKey = songKeyFromPath(name);
    if (!songKey) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8').decode(entries[name]));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    if (/metadata\.json$/i.test(name)) {
      metadataBySong.set(songKey.toLowerCase(), parsed as Record<string, unknown>);
      continue;
    }

    const song = (parsed as { song?: Record<string, unknown> }).song;
    if (!song || typeof song !== 'object') continue;
    const rawNotes = flattenNotes(song.notes);
    if (rawNotes.length === 0) continue;

    const playerNotes = sideNotes(rawNotes, false);
    const opponentNotes = sideNotes(rawNotes, true);
    if (playerNotes.length === 0 && opponentNotes.length === 0) continue;

    const title =
      stringOf(song.song) ||
      stringOf(metadataBySong.get(songKey.toLowerCase())?.songName) ||
      songKey;

    charts.push({
      path: name,
      songKey,
      difficulty: difficultyFromPath(name, songKey, title),
      song,
      playerNotes,
      opponentNotes,
    });
  }

  if (charts.length === 0) return null;

  charts.sort((a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty));

  const songs = new Map<string, { key: string; title: string; artist: string; maps: Beatmap[] }>();
  const audioBySong = new Map<string, string | null>();

  for (const chart of charts) {
    const songLower = chart.songKey.toLowerCase();
    const metadata = metadataBySong.get(songLower) ?? {};
    const title =
      stringOf(metadata.songName) ||
      stringOf(chart.song.song) ||
      chart.songKey;
    const artist =
      stringOf(metadata.artist) || stringOf(chart.song.artist) || 'Unknown artist';
    const bpm = toNumber(chart.song.bpm);
    const playerLabel = characterLabel(chart.song.player1, 'Boyfriend');
    const opponentLabel = characterLabel(chart.song.player2, 'Dad');

    let group = songs.get(songLower);
    if (!group) {
      group = { key: chart.songKey, title, artist, maps: [] };
      songs.set(songLower, group);
    }

    if (!audioBySong.has(songLower)) audioBySong.set(songLower, findAudio(names, chart.songKey));
    const audioFile = audioBySong.get(songLower) ?? '';

    const sides: { side: 'player' | 'opponent'; label: string; notes: HitObject[] }[] = [];
    if (chart.playerNotes.length > 0) {
      sides.push({ side: 'player', label: playerLabel, notes: chart.playerNotes });
    }
    if (chart.opponentNotes.length > 0) {
      sides.push({ side: 'opponent', label: opponentLabel, notes: chart.opponentNotes });
    }

    for (const { side, label, notes } of sides) {
      let length = 0;
      let holds = 0;
      for (const note of notes) {
        const end = note.endTime ?? note.time;
        if (end > length) length = end;
        if (note.endTime !== null) holds += 1;
      }

      group.maps.push({
        fileName: chart.path,
        title,
        titleUnicode: title,
        artist,
        artistUnicode: artist,
        creator: 'Psych Engine',
        version: `${chart.difficulty} · ${label}`,
        keys: 4,
        od: PSYCH_OD,
        hp: 7,
        audioFile,
        backgroundFile: null,
        previewTime: -1,
        bpm,
        notes,
        length,
        totalNotes: notes.length,
        totalHolds: holds,
        timingPoints: [],
        source: 'psych',
        songKey: chart.songKey,
        difficulty: chart.difficulty,
        side,
        sideLabel: label,
      });
    }
  }

  return {
    songs: [...songs.values()],
    cover: findCover(names, entries),
  };
}
