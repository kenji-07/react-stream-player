import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: { harness: path.join(here, 'harness.tsx') },
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: path.join(here, 'dist'),
  sourcemap: true,
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
  metafile: true,
}).then((result) => {
  const outputs = Object.entries(result.metafile.outputs)
    .filter(([f]) => f.endsWith('.js'))
    .map(([f, o]) => `${path.basename(f)} ${(o.bytes / 1024).toFixed(0)} KiB`);
  console.log('[harness]', outputs.join(', '));
});
