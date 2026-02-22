import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.OCADO_API_KEY;

if (!API_KEY) {
  throw new Error('OCADO_API_KEY is required in environment variables.');
}

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(json)}`);
  }

  return json;
};

const main = async () => {
  const query = 'bread';
  console.log(`Searching for: ${query}`);
  const apiSearch = await requestJson(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  const products = apiSearch?.result?.products || apiSearch?.results || [];
  const productId = products[0]?.productId;

  if (!productId) {
    throw new Error('No products found for search.');
  }

  console.log(`Using productId: ${productId}`);

  console.log('Adding to cart...');
  await requestJson(`${API_BASE}/cart/add-items`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] })
  });

  console.log('Checking basket contents...');
  const basketAfterAdd = await requestJson(`${API_BASE}/basket`);
  const addedInBasket = basketAfterAdd.items?.some(item => item.productId === productId);

  if (!addedInBasket) {
    throw new Error('Product was not found in basket after adding.');
  }

  console.log('Removing from cart...');
  await requestJson(`${API_BASE}/cart/remove-items`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] })
  });

  console.log('Checking basket contents after removal...');
  const basketAfterRemove = await requestJson(`${API_BASE}/basket`);
  const removedFromBasket = !basketAfterRemove.items?.some(item => item.productId === productId);

  if (!removedFromBasket) {
    throw new Error('Product was still in basket after removal.');
  }

  console.log('Fetching delivery slots...');
  const slotsResponse = await requestJson(`${API_BASE}/delivery/slots`);
  const slot = slotsResponse?.slots?.[0];

  if (!slot?.slotId) {
    throw new Error('No delivery slots available to select.');
  }

  console.log(`Selecting slot: ${slot.slotId}`);
  await requestJson(`${API_BASE}/delivery/slot/select`, {
    method: 'POST',
    body: JSON.stringify({ slotId: slot.slotId })
  });

  console.log('Verifying selected slot...');
  const selected = await requestJson(`${API_BASE}/delivery/slot`);
  const selectedSlotId = selected?.selected?.slot?.slotId || null;

  if (selectedSlotId !== slot.slotId) {
    throw new Error(`Selected slot mismatch. Expected ${slot.slotId}, got ${selectedSlotId}`);
  }

  console.log('All checks passed.');
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
