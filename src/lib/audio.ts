let context: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!context) {
    const AudioContextCtor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    context = new AudioContextCtor({ latencyHint: 'interactive' });
  }
  return context;
}

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  return getAudioContext().decodeAudioData(data);
}

export function playHitSound(volume: number): void {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(1050, now);
  oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.055);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0004, volume * 0.12), now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.12);
}
