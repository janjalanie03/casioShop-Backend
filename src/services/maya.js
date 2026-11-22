import axios from 'axios';
import { env } from '../config/env.js';
import { fail } from '../utils/http.js';
export class PaymentProvider {async createCheckout(){throw new Error('Not implemented')}async getPayment(){throw new Error('Not implemented')}}
export class MayaProvider extends PaymentProvider {
 constructor(){super();this.http=axios.create({baseURL:env.mayaBase,timeout:12000});}
 async call(method,url,key,data){try {const response=await this.http.request({method,url,data,headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),'Content-Type':'application/json'}});return response.data;}catch(e){console.error('Maya API error',e.response?.status||e.code);fail(502,'MAYA_UNAVAILABLE','Maya Sandbox request failed')}}
 createCheckout(payload){return this.call('POST','/checkout/v1/checkouts',env.mayaPublic,payload)}
 getPayment(id){return this.call('GET','/payments/v1/payments/'+encodeURIComponent(id),env.mayaSecret)}
 getByReference(ref){return this.call('GET','/payments/v1/payment-rrns/'+encodeURIComponent(ref),env.mayaSecret)}
}
export class DisabledPaymentProvider extends PaymentProvider {async createCheckout(){fail(503,'PAYMENTS_DISABLED','Payments disabled')}async getPayment(){fail(503,'PAYMENTS_DISABLED','Payments disabled')}}
export const paymentProviderFactory = type => type==='maya'?new MayaProvider():new DisabledPaymentProvider();
export const maya=env.mayaPublic&&env.mayaSecret?paymentProviderFactory('maya'):new DisabledPaymentProvider();
