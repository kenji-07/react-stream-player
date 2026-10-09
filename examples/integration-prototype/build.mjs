import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  sourcemap: true,
  jsx: 'automatic',
  target: 'es2022',
  absWorkingDir: new URL('.', import.meta.url).pathname,
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'info',
});
