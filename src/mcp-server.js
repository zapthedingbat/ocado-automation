/**
 * MCP route factory: returns an Express router that serves the Ocado MCP endpoint. Mount at /mcp.
 * Supports Streamable HTTP (POST/GET/DELETE /mcp) and HTTP+SSE (GET /mcp/sse, POST /mcp/messages) for Home Assistant.
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as z from 'zod/v4';
import { Automation } from './automation.js';
import { requireApiKey } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('mcp-server');

/** 
 * Send a JSON error response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {number} code
 * @param {string} message 
 * */
function sendJsonError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Create an Express router that serves the MCP endpoint. Mount at /mcp.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createMcpRouter(automation) {
  const router = express.Router();

  /** @type {Map<string, SSEServerTransport>} */
  const sseTransports = new Map();

  /** @type {Map<string, StreamableHTTPServerTransport>} */
  const streamableTransports = new Map();

  function getMcpServer() {
    const server = new McpServer(
      {
        name: 'ocado-shopping',
        version: '1.0.0',
        instructions: 'Tools for managing Ocado grocery shopping: search products, manage cart, delivery slots, and upcoming orders. Use search_products to find product IDs before adding to cart.',
      },
      { capabilities: { logging: {} } }
    );

    const tools = [
      {
        name: 'search_products',
        title: 'Search products',
        description: 'Search Ocado for products by keyword. Returns a list of products with id, name, price. Use the product id when adding to cart.',
        inputSchema: { query: z.string().describe('Search term (e.g. "milk", "bread")') },
        handler: async ({ query }) => {
          const result = await automation.searchProducts(query);
          const products = result.products || [];
          const summary = products.slice(0, 20).map((p) => `${p.name} (id: ${p.id}, ${p.unitPrice || p.price})`).join('\n');
          return { content: [{ type: 'text', text: products.length ? summary : 'No products found.' }] };
        },
      },
      {
        name: 'get_cart',
        title: 'Get cart',
        description: 'Get the current Ocado basket contents and selected delivery slot if any.',
        inputSchema: {},
        handler: async () => {
          const cart = await automation.getCartContents();
          const items = (cart.items || []).map((i) => `${i.name || i.productId}: qty ${i.quantity ?? 1}`).join('\n');
          const slot = cart.deliverySlot ? (cart.deliverySlot.startTime || cart.deliverySlot.slotId || 'selected') : 'none';
          return { content: [{ type: 'text', text: `Items:\n${items || '(empty)'}\nDelivery slot: ${slot}` }] };
        },
      },
      {
        name: 'add_to_cart',
        title: 'Add to cart',
        description: 'Add one or more products to the Ocado cart. Get product IDs from search_products first.',
        inputSchema: {
          items: z.array(z.object({
            productId: z.string().describe('Product ID from search'),
            quantity: z.number().min(1).default(1).describe('Quantity to add'),
          })).describe('List of { productId, quantity }'),
        },
        handler: async ({ items }) => {
          const result = await automation.addCartItems(items);
          return { content: [{ type: 'text', text: `Added ${(result.items || []).length} line(s) to cart.` }] };
        },
      },
      {
        name: 'remove_from_cart',
        title: 'Remove from cart',
        description: 'Remove products from the cart by product ID. Use get_cart to see current items and IDs.',
        inputSchema: { productIds: z.array(z.string()).describe('Product IDs to remove') },
        handler: async ({ productIds }) => {
          const items = productIds.map((id) => ({ productId: id, quantity: 0 }));
          await automation.removeCartItems(items);
          return { content: [{ type: 'text', text: `Removed ${productIds.length} product(s) from cart.` }] };
        },
      },
      {
        name: 'get_delivery_slots',
        title: 'Get delivery slots',
        description: 'List available Ocado delivery slots. Returns slot IDs and times; use select_delivery_slot with a slotId to book.',
        inputSchema: {},
        handler: async () => {
          const { slots } = await automation.getAvailableDeliverySlots();
          const flat = flattenSlots(slots || []);
          const lines = flat.slice(0, 15).map((s) => `${s.slotId}: ${s.startTime} – ${s.endTime}`).join('\n');
          return { content: [{ type: 'text', text: lines || 'No slots returned. Ensure cart has a delivery address.' }] };
        },
      },
      {
        name: 'get_selected_delivery_slot',
        title: 'Get selected delivery slot',
        description: 'Get the currently selected/booked delivery slot for the cart.',
        inputSchema: {},
        handler: async () => {
          const slot = await automation.getSelectedDeliverySlot();
          if (!slot) return { content: [{ type: 'text', text: 'No delivery slot selected.' }] };
          const text = `${slot.slotId || slot.id || 'unknown'}: ${slot.startTime || ''} – ${slot.endTime || ''}`;
          return { content: [{ type: 'text', text }] };
        },
      },
      {
        name: 'select_delivery_slot',
        title: 'Select delivery slot',
        description: 'Book a delivery slot. Use get_delivery_slots to see available slotIds.',
        inputSchema: { slotId: z.string().describe('Slot ID from get_delivery_slots') },
        handler: async ({ slotId }) => {
          const result = await automation.selectDeliverySlot(slotId);
          const text = result.success ? `Booked slot ${slotId}.` : `Failed to book slot: ${JSON.stringify(result)}`;
          return { content: [{ type: 'text', text }] };
        },
      },
      {
        name: 'get_upcoming_orders',
        title: 'Get upcoming orders',
        description: 'List upcoming Ocado orders with status and delivery window.',
        inputSchema: {},
        handler: async () => {
          const { orders } = await automation.getUpcomingOrders();
          const lines = (orders || []).map((o) => `${o.orderId}: ${o.status} – ${o.slot?.start || 'no slot'}`).join('\n');
          return { content: [{ type: 'text', text: lines || 'No upcoming orders.' }] };
        },
      },
    ];

    for (const t of tools) {
      server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema }, t.handler);
    }
    return server;
  }

  // Streamable HTTP: POST/GET/DELETE /
  router.all('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
    try {
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId) {
          sendJsonError(res, 400, -32000, 'Mcp-Session-Id required for GET/DELETE.');
          return;
        }
        if (!transport) {
          sendJsonError(res, 404, -32000, 'Session not found.');
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === 'POST') {
        if (transport) {
          await transport.handleRequest(req, res, req.body);
          return;
        }
        if (sessionId) {
          sendJsonError(res, 400, -32000, 'Session uses different transport (use /mcp/messages for SSE).');
          return;
        }
        if (!isInitializeRequest(req.body)) {
          sendJsonError(res, 400, -32000, 'No valid session ID or initialize request.');
          return;
        }
        const server = getMcpServer();
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid && streamableTransports.get(sid) === newTransport) {
            streamableTransports.delete(sid);
            log('Streamable HTTP session closed: %s', sid);
          }
          newTransport.onclose = undefined;
          server.close();
        };
        await server.connect(newTransport);
        await newTransport.handleRequest(req, res, req.body);
        const sid = newTransport.sessionId;
        if (sid) streamableTransports.set(sid, newTransport);
        return;
      }
      sendJsonError(res, 405, -32000, 'Method not allowed.');
    } catch (err) {
      log('MCP request error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  router.get('/sse', async (req, res) => {
    try {
      const endpoint = `${req.baseUrl || '/mcp'}/messages`;
      const transport = new SSEServerTransport(endpoint, res);
      sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => sseTransports.delete(transport.sessionId);
      await getMcpServer().connect(transport);
    } catch (err) {
      log('SSE session start error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  router.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
      sendJsonError(res, 400, -32000, 'Missing sessionId parameter');
      return;
    }
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      log('Session not found for sessionId: %s', sessionId);
      sendJsonError(res, 404, -32000, 'Session not found');
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      log('MCP SSE messages error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  return router;
}

function flattenSlots(slots) {
  const out = [];
  for (const item of slots) {
    if (item.slotId && (item.startTime ?? item.start)) {
      out.push({
        slotId: item.slotId,
        startTime: item.startTime ?? item.start,
        endTime: item.endTime ?? item.end,
      });
    } else if (Array.isArray(item.slots)) {
      out.push(...flattenSlots(item.slots));
    } else if (Array.isArray(item)) {
      out.push(...flattenSlots(item));
    }
  }
  return out;
}

// Run standalone when executed directly (e.g. npm run mcp-server)
const isMain = process.argv[1]?.includes('mcp-server.js');
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
  const app = createMcpExpressApp({
    host: process.env.MCP_HOST || '0.0.0.0',
    allowedHosts: process.env.MCP_ALLOWED_HOSTS
      ? process.env.MCP_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
      : ['localhost', '127.0.0.1', '[::1]'],
  });
  app.use(requireApiKey);
  app.use('/mcp', createMcpRouter(automation));
  const PORT = Number(process.env.MCP_PORT) || 3100;
  const HOST = process.env.MCP_HOST || '0.0.0.0';
  process.on('SIGTERM', async () => {
    await automation.close().catch(console.error);
    process.exit(0);
  });
  app.listen(PORT, HOST, () => log('Ocado MCP server on %s:%s (Streamable HTTP: POST /mcp; HTTP+SSE: GET /mcp/sse, POST /mcp/messages)', HOST, PORT));
}
