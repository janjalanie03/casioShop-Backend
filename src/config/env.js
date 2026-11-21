import 'dotenv/config';
const required = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','MAYA_PUBLIC_KEY','MAYA_SECRET_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
export const env = {
  port: Number(process.env.PORT || 4000), nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_PUBLISHABLE_KEY, serviceKey: process.env.SUPABASE_SECRET_KEY,
  mayaPublic: process.env.MAYA_PUBLIC_KEY, mayaSecret: process.env.MAYA_SECRET_KEY,
  mayaBase: process.env.MAYA_API_BASE || 'https://pg-sandbox.paymaya.com',
  mayaWebhookKeys: [process.env.MAYA_WEBHOOK_PUBLIC_KEY_1,process.env.MAYA_WEBHOOK_PUBLIC_KEY_2].filter(Boolean),
  apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(x=>x.trim())
};
if (!env.mayaBase.startsWith('https://pg-sandbox.paymaya.com')) throw new Error('Sandbox-only backend: MAYA_API_BASE must be the official sandbox');
