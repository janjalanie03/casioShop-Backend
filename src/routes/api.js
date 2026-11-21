import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db,authClient } from '../config/supabase.js';
import { auth,admin } from '../middleware/auth.js';
import { ok,fail,wrap,result } from '../utils/http.js';
import { maya } from '../services/maya.js';
import { env } from '../config/env.js';
import { verifyMayaWebhook } from '../services/webhook.js';
const r=Router();
const uuid=z.string().uuid();
const money=z.number().finite().nonnegative().max(99999999);
const ship=z.object({recipient:z.string().min(2).max(120),phone:z.string().min(7).max(25),address:z.string().min(8).max(250),city:z.string().min(2).max(80),province:z.string().min(2).max(80),postal_code:z.string().min(4).max(12)}).strict();
const productSchema=z.object({sku:z.string().min(2).max(60),name:z.string().min(2).max(150),description:z.string().max(3000).default(''),category_id:uuid,price:money,stock:z.number().int().min(0),active:z.boolean().default(true),image_url:z.string().url().nullable().optional(),model_number:z.string().max(100).nullable().optional(),series:z.string().max(100).nullable().optional(),movement:z.enum(['Quartz','Digital','Solar','Automatic']).nullable().optional(),water_resistance_m:z.number().int().min(0).default(0),strap_material:z.string().max(80).nullable().optional(),warranty_months:z.number().int().min(0).max(120).default(12)}).strict();
const couponSchema=z.object({code:z.string().min(3).max(40),type:z.enum(['percent','fixed']),value:z.number().positive(),minimum_spend:money.default(0),max_uses:z.number().int().positive().nullable().optional(),per_customer_limit:z.number().int().positive().default(1),expires_at:z.string().datetime({offset:true}).nullable().optional(),active:z.boolean().default(true)}).strict().refine(x=>x.type!=='percent'||x.value<=100);
const dbError=(error)=>{if(error)fail(500,'DATABASE_ERROR','Database operation failed')};
const selectOrder=async(id)=>{
 const order=result(await db.from('orders').select('*,order_items(*),order_status_history(*)').eq('id',id).maybeSingle());return order;
};
const clean=(data,allowed)=>Object.fromEntries(Object.entries(data).filter(([k])=>allowed.includes(k)));
const checkCoupon=(err)=>{
 const m=String(err.message||'');const names=['EMPTY_CART','OUT_OF_STOCK','COUPON_INVALID','COUPON_EXPIRED','COUPON_MINIMUM','COUPON_EXHAUSTED','COUPON_CUSTOMER_LIMIT','INVALID_IDEMPOTENCY_KEY'];
 const found=names.find(x=>m.includes(x));if(found)fail(found==='OUT_OF_STOCK'?409:422,found,found.replaceAll('_',' ').toLowerCase());
 fail(500,'CHECKOUT_FAILED','Could not reserve order');
};
// Health
r.get('/health',wrap(async(req,res)=>{const {error}=await db.from('categories').select('id',{head:true,count:'exact'});ok(res,{status:error?'degraded':'ok',database:!error})}));
// Auth: Supabase hashes passwords and issues tokens; role is never user-controlled.
r.post('/auth/register',wrap(async(req,res)=>{const x=z.object({email:z.string().email(),password:z.string().min(8).max(72),full_name:z.string().min(2).max(100)}).strict().parse(req.body);const existing=result(await db.from('profiles').select('id').eq('email',x.email).maybeSingle());if(existing)fail(409,'EMAIL_EXISTS','Email already registered');const {data,error}=await authClient.auth.signUp({email:x.email,password:x.password,options:{data:{full_name:x.full_name}}});if(error)fail(error.status===429?429:422,'REGISTER_FAILED',error.message);ok(res,{user_id:data.user?.id,email_confirmation_required:!data.session,session:data.session||null},undefined,201)}));
r.post('/auth/login',wrap(async(req,res)=>{const x=z.object({email:z.string().email(),password:z.string().min(1)}).strict().parse(req.body);const {data,error}=await authClient.auth.signInWithPassword(x);if(error||!data.session)fail(401,'INVALID_CREDENTIALS','Invalid email or password');ok(res,{access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_in:data.session.expires_in,user:{id:data.user.id,email:data.user.email}})}));
r.post('/auth/refresh',wrap(async(req,res)=>{const {refresh_token}=z.object({refresh_token:z.string().min(10)}).strict().parse(req.body);const {data,error}=await authClient.auth.refreshSession({refresh_token});if(error||!data.session)fail(401,'INVALID_REFRESH','Invalid refresh token');ok(res,{access_token:data.session.access_token,refresh_token:data.session.refresh_token})}));
r.get('/auth/me',auth,wrap(async(req,res)=>ok(res,req.user)));
// Public catalog
r.get('/categories',wrap(async(req,res)=>ok(res,result(await db.from('categories').select('*').order('name')))));
r.get('/products',wrap(async(req,res)=>{
 const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(12),search:z.string().max(100).optional(),category:z.string().max(80).optional(),min_price:z.coerce.number().min(0).optional(),max_price:z.coerce.number().min(0).optional(),sort:z.enum(['newest','price_asc','price_desc']).default('newest')}).parse(req.query);
 let query=db.from('products').select('*,categories(name,slug)',{count:'exact'}).eq('active',true);
 if(q.search)query=query.ilike('name','%'+q.search.replace(/[%_]/g,'')+'%');
 if(q.category){const cat=result(await db.from('categories').select('id').eq('slug',q.category).maybeSingle());if(!cat)return ok(res,[],{page:q.page,limit:q.limit,total:0});query=query.eq('category_id',cat.id)}
 if(q.min_price!==undefined)query=query.gte('price',q.min_price);if(q.max_price!==undefined)query=query.lte('price',q.max_price);
 query=q.sort==='price_asc'?query.order('price',{ascending:true}):q.sort==='price_desc'?query.order('price',{ascending:false}):query.order('created_at',{ascending:false});
 const {data,error,count}=await query.range((q.page-1)*q.limit,q.page*q.limit-1);dbError(error);ok(res,data,{page:q.page,limit:q.limit,total:count||0});
}));
r.get('/products/:id',wrap(async(req,res)=>{const x=uuid.parse(req.params.id);const v=result(await db.from('products').select('*,categories(name,slug)').eq('id',x).eq('active',true).maybeSingle());if(!v)fail(404,'NOT_FOUND','Watch not found');ok(res,v)}));
// Watch-specific feature 1: reliable, database-backed comparison
r.post('/watches/compare',wrap(async(req,res)=>{const {ids}=z.object({ids:z.array(uuid).min(2).max(4)}).strict().parse(req.body);if(new Set(ids).size!==ids.length)fail(422,'DUPLICATE_WATCH','Comparison IDs must be unique');const watches=result(await db.from('products').select('id,name,sku,price,stock,model_number,series,movement,water_resistance_m,strap_material,warranty_months').in('id',ids).eq('active',true));if(watches.length!==ids.length)fail(404,'NOT_FOUND','One or more watches unavailable');ok(res,ids.map(id=>watches.find(w=>w.id===id)))}));
// User cart
r.get('/cart',auth,wrap(async(req,res)=>{const rows=result(await db.from('cart_items').select('product_id,quantity,products(id,name,price,stock,active,image_url)').eq('user_id',req.user.id));const items=rows.map(x=>({...x,line_total:Number((x.quantity*Number(x.products.price)).toFixed(2)),available:x.products.active&&x.quantity<=x.products.stock}));ok(res,{items,subtotal:Number(items.reduce((a,x)=>a+x.line_total,0).toFixed(2)),item_count:items.reduce((a,x)=>a+x.quantity,0)})}));
r.post('/cart/items',auth,wrap(async(req,res)=>{const {product_id,quantity}=z.object({product_id:uuid,quantity:z.number().int().min(1).max(20)}).strict().parse(req.body);const p=result(await db.from('products').select('stock,active').eq('id',product_id).maybeSingle());if(!p||!p.active)fail(404,'NOT_FOUND','Watch unavailable');const existing=result(await db.from('cart_items').select('quantity').eq('user_id',req.user.id).eq('product_id',product_id).maybeSingle());const total=quantity+(existing?.quantity||0);if(total>p.stock)fail(409,'OUT_OF_STOCK','Not enough stock');dbError((await db.from('cart_items').upsert({user_id:req.user.id,product_id,quantity:total})).error);ok(res,{product_id,quantity:total},undefined,201)}));
r.patch('/cart/items/:id',auth,wrap(async(req,res)=>{const product_id=uuid.parse(req.params.id);const {quantity}=z.object({quantity:z.number().int().min(1).max(20)}).strict().parse(req.body);const p=result(await db.from('products').select('stock,active').eq('id',product_id).maybeSingle());if(!p||!p.active)fail(404,'NOT_FOUND','Watch unavailable');if(quantity>p.stock)fail(409,'OUT_OF_STOCK','Not enough stock');const {data,error}=await db.from('cart_items').update({quantity}).eq('user_id',req.user.id).eq('product_id',product_id).select().maybeSingle();dbError(error);if(!data)fail(404,'NOT_FOUND','Cart item not found');ok(res,data)}));
r.delete('/cart/items/:id',auth,wrap(async(req,res)=>{const {error}=await db.from('cart_items').delete().eq('user_id',req.user.id).eq('product_id',uuid.parse(req.params.id));dbError(error);res.status(204).end()}));
// Coupon preview is informational: checkout validates again atomically.
r.post('/coupons/validate',auth,wrap(async(req,res)=>{const {code}=z.object({code:z.string().min(3)}).strict().parse(req.body);const c=result(await db.from('coupons').select('*').eq('code',code.toUpperCase()).maybeSingle());if(!c||!c.active)fail(422,'COUPON_INVALID','Invalid coupon');if(c.expires_at&&new Date(c.expires_at)<new Date())fail(422,'COUPON_EXPIRED','Coupon expired');if(c.max_uses!==null&&c.used_count>=c.max_uses)fail(422,'COUPON_EXHAUSTED','Coupon exhausted');ok(res,{code:c.code,type:c.type,value:c.value,minimum_spend:c.minimum_spend})}));
// Checkout: price, discount and inventory are calculated/reserved inside a Postgres transaction.
r.post('/checkout',auth,wrap(async(req,res)=>{
 const x=z.object({shipping:ship,coupon_code:z.string().min(3).max(40).optional()}).strict().parse(req.body);
 const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>100)fail(422,'IDEMPOTENCY_REQUIRED','Idempotency-Key header (8-100 characters) required');
 const {data:reservation,error}=await db.rpc('place_watch_order',{p_user:req.user.id,p_key:key,p_shipping:x.shipping,p_code:x.coupon_code||null});if(error)checkCoupon(error);
 const order=await selectOrder(reservation.order_id);if(!order)fail(500,'ORDER_MISSING','Order missing');
 if(order.checkout_url)return ok(res,{order,checkout_url:order.checkout_url,reused:true});
 if(reservation.reused)fail(409,'CHECKOUT_IN_PROGRESS','Checkout session being created; retry shortly');
 // A unique RRN per payment attempt; 36-char UUID acceptable to Maya.
 const ref=randomUUID();
 try{
  const remote=await maya.createCheckout({totalAmount:{value:Number(order.total),currency:'PHP'},requestReferenceNumber:ref,redirectUrl:{success:env.frontendUrl+'/payment/success?order='+order.id,failure:env.frontendUrl+'/payment/failure?order='+order.id,cancel:env.frontendUrl+'/payment/cancel?order='+order.id}});
  const checkoutId=remote.checkoutId||remote.id;const url=remote.redirectUrl;
  if(!checkoutId||!url)fail(502,'MAYA_BAD_RESPONSE','Maya did not return checkout details');
  const {error:e}=await db.rpc('set_checkout_session',{p_order:order.id,p_checkout:String(checkoutId),p_url:url,p_reference:ref});if(e)fail(500,'SESSION_SAVE_FAILED','Unable to record checkout session');
  ok(res,{order:await selectOrder(order.id),checkout_url:url,reused:false},undefined,201);
 }catch(e){
  // Avoid orphaning a known remote checkout session; manual reconciliation if save fails.
  if(e.code!=='SESSION_SAVE_FAILED')await db.rpc('change_order_status',{p_order:order.id,p_new:'payment_review',p_reason:'Maya checkout status uncertain; manual review required'});
  throw e;
 }
}));
r.get('/orders',auth,wrap(async(req,res)=>{const x=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).parse(req.query);const {data,error,count}=await db.from('orders').select('id,status,total,created_at,checkout_url',{count:'exact'}).eq('user_id',req.user.id).order('created_at',{ascending:false}).range((x.page-1)*x.limit,x.page*x.limit-1);dbError(error);ok(res,data,{total:count||0,page:x.page,limit:x.limit})}));
r.get('/orders/:id',auth,wrap(async(req,res)=>{const order=await selectOrder(uuid.parse(req.params.id));if(!order||order.user_id!==req.user.id)fail(404,'NOT_FOUND','Order not found');ok(res,order)}));
r.post('/orders/:id/cancel',auth,wrap(async(req,res)=>{const order=await selectOrder(uuid.parse(req.params.id));if(!order||order.user_id!==req.user.id)fail(404,'NOT_FOUND','Order not found');if(order.status!=='pending_payment')fail(409,'ILLEGAL_TRANSITION','Cannot cancel this order');if(order.checkout_id){const payment=await maya.getByReference(order.request_reference);if(['PAYMENT_SUCCESS','CAPTURED'].includes(payment.paymentStatus||payment.status)||payment.isPaid)fail(409,'PAYMENT_ALREADY_COMPLETED','Payment already completed; contact support');}
 const {error}=await db.rpc('change_order_status',{p_order:order.id,p_new:'cancelled',p_actor:req.user.id,p_reason:'customer cancelled'});if(error)fail(409,'ILLEGAL_TRANSITION',error.message);ok(res,await selectOrder(order.id))}));
// Verified payment status drives the order lifecycle; identical webhooks never reapply.
async function reconcile(order,source){
 if(!order.checkout_id||!order.request_reference)fail(409,'NO_PAYMENT_SESSION','No Maya checkout session');
 const payment=await maya.getByReference(order.request_reference);
 const status=String(payment.paymentStatus||payment.status||'');
 const paymentId=String(payment.id||order.checkout_id);
 const amount=Number(payment.amount??payment.totalAmount?.value??NaN);
 const currency=payment.currency||payment.totalAmount?.currency;
 const paid=payment.isPaid===true||status==='PAYMENT_SUCCESS';
 const amountsMatch=Number.isFinite(amount)&&Math.round(amount*100)===Math.round(Number(order.total)*100)&&currency==='PHP';
 const ref=payment.requestReferenceNumber||payment.request_reference_number;
 if(ref&&ref!==order.request_reference)fail(409,'REFERENCE_MISMATCH','Gateway reference mismatch');
 const eventKey=`${paymentId}:${status}`;
 const {error:eventError}=await db.from('payment_events').upsert({event_key:eventKey,order_id:order.id,event_status:status||'UNKNOWN',payment_id:paymentId,amount:Number.isFinite(amount)?amount:null,currency:currency||null,payload:payment},{onConflict:'event_key',ignoreDuplicates:true});dbError(eventError);
 if(paid){
  if(!amountsMatch){if(order.status==='pending_payment')await db.rpc('change_order_status',{p_order:order.id,p_new:'payment_review',p_reason:'payment amount/currency mismatch'});return {verified:false,mismatch:true};}
  if(['pending_payment','payment_review'].includes(order.status)){const {error:e}=await db.rpc('change_order_status',{p_order:order.id,p_new:'paid',p_reason:source});if(e)fail(409,'ORDER_STATE_CONFLICT',e.message)}
 }else if(['PAYMENT_FAILED','PAYMENT_EXPIRED','PAYMENT_CANCELLED'].includes(status)&&order.status==='pending_payment'){
  const next=status==='PAYMENT_EXPIRED'?'expired':'payment_failed';const {error:e}=await db.rpc('change_order_status',{p_order:order.id,p_new:next,p_reason:source});if(e)fail(409,'ORDER_STATE_CONFLICT',e.message);
 }
 return {verified:paid&&amountsMatch,status};
}
r.post('/payments/maya/webhook',wrap(async(req,res)=>{
 verifyMayaWebhook(req.headers,req.body);
 const body=req.body;const paymentId=body.id;const reference=body.requestReferenceNumber;
 if(!paymentId&&!reference)return ok(res,{accepted:true,ignored:true});
 let query=db.from('orders').select('*');query=reference?query.eq('request_reference',reference):query.eq('checkout_id',paymentId);
 const order=result(await query.maybeSingle());if(!order)return ok(res,{accepted:true,ignored:true});
 await reconcile(order,'signed Maya webhook / gateway verified');ok(res,{accepted:true});
}));
r.post('/orders/:id/verify-payment',auth,wrap(async(req,res)=>{const order=await selectOrder(uuid.parse(req.params.id));if(!order||order.user_id!==req.user.id)fail(404,'NOT_FOUND','Order not found');const outcome=await reconcile(order,'customer-triggered gateway reconciliation');ok(res,{outcome,order:await selectOrder(order.id)})}));
// Watch-specific feature 2: warranty status and verified-fulfillment warranty dates
r.get('/warranties',auth,wrap(async(req,res)=>{const orders=result(await db.from('orders').select('id').eq('user_id',req.user.id));const ids=orders.map(x=>x.id);if(!ids.length)return ok(res,[]);const items=result(await db.from('order_items').select('id').in('order_id',ids));if(!items.length)return ok(res,[]);ok(res,result(await db.from('warranties').select('*').in('order_item_id',items.map(x=>x.id))))}));
r.post('/warranties/:id/claim',auth,wrap(async(req,res)=>{const id=uuid.parse(req.params.id);const {notes}=z.object({notes:z.string().min(10).max(2000)}).strict().parse(req.body);const row=result(await db.from('warranties').select('*,order_items(order_id)').eq('id',id).maybeSingle());if(!row)fail(404,'NOT_FOUND','Warranty not found');const order=result(await db.from('orders').select('user_id').eq('id',row.order_items.order_id).single());if(order.user_id!==req.user.id)fail(404,'NOT_FOUND','Warranty not found');if(row.claim_status!=='not_claimed'||new Date(row.ends_at)<new Date())fail(409,'WARRANTY_NOT_ELIGIBLE','Warranty claim not eligible');ok(res,result(await db.from('warranties').update({claim_status:'pending',claim_notes:notes,updated_at:new Date().toISOString()}).eq('id',id).select().single()))}));
// Admin catalog & categories
r.use('/admin',auth,admin);
r.get('/admin/categories',wrap(async(req,res)=>ok(res,result(await db.from('categories').select('*').order('name')))));
r.post('/admin/categories',wrap(async(req,res)=>{const x=z.object({name:z.string().min(2).max(80),slug:z.string().regex(/^[a-z0-9-]+$/)}).strict().parse(req.body);ok(res,result(await db.from('categories').insert(x).select().single()),undefined,201)}));
r.patch('/admin/categories/:id',wrap(async(req,res)=>{const x=z.object({name:z.string().min(2).max(80).optional(),slug:z.string().regex(/^[a-z0-9-]+$/).optional()}).strict().parse(req.body);ok(res,result(await db.from('categories').update(x).eq('id',uuid.parse(req.params.id)).select().single()))}));
r.get('/admin/products',wrap(async(req,res)=>ok(res,result(await db.from('products').select('*').order('created_at',{ascending:false})))));
r.post('/admin/products',wrap(async(req,res)=>{const x=productSchema.parse(req.body);ok(res,result(await db.from('products').insert(x).select().single()),undefined,201)}));
r.patch('/admin/products/:id',wrap(async(req,res)=>{const x=productSchema.partial().omit({stock:true}).parse(req.body);if(!Object.keys(x).length)fail(422,'EMPTY_UPDATE','Nothing to update');const {data,error}=await db.from('products').update({...x,updated_at:new Date().toISOString()}).eq('id',uuid.parse(req.params.id)).select().maybeSingle();dbError(error);if(!data)fail(404,'NOT_FOUND','Product not found');ok(res,data)}));
r.delete('/admin/products/:id',wrap(async(req,res)=>{const {data,error}=await db.from('products').update({active:false}).eq('id',uuid.parse(req.params.id)).select().maybeSingle();dbError(error);if(!data)fail(404,'NOT_FOUND','Product not found');res.status(204).end()}));
r.post('/admin/products/:id/stock',wrap(async(req,res)=>{const id=uuid.parse(req.params.id);const x=z.object({delta:z.number().int().min(-100000).max(100000).refine(n=>n!==0),reason:z.string().min(5).max(250)}).strict().parse(req.body);
 // Atomic stock adjustments via SQL RPC
 const {data,error}=await db.rpc('adjust_watch_stock',{p_product:id,p_delta:x.delta,p_actor:req.user.id,p_reason:x.reason});if(error){if(error.message.includes('NEGATIVE_STOCK'))fail(409,'NEGATIVE_STOCK','Cannot reduce stock below zero');fail(500,'STOCK_UPDATE_FAILED','Stock update failed')}ok(res,data)}));
r.get('/admin/stock-movements',wrap(async(req,res)=>ok(res,result(await db.from('stock_movements').select('*').order('created_at',{ascending:false}).limit(200)))));
r.get('/admin/coupons',wrap(async(req,res)=>ok(res,result(await db.from('coupons').select('*')))));
r.post('/admin/coupons',wrap(async(req,res)=>{const x=couponSchema.parse(req.body);ok(res,result(await db.from('coupons').insert({...x,code:x.code.toUpperCase()}).select().single()),undefined,201)}));
r.patch('/admin/coupons/:id',wrap(async(req,res)=>{const x=couponSchema.partial().parse(req.body);if(x.code)x.code=x.code.toUpperCase();const {data,error}=await db.from('coupons').update(x).eq('id',uuid.parse(req.params.id)).select().maybeSingle();dbError(error);if(!data)fail(404,'NOT_FOUND','Coupon missing');ok(res,data)}));
r.get('/admin/orders',wrap(async(req,res)=>{const x=z.object({status:z.string().optional(),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).parse(req.query);let q=db.from('orders').select('*',{count:'exact'});if(x.status)q=q.eq('status',x.status);const {data,error,count}=await q.order('created_at',{ascending:false}).range((x.page-1)*x.limit,x.page*x.limit-1);dbError(error);ok(res,data,{total:count||0,page:x.page,limit:x.limit})}));
r.get('/admin/orders/:id',wrap(async(req,res)=>{const v=await selectOrder(uuid.parse(req.params.id));if(!v)fail(404,'NOT_FOUND','Order missing');ok(res,v)}));
r.patch('/admin/orders/:id/status',wrap(async(req,res)=>{const {status}=z.object({status:z.enum(['processing','shipped','delivered'])}).strict().parse(req.body);const id=uuid.parse(req.params.id);const {error}=await db.rpc('change_order_status',{p_order:id,p_new:status,p_actor:req.user.id,p_reason:'admin fulfillment'});if(error)fail(409,'ILLEGAL_TRANSITION','Invalid order status change');ok(res,await selectOrder(id))}));
r.post('/admin/orders/:id/reconcile',wrap(async(req,res)=>{const order=await selectOrder(uuid.parse(req.params.id));if(!order)fail(404,'NOT_FOUND','Order not found');const outcome=await reconcile(order,'admin reconciliation');ok(res,{outcome,order:await selectOrder(order.id)})}));
r.post('/admin/orders/expire',wrap(async(req,res)=>{const orders=result(await db.from('orders').select('id').eq('status','pending_payment').lt('expires_at',new Date().toISOString()).limit(100));const outcomes=[];for(const row of orders){const order=await selectOrder(row.id);try{if(order.checkout_id)await reconcile(order,'expiry reconciliation');const after=await selectOrder(row.id);if(after.status==='pending_payment'){
 // Safety: gateway must be checked before releasing any reservation tied to checkout
 if(after.checkout_id){outcomes.push({id:row.id,status:'still_pending_gateway'});continue}
 await db.rpc('change_order_status',{p_order:row.id,p_new:'expired',p_reason:'expired without checkout session'});
 }outcomes.push({id:row.id,status:(await selectOrder(row.id)).status})}catch(e){outcomes.push({id:row.id,error:'requires manual reconciliation'})}}ok(res,outcomes)}));
r.get('/admin/dashboard',wrap(async(req,res)=>{const {data:orders,error}=await db.from('orders').select('status,total');dbError(error);const products=result(await db.from('products').select('id,name,sku,stock').lte('stock',5).eq('active',true));ok(res,{paid_orders:orders.filter(x=>['paid','processing','shipped','delivered'].includes(x.status)).length,gross_sales:orders.filter(x=>['paid','processing','shipped','delivered'].includes(x.status)).reduce((sum,x)=>sum+Number(x.total),0),pending_orders:orders.filter(x=>x.status==='pending_payment').length,low_stock:products})}));
r.get('/admin/warranties',wrap(async(req,res)=>ok(res,result(await db.from('warranties').select('*').order('updated_at',{ascending:false})))));
r.patch('/admin/warranties/:id',wrap(async(req,res)=>{const x=z.object({claim_status:z.enum(['approved','rejected','resolved']),serial_number:z.string().min(4).max(100).optional()}).strict().parse(req.body);const {data,error}=await db.from('warranties').update({...x,updated_at:new Date().toISOString()}).eq('id',uuid.parse(req.params.id)).select().maybeSingle();dbError(error);if(!data)fail(404,'NOT_FOUND','Warranty not found');ok(res,data)}));
export default r;
