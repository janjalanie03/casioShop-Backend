import {createVerify,createPublicKey} from 'node:crypto';
import {env} from '../config/env.js';
import {fail} from '../utils/http.js';
function flatten(obj,prefix='',out=[]){
 for(const [k,v] of Object.entries(obj)){const path=prefix?prefix+'.'+k:k;
  if(v===null||v===undefined||v===''||(typeof v==='object'&&Object.keys(v).length===0))continue;
  if(typeof v==='object')flatten(v,path,out);else out.push(`${path}=${String(v)}`);
 }return out;
}
function parseKey(value){if(value.includes('BEGIN PUBLIC KEY'))return value.replace(/\\n/g,'\n');return createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'});}
export function verifyMayaWebhook(headers,body){
 const timestamp=Number(headers['x-maya-webhook-timestamp']);const h=headers['x-maya-webhook-signature']||'';
 const parts=Object.fromEntries(h.split(',').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()]}));
 if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>300000)fail(401,'BAD_WEBHOOK_TIMESTAMP','Webhook timestamp invalid');
 if(!parts.nonce||!parts.v1||!/^[a-f0-9]+$/i.test(parts.v1))fail(401,'BAD_WEBHOOK_SIGNATURE','Webhook signature missing');
 if(!env.mayaWebhookKeys.length)fail(503,'WEBHOOK_NOT_CONFIGURED','Maya webhook public keys are not configured');
 const msg=flatten(body).sort().join('&')+'&nonce='+parts.nonce;
 const valid=env.mayaWebhookKeys.some(value=>{try{return createVerify('RSA-SHA256').update(msg).end().verify(parseKey(value),Buffer.from(parts.v1,'hex'))}catch{return false}});
 if(!valid)fail(401,'BAD_WEBHOOK_SIGNATURE','Webhook signature invalid');
 return true;
}
