-- ════════════════════════════════════════════════════════════════════════════
--  DEMO DATA — LOCAL TESTING ONLY
--  Loaded by `supabase db reset` / `supabase start` on the developer laptop.
--  `supabase db push` (production) never runs this file.
-- ════════════════════════════════════════════════════════════════════════════

-- Local admin login for the panel (http://127.0.0.1:8787/admin/)
--   email:    owner@plus-store.test
--   password: local-dev-password
do $$
declare uid uuid := '00000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from auth.users where id = uid) then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'owner@plus-store.test',
            extensions.crypt('local-dev-password', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', 'owner@plus-store.test', 'email_verified', true),
            'email', now(), now(), now());
  end if;
  insert into public.admins (user_id, email, role, display_name)
  values (uid, 'owner@plus-store.test', 'owner', 'Local owner')
  on conflict (user_id) do nothing;
end $$;

-- Demo catalog
insert into public.categories (id, name_en, name_ar, description_en, description_ar, emoji, sort)
values ('10000000-0000-4000-8000-000000000001', 'Demo — AI Tools', 'تجريبي — أدوات ذكاء اصطناعي',
        'Demo category for local testing', 'قسم تجريبي للاختبار المحلي', '🤖', 1)
on conflict (id) do nothing;

-- 1) product delivered from local stock, manual price
insert into public.products (id, category_id, name_en, name_ar, description_en, description_ar, emoji,
                             duration_en, duration_ar, warranty_days, pricing_mode, manual_price, base_cost,
                             compare_at_price, is_featured, sort)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        'Demo Stock Product — 1 Month', 'منتج تجريبي من المخزون — شهر',
        'Delivered instantly from local stock.', 'يُسلَّم فوراً من المخزون المحلي.', '📦',
        '1 month', 'شهر واحد', 25, 'manual', 2.50, 1.00, 3.00, true, 1)
on conflict (id) do nothing;

insert into public.product_sources (product_id, kind, priority)
values ('20000000-0000-4000-8000-000000000001', 'stock', 0)
on conflict do nothing;

insert into public.stock_items (product_id, content, batch)
select '20000000-0000-4000-8000-000000000001', v, 'demo'
from (values ('demo1@example.com | Pass-1111'), ('demo2@example.com | Pass-2222'), ('demo3@example.com | Pass-3333')) as t(v)
where not exists (select 1 from public.stock_items where batch = 'demo');

-- 2) product prepared by hand (admin manual queue)
insert into public.products (id, category_id, name_en, name_ar, description_en, description_ar, emoji,
                             duration_en, duration_ar, warranty_days, fulfillment, pricing_mode, manual_price,
                             input_fields, is_featured, sort)
values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
        'Demo Manual Activation', 'تفعيل يدوي تجريبي',
        'An admin activates it on your email.', 'يقوم المشرف بالتفعيل على بريدك.', '🧑‍💻',
        '1 month', 'شهر واحد', 0, 'manual', 'manual', 5.00,
        '[{"key":"email","label_en":"Your account email","label_ar":"بريد حسابك","per_unit":false,"required":true}]'::jsonb,
        true, 2)
on conflict (id) do nothing;

insert into public.product_sources (product_id, kind, priority)
values ('20000000-0000-4000-8000-000000000002', 'manual', 0)
on conflict do nothing;

-- Demo promo & redeem codes
insert into public.promo_codes (code, kind, value, max_uses, per_user_limit, note)
values ('DEMO10', 'percent', 10, 100, 1, 'demo')
on conflict (code) do nothing;

insert into public.redeem_codes (code, amount, max_uses, note)
values ('DEMOGIFT5', 5, 10, 'demo')
on conflict (code) do nothing;
