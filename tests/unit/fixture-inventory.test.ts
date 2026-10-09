// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(readFileSync(join(root, 'tests/fixtures/media.json'), 'utf8')) as {
  schemaVersion: number;
  fixtures: {
    id: string;
    source: { kind: string; paths?: string[]; env?: string[] };
    purpose: string;
    access: string;
    status?: string;
    skipBehaviour?: string;
    assertions?: string[];
  }[];
};
const mediaDir = join(root, 'tests/fixtures/media');

describe('fixture inventory (tests/fixtures/media.json)', () => {
  it('has unique ids and the required fields', () => {
    const ids = inventory.fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of inventory.fixtures) {
      expect(f.purpose, f.id).toBeTruthy();
      expect(f.source.kind, f.id).toBeTruthy();
      if (f.source.kind === 'external') {
        expect(f.status, f.id).toBe('externally-unverified');
        expect(f.skipBehaviour, f.id).toBeTruthy();
      } else {
        expect(f.access, f.id).toBeTruthy();
      }
    }
  });

  it('external fixtures are referenced only by RSP_FIXTURE_* variable names, never URLs or secrets', () => {
    for (const f of inventory.fixtures.filter((x) => x.source.kind === 'external')) {
      for (const name of f.source.env ?? []) expect(name).toMatch(/^RSP_FIXTURE_[A-Z0-9_]+$/);
    }
    expect(readFileSync(join(root, 'tests/fixtures/media.json'), 'utf8')).not.toMatch(/https?:\/\//);
  });

  it('referenced specs exist', () => {
    for (const f of inventory.fixtures) for (const spec of f.assertions ?? []) expect(existsSync(join(root, spec)), `${f.id}: ${spec}`).toBe(true);
  });

  it.skipIf(!existsSync(mediaDir))('generated local fixtures exist (run `npm run fixtures`)', () => {
    for (const f of inventory.fixtures.filter((x) => x.source.kind === 'local')) {
      for (const p of f.source.paths ?? []) expect(existsSync(join(mediaDir, p)), `${f.id}: ${p}`).toBe(true);
    }
  });
});
