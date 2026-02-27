/**
 * Create a namespaced debug logger. Each module should create its own logger and pass the name it chooses.
 *
 * Enable in the shell before running (nothing is logged until DEBUG is set):
 *   Unix:   DEBUG=ocado:* node -r dotenv/config scripts/test.js
 *   Win:    set DEBUG=ocado:* && node -r dotenv/config scripts/test.js
 *
 * Use ocado:* for all namespaces, or e.g. DEBUG=ocado:api,ocado:login for a subset.
 *
 * @param {string} name - Namespace name (e.g. 'automation', 'api'). Becomes ocado:name.
 * @returns {function} - debug logger
 * @see https://www.npmjs.com/package/debug
 */
import createDebug from 'debug';

export function createLogger(name) {
  return createDebug(`ocado:${name}`);
}
