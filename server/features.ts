import type { Features } from '../src/types.js';

// A single runtime switch controls discovery, UI visibility and inference.
// Production defaults off. Trusted Heroku PR metadata also covers review apps
// created before app.json gained the flag. An explicit value always wins.
export function readFeatures(env: NodeJS.ProcessEnv = process.env): Features {
  const preview = /^[1-9]\d*$/.test(env.HEROKU_PR_NUMBER || '');
  return { aiAdvisor: env.RAVEN_ADVISOR_ENABLED === 'true' || (env.RAVEN_ADVISOR_ENABLED === undefined && preview) };
}
