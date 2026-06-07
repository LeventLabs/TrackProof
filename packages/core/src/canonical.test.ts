import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "./canonical.js";
import { canonicalHash } from "./hash.js";

test("object key order does not affect the output", () => {
  const a = canonicalize({ b: 1, a: 2, c: 3 });
  const b = canonicalize({ c: 3, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":3}');
});

test("undefined object values are omitted", () => {
  assert.equal(canonicalize({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
});

test("nested objects and arrays are deterministic", () => {
  const value = { z: [3, 2, 1], a: { y: true, x: null } };
  assert.equal(canonicalize(value), '{"a":{"x":null,"y":true},"z":[3,2,1]}');
});

test("non-finite numbers are rejected", () => {
  assert.throws(() => canonicalize({ n: Infinity }));
  assert.throws(() => canonicalize({ n: NaN }));
});

test("golden vector — frozen canonical bytes (cross-implementation contract)", () => {
  const sample = {
    agent_id: "ab12",
    seq: 0,
    kind: "trade_decision",
    body: { instrument: "BTCUSDT", size: "1.5", side: "short" },
  };
  const expected =
    '{"agent_id":"ab12","body":{"instrument":"BTCUSDT","side":"short","size":"1.5"},"kind":"trade_decision","seq":0}';
  assert.equal(canonicalize(sample), expected);
  // The hash must be stable across calls (and across any conforming implementation).
  assert.equal(canonicalHash(sample), canonicalHash(sample));
  assert.match(canonicalHash(sample), /^[0-9a-f]{64}$/);
});
