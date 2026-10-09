// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = files(src).filter((f) => /\.(ts|tsx)$/.test(f));
/** Source text without comments (comments may name the APIs they avoid). */
const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('static safety checks over src/', () => {
  const forbidden: [string, RegExp][] = [
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function\s*\(/],
    ['innerHTML/outerHTML assignment', /\.(inner|outer)HTML\s*=/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\.write/],
    ['string setTimeout', /setTimeout\(\s*['"`]/],
    ['localStorage', /localStorage/],
    ['sessionStorage', /sessionStorage/],
    ['indexedDB', /indexedDB/],
    ['document.cookie', /document\.cookie/],
  ];
  for (const [name, pattern] of forbidden) {
    it(`no ${name}`, () => {
      const hits = sources.filter((f) => pattern.test(code(f))).map((f) => relative(root, f));
      expect(hits).toEqual([]);
    });
  }

  it('the only injected scripts are the documented IMA and Cast SDK URLs', () => {
    const scriptHosts = new Set<string>();
    for (const f of sources) {
      for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/[a-z0-9.-]+\/[^'"`\s]*\.js[^'"`\s]*/g)) scriptHosts.add(new URL(m[0]).host);
    }
    expect([...scriptHosts].sort()).toEqual(['imasdk.googleapis.com', 'www.gstatic.com']);
  });

  it('client entry files carry the use client directive; core does not', () => {
    const first = (f: string) => readFileSync(join(src, f), 'utf8').trimStart().split('\n', 1)[0];
    expect(first('index.ts')).toBe("'use client';");
    expect(first('react/Player.tsx')).toBe("'use client';");
    expect(first('react/PlayerErrorBoundary.tsx')).toBe("'use client';");
    expect(readFileSync(join(src, 'core.ts'), 'utf8')).not.toContain('use client');
  });

  it('no secrets or long-lived signed URLs are committed in source or fixtures config', () => {
    const suspicious = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|X-Amz-Signature=|Key-Pair-Id=|[?&]Signature=[A-Za-z0-9~_-]{40,})/;
    const candidates = [...sources, ...files(join(root, 'docs')), join(root, 'README.md')].filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
    const hits = candidates.filter((f) => suspicious.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});
