/**
 * Copy / bundle the root web app into www/ for Capacitor and Cloudflare deploys.
 * Root index.html + piexif.js + native-bridge.js remain the source of truth.
 */
import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

if (existsSync(www)) {
  rmSync(www, { recursive: true, force: true });
}
mkdirSync(www, { recursive: true });

copyFileSync(join(root, 'index.html'), join(www, 'index.html'));
console.log('[build:web] copied index.html');

copyFileSync(join(root, 'piexif.js'), join(www, 'piexif.js'));
console.log('[build:web] copied piexif.js');

const bridgeSrc = join(root, 'native-bridge.js');
if (!existsSync(bridgeSrc)) {
  console.error('[build:web] missing native-bridge.js');
  process.exit(1);
}

await esbuild.build({
  entryPoints: [bridgeSrc],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  outfile: join(www, 'native-bridge.js'),
  logLevel: 'warning',
});
console.log('[build:web] bundled native-bridge.js');

// Tiny marker so we can confirm the build in debug.
writeFileSync(join(www, '.build-stamp'), new Date().toISOString());

console.log(`[build:web] ready → ${www}`);
