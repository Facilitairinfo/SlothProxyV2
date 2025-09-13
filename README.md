# Sloth Proxy v2

Headless snapshot- en raw-fetch proxy met Playwright, caching en rate limiting.

## Endpoints
- GET /health
- GET /raw?url=...
- GET /snapshot?url=...

## Config via env
Zie .env.example

## Ontwikkeling
npm ci
npm run dev

## Productie (Docker)
docker build -t sloth-proxy-v2 .
docker run -p 8080:8080 --env-file .env sloth-proxy-v2
