import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

// CPU-only deployments need none of the optional CUDA/Vulkan packages. Avoid
// shipping hundreds of MB of unused GPU binaries in a Heroku slug.
const directory = path.resolve('node_modules/@node-llama-cpp');
for (const name of await readdir(directory).catch(() => [])) {
  if (/-cuda(?:-ext)?$|-vulkan$/.test(name)) await rm(path.join(directory, name), { recursive: true, force: true });
}
if (process.env.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD === 'true') await import('./download-advisor-model.mjs');
