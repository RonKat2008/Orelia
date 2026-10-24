import { describe, expect, test } from 'vitest';
import { greet } from '../src/greet.js';

describe('greet', () => {
  test('greets a trimmed name', () => {
    expect(greet('  Sam ')).toBe('Welcome to Wayfinder, Sam!');
  });

  test('throws on an empty name', () => {
    expect(() => greet('   ')).toThrow('name must not be empty');
  });
});
