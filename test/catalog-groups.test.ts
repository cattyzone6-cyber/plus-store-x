import { describe, expect, it } from 'vitest';
import { orderPacks, type ProductView } from '../src/services/catalog';

function pack(name: string, o: { price?: number | null; soldOut?: boolean; pinned?: boolean; sort?: number } = {}): ProductView {
  return {
    product: { id: name, name_en: name, pinned: o.pinned ?? false, sort: o.sort ?? 0 } as ProductView['product'],
    pricing: { unitPrice: o.price === undefined ? 1 : o.price, soldOut: o.soldOut ?? false } as ProductView['pricing'],
  };
}

describe('orderPacks', () => {
  it('sold out last, pinned first, then sort, price, natural name', () => {
    const out = orderPacks([
      pack('ChatGPT Plus 100M', { price: 5 }),
      pack('ChatGPT Plus 12M', { price: 5 }),
      pack('ChatGPT Plus 1M', { price: 3, soldOut: true }),
      pack('ChatGPT Plus 3M', { price: 9, pinned: true }),
      pack('ChatGPT Plus 6M', { price: 2, sort: 5 }),
      pack('ChatGPT Plus API', { price: 1 }),
    ]).map((v) => v.product.name_en);
    expect(out).toEqual([
      'ChatGPT Plus 3M', // pinned
      'ChatGPT Plus API', // sort 0, cheapest
      'ChatGPT Plus 12M', // same price → natural order: 12 before 100
      'ChatGPT Plus 100M',
      'ChatGPT Plus 6M', // sort 5
      'ChatGPT Plus 1M', // sold out last
    ]);
  });

  it('does not mutate its input', () => {
    const input = [pack('B', { price: 2 }), pack('A', { price: 1 })];
    orderPacks(input);
    expect(input.map((v) => v.product.name_en)).toEqual(['B', 'A']);
  });
});
