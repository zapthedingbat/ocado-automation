/**
 * Shared auth middleware for API and MCP routes.
 * When OCADO_API_KEY is set, requires either:
 *   - Authorization: Bearer <OCADO_API_KEY>
 *   - X-API-Key: <OCADO_API_KEY>
 * When OCADO_API_KEY is unset, no auth is applied (development).
 */

import { createLogger } from './logger.js';

const log = createLogger('auth');

const SECRET_ENV = 'OCADO_API_KEY';

/**
 * Express middleware that rejects with 401 if OCADO_API_KEY is set and the request
 * does not provide a matching Bearer token or X-API-Key.
 * Skips validation for path /health so health checks remain unauthenticated.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireApiKey(req, res, next) {
  if (req.path === '/health') {
    return next();
  }

  const secret = process.env[SECRET_ENV];
  if (!secret) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  const provided =
    (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7).trim()) ||
    (apiKeyHeader && apiKeyHeader.trim()) ||
    null;

  if (!provided || provided !== secret) {
    log('Unauthorized %s %s', req.method, req.path);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid API key. Use Authorization: Bearer <key> or X-API-Key: <key>.',
    });
    return;
  }

  next();
}
