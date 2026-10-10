// Where the input level comes from while designing: a slider, the microphone, or a synthetic voice
// that rises and falls like speech, so the `react` dials can be tuned without talking to the screen.

export type LevelMode = "manual" | "mic" | "voice";

export interface LevelSource {
  readonly mode: LevelMode;
  setMode(mode: LevelMode): Promise<void>;
  setManual(value: number): void;
}

/** Syllables in words in phrases: three slow sines gating a fast one, never quite periodic. */
function voice(ms: number): number {
  const t = ms / 1000;
  const phrase = Math.sin(t * 0.9) + Math.sin(t * 0.37 + 1.3) > -0.4 ? 1 : 0.08;
  const syllable = Math.max(0, Math.sin(t * 11 + 2 * Math.sin(t * 1.7)));
  const word = 0.6 + 0.4 * Math.sin(t * 2.3 + 0.5);
  return Math.min(1, phrase * syllable * word * 1.1);
}

export function createLevelSource(onLevel: (value: number) => void): LevelSource {
  let mode: LevelMode = "manual";
  let manual = 0;
  let raf = 0;
  let request = 0;
  let mic: { stream: MediaStream; context: AudioContext; analyser: AnalyserNode } | null = null;
  const buffer = new Float32Array(1024);

  function frame(now: number): void {
    let value = manual;
    if (mode === "voice") value = voice(now);
    else if (mode === "mic" && mic) {
      mic.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      value = Math.min(1, Math.sqrt(sum / buffer.length) * 6);
    }
    onLevel(value);
    raf = mode === "manual" ? 0 : requestAnimationFrame(frame);
  }

  function stopMic(): void {
    if (!mic) return;
    for (const track of mic.stream.getTracks()) track.stop();
    void mic.context.close();
    mic = null;
  }

  return {
    get mode() {
      return mode;
    },
    async setMode(next) {
      const ticket = ++request;
      if (next === "mic" && !mic) {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
          if (ticket !== request) return;
          throw error;
        }
        if (ticket !== request) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        let context: AudioContext | undefined;
        try {
          context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = buffer.length;
          context.createMediaStreamSource(stream).connect(analyser);
          mic = { stream, context, analyser };
        } catch (error) {
          for (const track of stream.getTracks()) track.stop();
          if (context) void context.close();
          throw error;
        }
      }
      if (next !== "mic") stopMic();
      mode = next;
      cancelAnimationFrame(raf);
      raf = 0;
      frame(performance.now());
    },
    setManual(value) {
      manual = value;
      if (mode === "manual") onLevel(value);
    },
  };
}
