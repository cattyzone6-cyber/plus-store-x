-- One "you haven't paid yet" reminder per deposit, sent halfway to its expiry.
alter table public.deposits add column if not exists reminded_at timestamptz;
