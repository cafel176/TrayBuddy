import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AudioManager, clearAudioCache, getAudioManager } from "$lib/audio/AudioManager";

// ============================================================================
// Helper: mock Audio element
// ============================================================================

function createMockAudio() {
  let _src = "";
  let _volume = 1;
  let _loop = false;
  let _paused = true;
  const mock = {
    get src() { return _src; },
    set src(v: string) { _src = v; },
    get volume() { return _volume; },
    set volume(v: number) { _volume = v; },
    get loop() { return _loop; },
    set loop(v: boolean) { _loop = v; },
    get paused() { return _paused; },
    get readyState() { return 4; },
    get networkState() { return 1; },
    get error() { return null; },
    oncanplay: null as ((e?: any) => void) | null,
    onended: null as ((e?: any) => void) | null,
    onerror: null as ((e?: any) => void) | null,
    play: vi.fn(async () => { _paused = false; }),
    pause: vi.fn(() => { _paused = true; }),
  };
  return mock;
}

let audioInstances: ReturnType<typeof createMockAudio>[] = [];

describe("AudioManager", () => {
  const invokeMock = vi.mocked(invoke);
  const listenMock = vi.mocked(listen);
  let originalInvoke: ((...args: any[]) => any) | undefined;
  let originalListen: ((...args: any[]) => any) | undefined;

  beforeEach(() => {
    originalInvoke = invokeMock.getMockImplementation();
    originalListen = listenMock.getMockImplementation();
    audioInstances = [];

    // Mock Audio constructor
    (globalThis as any).Audio = class MockAudioElement {
      constructor() {
        const mock = createMockAudio();
        audioInstances.push(mock);
        return mock as any;
      }
    };

    clearAudioCache();
  });

  afterEach(() => {
    invokeMock.mockImplementation(originalInvoke ?? (async () => null));
    listenMock.mockImplementation(originalListen ?? (async () => () => {}));
  });

  // ========================================================================
  // init
  // ========================================================================

  describe("init", () => {
    it("loads settings and registers event listeners", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.8, lang: "en" };
        return originalInvoke?.(cmd) ?? null;
      });

      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });

      const am = new AudioManager();
      await am.init();

      expect(invokeMock).toHaveBeenCalledWith("get_settings");
      expect(handlers["settings-change"]).toBeTruthy();
      expect(handlers["volume-change"]).toBeTruthy();
      expect(handlers["mute-change"]).toBeTruthy();

      am.destroy();
    });
  });

  // ========================================================================
  // play
  // ========================================================================

  describe("play", () => {
    it("calls onEnd immediately for empty audioName", async () => {
      const am = new AudioManager();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        return originalInvoke?.(cmd) ?? null;
      });
      await am.init();

      const onEnd = vi.fn();
      const result = await am.play("", onEnd);
      expect(result).toBe(true);
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("skips playback when audio not found", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return null;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      const result = await am.play("nonexistent", onEnd);
      expect(result).toBe(true);
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("skips playback when mod path is empty", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "";
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      const result = await am.play("click", onEnd);
      expect(result).toBe(true);
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("skips playback when file does not exist", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return false;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      const result = await am.play("click", onEnd);
      expect(result).toBe(true);
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("plays audio successfully when file exists", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.7, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const result = await am.play("click");
      expect(result).toBe(true);
      expect(audioInstances.length).toBe(1);
      expect(audioInstances[0].play).toHaveBeenCalled();
      expect(audioInstances[0].volume).toBe(0.7);

      am.destroy();
    });

    it("sets volume to 0 when muted", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: true, volume: 0.7, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("click");
      expect(audioInstances[0].volume).toBe(0);

      am.destroy();
    });

    it("uses cache on second play of same audio", async () => {
      let audioQueryCount = 0;
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") { audioQueryCount++; return { name: "click", audio: "click.wav" }; }
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("click");
      expect(audioQueryCount).toBe(1);

      await am.play("click");
      // Second play should use cache, not query get_audio_by_name again
      expect(audioQueryCount).toBe(1);

      am.destroy();
    });

    it("evicts cache when cached file no longer exists", async () => {
      let pathExistsCallCount = 0;
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") {
          pathExistsCallCount++;
          // First call: exists. Second call (cache validation): doesn't exist.
          return pathExistsCallCount <= 1;
        }
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("click");
      expect(audioInstances.length).toBe(1);

      const onEnd = vi.fn();
      await am.play("click", onEnd);
      // File gone, onEnd should be called, no new audio created
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("triggers onended callback when audio finishes", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "hi", audio: "hi.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      await am.play("hi", onEnd);

      // Simulate audio ended
      audioInstances[0].onended?.();
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("handles onerror gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "hi", audio: "hi.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      await am.play("hi", onEnd);

      audioInstances[0].onerror?.(new Event("error"));
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });

    it("handles play() exception gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "hi", audio: "hi.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      // Make Audio.play() throw
      (globalThis as any).Audio = class {
        src = "";
        volume = 1;
        loop = false;
        paused = true;
        readyState = 0;
        networkState = 0;
        error = null;
        oncanplay = null;
        onended = null;
        onerror = null;
        play = vi.fn(async () => { throw new Error("Playback failed"); });
        pause = vi.fn();
      };

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      const result = await am.play("hi", onEnd);
      expect(result).toBe(true);
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });

    it("stops previous audio before playing new one", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("click");
      const firstAudio = audioInstances[0];

      await am.play("click");
      expect(firstAudio.pause).toHaveBeenCalled();

      am.destroy();
    });

    it("sets loop when requested", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "bgm", audio: "bgm.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("bgm", undefined, true);
      expect(audioInstances[0].loop).toBe(true);

      am.destroy();
    });
  });

  // ========================================================================
  // Event listeners
  // ========================================================================

  describe("event listeners", () => {
    it("settings-change updates volume, mute, and lang", async () => {
      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      // Play to create an audio element
      await am.play("click");

      // Change settings
      handlers["settings-change"]({ payload: { no_audio_mode: true, volume: 0.3, lang: "en" } });
      expect(audioInstances[0].volume).toBe(0); // muted

      am.destroy();
    });

    it("volume-change updates volume on current audio", async () => {
      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      handlers["volume-change"]({ payload: 0.9 });
      expect(audioInstances[0].volume).toBe(0.9);

      am.destroy();
    });

    it("mute-change toggles mute on current audio", async () => {
      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      handlers["mute-change"]({ payload: true });
      expect(audioInstances[0].volume).toBe(0);

      handlers["mute-change"]({ payload: false });
      expect(audioInstances[0].volume).toBe(0.5);

      am.destroy();
    });
  });

  // ========================================================================
  // stop
  // ========================================================================

  describe("stop", () => {
    it("stops playback and triggers onEnd callback", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      await am.play("click", onEnd);
      am.stop();

      expect(audioInstances[0].pause).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();

      am.destroy();
    });

    it("does nothing when no audio is playing", () => {
      const am = new AudioManager();
      expect(() => am.stop()).not.toThrow();
      am.destroy();
    });
  });

  // ========================================================================
  // setMuted / setVolume / isPlaying
  // ========================================================================

  describe("setMuted / setVolume / isPlaying", () => {
    it("setMuted toggles mute on current audio", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      am.setMuted(true);
      expect(audioInstances[0].volume).toBe(0);

      am.setMuted(false);
      expect(audioInstances[0].volume).toBe(0.5);

      am.destroy();
    });

    it("setVolume clamps and updates audio", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      am.setVolume(1.5);
      expect(audioInstances[0].volume).toBe(1);

      am.setVolume(-0.5);
      expect(audioInstances[0].volume).toBe(0);

      am.setVolume(0.7);
      expect(audioInstances[0].volume).toBe(0.7);

      am.destroy();
    });

    it("isPlaying returns correct state", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      expect(am.isPlaying()).toBe(false);

      await am.play("click");
      expect(am.isPlaying()).toBe(true);

      am.stop();
      expect(am.isPlaying()).toBe(false);

      am.destroy();
    });
  });

  // ========================================================================
  // destroy
  // ========================================================================

  describe("destroy", () => {
    it("stops audio and cleans up listeners", async () => {
      const unlistens = { settings: vi.fn(), volume: vi.fn(), mute: vi.fn() };
      const eventNames: string[] = [];
      listenMock.mockImplementation(async (event: string) => {
        eventNames.push(event);
        if (event === "settings-change") return unlistens.settings;
        if (event === "volume-change") return unlistens.volume;
        if (event === "mute-change") return unlistens.mute;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      am.destroy();

      expect(unlistens.settings).toHaveBeenCalled();
      expect(unlistens.volume).toHaveBeenCalled();
      expect(unlistens.mute).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // clearAudioCache
  // ========================================================================

  describe("clearAudioCache", () => {
    it("clears cache without errors", () => {
      expect(() => clearAudioCache()).not.toThrow();
    });
  });

  // ========================================================================
  // getAudioManager (singleton)
  // ========================================================================

  describe("getAudioManager", () => {
    it("returns an AudioManager instance", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        return originalInvoke?.(cmd) ?? null;
      });

      const am = await getAudioManager();
      expect(am).toBeInstanceOf(AudioManager);
      am.destroy();
    });
  });
});
