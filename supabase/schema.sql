-- Run in Supabase SQL Editor on a NEW or dedicated project.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null, full_name text not null default '', role text not null default 'customer' check(role in ('customer','admin')),
 created_at timestamptz not null default now()
);
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing;return new;end $$;
drop trigger if exists trg_auth_profile on auth.users;
create trigger trg_auth_profile after insert on auth.users for each row execute function public.create_profile();
create table if not exists public.categories(id uuid primary key default gen_random_uuid(),name text not null unique,slug text not null unique);
create table if not exists public.products(
 id uuid primary key default gen_random_uuid(),sku text not null unique,name text not null,description text not null default '',
 category_id uuid not null references public.categories(id),price numeric(12,2) not null check(price>=0),
 stock integer not null default 0 check(stock>=0),active boolean not null default true,
 image_url text,model_number text,series text,movement text check(movement in ('Quartz','Digital','Solar','Automatic')),
 water_resistance_m integer not null default 0 check(water_resistance_m>=0),strap_material text,
 warranty_months integer not null default 12 check(warranty_months>=0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.cart_items(
 user_id uuid not null references public.profiles(id) on delete cascade,product_id uuid not null references public.products(id),
 quantity int not null check(quantity between 1 and 20),primary key(user_id,product_id)
);
create table if not exists public.coupons(
 id uuid primary key default gen_random_uuid(),code text not null unique,type text not null check(type in ('percent','fixed')),
 value numeric(12,2) not null check(value>0),minimum_spend numeric(12,2) not null default 0,
 max_uses integer check(max_uses>0),per_customer_limit int not null default 1 check(per_customer_limit>0),used_count int not null default 0,
 expires_at timestamptz,active boolean not null default true,
 check(type <> 'percent' or value <=100)
);
create table if not exists public.orders(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 status text not null default 'pending_payment' check(status in ('pending_payment','paid','processing','shipped','delivered','cancelled','expired','payment_failed','payment_review')),
 subtotal numeric(12,2) not null,discount numeric(12,2) not null default 0,shipping_fee numeric(12,2) not null default 0,total numeric(12,2) not null,
 coupon_id uuid references public.coupons(id),shipping jsonb not null,idempotency_key text not null,
 checkout_id text unique,checkout_url text,request_reference text unique,
 expires_at timestamptz not null default now()+interval '60 minutes',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create table if not exists public.order_items(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),product_id uuid not null references public.products(id),
 sku text not null,name text not null,unit_price numeric(12,2) not null,quantity integer not null check(quantity>0),line_total numeric(12,2) not null
);
create table if not exists public.stock_movements(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id),actor_id uuid references public.profiles(id),
 order_id uuid references public.orders(id),old_stock int not null,new_stock int not null,reason text not null,created_at timestamptz not null default now()
);
create table if not exists public.order_status_history(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),old_status text,new_status text not null,
 actor_id uuid references public.profiles(id),reason text,created_at timestamptz not null default now()
);
create table if not exists public.payment_events(
 id uuid primary key default gen_random_uuid(),event_key text not null unique,order_id uuid references public.orders(id),
 event_status text not null,payment_id text,amount numeric(12,2),currency text,payload jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.warranties(
 id uuid primary key default gen_random_uuid(),order_item_id uuid not null unique references public.order_items(id),
 starts_at timestamptz,ends_at timestamptz,serial_number text unique,claim_status text not null default 'not_claimed' check(claim_status in ('not_claimed','pending','approved','rejected','resolved')),
 claim_notes text,updated_at timestamptz not null default now()
);
create index if not exists idx_products_category on public.products(category_id,active);
create index if not exists idx_orders_user on public.orders(user_id,created_at desc);
create index if not exists idx_orders_status on public.orders(status,expires_at);
create index if not exists idx_items_order on public.order_items(order_id);
-- No browser or anonymous direct table access; service role is used from this backend only.
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payment_events enable row level security;
alter table public.warranties enable row level security;
-- The service-role backend uses privileged RPCs for atomic updates.
create or replace function public.place_watch_order(p_user uuid,p_key text,p_shipping jsonb,p_code text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype;v_sub numeric(12,2):=0;v_discount numeric(12,2):=0;v_ship numeric(12,2);v_coupon public.coupons%rowtype;v_row record;v_new_stock int;v_count int;v_code text:=upper(trim(coalesce(p_code,'')));
begin
 if length(p_key)<8 or length(p_key)>100 then raise exception 'INVALID_IDEMPOTENCY_KEY';end if;
 -- Serialize checkouts per user so repeated clicks are idempotent and coupon rules stay coherent.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into v_order from public.orders where user_id=p_user and idempotency_key=p_key;
 if found then return jsonb_build_object('order_id',v_order.id,'reused',true);end if;
 select count(*) into v_count from public.cart_items where user_id=p_user;
 if v_count=0 then raise exception 'EMPTY_CART';end if;
 -- lock product rows in stable order to avoid concurrent checkout overselling
 for v_row in select p.id,p.stock,p.active,c.quantity,p.price,p.name,p.sku from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=p_user order by p.id for update of p loop
  if not v_row.active or v_row.stock<v_row.quantity then raise exception 'OUT_OF_STOCK';end if;
  v_sub:=v_sub+v_row.price*v_row.quantity;
 end loop;
 if v_code<>'' then
  select * into v_coupon from public.coupons where code=v_code for update;
  if not found or not v_coupon.active then raise exception 'COUPON_INVALID';end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at<now() then raise exception 'COUPON_EXPIRED';end if;
  if v_sub<v_coupon.minimum_spend then raise exception 'COUPON_MINIMUM';end if;
  if v_coupon.max_uses is not null and v_coupon.used_count>=v_coupon.max_uses then raise exception 'COUPON_EXHAUSTED';end if;
  if (select count(*) from public.orders where user_id=p_user and coupon_id=v_coupon.id and status not in ('cancelled','expired','payment_failed'))>=v_coupon.per_customer_limit then raise exception 'COUPON_CUSTOMER_LIMIT';end if;
  v_discount:=least(v_sub,case when v_coupon.type='percent' then round(v_sub*v_coupon.value/100,2) else v_coupon.value end);
 end if;
 v_ship:=case when v_sub-v_discount>=5000 then 0 else 150 end;
 insert into public.orders(user_id,subtotal,discount,shipping_fee,total,coupon_id,shipping,idempotency_key)
 values(p_user,v_sub,v_discount,v_ship,v_sub-v_discount+v_ship,case when v_code<>'' then v_coupon.id else null end,p_shipping,p_key) returning * into v_order;
 for v_row in select p.id,p.stock,c.quantity,p.price,p.name,p.sku from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=p_user order by p.id loop
  update public.products set stock=stock-v_row.quantity,updated_at=now() where id=v_row.id returning stock into v_new_stock;
  insert into public.order_items(order_id,product_id,sku,name,unit_price,quantity,line_total) values(v_order.id,v_row.id,v_row.sku,v_row.name,v_row.price,v_row.quantity,v_row.price*v_row.quantity);
  insert into public.stock_movements(product_id,actor_id,order_id,old_stock,new_stock,reason) values(v_row.id,p_user,v_order.id,v_row.stock,v_new_stock,'checkout_reservation');
 end loop;
 if v_code<>'' then update public.coupons set used_count=used_count+1 where id=v_coupon.id;end if;
 insert into public.order_status_history(order_id,new_status,actor_id,reason) values(v_order.id,'pending_payment',p_user,'checkout');
 delete from public.cart_items where user_id=p_user;
 return jsonb_build_object('order_id',v_order.id,'reused',false);
end $$;
create or replace function public.set_checkout_session(p_order uuid,p_checkout text,p_url text,p_reference text)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.orders set checkout_id=p_checkout,checkout_url=p_url,request_reference=p_reference,updated_at=now()
 where id=p_order and status='pending_payment' and checkout_id is null;
 if not found then raise exception 'CHECKOUT_SESSION_CONFLICT';end if;
end $$;
create or replace function public.change_order_status(p_order uuid,p_new text,p_actor uuid default null,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v public.orders%rowtype;item record;before_stock int;after_stock int;v_warranty int;
begin
 select * into v from public.orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND';end if;
 if v.status=p_new then return;end if;
 if not ((v.status='pending_payment' and p_new in ('paid','cancelled','expired','payment_failed','payment_review')) or
 (v.status='payment_review' and p_new in ('paid','cancelled')) or
 (v.status='paid' and p_new='processing') or (v.status='processing' and p_new='shipped') or
 (v.status='shipped' and p_new='delivered')) then raise exception 'ILLEGAL_TRANSITION';end if;
 if p_new in ('cancelled','expired','payment_failed') then
  for item in select * from public.order_items where order_id=v.id order by product_id loop
   select stock into before_stock from public.products where id=item.product_id for update;
   update public.products set stock=stock+item.quantity where id=item.product_id returning stock into after_stock;
   insert into public.stock_movements(product_id,actor_id,order_id,old_stock,new_stock,reason) values(item.product_id,p_actor,v.id,before_stock,after_stock,'reservation_release');
  end loop;
  if v.coupon_id is not null then update public.coupons set used_count=greatest(0,used_count-1) where id=v.coupon_id;end if;
 end if;
 update public.orders set status=p_new,updated_at=now() where id=p_order;
 insert into public.order_status_history(order_id,old_status,new_status,actor_id,reason) values(p_order,v.status,p_new,p_actor,p_reason);
 if p_new='delivered' then
  insert into public.warranties(order_item_id,starts_at,ends_at)
  select oi.id,now(),now()+make_interval(months=>p.warranty_months) from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=p_order on conflict(order_item_id) do nothing;
 end if;
end $$;
-- IMPORTANT: RPC execution must be restricted; the backend alone validates actors.
revoke execute on function public.place_watch_order(uuid,text,jsonb,text) from public,anon,authenticated;
revoke execute on function public.set_checkout_session(uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.change_order_status(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.place_watch_order(uuid,text,jsonb,text) to service_role;
grant execute on function public.set_checkout_session(uuid,text,text,text) to service_role;
grant execute on function public.change_order_status(uuid,text,uuid,text) to service_role;
