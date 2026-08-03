import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('Test infrastructure', () => {
  it('vitest is configured correctly', () => {
    expect(true).toBe(true);
  });

  test.prop([fc.integer()])('fast-check integration works', (n) => {
    expect(typeof n).toBe('number');
  });
});
