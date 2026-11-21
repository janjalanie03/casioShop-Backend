# Watch-store business rules (no AI)

1. Watch comparison: `POST /watches/compare` accepts 2–4 unique active product IDs. It returns authoritative watch movement, water resistance, strap and warranty values from the product database; inactive/missing products rejected.
2. Warranty tracking: once an order is marked delivered, a warranty row is generated for each order item with the model's warranty duration. A customer can submit one active claim. `POST /warranties/:id/claim` rejects out-of-period, previously claimed, and foreign warranties. Admin can approve/reject/resolve.
3. All catalog prices, coupon calculations and delivery fees come from the database; never trust client prices. Currency PHP and amounts 2 decimal places.
4. Checkout updates stock within a PostgreSQL transaction with row locks and creates audit records; failed/expired/cancelled orders release the reservation exactly once.
5. The `Idempotency-Key` is unique per customer; repeated keys return the same order.
6. Order status transitions are validated in SQL; webhook alone cannot blindly mark an order paid. Gateway reconciliation must check amount and PHP currency.
