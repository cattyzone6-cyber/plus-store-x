-- Plus Store X — atomic money / stock operations.
-- Every balance change goes through wallet_apply() so the ledger always matches users.balance.
-- Errors are raised with stable messages the Worker maps to user-facing text:
--   INSUFFICIENT_BALANCE, USER_NOT_FOUND, ORDER_NOT_FOUND, ORDER_NOT_PENDING, PROMO_EXHAUSTED,
--   PROMO_USER_LIMIT, INSUFFICIENT_STOCK, REFUND_EXCEEDS_TOTAL, CODE_INVALID, CODE_EXPIRED,
--   CODE_USED, CODE_EXHAUSTED, INSUFFICIENT_POINTS, DEPOSIT_NOT_FOUND

create or replace function public.wallet_apply(
  p_user_id    bigint,
  p_amount     numeric,
  p_type       text,
  p_ref_type   text default null,
  p_ref_id     text default null,
  p_note       text default null,
  p_created_by uuid default null
) returns numeric
language plpgsql as $$
declare v_balance numeric;
begin
  if p_amount = 0 then
    select balance into v_balance from public.users where id = p_user_id;
    if not found then raise exception 'USER_NOT_FOUND'; end if;
    return v_balance;
  end if;

  update public.users
     set balance = balance + p_amount
   where id = p_user_id
     and balance + p_amount >= 0
  returning balance into v_balance;

  if not found then
    if exists (select 1 from public.users where id = p_user_id) then
      raise exception 'INSUFFICIENT_BALANCE';
    end if;
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.wallet_ledger(user_id, amount, balance_after, type, ref_type, ref_id, note, created_by)
  values (p_user_id, p_amount, v_balance, p_type, p_ref_type, p_ref_id, p_note, p_created_by);

  return v_balance;
end $$;

-- Points (cashback). Positive = award, negative = spend.
create or replace function public.points_apply(
  p_user_id bigint, p_delta integer, p_reason text, p_ref_id text default null
) returns integer
language plpgsql as $$
declare v_points integer;
begin
  update public.users set points = points + p_delta
   where id = p_user_id and points + p_delta >= 0
  returning points into v_points;
  if not found then raise exception 'INSUFFICIENT_POINTS'; end if;
  insert into public.points_ledger(user_id, delta, reason, ref_id) values (p_user_id, p_delta, p_reason, p_ref_id);
  return v_points;
end $$;

-- Convert points to wallet balance.
create or replace function public.points_redeem(
  p_user_id bigint, p_points integer, p_usd_per_point numeric
) returns numeric
language plpgsql as $$
declare v_amount numeric;
begin
  if p_points <= 0 then raise exception 'INSUFFICIENT_POINTS'; end if;
  perform public.points_apply(p_user_id, -p_points, 'redeem');
  v_amount := round(p_points * p_usd_per_point, 4);
  return public.wallet_apply(p_user_id, v_amount, 'cashback', 'points', p_points::text, 'Points redeemed');
end $$;

-- Pay a pending order from the wallet (also consumes the promo code atomically).
create or replace function public.order_pay_wallet(p_order_id bigint)
returns public.orders
language plpgsql as $$
declare
  o public.orders;
  v_user_uses integer;
  v_limit integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'pending_payment' then raise exception 'ORDER_NOT_PENDING'; end if;

  if o.promo_code_id is not null then
    select per_user_limit into v_limit from public.promo_codes where id = o.promo_code_id;
    select count(*) into v_user_uses from public.promo_redemptions
      where promo_id = o.promo_code_id and user_id = o.user_id;
    if v_limit is not null and v_limit > 0 and v_user_uses >= v_limit then
      raise exception 'PROMO_USER_LIMIT';
    end if;
    update public.promo_codes set uses = uses + 1
     where id = o.promo_code_id and is_active and (max_uses is null or uses < max_uses);
    if not found then raise exception 'PROMO_EXHAUSTED'; end if;
    insert into public.promo_redemptions(promo_id, user_id, order_id, amount)
    values (o.promo_code_id, o.user_id, o.id, o.discount_amount);
  end if;

  perform public.wallet_apply(o.user_id, -o.total, 'purchase', 'order', o.id::text, o.code);

  update public.orders
     set status = 'paid', payment_method = 'wallet', paid_at = now()
   where id = o.id
  returning * into o;

  update public.users
     set total_spent = total_spent + o.total, orders_count = orders_count + 1
   where id = o.user_id;

  return o;
end $$;

-- Refund (part of) an order to the wallet.
create or replace function public.order_refund(
  p_order_id bigint, p_amount numeric, p_note text default null, p_by uuid default null
) returns public.orders
language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.paid_at is null then raise exception 'ORDER_NOT_PAID'; end if;
  if p_amount <= 0 or o.refunded_amount + p_amount > o.total + 0.00001 then
    raise exception 'REFUND_EXCEEDS_TOTAL';
  end if;

  perform public.wallet_apply(o.user_id, p_amount, 'refund', 'order', o.id::text, coalesce(p_note, 'Refund ' || o.code), p_by);

  update public.orders
     set refunded_amount = refunded_amount + p_amount,
         status = case when refunded_amount + p_amount >= total - 0.00001 then 'refunded' else 'partially_refunded' end,
         admin_note = coalesce(p_note, admin_note)
   where id = o.id
  returning * into o;

  update public.users set total_spent = greatest(0, total_spent - p_amount) where id = o.user_id;
  return o;
end $$;

-- Claim N available stock items for an order (all or nothing).
create or replace function public.stock_claim(p_product_id uuid, p_qty integer, p_order_id bigint)
returns setof public.stock_items
language plpgsql as $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from (
    select id from public.stock_items
     where product_id = p_product_id and status = 'available'
     order by created_at
     limit p_qty
     for update skip locked
  ) s;

  if coalesce(array_length(v_ids, 1), 0) < p_qty then raise exception 'INSUFFICIENT_STOCK'; end if;

  return query
  update public.stock_items
     set status = 'sold', order_id = p_order_id, sold_at = now()
   where id = any(v_ids)
  returning *;
end $$;

-- Credit a deposit exactly once (idempotent). Pays the referral bonus too.
-- Returns {"credited": bool, "user_id", "balance", "order_id", "referrer_id", "referral_bonus"}
create or replace function public.deposit_credit(
  p_deposit_id   uuid,
  p_credit       numeric,
  p_external_id  text default null,
  p_meta         jsonb default '{}'::jsonb,
  p_ref_percent  numeric default 0,
  p_reviewed_by  uuid default null
) returns jsonb
language plpgsql as $$
declare
  d public.deposits;
  v_balance numeric;
  v_referrer bigint;
  v_bonus numeric := 0;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  if d.status = 'paid' then
    return jsonb_build_object('credited', false, 'user_id', d.user_id, 'order_id', d.order_id);
  end if;

  update public.deposits
     set status = 'paid',
         credited_amount = p_credit,
         paid_at = now(),
         external_id = coalesce(p_external_id, external_id),
         meta = meta || coalesce(p_meta, '{}'::jsonb),
         reviewed_by = coalesce(p_reviewed_by, reviewed_by)
   where id = d.id;

  v_balance := public.wallet_apply(d.user_id, p_credit, 'deposit', 'deposit', d.id::text, d.method);
  update public.users set total_deposited = total_deposited + p_credit where id = d.user_id;

  select referrer_id into v_referrer from public.users where id = d.user_id;
  if v_referrer is not null and p_ref_percent > 0 then
    v_bonus := round(p_credit * p_ref_percent / 100, 4);
    if v_bonus > 0 then
      perform public.wallet_apply(v_referrer, v_bonus, 'referral', 'deposit', d.id::text, 'Referral bonus');
      update public.users set referral_earned = referral_earned + v_bonus where id = v_referrer;
    end if;
  end if;

  return jsonb_build_object(
    'credited', true, 'user_id', d.user_id, 'balance', v_balance, 'order_id', d.order_id,
    'referrer_id', v_referrer, 'referral_bonus', v_bonus);
end $$;

-- Redeem a wallet gift code.
create or replace function public.redeem_code_use(p_code text, p_user_id bigint)
returns numeric
language plpgsql as $$
declare c public.redeem_codes;
begin
  select * into c from public.redeem_codes where code = upper(trim(p_code)) for update;
  if not found or not c.is_active then raise exception 'CODE_INVALID'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'CODE_EXPIRED'; end if;
  if c.uses >= c.max_uses then raise exception 'CODE_EXHAUSTED'; end if;
  begin
    insert into public.redeem_uses(code_id, user_id) values (c.id, p_user_id);
  exception when unique_violation then
    raise exception 'CODE_USED';
  end;
  update public.redeem_codes set uses = uses + 1 where id = c.id;
  perform public.wallet_apply(p_user_id, c.amount, 'redeem', 'redeem_code', c.id::text, c.code);
  return c.amount;
end $$;

-- Register a referral exactly once when a new user arrives through a link.
create or replace function public.referral_attach(p_user_id bigint, p_referrer_id bigint)
returns boolean
language plpgsql as $$
begin
  if p_user_id = p_referrer_id then return false; end if;
  update public.users set referrer_id = p_referrer_id
   where id = p_user_id and referrer_id is null
     and exists (select 1 from public.users where id = p_referrer_id);
  if not found then return false; end if;
  update public.users set referrals_count = referrals_count + 1 where id = p_referrer_id;
  return true;
end $$;

-- Counts of available stock per product (for catalog rendering).
create or replace function public.stock_counts(p_product_ids uuid[])
returns table(product_id uuid, available bigint)
language sql stable as $$
  select product_id, count(*) from public.stock_items
   where status = 'available' and product_id = any(p_product_ids)
   group by product_id
$$;

-- Lock all functions to the service role.
do $$
declare f text;
begin
  foreach f in array array[
    'wallet_apply(bigint,numeric,text,text,text,text,uuid)',
    'points_apply(bigint,integer,text,text)',
    'points_redeem(bigint,integer,numeric)',
    'order_pay_wallet(bigint)',
    'order_refund(bigint,numeric,text,uuid)',
    'stock_claim(uuid,integer,bigint)',
    'deposit_credit(uuid,numeric,text,jsonb,numeric,uuid)',
    'redeem_code_use(text,bigint)',
    'referral_attach(bigint,bigint)',
    'stock_counts(uuid[])']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
