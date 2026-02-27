import express from 'express';
import { Automation } from './automation.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const API_KEY = process.env.OCADO_API_KEY;

/**
 * Create an Express router that serves the Ocado REST API. Mount at /api for paths like /api/search, /api/cart.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createApiRouter(automation) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!API_KEY) return next();
    if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    next();
  });

  const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  router.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  router.get('/search', asyncHandler(async (req, res) => {
    const query = req.query.q || req.query.query;
    if (!query) return res.status(400).json({ error: 'q or query required' });
    const result = await automation.searchProducts(query);
    res.json(result);
  }));

  router.post('/cart/add-items', asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array required' });
    const result = await automation.addCartItems(items);
    res.json(result);
  }));

  router.post('/cart/remove-items', asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array required' });
    const result = await automation.removeCartItems(items);
    res.json(result);
  }));

  router.get('/cart', asyncHandler(async (req, res) => {
    const result = await automation.getCartContents();
    res.json(result);
  }));

  router.get('/delivery/slot', asyncHandler(async (req, res) => {
    const result = await automation.getDeliverySlots();
    res.json(result);
  }));

  router.get('/delivery/slot/selected', asyncHandler(async (req, res) => {
    const result = await automation.getSelectedDeliverySlot();
    res.json(result);
  }));

  router.post('/delivery/slot/selected', asyncHandler(async (req, res) => {
    const { slotId } = req.body;
    if (!slotId) return res.status(400).json({ error: 'slotId required' });
    const result = await automation.selectDeliverySlot(slotId);
    res.json(result);
  }));

  router.get('/orders/upcoming', asyncHandler(async (req, res) => {
    const result = await automation.getUpcomingOrders();
    res.json(result);
  }));

  router.use((_, res) => res.status(404).json({ error: 'Not found' }));
  router.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return router;
}

// Run standalone when executed directly (e.g. npm start)
const isMain = process.argv[1]?.includes('api-server.js');
if (isMain) {
  const STORAGE_PATH = process.env.OCADO_STORAGE_STATE_PATH || 'ocado-storage.json';
  const ocadoConfig = {
    headless: process.env.OCADO_HEADLESS !== 'false',
    devtools: process.env.OCADO_DEVTOOLS === 'true',
    proxy: process.env.OCADO_PROXY || undefined,
    storageStatePath: STORAGE_PATH,
    email: process.env.OCADO_EMAIL,
    password: process.env.OCADO_PASSWORD,
    heartbeatIntervalMs: process.env.OCADO_HEARTBEAT_MINUTES
      ? Number(process.env.OCADO_HEARTBEAT_MINUTES) * 60 * 1000
      : undefined,
  };
  const automation = new Automation(ocadoConfig);
  const app = express();
  app.use(express.json());
  app.use(createApiRouter(automation));
  const PORT = process.env.PORT || 3000;
  process.on('SIGTERM', async () => {
    await automation.close().catch(console.error);
    process.exit(0);
  });
  app.listen(PORT, () => log('Ocado API on port %s', PORT));
}
