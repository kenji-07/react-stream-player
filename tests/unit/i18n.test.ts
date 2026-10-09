import { describe, expect, it } from 'vitest';
import { en, format, languageName, LOCALES, mn, resolveTranslations } from '../../src/ui/i18n.js';

describe('translations', () => {
  it('every locale has exactly the same keys, all non-empty strings', () => {
    const keys = (t: object) => Object.keys(t).sort();
    for (const [name, t] of Object.entries(LOCALES)) {
      expect(keys(t), name).toEqual(keys(en));
      expect(keys(t.errors), `${name}.errors`).toEqual(keys(en.errors));
      for (const [k, v] of Object.entries(t)) if (k !== 'errors') expect(typeof v === 'string' && v.length > 0, `${name}.${k}`).toBe(true);
      for (const [k, v] of Object.entries(t.errors)) expect(typeof v === 'string' && v.length > 0, `${name}.errors.${k}`).toBe(true);
    }
  });

  it('placeholders are identical across locales', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (key === 'errors') continue;
      expect(placeholders(mn[key] as string), key).toEqual(placeholders(en[key] as string));
    }
  });

  it('Mongolian is actually translated (not an English copy)', () => {
    const same = (Object.keys(en) as (keyof typeof en)[]).filter((k) => k !== 'errors' && en[k] === mn[k]);
    expect(same.length).toBeLessThan(3);
  });

  it('overrides replace strings without mutating the base locale', () => {
    const t = resolveTranslations('en', { play: 'Start', errors: { network: 'Offline' } });
    expect(t.play).toBe('Start');
    expect(t.errors.network).toBe('Offline');
    expect(en.play).not.toBe('Start');
    expect(resolveTranslations('mn', undefined)).toBe(mn);
  });

  it('format substitutes named placeholders as plain text', () => {
    expect(format('Skip in {seconds}s', { seconds: 3 })).toBe('Skip in 3s');
    expect(format('{a}-{missing}', { a: '<b>' })).toBe('<b>-');
  });

  it('languageName falls back to the code or the unknown label', () => {
    expect(languageName('en', 'en', '?')).toBe('English');
    expect(languageName('und', 'en', 'Unknown')).toBe('Unknown');
    expect(languageName(null, 'en', 'Unknown')).toBe('Unknown');
  });
});
