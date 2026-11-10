import { useEffect, useRef, useState } from 'react';
import type { Beatmap, StoredSetMeta } from '../types';
import { difficultyLabel, formatBytes, formatTime } from '../lib/format';
import PsychCard from './PsychCard';

interface LibraryProps {
  sets: StoredSetMeta[];
  busy: string | null;
  storageLabel: string | null;
  onPlay: (meta: StoredSetMeta, map: Beatmap) => void;
  onDelete: (meta: StoredSetMeta) => void;
  onImport: (files: File[]) => void;
}

function Cover({ blob, title }: { blob: Blob | null; title: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    return (
      <div className="cover cover-fallback">
        <span>{title.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className="cover">
      <img src={url} alt="" loading="lazy" />
    </div>
  );
}

export default function Library({
  sets,
  busy,
  storageLabel,
  onPlay,
  onDelete,
  onImport,
}: LibraryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pickFiles = () => inputRef.current?.click();

  return (
    <section className="library">
      <div className="hero">
        <div>
          <p className="eyebrow">osu!mania in your browser</p>
          <h1>
            Drop a beatmap in.
            <br />
            Play it right away.
          </h1>
          <p className="lede">
            Import <code>.osz</code> archives or Friday Night Funkin' Psych Engine mods, then pick a
            song, a difficulty and the side you want to play. Every chart is stored in this browser
            only — nothing is uploaded.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={pickFiles}>
              Add beatmaps or mods
            </button>
            <span className="hero-meta">
              {sets.length} {sets.length === 1 ? 'beatmap set' : 'beatmap sets'} saved
              {storageLabel ? ` · ${storageLabel}` : ''}
            </span>
          </div>
        </div>
        <div className="hero-drop" onClick={pickFiles} role="presentation">
          <span className="hero-drop-icon">⤓</span>
          <strong>Drag &amp; drop .osz or Psych mods</strong>
          <span>or click to browse</span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".osz,.zip,application/zip"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onImport(files);
          event.target.value = '';
        }}
      />

      {busy && (
        <div className="import-banner">
          <span className="spinner" />
          Importing {busy}…
        </div>
      )}

      {sets.length === 0 ? (
        <div className="empty">
          <h2>No beatmaps yet</h2>
          <p>
            Find a mania beatmap on osu! and download the <code>.osz</code> file, or drop a Psych
            Engine mod <code>.zip</code>. It stays in this browser for next time.
          </p>
          <button type="button" className="primary-button" onClick={pickFiles}>
            Choose files
          </button>
        </div>
      ) : (
        <div className="set-grid">
          {sets.map((set) => (
            <article className="set-card" key={set.id}>
              <div className="set-cover-wrap">
                <Cover blob={set.cover} title={set.name} />
                <button
                  type="button"
                  className="delete-button"
                  title="Remove from this browser"
                  onClick={() => onDelete(set)}
                >
                  ✕
                </button>
                <span className="set-size">{formatBytes(set.size)}</span>
              </div>
              {set.maps[0]?.source === 'psych' ? (
                <PsychCard set={set} onPlay={onPlay} />
              ) : (
              <div className="set-body">
                <h3 title={set.maps[0]?.title ?? set.name}>{set.maps[0]?.title ?? set.name}</h3>
                <p className="set-artist">
                  {set.maps[0]?.artist ?? 'Unknown artist'} · {set.maps[0]?.creator ?? 'Unknown'}
                </p>
                <div className="difficulty-list">
                  {set.maps.map((map, index) => (
                    <button
                      type="button"
                      className="difficulty"
                      key={`${map.fileName}-${index}`}
                      onClick={() => onPlay(set, map)}
                      title={`${map.version} · ${map.keys}K · ${formatTime(map.length)}`}
                    >
                      <span className="difficulty-name">{map.version}</span>
                      <span className="difficulty-meta">
                        {map.keys}K · {map.bpm > 0 ? `${map.bpm} BPM` : '—'} ·{' '}
                        {difficultyLabel(map.od)}
                      </span>
                      <span className="difficulty-play">▶</span>
                    </button>
                  ))}
                </div>
              </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
