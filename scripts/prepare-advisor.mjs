import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Run in heroku-cleanup, AFTER npm's dependency pruning. Running this in
// postbuild lets npm restore these three optional GPU packages into the slug.
// CPU inference and the Chrome catalog worker retain their runtime files.
const directory = path.resolve('node_modules/@node-llama-cpp');
for (const name of await readdir(directory).catch(() => [])) {
  if (/-cuda(?:-ext)?$|-vulkan$/.test(name)) {
    await rm(path.join(directory, name), { recursive: true, force: true });
    console.log(`Removed unused GPU runtime: ${name}`);
  }
}
// Match the server's preview default; explicit false always disables it.
const preview = /^[1-9]\d*$/.test(process.env.HEROKU_PR_NUMBER || '');
const enabled = process.env.RAVEN_ADVISOR_ENABLED === 'true' || (process.env.RAVEN_ADVISOR_ENABLED === undefined && preview);
const provision = process.env.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD === 'true' || (process.env.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD === undefined && preview);
if (enabled && provision) await import('./download-advisor-model.mjs');
