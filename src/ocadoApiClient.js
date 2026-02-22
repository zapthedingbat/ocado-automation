import crypto from 'crypto';

export class OcadoApiClient {
  constructor({ baseUrl = 'https://www.ocado.com', cookieHeader, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.cookieHeader = cookieHeader;
    this.fetchImpl = fetchImpl;
  }

  buildHeaders() {
    const headers = {
      accept: 'application/json; charset=utf-8',
      'client-route-id': crypto.randomUUID(),
      'page-view-id': crypto.randomUUID(),
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/147.0',
      'accept-language': 'en-US,en;q=0.9',
      'ecom-request-source': 'web',
      'ecom-request-source-version': 'api'
    };
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    return headers;
  }

  async get(path) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.buildHeaders()
    });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async post(path, data, includeCsrf = true) {
    const csrfToken = crypto.randomUUID();
    const headers = {
      ...this.buildHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'x-csrf-token': csrfToken
    };
    const payload = includeCsrf && data
      ? (Array.isArray(data) ? data.map(d => ({ ...d, csrfToken })) : { ...data, csrfToken })
      : data;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async getCart() {
    const json = await this.get('/api/cart/v1/carts/active');
    return { items: json.items, summary: json.totals, raw: json };
  }

  async addItemsToCart(items) {
    const payload = items.map(item => ({
      productId: item.productId,
      quantity: item.quantity ?? 1,
      meta: { itemListName: 'api', favorite: false, pageViewId: crypto.randomUUID(), pageType: 'API' }
    }));
    return this.post('/api/cart/v1/carts/active/add-items', payload);
  }

  async removeItemsFromCart(items) {
    const payload = items.map(item => ({ productId: item.productId, quantity: item.quantity ?? 1 }));
    return this.post('/api/cart/v1/carts/active/remove-items', payload);
  }

  async searchProducts(query) {
    const qs = new URLSearchParams({ includeAdditionalPageInfo: 'true', maxPageSize: 20, maxProductsToDecorate: 0, q: query, tag: 'web' });
    return this.get(`/api/webproductpagews/v6/product-pages/search?${qs}`);
  }

  async getDeliverySlots() {
    const { raw } = await this.getCart();
    const payload = {
      shippingGroupType: 'default home delivery',
      deliveryDestinationId: raw.deliveryDestinationId,
      regionId: raw.regionId,
      analyticsData: { sessionId: crypto.randomUUID(), viewingLocation: 'SLOT_BOOKING_PAGE', platform: 'WEB', pageViewId: crypto.randomUUID() }
    };
    return this.post('/api/ecomslots/v1/slots', payload);
  }

  async selectDeliverySlot(slotId) {
    const { raw } = await this.getCart();
    return this.post('/api/ecomslots/v1/slots/reservation', {
      regionId: raw.regionId,
      slotId,
      deliveryDestinationId: raw.deliveryDestinationId
    }, false);
  }
}
