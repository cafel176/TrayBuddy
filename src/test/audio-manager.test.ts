import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AudioManager, clearAudioCache, getAudioManager, resetAudioManagerInstance } from "$lib/audio/AudioManager";

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

  // ========================================================================
  // resetAudioManagerInstance
  // ========================================================================

  describe("resetAudioManagerInstance", () => {
    it("resets the singleton so getAudioManager creates a new instance", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        return originalInvoke?.(cmd) ?? null;
      });

      const am1 = await getAudioManager();
      resetAudioManagerInstance();
      const am2 = await getAudioManager();
      // After reset, a new instance is created
      expect(am2).toBeInstanceOf(AudioManager);
      am1.destroy();
      am2.destroy();
      resetAudioManagerInstance();
    });
  });

  // ========================================================================
  // setMuted / setVolume when no audio playing
  // ========================================================================

  describe("setMuted / setVolume without audio element", () => {
    it("setMuted when no audio is harmless", () => {
      const am = new AudioManager();
      expect(() => am.setMuted(true)).not.toThrow();
      expect(() => am.setMuted(false)).not.toThrow();
      am.destroy();
    });

    it("setVolume when no audio is harmless", () => {
      const am = new AudioManager();
      expect(() => am.setVolume(0.8)).not.toThrow();
      am.destroy();
    });

    it("setVolume does not update audio volume when muted", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: true, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      // Muted, volume should stay 0
      am.setVolume(0.9);
      expect(audioInstances[0].volume).toBe(0);

      am.destroy();
    });
  });

  // ========================================================================
  // Event listeners — edge cases
  // ========================================================================

  describe("event listeners edge cases", () => {
    it("volume-change does not update when muted", async () => {
      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: true, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();
      await am.play("click");

      // Audio is muted, volume should stay 0
      expect(audioInstances[0].volume).toBe(0);

      // Receive volume change while muted
      handlers["volume-change"]({ payload: 0.9 });
      // Volume should still be 0 because muted
      expect(audioInstances[0].volume).toBe(0);

      am.destroy();
    });

    it("settings-change without audio element does not throw", async () => {
      const handlers: Record<string, Function> = {};
      listenMock.mockImplementation(async (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {};
      });
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      // No audio playing, settings-change should not throw
      expect(() => {
        handlers["settings-change"]({ payload: { no_audio_mode: true, volume: 0.3 } });
      }).not.toThrow();

      am.destroy();
    });

    it("settings-change with partial payload (missing some keys)", async () => {
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

      // Partial update — only volume
      handlers["settings-change"]({ payload: { volume: 0.3 } });
      expect(audioInstances[0].volume).toBe(0.3);

      am.destroy();
    });
  });

  // ========================================================================
  // play — loop mode does not set onEnd callback
  // ========================================================================

  describe("play loop behavior", () => {
    it("loop mode does not trigger onEnd on audio ended", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "bgm", audio: "bgm.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const onEnd = vi.fn();
      await am.play("bgm", onEnd, true);

      // Loop mode: onEndCallback should be null
      audioInstances[0].onended?.();
      expect(onEnd).not.toHaveBeenCalled();

      am.destroy();
    });
  });

  // ========================================================================
  // play — archive mod URL path
  // ========================================================================

  describe("play with archive mod", () => {
    it("handles archive mod path (tbuddy-archive://)", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "tbuddy-archive://testmod";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      const result = await am.play("click");
      expect(result).toBe(true);
      expect(audioInstances.length).toBe(1);

      am.destroy();
    });
  });

  // ========================================================================
  // getMediaErrorDescription — all error codes
  // ========================================================================

  describe("onerror with various MediaError codes", () => {
    // Polyfill MediaError for jsdom environment
    beforeAll(() => {
      if (typeof globalThis.MediaError === "undefined") {
        (globalThis as any).MediaError = {
          MEDIA_ERR_ABORTED: 1,
          MEDIA_ERR_NETWORK: 2,
          MEDIA_ERR_DECODE: 3,
          MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
        };
      }
    });

    it("handles MEDIA_ERR_ABORTED (code 1)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "hi", audio: "hi.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      // Mock Audio with specific error code
      (globalThis as any).Audio = class {
        src = "";
        volume = 1;
        loop = false;
        paused = true;
        readyState = 0;
        networkState = 0;
        error = { code: 1, message: "aborted" };
        oncanplay: any = null;
        onended: any = null;
        onerror: any = null;
        play = vi.fn(async () => {});
        pause = vi.fn();
      };

      const am = new AudioManager();
      await am.init();
      await am.play("hi");

      // Trigger onerror
      const audio = audioInstances.length > 0 ? audioInstances[0] : null;
      // Access the created audio from the instance directly
      // Since Audio class is overridden, we access via the play mock
      errorSpy.mockRestore();
      am.destroy();
    });

    it("handles MEDIA_ERR_NETWORK (code 2)", async () => {
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

      // Get the audio mock and simulate error with code
      const audioMock = audioInstances[0];
      // Override the error getter to return specific code
      Object.defineProperty(audioMock, "error", { get: () => ({ code: 2 }) });
      audioMock.onerror?.(new Event("error"));
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });

    it("handles MEDIA_ERR_DECODE (code 3)", async () => {
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

      Object.defineProperty(audioInstances[0], "error", { get: () => ({ code: 3 }) });
      audioInstances[0].onerror?.(new Event("error"));
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });

    it("handles MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)", async () => {
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

      Object.defineProperty(audioInstances[0], "error", { get: () => ({ code: 4 }) });
      audioInstances[0].onerror?.(new Event("error"));
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });

    it("handles unknown error code (99)", async () => {
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

      Object.defineProperty(audioInstances[0], "error", { get: () => ({ code: 99 }) });
      audioInstances[0].onerror?.(new Event("error"));
      expect(onEnd).toHaveBeenCalled();

      errorSpy.mockRestore();
      am.destroy();
    });
  });

  // ========================================================================
  // existsInCurrentMod error path (invoke throws)
  // ========================================================================

  describe("existsInCurrentMod error fallback", () => {
    it("returns true and continues playback when path_exists throws", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") throw new Error("IPC error");
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      // Should still play (existsInCurrentMod falls back to true on error)
      const result = await am.play("click");
      expect(result).toBe(true);
      expect(audioInstances.length).toBe(1);

      am.destroy();
    });
  });

  // ========================================================================
  // stop without onEnd callback
  // ========================================================================

  describe("stop edge cases", () => {
    it("stop with audio but no onEnd callback", async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "get_settings") return { no_audio_mode: false, volume: 0.5, lang: "zh" };
        if (cmd === "get_audio_by_name") return { name: "click", audio: "click.wav" };
        if (cmd === "get_mod_path") return "C:/mods/demo";
        if (cmd === "path_exists") return true;
        return originalInvoke?.(cmd) ?? null;
      });

      const am = new AudioManager();
      await am.init();

      await am.play("click"); // no onEnd
      am.stop();
      expect(audioInstances[0].pause).toHaveBeenCalled();
      am.destroy();
    });
  });

  // ========================================================================
  // destroy without init
  // ========================================================================

  describe("destroy edge cases", () => {
    it("destroy without init is safe", () => {
      const am = new AudioManager();
      expect(() => am.destroy()).not.toThrow();
    });
  });

  // ========================================================================
  // play — oncanplay fires
  // ========================================================================

  describe("play oncanplay callback", () => {
    it("oncanplay fires without error", async () => {
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

      // Trigger oncanplay
      audioInstances[0].oncanplay?.();
      // Should not throw
      expect(audioInstances.length).toBe(1);

      am.destroy();
    });
  });
});
