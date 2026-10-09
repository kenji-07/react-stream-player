import { describe, expect, it } from 'vitest';
import { isPlayerError, fromMediaError, fromShakaError, playerError } from '../../src/errors.js';
import { isOriginAllowed, matchCredentialRules, normalizeCredentialRules, resolveRuleHeaders } from '../../src/security/credentials.js';
import { redactText, redactUrl, redactValue } from '../../src/security/redact.js';
import { isAllowedResourceUrl, originOf, pathnameOf, validateClickThroughUrl } from '../../src/security/url.js';

describe('click-through URLs', () => {
  it('allows http(s) and relative URLs', () => {
    expect(validateClickThroughUrl('https://advertiser.example.com/landing?x=1')).toBe('https://advertiser.example.com/landing?x=1');
    expect(validateClickThroughUrl('/landing', {}, 'https://site.example.com/watch')).toBe('https://site.example.com/landing');
  });

  it.each(['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', 'blob:https://a/1', 'java\tscript:alert(1)', '', undefined])(
    'rejects %s',
    (url) => {
      expect(validateClickThroughUrl(url as string | undefined)).toBeNull();
    },
  );

  it('allows custom app schemes only when listed', () => {
    expect(validateClickThroughUrl('myapp://open/1')).toBeNull();
    expect(validateClickThroughUrl('myapp://open/1', { allowedSchemes: ['myapp'] })).toBe('myapp://open/1');
    // Dangerous schemes stay blocked even if listed.
    expect(validateClickThroughUrl('javascript:alert(1)', { allowedSchemes: ['javascript'] })).toBeNull();
  });
});

describe('resource URLs', () => {
  it('accepts http(s), relative and blob:', () => {
    for (const url of ['https://a.example/x.mp4', 'http://a.example/x', '/x.mp4', 'x.mp4', '//cdn.example/x', 'blob:https://a/1']) {
      expect(isAllowedResourceUrl(url)).toBe(true);
    }
  });

  it('rejects script-capable and local schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:video/mp4;base64,AA', 'file:///x.mp4', 'ftp://x/y', '']) {
      expect(isAllowedResourceUrl(url)).toBe(false);
    }
  });

  it('extracts origins and paths', () => {
    expect(originOf('https://cdn.example.com:8443/a?b')).toBe('https://cdn.example.com:8443');
    expect(originOf('not a url', 'invalid base')).toBeNull();
    expect(pathnameOf('https://x/a/b.m3u8?token=1#f')).toBe('/a/b.m3u8');
    expect(pathnameOf('rel/a.mpd?x=1')).toBe('/rel/a.mpd');
  });
});

describe('redaction', () => {
  it('removes query strings, fragments and blob ids from URLs', () => {
    expect(redactUrl('https://cdn.example.com/a.m3u8?Policy=abc&Signature=def')).toBe('https://cdn.example.com/a.m3u8?[redacted]');
    expect(redactUrl('https://cdn.example.com/a.mp4')).toBe('https://cdn.example.com/a.mp4');
    expect(redactUrl('blob:https://example.com/1234-5678')).toBe('blob:[redacted]');
  });

  it('redacts URLs and bearer tokens inside free text', () => {
    const text = 'GET https://lic.example.com/wv?token=SECRET failed; Authorization: Bearer abc.def.ghi';
    const out = redactText(text);
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).toContain('https://lic.example.com/wv?[redacted]');
  });

  it('deep-redacts sensitive keys and binary payloads', () => {
    const out = redactValue({
      url: 'https://x.example/a?sig=1',
      headers: { Authorization: 'Bearer t', 'X-Api-Key': 'k' },
      licenseResponse: new Uint8Array(8),
      body: new ArrayBuffer(4),
      token: 'secret',
      retries: 3,
      nested: [{ password: 'p' }],
    }) as Record<string, unknown>;
    expect(out.url).toBe('https://x.example/a?[redacted]');
    expect(out.headers).toEqual({ Authorization: '[redacted]', 'X-Api-Key': '[redacted]' });
    expect(out.licenseResponse).toBe('[redacted]');
    expect(out.body).toBe('[binary 4 bytes]');
    expect(out.token).toBe('[redacted]');
    expect(out.retries).toBe(3);
    expect(out.nested).toEqual([{ password: '[redacted]' }]);
  });
});

describe('credential rules', () => {
  it('accepts exact http(s) origins only', () => {
    const { rules, errors } = normalizeCredentialRules([
      { origins: ['https://cdn.example.com', 'https://*.example.com', 'https://cdn.example.com/path', 'ftp://x.example.com', 'https://user:pw@x.example.com', 'nope'], headers: { Authorization: 'x' } },
    ]);
    expect([...rules[0]!.origins]).toEqual(['https://cdn.example.com']);
    expect(errors).toHaveLength(5);
  });

  it('drops rules without any valid origin', () => {
    expect(normalizeCredentialRules([{ origins: ['https://*.x.com'], headers: {} }]).rules).toEqual([]);
  });

  it('matches by origin and request type', () => {
    const { rules } = normalizeCredentialRules([{ origins: ['https://cdn.example.com'], requestTypes: ['segment'], headers: { A: '1' } }]);
    expect(matchCredentialRules(rules, 'https://cdn.example.com/seg1.m4s', 'segment')).toHaveLength(1);
    expect(matchCredentialRules(rules, 'https://cdn.example.com/master.m3u8', 'manifest')).toHaveLength(0);
    expect(matchCredentialRules(rules, 'https://cdn.example.com.evil.com/seg1.m4s', 'segment')).toHaveLength(0);
    expect(matchCredentialRules(rules, 'http://cdn.example.com/seg1.m4s', 'segment')).toHaveLength(0);
    expect(isOriginAllowed(rules, 'https://cdn.example.com/x')).toBe(true);
    expect(isOriginAllowed(rules, 'https://other.example.com/x')).toBe(false);
  });

  it('resolves static and callback headers, dropping non-string values', async () => {
    const { rules } = normalizeCredentialRules([
      { origins: ['https://a.example'], headers: ({ type }) => ({ Authorization: `Bearer ${type}`, Bad: 1 as unknown as string }) },
    ]);
    expect(await resolveRuleHeaders(rules[0]!, { type: 'manifest', url: 'https://a.example/m' })).toEqual({ Authorization: 'Bearer manifest' });
  });
});

describe('errors', () => {
  it('normalizes and redacts messages and details', () => {
    const e = playerError('http-error', 'network', { message: 'failed https://x/a?token=1', details: { url: 'https://x/a?token=1', status: 403 } });
    expect(isPlayerError(e)).toBe(true);
    expect(e.message).toBe('failed https://x/a?[redacted]');
    expect(e.details).toEqual({ url: 'https://x/a?[redacted]', status: 403 });
    expect(Object.isFrozen(e.details)).toBe(true);
    expect(e.recoverable).toBe(true);
  });

  it('sanitizes vendor causes', () => {
    const vendor = Object.assign(new Error('boom'), { category: 1, code: 1001, severity: 2, data: ['https://x/seg.m4s?sig=abc', 403, 'body', { authorization: 'Bearer t' }] });
    const e = fromShakaError(vendor);
    expect(e.code).toBe('http-error');
    expect(e.fatal).toBe(true);
    expect(e.details.httpStatus).toBe(403);
    expect(JSON.stringify(e.cause)).not.toContain('sig=abc');
    expect(JSON.stringify(e.cause)).not.toContain('Bearer t');
  });

  it.each([
    [{ category: 1, code: 1003 }, 'network-timeout'],
    [{ category: 1, code: 1001, data: ['u', 404] }, 'source-not-found'],
    [{ category: 1, code: 1002 }, 'network-error'],
    [{ category: 2, code: 2000 }, 'subtitle-load-error'],
    [{ category: 3, code: 3016 }, 'media-decode-error'],
    [{ category: 4, code: 4032 }, 'media-unsupported-codec'],
    [{ category: 4, code: 4008 }, 'drm-unsupported'],
    [{ category: 4, code: 4000 }, 'manifest-error'],
    [{ category: 6, code: 6001 }, 'drm-unsupported'],
    [{ category: 6, code: 6007 }, 'drm-license-error'],
    [{ category: 6, code: 6012 }, 'drm-no-license-server'],
    [{ category: 6, code: 6004 }, 'drm-certificate-error'],
    [{ category: 6, code: 6018 }, 'drm-output-restricted'],
    [{ category: 6, code: 6999 }, 'drm-error'],
    [{ category: 7, code: 7000 }, 'operation-aborted'],
    [{ category: 8, code: 8000 }, 'cast-error'],
    [{ category: 99, code: 1 }, 'unexpected-error'],
  ])('maps Shaka %j → %s', (error, code) => {
    expect(fromShakaError(error).code).toBe(code);
  });

  it('subtitle and cancellation errors are never fatal', () => {
    expect(fromShakaError({ category: 2, code: 2000, severity: 2 }).fatal).toBe(false);
    expect(fromShakaError({ category: 7, code: 7000, severity: 2 }).fatal).toBe(false);
  });

  it('maps HTMLMediaElement errors', () => {
    expect(fromMediaError({ code: 3 } as MediaError).code).toBe('media-decode-error');
    expect(fromMediaError({ code: 4 } as MediaError)).toMatchObject({ code: 'media-unsupported-codec', recoverable: false });
    expect(fromMediaError(null).code).toBe('media-error');
  });

  it('withContext keeps everything and adds session/load ids', () => {
    const e = playerError('ad-no-fill', 'ads').withContext('s1', 3);
    expect(e).toMatchObject({ code: 'ad-no-fill', category: 'ads', contentSessionId: 's1', loadId: 3 });
  });
});
