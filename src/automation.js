import { OrdersPage } from './pages/OrdersPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OcadoPage } from './pages/OcadoPage.js';
import { OcadoApiClient } from './ocado-api-client.js';
import { createLogger } from './logger.js';
import { chromium } from 'playwright';
import { access } from 'fs/promises';

const log = createLogger('automation');

/* 
This class is responsible for coordinating the ocado API and browser session. It hides the complexity of browser automation,
authentication, API calls and page interactions. And exposes simple methods for the server to call.
*/

const DEFAULT_HEARTBEAT_MS = 60 * 60 * 1000;

export class Automation {
  constructor(config = {}) {
    this._browser = null;
    this._context = null;
    this._csrfToken = null;
    this._devtools = config.devtools === true;
    this._email = config.email;
    this._headless = config.headless === false ? false : true;
    this._heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this._heartbeatTimer = null;
    this._password = config.password;
    this._proxy = config.proxy ?? (process.env.OCADO_PROXY || null);
    this._storageStatePath = config.storageStatePath ?? 'ocado-storage.json';
    this._apiClient = new OcadoApiClient({
      fetch: this._contextFetch.bind(this),
      getCsrfToken: this.getCsrfToken.bind(this),
    });
  }

  // Send requests using playwright's context.request.fetch()
  async _contextFetch(url, options = {}){
    log('Fetching %O', [url, options]);
    const context = await this._getContext();
    const opts = { ...options };
    if (opts.body !== undefined) {
      opts.data = opts.body;
      delete opts.body;
    }
    return await context.request.fetch(url, opts);
  }

  // Send requests using the visible page's fetch()
  async _evaluateFetch(url, options = {}){
    log('Fetching %O', [url, options]);
    const context = await this._getContext();
    const pages = context.pages();
    const page = pages[0];
    const { method = 'GET', headers = {}, body } = options;
    const result = await page.evaluate(async ({ url: u, method: m, headers: h, body: b }) => {
      const res = await fetch(u, { method: m, headers: h, body: b });
      const text = await res.text();
      return { status: res.status, statusText: res.statusText, body: text };
    }, { url, method, headers, body });
    return {
      status: () => result.status,
      statusText: () => result.statusText,
      text: () => Promise.resolve(result.body),
      json: () => Promise.resolve(result.body ? JSON.parse(result.body) : null),
    };
  }

  async _getContext(){
    if (!this._browser){
      log('Launching browser (%s)', this._headless ? 'headless' : 'non-headless');
      this._browser = await chromium.launch({
        headless: this._headless,
        devtools: this._devtools,
      });
    }
    if (!this._context) {
      const contextOptions = {};
      if (this._proxy) {
        contextOptions.proxy = { server: this._proxy };
        contextOptions.ignoreHTTPSErrors = true;
        log('Using proxy %s (ignoreHTTPSErrors=true for HTTPS)', this._proxy);
      }
      try {
        await access(this._storageStatePath);
        this._context = await this._browser.newContext({ storageState: this._storageStatePath, ...contextOptions });
      } catch (error) {
        log('Storage state not found (%s), using fresh context', this._storageStatePath);
        this._context = await this._browser.newContext(contextOptions);
      }
    }
    return this._context;
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) return;
    log('Heartbeat started (interval %d min)', this._heartbeatIntervalMs / 60000);
    this._heartbeatTimer = setInterval(() => this._heartbeat(), this._heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
      log('Heartbeat stopped');
    }
  }

  async close() {
    this._stopHeartbeat();
    if (this._context) {
      await this._context.close().catch(() => {});
      this._context = null;
    }
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }

  async _heartbeat() {
    try {
      const res = await this._evaluateFetch('https://www.ocado.com/api/customer/v3/customers/current');
      const status = res.status();
      if (status === 200) {
        await this._saveBrowserState();
        log('session refreshed');
      } else {
        log('session not valid (status=%d)', status);
        this._stopHeartbeat();
      }
    } catch (err) {
      log('Heartbeat failed: %s', err.message);
    }
  }

  async _createPage() {
    const context = await this._getContext();
    const page = await context.newPage();
    return page;
  }

  // Save browser state so that future browsers can be spun up with the same state
  async _saveBrowserState() {
    await this._context.storageState({ path: this._storageStatePath });
    log('Browser state saved to %s', this._storageStatePath);
  }

  async isAuthenticated() {
    const result = await this._apiClient.isAuthenticated();
    if(result){
      this._startHeartbeat();
    } else {
      this._stopHeartbeat();
    }
    return result;
  }

  async login() {
    log('Starting login flow');
    const page = await this._createPage();
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(this._email, this._password);
    await this._saveBrowserState();
    log('Login completed successfully');
    
    // Wait for navigation to the next page to complete
    await page.waitForURL('https://www.ocado.com/**', { timeout: 5000 });
    
    // Update the stored CSRF token
    await this._updateCsrfToken();

    // Start heartbeat after login to ensure session stays valid
    this._startHeartbeat();
  }

  // Forcibly update the stored CSRF
  async _updateCsrfToken() {
    this._csrfToken = null;
    await this.getCsrfToken();
  }

  // Get the CSRF token from the browser context or page
  async getCsrfToken() {
    if (this._csrfToken) return this._csrfToken;
    const page = await this._createPage();
    if(!page.url().startsWith('https://www.ocado.com/')) {
      log('Navigating to home page to get CSRF token');
      await page.goto('https://www.ocado.com/');
    }
    const ocadoPage = new OcadoPage(page);
    const token = await ocadoPage.getCsrfToken();
    this._csrfToken = token;
    return token;
  }

  async ensureAuthenticated() {
    const authenticated = await this.isAuthenticated();
    if (!authenticated) {
      await this.login();
    }
  }

  async searchProducts(query) {
    return await this._apiClient.searchProducts(query);
  }

  async addCartItems(items) {
    return await this._apiClient.applyProductQuantityToCart(items);
  }

  async removeCartItems(items) {
    return await this._apiClient.removeItemsFromCart(items);
  }

  async getCartContents() {
    return await this._apiClient.getCart();
  }

  async getAvailableDeliverySlots() {
    return await this._apiClient.getDeliverySlots();
  }

  async selectDeliverySlot(slotId) {
    return await this._apiClient.selectDeliverySlot(slotId);
  }

  async getSelectedDeliverySlot() {
    return await this._apiClient.getSelectedDeliverySlot();
  }

  async getUpcomingOrders() {
    log('getUpcomingOrders: ensuring authenticated');
    await this.ensureAuthenticated();
    const page = await this._createPage();
    const ordersPage = new OrdersPage(page);
    await ordersPage.goto();
    log('Extracting upcoming orders from orders page');
    return await ordersPage.getUpcomingOrders();
  }
}
