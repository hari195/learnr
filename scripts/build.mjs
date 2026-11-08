import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nextAppVersion } from './version.mjs';

const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const targetArgument = process.argv.find((argument) => argument.startsWith('--target='));
const target = targetArgument?.slice('--target='.length) || 'chromium';
if (!['chromium', 'arc'].includes(target)) throw new Error(`Unknown browser build target ${JSON.stringify(target)}.`);
const outDir = target === 'arc' ? 'dist-arc' : 'dist';
const environment = { ...process.env, LEARNR_BUILD_ID: buildId, LEARNR_BROWSER_TARGET: target, LEARNR_OUT_DIR: outDir };
const manifestPath = resolve('public/manifest.json');
const packagePath = resolve('package.json');
const lockPath = resolve('package-lock.json');

function run(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], { stdio: 'inherit', env: environment });
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status ?? 1}.`);
}

const originals = await Promise.all([manifestPath, packagePath, lockPath].map((path) => readFile(path, 'utf8')));
const [manifest, packageJson, packageLock] = originals.map((value) => JSON.parse(value));
if (manifest.version !== packageJson.version || manifest.version !== packageLock.version || manifest.version !== packageLock.packages?.['']?.version) {
  throw new Error('App versions in the manifest, package.json, and package-lock.json must match before building.');
}
const previousVersion = manifest.version;
const appVersion = nextAppVersion(previousVersion);
manifest.version = appVersion;
packageJson.version = appVersion;
packageLock.version = appVersion;
packageLock.packages[''].version = appVersion;

await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
]);

try {
  run('node_modules/typescript/bin/tsc', ['-b']);
  run('node_modules/vite/bin/vite.js', ['build']);
  if (target === 'arc') {
    const builtManifestPath = resolve(outDir, 'manifest.json');
    const builtManifest = JSON.parse(await readFile(builtManifestPath, 'utf8'));
    builtManifest.name = 'learnr (Arc)';
    builtManifest.description = 'Read with AI in an Arc Split View tab that follows the page beside it.';
    builtManifest.permissions = (builtManifest.permissions ?? []).filter((permission) => permission !== 'sidePanel' && permission !== 'tabGroups');
    delete builtManifest.side_panel;
    await writeFile(builtManifestPath, `${JSON.stringify(builtManifest, null, 2)}\n`);
  }
  run('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.content.config.ts']);

  await writeFile(resolve(outDir, 'build-info.json'), `${JSON.stringify({ appVersion, buildId, target }, null, 2)}\n`);
  run('scripts/verify-build.mjs', [`--dir=${outDir}`, `--target=${target}`]);
  console.log(`Built learnr ${target} target in ${outDir} (app version ${previousVersion} → ${appVersion}).`);
} catch (error) {
  await Promise.all([manifestPath, packagePath, lockPath].map((path, index) => writeFile(path, originals[index])));
  console.error(`Build failed; restored app version ${previousVersion}.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
