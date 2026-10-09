import type { AbrConfig, AdvancedConfig, DrmConfig, KeySystem, RetryPolicy, StreamingConfig } from '../types/config.js';

/**
 * Builds the Shaka configuration object from public options.
 *
 * Merge order (later wins):
 *   1. Shaka defaults (pinned version)
 *   2. `advanced.shaka` escape hatch (minus forbidden keys)
 *   3. high-level `streaming`, `abr`, `network.retry`, `drm`, quality preferences
 *
 * Forbidden escape-hatch keys are those that would bypass the package's
 * ownership of text rendering, ABR, failure handling or DRM servers.
 */
export const FORBIDDEN_ADVANCED_KEYS = [
  'textDisplayFactory',
  'abrFactory',
  'adaptationSetCriteriaFactory',
  'streaming.failureCallback',
  'drm.servers',
  'drm.advanced',
  'drm.clearKeys',
  'drm.initDataTransform',
  'drm.failureCallback',
  'queue',
  'offline',
] as const;

export type ShakaConfig = Record<string, unknown>;

/** Maps the standardised retry policy to Shaka `retryParameters` (see RetryPolicy docs). */
export function toShakaRetry(policy: RetryPolicy | undefined): ShakaConfig | undefined {
  if (!policy) return undefined;
  const out: ShakaConfig = {};
  if (policy.maxAttempts !== undefined) out.maxAttempts = policy.maxAttempts;
  if (policy.baseDelayMs !== undefined) out.baseDelay = policy.baseDelayMs;
  if (policy.backoffFactor !== undefined) out.backoffFactor = policy.backoffFactor;
  if (policy.jitter !== undefined) out.fuzzFactor = policy.jitter;
  if (policy.timeoutMs !== undefined) out.timeout = policy.timeoutMs;
  if (policy.connectionTimeoutMs !== undefined) out.connectionTimeout = policy.connectionTimeoutMs;
  if (policy.stallTimeoutMs !== undefined) out.stallTimeout = policy.stallTimeoutMs;
  return Object.keys(out).length ? out : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function deepMerge(target: ShakaConfig, source: ShakaConfig): ShakaConfig {
  const out: ShakaConfig = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

/** Removes forbidden keys from the escape hatch; returns the removed key paths. */
export function sanitizeAdvanced(advanced: AdvancedConfig | undefined): { config: ShakaConfig; removed: string[] } {
  const removed: string[] = [];
  const input = advanced?.shaka;
  if (!isPlainObject(input)) return { config: {}, removed };
  const clone = structuredCloneSafe(input);
  for (const path of FORBIDDEN_ADVANCED_KEYS) {
    const parts = path.split('.');
    let node: Record<string, unknown> | undefined = clone;
    for (let i = 0; i < parts.length - 1 && node; i++) {
      const next: unknown = node[parts[i]!];
      node = isPlainObject(next) ? next : undefined;
    }
    const last = parts[parts.length - 1]!;
    if (node && last in node) {
      delete node[last];
      removed.push(path);
    }
  }
  return { config: clone, removed };
}

function structuredCloneSafe(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = isPlainObject(v) ? structuredCloneSafe(v) : v;
  return out;
}

function toUint8(data: Uint8Array | ArrayBuffer | undefined): Uint8Array | undefined {
  if (!data) return undefined;
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export interface BuildShakaConfigInput {
  streaming: StreamingConfig;
  abr: AbrConfig;
  retry?: { manifest?: RetryPolicy; segment?: RetryPolicy; license?: RetryPolicy };
  drm?: DrmConfig;
  advanced?: AdvancedConfig;
  preferredAudioLanguage: string | null;
}

export function buildShakaConfig(input: BuildShakaConfigInput): { config: ShakaConfig; removedAdvancedKeys: string[] } {
  const { config: advanced, removed } = sanitizeAdvanced(input.advanced);
  const high: ShakaConfig = {};
  const s = input.streaming;
  const streaming: ShakaConfig = {};
  for (const key of [
    'bufferingGoal',
    'rebufferingGoal',
    'bufferBehind',
    'lowLatencyMode',
    'gapDetectionThreshold',
    'gapJumpTimerTime',
    'stallEnabled',
    'stallThreshold',
    'stallSkip',
    'segmentPrefetchLimit',
    'loadTimeout',
    'preferNativeHls',
    'useNativeHlsForFairPlay',
  ] as const) {
    if (s[key] !== undefined) streaming[key] = s[key];
  }
  if (s.liveSync) {
    const liveSync: ShakaConfig = {};
    for (const [k, v] of Object.entries(s.liveSync)) if (v !== undefined) liveSync[k] = v;
    streaming.liveSync = liveSync;
  }
  const segmentRetry = toShakaRetry(input.retry?.segment);
  if (segmentRetry) streaming.retryParameters = segmentRetry;
  if (Object.keys(streaming).length) high.streaming = streaming;

  const manifestRetry = toShakaRetry(input.retry?.manifest);
  if (manifestRetry) high.manifest = { retryParameters: manifestRetry };

  const abr: ShakaConfig = {};
  for (const key of ['enabled', 'defaultBandwidthEstimate', 'restrictToElementSize', 'restrictToScreenSize', 'switchInterval'] as const) {
    if (input.abr[key] !== undefined) abr[key] = input.abr[key];
  }
  if (input.abr.restrictions) {
    const r: ShakaConfig = {};
    for (const [k, v] of Object.entries(input.abr.restrictions)) if (v !== undefined) r[k] = v;
    abr.restrictions = r;
  }
  if (Object.keys(abr).length) high.abr = abr;

  if (input.preferredAudioLanguage) {
    high.preferredAudio = [
      { language: input.preferredAudioLanguage, role: '', label: '', channelCount: 0, codec: '', spatialAudio: false },
    ];
  }

  const drm = input.drm;
  const drmConfig: ShakaConfig = {};
  const licenseRetry = toShakaRetry(input.retry?.license);
  if (licenseRetry) drmConfig.retryParameters = licenseRetry;
  if (drm) {
    const servers: Record<string, string> = {};
    const advancedDrm: Record<string, ShakaConfig> = {};
    for (const [keySystem, ks] of Object.entries(drm.keySystems ?? {}) as [KeySystem, NonNullable<DrmConfig['keySystems'][KeySystem]>][]) {
      if (!ks?.licenseUrl) continue;
      servers[keySystem] = ks.licenseUrl;
      const adv: ShakaConfig = {};
      const cert = toUint8(ks.serverCertificate);
      if (cert) adv.serverCertificate = cert;
      if (ks.serverCertificateUrl) adv.serverCertificateUri = ks.serverCertificateUrl;
      if (ks.headers) adv.headers = { ...ks.headers };
      if (ks.videoRobustness) adv.videoRobustness = [...ks.videoRobustness];
      if (ks.audioRobustness) adv.audioRobustness = [...ks.audioRobustness];
      if (ks.persistentStateRequired !== undefined) adv.persistentStateRequired = ks.persistentStateRequired;
      if (ks.distinctiveIdentifierRequired !== undefined) adv.distinctiveIdentifierRequired = ks.distinctiveIdentifierRequired;
      if (ks.sessionType !== undefined) adv.sessionType = ks.sessionType;
      if (Object.keys(adv).length) advancedDrm[keySystem] = adv;
    }
    drmConfig.servers = servers;
    if (Object.keys(advancedDrm).length) drmConfig.advanced = advancedDrm;
    if (drm.preferredKeySystems) drmConfig.preferredKeySystems = [...drm.preferredKeySystems];
    if (drm.clearKeys) drmConfig.clearKeys = { ...drm.clearKeys };
    if (drm.initDataTransform) {
      const transform = drm.initDataTransform;
      drmConfig.initDataTransform = (initData: Uint8Array, initDataType: string, drmInfo: { keySystem?: string; serverCertificate?: Uint8Array | null } | null) =>
        transform(initData, initDataType, { keySystem: drmInfo?.keySystem ?? '', serverCertificate: drmInfo?.serverCertificate ?? null });
    }
  }
  if (Object.keys(drmConfig).length) high.drm = drmConfig;

  return { config: deepMerge(advanced, high), removedAdvancedKeys: removed };
}
