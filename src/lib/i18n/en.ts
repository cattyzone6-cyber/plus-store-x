// English texts (Telegram HTML). {name} = variable, {e:key} = emoji from the library.
// Admins can override any key from the admin panel (Bot → Texts).
export const en = {
  // ── buttons ──
  btn_home: 'Home',
  btn_back: 'Back',
  btn_my_orders: 'My orders',
  btn_download_txt: 'Download as TXT',
  btn_shop: 'Shop',
  btn_freebies: 'Freebies',
  btn_deposit: 'Deposit',
  btn_profile: 'My Profile',
  btn_orders: 'My Orders',
  btn_support: 'Support',
  btn_referrals: 'Refer & Earn',
  btn_giveaways: 'Events & giveaways',
  btn_redeem: 'Redeem a code',
  btn_language: 'Language',
  btn_website: 'Website',
  btn_channel: 'Channel',
  btn_discounts: 'My Discounts',
  btn_api: 'API Access',
  btn_replace: 'Request replacement',
  btn_buy_now: 'Buy Now',
  btn_custom_qty: 'Custom Amount',
  btn_back_to_product: 'Back to Product',
  btn_pay_wallet: 'Pay {amount} from wallet',
  btn_add_to_wallet: 'Add {amount} to wallet',
  btn_promo: 'Promo Code',
  btn_cancel: 'Cancel',
  btn_deposit_funds: 'Deposit Funds',
  btn_custom_amount: 'Custom amount',
  btn_open_payment: 'Open payment page',
  btn_copy: 'Copy {label}',
  btn_send_proof: 'Send payment proof',
  btn_check_payment: "I've paid — check",
  btn_cancel_deposit: 'Cancel deposit',
  btn_join: 'Join {title}',
  btn_joined: "I've joined",
  btn_copy_link: 'Copy my link',
  btn_share: 'Share with friends',
  btn_redeem_points: 'Convert {points} points to balance',
  btn_create_key: 'Create API key',
  btn_revoke_key: 'Revoke {prefix}…',
  btn_join_giveaway: 'Join giveaway',
  btn_contact_admin: 'Contact Admin',
  btn_open_ticket: 'Open a ticket',
  btn_request_replacement: 'Request replacement',
  btn_request_refund: 'Request refund',
  btn_prev: 'Previous',
  btn_next: 'Next',

  // ── payment method labels ──
  method_binance_pay: 'Binance Pay',
  method_binance_id: 'Binance (Pay ID)',
  method_nowpayments: 'USDT BEP20',
  method_shamcash: 'ShamCash',
  method_admin: 'Admin credit',
  pay_with_binance_pay: 'Pay with Binance Pay',
  pay_with_binance_id: 'Pay with Binance (Pay ID)',
  pay_with_nowpayments: 'Pay with USDT (BEP20)',
  pay_with_shamcash: 'Pay with ShamCash',

  // ── home / gates ──
  welcome:
    '{e:crown} <b>Welcome to {brand}!</b>\n\n' +
    'Hey {name}! {e:welcome}\n\n' +
    'We offer premium digital products at competitive prices with fast, secure, and fully automated delivery.\n\n' +
    '<blockquote>{menu}</blockquote>\n' +
    '{links}\n' +
    'Choose an option below to continue! 👇',
  menu_line_shop: '{e:shop} <b>Shop</b> — Browse & buy products',
  menu_line_freebies: '{e:freebies} <b>Freebies</b> — Free resources & content',
  menu_line_deposit: '{e:deposit} <b>Deposit</b> — Add funds to your wallet',
  menu_line_profile: '{e:profile} <b>My Profile</b> — Balance, orders & settings',
  menu_line_orders: '{e:orders} <b>My Orders</b> — Your purchases & items',
  menu_line_support: '{e:support} <b>Support</b> — Get help',
  menu_line_referrals: '{e:referrals} <b>Refer & Earn</b> — Invite friends & earn rewards',
  menu_line_giveaways: '{e:giveaways} <b>Events</b> — Giveaways & offers',
  menu_line_redeem: '{e:redeem} <b>Redeem</b> — Use a gift code',
  welcome_channel_line: '{e:channel} Channel: {url}',
  welcome_group_line: '{e:support} Group: {url}',
  lang_pick: '{e:language} <b>Choose your language</b>\nاختر لغتك',
  lang_changed: 'Language set to English',
  force_join:
    '{e:join} <b>Join to continue</b>\n━━━━━━━━━━━━\n\n' +
    '<i>Join the chats below, then tap <b>I\'ve joined</b> — the bot opens straight after.</i>\n\n{list}',
  force_join_not_yet: 'You have not joined all the chats yet.',
  force_join_ok: 'Thanks for joining!',
  banned: '{e:error} Your account is restricted. Contact support if you think this is a mistake.',
  maintenance: '{e:clock} <b>We are updating the store.</b>\nPlease come back in a few minutes.',
  feature_disabled: '{e:info} This feature is not available right now.',
  state_cancelled: '{e:cancel} Cancelled.',
  referral_new_friend: '{e:referrals} <b>{name}</b> joined with your link! You earn <b>{percent}%</b> of their deposits.',

  // ── shop ──
  shop_title: '{e:shop} <b>Shop</b>\n\nChoose a category 👇',
  shop_choose: 'Choose a category 👇',
  btn_other_products: 'Other products',
  category_other_view: '{e:product} <b>Other products</b>\n\n<i>{count} products — tap one to see the details.</i>',
  shop_all_products: '{e:shop} <b>Shop</b>\n\n<i>{count} products — tap one to see the details.</i>',
  shop_empty: '{e:shop} <b>Shop</b>\n\n<i>No products yet — check back soon!</i>',
  category_view: '{emoji} <b>{name}</b>\n{description}\n{sale}<i>{count} products — tap one to see the details.</i>',
  category_empty: '{emoji} <b>{name}</b>\n{description}\n<i>No products in this category right now.</i>',
  category_sale_line: '{e:sale} <b>Sale on</b> — <i>{n} of {count} reduced, prices below already include it.</i>',
  sold_out_short: 'Sold out',
  sold_out_alert: 'This product is sold out right now. Check back soon!',
  stock_sold_out: 'Sold out',
  stock_by_hand: 'Delivered by hand',
  stock_unlimited: 'In stock',
  stock_count: '{n} available',
  type_instant: 'Instant delivery',
  type_manual: 'Manual delivery',
  type_activation: 'Activation (needs your details)',
  type_async: 'Automatic (a few minutes)',
  warranty_days: '{n} days',
  warranty_none: 'No warranty',
  label_special: 'Special Discount',
  label_sale: 'Sale',
  discount_label: ' · <i>{label} — {p}% off</i>',
  product_view: '{emoji} <b>{name}</b>\n\n<blockquote>{details}</blockquote>\n{description}\n{footer}',
  product_price_line: '{e:price} <b>Price:</b> {price}',
  product_duration_line: '{e:duration} <b>Duration:</b> {duration}',
  product_warranty_line: '{e:warranty} <b>Warranty:</b> {warranty}',
  product_stock_line: '{e:stock} <b>Stock:</b> {stock}',
  product_type_line: '{e:type} <b>Type:</b> {type}',
  product_sold_line: '{e:sold} <b>Sold:</b> {n}',
  product_description_block: '\n{e:info} <b>Description</b>\n<blockquote expandable>{description}</blockquote>\n',
  product_footer_instant: '{e:delivery} <i>Instant automatic delivery.</i>',
  product_footer_manual: '{e:manual} <i>Prepared by hand after payment — we will send it here as soon as it is ready.</i>',
  product_footer_sold_out: '{e:sold_out} <i>Sold out right now — check back soon.</i>',
  qty_prompt: '{emoji} <b>{name}</b>\n\n<blockquote>Unit price: {price}\nDelivery: <b>{delivery}</b></blockquote>\n\n<i>How many do you want?</i> 👇',
  qty_custom_prompt: '{e:quantity} Send the quantity as a number (<b>{min}–{max}</b>).',
  qty_invalid: '{e:warning} Please send a whole number between <b>{min}</b> and <b>{max}</b>.',
  pricelist_title: '{e:orders} <b>Price list</b> — everything in stock\n',
  pricelist_line: '{emoji} {name} — {price}',
  pricelist_empty: '{e:info} Nothing in stock right now — check back soon!',

  // ── inputs ──
  input_prompt: '{e:info} <b>{label}</b> <i>({step}/{steps})</i>\n\n{hint}',
  input_hint_single: 'Send it as a message 👇',
  input_hint_per_unit: 'Send <b>{n}</b> values — one per line 👇',
  input_hint_options: 'Choose one 👇',
  input_label_email: 'Your email',
  input_label_account: 'Your account (email / username / ID)',
  input_label_identifier: 'Your account ID or @username',
  input_label_months: 'Number of months',
  input_wrong_count: '{e:warning} Please send exactly <b>{n}</b> lines, one per unit.',
  input_invalid_email: '{e:warning} That does not look like a valid email. Please try again.',

  // ── checkout ──
  checkout: '{e:total} <b>Checkout</b>\n\n<blockquote>{summary}</blockquote>\n\n{e:balance} Your balance: <b>{balance}</b>\n{balance_line}\n\n<i>Choose how to pay.</i> 👇',
  checkout_warranty_line: '{e:warranty} <i>{warranty} warranty</i>',
  checkout_discount_line: '{e:sale} <i>{label} — {p}% off — saved {saved}</i>',
  checkout_promo_line: '{e:promo} Promo <code>{code}</code> — <b>−{amount}</b>',
  checkout_total_line: '<b>Total:</b> {total}',
  checkout_enough: '{e:success} <i>You can pay from your balance.</i>',
  checkout_missing: '{e:warning} <i>You need <b>{missing}</b> more to pay from your balance.</i>',
  pay_processing: '{e:success} <b>Payment received!</b>\n\nOrder <code>{code}</code> — {product}\n{e:clock} <i>Preparing your order, it arrives here in a moment…</i>',
  deposit_choose_method_order: '{e:deposit} <b>Top up {amount}</b>\n\nOrder <code>{code}</code> will be paid automatically as soon as your deposit arrives.\nChoose a payment method 👇',
  deposit_min_note: '{e:info} <i>Minimum deposit for this method is {amount} — the rest stays in your wallet (you need {missing}).</i>',
  promo_prompt: '{e:promo} <b>Promo code</b>\n\nSend your promo code 👇',
  promo_applied: '{e:success} Promo <code>{code}</code> applied — you save <b>{amount}</b>!',
  order_cancelled: 'Order cancelled',

  // ── deposit ──
  deposit_menu:
    '{e:deposit} <b>Deposit</b>\n━━━━━━━━━━━━\n{e:wallet} Balance › <b>{balance} USD</b>\n━━━━━━━━━━━━\n\n' +
    '{e:stats} <b>Recent activity</b>\n<blockquote>{activity}</blockquote>\n\n<i>Deposit funds to buy products instantly!</i> {e:delivery}',
  deposit_no_activity: '<i>Nothing yet — your first top-up will show here.</i>',
  deposit_no_methods: '{e:info} No payment method is available right now. Please contact support.',
  deposit_choose_method: '{e:deposit} <b>Choose a payment method</b> 👇',
  deposit_choose_amount: '{e:deposit} <b>{method}</b>\n\nChoose an amount (min <b>{min}</b>) 👇',
  deposit_custom_prompt: '{e:quantity} Send the amount in USD (min <b>{min}</b>, max <b>{max}</b>).',
  deposit_amount_invalid: '{e:warning} Please send an amount between <b>{min}</b> and <b>{max}</b>.',
  deposit_proof_prompt: '{e:info} Send a <b>screenshot</b> of your transfer, or the <b>transaction ID</b> as text 👇',
  deposit_check_paid: 'Payment received — your wallet was credited!',
  deposit_check_pending: 'Payment not received yet. Please wait a moment and try again.',
  deposit_expired: 'This payment is no longer active. Please create a new deposit.',
  deposit_cancelled: 'Deposit cancelled',
  deposit_paid_screen: '{e:success} <b>Payment received!</b>\n\n<b>{amount}</b> was added to your wallet.',

  // ── profile ──
  profile:
    '{e:profile} <b>My Profile</b>\n\n' +
    '<blockquote>{e:profile} {name}\n{e:link} <code>{id}</code>\n{e:duration} <i>joined {joined}</i></blockquote>\n\n' +
    '{e:balance} <b>Balance:</b> <code>{balance}</code>\n{e:points} <b>Points:</b> {points}\n\n' +
    '{e:stats} <b>Stats</b>\n<blockquote>{e:orders} Orders: <b>{orders}</b>\n{e:total} Total spent: {spent}\n{e:deposit} Deposited: {deposited}</blockquote>\n' +
    '{referral_block}{discount_line}\n' +
    '{e:orders} <b>Latest orders</b>\n<blockquote>{latest}</blockquote>',
  profile_referral_block: '\n{e:gift} <b>Referrals</b> — <i>earn {percent}% of every friend\'s deposit</i>\n<blockquote>{e:referrals} Invited: <b>{invited}</b>\n{e:balance} Earned: {earned}</blockquote>\n',
  profile_discount_line: '{e:discount} Your discount: <b>{percent}%</b>\n',
  profile_order_line: '{status} <code>{code}</code> · {product} · {total}',
  profile_no_orders: '<i>No orders yet — the shop is one tap away.</i>',

  // ── orders ──
  orders_title: '{e:orders} <b>My orders</b> <i>(page {page})</i>\n\nTap an order to see the details.',
  orders_empty: '{e:orders} <b>My orders</b>\n\n<i>No orders yet — the shop is one tap away.</i>',
  order_detail:
    '{e:orders} <b>Order <code>{code}</code></b>\n\n' +
    '<blockquote>{e:product} {product} × {qty}\n{e:total} Total: <b>{total}</b>\n{e:info} Status: <b>{status}</b>\n{e:duration} Date: {date}{warranty_line}{refunded_line}</blockquote>{items}',
  order_warranty_until: '{e:warranty} Warranty until: <b>{until}</b>',
  order_warranty_expired: '{e:warranty} Warranty expired',
  order_refunded_line: '{e:refund} Refunded: <b>{amount}</b>',
  order_items_title: '{e:key} <b>Your items:</b>',
  status_pending_payment: 'Awaiting payment',
  status_paid: 'Paid',
  status_processing: 'Processing',
  status_awaiting_provider: 'Processing',
  status_manual_pending: 'Being prepared',
  status_delivered: 'Delivered',
  status_partially_delivered: 'Partially delivered',
  status_failed: 'Under review',
  status_refunded: 'Refunded',
  status_partially_refunded: 'Partially refunded',
  status_cancelled: 'Cancelled',

  // ── referrals, discounts, points, redeem ──
  referrals:
    '{e:referrals} <b>Referral program</b>\n\n' +
    '<blockquote>Share your link and earn <b>{percent}%</b> of every deposit your friends make — <i>forever</i>.</blockquote>\n\n' +
    '{e:link} <b>Your link</b> <i>(tap to copy)</i>\n<code>{link}</code>\n\n' +
    '<blockquote>{e:referrals} Invited: <b>{invited}</b>\n{e:balance} Earned: {earned}</blockquote>',
  discounts: '{e:discount} <b>My discounts</b>\n\n{e:discount} Your discount: <b>{percent}%</b>\n{e:total} Total spent: {spent}\n{levels}{points}',
  discount_levels_title: '{e:star} <b>Discount levels</b> <i>(by total spent)</i>',
  discount_level_line: '{mark} {name} {min} → <b>{percent}% off</b>',
  points_block: '\n{e:points} <b>Cashback points:</b> {points} <i>(≈ {value})</i>\n<i>You get {per_usd} points for every $1 spent. Convert from {min} points.</i>',
  points_not_enough: 'You need at least {min} points to convert.',
  points_redeemed: '{points} points converted to {amount}!',
  redeem_prompt: '{e:redeem} <b>Redeem a code</b>\n\nSend your gift code 👇',
  redeem_ok: '{e:success} <b>Code redeemed!</b>\n\n<b>{amount}</b> was added to your wallet.',

  // ── API ──
  api_title: '{e:api} <b>API access</b>\n\nBuy from your own app or bot with your wallet balance.\nBase URL: <code>{base}</code>\n\n<b>Your keys</b>\n{keys}',
  api_no_keys: '<i>No keys yet.</i>',
  api_key_line: '• <code>{prefix}…</code> <i>({date})</i>',
  api_key_created: '{e:key} <b>Your new API key</b> — shown only once, save it now:\n\n<code>{key}</code>',
  api_key_revoked: 'Key revoked',
  api_limit: 'You can have up to 3 active keys.',

  // ── freebies, giveaways ──
  freebies_title: '{e:freebies} <b>Freebies</b>\n\nFree resources for our community 👇',
  freebies_empty: '{e:freebies} <b>Freebies</b>\n\n<i>Nothing here right now — check back soon!</i>',
  freebie_view: '{e:gift} <b>{title}</b>\n\n{content}',
  giveaways_title: '{e:giveaways} <b>Events & giveaways</b>\n\nTap an event to join 👇',
  giveaways_empty: '{e:giveaways} <b>Events & giveaways</b>\n\n<i>No active events right now — stay tuned!</i>',
  giveaway_view:
    '{e:giveaways} <b>{title}</b>\n\n{description}\n' +
    '{e:gift} Prize: <b>{prize}</b>\n{e:star} Winners: <b>{winners}</b>\n{e:referrals} Entries: <b>{entries}</b>\n{e:clock} Ends: {ends}{requirement}\n\n{joined}',
  giveaway_requirement: '\n{e:info} Requires <b>{min}</b> total spent',
  giveaway_joined_yes: '{e:success} <b>You are in!</b> Good luck 🍀',
  giveaway_join_ok: 'You joined the giveaway. Good luck!',
  giveaway_join_already: 'You already joined this giveaway.',
  giveaway_join_min: 'This giveaway requires {min} total spent.',
  giveaway_ended: 'This giveaway has ended.',
  giveaway_won: '{e:gift} <b>Congratulations!</b>\n\nYou won the giveaway <b>{title}</b>: {prize} 🎉',

  // ── support, tickets, replacements ──
  support:
    '{e:support} <b>Support Center</b>\n\n' +
    '<blockquote>🙂 <b>We\'re here to help!</b>\n\n• Order not delivered or missing items\n• Payment not credited to wallet\n• Activation request questions\n• Refund or dispute requests\n• Any other enquiry</blockquote>\n\n' +
    '{e:warning} <b>Before contacting us, please have your Order ID ready.</b>\n<i>Find it under My Profile → My Orders.</i>\n{hours}\n' +
    '{e:delivery} <i>Tap <b>Contact Admin</b> below to open a direct chat with our team.</i>',
  support_hours_line: '\n{e:clock} {hours}\n',
  ticket_prompt: '{e:ticket} <b>Open a ticket</b>\n\nDescribe your issue in one message (you can attach a screenshot) 👇',
  ticket_created: '{e:success} Ticket <b>#{id}</b> created. Our team will reply here.',
  replace_choose: '{e:replace} <b>Request a replacement</b>\n\nChoose the order (only orders within warranty are shown) 👇',
  replace_none: '{e:replace} <b>Request a replacement</b>\n\n<i>You have no orders within warranty.</i>',
  replace_not_eligible: 'This order is not covered by warranty anymore.',
  replace_mode: '{e:replace} Order <code>{code}</code> — {product}\n\nWhat do you need?',
  replace_describe: '{e:info} Order <code>{code}</code>\n\nDescribe the problem (text or a screenshot) 👇',
  replace_sent: '{e:success} Request <b>#{id}</b> sent. We will get back to you here.',
  ticket_replaced: '{e:replace} <b>Replacement for order {code}</b> <i>(request #{id})</i>\n\n{items}{note}\n\n📌 <b>Keep this information safe.</b>',
  ticket_rejected: '{e:cancel} Your request <b>#{id}</b> was declined.{note}',
  ticket_answered: '{e:support} <b>Reply to your ticket #{id}</b>{note}',

  // ── errors ──
  err_generic: '{e:error} Something went wrong. Please try again.',
  err_expired: 'This action expired — please start again.',
  err_PRODUCT_NOT_FOUND: 'This product is not available anymore.',
  err_PRICE_UNAVAILABLE: 'This product is not available right now.',
  err_SOLD_OUT: 'Sold out right now — check back soon!',
  err_NOT_ENOUGH_STOCK: 'Not enough stock for that quantity. Please choose less.',
  err_QTY_INVALID: 'That quantity is not allowed for this product.',
  err_INPUT_MISSING: 'Some required details are missing. Please start again.',
  err_INPUT_INVALID: '{e:warning} That value is not valid. Please try again.',
  err_INPUT_DUPLICATE: '{e:warning} Each line must be different.',
  err_PROMO_INVALID: '{e:warning} This promo code is not valid.',
  err_PROMO_EXPIRED: '{e:warning} This promo code has expired.',
  err_PROMO_EXHAUSTED: '{e:warning} This promo code was fully used.',
  err_PROMO_NOT_APPLICABLE: '{e:warning} This promo code does not apply to this product.',
  err_PROMO_MIN_ORDER: '{e:warning} Your order is below the minimum for this promo code.',
  err_PROMO_USER_LIMIT: '{e:warning} You already used this promo code.',
  err_INSUFFICIENT_BALANCE: 'Not enough balance — please top up your wallet.',
  err_ORDER_NOT_FOUND: 'Order not found.',
  err_ORDER_NOT_PENDING: 'This order is no longer waiting for payment.',
  err_PAYMENT_FAILED: 'Payment failed. Please try again.',
  err_METHOD_DISABLED: 'This payment method is not available right now.',
  err_IDEMPOTENCY_CONFLICT: 'Please start the order again.',
  err_CODE_INVALID: '{e:warning} This code is not valid.',
  err_CODE_EXPIRED: '{e:warning} This code has expired.',
  err_CODE_USED: '{e:warning} You already used this code.',
  err_CODE_EXHAUSTED: '{e:warning} This code was fully used.',
  err_INSUFFICIENT_POINTS: 'Not enough points.',
  err_TICKET_EXISTS: '{e:info} There is already an open request for this order — we are on it.',
  err_TICKET_CLOSED: 'This request is already closed.',
  err_TICKET_NOT_FOUND: 'Request not found.',

  // ── delivery ──
  delivery_message:
    '{e:success} <b>Order delivered!</b>\n\n' +
    '{e:product} <b>{product}</b> × {qty}\n' +
    '{e:total} Paid: <b>{total}</b>\n\n' +
    '{e:key} <b>Your items:</b>\n{items}\n{note}\n' +
    '{e:warranty} Warranty: {warranty}\n' +
    '{e:link} Order ID: <code>{code}</code>\n' +
    '{points_line}' +
    '\n📌 <b>Keep this information safe.</b>\nThank you for your purchase! 🙏',
  delivery_message_no_items:
    '{e:success} <b>Order completed!</b>\n\n' +
    '{e:product} <b>{product}</b> × {qty}\n' +
    '{e:total} Paid: <b>{total}</b>\n{note}\n' +
    '{e:warranty} Warranty: {warranty}\n' +
    '{e:link} Order ID: <code>{code}</code>\n' +
    '{points_line}' +
    '\nThank you for your purchase! 🙏',
  delivery_items_in_file: '<i>Your items are in the attached TXT file.</i>',
  delivery_points_line: '{e:gift} You earned <b>{points}</b> cashback points.\n',

  // ── order status ──
  order_awaiting_provider:
    '{e:clock} <b>Order {code} is being processed</b>\n\n{product} × {qty}\nYou will receive it here automatically as soon as it is ready.',
  order_manual_pending:
    '{e:manual} <b>Order {code} received</b>\n\n{product} × {qty}\nIt is prepared by hand — we will send it here as soon as it is ready.',
  order_delayed:
    '{e:clock} <b>Order {code} is delayed</b>\n\nOur team is checking it now. You will get your product or a full refund — no action needed.',
  order_refunded_auto:
    '{e:refund} <b>Order {code} refunded</b>\n\nWe could not deliver <b>{product}</b> right now, so <b>{amount}</b> was returned to your wallet.',
  order_refunded: '{e:refund} <b>Refund for order {code}</b>\n\n<b>{amount}</b> was added back to your wallet.',

  // ── customer alerts ──
  btn_notify_me: 'Notify me when available',
  btn_notify_on: "You'll be notified — tap to cancel",
  notify_me_added: "Done! We'll message you as soon as it's back in stock.",
  notify_me_removed: 'Alert removed.',
  notify_me_unavailable: 'This product is available now, or you already follow too many products.',
  btn_alerts_on: 'Store alerts: ON',
  btn_alerts_off: 'Store alerts: OFF',
  alerts_turned_on: "Alerts on — you'll hear about new products and restocks.",
  alerts_turned_off: 'Alerts off — no more new-product or restock messages.',
  btn_open_shop: 'Open the shop',
  alert_line: '{emoji} <b>{name}</b> — {price}',
  alert_new_products: '{e:fire} <b>New in the store!</b>\n\n{lines}\n\n<i>Tap below to buy</i> 👇',
  alert_back_in_stock: '{e:success} <b>Back in stock!</b>\n\n{lines}\n\n<i>Get it before it runs out</i> 👇',
  alert_notify_me: '{e:bell} <b>Good news!</b>\n\n{emoji} <b>{name}</b> is back in stock.\n{e:price} Price: <b>{price}</b>',
} as const;
