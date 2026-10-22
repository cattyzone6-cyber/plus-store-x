import { describe, expect, it } from 'vitest';
import { reminderDue } from '../src/services/deposits';

const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 12, 0) + min * 60_000).toISOString();
const t = (min: number) => new Date(at(min)).getTime();

describe('payment reminder', () => {
  const d = { created_at: at(0), expires_at: at(20) };
  it('waits until halfway', () => {
    expect(reminderDue(d, t(9))).toBe(false);
    expect(reminderDue(d, t(10))).toBe(true);
    expect(reminderDue(d, t(19))).toBe(true);
  });
  it('never after expiry', () => expect(reminderDue(d, t(21))).toBe(false));
  it('skips very short windows and deposits without expiry', () => {
    expect(reminderDue({ created_at: at(0), expires_at: at(3) }, t(2))).toBe(false);
    expect(reminderDue({ created_at: at(0), expires_at: null }, t(30))).toBe(false);
  });
});
