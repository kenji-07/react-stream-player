import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  if (!fs.existsSync(path.join(root, 'tests/fixtures/media/generated.json'))) {
    throw new Error('Media fixtures are missing. Run `npm run fixtures` (requires ffmpeg) before the e2e tests.');
  }
  execFileSync(process.execPath, [path.join(root, 'tests/e2e/harness/build.mjs')], { stdio: 'inherit' });
}
