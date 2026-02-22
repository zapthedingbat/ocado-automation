import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { LoginPage } from './pages/LoginPage.js';
import { OcadoApiClient } from './ocadoApiClient.js';

class ShoppingSession {
  constructor(config = {}) {
    this._config = {
      headless: config.headless !== false,
      launchTimeout: config.launchTimeout ?? 30000,
      navigationTimeout: config.navigationTimeout ?? 60000,
      storageStatePath: config.storageStatePath || process.env.OCADO_STORAGE_STATE_PATH || 'ocado-storage.json'
    };
    this._browser = null;
    this._context = null;
  }

  async _initBrowser() {
    if (this._browser) return;
    this._browser = await chromium.launch({ headless: this._config.headless, timeout: this._config.launchTimeout });
    const storagePath = this._config.storageStatePath;
    try {
      await fs.access(storagePath);
    } catch {
      await fs.mkdir(path.dirname(storagePath), { recursive: true }).catch(() => {});
      await fs.writeFile(storagePath, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
    }
    this._context = await this._browser.newContext({ storageState: storagePath });
  }

  async close() {
    if (this._context) {
      await this._context.storageState({ path: this._config.storageStatePath });
      this._context = null;
    }
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
    }
  }

  async ensureAuthenticated() {
    if (!this._isAuthenticated) await this._login();
  }

  async _login(email, password) {
    const credEmail = email || process.env.OCADO_EMAIL;
    const credPassword = password || process.env.OCADO_PASSWORD;
    if (!credEmail || !credPassword) throw new Error('OCADO_EMAIL and OCADO_PASSWORD required');
    await this._initBrowser();
    const page = await this._context.newPage();
    page.setDefaultNavigationTimeout(this._config.navigationTimeout);
    page.setDefaultTimeout(this._config.navigationTimeout);
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(credEmail, credPassword);
    this._isAuthenticated = true;
  }

  async getApiClient(page) {
    await this.ensureAuthenticated();
    const ctx = page?.context?.() ?? this._context;
    const cookies = await ctx.cookies('https://www.ocado.com');
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return new OcadoApiClient({ cookieHeader });
  }

  extractProducts(result) {
    const products = result.productPages?.[0]?.products ?? result.results?.products ?? result.products ?? [];
    return Array.isArray(products) ? products : [];
  }

  extractSlots(result) {
    if (result.slotGroups?.length) return result.slotGroups.flatMap(g => g.slots ?? []);
    if (result.days?.length) return result.days.flatMap(d => d.slots ?? []);
    return result.slots ?? result.availableSlots ?? [];
  }

  async searchProducts(page, query) {
    const api = await this.getApiClient(page);
    const result = await api.searchProducts(query);
    const products = this.extractProducts(result).map(p => ({ productId: p.productId || p.id, name: p.name }));
    return { products, raw: result };
  }

  async addCartItems(page, items) {
    const api = await this.getApiClient(page);
    await api.addItemsToCart(items);
    return { success: true, items };
  }

  async removeCartItems(page, items) {
    const api = await this.getApiClient(page);
    await api.removeItemsFromCart(items);
    return { success: true, items };
  }

  async getBasketContents(page) {
    const api = await this.getApiClient(page);
    const cart = await api.getCart();
    return { items: cart.items, summary: cart.summary, raw: cart.raw };
  }

  async getDeliverySlots(page) {
    const api = await this.getApiClient(page);
    const result = await api.getDeliverySlots();
    const slots = this.extractSlots(result).map(s => ({
      slotId: s.slotId ?? s.id,
      start: s.startTime ?? s.start,
      end: s.endTime ?? s.end,
      price: s.price
    }));
    return { slots, raw: result };
  }

  async getSelectedDeliverySlot(page) {
    const api = await this.getApiClient(page);
    const cart = await api.getCart();
    const slot = cart.raw.activeCheckoutGroup?.deliverySlot ?? cart.raw.defaultCheckoutGroup?.deliverySlot ?? cart.raw.deliverySlot;
    return {
      slot: slot ? { slotId: slot.slotId ?? slot.id, start: slot.startTime, end: slot.endTime } : null,
      cartId: cart.raw.cartId,
      regionId: cart.raw.regionId,
      deliveryDestinationId: cart.raw.deliveryDestinationId
    };
  }

  async selectDeliverySlot(page, slotId) {
    const api = await this.getApiClient(page);
    await api.selectDeliverySlot(slotId);
    return { success: true, slotId };
  }

  async addItemToBasket(page, item, quantity = 1) {
    const { products } = await this.searchProducts(page, item);
    const productId = products[0]?.productId;
    if (!productId) throw new Error(`Product not found: ${item}`);
    return this.addCartItems(page, [{ productId, quantity }]);
  }

  async removeFromBasket(page, item) {
    const { items } = await this.getBasketContents(page);
    const name = (item || '').toLowerCase();
    const match = items.find(i => (i.product?.name ?? i.name ?? '').toLowerCase().includes(name));
    if (!match) throw new Error(`Item not in basket: ${item}`);
    return this.removeCartItems(page, [{ productId: match.productId, quantity: match.quantity ?? 1 }]);
  }

  async getUpcomingOrders(page) {
    await this.ensureAuthenticated();
    const authPage = page ?? await this._context.newPage();
    await authPage.goto('https://www.ocado.com/orders', { waitUntil: 'domcontentloaded' });
    const orderEntities = await authPage.waitForFunction(() => {
      const state = window.__INITIAL_STATE__;
      const entities = state?.data?.orders?.orderEntities ?? state?.orders?.orderEntities;
      if (!entities) return null;
      return Object.fromEntries(Object.entries(entities).filter(([k]) => k !== 'lastUpdated'));
    }, { timeout: 15000 }).then(h => h.jsonValue());
    const orders = Object.values(orderEntities ?? {}).filter(e => e?.orderId).map(o => ({
      orderId: o.orderId,
      status: o.status,
      slot: o.dates ? { start: o.dates.deliveryStartDate, end: o.dates.deliveryEndDate } : null,
      address: o.address
    }));
    return { orders };
  }
}

export const OcadoAutomation = ShoppingSession;
