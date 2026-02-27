/**
 * MCP route factory: returns an Express router that serves the Ocado MCP endpoint. Mount at /mcp.
 * When run directly, starts a standalone MCP server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import express from 'express';
import * as z from 'zod/v4';
import { Automation } from './automation.js';
import { createLogger } from './logger.js';

const log = createLogger('mcp-server');

/**
 * Create an Express router that serves the MCP endpoint. Mount at /mcp for POST /mcp.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createMcpRouter(automation) {
  const router = express.Router();

  function getMcpServer() {
    const server = new McpServer(
      {
        name: 'ocado-shopping',
        version: '1.0.0',
        instructions: 'Tools for managing Ocado grocery shopping: search products, manage cart, delivery slots, and upcoming orders. Use search_products to find product IDs before adding to cart.',
      },
      { capabilities: { logging: {} } }
    );

    server.registerTool(
      'search_products',
      {
        title: 'Search products',
        description: 'Search Ocado for products by keyword. Returns a list of products with id, name, price. Use the product id when adding to cart.',
        inputSchema: {
          query: z.string().describe('Search term (e.g. "milk", "bread")'),
        },
      },
      async ({ query }) => {
        const result = await automation.searchProducts(query);
        const products = result.products || [];
        const summary = products.slice(0, 20).map((p) => `${p.name} (id: ${p.id}, ${p.unitPrice || p.price})`).join('\n');
        return {
          content: [{ type: 'text', text: products.length ? summary : 'No products found.' }],
        };
      }
    );

    server.registerTool(
      'get_cart',
      {
        title: 'Get cart',
        description: 'Get the current Ocado basket contents and selected delivery slot if any.',
        inputSchema: {},
      },
      async () => {
        const cart = await automation.getCartContents();
        const items = (cart.items || []).map((i) => `${i.name || i.productId}: qty ${i.quantity ?? 1}`).join('\n');
        const slot = cart.deliverySlot ? (cart.deliverySlot.startTime || cart.deliverySlot.slotId || 'selected') : 'none';
        const text = `Items:\n${items || '(empty)'}\nDelivery slot: ${slot}`;
        return { content: [{ type: 'text', text }] };
      }
    );

    server.registerTool(
      'add_to_cart',
      {
        title: 'Add to cart',
        description: 'Add one or more products to the Ocado cart. Get product IDs from search_products first.',
        inputSchema: {
          items: z.array(z.object({
            productId: z.string().describe('Product ID from search'),
            quantity: z.number().min(1).default(1).describe('Quantity to add'),
          })).describe('List of { productId, quantity }'),
        },
      },
      async ({ items }) => {
        const result = await automation.addCartItems(items);
        const count = (result.items || []).length;
        return {
          content: [{ type: 'text', text: `Added ${count} line(s) to cart.` }],
        };
      }
    );

    server.registerTool(
      'remove_from_cart',
      {
        title: 'Remove from cart',
        description: 'Remove products from the cart by product ID. Use get_cart to see current items and IDs.',
        inputSchema: {
          productIds: z.array(z.string()).describe('Product IDs to remove'),
        },
      },
      async ({ productIds }) => {
        const items = productIds.map((id) => ({ productId: id, quantity: 0 }));
        await automation.removeCartItems(items);
        return {
          content: [{ type: 'text', text: `Removed ${productIds.length} product(s) from cart.` }],
        };
      }
    );

    server.registerTool(
      'get_delivery_slots',
      {
        title: 'Get delivery slots',
        description: 'List available Ocado delivery slots. Returns slot IDs and times; use select_delivery_slot with a slotId to book.',
        inputSchema: {},
      },
      async () => {
        const { slots } = await automation.getAvailableDeliverySlots();
        const flat = flattenSlots(slots || []);
        const lines = flat.slice(0, 15).map((s) => `${s.slotId}: ${s.startTime} – ${s.endTime}`).join('\n');
        return {
          content: [{ type: 'text', text: lines || 'No slots returned. Ensure cart has a delivery address.' }],
        };
      }
    );

    server.registerTool(
      'get_selected_delivery_slot',
      {
        title: 'Get selected delivery slot',
        description: 'Get the currently selected/booked delivery slot for the cart.',
        inputSchema: {},
      },
      async () => {
        const slot = await automation.getSelectedDeliverySlot();
        if (!slot) {
          return { content: [{ type: 'text', text: 'No delivery slot selected.' }] };
        }
        const text = `${slot.slotId || slot.id || 'unknown'}: ${slot.startTime || ''} – ${slot.endTime || ''}`;
        return { content: [{ type: 'text', text }] };
      }
    );

    server.registerTool(
      'select_delivery_slot',
      {
        title: 'Select delivery slot',
        description: 'Book a delivery slot. Use get_delivery_slots to see available slotIds.',
        inputSchema: {
          slotId: z.string().describe('Slot ID from get_delivery_slots'),
        },
      },
      async ({ slotId }) => {
        const result = await automation.selectDeliverySlot(slotId);
        const text = result.success ? `Booked slot ${slotId}.` : `Failed to book slot: ${JSON.stringify(result)}`;
        return { content: [{ type: 'text', text }] };
      }
    );

    server.registerTool(
      'get_upcoming_orders',
      {
        title: 'Get upcoming orders',
        description: 'List upcoming Ocado orders with status and delivery window.',
        inputSchema: {},
      },
      async () => {
        const { orders } = await automation.getUpcomingOrders();
        const lines = (orders || []).map((o) => `${o.orderId}: ${o.status} – ${o.slot?.start || 'no slot'}`).join('\n');
        return {
          content: [{ type: 'text', text: lines || 'No upcoming orders.' }],
        };
      }
    );

    return server;
  }

  router.post('/', async (req, res) => {
    const server = getMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      log('MCP request error: %s', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message || 'Internal server error' },
          id: null,
        });
      }
    }
  });

  router.get('/', (req, res) => {
    res.writeHead(405, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      })
    );
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
    ...(process.env.MCP_ALLOWED_HOSTS && { allowedHosts: process.env.MCP_ALLOWED_HOSTS.split(',') }),
  });
  app.use('/mcp', createMcpRouter(automation));
  const PORT = Number(process.env.MCP_PORT) || 3100;
  const HOST = process.env.MCP_HOST || '0.0.0.0';
  process.on('SIGTERM', async () => {
    await automation.close().catch(console.error);
    process.exit(0);
  });
  app.listen(PORT, HOST, () => log('Ocado MCP server on %s:%s (POST /mcp)', HOST, PORT));
}
