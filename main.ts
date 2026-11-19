// main.ts — the entrypoint of the Neon Coast Cover Studio entry.
//
// It hands the app in: it copies app/ and screenshots/ from this repository
// into the output directory (MAKEFUN_OUTPUT_DIR, or /output when unset) and
// writes /output/dossier.json with buildDossier from vendor/makefun-app.ts,
// the kit's own dossier library. Node 22, standard library only, no build.

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

/** Count the plain files under a directory, recursively. */
function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(path);
    else if (entry.isFile()) count++;
  }
  return count;
}

/** Copy one top-level tree of the repository into the output directory. */
function copyTree(name: string): number {
  const src = join(repoRoot, name);
  const dest = join(outDir, name);
  if (!existsSync(src)) {
    throw new Error(`main.ts: ${name}/ is missing from the repository`);
  }
  // Clear any stale copy from an earlier run, so removed files do not linger.
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return countFiles(dest);
}

mkdirSync(outDir, { recursive: true });

const appFiles = copyTree('app');
const shotFiles = copyTree('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(`Neon Coast Cover Studio: copied ${appFiles} app files and ${shotFiles} screenshots to ${outDir}`);
console.log(`Neon Coast Cover Studio: wrote dossier.json (${dossier.length} bytes)`);
