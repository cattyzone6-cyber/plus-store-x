# Database backups

Supabase's free plan keeps no backups you can restore, and this database holds customer
balances, orders and stock. The **Database backup** GitHub Action (`.github/workflows/db-backup.yml`)
runs in the store owner's repository every day at 02:17 UTC:

1. dumps the Supabase database (store schema, all store data, and the admin logins),
2. encrypts it with your passphrase (AES-256),
3. keeps it as a private download on the workflow run for 30 days.

Only people with access to the repository can download it, and only someone with the
passphrase can open it.

## Turn it on (once)

In **your** GitHub repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Create one at https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | The project id from the dashboard URL (`supabase.com/dashboard/project/<this part>`) |
| `SUPABASE_DB_PASSWORD` | The database password (Project Settings → Database; reset it there if unknown) |
| `BACKUP_PASSPHRASE` | A long random passphrase. **Store it in a password manager: without it the backups cannot be opened.** |

The first three are the same secrets the **Database migrations** workflow uses, so adding them
also turns on automatic migrations.

Then run it once by hand to check: Actions → **Database backup** → Run workflow. A green run
with an artifact named `db-backup-<date>` means it works.

To keep backups longer or shorter, change `BACKUP_RETENTION_DAYS` in the workflow
(GitHub allows up to 90 days on private repositories).

## Download and open a backup

1. Actions → **Database backup** → pick a run → **Artifacts** → download `db-backup-<date>` (a .zip).
2. Unzip it, then decrypt and unpack (Linux / macOS / Git Bash on Windows):

```bash
gpg --batch --pinentry-mode loopback --passphrase "YOUR_PASSPHRASE" -d plus-store-x-db-<date>.tar.gz.gpg > backup.tar.gz
tar -xzf backup.tar.gz
```

You now have `schema.sql`, `data.sql` and `auth.sql`.

## Restore into a new, empty Supabase project

Only do this when the original project is lost. Restoring into a project that already has data
creates duplicates.

1. Create a new Supabase project and copy its connection string
   (Project Settings → Database → Connection string → URI, session mode).
2. Load the files in this order with `psql` (install PostgreSQL client tools if needed):

```bash
psql "<connection string>" -f schema.sql
```

```bash
psql "<connection string>" -f auth.sql
```

```bash
psql "<connection string>" -f data.sql
```

3. In Cloudflare, update the Worker secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` to the new project. Keep the same `ENCRYPTION_KEY`, otherwise the
   saved provider tokens and payment keys cannot be decrypted.
4. Open the admin panel → System → **Set webhook**, and check that orders and balances look right.

If anything goes wrong during a restore, stop and contact the developer before retrying.
