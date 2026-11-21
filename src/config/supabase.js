import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
const opts = { auth:{persistSession:false,autoRefreshToken:false} };
export const db = createClient(env.supabaseUrl,env.serviceKey,opts); // backend only
export const authClient = createClient(env.supabaseUrl,env.anonKey,opts);
