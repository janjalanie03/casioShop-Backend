# Casio Watch Store — Express backend (COD + Gemini + optional Maya)

## IMPORTANT: Security first
The original uploaded `.env` contained real-looking Supabase service and Gemini/Maya API secrets. **Rotate them before deployment** in the corresponding service dashboards. No secrets are included in this ZIP. Never put server secrets in frontend files or commit them to Git.

## Existing database migration
You said you already executed previous SQL. **Do not run `supabase/schema.sql` again**. Use Supabase SQL Editor and execute only `supabase/02_cod_hardening.sql` once (it is designed to be repeatable). The migration adds profile columns if missing, COD order status/method, transaction-backed COD ordering, payment receipts and protected RPC functions.

## Local setup (PowerShell)
```powershell
cd "$HOME\Downloads\casio-watch-backend-final"
Copy-Item .env.example .env
notepad .env
npm install
npm run check
npm run dev
```
Fill your own private credentials in backend `.env` only. Required `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. `GEMINI_API_KEY` is required for AI but backend can start without it. `MAYA_*` keys are optional for Cash on Delivery.

## Render
- Root directory: repo root (folder containing `package.json`)
- Build: `npm install`
- Start: `npm run start`
- Set Supabase secrets, Gemini key and `GEMINI_MODEL=gemini-3.5-flash-lite` as environment variables. Check current model access in AI Studio.
- Set `CORS_ORIGINS=http://localhost:5173,https://YOUR_FRONTEND.vercel.app` (comma-separated, no trailing slash)
- Set `FRONTEND_URL=https://YOUR_FRONTEND.vercel.app`

## API additions
- `GET /api/v1/profile`, `PATCH /api/v1/profile`
- `POST /api/v1/checkout/cod` (Bearer, `Idempotency-Key` header, shipping object)
- `POST /api/v1/orders/:id/cancel-cod`
- `GET /api/v1/admin/store-analytics`
- `POST /api/v1/admin/orders/:id/collect-cod` with `{ "receipt_number": "COD-2026-0001" }` **after collecting real payment**
- Existing `/api/v1/ai/discover`, product CRUD, auth, cart and Maya endpoints remain.

## Live test (order matters)
1. Run SQL migration and inspect its success.
2. Configure backend environment, start backend, check `GET /api/v1/health`.
3. Log in via `/api/v1/auth/login`; pass JWT Bearer token.
4. Add a product to cart.
5. `POST /api/v1/checkout/cod` with `Idempotency-Key: <new UUID>` and valid `shipping` from profile.
6. Query `/api/v1/orders` and admin `/api/v1/admin/orders`.
7. Admin changes order `pending_cod → processing → shipped → delivered`.
8. Admin enters a genuine receipt number *after collecting payment*.
9. Test analytics and frontend.

**This is development software.** COD payment collection is a manual record, not payment processor verification. Verify tax/legal receipt requirements separately.
