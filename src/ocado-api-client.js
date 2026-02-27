import crypto from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('api');

export class OcadoApiClient {
  constructor(options = {}) {
    this._baseUrl = "https://www.ocado.com";
    this._fetch = options.fetch ?? fetch;
    this._getCsrfToken = options.getCsrfToken;
  }

  async get(path) {
    return await this._fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
    });
  }

  async post(path, data) {
    const headers = {
      "Accept": "application/json; charset=utf-8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-GPC": "1",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    };
    headers['content-type'] = 'application/json; charset=utf-8';
    const token = await this._getCsrfToken();
    if (token) headers['X-CSRF-TOKEN'] = token;
    return await this._fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
  }
  
  async isAuthenticated() {
    const res = await this.get('/api/customer/v3/customers/current');
    const status = res.status();
    const json = await res.json();
    log('isAuthenticated status=%d %O', status, json);
    return status === 200;
  }
  
  async getCart() {
    const res = await this.get('/api/cart/v1/carts/active');
    const json = await res.json();
    log('getCart %O', json);
    const deliverySlot = json.activeCheckoutGroup?.delivery ?? json.defaultCheckoutGroup?.delivery ?? null;
    return {
      id: json.cartId,
      deliverySlot,
      items: json.items,
      summary: json.totals,
      regionId: json.regionId,
      deliveryDestinationId: json.deliveryDestinationId
    };
  }

  async addItemsToCart(items) {
    return await this.applyProductQuantityToCart(items);
  }

  async removeItemsFromCart(items) {
    return await this.applyProductQuantityToCart(items);
  }

  async applyProductQuantityToCart(items) {

    const payload = items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
    }));

    const res = await this.post('/api/cart/v1/carts/active/apply-quantity', payload);
    const json = await res.json();
    const result = json.basketUpdateResult;
    return {
      items: result?.itemGroups?.flatMap(ig => ig.items) ?? [],
      totals: json.totals ?? null,
    };
  }

  async searchProducts(query) {
    const qs = new URLSearchParams({
      includeAdditionalPageInfo: 'false',
      maxPageSize: 300,
      maxProductsToDecorate: 50,
      q: query,
      tag: 'web'
    });
    const res = await this.get(`/api/webproductpagews/v6/product-pages/search?${qs}`);
    const json = await res.json();
    log('searchProducts q=%s hits=%d', query, json.productGroups?.length ?? 0);

    // extract products from json
    // ignore 'featured' groups
    const productGroups = json.productGroups.filter(pg => pg.type !== 'featured');
    const products = productGroups.flatMap(pg => pg.decoratedProducts).map(dp => ({
      id: dp.productId,
      retailerProductId: dp.retailerProductId,
      name: dp.name,
      brand: dp.brand,
      price: dp.price.amount,
      unitPrice: `${dp.unitPrice.price.amount}/${dp.unitPrice.unit}`,
      packSizeDescription: dp.packSizeDescription,
      available: dp.available,
      categoryPath: dp.categoryPath.join(' / '),
    }))
    return { products };
  }
  
  async getProductDetails(retailerProductId) {
    const qs = new URLSearchParams({
      retailerProductId,
    });
    const res = await this.get(`/api/webproductpagews/v5/products/bop?${qs}`);
    const json = await res.json();
    log('getProductDetails retailerProductId=%s', retailerProductId);
    const description = json.bopData.detailedDescription;
    const ingredients = json.bopData.fields.find(f => f.title === 'ingredients').content;
    const nutritionalDataTable = json.bopData.fields.find(f => f.title === 'nutritionalData').content;
    const nutritionalDataTableBody = nutritionalDataTable.match(/<table class="nutrition"><tbody>(.*?)<\/tbody><\/table>/s)[1];
    const nutritionalDataRows = nutritionalDataTableBody.split('<tr>');
    const nutritionalDataHeaders = nutritionalDataRows[0].split('<th>');
    const nutritionalDataValues = nutritionalDataRows[1].split('<td>');
    const nutritionalData = nutritionalDataHeaders.map((header, index) => ({
      header,
      value: nutritionalDataValues[index]
    }));

    return {
      description, 
      ingredients,
      nutritionalData
    };
  }

  async getDeliverySlots() {
    const cart = await this.getCart();
    const payload = {
      shippingGroupType: 'default home delivery',
      deliveryDestinationId: cart.deliveryDestinationId,
      regionId: cart.regionId,
      analyticsData: { sessionId: crypto.randomUUID(), viewingLocation: 'SLOT_BOOKING_PAGE', platform: 'WEB', pageViewId: crypto.randomUUID() }
    };
    const res = await this.post('/api/ecomslots/v1/slots', payload);
    const json = await res.json();
    log('getDeliverySlots %O', json);

    const slots = json.slotWindows ?? json.slots ?? json.deliverySlots ?? [];
    return { slots };
  }

  async selectDeliverySlot(slotId) {
    const cart = await this.getCart();
    const payload = {
      regionId: cart.regionId,
      slotId,
      deliveryDestinationId: cart.deliveryDestinationId
    };
    const res = await this.post('/api/ecomslots/v1/slots/reservation', payload);
    const json = await res.json();
    const status = res.status();
    const statusText = res.statusText();

    if (status !== 200) {
      log('selectDeliverySlot failed status=%d %s', status, statusText);
    } else {
      log('selectDeliverySlot success slotId=%s', slotId);
    }
    log('selectDeliverySlot response %O', json);

    return {
      success: status === 200,
      slotId
    };
  }

  async getSelectedDeliverySlot() {
    const cart = await this.getCart();
    return cart.deliverySlot ?? null;
  }
}
