# Ocado Automation

REST API for Ocado shopping automation via Playwright browser automation.

## Docker

```bash
docker build -t ghcr.io/zapthedingbat/ocado-automation .
docker compose up -d
```

Requires `OCADO_EMAIL`, `OCADO_PASSWORD`, and `OCADO_API_KEY` (or `API_KEY`) in environment.

## API Endpoints

All require `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | No auth |
| GET | /search?q= | Search products |
| POST | /basket/add | Add by item name |
| POST | /cart/add-items | Add by productId |
| POST | /cart/remove-items | Remove by productId |
| GET | /basket | Basket contents |
| POST | /basket/remove | Remove by item name |
| GET | /delivery/slots | Available slots |
| GET | /delivery/slot | Selected slot |
| POST | /delivery/slot/select | Select slot |
| GET | /orders/upcoming | Upcoming orders |

## Scripts

- `npm run test` - Runs API integration test
- `npm run book-tuesday` - Books first Tuesday delivery slot
