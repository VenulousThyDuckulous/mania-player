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

export interface Beatmap {
  /** Path of the .osu file inside the .osz archive. */
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
