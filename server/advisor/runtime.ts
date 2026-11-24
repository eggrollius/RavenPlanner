import type { Express } from 'express';
import type { Server } from 'node:http';
import type { Features } from '../../src/types.js';
import { advisorConfig } from './config.js';
import { AdvisorService } from './service.js';
import { attachAdvisor } from './socket.js';

export function configureAdvisor(server: Server, app: Express, features: Features) {
  if (!features.aiAdvisor) return;
  const advisor = new AdvisorService({ config: advisorConfig(), apiOrigin: () => `http://127.0.0.1:${(server.address() as { port: number }).port}` });
  const transport = attachAdvisor(server, app, advisor);
  return {
    start: () => advisor.start(),
    async close() { transport.close(); await advisor.close(); },
  };
}
