import { describe, expect, it } from "vitest";
import { canonicalizeForSigning } from "../src/canonical.js";

const dec = new TextDecoder();

describe("canonicalizeForSigning", () => {
  it("sorts object keys", () => {
    const a = canonicalizeForSigning({ b: 1, a: 2 });
    const b = canonicalizeForSigning({ a: 2, b: 1 });
    expect(dec.decode(a)).toBe('{"a":2,"b":1}');
    expect(dec.decode(b)).toBe('{"a":2,"b":1}');
  });

  it("handles nested objects and arrays", () => {
    const out = canonicalizeForSigning({ x: { b: [1, 2], a: true } });
    expect(dec.decode(out)).toBe('{"x":{"a":true,"b":[1,2]}}');
  });

  it("rejects floats with a clear message", () => {
    expect(() => canonicalizeForSigning({ price: 0.5 })).toThrow(/float values are not permitted/);
  });

  it("rejects floats nested deep", () => {
    expect(() => canonicalizeForSigning({ x: { y: [1, 2.5, 3] } })).toThrow(/float values/);
  });

  it("accepts integers", () => {
    expect(dec.decode(canonicalizeForSigning({ n: 42 }))).toBe('{"n":42}');
  });

  it("accepts strings, booleans, and null", () => {
    expect(dec.decode(canonicalizeForSigning({ s: "x", b: false, n: null }))).toBe(
      '{"b":false,"n":null,"s":"x"}',
    );
  });
});
