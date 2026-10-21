import type { Job } from './lib/jobs';

export interface Env {
  // bindings
  ASSETS: Fetcher;
  JOBS?: Queue<Job>; // optional: only on the Workers Paid plan (see wrangler.jsonc)

  // vars
  APP_ENV: string;

  // secrets
  OWNER_EMAILS?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  ENCRYPTION_KEY: string;
}

/** Everything a service needs: env + a way to run work after the response is sent. */
export interface AppCtx {
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
}
