import { useMemo, useState } from 'react';
import type { Beatmap, StoredSetMeta } from '../types';
import { formatTime } from '../lib/format';

interface PsychCardProps {
  set: StoredSetMeta;
  onPlay: (meta: StoredSetMeta, map: Beatmap) => void;
}

interface PsychChart {
  difficulty: string;
  player?: Beatmap;
  opponent?: Beatmap;
}

interface PsychSong {
  key: string;
  title: string;
  artist: string;
  charts: PsychChart[];
}

function groupSongs(set: StoredSetMeta): PsychSong[] {
  const songs = new Map<string, PsychSong>();

  for (const map of set.maps) {
    const key = map.songKey ?? map.title;
    let song = songs.get(key);
    if (!song) {
      song = { key, title: map.title, artist: map.artist, charts: [] };
      songs.set(key, song);
    }

    const difficulty = map.difficulty ?? map.version;
    let chart = song.charts.find((entry) => entry.difficulty === difficulty);
    if (!chart) {
      chart = { difficulty };
      song.charts.push(chart);
    }
    if (map.side === 'opponent') chart.opponent = map;
    else chart.player = map;
  }

  return [...songs.values()];
}

export default function PsychCard({ set, onPlay }: PsychCardProps) {
  const songs = useMemo(() => groupSongs(set), [set]);
  const [songKey, setSongKey] = useState(songs[0]?.key ?? '');
  const [difficulty, setDifficulty] = useState(songs[0]?.charts[0]?.difficulty ?? '');
  const [wantsOpponent, setWantsOpponent] = useState(false);

  const song = songs.find((entry) => entry.key === songKey) ?? songs[0];
  const chart =
    song?.charts.find((entry) => entry.difficulty === difficulty) ?? song?.charts[0] ?? null;
  const playerMap = chart?.player ?? null;
  const opponentMap = chart?.opponent ?? null;
  // Charts that only hold opponent notes still start on that side instead of blocking play.
  const side =
    (wantsOpponent && opponentMap) || (!playerMap && opponentMap) ? 'opponent' : 'player';
  const chosen = (side === 'opponent' ? opponentMap : playerMap) ?? opponentMap ?? null;

  const selectSong = (key: string) => {
    setSongKey(key);
    const next = songs.find((entry) => entry.key === key);
    if (next && !next.charts.some((entry) => entry.difficulty === difficulty)) {
      setDifficulty(next.charts[0]?.difficulty ?? '');
    }
  };

  return (
    <div className="set-body">
      <h3 title={set.name}>{set.name}</h3>
      <p className="set-artist">
        Psych Engine mod · {songs.length} {songs.length === 1 ? 'song' : 'songs'}
      </p>

      <label className="psych-field">
        <span>Song</span>
        <select
          className="psych-select"
          value={song?.key ?? ''}
          onChange={(event) => selectSong(event.target.value)}
        >
          {songs.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.title} — {entry.artist}
            </option>
          ))}
        </select>
      </label>

      <div className="psych-difficulties" role="group" aria-label="Difficulty">
        {song?.charts.map((entry) => (
          <button
            key={entry.difficulty}
            type="button"
            className={`psych-chip ${entry.difficulty === chart?.difficulty ? 'active' : ''}`}
            onClick={() => setDifficulty(entry.difficulty)}
          >
            {entry.difficulty}
          </button>
        ))}
      </div>

      <div className="psych-sides">
        <button
          type="button"
          className={`psych-side ${side === 'player' ? 'active' : ''}`}
          disabled={!chart?.player}
          onClick={() => setWantsOpponent(false)}
        >
          <small>Play</small>
          {chart?.player?.sideLabel ?? 'Player'}
        </button>
        <button
          type="button"
          className={`psych-side ${side === 'opponent' ? 'active' : ''}`}
          disabled={!chart?.opponent}
          onClick={() => setWantsOpponent(true)}
        >
          <small>Play</small>
          {chart?.opponent?.sideLabel ?? 'Opponent'}
        </button>
      </div>

      <p className="psych-note">
        {chosen
          ? `${chosen.difficulty} · ${chosen.totalNotes} notes${chosen.totalHolds > 0 ? ` · ${chosen.totalHolds} hold` : ''} · ${formatTime(chosen.length)}`
          : 'This chart has no notes'}
      </p>

      <button
        type="button"
        className="primary-button psych-play"
        disabled={!chosen}
        onClick={() => {
          if (chosen) onPlay(set, chosen);
        }}
      >
        ▶ Play {chart?.difficulty ?? ''} {chosen ? `· ${chosen.sideLabel}` : ''}
      </button>
    </div>
  );
}
