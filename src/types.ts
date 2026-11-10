export type Judgement = 0 | 50 | 100 | 200 | 300 | 320;

export interface TimingPoint {
  time: number;
  beatLength: number;
  uninherited: boolean;
}

export interface HitObject {
  column: number;
  time: number;
  endTime: number | null;
}

export type BeatmapSource = 'osu' | 'psych';

export interface Beatmap {
  /** Path of the chart file inside the archive. */
  fileName: string;
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  creator: string;
  version: string;
  keys: number;
  od: number;
  hp: number;
  audioFile: string;
  backgroundFile: string | null;
  previewTime: number;
  bpm: number;
  notes: HitObject[];
  length: number;
  totalNotes: number;
  totalHolds: number;
  timingPoints: TimingPoint[];
  /** Where the chart came from. Undefined means a plain osu!mania .osz chart. */
  source?: BeatmapSource;
  /** Psych Engine: song folder used to group difficulties together. */
  songKey?: string;
  /** Psych Engine: chart difficulty name, e.g. "Hard". */
  difficulty?: string;
  /** Psych Engine: which side of the chart the player takes. */
  side?: 'player' | 'opponent';
  /** Psych Engine: display name of that side's character, e.g. "Boyfriend". */
  sideLabel?: string;
}

export interface StoredSetMeta {
  id: string;
  name: string;
  fileName: string;
  addedAt: number;
  maps: Beatmap[];
  cover: Blob | null;
  size: number;
}
