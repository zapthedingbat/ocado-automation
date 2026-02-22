import express from 'express';
import { OcadoAutomation } from './shoppingSession.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || process.env.OCADO_API_KEY;
const STORAGE_PATH = process.env.OCADO_STORAGE_STATE_PATH || 'ocado-storage.json';

let ocado = null;
let currentPage = null;

async function getPage() {
  if (!ocado) {
    ocado = new OcadoAutomation({ headless: process.env.HEADLESS !== 'false', storageStatePath: STORAGE_PATH });
  }
  await ocado.ensureAuthenticated();
  if (!currentPage) currentPage = await ocado._context.newPage();
  return currentPage;
}

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
});

app.use((req, _, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.post('/basket/add', asyncHandler(async (req, res) => {
  const { item, quantity = 1 } = req.body;
  if (!item) return res.status(400).json({ error: 'item required' });
  const page = await getPage();
  const result = await ocado.addItemToBasket(page, item, quantity);
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
}));

app.get('/search', asyncHandler(async (req, res) => {
  const query = req.query.q || req.query.query;
  if (!query) return res.status(400).json({ error: 'q or query required' });
  const page = await getPage();
  const result = await ocado.searchProducts(page, query);
  res.json({ success: true, query, result, results: result.products, count: result.products.length, timestamp: new Date().toISOString() });
}));

app.post('/cart/add-items', asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array required' });
  const page = await getPage();
  const result = await ocado.addCartItems(page, items);
  res.json({ success: true, result, timestamp: new Date().toISOString() });
}));

app.post('/cart/remove-items', asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array required' });
  const page = await getPage();
  const result = await ocado.removeCartItems(page, items);
  res.json({ success: true, result, timestamp: new Date().toISOString() });
}));

app.get('/basket', asyncHandler(async (req, res) => {
  const page = await getPage();
  const basket = await ocado.getBasketContents(page);
  res.json({ success: true, items: basket.items, summary: basket.summary, count: basket.items.length, timestamp: new Date().toISOString() });
}));

app.post('/basket/remove', asyncHandler(async (req, res) => {
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: 'item required' });
  const page = await getPage();
  const result = await ocado.removeFromBasket(page, item);
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
}));

app.get('/delivery/slots', asyncHandler(async (req, res) => {
  const page = await getPage();
  const result = await ocado.getDeliverySlots(page);
  res.json({ success: true, slots: result.slots, count: result.slots.length, timestamp: new Date().toISOString() });
}));

app.get('/delivery/slot', asyncHandler(async (req, res) => {
  const page = await getPage();
  const selected = await ocado.getSelectedDeliverySlot(page);
  res.json({ success: true, selected, timestamp: new Date().toISOString() });
}));

app.post('/delivery/slot/select', asyncHandler(async (req, res) => {
  const { slotId } = req.body;
  if (!slotId) return res.status(400).json({ error: 'slotId required' });
  const page = await getPage();
  const result = await ocado.selectDeliverySlot(page, slotId);
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
}));

app.get('/orders/upcoming', asyncHandler(async (req, res) => {
  const page = await getPage();
  const result = await ocado.getUpcomingOrders(page);
  res.json({ success: true, orders: result.orders, count: result.orders.length, timestamp: new Date().toISOString() });
}));

app.use((err, req, res) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

process.on('SIGTERM', async () => {
  if (currentPage) await currentPage.close().catch(console.error);
  if (ocado) await ocado.close().catch(console.error);
  process.exit(0);
});

app.listen(PORT, () => console.log(`Ocado API on port ${PORT}`));
