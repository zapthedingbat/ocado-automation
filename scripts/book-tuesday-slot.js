#!/usr/bin/env node
/**
 * Book a delivery slot on Tuesday.
 * Requires: OCADO_API_KEY, API_BASE_URL (optional, defaults to http://192.168.10.20:3000)
 * Run: node scripts/book-tuesday-slot.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = process.env.API_BASE_URL || 'http://192.168.10.20:3000';
const API_KEY = process.env.OCADO_API_KEY || process.env.API_KEY || 'test';

if (!API_KEY) {
  throw new Error('OCADO_API_KEY or API_KEY required in environment.');
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

const isTuesday = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getDay() === 2; // 0=Sun, 1=Mon, 2=Tue...
};

const main = async () => {
  console.log('Adding item to cart (required for delivery slots)...');
  const searchRes = await requestJson(`${API_BASE}/search?q=bread`);
  const products = searchRes?.result?.products || searchRes?.results || [];
  const productId = products[0]?.productId;

  if (!productId) {
    throw new Error('No products found from search.');
  }

  await requestJson(`${API_BASE}/cart/add-items`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] })
  });

  console.log('Fetching delivery slots...');
  const slotsRes = await requestJson(`${API_BASE}/delivery/slots`);
  const slots = slotsRes?.slots || [];

  if (!slots.length) {
    throw new Error('No delivery slots available.');
  }

  const tuesdaySlots = slots.filter(s => isTuesday(s.start || s.raw?.startTime || s.raw?.windowStart));
  const slot = tuesdaySlots[0];

  if (!slot?.slotId) {
    console.log('Available slots (first 10):');
    slots.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.start} - ${s.end} (${s.slotId})`);
    });
    throw new Error('No Tuesday slot found. Try another day or check available slots above.');
  }

  console.log(`Booking Tuesday slot: ${slot.start} - ${slot.end} (${slot.slotId})`);
  await requestJson(`${API_BASE}/delivery/slot/select`, {
    method: 'POST',
    body: JSON.stringify({ slotId: slot.slotId })
  });

  console.log('Slot booked successfully.');
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
