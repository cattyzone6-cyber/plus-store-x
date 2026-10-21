# Client branches: one codebase, many stores

This guide is for the coder (repo `GH-ZX/plus-store-x`, private).

## Branch model

```
main                 product core: every feature, fix and migration lands here first
client/owner1        main + owner1-specific changes (worker name, custom tweaks)
client/owner2        main + owner2-specific changes
```

- **`main`** never deploys anywhere by itself.
- Each **`client/<name>`** branch is mirrored to that client's own repo (`main`) by the
  [Sync client repo](../.github/workflows/sync-client.yml) Action. The client's Cloudflare Workers Builds then deploys it.
- Client-specific edits (e.g. `"name"` in `wrangler.jsonc`, enabling the queue, a custom feature) happen **only on that client's branch**.
- Branding, texts, providers, payments and features are **settings in the admin panel**, not code. Most clients never need code changes.

```
GH-ZX/plus-store-x                      OWNER/plus-store-x            Cloudflare (owner)
┌──────────────────┐   git push   ┌──────────────────┐  sync action  ┌──────────────┐  auto  ┌────────────┐
│ main             │─── merge ───▶│ client/owner1    │──────────────▶│ main         │───────▶│ Worker     │
└──────────────────┘              └──────────────────┘   (force)     └──────────────┘ deploy └────────────┘
                                                                            │ db-migrate action
                                                                            ▼
                                                                     Supabase (owner)
```

## Shipping an update to a client

```bash
git checkout client/owner1
```

```bash
git merge main
```

```bash
git push
```

After the push:

1. **Sync client repo** force-pushes `client/owner1` to `OWNER/plus-store-x@main`. The client's `main` always equals your branch exactly.
2. The client's Cloudflare **Workers Builds** runs `npm run build` and `npx wrangler deploy`.
3. If the update contains new files in `supabase/migrations/`, the client's **Database migrations** Action applies them. This needs the client's Supabase secrets to be set (see [SETUP-OWNER.md](SETUP-OWNER.md) step 2.3). Otherwise they paste the new SQL files by hand.

> **Migrations must be additive and backward compatible.** Old code may run against a new schema for a few
> minutes during a deploy. Never edit a migration that has already shipped; add a new one instead.

To ship the same release to every client, repeat the merge for each `client/*` branch.

## Adding a new client

1. **Create the branch:**

   ```bash
   git checkout -b client/<name> main
   ```

   Set `"name"` in `wrangler.jsonc` to the client's Worker name, commit, and push.

2. **Generate a deploy key pair** (one per client):

   ```bash
   ssh-keygen -t ed25519 -C "plus-store-x deploy <name>" -f deploy_<name> -N ""
   ```

3. **Public key → the client.** The client adds `deploy_<name>.pub` to *their* repo under **Settings → Deploy keys**, with **Allow write access**.

4. **Private key → your repo secret.** In `GH-ZX/plus-store-x` → **Settings → Secrets and variables → Actions → New repository secret**:
   - name: `DEPLOY_KEY_<NAME>` (e.g. `DEPLOY_KEY_OWNER1`)
   - value: the full contents of `deploy_<name>` (the private key, including the BEGIN/END lines)

   Then delete both local key files.

5. **Register the client** in [.github/clients.json](../.github/clients.json):

   ```json
   {
     "name": "owner1",
     "branch": "client/owner1",
     "repo": "OWNER_GITHUB/plus-store-x",
     "deploy_key_secret": "DEPLOY_KEY_OWNER1"
   }
   ```

   Commit this to `main` and merge it into the client branch: the workflow reads `clients.json` from the pushed branch.

6. **First sync.** Push the client branch, or run **Actions → Sync client repo → Run workflow** with the branch name.
7. The client follows [SETUP-OWNER.md](SETUP-OWNER.md) (Supabase, Cloudflare, secrets, first login).

## Removing a client

Delete their entry from `clients.json`, delete the `DEPLOY_KEY_<NAME>` secret, and ask them to remove the deploy key. Their repo keeps the last version that was mirrored.

## Notes

- The workflow only ever pushes the branch that triggered it. `main` and other clients' branches never leave your repo.
- `clients.json` contains only repo names and secret *names*, never keys.
- The `.github/workflows` folder is mirrored too. In the client repo, `sync-client.yml` never triggers, because there are no `client/**` branches there. `db-migrate.yml` runs only when the client has set their Supabase secrets.
- Enabling the Cloudflare Paid plan for a client means creating the queue in their account (`npx wrangler queues create <name>-jobs`, done by the client or with their API token) and uncommenting the `queues` block on their branch only.
