import { solvePlan } from './solver';

self.onmessage = (event: MessageEvent<Parameters<typeof solvePlan>>) => {
  try { self.postMessage({ result: solvePlan(...event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Schedule search failed.' }); }
};
