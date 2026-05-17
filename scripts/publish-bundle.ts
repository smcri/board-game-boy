#!/usr/bin/env tsx
/**
 * publish-bundle.ts
 *
 * Copies a built bundle (bundle.json + assets/ + game.js) from the local
 * backend output dir to the gh-pages branch so it can be served at
 *   https://<user>.github.io/<repo>/bundles/<bundle_id>/
 *
 * Design refs:
 *   - docs/design/06-bundle-and-runtime.md (bundle contract)
 *   - docs/design/01-overview-and-architecture.md (gh-pages distribution)
 *
 * Usage:
 *   pnpm publish-bundle <bundle_id> [--bundles-dir ./bundles] [--branch gh-pages]
 *
 * Notes:
 *   - This script does NOT push to the remote. It commits to a local gh-pages
 *     branch and prints the commands you should run to push (we never push
 *     automatically from a script so secrets stay out of the loop).
 *   - The repo must already have a gh-pages branch. If it doesn't, create one
 *     with `git checkout --orphan gh-pages && git rm -rf . && git commit
 *     --allow-empty -m 'init gh-pages'`.
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Args {
  bundleId: string;
  bundlesDir: string;
  branch: string;
}

function parseArgs(argv: string[]): Args {
  const [bundleId, ...rest] = argv;
  if (!bundleId) {
    console.error('Usage: pnpm publish-bundle <bundle_id> [--bundles-dir ./bundles] [--branch gh-pages]');
    process.exit(2);
  }
  let bundlesDir = './bundles';
  let branch = 'gh-pages';
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === '--bundles-dir') bundlesDir = rest[i + 1] ?? bundlesDir;
    else if (rest[i] === '--branch') branch = rest[i + 1] ?? branch;
  }
  return { bundleId, bundlesDir, branch };
}

function run(cmd: string, opts: { cwd?: string } = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd });
}

function runCapture(cmd: string): string {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function main() {
  const { bundleId, bundlesDir, branch } = parseArgs(process.argv.slice(2));

  const srcDir = join(bundlesDir, bundleId);
  if (!existsSync(srcDir)) {
    console.error(`Bundle dir does not exist: ${srcDir}`);
    process.exit(1);
  }
  for (const required of ['bundle.json', 'game.js']) {
    if (!existsSync(join(srcDir, required))) {
      console.error(`Missing required file: ${join(srcDir, required)}`);
      process.exit(1);
    }
  }

  console.log(`▶ Publishing bundle ${bundleId} from ${srcDir} to branch ${branch}…`);

  const currentBranch = runCapture('git rev-parse --abbrev-ref HEAD');
  const stash = runCapture('git status --porcelain').length > 0;
  if (stash) {
    console.log('▶ Stashing uncommitted changes…');
    run('git stash push -u -m "publish-bundle.ts auto-stash"');
  }

  try {
    // Switch to gh-pages branch (must already exist).
    run(`git fetch origin ${branch} || true`);
    run(`git checkout ${branch}`);
    run(`git pull --ff-only origin ${branch} || true`);

    const dest = `bundles/${bundleId}`;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(srcDir, dest, { recursive: true, force: true });

    // Drop a minimal index.html so the page loads via window.BGB.boot.
    const bundleJson = readFileSync(join(srcDir, 'bundle.json'), 'utf8');
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Board Game Boy — ${bundleId}</title>
  <style>html,body,#root{height:100%;margin:0;background:#0b0d10;color:#eee;font-family:sans-serif}</style>
</head>
<body>
  <div id="root"></div>
  <script src="./game.js"></script>
  <script>
    fetch('./bundle.json').then(r=>r.json()).then(b => window.BGB.boot(document.getElementById('root'), b));
  </script>
</body>
</html>`;
    writeFileSync(join(dest, 'index.html'), html);

    // Stage + commit.
    run(`git add ${dest}`);
    run(`git commit -m "publish bundle ${bundleId}"`);

    console.log('');
    console.log('✅ Bundle committed to local gh-pages.');
    console.log('   Next steps (you run these):');
    console.log(`     git push origin ${branch}`);
    console.log(`     # then browse:`);
    const remote = runCapture('git config --get remote.origin.url');
    const m = remote.match(/github.com[/:]([^/]+)\/([^./]+)/);
    if (m) {
      console.log(`     https://${m[1]}.github.io/${m[2]}/bundles/${bundleId}/`);
    }
  } finally {
    // Always go back.
    run(`git checkout ${currentBranch}`);
    if (stash) {
      console.log('▶ Restoring stash…');
      run('git stash pop || true');
    }
  }
}

main();
