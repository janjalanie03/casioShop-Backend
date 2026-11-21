import {db} from './config/supabase.js';
import {env} from './config/env.js';
const categories=[['G-SHOCK','g-shock'],['BABY-G','baby-g'],['EDIFICE','edifice'],['Vintage','vintage'],['Classic','classic']];
for(const [name,slug] of categories){const {error}=await db.from('categories').upsert({name,slug},{onConflict:'slug'});if(error)throw error}
const {data:cats,error:cErr}=await db.from('categories').select('id,slug');if(cErr)throw cErr;
const names=[
['G-SHOCK GA-2100','g-shock',7495,'Quartz',200],['G-SHOCK DW-5600','g-shock',5795,'Digital',200],['G-SHOCK GA-100','g-shock',6995,'Quartz',200],['G-SHOCK GBD-H2000','g-shock',29995,'Solar',200],
['BABY-G BA-110','baby-g',6995,'Quartz',100],['BABY-G BGD-565','baby-g',5295,'Digital',100],['BABY-G MSG-S500','baby-g',11995,'Solar',100],['BABY-G BGA-280','baby-g',6495,'Quartz',100],
['EDIFICE EFV-100','edifice',4995,'Quartz',100],['EDIFICE ECB-30','edifice',9995,'Quartz',100],['EDIFICE EFR-571','edifice',8795,'Quartz',100],['EDIFICE EQB-1100','edifice',22995,'Solar',100],
['Vintage A168','vintage',1995,'Digital',30],['Vintage F-91W','vintage',1495,'Digital',30],['Vintage AE-1200','vintage',2495,'Digital',100],['Vintage A700','vintage',2995,'Digital',30],
['Classic MTP-1302','classic',3995,'Quartz',50],['Classic MTP-V002','classic',2295,'Quartz',30],['Classic LTP-V007','classic',1995,'Quartz',30],['Classic W-800H','classic',2495,'Digital',100]
];
for(const [name,slug,price,movement,wr] of names){const sku='CAS-'+name.split(' ').slice(-1)[0];const x={sku,name,description:`Casio-style demo catalog entry: ${name}. Verify product specifications and current pricing before publication.`,category_id:cats.find(c=>c.slug===slug).id,price,stock:12,active:true,model_number:name.split(' ').slice(-1)[0],series:slug,movement,water_resistance_m:wr,strap_material:'Resin / stainless steel (verify model)',warranty_months:12};const {error}=await db.from('products').upsert(x,{onConflict:'sku'});if(error)throw error}
const coupons=[{code:'WELCOME10',type:'percent',value:10,minimum_spend:1000,max_uses:100,per_customer_limit:1},{code:'WATCH500',type:'fixed',value:500,minimum_spend:5000,max_uses:40,per_customer_limit:1},{code:'CASIO15',type:'percent',value:15,minimum_spend:8000,max_uses:25,per_customer_limit:1}];
for(const c of coupons){const {error}=await db.from('coupons').upsert(c,{onConflict:'code'});if(error)throw error}
const accounts=[{email:process.env.SEED_ADMIN_EMAIL,role:'admin'},{email:'casio.customer1@example.com',role:'customer'},{email:'casio.customer2@example.com',role:'customer'}];
if(!process.env.SEED_ADMIN_EMAIL||!process.env.SEED_ADMIN_PASSWORD||process.env.SEED_ADMIN_PASSWORD.length<12)throw new Error('SEED_ADMIN_EMAIL and a 12+ char SEED_ADMIN_PASSWORD are required');
const {data:users,error:listError}=await db.auth.admin.listUsers({page:1,perPage:1000});if(listError)throw listError;
for(const a of accounts){const existing=users.users.find(x=>x.email===a.email);let user=existing;
 if(!user){const password=a.role==='admin'?process.env.SEED_ADMIN_PASSWORD:process.env.SEED_CUSTOMER_PASSWORD;if(!password||password.length<12)throw new Error('Strong SEED_CUSTOMER_PASSWORD required');const {data,error}=await db.auth.admin.createUser({email:a.email,password,email_confirm:true,user_metadata:{full_name:a.role==='admin'?'Casio Store Administrator':'Casio Demo Customer'}});if(error)throw error;user=data.user}
 const {error}=await db.from('profiles').upsert({id:user.id,email:a.email,role:a.role,full_name:a.role==='admin'?'Casio Store Administrator':'Demo Customer'},{onConflict:'id'});if(error)throw error;
}
console.log('Seeded 5 categories, 20 demo watches, 3 coupons, 1 admin and 2 customers.');
