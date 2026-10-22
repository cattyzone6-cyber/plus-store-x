// Payment / deposit texts (English). Merged into DICTS.en by src/lib/i18n/index.ts.
export const payEn: Record<string, string> = {
  // copy button labels
  pay_label_amount: 'Copy amount',
  pay_label_address: 'Copy address',
  pay_label_pay_id: 'Copy Pay ID',
  pay_label_reference: 'Copy reference',
  pay_label_account: 'Copy account number',
  pay_btn_open_binance: 'Pay in Binance',

  pay_fee_line: '{e:info} Fee: <b>{fee}</b>\n',

  pay_binance_pay_instructions:
    '{e:binance} <b>Binance Pay</b>\n\n' +
    '{e:deposit} Wallet credit: <b>{credit}</b>\n{fee_line}' +
    '{e:total} You pay: <b>{amount} USDT</b>\n\n' +
    'Tap <b>Pay in Binance</b> below and confirm the payment in the Binance app.\n' +
    'Your wallet is credited automatically right after payment.\n\n' +
    '{e:clock} Expires in {minutes} min · Ref <code>{reference}</code>',

  pay_binance_id_instructions:
    '{e:binance} <b>Binance Pay ID transfer</b>\n\n' +
    '{e:deposit} Wallet credit: <b>{credit}</b>\n{fee_line}' +
    '{e:total} Send exactly: <b><code>{amount}</code> USDT</b>\n' +
    '{e:key} Pay ID: <code>{pay_id}</code>{receiver_line}\n' +
    '{e:link} Note / reference: <code>{reference}</code>\n\n' +
    '{e:warning} <b>Send the EXACT amount</b> (including the cents) — this is how we find your payment.\n' +
    '{instructions}' +
    'Then tap <b>I\'ve paid</b>. If it is not found, send us the Binance <b>Order ID</b> of the transfer.\n\n' +
    '{e:clock} Expires in {minutes} min',
  pay_binance_id_manual_instructions:
    '{e:binance} <b>Binance Pay ID transfer</b>\n\n' +
    '{e:deposit} Wallet credit: <b>{credit}</b>\n{fee_line}' +
    '{e:total} Send exactly: <b><code>{amount}</code> USDT</b>\n' +
    '{e:key} Pay ID: <code>{pay_id}</code>{receiver_line}\n' +
    '{e:link} Note / reference: <code>{reference}</code>\n\n' +
    '{e:warning} Send the <b>exact amount</b> and put the reference in the note.\n' +
    '{instructions}' +
    'Then tap <b>Send payment proof</b> and send a screenshot or the Binance <b>Order ID</b>. We credit your wallet as soon as we confirm it.\n\n' +
    '{e:clock} Send the proof within {minutes} min',
  pay_receiver_line: '\n{e:profile} Receiver: <b>{name}</b>',

  pay_nowpayments_instructions:
    '{e:usdt} <b>USDT (BEP20)</b>\n\n' +
    '{e:deposit} Wallet credit: <b>{credit}</b>\n{fee_line}' +
    '{e:total} Send exactly: <b><code>{amount}</code> {currency}</b>\n' +
    '{e:key} Address:\n<code>{address}</code>\n\n' +
    '{e:warning} Network: <b>{network}</b> only. Sending on another network loses the funds.\n' +
    '{e:warning} Send the full amount in <b>one</b> transaction.\n\n' +
    'Your wallet is credited automatically after the blockchain confirms.\n' +
    '{e:clock} Expires in {minutes} min · Ref <code>{reference}</code>',

  pay_shamcash_instructions:
    '{e:shamcash} <b>ShamCash</b>\n\n' +
    '{e:deposit} Wallet credit: <b>{credit}</b>\n{fee_line}' +
    '{e:total} Send: <b><code>{amount}</code> {currency}</b>\n' +
    '{e:profile} Account name: <b>{account_name}</b>\n' +
    '{e:key} Account number: <code>{account_number}</code>\n' +
    '{e:link} Reference: <code>{reference}</code>\n\n' +
    '{instructions}' +
    '{e:info} After paying, tap <b>Send proof</b> and send a <b>screenshot</b> or the <b>transaction number</b>. ' +
    'An admin will confirm it shortly.',

  // results
  pay_deposit_credited:
    '{e:success} <b>Deposit received!</b>\n\n' +
    '{e:deposit} Credited: <b>{amount}</b>\n' +
    '{e:balance} New balance: <b>{balance}</b>\n\nThank you! 🙏',
  pay_referral_bonus:
    '{e:referrals} <b>Referral bonus!</b>\n\nA friend you invited made a deposit — <b>{amount}</b> was added to your wallet.',
  pay_order_paid_after_deposit:
    '{e:success} Order <code>{code}</code> was paid from your wallet. Delivery is on the way…',
  pay_order_still_insufficient:
    '{e:warning} Your deposit was credited, but order <code>{code}</code> needs <b>{missing}</b> more. Top up again or open the order from the shop.',
  pay_order_not_pending:
    '{e:info} Your deposit is in your wallet. The linked order <code>{code}</code> was no longer pending — you can buy again from the shop.',
  pay_deposit_rejected:
    '{e:cancel} <b>Deposit not approved</b>\n\nRef <code>{reference}</code> ({amount}) was rejected.{note}\nIf you think this is a mistake, contact support with your proof.',
  pay_deposit_expired:
    '{e:clock} <b>Payment expired</b>\n\nRef <code>{reference}</code> ({amount}) was not paid in time. If you already sent the money, contact support with the transaction details.',
  pay_deposit_cancelled: '{e:cancel} Deposit <code>{reference}</code> cancelled.',
  pay_still_pending:
    '{e:clock} We have not received this payment yet. Blockchain / Binance transfers can take a few minutes — try again shortly.',
  pay_under_review:
    '{e:clock} Your payment is <b>under review</b> by an admin. You will be notified here.',
  pay_proof_received:
    '{e:success} <b>Proof received!</b>\n\nAn admin will check it and credit your wallet shortly. Ref <code>{reference}</code>.',
  pay_partial_review:
    '{e:warning} We received <b>less than the required amount</b> for ref <code>{reference}</code>. An admin will review it and contact you.',

  // errors
  pay_below_min: '{e:warning} The minimum for this method is <b>{min}</b>.',
  pay_above_max: '{e:warning} The maximum deposit is <b>{max}</b>.',
  pay_method_disabled: '{e:warning} This payment method is not available right now.',
  pay_not_configured: '{e:warning} This payment method is not configured yet. Please choose another one.',
  pay_gateway_error: '{e:error} The payment provider did not respond. Please try again in a minute or choose another method.',
};
