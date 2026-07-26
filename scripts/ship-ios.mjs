/**
 * iOS TestFlight upload helper.
 * Must run on macOS with Xcode + paid Apple Developer Program.
 *
 *   npm run ship:ios
 *
 * Uses fastlane ios beta when `bundle` / fastlane are available; otherwise
 * prints the exact Xcode + Transporter steps.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

if (process.platform === 'win32') {
  console.error('[ship:ios] iOS builds require a Mac with Xcode.');
  console.error('[ship:ios] Push to GitHub, pull on the Mac, then run: npm run ship:ios');
  process.exit(1);
}

const env = { ...loadEnv(join(root, '.env')), ...process.env };
for (const k of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH']) {
  if (!env[k]) {
    console.error(`[ship:ios] missing ${k} in .env (needed for TestFlight API upload)`);
    console.error('[ship:ios] Until the paid Apple Developer Program is active, install via Xcode:');
    console.error('  open ios/App/App.xcworkspace  →  select your Team  →  Run on device');
    process.exit(1);
  }
}

const bundle = spawnSync('bundle', ['exec', 'fastlane', 'ios', 'beta'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...env },
});
process.exit(bundle.status == null ? 1 : bundle.status);
