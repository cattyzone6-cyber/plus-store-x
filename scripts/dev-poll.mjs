#!/usr/bin/env node
// Local development: receive Telegram updates without a public URL.
// Removes the bot webhook once, long-polls getUpdates and forwards every update to
// the local worker (`npm run dev` → http://127.0.0.1:8787/webhook/telegram).
//
// Usage: npm run dev:poll   (reads TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET from .dev.vars)
// NOTE: while this runs, the production webhook is removed. Re-set it from the admin
// panel (System → Set webhook) when you are done testing with a production bot.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readDevVars(file = '.dev.vars') {
  const out = {};
  let text;
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    console.error(`✖ ${file} not found. Copy .dev.vars.example to .dev.vars first.`);
    process.exit(1);
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const vars = readDevVars();
const TOKEN = vars.TELEGRAM_BOT_TOKEN;
const SECRET = vars.TELEGRAM_WEBHOOK_SECRET || '';
const TARGET = process.env.WEBHOOK_TARGET || 'http://127.0.0.1:8787/webhook/telegram';

if (!TOKEN || TOKEN.startsWith('123456:')) {
  console.error('✖ TELEGRAM_BOT_TOKEN missing in .dev.vars');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const me = await api('getMe');
  if (!me.ok) {
    console.error('✖ getMe failed:', me.description);
    process.exit(1);
  }
  console.log(`🤖 @${me.result.username} — forwarding updates to ${TARGET}`);

  const del = await api('deleteWebhook', { drop_pending_updates: false });
  console.log(del.ok ? '✔ webhook removed (polling mode)' : `⚠ deleteWebhook: ${del.description}`);

  let offset = 0;
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\n👋 stopping…');
    process.exit(0);
  });

  while (!stopping) {
    let res;
    try {
      res = await api('getUpdates', { offset, timeout: 30, allowed_updates: [] });
    } catch (e) {
      console.error('⚠ getUpdates network error, retrying in 3s:', e.message);
      await sleep(3000);
      continue;
    }
    if (!res.ok) {
      console.error('⚠ getUpdates:', res.description);
      await sleep(res.parameters?.retry_after ? res.parameters.retry_after * 1000 : 3000);
      continue;
    }
    for (const update of res.result) {
      offset = update.update_id + 1;
      const kind = Object.keys(update).find((k) => k !== 'update_id');
      const t0 = Date.now();
      try {
        const r = await fetch(TARGET, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
          body: JSON.stringify(update),
        });
        const ms = Date.now() - t0;
        const mark = r.ok ? '→' : '✖';
        console.log(`${mark} #${update.update_id} ${kind} ${r.status} (${ms}ms)`);
        if (!r.ok) console.log('   ', (await r.text()).slice(0, 300));
      } catch (e) {
        console.error(`✖ #${update.update_id} ${kind}: worker not reachable (${e.message}). Is \`npm run dev\` running?`);
      }
    }
  }
}

main();
