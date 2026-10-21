# Store owner setup guide

<div dir="rtl">

**ملخص بالعربية:** هذا الدليل لصاحب المتجر. ستحتاج إلى: بوت من BotFather، ومشروع Supabase (قاعدة البيانات وتسجيل الدخول)، ومستودع GitHub خاص يستقبل التحديثات من المبرمج تلقائياً، وحساب Cloudflare يقوم بالنشر تلقائياً عند كل تحديث. بعد الإعداد تفتح لوحة التحكم على ‎`/admin`‎ وتضيف المزودين وطرق الدفع والمنتجات. إذا كان حساب تيليجرام المالك للبوت مشتركاً في Premium يمكنك استخدام الإيموجي المتحركة المخصصة، وإلا تُستخدم الإيموجي العادية.

</div>

You will create four things, all in **your own** accounts:

| What | Why | Cost |
|---|---|---|
| Telegram bot (BotFather) | the store itself | free |
| Supabase project | database + admin login | free tier is enough to start |
| GitHub repository (private) | receives code updates from the coder | free |
| Cloudflare Worker | runs the bot, the admin panel and the landing page; deploys automatically on every update | free plan to start, $5/month Paid plan later |

Keep every key you create private. Only you need them; the coder never needs your production keys.

---

## 1. Create the Telegram bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` → choose a name and a username (must end in `bot`).
2. Copy the **bot token** (`123456789:AA...`). This is `TELEGRAM_BOT_TOKEN`.
3. Optional: `/setuserpic` to upload the store logo.

**Custom animated emoji.** Telegram only lets a bot use custom (Premium) emoji in its messages and buttons if the account that owns the bot in BotFather has **Telegram Premium**. If you have Premium, you can enable it later in the panel (**Bot → Premium emoji**). If you don't, the bot uses normal emoji automatically.

## 2. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) → **New project**. Choose a region close to your customers and **save the database password**.
2. **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / publishable** key → `SUPABASE_ANON_KEY`
   - **service_role / secret** key → `SUPABASE_SERVICE_ROLE_KEY`. This one is secret and gives full access; never share it.
3. **Create the tables.** Pick one option:
   - **Option A, automatic (recommended).** In your GitHub repo (step 3), add these secrets under **Settings → Secrets and variables → Actions**:
     `SUPABASE_ACCESS_TOKEN` ([create one here](https://supabase.com/dashboard/account/tokens)), `SUPABASE_PROJECT_REF` (the id in your dashboard URL, e.g. `abcdefghijklmnop`) and `SUPABASE_DB_PASSWORD`.
     Every update that contains database changes is then applied for you by the **Database migrations** action. To run it the first time, open **Actions → Database migrations → Run workflow**.
   - **Option B, by hand.** Open **SQL Editor** and run each file from `supabase/migrations/` **in name order** (oldest first), one at a time. Repeat this for every new migration file the coder adds.
   - Never run `supabase/seed.sql` on your project. It is demo data for the coder's laptop.
4. **Disable public sign-ups:** **Authentication → Sign In / Providers → Allow new users to sign up → off**.
5. **Create your admin login:** **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick *Auto confirm*. Put this email in `OWNER_EMAILS` (step 4).
6. **Storage (images):** **Storage → New bucket** named `public-assets`, **Public** on. The panel uploads logos and product images here.

## 3. Create your GitHub repository

1. On GitHub → **New repository** → name it e.g. `plus-store-x`, **Private**, *without* README.
2. Ask the coder for their **deploy key** (one line starting with `ssh-ed25519`).
3. In your repo: **Settings → Deploy keys → Add deploy key** → paste it, and tick **Allow write access**.
4. Tell the coder your repo name (`your-username/plus-store-x`). From now on, every update the coder releases for you lands in your repo's `main` branch automatically.

> Don't commit to `main` yourself: the coder's updates overwrite it.

## 4. Create the Cloudflare Worker

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Import a repository**.
2. Connect GitHub, then select your repo.
3. Build settings:
   - **Project name:** the same as `"name"` in `wrangler.jsonc`. The coder sets it for you; ask if unsure.
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`
4. Save and deploy. From now on **every push to `main` deploys automatically**.
5. **Settings → Variables and Secrets**. Add each of these as type **Secret**:

   | Name | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | from step 1 |
   | `TELEGRAM_WEBHOOK_SECRET` | random value, see below |
   | `ENCRYPTION_KEY` | random value, see below. **Never change it later**: it encrypts the provider and payment API keys you save in the panel |
   | `SUPABASE_URL` | from step 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
   | `SUPABASE_ANON_KEY` | from step 2 |
   | `OWNER_EMAILS` | your admin email(s), comma separated |

   To generate the two random values, run `npm run gen:key` in the project, or ask the coder to generate them for you once. Any 32-byte base64 value works for `ENCRYPTION_KEY`.
6. Deploy again (**Deployments → Retry** or push any change), so the secrets are loaded.

Your store is now live at `https://<project-name>.<your-subdomain>.workers.dev`.

## 5. First login and configuration

1. Open `https://<your-worker>.workers.dev/admin/` and log in with the user from step 2.5.
2. **System**: press **Set webhook**, then **Set bot commands**. Telegram now sends messages to your Worker.
3. **Settings → Brand**: store name, bot username (without `@`), channel/group links, support username.
4. **Providers → Add provider**, for each supplier:

   | Supplier | Kind | Base URL |
   |---|---|---|
   | Storebat | `ventebot` | `https://web-production-1c7b1.up.railway.app` |
   | NovasGlobal | `canboso` | `https://canboso.com` |
   | HitMeow Store | `canboso` | `https://canboso.com` |

   Paste the API key or token, press **Test**, then **Sync now**. Their products appear under **Provider catalog**. Import the ones you want to sell. You can group the same product from several suppliers into one store product, or keep them separate.
5. **Payments**: enable the methods you use.
   - **Binance Pay (merchant):** API key and secret from the Binance Merchant portal. Set the webhook URL there to `https://<your-domain>/webhook/binance-pay`.
   - **Binance Pay ID (personal):** your Pay ID, plus a Binance API key with **read-only** permission (used only to confirm incoming transfers).
   - **NOWPayments (USDT BEP20):** API key and IPN secret from the NOWPayments dashboard. Set the IPN callback URL to `https://<your-domain>/webhook/nowpayments`. Set the minimum deposit in the panel.
   - **ShamCash (manual):** account name and number (or QR). Customers upload proof, and you approve it from the panel or from the admin Telegram group.
6. **Notifications**: add the bot to a private Telegram group, then put that group's chat id in **Settings → Notifications**. You receive orders, deposits, failures, low stock and low provider balance alerts there.
7. Open your bot in Telegram and send `/start`.

## 6. Custom domain (later)

1. Add your domain to Cloudflare (**Websites → Add a site**) and follow the nameserver steps.
2. **Workers & Pages → your worker → Settings → Domains & Routes → Add → Custom domain**, e.g. `yourstore.com`.
   - `https://yourstore.com/` is the landing page.
   - `https://yourstore.com/admin/` is the admin panel.
3. In the panel: **System → Public base URL** = `https://yourstore.com`, then press **Set webhook** again.
4. Update the webhook URLs at Binance Pay and NOWPayments to the new domain.

## 7. Cloudflare Paid plan (later)

The free plan works. The Paid plan ($5/month) adds background queues and more processing time, which helps big broadcasts and busy hours.

1. Subscribe: **Workers & Pages → Plans**.
2. Ask the coder to enable the queue on your branch. They create the queue and uncomment the `queues` block in `wrangler.jsonc`.
3. After the update deploys, switch **System → Plan** to **Paid** in the panel.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot doesn't answer | **System → Set webhook** again. Check **Workers → your worker → Logs** |
| Webhook shows `401` in **System → Webhook info** | `TELEGRAM_WEBHOOK_SECRET` changed. Press **Set webhook** again |
| Panel login says "not an admin" | your email is not in `OWNER_EMAILS`, or you were not added under **Admins** |
| `ENCRYPTION_KEY` error / provider keys unreadable | the key was changed or is not 32 bytes. Restore the old one, or re-enter all provider and payment keys |
| "relation … does not exist" errors | migrations were not applied. Run **Actions → Database migrations**, or paste the missing SQL files |
| Build fails in Cloudflare | open the build log. Usually the project name differs from `"name"` in `wrangler.jsonc` |
| Deposits not confirmed automatically | check the webhook URLs at Binance / NOWPayments, and that the API keys in **Payments** are saved |
| Custom emoji show as normal emoji | the BotFather owner account has no Premium, or **Bot → Premium emoji** is off |
