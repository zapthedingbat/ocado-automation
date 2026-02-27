# Ocado Automation

REST API and MCP server for Ocado shopping automation via Playwright browser automation.

## Docker

```bash
docker build -t ghcr.io/zapthedingbat/ocado-automation .
docker compose up -d
```

The container runs **one server** (port 3000) with:
- **GET /health** – health check (no auth)
- **/api/\*** – REST API (search, cart, delivery, orders)
- **POST /mcp** – MCP endpoint for smart home / voice (Streamable HTTP)

Requires `OCADO_EMAIL`, `OCADO_PASSWORD`, and `OCADO_API_KEY` in environment. Optional: `OCADO_HEARTBEAT_MINUTES` (default 15) to control how often the session is refreshed and saved.

## Running locally

**Combined service** (API + MCP on one port, one Automation/browser):
```bash
npm run service
```
Server listens on port 3000. API at `/api/*`, MCP at `POST /mcp`.

**API only** (e.g. for development):
```bash
npm start
```
REST API at `/health`, `/search`, `/cart`, etc. (no `/api` prefix when run standalone.)

**MCP only**:
```bash
npm run mcp-server
```
MCP at `POST /mcp` on port 3100.

## MCP

Point your MCP client at **POST http://&lt;host&gt;:3000/mcp**

**Tools exposed:** 
- `search_products`,
- `get_cart`,
- `add_to_cart`,
- `remove_from_cart`,
- `get_delivery_slots`,
- `get_selected_delivery_slot`,
- `select_delivery_slot`,
- `get_upcoming_orders`.

## API Endpoints

When using the combined service, all API paths are under **/api**. All require `X-API-Key` header (unless `OCADO_API_KEY` is unset).

| Method | Path                     | Description                                   |
|--------|--------------------------|-----------------------------------------------|
| GET    | /health                  | No auth (at root when using service)          |
| GET    | /api/health              | No auth                                       |
| GET    | /api/search?q=           | Search products                               |
| POST   | /api/cart/add-items      | Add by productId (search first for id)        |
| POST   | /api/cart/remove-items   | Remove by productId (GET /cart first for ids) |
| GET    | /api/cart                | Cart contents                                 |
| GET    | /api/delivery/slot       | Available slots                               |
| GET    | /api/delivery/slot/selected | Selected slot                              |
| POST   | /api/delivery/slot/selected | Select slot (body: `{ "slotId": "..." }`)  |
| GET    | /api/orders/upcoming     | Upcoming orders                               |
