/**
 * Single Express server that runs both the REST API and the MCP endpoint with one shared Automation instance.
 * - GET /health          – health check (no auth)
 * - /api/*               – REST API (search, cart, delivery, orders)
 * - POST /mcp, GET /mcp   – MCP endpoint (Streamable HTTP)
 *
 * Used as the Docker entrypoint and for npm run service.
 */

import express from 'express';
import { Automation } from './automation.js';
import { createApiRouter } from './api-server.js';
import { createMcpRouter } from './mcp-server.js';
import { createLogger } from './logger.js';

const log = createLogger('service');

const ocadoConfig = {
  headless: process.env.OCADO_HEADLESS !== 'false',
  devtools: process.env.OCADO_DEVTOOLS === 'false',
  proxy: process.env.OCADO_PROXY || undefined,
  storageStatePath: process.env.OCADO_STORAGE_STATE_PATH || 'ocado-storage.json',
  email: process.env.OCADO_EMAIL,
  password: process.env.OCADO_PASSWORD,
  heartbeatIntervalMs: process.env.OCADO_HEARTBEAT_MINUTES
    ? Number(process.env.OCADO_HEARTBEAT_MINUTES) * 60 * 1000
    : undefined,
};

const automation = new Automation(ocadoConfig);
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use('/api', createApiRouter(automation));
app.use('/mcp', createMcpRouter(automation));
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

process.on('SIGTERM', async () => {
  await automation.close().catch(console.error);
  process.exit(0);
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  log('Ocado service on %s:%s (API: /api/*  MCP: POST /mcp)', HOST, PORT);
});
