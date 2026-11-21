# Casio Watch Store — Backend-only Capstone (no AI)

Node.js 20+ / Express 5 / Supabase Auth + PostgreSQL / Maya Checkout Sandbox. One backend only; frontend to be built separately in React.

**Important:** This package has not been deployed or tested against your Supabase project or Maya account. Run the setup and end-to-end validation yourself. Sample watch prices and specs are DEMONSTRATION data, not verified Casio listings.

## 1. Setup in VS Code

```bash
cd casio-watch-backend
npm install
cp .env.example .env
```

On Windows PowerShell: `Copy-Item .env.example .env` (or copy in Explorer). Edit `.env` with your **replacement/private** Supabase project keys and Maya Sandbox credentials. Do not paste secrets into chat or GitHub.

- `SUPABASE_URL`: project URL
- `SUPABASE_PUBLISHABLE_KEY`: project's `sb_publishable_...` key
- `SUPABASE_SECRET_KEY`: backend-only `sb_secret_...` key. Never in React.
- `MAYA_PUBLIC_KEY`: sandbox `pk-...`, used by the backend to create sessions
- `MAYA_SECRET_KEY`: sandbox `sk-...`, used only by the backend to fetch payment details
- `MAYA_API_BASE`: leave `https://pg-sandbox.paymaya.com`
- `MAYA_WEBHOOK_PUBLIC_KEY_1/2`: Maya's **RSA signature verification public keys**, different from your Maya API key. Copy both official sandbox PEM blocks from https://developers.maya.ph/reference/webhook-security . Use a single-line base64 of the DER public key, or a PEM string with literal `\n` separators.
- `FRONTEND_URL`: later React frontend domain. Maya redirects here; when frontend is not created yet, the resulting page may 404, but payment verification works through API.
- `PUBLIC_API_URL`: deployed backend HTTPS URL; used when registering webhook in Maya.
- `CORS_ORIGINS`: comma-separated allowed frontend origins.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD`: credentials for seeded test accounts; 12+ character passwords.

**Important:** Supabase email confirmation can be enabled. If registration returns `email_confirmation_required:true`, confirm the email before login. Seed accounts are confirmed via admin API for testing.

## 2. Database: SQL (run exactly in order)

In Supabase Dashboard > SQL Editor > New query, run all of `supabase/schema.sql`, followed by `supabase/stock.sql`.

Use a fresh Supabase project or inspect existing tables first. These scripts are not a migration for an established schema. They add profiles, categories, products, carts, coupons, orders, order items, audit logs, payment events and warranties. Tables have RLS enabled without browser access policies: your Express server alone uses a backend secret and validates users/roles.

## 3. Start and seed

```bash
npm run seed
npm run dev
```

If `npm run seed` is missing, add `"seed": "node src/seed.js"` in package.json scripts (included in packaged project). The repeatable seed creates five categories, twenty sample watches, three coupons, one admin and two customer users. It does not overwrite existing auth passwords.

URLs:
- `GET http://localhost:4000/api/v1/health`
- `GET http://localhost:4000/api/v1/products`
- Swagger UI: `http://localhost:4000/api-docs`

## 4. Postman quick walkthrough

1. Import `postman/Casio.postman_collection.json` and `postman/Casio.postman_environment.json`; select the environment.
2. Fill `customer_email` and `customer_password` (use seeded customer), then run **Login**. Its script fills `customer_token` and `refresh_token`.
3. Login again using admin email + password and manually copy the response `data.access_token` to environment variable `admin_token`. Restore `customer_token` to the customer login token if replaced.
4. Run **Public watch categories** and **Search and filter watches**; scripts save `category_id`, `product_id` and `product_id_2`.
5. Run **Add cart item** and **View cart**. For stock conflict, repeat with quantity exceeding stock (max validation and live inventory validation are separate).
6. Run **Check coupon** then **Atomic checkout and Maya session**, with unique `idempotency_key`. The response contains `checkout_url` and sets `order_id`.
7. Open `checkout_url` in a browser. Use only Maya's official sandbox test card/account guidance. Then run **Reconcile with Maya** or **My order detail**; never manually set `paid`.
8. Test the admin products, stock movement, coupons, order statuses, dashboard, and warranty endpoints. A warranty is created once a paid order becomes delivered.
9. Negative cases folder checks authentication, malformed request, invalid coupon, and unsigned webhook.

**Every new checkout uses a fresh `Idempotency-Key`. Replaying an existing key returns the original order and URL, not a second order.**

Sample checkout body:

```json
{"shipping":{"recipient":"Test Customer","phone":"09171234567","address":"Purok 1, Sample Street","city":"Iligan City","province":"Lanao del Norte","postal_code":"9200"},"coupon_code":"WELCOME10"}
```

Header: `Authorization: Bearer <customer_token>`; `Idempotency-Key: casio-demo-order-0001`.

## 5. Maya Sandbox webhook

Deploy Express on an HTTPS domain. Register EACH event `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `PAYMENT_CANCELLED` with callback URL:

`https://YOUR-BACKEND-DOMAIN/api/v1/payments/maya/webhook`

Use the Maya Manager sandbox Webhooks page, or the official `POST /payments/v1/webhooks` endpoint with your **secret** Maya key. For receiving events, configure both **Maya RSA signature public keys**. The endpoint rejects unsigned, expired, or incorrectly signed requests. It then independently fetches the gateway payment by merchant reference and checks amount and PHP currency before marking `paid`. Duplicate payment status events are uniquely recorded. The customer return URL is INFORMATIONAL ONLY. Maya webhook delivery requires a public HTTPS endpoint, not localhost.

Official docs: https://developers.maya.ph/reference/configuring-your-webhook-for-maya-checkout and https://developers.maya.ph/reference/webhook-security . For extra protection configure Maya's sandbox webhook IP allowlist **at your trusted reverse proxy/cloud firewall**; do not trust arbitrary forwarded IP headers.

## 6. Payments, reservations and limitations

- Checkout locks relevant PostgreSQL rows in a database transaction and reserves stock immediately. Distinct users cannot buy the same last unit.
- Shipping is a simple demo flat ₱150, free from ₱5,000 after discount.
- Order status: pending_payment -> paid -> processing -> shipped -> delivered. Pending orders may become cancelled/expired/payment_failed/payment_review; illegal transitions fail. Payment success only after Maya confirmation.
- Expired reservations WITH a Maya checkout session require a reliable terminal status from Maya. For safety the admin expiration endpoint will **not** blindly release stock while the gateway may still complete a payment. Reconcile after Maya's hour-long checkout expiry.
- Cancel payment only when Maya lookup does not report paid. This demo does not call Maya's remote cancel API: complete this before production use if required.
- Retrying a failed payment is done by adding items to the cart and making a fresh order; reusing a failed order is intentionally not supported.
- `payment_review` requires manual investigation, including when Maya checkout creation times out or the response cannot be verified. Stock remains reserved to avoid overselling. A late success on a previously cancelled order must be handled manually to prevent stock inconsistency. This demo does **not** make refunds.
- There is no AI, frontend, real courier integration, production payments, email sending, or real Casio partnership.

## 7. Tests

```bash
TEST_BASE_URL=http://localhost:4000/api/v1 TEST_CUSTOMER_EMAIL=casio.customer1@example.com TEST_CUSTOMER_PASSWORD=YOUR_PASSWORD npm test
```

PowerShell:
```powershell
$env:TEST_BASE_URL='http://localhost:4000/api/v1'
$env:TEST_CUSTOMER_EMAIL='casio.customer1@example.com'
$env:TEST_CUSTOMER_PASSWORD='YOUR_PASSWORD'
npm test
```

The HTTP tests need a running local backend connected to seeded Supabase. They are skipped when prerequisites are missing. They do not perform live paid checkout; perform the separate Maya Sandbox E2E test and record actual results for class submission.

## 8. Deployment (Render)

- Push repository to GitHub **without `.env`**.
- Render > New Web Service > root directory `casio-watch-backend` (if monorepo), runtime Node.
- Build command: `npm install`; Start: `npm start`.
- Enter your new secrets in Render Environment. Set `PUBLIC_API_URL`, `FRONTEND_URL`, and `CORS_ORIGINS` to actual URLs.
- Run SQL and seed before demonstration; register the Render public HTTPS webhook URL in Maya.
- Frontend React can later consume these documented `/api/v1` endpoints.

## 9. Patterns and architecture

- MVC-style separation: routes/controllers still concentrated in `routes/api.js` for ease of study; services and persistence helpers split out. **For a strict rubric requiring separate controllers/repositories, refactor `routes/api.js` into those directories before final defense.**
- Singleton: `src/config/supabase.js` exports a shared Supabase client.
- Factory + abstract class + inheritance: `PaymentProvider`, `MayaProvider`, `DisabledPaymentProvider`, and `paymentProviderFactory` in `src/services/maya.js`.
- Façade: Maya provider hides authentication, endpoints and gateway transport.
- Middleware decorator: auth, role protection, rate limiting, error formatter.
- Database transactions encapsulate stock reservations and order state.

## 10. Security checklist

- Never commit or send secret keys, customer passwords or payment tokens.
- Rotate any exposed Supabase backend secret. Shared Maya Sandbox Party 1 keys are published demo keys, not private merchant credentials.
- Use HTTPS. No real credit cards in sandbox. Use strict CORS allowlist; admin role is enforced on every admin route.
- Supabase JWT is validated using `auth.getUser(token)` (works with both legacy symmetric and asymmetric signing setups); do not trust unverified `role` in client-sent payloads.
- One customer cannot read another customer’s orders or warranties.
- Before production: move payment verification and timeout work to a durable queue, implement comprehensive payment failure tests, restrict webhook IPs at trusted infrastructure, and add audit/log monitoring.
