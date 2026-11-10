import { useCallback, useEffect, useState } from 'react';
import Library from './components/Library';
import Player from './components/Player';
import { formatBytes } from './lib/format';
import { readOsz } from './lib/osz';
import {
  getStorageInfo,
  listSets,
  removeSet,
  requestPersistence,
  saveSet,
} from './lib/storage';
import { loadSettings, persistSettings, type Settings } from './lib/settings';
import type { Beatmap, StoredSetMeta } from './types';

interface NowPlaying {
  meta: StoredSetMeta;
  map: Beatmap;
}

function stripExtension(name: string): string {
  return name.replace(/\.(osz|zip)$/i, '');
}

export default function App() {
  const [sets, setSets] = useState<StoredSetMeta[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const refresh = useCallback(async () => {
    try {
      setSets(await listSets());
    } catch {
      setToast('Could not read beatmaps from browser storage');
    }
    setStorage(await getStorageInfo());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  const importFiles = useCallback(
    async (files: File[]) => {
      const accepted = files.filter((file) => /\.(osz|zip)$/i.test(file.name));
      const rejected = files.length - accepted.length;
      if (accepted.length === 0) {
        setToast('Only .osz (or .zip) beatmap archives can be imported');
        return;
      }

      let imported = 0;
      const failures: string[] = [];

      for (const file of accepted) {
        setBusy(file.name);
        try {
          const buffer = await file.arrayBuffer();
          const parsed = readOsz(buffer);
          if (parsed.maps.length === 0) {
            throw new Error('No osu!mania difficulties inside');
          }

          const name = stripExtension(file.name);
          const existing = await listSets();
          const duplicate = existing.find((set) => set.name === name);
          if (duplicate) await removeSet(duplicate.id);

          const meta: StoredSetMeta = {
            id: crypto.randomUUID(),
            name,
            fileName: file.name,
            addedAt: Date.now(),
            maps: parsed.maps,
            cover: parsed.cover,
            size: buffer.byteLength,
          };
          await saveSet(meta, buffer);
          imported += 1;
        } catch (caught) {
          failures.push(`${file.name}: ${caught instanceof Error ? caught.message : 'invalid archive'}`);
        }
      }

      await requestPersistence();
      await refresh();
      setBusy(null);

      if (imported > 0) {
        setToast(`Imported ${imported} beatmap ${imported === 1 ? 'set' : 'sets'}`);
      }
      if (failures.length > 0) {
        setToast(failures[0]);
      } else if (imported === 0 && rejected > 0) {
        setToast('Only .osz (or .zip) beatmap archives can be imported');
      }
    },
    [refresh],
  );

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      const hasFiles = Array.from(event.dataTransfer.types).includes('Files');
      if (!hasFiles) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) void importFiles(files);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  const deleteSet = async (meta: StoredSetMeta) => {
    const confirmed = window.confirm(`Remove “${meta.name}” from this browser?`);
    if (!confirmed) return;
    try {
      await removeSet(meta.id);
      await refresh();
      setToast('Beatmap removed');
    } catch {
      setToast('Could not remove that beatmap');
    }
  };

  const play = (meta: StoredSetMeta, map: Beatmap) => {
    setNowPlaying({ meta, map });
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const storageLabel = storage ? `${formatBytes(storage.usage)} stored` : null;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark">♪</span>
          <span>
            mania<span className="brand-accent">.player</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="topbar-note">Beatmaps stay in this browser</span>
          {nowPlaying && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setNowPlaying(null);
                void refresh();
              }}
            >
              Library
            </button>
          )}
        </div>
      </header>

      <main>
        {nowPlaying ? (
          <Player
            meta={nowPlaying.meta}
            map={nowPlaying.map}
            settings={settings}
            onSettingsChange={setSettings}
            onExit={() => {
              setNowPlaying(null);
              void refresh();
            }}
          />
        ) : (
          <Library
            sets={sets}
            busy={busy}
            storageLabel={storageLabel}
            onPlay={play}
            onDelete={(meta) => void deleteSet(meta)}
            onImport={(files) => void importFiles(files)}
          />
        )}
      </main>

      <footer className="footer">
        <span>Local-first mania player · .osz parsing happens entirely in your browser</span>
        <span>{storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} used` : ''}</span>
      </footer>

      {dragging && (
        <div className="drop-overlay">
          <div>
            <span className="hero-drop-icon">⤓</span>
            <strong>Drop .osz files to import</strong>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
