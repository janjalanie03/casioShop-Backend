-- EXISTING CASIO SHOP DATABASE: incremental migration only.
-- Safe to run after the earlier COD SQL. Do NOT re-run schema.sql.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'maya';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cod_collected boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check CHECK(payment_method IN ('maya','cod'));
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK(status IN ('pending_payment','payment_review','pending_cod','paid','processing','shipped','delivered','cancelled','expired','payment_failed'));
CREATE INDEX IF NOT EXISTS idx_orders_method_status ON public.orders(payment_method,status);

-- Record COD receipts with an immutable audit row. This is an internal order receipt, not a tax invoice.
CREATE TABLE IF NOT EXISTS public.cod_payment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 receipt_number text NOT NULL UNIQUE,
 amount numeric(12,2) NOT NULL CHECK(amount >= 0),
 collected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cod_payment_receipts ENABLE ROW LEVEL SECURITY;

-- Preserve the original checkout's transactional inventory and coupon rules.
CREATE OR REPLACE FUNCTION public.place_cod_order(p_user uuid,p_key text,p_shipping jsonb,p_code text DEFAULT null)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb; v_id uuid; v_order public.orders%rowtype;
BEGIN
 v_result:=public.place_watch_order(p_user,p_key,p_shipping,p_code);
 v_id:=(v_result->>'order_id')::uuid;
 SELECT * INTO v_order FROM public.orders WHERE id=v_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF coalesce((v_result->>'reused')::boolean,false) THEN
   IF v_order.payment_method <> 'cod' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN jsonb_build_object('order_id',v_id,'reused',true);
 END IF;
 UPDATE public.orders SET payment_method='cod',status='pending_cod',cod_collected=false,updated_at=now()
 WHERE id=v_id AND status='pending_payment';
 IF NOT FOUND THEN RAISE EXCEPTION 'COD_TRANSITION_FAILED'; END IF;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,actor_id,reason)
 VALUES(v_id,'pending_payment','pending_cod',p_user,'COD order placed');
 RETURN jsonb_build_object('order_id',v_id,'reused',false);
END $$;

-- Order transitions never mark COD as paid. Cancels restore reserved inventory once.
CREATE OR REPLACE FUNCTION public.change_order_status(p_order uuid,p_new text,p_actor uuid DEFAULT null,p_reason text DEFAULT null)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.orders%rowtype; item record; old_stock integer; new_stock integer;
BEGIN
 SELECT * INTO v FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF v.status=p_new THEN RETURN; END IF;
 IF NOT (
   (v.payment_method='maya' AND v.status='pending_payment' AND p_new IN ('paid','cancelled','expired','payment_failed','payment_review')) OR
   (v.payment_method='maya' AND v.status='payment_review' AND p_new IN ('paid','cancelled')) OR
   (v.payment_method='maya' AND v.status='paid' AND p_new='processing') OR
   (v.payment_method='cod' AND v.status='pending_cod' AND p_new IN ('processing','cancelled')) OR
   (v.status='processing' AND p_new='shipped') OR
   (v.status='shipped' AND p_new='delivered')
 ) THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION'; END IF;
 IF p_new IN ('cancelled','expired','payment_failed') THEN
   FOR item IN SELECT * FROM public.order_items WHERE order_id=v.id ORDER BY product_id LOOP
     SELECT stock INTO old_stock FROM public.products WHERE id=item.product_id FOR UPDATE;
     UPDATE public.products SET stock=stock+item.quantity,updated_at=now() WHERE id=item.product_id RETURNING stock INTO new_stock;
     INSERT INTO public.stock_movements(product_id,actor_id,order_id,old_stock,new_stock,reason)
     VALUES(item.product_id,p_actor,v.id,old_stock,new_stock,'reservation_release');
   END LOOP;
   IF v.coupon_id IS NOT NULL THEN
     UPDATE public.coupons SET used_count=greatest(0,used_count-1) WHERE id=v.coupon_id;
   END IF;
 END IF;
 UPDATE public.orders SET status=p_new,updated_at=now() WHERE id=p_order;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,actor_id,reason)
 VALUES(p_order,v.status,p_new,p_actor,p_reason);
 IF p_new='delivered' THEN
   INSERT INTO public.warranties(order_item_id,starts_at,ends_at)
   SELECT oi.id,now(),now()+make_interval(months=>p.warranty_months)
   FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
   WHERE oi.order_id=p_order ON CONFLICT(order_item_id) DO NOTHING;
 END IF;
END $$;

-- Atomic, one-time COD collection; requires delivered order, actual collected payment and receipt number.
CREATE OR REPLACE FUNCTION public.record_cod_payment(p_order uuid,p_actor uuid,p_receipt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.orders%rowtype; v_id uuid;
BEGIN
 IF length(trim(p_receipt))<3 THEN RAISE EXCEPTION 'INVALID_RECEIPT'; END IF;
 SELECT * INTO v FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR v.payment_method<>'cod' OR v.status<>'delivered' THEN
   RAISE EXCEPTION 'INVALID_COD_STATE';
 END IF;
 IF v.cod_collected THEN
   SELECT id INTO v_id FROM public.cod_payment_receipts WHERE order_id=p_order;
   RETURN jsonb_build_object('receipt_id',v_id,'already_collected',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.cod_payment_receipts WHERE receipt_number=trim(p_receipt)) THEN
   RAISE EXCEPTION 'RECEIPT_EXISTS';
 END IF;
 INSERT INTO public.cod_payment_receipts(order_id,actor_id,receipt_number,amount)
 VALUES(p_order,p_actor,trim(p_receipt),v.total) RETURNING id INTO v_id;
 UPDATE public.orders SET cod_collected=true,updated_at=now() WHERE id=p_order;
 RETURN jsonb_build_object('receipt_id',v_id,'already_collected',false);
END $$;

REVOKE ALL ON FUNCTION public.place_cod_order(uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.change_order_status(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_cod_payment(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_cod_order(uuid,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_order_status(uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_cod_payment(uuid,uuid,text) TO service_role;
COMMIT;
