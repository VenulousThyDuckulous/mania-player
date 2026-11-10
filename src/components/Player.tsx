import { useEffect, useRef, useState } from 'react';
import { decodeAudio, getAudioContext } from '../lib/audio';
import { formatCount, formatTime, difficultyLabel } from '../lib/format';
import { readAudioBuffer } from '../lib/osz';
import { getSetFile } from '../lib/storage';
import type { Settings } from '../lib/settings';
import type { Beatmap, StoredSetMeta } from '../types';
import { ManiaEngine, type Hud } from '../game/engine';
import { displayKey, keyLabelsFor } from '../game/keys';

interface PlayerProps {
  meta: StoredSetMeta;
  map: Beatmap;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onExit: () => void;
}

const EMPTY_COUNTS: Hud['counts'] = {
  max: 0,
  great: 0,
  good: 0,
  ok: 0,
  meh: 0,
  miss: 0,
};

const EMPTY_HUD: Hud = {
  status: 'paused',
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 100,
  counts: EMPTY_COUNTS,
  progress: 0,
  time: 0,
  duration: 0,
  hasAudio: false,
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export default function Player({ meta, map, settings, onSettingsChange, onExit }: PlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ManiaEngine | null>(null);
  const pointerColumns = useRef(new Map<number, number>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const keys = map.keys;
  const labels = keyLabelsFor(keys);

  // Gameplay owns the whole viewport, so the library behind it must not scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFinished(false);
    setHud(EMPTY_HUD);

    const coverUrl = meta.cover ? URL.createObjectURL(meta.cover) : null;

    const boot = async () => {
      try {
        const data = await getSetFile(meta.id);
        if (!data) throw new Error('This beatmap is missing from browser storage. Import it again.');

        const audioBytes = readAudioBuffer(data, map);
        let audio: AudioBuffer | null = null;
        if (audioBytes) {
          try {
            audio = await decodeAudio(audioBytes);
          } catch {
            audio = null;
          }
        }
        if (cancelled) return;

        const cover = coverUrl ? await loadImage(coverUrl) : null;
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Player canvas failed to mount');

        const engine = new ManiaEngine(canvas, map, audio, cover, {
          scrollSpeed: settingsRef.current.scrollSpeed,
          volume: settingsRef.current.volume,
          autoplay: settingsRef.current.autoplay,
          hitsounds: settingsRef.current.hitsounds,
          onHud: setHud,
          onFinish: () => setFinished(true),
        });
        engineRef.current = engine;
        setLoading(false);
        engine.start();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not load this beatmap');
        setLoading(false);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
      pointerColumns.current.clear();
      if (coverUrl) URL.revokeObjectURL(coverUrl);
    };
  }, [meta.id, meta.cover, map]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setScrollSpeed(settings.scrollSpeed);
    engine.setVolume(settings.volume);
    engine.setHitsounds(settings.hitsounds);
    engine.setAutoplay(settings.autoplay);
  }, [settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (event.key === 'Escape') {
        const engine = engineRef.current;
        if (!engine) return;
        if (engine.currentStatus === 'finished') {
          onExit();
          return;
        }
        if (engine.currentStatus === 'playing') engine.pause();
        else engine.resume();
        return;
      }
      if (event.key.toLowerCase() === 'r' && event.shiftKey) {
        engineRef.current?.restart();
        setFinished(false);
        return;
      }
      if (event.repeat) return;
      const label = event.key.toLowerCase();
      const column = labels.findIndex((key) => key === label);
      if (column >= 0) {
        event.preventDefault();
        engineRef.current?.press(column);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const label = event.key.toLowerCase();
      const column = labels.findIndex((key) => key === label);
      if (column >= 0) engineRef.current?.release(column);
    };

    const onBlur = () => {
      const engine = engineRef.current;
      if (engine?.currentStatus === 'playing') engine.pause();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [labels, onExit]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        const engine = engineRef.current;
        if (engine?.currentStatus === 'playing') engine.pause();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const update = (patch: Partial<Settings>) => onSettingsChange({ ...settingsRef.current, ...patch });

  const togglePlay = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentStatus === 'playing') engine.pause();
    else if (engine.currentStatus === 'paused') {
      void getAudioContext().resume();
      engine.resume();
    }
  };

  const restart = () => {
    setFinished(false);
    engineRef.current?.restart();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const column = engine.columnAt(event.clientX);
    if (column < 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerColumns.current.set(event.pointerId, column);
    engine.press(column);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const column = pointerColumns.current.get(event.pointerId);
    if (column === undefined) return;
    pointerColumns.current.delete(event.pointerId);
    engineRef.current?.release(column);
  };

  const status = hud.status;
  const isPlaying = status === 'playing';

  return (
    <section className="player">
      <div className="player-head">
        <button type="button" className="ghost-button" onClick={onExit}>
          ← Library
        </button>
        <div className="player-title">
          <strong>{map.title}</strong>
          <span>
            {map.artist} · mapped by {map.creator}
          </span>
        </div>
        <div className="player-tags">
          <span className="tag">{keys}K</span>
          <span className="tag">{map.bpm > 0 ? `${map.bpm} BPM` : '— BPM'}</span>
          <span className="tag">OD {map.od.toFixed(1)}</span>
          <span className="tag">{difficultyLabel(map.od)}</span>
        </div>
      </div>

      <div className="player-stage">
        <canvas
          ref={canvasRef}
          className="player-canvas"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        <div className="hud">
          <div className="hud-block">
            <span className="hud-label">Score</span>
            <strong>{formatCount(hud.score)}</strong>
          </div>
          <div className="hud-block hud-block-center">
            <span className="hud-label">Accuracy</span>
            <strong>{hud.accuracy.toFixed(2)}%</strong>
          </div>
          <div className="hud-block hud-block-right">
            <span className="hud-label">Max combo</span>
            <strong>{formatCount(hud.maxCombo)}</strong>
          </div>
        </div>

        {loading && (
          <div className="overlay">
            <div className="overlay-card">
              <span className="spinner" />
              <h2>Loading beatmap…</h2>
              <p>Decoding audio from the .osz archive</p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>Could not start</h2>
              <p>{error}</p>
              <div className="overlay-actions">
                <button type="button" className="primary-button" onClick={restart}>
                  Try again
                </button>
                <button type="button" className="ghost-button" onClick={onExit}>
                  Back to library
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && !finished && !isPlaying && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>Paused</h2>
              <p>{hud.hasAudio ? 'Audio paused' : 'No audio track found — playing on a silent clock'}</p>
              <div className="overlay-actions">
                <button type="button" className="primary-button" onClick={togglePlay}>
                  Resume
                </button>
                <button type="button" className="ghost-button" onClick={restart}>
                  Restart
                </button>
                <button type="button" className="ghost-button" onClick={onExit}>
                  Quit
                </button>
              </div>
            </div>
          </div>
        )}

        {finished && (
          <div className="overlay">
            <div className="overlay-card results">
              <p className="results-eyebrow">{map.version}</p>
              <h2>{map.title}</h2>
              <div className="results-score">
                <strong>{formatCount(hud.score)}</strong>
                <span>{hud.accuracy.toFixed(2)}% · {formatCount(hud.maxCombo)}x max combo</span>
              </div>
              <div className="results-grid">
                <div>
                  <span>MAX</span>
                  <strong>{hud.counts.max}</strong>
                </div>
                <div>
                  <span>300</span>
                  <strong>{hud.counts.great}</strong>
                </div>
                <div>
                  <span>200</span>
                  <strong>{hud.counts.good}</strong>
                </div>
                <div>
                  <span>100</span>
                  <strong>{hud.counts.ok}</strong>
                </div>
                <div>
                  <span>50</span>
                  <strong>{hud.counts.meh}</strong>
                </div>
                <div>
                  <span>MISS</span>
                  <strong>{hud.counts.miss}</strong>
                </div>
              </div>
              <div className="overlay-actions">
                <button type="button" className="primary-button" onClick={restart}>
                  Play again
                </button>
                <button type="button" className="ghost-button" onClick={onExit}>
                  Back to library
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="player-controls">
        <div className="progress">
          <div className="progress-fill" style={{ width: `${(hud.progress * 100).toFixed(2)}%` }} />
        </div>
        <div className="controls-row">
          <div className="controls-group">
            <button type="button" className="icon-button" onClick={togglePlay} title="Play / pause">
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button type="button" className="icon-button" onClick={restart} title="Restart">
              ↺
            </button>
            <span className="time">
              {formatTime(hud.time)} / {formatTime(hud.duration)}
            </span>
          </div>

          <div className="controls-group controls-hints">
            {labels.map((label, index) => (
              <kbd key={`${label}-${index}`}>{displayKey(label)}</kbd>
            ))}
          </div>

          <div className="controls-group">
            <button
              type="button"
              className={`ghost-button ${settings.autoplay ? 'active' : ''}`}
              onClick={() => update({ autoplay: !settings.autoplay })}
            >
              Autoplay {settings.autoplay ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowSettings((value) => !value)}
            >
              Settings
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="settings-panel">
            <label>
              <span>Scroll speed · {settings.scrollSpeed.toFixed(0)}</span>
              <input
                type="range"
                min={4}
                max={30}
                step={1}
                value={settings.scrollSpeed}
                onChange={(event) => update({ scrollSpeed: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Volume · {Math.round(settings.volume * 100)}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings.volume * 100)}
                onChange={(event) => update({ volume: Number(event.target.value) / 100 })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.hitsounds}
                onChange={(event) => update({ hitsounds: event.target.checked })}
              />
              <span>Hit sounds</span>
            </label>
            <p className="settings-note">
              Escape pauses. Hold keys for long notes. Tap the lanes on touch screens.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
