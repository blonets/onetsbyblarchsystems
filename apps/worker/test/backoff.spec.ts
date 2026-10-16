import { describe, expect, it } from 'vitest';
import { withBackoff } from '../src/backoff.js';

describe('withBackoff', () => {
  it('returns on first success', async () => {
    const sleeps: number[] = [];
    const result = await withBackoff(async () => 'ok', {}, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(result).toEqual({ value: 'ok', attempts: 1 });
    expect(sleeps).toHaveLength(0);
  });

  it('follows the exponential schedule deterministically without jitter', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw new Error('boom');
        },
        { maxAttempts: 4, baseMs: 500, maxMs: 10_000, jitter: false },
        { sleep: async (ms) => { sleeps.push(ms); } },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(4);
    expect(sleeps).toEqual([500, 1000, 2000]); // no sleep after the final attempt
  });

  it('caps delays at maxMs', async () => {
    const sleeps: number[] = [];
    await expect(
      withBackoff(
        async () => { throw new Error('x'); },
        { maxAttempts: 5, baseMs: 1000, maxMs: 1500, jitter: false },
        { sleep: async (ms) => { sleeps.push(ms); } },
      ),
    ).rejects.toThrow();
    expect(sleeps).toEqual([1000, 1500, 1500, 1500]);
  });

  it('applies 0.5–1.0 jitter with an injectable random', async () => {
    const sleeps: number[] = [];
    await expect(
      withBackoff(
        async () => { throw new Error('x'); },
        { maxAttempts: 3, baseMs: 1000, jitter: true },
        { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 },
      ),
    ).rejects.toThrow();
    // delay * (0.5 + 0.5*0.5) = delay * 0.75
    expect(sleeps).toEqual([750, 1500]);
  });

  it('honours shouldRetry veto (auth failures are not retried)', async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw new Error('login failed');
        },
        { maxAttempts: 5 },
        {},
        (err) => !/login/i.test((err as Error).message),
      ),
    ).rejects.toThrow('login failed');
    expect(calls).toBe(1);
  });
});
