/* global AbortSignal */
import { createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const destination = path.resolve(process.env.RAVEN_ADVISOR_MODEL_PATH || '.local/models/smol.gguf');
const url = 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/7be6f65f1db715fe5dc5a4634c0d459b4eed42ec/SmolLM2-360M-Instruct-Q4_K_M.gguf';
try {
  const existing = await stat(destination).catch(() => undefined);
  if (existing?.isFile() && existing.size > 0) console.log('Using the existing advisor model.');
  else {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.part-${process.pid}`;
    try {
      console.log('Downloading the pinned SmolLM2 360M model to the server…');
      const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
      if ((await stat(temporary)).size !== 270590880) throw new Error('The downloaded model has an unexpected size.');
      await rename(temporary, destination);
      console.log('Advisor model installed.');
    } finally { await rm(temporary, { force: true }); }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Model download failed.');
  process.exitCode = 1;
}
