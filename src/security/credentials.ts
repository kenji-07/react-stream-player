import type { CredentialRule, RequestType } from '../types/config.js';
import { originOf } from './url.js';

const DEFAULT_TYPES: RequestType[] = ['manifest', 'segment', 'subtitle', 'image', 'key', 'certificate', 'other'];

export interface NormalizedCredentialRule {
  origins: Set<string>;
  requestTypes: Set<RequestType>;
  headers: CredentialRule['headers'];
  withCredentials: boolean;
}

/** Validates rules: exact origins only (no wildcards, paths or credentials). */
export function normalizeCredentialRules(rules: CredentialRule[] | undefined): { rules: NormalizedCredentialRule[]; errors: string[] } {
  const errors: string[] = [];
  const out: NormalizedCredentialRule[] = [];
  for (const [index, rule] of (rules ?? []).entries()) {
    const origins = new Set<string>();
    for (const raw of rule.origins ?? []) {
      if (raw.includes('*')) {
        errors.push(`credentials[${index}]: wildcard origins are not allowed`);
        continue;
      }
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        errors.push(`credentials[${index}]: invalid origin`);
        continue;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        errors.push(`credentials[${index}]: origin must be http(s)`);
        continue;
      }
      if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search) {
        errors.push(`credentials[${index}]: use a bare origin such as https://cdn.example.com`);
        continue;
      }
      origins.add(parsed.origin);
    }
    if (origins.size === 0) continue;
    out.push({
      origins,
      requestTypes: new Set(rule.requestTypes ?? DEFAULT_TYPES),
      headers: rule.headers,
      withCredentials: rule.withCredentials === true,
    });
  }
  return { rules: out, errors };
}

/** Rules whose origin and request type both match the URL. */
export function matchCredentialRules(rules: NormalizedCredentialRule[], url: string, type: RequestType): NormalizedCredentialRule[] {
  const origin = originOf(url);
  if (!origin) return [];
  return rules.filter((rule) => rule.origins.has(origin) && rule.requestTypes.has(type));
}

export function isOriginAllowed(rules: NormalizedCredentialRule[], url: string): boolean {
  const origin = originOf(url);
  return origin !== null && rules.some((rule) => rule.origins.has(origin));
}

/** Resolves rule headers (static or callback). */
export async function resolveRuleHeaders(rule: NormalizedCredentialRule, context: { type: RequestType; url: string }): Promise<Record<string, string>> {
  const { headers } = rule;
  if (!headers) return {};
  const resolved = typeof headers === 'function' ? await headers(context) : headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolved ?? {})) if (typeof v === 'string') out[k] = v;
  return out;
}
