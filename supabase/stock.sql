create or replace function public.adjust_watch_stock(p_product uuid,p_delta int,p_actor uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old_qty integer;new_qty integer;
begin
 select stock into old_qty from public.products where id=p_product for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 new_qty:=old_qty+p_delta;
 if new_qty<0 then raise exception 'NEGATIVE_STOCK';end if;
 update public.products set stock=new_qty,updated_at=now() where id=p_product;
 insert into public.stock_movements(product_id,actor_id,old_stock,new_stock,reason) values(p_product,p_actor,old_qty,new_qty,p_reason);
 return jsonb_build_object('product_id',p_product,'old_stock',old_qty,'new_stock',new_qty);
end $$;
revoke execute on function public.adjust_watch_stock(uuid,int,uuid,text) from public,anon,authenticated;
grant execute on function public.adjust_watch_stock(uuid,int,uuid,text) to service_role;
