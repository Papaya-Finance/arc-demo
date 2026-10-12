import test from "node:test";
import assert from "node:assert/strict";
import { allowanceFor, refillQuote, SCALE, MONTH, minimumBalance } from "./math.mjs";
test("allowance covers each rounded monthly refill plus a separate deposit", () => {
  for (const rate of [1n, 8_000_000_001n, 24_000_000_000n]) {
    for (const months of [1, 3, 6, 12]) {
      const allowance = allowanceFor(rate, 0n, months, 20_000n);
      assert.equal(allowance - 20_000n, refillQuote(rate) * BigInt(months));
      assert.ok(refillQuote(rate) * SCALE >= rate * MONTH);
      assert.ok(refillQuote(rate) * SCALE - rate * MONTH < SCALE);
    }
  }
});
test("income offsets refill, gross outgoing sets safety reserve", () => {
  assert.equal(allowanceFor(12n, 5n, 3), refillQuote(7n) * 3n);
  assert.equal(allowanceFor(5n, 12n, 3), 0n);
  assert.equal(minimumBalance(8_000_000_000n, 0n, 1n, 20_000_000_000n), 4_782_400_000_000_000n);
});
test("invalid period is rejected", () => assert.throws(() => allowanceFor(1n, 0n, 2)));
