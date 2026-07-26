/**
 * Write android/keystore.properties from root .env, then assembleRelease,
 * then optionally upload to Firebase App Distribution.
 *
 *   npm run ship:android
 *
 * Requires: Android SDK / Gradle wrapper, filled .env, and (for upload)
 * FIREBASE_APP_ID + firebase-service-account.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
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

const env = { ...loadEnv(join(root, '.env')), ...process.env };

const storeFile = env.ANDROID_KEYSTORE_PATH || 'android/keystore/rtu-upload.keystore';
const storePassword = env.ANDROID_KEYSTORE_PASSWORD;
const keyAlias = env.ANDROID_KEY_ALIAS || 'rtu-upload';
const keyPassword = env.ANDROID_KEY_PASSWORD || storePassword;

if (!storePassword) {
  console.error('[ship:android] ANDROID_KEYSTORE_PASSWORD missing in .env');
  process.exit(1);
}
if (!existsSync(resolve(root, storeFile))) {
  console.error(`[ship:android] keystore not found: ${storeFile}`);
  process.exit(1);
}

// Paths in keystore.properties are relative to the android/ Gradle root.
const relativeFromAndroid = storeFile.replace(/^android[\\/]/, '').replace(/\\/g, '/');
writeFileSync(
  join(root, 'android', 'keystore.properties'),
  [
    `storeFile=${relativeFromAndroid}`,
    `storePassword=${storePassword}`,
    `keyAlias=${keyAlias}`,
    `keyPassword=${keyPassword}`,
    '',
  ].join('\n')
);
console.log('[ship:android] wrote android/keystore.properties');

const isWin = process.platform === 'win32';
const gradlew = join(root, 'android', isWin ? 'gradlew.bat' : 'gradlew');
console.log('[ship:android] ./gradlew assembleRelease');
const build = spawnSync(gradlew, ['assembleRelease'], {
  cwd: join(root, 'android'),
  stdio: 'inherit',
  shell: isWin,
  env: process.env,
});
if (build.status !== 0) {
  process.exit(build.status || 1);
}

const apk = join(
  root,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk'
);
if (!existsSync(apk)) {
  console.error('[ship:android] APK not found at', apk);
  process.exit(1);
}
console.log('[ship:android] built', apk);

const appId = env.FIREBASE_APP_ID;
const sa = env.FIREBASE_SERVICE_ACCOUNT || 'firebase-service-account.json';
const groups = env.FIREBASE_GROUPS || 'testers';

if (!appId) {
  console.log('[ship:android] FIREBASE_APP_ID not set — skipping upload.');
  console.log('[ship:android] Install the APK manually or fill Firebase fields in .env.');
  process.exit(0);
}

if (!existsSync(resolve(root, sa))) {
  console.error(`[ship:android] missing service account file: ${sa}`);
  process.exit(1);
}

console.log('[ship:android] uploading to Firebase App Distribution…');
const upload = spawnSync(
  'npx',
  [
    '--yes',
    'firebase-tools',
    'appdistribution:distribute',
    apk,
    '--app',
    appId,
    '--service-credentials-file',
    resolve(root, sa),
    '--groups',
    groups,
  ],
  { cwd: root, stdio: 'inherit', shell: isWin }
);
process.exit(upload.status || 0);
