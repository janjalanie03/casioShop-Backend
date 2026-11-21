import { db, authClient } from '../config/supabase.js';
import { fail } from '../utils/http.js';
export async function auth(req,res,next){
 try{
  const match=/^Bearer (.+)$/i.exec(req.headers.authorization||'');if(!match)fail(401,'UNAUTHENTICATED','Bearer token required');
  const {data,error}=await authClient.auth.getUser(match[1]);
  if(error||!data.user)fail(401,'UNAUTHENTICATED','Invalid or expired token');
  const {data:profile,error:pe}=await db.from('profiles').select('id,email,role,full_name').eq('id',data.user.id).single();
  if(pe||!profile)fail(403,'PROFILE_MISSING','User profile not available');
  req.user=profile;next();
 }catch(e){next(e)}
}
export const admin=(req,res,next)=>req.user?.role==='admin'?next():next(Object.assign(new Error('Administrator only'),{status:403,code:'FORBIDDEN'}));
