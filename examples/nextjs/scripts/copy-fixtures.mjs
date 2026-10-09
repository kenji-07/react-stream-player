// Copies the package's generated fixtures (npm run fixtures) into public/media.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../tests/fixtures/media/', import.meta.url));
const to = fileURLToPath(new URL('../public/media/', import.meta.url));
if (!existsSync(from)) {
  console.error('Fixtures not found. Run `npm run fixtures` in the package root first.');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`Copied fixtures to ${to}`);
