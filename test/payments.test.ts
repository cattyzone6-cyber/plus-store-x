import { describe, expect, it } from 'vitest';
import { nowpaymentsSignature, sortKeysDeep, verifyNowpaymentsSignature, mapNowStatus } from '../src/payments/nowpayments';
import { binancePaySignature, parseBinancePayWebhook } from '../src/payments/binancePay';
import { matchTransaction, type PayTransaction } from '../src/payments/binanceId';
import { fmtAmount } from '../src/payments/util';

describe('NOWPayments IPN signature', () => {
  const secret = 'ipn-secret';
  const body = { payment_status: 'finished', payment_id: 123, price_amount: 10.5, order_id: 'DABC', fee: { depositFee: 0, currency: 'usdtbsc' } };

  it('sorts keys recursively', () => {
    expect(JSON.stringify(sortKeysDeep(body))).toBe(
      '{"fee":{"currency":"usdtbsc","depositFee":0},"order_id":"DABC","payment_id":123,"payment_status":"finished","price_amount":10.5}',
    );
  });

  it('matches node HMAC-SHA512 over the sorted JSON', async () => {
    // vector generated with node:crypto createHmac('sha512', secret) over the sorted JSON
    const expected = 'ecb74fb55c9016626e2eed160a09cadbc15cde431ff93c398e0794906cfcc9ea3ab65de7b447c8618cee14a51bf1f9c099a390df5dc8eaa94d0b689f77a6e5fa';
    expect(await nowpaymentsSignature(secret, body)).toBe(expected);
    expect(await verifyNowpaymentsSignature(secret, body, expected)).toBe(true);
    expect(await verifyNowpaymentsSignature(secret, body, expected.toUpperCase())).toBe(true);
    expect(await verifyNowpaymentsSignature(secret, { ...body, price_amount: 99 }, expected)).toBe(false);
    expect(await verifyNowpaymentsSignature(secret, body, null)).toBe(false);
  });

  it('maps statuses', () => {
    expect(mapNowStatus({ payment_id: 1, payment_status: 'finished' }, { amount_usd: 10 })).toMatchObject({ status: 'paid', creditUsd: 10, externalId: '1' });
    expect(mapNowStatus({ payment_id: 1, payment_status: 'partially_paid', actually_paid: 4 }, { amount_usd: 10 })).toMatchObject({ status: 'pending', meta: { partial: true } });
    expect(mapNowStatus({ payment_id: 1, payment_status: 'expired' }, { amount_usd: 10 }).status).toBe('expired');
    expect(mapNowStatus({ payment_id: 1, payment_status: 'waiting' }, { amount_usd: 10 }).status).toBe('pending');
  });
});

describe('Binance Pay request signature', () => {
  it('is uppercase HMAC-SHA512 of ts\\nnonce\\nbody\\n', async () => {
    const body = JSON.stringify({ merchantTradeNo: 'DABC', orderAmount: 10 });
    // vector generated with node:crypto createHmac('sha512', 'sec')
    const expected = 'A1AE79569D5F2AC6E990F63CF11E504B11404C790ECA6B239DE07F9028DE604B68A2B23524D0D85D490D02C9FDF5CFED53D6EC1711A3F8B7DAAD7A7847F743BD';
    expect(await binancePaySignature('sec', '1700000000000', 'nonce123', body)).toBe(expected);
  });

  it('parses webhook payloads', () => {
    const info = parseBinancePayWebhook({ bizType: 'PAY', bizIdStr: '29383937493038367292', bizStatus: 'PAY_SUCCESS', data: JSON.stringify({ merchantTradeNo: 'DABC', transactionId: 'T1' }) });
    expect(info).toEqual({ paid: true, closed: false, merchantTradeNo: 'DABC', prepayId: '29383937493038367292', transactionId: 'T1' });
  });
});

describe('Binance Pay ID matching', () => {
  const created = new Date('2026-10-21T12:00:00Z');
  const deposit = { pay_amount: 10.37, reference: 'DREF12345', proof_text: null, created_at: created.toISOString() };
  const tx = (id: string, amount: string, minutesAfter: number, extra: Partial<PayTransaction> = {}): PayTransaction => ({
    transactionId: id, amount, currency: 'USDT', transactionTime: created.getTime() + minutesAfter * 60_000, ...extra,
  });

  it('matches by exact unique amount', () => {
    const m = matchTransaction(deposit, [tx('1', '10.36', 1), tx('2', '10.37', 2)], new Set(), { trustAmount: true });
    expect(m?.kind).toBe('paid');
    expect(m?.tx.transactionId).toBe('2');
  });

  it('does not trust amount when unique amounts are off', () => {
    expect(matchTransaction(deposit, [tx('2', '10.37', 2)], new Set(), { trustAmount: false })).toBeNull();
  });

  it('ignores used and too-old transactions', () => {
    expect(matchTransaction(deposit, [tx('2', '10.37', 2)], new Set(['2']), { trustAmount: true })).toBeNull();
    expect(matchTransaction(deposit, [tx('3', '10.37', -30)], new Set(), { trustAmount: true })).toBeNull();
  });

  it('matches by note reference and by pasted transaction id', () => {
    expect(matchTransaction(deposit, [tx('4', '10.37', 1, { note: 'pay dref12345 thanks' })], new Set(), { trustAmount: false })?.kind).toBe('paid');
    const withProof = { ...deposit, proof_text: ' 555 ' };
    expect(matchTransaction(withProof, [tx('555', '10.37', 1)], new Set(), { trustAmount: false })?.tx.transactionId).toBe('555');
  });

  it('flags underpayment as partial', () => {
    const m = matchTransaction({ ...deposit, proof_text: '9' }, [tx('9', '5.00', 1)], new Set(), { trustAmount: false });
    expect(m).toMatchObject({ kind: 'partial', received: 5 });
  });

  it('ignores outgoing (negative) transfers', () => {
    expect(matchTransaction(deposit, [tx('7', '-10.37', 1)], new Set(), { trustAmount: true })).toBeNull();
  });
});

describe('fmtAmount', () => {
  it('formats crypto amounts', () => {
    expect(fmtAmount(10)).toBe('10.00');
    expect(fmtAmount(10.37)).toBe('10.37');
    expect(fmtAmount(12.345678)).toBe('12.345678');
  });
});
