import { describe, expect, it } from 'vitest';
import { buildShakaConfig, deepMerge, FORBIDDEN_ADVANCED_KEYS, sanitizeAdvanced, toShakaRetry } from '../../src/engines/shaka-config.js';

const base = { streaming: {}, abr: {}, preferredAudioLanguage: null };

describe('toShakaRetry', () => {
  it('maps the public retry policy to Shaka retryParameters names', () => {
    expect(
      toShakaRetry({ maxAttempts: 3, baseDelayMs: 500, backoffFactor: 2, jitter: 0.5, timeoutMs: 10_000, connectionTimeoutMs: 5_000, stallTimeoutMs: 4_000 }),
    ).toEqual({ maxAttempts: 3, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 10_000, connectionTimeout: 5_000, stallTimeout: 4_000 });
  });

  it('returns undefined for an empty policy (Shaka defaults apply)', () => {
    expect(toShakaRetry(undefined)).toBeUndefined();
    expect(toShakaRetry({})).toBeUndefined();
  });
});

describe('buildShakaConfig', () => {
  it('places retry policies under manifest, streaming and drm', () => {
    const { config } = buildShakaConfig({
      ...base,
      retry: { manifest: { maxAttempts: 4 }, segment: { maxAttempts: 5 }, license: { maxAttempts: 2 } },
    });
    expect(config).toEqual({
      manifest: { retryParameters: { maxAttempts: 4 } },
      streaming: { retryParameters: { maxAttempts: 5 } },
      drm: { retryParameters: { maxAttempts: 2 } },
    });
  });

  it('maps streaming, liveSync and abr options by their Shaka names', () => {
    const { config } = buildShakaConfig({
      ...base,
      streaming: { bufferingGoal: 30, rebufferingGoal: 2, lowLatencyMode: true, liveSync: { enabled: true, targetLatency: 3 } },
      abr: { enabled: false, defaultBandwidthEstimate: 1e6, restrictions: { maxHeight: 720 } },
    });
    expect(config.streaming).toEqual({ bufferingGoal: 30, rebufferingGoal: 2, lowLatencyMode: true, liveSync: { enabled: true, targetLatency: 3 } });
    expect(config.abr).toEqual({ enabled: false, defaultBandwidthEstimate: 1e6, restrictions: { maxHeight: 720 } });
  });

  it('maps DRM key systems to servers and advanced settings', () => {
    const cert = new Uint8Array([1, 2, 3]);
    const { config } = buildShakaConfig({
      ...base,
      drm: {
        keySystems: {
          'com.widevine.alpha': { licenseUrl: 'https://license.example.com/wv', videoRobustness: ['SW_SECURE_DECODE'], headers: { 'X-Custom': '1' } },
          'com.apple.fps': { licenseUrl: 'https://license.example.com/fps', serverCertificate: cert },
          'com.microsoft.playready': {} as never,
        },
        preferredKeySystems: ['com.widevine.alpha'],
      },
    });
    const drm = config.drm as Record<string, unknown>;
    expect(drm.servers).toEqual({ 'com.widevine.alpha': 'https://license.example.com/wv', 'com.apple.fps': 'https://license.example.com/fps' });
    expect(drm.advanced).toEqual({
      'com.widevine.alpha': { videoRobustness: ['SW_SECURE_DECODE'], headers: { 'X-Custom': '1' } },
      'com.apple.fps': { serverCertificate: cert },
    });
    expect(drm.preferredKeySystems).toEqual(['com.widevine.alpha']);
  });

  it('wraps initDataTransform with the public signature', () => {
    const calls: unknown[] = [];
    const { config } = buildShakaConfig({
      ...base,
      drm: {
        keySystems: {},
        initDataTransform: (initData, type, info) => {
          calls.push([initData.length, type, info]);
          return initData;
        },
      },
    });
    const fn = (config.drm as { initDataTransform: (a: Uint8Array, b: string, c: unknown) => Uint8Array }).initDataTransform;
    fn(new Uint8Array(4), 'skd', { keySystem: 'com.apple.fps', serverCertificate: null });
    expect(calls).toEqual([[4, 'skd', { keySystem: 'com.apple.fps', serverCertificate: null }]]);
  });

  it('merge order: advanced first, then high-level options win', () => {
    const { config, removedAdvancedKeys } = buildShakaConfig({
      ...base,
      streaming: { bufferingGoal: 20 },
      advanced: { shaka: { streaming: { bufferingGoal: 99, bufferBehind: 15 }, manifest: { dash: { ignoreMinBufferTime: true } } } },
    });
    expect(config.streaming).toEqual({ bufferingGoal: 20, bufferBehind: 15 });
    expect(config.manifest).toEqual({ dash: { ignoreMinBufferTime: true } });
    expect(removedAdvancedKeys).toEqual([]);
  });

  it('sets the preferred audio language', () => {
    const { config } = buildShakaConfig({ ...base, preferredAudioLanguage: 'mn' });
    expect((config.preferredAudio as { language: string }[])[0]!.language).toBe('mn');
  });
});

describe('advanced escape hatch', () => {
  it('removes forbidden keys and reports them', () => {
    const { config, removed } = sanitizeAdvanced({
      shaka: {
        textDisplayFactory: () => null,
        abrFactory: () => null,
        streaming: { failureCallback: () => undefined, bufferBehind: 5 },
        drm: { servers: { x: 'y' }, clearKeys: {}, advanced: {}, initDataTransform: () => null, failureCallback: () => undefined, delayLicenseRequestUntilPlayed: true },
        queue: {},
        offline: {},
      },
    });
    expect(config).toEqual({ streaming: { bufferBehind: 5 }, drm: { delayLicenseRequestUntilPlayed: true } });
    expect(removed.sort()).toEqual([...FORBIDDEN_ADVANCED_KEYS].filter((k) => k !== 'adaptationSetCriteriaFactory').sort());
  });

  it('does not mutate the caller object', () => {
    const input = { shaka: { streaming: { failureCallback: () => undefined } } };
    sanitizeAdvanced(input);
    expect(typeof input.shaka.streaming.failureCallback).toBe('function');
  });

  it('ignores non-object input', () => {
    expect(sanitizeAdvanced(undefined)).toEqual({ config: {}, removed: [] });
    expect(sanitizeAdvanced({ shaka: [] as never })).toEqual({ config: {}, removed: [] });
  });
});

describe('deepMerge', () => {
  it('merges plain objects recursively and replaces arrays and typed arrays', () => {
    const bytes = new Uint8Array([1]);
    expect(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3], e: bytes }, d: undefined })).toEqual({ a: { b: 1, c: [3], e: bytes }, d: 1 });
  });
});
