# Realcore Controlling Dashboard

Full-stack app to visualize APEX Controlling data (Stunden, Umsatzliste) with filters and charts.

## Stack
- Server: Node.js + Express proxy in `server/`
- Client: React + Vite in `client/`

The server proxies requests to the APEX API and injects headers for `datum_von`, `datum_bis`, and `unit`. Basic Auth credentials are read from environment variables.

## Setup

1) Copy environment file and set credentials

```bash
cp server/.env.example server/.env
# edit server/.env and set APEX_PASSWORD (and optionally APEX_USERNAME)
```

2) Install dependencies

```bash
npm install --prefix server
npm install --prefix client
```

3) Run locally (two terminals)

```bash
npm run dev --prefix server
npm run dev --prefix client
```

- Server: http://localhost:5175
- Client: http://localhost:5173

The client is configured to proxy `/api/*` calls to the server during development (see `client/vite.config.js`).

## Production build

```bash
# Build client
npm run build --prefix client

# Start server in production mode
NODE_ENV=production npm run start --prefix server
```

In production, the server will serve static assets from `client/dist/`.

## Security
- Do NOT commit real credentials. `.env` files are gitignored.
- The repository includes `server/.env.example` for guidance.

## Data transformation
We mirror the Postman script logic to aggregate `stunden` by Kunde and Projekt. See:
- `client/src/lib/transform.js`
- `client/src/components/CustomerTable.jsx`
- `client/src/components/HoursByCustomerChart.jsx`

## Notes
- Filters are located in `client/src/components/Filters.jsx` and are sent as headers by the proxy.
- Umsatzliste view is currently a JSON preview block; we can extend it to tabular/chart views on request.
