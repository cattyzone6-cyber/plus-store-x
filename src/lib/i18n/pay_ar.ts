// Payment / deposit texts (Arabic). Merged into DICTS.ar by src/lib/i18n/index.ts.
export const payAr: Record<string, string> = {
  pay_label_amount: 'نسخ المبلغ',
  pay_label_address: 'نسخ العنوان',
  pay_label_pay_id: 'نسخ Pay ID',
  pay_label_reference: 'نسخ المرجع',
  pay_label_account: 'نسخ رقم الحساب',
  pay_btn_open_binance: 'ادفع عبر بينانس',

  pay_fee_line: '{e:info} الرسوم: <b>{fee}</b>\n',

  pay_binance_pay_instructions:
    '{e:binance} <b>Binance Pay</b>\n\n' +
    '{e:deposit} الرصيد المضاف: <b>{credit}</b>\n{fee_line}' +
    '{e:total} المبلغ المطلوب: <b>{amount} USDT</b>\n\n' +
    'اضغط <b>ادفع عبر بينانس</b> بالأسفل وأكّد الدفع في تطبيق بينانس.\n' +
    'سيُضاف الرصيد إلى محفظتك تلقائياً بعد الدفع مباشرة.\n\n' +
    '{e:clock} ينتهي خلال {minutes} دقيقة · المرجع <code>{reference}</code>',

  pay_binance_id_instructions:
    '{e:binance} <b>تحويل عبر Binance Pay ID</b>\n\n' +
    '{e:deposit} الرصيد المضاف: <b>{credit}</b>\n{fee_line}' +
    '{e:total} أرسل بالضبط: <b><code>{amount}</code> USDT</b>\n' +
    '{e:key} Pay ID: <code>{pay_id}</code>{receiver_line}\n' +
    '{e:link} الملاحظة / المرجع: <code>{reference}</code>\n\n' +
    '{e:warning} <b>أرسل المبلغ بالضبط</b> (مع الكسور) — هكذا نتعرف على دفعتك.\n' +
    '{instructions}' +
    'ثم اضغط <b>لقد دفعت</b>. إذا لم يتم العثور عليها، أرسل لنا <b>رقم الطلب (Order ID)</b> للتحويل من بينانس.\n\n' +
    '{e:clock} ينتهي خلال {minutes} دقيقة',
  pay_binance_id_manual_instructions:
    '{e:binance} <b>تحويل عبر Binance Pay ID</b>\n\n' +
    '{e:deposit} الرصيد المضاف: <b>{credit}</b>\n{fee_line}' +
    '{e:total} أرسل بالضبط: <b><code>{amount}</code> USDT</b>\n' +
    '{e:key} Pay ID: <code>{pay_id}</code>{receiver_line}\n' +
    '{e:link} الملاحظة / المرجع: <code>{reference}</code>\n\n' +
    '{e:warning} أرسل <b>المبلغ بالضبط</b> وضع المرجع في الملاحظة.\n' +
    '{instructions}' +
    'ثم اضغط <b>إرسال إثبات الدفع</b> وأرسل صورة التحويل أو <b>رقم الطلب (Order ID)</b> من بينانس. سنضيف الرصيد فور التأكد.\n\n' +
    '{e:clock} أرسل الإثبات خلال {minutes} دقيقة',
  pay_receiver_line: '\n{e:profile} المستلم: <b>{name}</b>',

  pay_nowpayments_instructions:
    '{e:usdt} <b>USDT (BEP20)</b>\n\n' +
    '{e:deposit} الرصيد المضاف: <b>{credit}</b>\n{fee_line}' +
    '{e:total} أرسل بالضبط: <b><code>{amount}</code> {currency}</b>\n' +
    '{e:key} العنوان:\n<code>{address}</code>\n\n' +
    '{e:warning} الشبكة: <b>{network}</b> فقط. الإرسال على شبكة أخرى يؤدي لضياع الأموال.\n' +
    '{e:warning} أرسل المبلغ كاملاً في <b>معاملة واحدة</b>.\n\n' +
    'سيُضاف الرصيد تلقائياً بعد تأكيد الشبكة.\n' +
    '{e:clock} ينتهي خلال {minutes} دقيقة · المرجع <code>{reference}</code>',

  pay_shamcash_instructions:
    '{e:shamcash} <b>شام كاش</b>\n\n' +
    '{e:deposit} الرصيد المضاف: <b>{credit}</b>\n{fee_line}' +
    '{e:total} أرسل: <b><code>{amount}</code> {currency}</b>\n' +
    '{e:profile} اسم الحساب: <b>{account_name}</b>\n' +
    '{e:key} رقم الحساب: <code>{account_number}</code>\n' +
    '{e:link} المرجع: <code>{reference}</code>\n\n' +
    '{instructions}' +
    '{e:info} بعد الدفع اضغط <b>إرسال الإثبات</b> وأرسل <b>لقطة شاشة</b> أو <b>رقم العملية</b>. ' +
    'سيقوم المشرف بالتأكيد قريباً.',

  pay_deposit_credited:
    '{e:success} <b>تم استلام الإيداع!</b>\n\n' +
    '{e:deposit} المبلغ المضاف: <b>{amount}</b>\n' +
    '{e:balance} الرصيد الجديد: <b>{balance}</b>\n\nشكراً لك! 🙏',
  pay_referral_bonus:
    '{e:referrals} <b>مكافأة إحالة!</b>\n\nقام صديق دعوته بالإيداع — تمت إضافة <b>{amount}</b> إلى محفظتك.',
  pay_order_paid_after_deposit:
    '{e:success} تم دفع الطلب <code>{code}</code> من محفظتك. جاري التسليم…',
  pay_order_still_insufficient:
    '{e:warning} تم إضافة الإيداع، لكن الطلب <code>{code}</code> يحتاج <b>{missing}</b> إضافية. اشحن مرة أخرى أو افتح الطلب من المتجر.',
  pay_order_not_pending:
    '{e:info} الإيداع موجود في محفظتك. الطلب المرتبط <code>{code}</code> لم يعد بانتظار الدفع — يمكنك الشراء مجدداً من المتجر.',
  pay_deposit_rejected:
    '{e:cancel} <b>لم تتم الموافقة على الإيداع</b>\n\nالمرجع <code>{reference}</code> ({amount}) مرفوض.{note}\nإذا كنت تعتقد أن هذا خطأ، تواصل مع الدعم مع إثبات الدفع.',
  pay_deposit_expired:
    '{e:clock} <b>انتهت مهلة الدفع</b>\n\nالمرجع <code>{reference}</code> ({amount}) لم يُدفع في الوقت المحدد. إذا كنت قد أرسلت المبلغ، تواصل مع الدعم مع تفاصيل العملية.',
  pay_deposit_cancelled: '{e:cancel} تم إلغاء الإيداع <code>{reference}</code>.',
  pay_still_pending:
    '{e:clock} لم نستلم هذه الدفعة بعد. قد تستغرق تحويلات بينانس / الشبكة بضع دقائق — حاول مرة أخرى بعد قليل.',
  pay_under_review: '{e:clock} دفعتك <b>قيد المراجعة</b> من قبل المشرف. سيتم إشعارك هنا.',
  pay_proof_received:
    '{e:success} <b>تم استلام الإثبات!</b>\n\nسيتحقق المشرف منه ويضيف الرصيد قريباً. المرجع <code>{reference}</code>.',
  pay_partial_review:
    '{e:warning} استلمنا <b>مبلغاً أقل من المطلوب</b> للمرجع <code>{reference}</code>. سيراجعه المشرف ويتواصل معك.',

  pay_below_min: '{e:warning} الحد الأدنى لهذه الطريقة هو <b>{min}</b>.',
  pay_above_max: '{e:warning} الحد الأقصى للإيداع هو <b>{max}</b>.',
  pay_method_disabled: '{e:warning} طريقة الدفع هذه غير متاحة حالياً.',
  pay_not_configured: '{e:warning} طريقة الدفع هذه غير مُعدّة بعد. يرجى اختيار طريقة أخرى.',
  pay_gateway_error: '{e:error} مزود الدفع لم يستجب. حاول مرة أخرى بعد دقيقة أو اختر طريقة أخرى.',
};
