import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('cleans GPU packages after npm pruning, retains CPU/Chrome, and skips disabled model provisioning', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.scripts['heroku-postbuild']).not.toContain('prepare-advisor');
  expect(manifest.scripts['heroku-cleanup']).toBe('node scripts/prepare-advisor.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'raven-slug-'));
  try {
    const binaries = path.join(directory, 'node_modules/@node-llama-cpp');
    for (const name of ['linux-x64', 'linux-x64-cuda', 'linux-x64-cuda-ext', 'linux-x64-vulkan']) {
      await mkdir(path.join(binaries, name), { recursive: true });
      await writeFile(path.join(binaries, name, 'runtime'), 'binary');
    }
    await mkdir(path.join(directory, '.chrome-for-testing'), { recursive: true });
    await writeFile(path.join(directory, '.chrome-for-testing/chrome'), 'browser');
    const modelPath = path.join(directory, 'model.gguf');
    await promisify(execFile)(process.execPath, [path.resolve('scripts/prepare-advisor.mjs')], {
      cwd: directory, timeout: 5000,
      env: { ...process.env, HEROKU_PR_NUMBER: '18', RAVEN_ADVISOR_ENABLED: 'false', RAVEN_ADVISOR_DOWNLOAD_ON_BUILD: 'true', RAVEN_ADVISOR_MODEL_PATH: modelPath },
    });
    expect(await readdir(binaries)).toEqual(['linux-x64']);
    expect(await readFile(path.join(binaries, 'linux-x64/runtime'), 'utf8')).toBe('binary');
    expect(await readFile(path.join(directory, '.chrome-for-testing/chrome'), 'utf8')).toBe('browser');
    await expect(readFile(modelPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('provisions a model in an existing PR preview with unset feature flags', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'raven-preview-'));
  try {
    const modelPath = path.join(directory, 'model.gguf');
    await writeFile(modelPath, 'already provisioned');
    const env: NodeJS.ProcessEnv = { ...process.env, HEROKU_PR_NUMBER: '18', RAVEN_ADVISOR_MODEL_PATH: modelPath };
    delete env.RAVEN_ADVISOR_ENABLED;
    delete env.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD;
    const { stdout } = await promisify(execFile)(process.execPath, [path.resolve('scripts/prepare-advisor.mjs')], { cwd: directory, env, timeout: 5000 });
    expect(stdout).toContain('Using the existing advisor model.');
    expect(await readFile(modelPath, 'utf8')).toBe('already provisioned');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
