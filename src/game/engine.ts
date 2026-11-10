import type { Beatmap, Judgement } from '../types';
import { getAudioContext, playHitSound } from '../lib/audio';
import { displayKey, keyLabelsFor } from './keys';
import { createScrollMap } from './scroll';

export type PlayerStatus = 'playing' | 'paused' | 'finished';

export interface JudgementCounts {
  max: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
}

export interface Hud {
  status: PlayerStatus;
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  counts: JudgementCounts;
  progress: number;
  time: number;
  duration: number;
  hasAudio: boolean;
}

export interface EngineOptions {
  scrollSpeed: number;
  volume: number;
  autoplay: boolean;
  hitsounds: boolean;
  onHud: (hud: Hud) => void;
  onFinish: () => void;
}

interface NoteState {
  column: number;
  time: number;
  endTime: number | null;
  isHold: boolean;
  judged: boolean;
  tailJudged: boolean;
  head: Judgement;
  tail: Judgement;
  hitAt: number;
  broken: boolean;
}

interface Windows {
  w320: number;
  w300: number;
  w200: number;
  w100: number;
  w50: number;
  wMiss: number;
}

const COMBO_CAP = 200;
const HOLD_RELEASE_GRACE = 90;
/** Pre-roll before the song: notes scroll in and the player gets a beat to get ready. */
const LEAD_IN_MS = 3000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function accuracyWeight(judgement: Judgement): number {
  switch (judgement) {
    case 320:
    case 300:
      return 1;
    case 200:
      return 2 / 3;
    case 100:
      return 1 / 3;
    case 50:
      return 1 / 6;
    default:
      return 0;
  }
}

function judgeWindow(delta: number, windows: Windows): Judgement {
  if (delta <= windows.w320) return 320;
  if (delta <= windows.w300) return 300;
  if (delta <= windows.w200) return 200;
  if (delta <= windows.w100) return 100;
  if (delta <= windows.w50) return 50;
  return 0;
}

function judgementLabel(judgement: Judgement): string {
  if (judgement === 0) return 'MISS';
  if (judgement === 320) return 'MAX';
  return String(judgement);
}

function judgementColor(judgement: Judgement): string {
  switch (judgement) {
    case 320:
      return '#ffd66b';
    case 300:
      return '#8ef0b6';
    case 200:
      return '#7cd4ff';
    case 100:
      return '#b7a5ff';
    case 50:
      return '#c8c6d6';
    default:
      return '#ff6b84';
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class ManiaEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly audio: AudioBuffer | null;
  private readonly cover: HTMLImageElement | null;
  private readonly opts: EngineOptions;

  private readonly cols: number;
  private readonly keyLabels: string[];
  private readonly windows: Windows;
  private readonly scrollPos: (time: number) => number;
  private readonly byColumn: NoteState[][] = [];
  private readonly activeHolds: (NoteState | null)[];
  private readonly pressed: boolean[];
  private readonly missCursor: number[];
  private readonly autoCursor: number[];
  private readonly flash: number[];

  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;

  private status: PlayerStatus = 'paused';
  private baseMs = 0;
  private audioStartTime = 0;
  private wallStart = 0;

  private raf = 0;
  private lastEmit = -1000;
  private lastHitSoundAt = -1000;
  private lastJudge: { text: string; color: string; at: number } | null = null;

  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private earned = 0;
  private accSum = 0;
  private judgedUnits = 0;
  private readonly maxScoreValue: number;
  private readonly duration: number;
  private finished = false;

  private counts: JudgementCounts = {
    max: 0,
    great: 0,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 0,
  };

  private scrollSpeed: number;
  private volume: number;
  private autoplay: boolean;
  private hitsounds: boolean;

  constructor(
    canvas: HTMLCanvasElement,
    map: Beatmap,
    audio: AudioBuffer | null,
    cover: HTMLImageElement | null,
    options: EngineOptions,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');

    this.canvas = canvas;
    this.ctx = ctx;
    this.audio = audio;
    this.cover = cover;
    this.opts = options;
    this.scrollSpeed = options.scrollSpeed;
    this.volume = options.volume;
    this.autoplay = options.autoplay;
    this.hitsounds = options.hitsounds;

    this.cols = Math.max(1, map.keys);
    this.keyLabels = keyLabelsFor(this.cols);
    this.scrollPos = createScrollMap(map.timingPoints, -10000);

    const od = clamp(map.od, 0, 10);
    this.windows = {
      w320: Math.max(8, 16.5 - 0.15 * od),
      w300: Math.max(10, 64 - 3 * od),
      w200: Math.max(12, 97 - 3 * od),
      w100: Math.max(14, 127 - 3 * od),
      w50: Math.max(16, 151 - 3 * od),
      wMiss: Math.max(18, 188 - 3 * od),
    };

    for (let column = 0; column < this.cols; column += 1) this.byColumn.push([]);

    let lastUnitTime = 0;
    const unitTimes: number[] = [];
    for (const note of map.notes) {
      if (note.column < 0 || note.column >= this.cols) continue;
      const state: NoteState = {
        column: note.column,
        time: note.time,
        endTime: note.endTime,
        isHold: note.endTime !== null,
        judged: false,
        tailJudged: false,
        head: 0,
        tail: 0,
        hitAt: 0,
        broken: false,
      };
      this.byColumn[note.column].push(state);
      unitTimes.push(note.time);
      if (note.endTime !== null) unitTimes.push(note.endTime);
      lastUnitTime = Math.max(lastUnitTime, note.endTime ?? note.time);
    }
    for (const column of this.byColumn) column.sort((a, b) => a.time - b.time);

    this.activeHolds = new Array<NoteState | null>(this.cols).fill(null);
    this.pressed = new Array<boolean>(this.cols).fill(false);
    this.missCursor = new Array<number>(this.cols).fill(0);
    this.autoCursor = new Array<number>(this.cols).fill(0);
    this.flash = new Array<number>(this.cols).fill(-1000);

    unitTimes.sort((a, b) => a - b);
    let maxScore = 0;
    for (let index = 0; index < unitTimes.length; index += 1) {
      maxScore += 320 * (1 + Math.min(index + 1, COMBO_CAP) / 25);
    }
    this.maxScoreValue = Math.max(1, maxScore);
    this.duration = Math.max(1000, lastUnitTime + 1500);

    const audioContext = getAudioContext();
    this.gain = audioContext.createGain();
    this.gain.gain.value = this.volume * 0.9;
    this.gain.connect(audioContext.destination);

    this.emit(0, true);
  }

  get currentStatus(): PlayerStatus {
    return this.status;
  }

  start(): void {
    this.reset();
    this.status = 'playing';
    this.finished = false;
    this.baseMs = -LEAD_IN_MS;
    this.audioStartTime = getAudioContext().currentTime;
    this.wallStart = performance.now();
    void getAudioContext().resume();
    this.startSource(this.baseMs);
    this.emit(this.baseMs, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.baseMs = this.currentMs();
    this.status = 'paused';
    this.stopSource();
    this.pressed.fill(false);
    this.draw(this.baseMs);
    this.emit(this.baseMs, true);
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'playing';
    this.audioStartTime = getAudioContext().currentTime;
    this.wallStart = performance.now();
    void getAudioContext().resume();
    this.startSource(this.baseMs);
    this.emit(this.baseMs, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  restart(): void {
    this.status = 'paused';
    this.start();
  }

  setAutoplay(autoplay: boolean): void {
    if (this.autoplay === autoplay) return;
    this.autoplay = autoplay;
    if (autoplay) {
      const now = this.currentMs();
      for (let column = 0; column < this.cols; column += 1) {
        let index = 0;
        const notes = this.byColumn[column];
        while (index < notes.length && notes[index].time <= now) index += 1;
        this.autoCursor[column] = index;
      }
    }
  }

  setScrollSpeed(speed: number): void {
    this.scrollSpeed = clamp(speed, 3, 30);
    if (this.status !== 'playing') this.draw(this.baseMs);
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.gain.gain.value = this.volume * 0.9;
  }

  setHitsounds(enabled: boolean): void {
    this.hitsounds = enabled;
  }

  press(column: number): void {
    if (this.status !== 'playing') return;
    if (column < 0 || column >= this.cols) return;
    this.pressed[column] = true;
    if (this.autoplay) return;
    if (this.activeHolds[column]) return;

    const now = this.currentMs();
    for (const note of this.byColumn[column]) {
      if (note.judged) continue;
      const delta = note.time - now;
      if (delta > this.windows.w50) break;
      if (delta < -this.windows.w50) continue;

      const judgement = judgeWindow(Math.abs(delta), this.windows);
      this.hitNote(note, judgement, now);
      if (note.isHold && note.endTime !== null) this.activeHolds[column] = note;
      return;
    }
  }

  release(column: number): void {
    if (column < 0 || column >= this.cols) return;
    this.pressed[column] = false;

    const hold = this.activeHolds[column];
    if (!hold || hold.endTime === null) return;
    if (this.status !== 'playing') return;

    const now = this.currentMs();
    if (now >= hold.endTime - HOLD_RELEASE_GRACE) this.completeHold(column, hold);
    else this.breakHold(column, hold);
  }

  columnAt(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const layout = this.layout(rect.width, rect.height);
    const relative = clientX - rect.left - layout.fieldX;
    if (relative < 0 || relative > layout.fieldW) return -1;
    return clamp(Math.floor(relative / layout.colW), 0, this.cols - 1);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.stopSource();
    try {
      this.gain.disconnect();
    } catch {
      // Gain node may already be disconnected.
    }
  }

  private reset(): void {
    for (const column of this.byColumn) {
      for (const note of column) {
        note.judged = false;
        note.tailJudged = false;
        note.head = 0;
        note.tail = 0;
        note.hitAt = 0;
        note.broken = false;
      }
    }
    this.activeHolds.fill(null);
    this.pressed.fill(false);
    this.missCursor.fill(0);
    this.autoCursor.fill(0);
    this.flash.fill(-1000);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.earned = 0;
    this.accSum = 0;
    this.judgedUnits = 0;
    this.lastJudge = null;
    this.lastHitSoundAt = -1000;
    this.counts = { max: 0, great: 0, good: 0, ok: 0, meh: 0, miss: 0 };
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source.disconnect();
    this.source = null;
  }

  private startSource(fromMs: number): void {
    this.stopSource();
    if (!this.audio) return;
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = this.audio;
    source.connect(this.gain);
    // A negative position means we are still counting in, so the track is queued
    // to begin exactly when the clock reaches the first note.
    const delay = fromMs < 0 ? -fromMs / 1000 : 0;
    try {
      source.start(ctx.currentTime + delay, Math.max(0, fromMs / 1000));
    } catch {
      return;
    }
    this.source = source;
  }

  private currentMs(): number {
    if (this.status === 'playing') {
      if (this.audio) {
        return this.baseMs + (getAudioContext().currentTime - this.audioStartTime) * 1000;
      }
      return this.baseMs + (performance.now() - this.wallStart);
    }
    return this.baseMs;
  }

  private tick = (): void => {
    if (this.status !== 'playing') return;
    const now = this.currentMs();
    this.update(now);
    this.draw(now);
    this.emit(now);

    if (now >= this.duration && !this.finished) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.finished = true;
    this.baseMs = this.currentMs();
    this.status = 'finished';
    this.stopSource();
    this.draw(this.baseMs);
    this.emit(this.baseMs, true);
    this.opts.onFinish();
  }

  private update(now: number): void {
    for (let column = 0; column < this.cols; column += 1) {
      const hold = this.activeHolds[column];
      if (hold && hold.endTime !== null && now >= hold.endTime) {
        this.completeHold(column, hold);
      }
    }

    if (this.autoplay) this.runAutoplay(now);

    for (let column = 0; column < this.cols; column += 1) {
      const notes = this.byColumn[column];
      let index = this.missCursor[column];
      for (; index < notes.length; index += 1) {
        const note = notes[index];
        if (note.time + this.windows.wMiss >= now) break;
        if (!note.judged) this.missNote(note);
      }
      this.missCursor[column] = index;
    }
  }

  private runAutoplay(now: number): void {
    for (let column = 0; column < this.cols; column += 1) {
      const notes = this.byColumn[column];
      while (this.autoCursor[column] < notes.length) {
        const note = notes[this.autoCursor[column]];
        if (note.time > now) break;
        if (!note.judged) {
          this.hitNote(note, 320, now);
          if (note.isHold && note.endTime !== null) this.activeHolds[column] = note;
        }
        this.autoCursor[column] += 1;
      }
    }
  }

  private hitNote(note: NoteState, judgement: Judgement, now: number): void {
    note.judged = true;
    note.head = judgement;
    note.hitAt = now;
    this.flash[note.column] = now;
    this.registerJudgement(judgement);
  }

  private missNote(note: NoteState): void {
    if (note.judged) return;
    note.judged = true;
    note.head = 0;
    note.hitAt = this.currentMs();
    this.registerJudgement(0);
    if (note.isHold) {
      note.tailJudged = true;
      note.tail = 0;
      this.registerJudgement(0);
    }
  }

  private completeHold(column: number, note: NoteState): void {
    this.activeHolds[column] = null;
    if (note.tailJudged) return;
    note.tailJudged = true;
    note.tail = 320;
    this.registerJudgement(320);
  }

  private breakHold(column: number, note: NoteState): void {
    this.activeHolds[column] = null;
    if (note.tailJudged) return;
    note.tailJudged = true;
    note.tail = 0;
    note.broken = true;
    this.registerJudgement(0);
  }

  private registerJudgement(judgement: Judgement): void {
    if (judgement === 0) {
      this.combo = 0;
      this.counts.miss += 1;
    } else {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      if (judgement === 320) this.counts.max += 1;
      else if (judgement === 300) this.counts.great += 1;
      else if (judgement === 200) this.counts.good += 1;
      else if (judgement === 100) this.counts.ok += 1;
      else this.counts.meh += 1;
    }

    const multiplier = 1 + Math.min(this.combo, COMBO_CAP) / 25;
    this.earned += judgement * multiplier;
    this.accSum += accuracyWeight(judgement);
    this.judgedUnits += 1;
    this.score = Math.round((1_000_000 * this.earned) / this.maxScoreValue);

    const now = this.currentMs();
    this.lastJudge = {
      text: judgementLabel(judgement),
      color: judgementColor(judgement),
      at: now,
    };

    if (this.hitsounds && judgement > 0 && now - this.lastHitSoundAt > 22) {
      this.lastHitSoundAt = now;
      playHitSound(this.volume);
    }
  }

  private emit(now: number, force = false): void {
    if (!force && now - this.lastEmit < 50) return;
    this.lastEmit = now;
    this.opts.onHud({
      status: this.status,
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      accuracy: this.judgedUnits > 0 ? (this.accSum / this.judgedUnits) * 100 : 100,
      counts: { ...this.counts },
      progress: clamp(now / this.duration, 0, 1),
      time: clamp(now, 0, this.duration),
      duration: this.duration,
      hasAudio: this.audio !== null,
    });
  }

  private resize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  private layout(width: number, height: number) {
    // The playfield fills the viewport: lanes spread out on wide screens, and the
    // receptor line sits above the floating controls rather than under them.
    const maxColW = Math.max(120, Math.min(220, height * 0.26));
    const colW = Math.min(Math.max(44, (width * 0.96) / this.cols), maxColW);
    const fieldW = colW * this.cols;
    const fieldX = (width - fieldW) / 2;
    // Leaves room for the receptor rings, their key labels and the floating controls.
    const bottomReserve = Math.min(300, Math.max(190, height * 0.24));
    const receptorY = Math.round(height - bottomReserve);
    const pixelsPerMs = this.scrollSpeed * 0.05 * (height / 600);
    return { colW, fieldW, fieldX, receptorY, pixelsPerMs };
  }

  private noteRadius(colW: number, height: number): number {
    return clamp(Math.min(colW * 0.34, height * 0.062), 12, 48);
  }

  private columnColor(column: number): string {
    const hue = Math.round(200 + (column * 360) / Math.max(1, this.cols)) % 360;
    return `hsl(${hue} 85% 70%)`;
  }

  /** 3-2-1 pre-roll (and a brief GO) drawn over the lanes while the clock is negative. */
  private drawLeadIn(now: number, width: number, height: number): void {
    const ctx = this.ctx;
    const centerX = width / 2;
    const centerY = height * 0.42;

    if (now >= 0) {
      if (now > 520) return;
      const alpha = 1 - now / 520;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd66b';
      ctx.shadowColor = 'rgba(255, 214, 107, 0.55)';
      ctx.shadowBlur = 32;
      ctx.font = `800 ${Math.round(Math.min(width, height) * 0.1)}px Inter, system-ui, sans-serif`;
      ctx.fillText('GO', centerX, centerY);
      ctx.restore();
      return;
    }

    const remaining = -now;
    const step = Math.max(1, Math.ceil(remaining / 1000));
    const pop = Math.min(1, (1000 - (remaining % 1000)) / 220);
    const size = Math.round(Math.min(width, height) * 0.2 * (1.18 - 0.18 * pop));

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.min(width, height) * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 7, 15, 0.55)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + 0.14 * pop})`;
    ctx.stroke();

    ctx.globalAlpha = 0.4 + 0.6 * pop;
    ctx.fillStyle = '#f4f0ff';
    ctx.shadowColor = 'rgba(255, 102, 170, 0.5)';
    ctx.shadowBlur = 36;
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    ctx.fillText(String(step), centerX, centerY);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.45 + 0.4 * pop;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillText('GET READY', centerX, centerY + size * 0.62);
    ctx.restore();
  }

  private draw(now: number): void {
    const { width, height } = this.resize();
    const ctx = this.ctx;
    const { colW, fieldW, fieldX, receptorY, pixelsPerMs } = this.layout(width, height);
    const scrollNow = this.scrollPos(now);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08070f';
    ctx.fillRect(0, 0, width, height);

    if (this.cover) {
      const scale = Math.max(width / this.cover.width, height / this.cover.height);
      const drawWidth = this.cover.width * scale;
      const drawHeight = this.cover.height * scale;
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.drawImage(
        this.cover,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      ctx.restore();
    }

    const backdrop = ctx.createLinearGradient(0, 0, 0, height);
    backdrop.addColorStop(0, 'rgba(6, 5, 12, 0.82)');
    backdrop.addColorStop(0.55, 'rgba(6, 5, 12, 0.55)');
    backdrop.addColorStop(1, 'rgba(6, 5, 12, 0.94)');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);

    // Lanes
    for (let column = 0; column < this.cols; column += 1) {
      const x = fieldX + column * colW;
      ctx.fillStyle =
        column % 2 === 0 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(255, 255, 255, 0.012)';
      ctx.fillRect(x, 0, colW, height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(x, 0, 1, height);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(fieldX + fieldW, 0, 1, height);

    // Receptors — hollow rings that light up while their lane is held. Drawn first so
    // the notes always pass in front of them.
    for (let column = 0; column < this.cols; column += 1) {
      const centerX = fieldX + column * colW + colW / 2;
      const color = this.columnColor(column);
      const active = this.pressed[column] || this.activeHolds[column] !== null;
      const radius = this.noteRadius(colW, height) + 4;

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, receptorY, radius, 0, Math.PI * 2);
      ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.32)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = active ? color : 'rgba(255, 255, 255, 0.18)';
      if (active) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 22;
      }
      ctx.stroke();
      ctx.restore();

      const flashAge = now - this.flash[column];
      if (flashAge >= 0 && flashAge < 220) {
        const alpha = 1 - flashAge / 220;
        const glowRadius = radius * 2.2;
        const glow = ctx.createRadialGradient(
          centerX,
          receptorY,
          radius * 0.5,
          centerX,
          receptorY,
          glowRadius,
        );
        glow.addColorStop(0, color);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.save();
        ctx.globalAlpha = 0.32 * alpha;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, receptorY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
      ctx.fillText(displayKey(this.keyLabels[column] ?? '?'), centerX, receptorY + radius + 22);
    }

    // Notes — round heads so the lanes read as a rhythm game, not a piano roll.
    for (let column = 0; column < this.cols; column += 1) {
      const color = this.columnColor(column);
      const centerX = fieldX + column * colW + colW / 2;
      const radius = this.noteRadius(colW, height);

      for (const note of this.byColumn[column]) {
        const headY = receptorY - (this.scrollPos(note.time) - scrollNow) * pixelsPerMs;
        // Notes are time ordered, so once heads pass the top of the screen the rest are
        // too. Long notes still need their body drawn, so they never break the loop.
        if (headY < -radius * 2 - 140 && !note.isHold) break;
        if (headY > height + 200) continue;
        if (note.judged && note.tailJudged) continue;

        if (note.isHold && note.endTime !== null) {
          const tailY = receptorY - (this.scrollPos(note.endTime) - scrollNow) * pixelsPerMs;
          const bodyTop = Math.max(-140, tailY);
          const bodyBottom = Math.min(receptorY, headY);
          if (bodyBottom > bodyTop) {
            const bodyWidth = Math.max(6, radius * 0.8);
            ctx.save();
            ctx.globalAlpha = note.judged ? 0.8 : 0.4;
            roundRect(
              ctx,
              centerX - bodyWidth / 2,
              bodyTop,
              bodyWidth,
              bodyBottom - bodyTop,
              bodyWidth / 2,
            );
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
          }
          if (!note.judged) {
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.arc(centerX, Math.max(radius, tailY), radius * 0.55, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
          }
        }

        if (note.judged) continue;

        ctx.save();
        if (note.time - now < 0) {
          // Slightly fade notes that have already crossed the receptor line.
          ctx.globalAlpha = 0.7;
        }
        ctx.beginPath();
        ctx.arc(centerX, headY, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#f4f0ff';
        ctx.fill();
        ctx.lineWidth = Math.max(2, radius * 0.2);
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(centerX, headY, radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    }


    // Combo
    if (this.combo > 1) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.font = '800 64px Inter, system-ui, sans-serif';
      ctx.fillText(String(this.combo), fieldX + fieldW / 2, height * 0.3);
      ctx.font = '700 16px Inter, system-ui, sans-serif';
      ctx.fillText('COMBO', fieldX + fieldW / 2, height * 0.3 + 22);
      ctx.restore();
    }

    // Latest judgement
    if (this.lastJudge) {
      const age = now - this.lastJudge.at;
      if (age >= 0 && age < 420) {
        const alpha = 1 - age / 420;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.lastJudge.color;
        ctx.font = '800 24px Inter, system-ui, sans-serif';
        ctx.fillText(this.lastJudge.text, fieldX + fieldW / 2, receptorY - 96);
        ctx.restore();
      }
    }

    // Vignette so the playfield reads clearly against artwork.
    const vignette = ctx.createRadialGradient(
      width / 2,
      height * 0.5,
      Math.min(width, height) * 0.25,
      width / 2,
      height * 0.5,
      Math.max(width, height) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    this.drawLeadIn(now, width, height);
  }
}
