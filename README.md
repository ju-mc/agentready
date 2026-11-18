# AgentScore: website agent-readiness scanner

Free deterministic scan (no LLM) plus a paid full report via Stripe Checkout.

## Run locally
```bash
npm install
cp .env.example .env.local      # DEV_UNLOCK=1 lets you open reports without paying
npm run dev                     # http://localhost:3000
npm run scan -- example.com          # CLI: free summary
npm run scan -- example.com full     # CLI: full report JSON
```
Test sites: `node fixtures/server.mjs fixtures/good 4010` / `fixtures/bad 4011`, then scan with `ALLOW_PRIVATE_HOSTS=1`.

## Deploy (Vercel)
1. Push to GitHub, import in Vercel.
2. Set `STRIPE_SECRET_KEY`, `REPORT_PRICE_CENTS`, `NEXT_PUBLIC_PRICE_LABEL`, `NEXT_PUBLIC_BASE_URL`.
3. Do not set `DEV_UNLOCK` or `ALLOW_PRIVATE_HOSTS` in production.

## How it works
- `lib/scanner.ts`: all checks + scoring. 19 checks in 5 categories (Access, Discoverability, Readability, Structured data, Actionability).
- `/api/scan`: free tier. Returns only score, category scores, counts, and top 3 issues. Details and fixes never leave the server.
- `/api/checkout`: Stripe Checkout session with the URL in metadata.
- `/report?session_id=…`: verifies `payment_status === "paid"` with Stripe, re-runs a full scan (+10-page sample, generated llms.txt / robots.txt / JSON-LD), renders the report. PDF = browser print; Markdown/JSON/files via `/api/report`.
- No database: payment is verified against Stripe on each load (cached in memory for an hour).
- `lib/fetcher.ts`: SSRF guard (blocks private/metadata IPs, re-checks every redirect), 10s timeout, 3MB cap.

## Known limits / next steps
- Rate limit and cache are in-memory per instance. Move them to Upstash/Vercel KV when there's traffic.
- DNS-rebinding isn't fully covered by the SSRF guard. Fine for MVP; pin resolved IPs before scaling.
- Content checks read raw HTML only (that's the point: it's what most AI crawlers see). Hidden JS-attached click handlers can't be detected.
- Possible paid add-ons: LLM-written fixes, headless-browser agent test, monthly re-scan monitoring.
