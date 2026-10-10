import { afterEach, describe, expect, it, vi } from "vitest";
import { createLevelSource } from "./level";

afterEach(() => vi.unstubAllGlobals());

function microphone() {
  let grant!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>((resolve) => (grant = resolve));
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => permission } });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      close = close;
      createAnalyser() {
        return { fftSize: 0, getFloatTimeDomainData: vi.fn() };
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
    },
  );
  return { grant: () => grant(stream), stop, close };
}

describe("microphone switching", () => {
  it("releases a late permission grant after switching back to the slider", async () => {
    const mic = microphone();
    const onLevel = vi.fn();
    const source = createLevelSource(onLevel);
    const pending = source.setMode("mic");
    await source.setMode("manual");
    source.setManual(0.6);
    mic.grant();
    await pending;
    expect(source.mode).toBe("manual");
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(onLevel).toHaveBeenLastCalledWith(0.6);
  });

  it("releases the stream when the audio context fails to initialize", async () => {
    const mic = microphone();
    vi.stubGlobal("AudioContext", function AudioContext() {
      throw new Error("audio unavailable");
    });
    const source = createLevelSource(vi.fn());
    const pending = source.setMode("mic");
    mic.grant();
    await expect(pending).rejects.toThrow("audio unavailable");
    expect(source.mode).toBe("manual");
    expect(mic.stop).toHaveBeenCalledOnce();
  });

  it("stops an active microphone when selecting another source", async () => {
    const mic = microphone();
    const source = createLevelSource(vi.fn());
    const pending = source.setMode("mic");
    mic.grant();
    await pending;
    expect(source.mode).toBe("mic");
    await source.setMode("voice");
    expect(source.mode).toBe("voice");
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(mic.close).toHaveBeenCalledOnce();
    await source.setMode("manual");
  });
});
