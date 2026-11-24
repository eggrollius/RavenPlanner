import type { Catalog } from '../../src/types.js';
import { createTools } from '../../src/advisor/tools.js';
import { solvePlan } from '../../src/advisor/solver.js';
import type { AdvisorTools } from '../../src/advisor/contracts.js';

// Same catalog selectors/section validation as the client. Only the transport
// and scheduler execution differ: loopback HTTP and this isolated process.
export function serverTools(catalog: Catalog, apiOrigin: string): AdvisorTools {
  return createTools(catalog, (input, init) => fetch(new URL(String(input), apiOrigin), init), async (plan, courses, previousCRNs, signal) => {
    signal.throwIfAborted();
    const result = solvePlan(plan, courses, previousCRNs);
    signal.throwIfAborted();
    return result;
  });
}
