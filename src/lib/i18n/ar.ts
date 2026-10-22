import type { en } from './en';

// Arabic texts (Telegram HTML). Missing keys fall back to English.
export const ar: Partial<Record<keyof typeof en, string>> & Record<string, string> = {
  // ── buttons ──
  btn_home: 'الرئيسية',
  btn_back: 'رجوع',
  btn_my_orders: 'طلباتي',
  btn_download_txt: 'تحميل كملف TXT',
  btn_shop: 'المتجر',
  btn_freebies: 'مجاناً',
  btn_deposit: 'شحن الرصيد',
  btn_profile: 'ملفي',
  btn_orders: 'طلباتي',
  btn_support: 'الدعم',
  btn_referrals: 'ادعُ واربح',
  btn_giveaways: 'الفعاليات والسحوبات',
  btn_redeem: 'استخدام كود',
  btn_language: 'اللغة',
  btn_website: 'الموقع',
  btn_channel: 'القناة',
  btn_discounts: 'خصوماتي',
  btn_api: 'وصول API',
  btn_replace: 'طلب استبدال',
  btn_buy_now: 'اشترِ الآن',
  btn_custom_qty: 'كمية مخصصة',
  btn_back_to_product: 'العودة للمنتج',
  btn_pay_wallet: 'ادفع {amount} من المحفظة',
  btn_add_to_wallet: 'أضف {amount} إلى المحفظة',
  btn_promo: 'كود خصم',
  btn_cancel: 'إلغاء',
  btn_deposit_funds: 'اشحن الآن',
  btn_custom_amount: 'مبلغ مخصص',
  btn_open_payment: 'فتح صفحة الدفع',
  btn_copy: 'نسخ {label}',
  btn_send_proof: 'إرسال إثبات الدفع',
  btn_check_payment: 'دفعت — تحقق',
  btn_cancel_deposit: 'إلغاء الشحن',
  btn_join: 'انضم إلى {title}',
  btn_joined: 'انضممت',
  btn_copy_link: 'نسخ رابطي',
  btn_share: 'شارك مع أصدقائك',
  btn_redeem_points: 'حوّل {points} نقطة إلى رصيد',
  btn_create_key: 'إنشاء مفتاح API',
  btn_revoke_key: 'إلغاء {prefix}…',
  btn_join_giveaway: 'شارك في السحب',
  btn_contact_admin: 'تواصل مع الإدارة',
  btn_open_ticket: 'فتح تذكرة',
  btn_request_replacement: 'طلب استبدال',
  btn_request_refund: 'طلب استرداد',
  btn_prev: 'السابق',
  btn_next: 'التالي',

  // ── payment method labels ──
  method_binance_pay: 'Binance Pay',
  method_binance_id: 'بينانس (Pay ID)',
  method_nowpayments: 'USDT BEP20',
  method_shamcash: 'شام كاش',
  method_admin: 'رصيد من الإدارة',
  pay_with_binance_pay: 'ادفع عبر Binance Pay',
  pay_with_binance_id: 'ادفع عبر بينانس (Pay ID)',
  pay_with_nowpayments: 'ادفع بـ USDT (BEP20)',
  pay_with_shamcash: 'ادفع عبر شام كاش',

  // ── home / gates ──
  welcome:
    '{e:crown} <b>أهلاً بك في {brand}!</b>\n\n' +
    'مرحباً {name}! {e:welcome}\n\n' +
    'نقدّم منتجات رقمية مميزة بأسعار منافسة مع تسليم سريع وآمن وتلقائي بالكامل.\n\n' +
    '<blockquote>{menu}</blockquote>\n' +
    '{links}\n' +
    'اختر من القائمة بالأسفل للمتابعة! 👇',
  menu_line_shop: '{e:shop} <b>المتجر</b> — تصفح المنتجات واشترِ',
  menu_line_freebies: '{e:freebies} <b>مجاناً</b> — موارد ومحتوى مجاني',
  menu_line_deposit: '{e:deposit} <b>شحن الرصيد</b> — أضف رصيداً إلى محفظتك',
  menu_line_profile: '{e:profile} <b>ملفي</b> — الرصيد والطلبات والإعدادات',
  menu_line_orders: '{e:orders} <b>طلباتي</b> — مشترياتك ومنتجاتك',
  menu_line_support: '{e:support} <b>الدعم</b> — احصل على المساعدة',
  menu_line_referrals: '{e:referrals} <b>ادعُ واربح</b> — ادعُ أصدقاءك واكسب المكافآت',
  menu_line_giveaways: '{e:giveaways} <b>الفعاليات</b> — سحوبات وعروض',
  menu_line_redeem: '{e:redeem} <b>استخدام كود</b> — استخدم كود هدية',
  welcome_channel_line: '{e:channel} القناة: {url}',
  welcome_group_line: '{e:support} المجموعة: {url}',
  lang_pick: '{e:language} <b>اختر لغتك</b>\nChoose your language',
  lang_changed: 'تم اختيار اللغة العربية',
  force_join:
    '{e:join} <b>انضم للمتابعة</b>\n━━━━━━━━━━━━\n\n' +
    '<i>انضم إلى القنوات بالأسفل، ثم اضغط <b>انضممت</b> — وسيفتح البوت مباشرة.</i>\n\n{list}',
  force_join_not_yet: 'لم تنضم إلى جميع القنوات بعد.',
  force_join_ok: 'شكراً لانضمامك!',
  banned: '{e:error} حسابك مقيّد. تواصل مع الدعم إن كنت تظن أن هذا خطأ.',
  maintenance: '{e:clock} <b>نقوم بتحديث المتجر حالياً.</b>\nيرجى العودة بعد دقائق.',
  feature_disabled: '{e:info} هذه الميزة غير متاحة حالياً.',
  state_cancelled: '{e:cancel} تم الإلغاء.',
  referral_new_friend: '{e:referrals} انضم <b>{name}</b> عبر رابطك! ستحصل على <b>{percent}%</b> من شحناته.',

  // ── shop ──
  shop_title: '{e:shop} <b>المتجر</b>\n\nاختر القسم 👇',
  shop_choose: 'اختر القسم 👇',
  btn_other_products: 'منتجات أخرى',
  group_button: '{name} · من {price}',
  group_view: '{emoji} <b>{name}</b>\n{description}\n{sale}<i>{count} باقة — اضغط على إحداها لرؤية التفاصيل.</i>',
  category_other_view: '{e:product} <b>منتجات أخرى</b>\n\n<i>{count} منتج — اضغط على أحدها لرؤية التفاصيل.</i>',
  shop_all_products: '{e:shop} <b>المتجر</b>\n\n<i>{count} منتج — اضغط على أحدها لرؤية التفاصيل.</i>',
  shop_empty: '{e:shop} <b>المتجر</b>\n\n<i>لا توجد منتجات بعد — عد قريباً!</i>',
  category_view: '{emoji} <b>{name}</b>\n{description}\n{sale}<i>{count} منتج — اضغط على أحدها لرؤية التفاصيل.</i>',
  category_empty: '{emoji} <b>{name}</b>\n{description}\n<i>لا توجد منتجات في هذا القسم حالياً.</i>',
  category_sale_line: '{e:sale} <b>تخفيضات</b> — <i>{n} من {count} بسعر مخفّض، والأسعار بالأسفل تشمل الخصم.</i>',
  sold_out_short: 'نفدت الكمية',
  sold_out_alert: 'هذا المنتج نفد حالياً. عد قريباً!',
  stock_sold_out: 'نفدت الكمية',
  stock_by_hand: 'يُسلَّم يدوياً',
  stock_unlimited: 'متوفر',
  stock_count: '{n} متوفر',
  type_instant: 'تسليم فوري',
  type_manual: 'تسليم يدوي',
  type_activation: 'تفعيل (يحتاج بياناتك)',
  type_async: 'تلقائي (خلال دقائق)',
  warranty_days: '{n} يوم',
  warranty_none: 'بدون ضمان',
  label_special: 'خصم خاص',
  label_sale: 'تخفيض',
  discount_label: ' · <i>{label} — خصم {p}%</i>',
  product_view: '{emoji} <b>{name}</b>\n\n<blockquote>{details}</blockquote>\n{description}\n{footer}',
  product_price_line: '{e:price} <b>السعر:</b> {price}',
  product_duration_line: '{e:duration} <b>المدة:</b> {duration}',
  product_warranty_line: '{e:warranty} <b>الضمان:</b> {warranty}',
  product_stock_line: '{e:stock} <b>المخزون:</b> {stock}',
  product_type_line: '{e:type} <b>النوع:</b> {type}',
  product_sold_line: '{e:sold} <b>المبيعات:</b> {n}',
  product_description_block: '\n{e:info} <b>الوصف</b>\n<blockquote expandable>{description}</blockquote>\n',
  product_footer_instant: '{e:delivery} <i>تسليم تلقائي فوري.</i>',
  product_footer_manual: '{e:manual} <i>يُجهَّز يدوياً بعد الدفع — سنرسله لك هنا فور جاهزيته.</i>',
  product_footer_sold_out: '{e:sold_out} <i>نفدت الكمية حالياً — عد قريباً.</i>',
  qty_prompt: '{emoji} <b>{name}</b>\n\n<blockquote>سعر الوحدة: {price}\nالتسليم: <b>{delivery}</b></blockquote>\n\n<i>كم تريد؟</i> 👇',
  qty_custom_prompt: '{e:quantity} أرسل الكمية كرقم (<b>{min}–{max}</b>).',
  qty_invalid: '{e:warning} أرسل رقماً صحيحاً بين <b>{min}</b> و <b>{max}</b>.',
  pricelist_title: '{e:orders} <b>قائمة الأسعار</b> — كل المتوفر\n',
  pricelist_group: '\n{emoji} <b>{name}</b>',
  pricelist_line: '{emoji} {name} — {price}',
  pricelist_empty: '{e:info} لا يوجد شيء متوفر حالياً — عد قريباً!',

  // ── inputs ──
  input_prompt: '{e:info} <b>{label}</b> <i>({step}/{steps})</i>\n\n{hint}',
  input_hint_single: 'أرسلها كرسالة 👇',
  input_hint_per_unit: 'أرسل <b>{n}</b> قيم — كل قيمة في سطر 👇',
  input_hint_options: 'اختر واحداً 👇',
  input_label_email: 'بريدك الإلكتروني',
  input_label_account: 'حسابك (بريد / اسم مستخدم / ID)',
  input_label_identifier: 'معرّف حسابك أو @اسم المستخدم',
  input_label_months: 'عدد الأشهر',
  input_wrong_count: '{e:warning} أرسل <b>{n}</b> أسطر بالضبط، سطر لكل وحدة.',
  input_invalid_email: '{e:warning} هذا لا يبدو بريداً صحيحاً. حاول مرة أخرى.',

  // ── checkout ──
  checkout: '{e:total} <b>إتمام الشراء</b>\n\n<blockquote>{summary}</blockquote>\n\n{e:balance} رصيدك: <b>{balance}</b>\n{balance_line}\n\n<i>اختر طريقة الدفع.</i> 👇',
  checkout_warranty_line: '{e:warranty} <i>ضمان {warranty}</i>',
  checkout_discount_line: '{e:sale} <i>{label} — خصم {p}% — وفّرت {saved}</i>',
  checkout_promo_line: '{e:promo} كود الخصم <code>{code}</code> — <b>−{amount}</b>',
  checkout_total_line: '<b>الإجمالي:</b> {total}',
  checkout_enough: '{e:success} <i>يمكنك الدفع من رصيدك.</i>',
  checkout_missing: '{e:warning} <i>تحتاج <b>{missing}</b> إضافية للدفع من رصيدك.</i>',
  pay_processing: '{e:success} <b>تم الدفع!</b>\n\nالطلب <code>{code}</code> — {product}\n{e:clock} <i>نجهّز طلبك، سيصلك هنا خلال لحظات…</i>',
  deposit_choose_method_order: '{e:deposit} <b>اشحن {amount}</b>\n\nسيُدفع الطلب <code>{code}</code> تلقائياً فور وصول شحنتك.\nاختر طريقة الدفع 👇',
  deposit_min_note: '{e:info} <i>الحد الأدنى للشحن بهذه الطريقة {amount} — الباقي يبقى في محفظتك (تحتاج {missing}).</i>',
  promo_prompt: '{e:promo} <b>كود الخصم</b>\n\nأرسل كود الخصم 👇',
  promo_applied: '{e:success} تم تطبيق الكود <code>{code}</code> — وفّرت <b>{amount}</b>!',
  order_cancelled: 'تم إلغاء الطلب',

  // ── deposit ──
  deposit_menu:
    '{e:deposit} <b>شحن الرصيد</b>\n━━━━━━━━━━━━\n{e:wallet} الرصيد › <b>{balance} USD</b>\n━━━━━━━━━━━━\n\n' +
    '{e:stats} <b>آخر العمليات</b>\n<blockquote>{activity}</blockquote>\n\n<i>اشحن محفظتك لتشتري فوراً!</i> {e:delivery}',
  deposit_no_activity: '<i>لا شيء بعد — ستظهر أول شحنة هنا.</i>',
  deposit_no_methods: '{e:info} لا توجد طريقة دفع متاحة حالياً. تواصل مع الدعم.',
  deposit_choose_method: '{e:deposit} <b>اختر طريقة الدفع</b> 👇',
  deposit_choose_amount: '{e:deposit} <b>{method}</b>\n\nاختر المبلغ (الحد الأدنى <b>{min}</b>) 👇',
  deposit_custom_prompt: '{e:quantity} أرسل المبلغ بالدولار (الأدنى <b>{min}</b>، الأقصى <b>{max}</b>).',
  deposit_amount_invalid: '{e:warning} أرسل مبلغاً بين <b>{min}</b> و <b>{max}</b>.',
  deposit_proof_prompt: '{e:info} أرسل <b>لقطة شاشة</b> للتحويل، أو <b>رقم العملية</b> كنص 👇',
  deposit_check_paid: 'تم استلام الدفعة — أُضيف الرصيد إلى محفظتك!',
  deposit_check_pending: 'لم تصل الدفعة بعد. انتظر قليلاً ثم حاول مجدداً.',
  deposit_expired: 'هذه الدفعة لم تعد فعّالة. أنشئ عملية شحن جديدة.',
  deposit_cancelled: 'تم إلغاء الشحن',
  deposit_paid_screen: '{e:success} <b>تم استلام الدفعة!</b>\n\nأُضيف <b>{amount}</b> إلى محفظتك.',

  // ── profile ──
  profile:
    '{e:profile} <b>ملفي</b>\n\n' +
    '<blockquote>{e:profile} {name}\n{e:link} <code>{id}</code>\n{e:duration} <i>انضم في {joined}</i></blockquote>\n\n' +
    '{e:balance} <b>الرصيد:</b> <code>{balance}</code>\n{e:points} <b>النقاط:</b> {points}\n\n' +
    '{e:stats} <b>الإحصائيات</b>\n<blockquote>{e:orders} الطلبات: <b>{orders}</b>\n{e:total} إجمالي الإنفاق: {spent}\n{e:deposit} إجمالي الشحن: {deposited}</blockquote>\n' +
    '{referral_block}{discount_line}\n' +
    '{e:orders} <b>آخر الطلبات</b>\n<blockquote>{latest}</blockquote>',
  profile_referral_block: '\n{e:gift} <b>الإحالات</b> — <i>اربح {percent}% من كل شحنة لأصدقائك</i>\n<blockquote>{e:referrals} المدعوون: <b>{invited}</b>\n{e:balance} الأرباح: {earned}</blockquote>\n',
  profile_discount_line: '{e:discount} خصمك: <b>{percent}%</b>\n',
  profile_order_line: '{status} <code>{code}</code> · {product} · {total}',
  profile_no_orders: '<i>لا توجد طلبات بعد — المتجر على بُعد ضغطة.</i>',

  // ── orders ──
  orders_title: '{e:orders} <b>طلباتي</b> <i>(صفحة {page})</i>\n\nاضغط على طلب لرؤية التفاصيل.',
  orders_empty: '{e:orders} <b>طلباتي</b>\n\n<i>لا توجد طلبات بعد — المتجر على بُعد ضغطة.</i>',
  order_detail:
    '{e:orders} <b>الطلب <code>{code}</code></b>\n\n' +
    '<blockquote>{e:product} {product} × {qty}\n{e:total} الإجمالي: <b>{total}</b>\n{e:info} الحالة: <b>{status}</b>\n{e:duration} التاريخ: {date}{warranty_line}{refunded_line}</blockquote>{items}',
  order_warranty_until: '{e:warranty} الضمان حتى: <b>{until}</b>',
  order_warranty_expired: '{e:warranty} انتهى الضمان',
  order_refunded_line: '{e:refund} المُسترد: <b>{amount}</b>',
  order_items_title: '{e:key} <b>منتجاتك:</b>',
  status_pending_payment: 'بانتظار الدفع',
  status_paid: 'مدفوع',
  status_processing: 'قيد المعالجة',
  status_awaiting_provider: 'قيد المعالجة',
  status_manual_pending: 'قيد التجهيز',
  status_delivered: 'تم التسليم',
  status_partially_delivered: 'تسليم جزئي',
  status_failed: 'قيد المراجعة',
  status_refunded: 'مُسترد',
  status_partially_refunded: 'مُسترد جزئياً',
  status_cancelled: 'ملغى',

  // ── referrals, discounts, points, redeem ──
  referrals:
    '{e:referrals} <b>برنامج الإحالة</b>\n\n' +
    '<blockquote>شارك رابطك واربح <b>{percent}%</b> من كل شحنة يقوم بها أصدقاؤك — <i>للأبد</i>.</blockquote>\n\n' +
    '{e:link} <b>رابطك</b> <i>(اضغط للنسخ)</i>\n<code>{link}</code>\n\n' +
    '<blockquote>{e:referrals} المدعوون: <b>{invited}</b>\n{e:balance} الأرباح: {earned}</blockquote>',
  discounts: '{e:discount} <b>خصوماتي</b>\n\n{e:discount} خصمك: <b>{percent}%</b>\n{e:total} إجمالي الإنفاق: {spent}\n{levels}{points}',
  discount_levels_title: '{e:star} <b>مستويات الخصم</b> <i>(حسب إجمالي الإنفاق)</i>',
  discount_level_line: '{mark} {name} {min} ← <b>خصم {percent}%</b>',
  points_block: '\n{e:points} <b>نقاط الكاش باك:</b> {points} <i>(≈ {value})</i>\n<i>تحصل على {per_usd} نقطة لكل 1$ تنفقه. التحويل يبدأ من {min} نقطة.</i>',
  points_not_enough: 'تحتاج {min} نقطة على الأقل للتحويل.',
  points_redeemed: 'تم تحويل {points} نقطة إلى {amount}!',
  redeem_prompt: '{e:redeem} <b>استخدام كود</b>\n\nأرسل كود الهدية 👇',
  redeem_ok: '{e:success} <b>تم استخدام الكود!</b>\n\nأُضيف <b>{amount}</b> إلى محفظتك.',

  // ── API ──
  api_title: '{e:api} <b>وصول API</b>\n\nاشترِ من تطبيقك أو بوتك الخاص برصيد محفظتك.\nالرابط الأساسي: <code>{base}</code>\n\n<b>مفاتيحك</b>\n{keys}',
  api_no_keys: '<i>لا توجد مفاتيح بعد.</i>',
  api_key_line: '• <code>{prefix}…</code> <i>({date})</i>',
  api_key_created: '{e:key} <b>مفتاح API الجديد</b> — يظهر مرة واحدة فقط، احفظه الآن:\n\n<code>{key}</code>',
  api_key_revoked: 'تم إلغاء المفتاح',
  api_limit: 'يمكنك امتلاك 3 مفاتيح فعّالة كحد أقصى.',

  // ── freebies, giveaways ──
  freebies_title: '{e:freebies} <b>مجاناً</b>\n\nموارد مجانية لمجتمعنا 👇',
  freebies_empty: '{e:freebies} <b>مجاناً</b>\n\n<i>لا يوجد شيء حالياً — عد قريباً!</i>',
  freebie_view: '{e:gift} <b>{title}</b>\n\n{content}',
  giveaways_title: '{e:giveaways} <b>الفعاليات والسحوبات</b>\n\nاضغط على فعالية للمشاركة 👇',
  giveaways_empty: '{e:giveaways} <b>الفعاليات والسحوبات</b>\n\n<i>لا توجد فعاليات حالياً — ترقّب!</i>',
  giveaway_view:
    '{e:giveaways} <b>{title}</b>\n\n{description}\n' +
    '{e:gift} الجائزة: <b>{prize}</b>\n{e:star} عدد الفائزين: <b>{winners}</b>\n{e:referrals} المشاركون: <b>{entries}</b>\n{e:clock} ينتهي: {ends}{requirement}\n\n{joined}',
  giveaway_requirement: '\n{e:info} يتطلب إنفاق <b>{min}</b> على الأقل',
  giveaway_joined_yes: '{e:success} <b>أنت مشارك!</b> بالتوفيق 🍀',
  giveaway_join_ok: 'تمت مشاركتك في السحب. بالتوفيق!',
  giveaway_join_already: 'أنت مشارك بالفعل في هذا السحب.',
  giveaway_join_min: 'يتطلب هذا السحب إنفاق {min} على الأقل.',
  giveaway_ended: 'انتهى هذا السحب.',
  giveaway_won: '{e:gift} <b>مبروك!</b>\n\nفزت في السحب <b>{title}</b>: {prize} 🎉',

  // ── support, tickets, replacements ──
  support:
    '{e:support} <b>مركز الدعم</b>\n\n' +
    '<blockquote>🙂 <b>نحن هنا لمساعدتك!</b>\n\n• طلب لم يُسلَّم أو منتجات ناقصة\n• دفعة لم تُضف إلى المحفظة\n• أسئلة عن طلبات التفعيل\n• طلبات الاسترداد أو الاعتراض\n• أي استفسار آخر</blockquote>\n\n' +
    '{e:warning} <b>قبل التواصل معنا، جهّز رقم الطلب.</b>\n<i>تجده في ملفي ← طلباتي.</i>\n{hours}\n' +
    '{e:delivery} <i>اضغط <b>تواصل مع الإدارة</b> بالأسفل لفتح محادثة مباشرة مع فريقنا.</i>',
  support_hours_line: '\n{e:clock} {hours}\n',
  ticket_prompt: '{e:ticket} <b>فتح تذكرة</b>\n\nاشرح مشكلتك في رسالة واحدة (يمكنك إرفاق صورة) 👇',
  ticket_created: '{e:success} تم إنشاء التذكرة <b>#{id}</b>. سيرد فريقنا هنا.',
  replace_choose: '{e:replace} <b>طلب استبدال</b>\n\nاختر الطلب (تظهر الطلبات ضمن الضمان فقط) 👇',
  replace_none: '{e:replace} <b>طلب استبدال</b>\n\n<i>لا توجد لديك طلبات ضمن فترة الضمان.</i>',
  replace_not_eligible: 'هذا الطلب لم يعد مشمولاً بالضمان.',
  replace_mode: '{e:replace} الطلب <code>{code}</code> — {product}\n\nماذا تحتاج؟',
  replace_describe: '{e:info} الطلب <code>{code}</code>\n\nاشرح المشكلة (نص أو لقطة شاشة) 👇',
  replace_sent: '{e:success} تم إرسال الطلب <b>#{id}</b>. سنرد عليك هنا.',
  ticket_replaced: '{e:replace} <b>بديل للطلب {code}</b> <i>(طلب #{id})</i>\n\n{items}{note}\n\n📌 <b>احتفظ بهذه المعلومات بأمان.</b>',
  ticket_rejected: '{e:cancel} تم رفض طلبك <b>#{id}</b>.{note}',
  ticket_answered: '{e:support} <b>رد على تذكرتك #{id}</b>{note}',

  // ── errors ──
  err_generic: '{e:error} حدث خطأ ما. حاول مرة أخرى.',
  err_expired: 'انتهت صلاحية هذا الإجراء — ابدأ من جديد.',
  err_PRODUCT_NOT_FOUND: 'هذا المنتج لم يعد متاحاً.',
  err_PRICE_UNAVAILABLE: 'هذا المنتج غير متاح حالياً.',
  err_SOLD_OUT: 'نفدت الكمية حالياً — عد قريباً!',
  err_NOT_ENOUGH_STOCK: 'المخزون لا يكفي لهذه الكمية. اختر كمية أقل.',
  err_QTY_INVALID: 'هذه الكمية غير مسموحة لهذا المنتج.',
  err_INPUT_MISSING: 'بعض البيانات المطلوبة ناقصة. ابدأ من جديد.',
  err_INPUT_INVALID: '{e:warning} هذه القيمة غير صحيحة. حاول مرة أخرى.',
  err_INPUT_DUPLICATE: '{e:warning} يجب أن يكون كل سطر مختلفاً.',
  err_PROMO_INVALID: '{e:warning} كود الخصم غير صالح.',
  err_PROMO_EXPIRED: '{e:warning} انتهت صلاحية كود الخصم.',
  err_PROMO_EXHAUSTED: '{e:warning} تم استخدام كود الخصم بالكامل.',
  err_PROMO_NOT_APPLICABLE: '{e:warning} كود الخصم لا ينطبق على هذا المنتج.',
  err_PROMO_MIN_ORDER: '{e:warning} طلبك أقل من الحد الأدنى لهذا الكود.',
  err_PROMO_USER_LIMIT: '{e:warning} لقد استخدمت هذا الكود من قبل.',
  err_INSUFFICIENT_BALANCE: 'الرصيد غير كافٍ — اشحن محفظتك.',
  err_ORDER_NOT_FOUND: 'الطلب غير موجود.',
  err_ORDER_NOT_PENDING: 'هذا الطلب لم يعد بانتظار الدفع.',
  err_PAYMENT_FAILED: 'فشل الدفع. حاول مرة أخرى.',
  err_METHOD_DISABLED: 'طريقة الدفع هذه غير متاحة حالياً.',
  err_IDEMPOTENCY_CONFLICT: 'ابدأ الطلب من جديد.',
  err_CODE_INVALID: '{e:warning} هذا الكود غير صالح.',
  err_CODE_EXPIRED: '{e:warning} انتهت صلاحية هذا الكود.',
  err_CODE_USED: '{e:warning} لقد استخدمت هذا الكود من قبل.',
  err_CODE_EXHAUSTED: '{e:warning} تم استخدام هذا الكود بالكامل.',
  err_INSUFFICIENT_POINTS: 'النقاط غير كافية.',
  err_TICKET_EXISTS: '{e:info} يوجد طلب مفتوح لهذا الطلب مسبقاً — نحن نعمل عليه.',
  err_TICKET_CLOSED: 'هذا الطلب مغلق بالفعل.',
  err_TICKET_NOT_FOUND: 'الطلب غير موجود.',

  // ── delivery ──
  delivery_message:
    '{e:success} <b>تم تسليم طلبك!</b>\n\n' +
    '{e:product} <b>{product}</b> × {qty}\n' +
    '{e:total} المدفوع: <b>{total}</b>\n\n' +
    '{e:key} <b>منتجاتك:</b>\n{items}\n{note}\n' +
    '{e:warranty} الضمان: {warranty}\n' +
    '{e:link} رقم الطلب: <code>{code}</code>\n' +
    '{points_line}' +
    '\n📌 <b>احتفظ بهذه المعلومات بأمان.</b>\nشكراً لشرائك! 🙏',
  delivery_message_no_items:
    '{e:success} <b>تم تنفيذ طلبك!</b>\n\n' +
    '{e:product} <b>{product}</b> × {qty}\n' +
    '{e:total} المدفوع: <b>{total}</b>\n{note}\n' +
    '{e:warranty} الضمان: {warranty}\n' +
    '{e:link} رقم الطلب: <code>{code}</code>\n' +
    '{points_line}' +
    '\nشكراً لشرائك! 🙏',
  delivery_items_in_file: '<i>منتجاتك موجودة في ملف TXT المرفق.</i>',
  delivery_points_line: '{e:gift} حصلت على <b>{points}</b> نقطة كاش باك.\n',

  // ── order status ──
  order_awaiting_provider:
    '{e:clock} <b>الطلب {code} قيد المعالجة</b>\n\n{product} × {qty}\nسيصلك هنا تلقائياً فور جاهزيته.',
  order_manual_pending:
    '{e:manual} <b>تم استلام الطلب {code}</b>\n\n{product} × {qty}\nيتم تجهيزه يدوياً — سنرسله لك هنا فور جاهزيته.',
  order_delayed:
    '{e:clock} <b>الطلب {code} متأخر</b>\n\nفريقنا يتحقق منه الآن. ستحصل على منتجك أو استرداد كامل — لا داعي لأي إجراء.',
  order_refunded_auto:
    '{e:refund} <b>تم استرداد الطلب {code}</b>\n\nلم نتمكن من تسليم <b>{product}</b> حالياً، لذلك أُعيد <b>{amount}</b> إلى محفظتك.',
  order_refunded: '{e:refund} <b>استرداد للطلب {code}</b>\n\nتمت إضافة <b>{amount}</b> إلى محفظتك.',

  // ── تنبيهات الزبائن ──
  btn_notify_me: 'نبّهني عند التوفر',
  btn_notify_on: 'سننبهك — اضغط للإلغاء',
  notify_me_added: 'تم! سنرسل لك رسالة فور توفر المنتج.',
  notify_me_removed: 'تم إلغاء التنبيه.',
  notify_me_unavailable: 'المنتج متوفر الآن، أو أنك تتابع عدداً كبيراً من المنتجات.',
  btn_alerts_on: 'تنبيهات المتجر: مفعّلة',
  btn_alerts_off: 'تنبيهات المتجر: متوقفة',
  alerts_turned_on: 'تم تفعيل التنبيهات — ستصلك المنتجات الجديدة وإعادة التوفر.',
  alerts_turned_off: 'تم إيقاف التنبيهات — لن تصلك رسائل المنتجات الجديدة أو إعادة التوفر.',
  btn_open_shop: 'افتح المتجر',
  alert_line: '{emoji} <b>{name}</b> — {price}',
  alert_new_products: '{e:fire} <b>جديد في المتجر!</b>\n\n{lines}\n\n<i>اضغط بالأسفل للشراء</i> 👇',
  alert_back_in_stock: '{e:success} <b>توفر من جديد!</b>\n\n{lines}\n\n<i>احصل عليه قبل أن ينفد</i> 👇',
  alert_notify_me: '{e:bell} <b>خبر سار!</b>\n\n{emoji} <b>{name}</b> توفر من جديد.\n{e:price} السعر: <b>{price}</b>',
};
