#!/usr/bin/env node
// Prints fresh random values for the Worker secrets.
//   ENCRYPTION_KEY          32 random bytes, base64 (encrypts provider/payment API keys in the DB)
//   TELEGRAM_WEBHOOK_SECRET random token Telegram sends back with every update
// Keep ENCRYPTION_KEY forever: changing it makes stored API keys unreadable (re-enter them in the panel).
import { randomBytes } from 'node:crypto';

console.log(`ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.log(`TELEGRAM_WEBHOOK_SECRET=${randomBytes(24).toString('hex')}`);
