import { ErrorCodes, makeRpcError } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import {
  AAPError,
  PaymentRequiredError,
  ScopeDeniedError,
  UnauthorizedError,
} from "../src/errors.js";

describe("AAPError.fromRpc", () => {
  it("constructs the right subclass for a known code", () => {
    const wire = makeRpcError(ErrorCodes.Unauthorized, "you shall not pass");
    const err = AAPError.fromRpc(wire);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.code).toBe(-32001);
    expect(err.message).toBe("you shall not pass");
  });

  it("falls back to AAPError for an unknown code", () => {
    const wire = { code: -42, message: "weird" };
    const err = AAPError.fromRpc(wire);
    expect(err).toBeInstanceOf(AAPError);
    expect(err.code).toBe(-42);
  });
});

describe("PaymentRequiredError", () => {
  it("exposes requiredChannels from data", () => {
    const e = new PaymentRequiredError("need a channel", {
      required_channels: ["stripe-fiat", "usdc-base"],
    });
    expect(e.requiredChannels).toEqual(["stripe-fiat", "usdc-base"]);
  });

  it("returns empty array when data is missing", () => {
    const e = new PaymentRequiredError();
    expect(e.requiredChannels).toEqual([]);
  });
});

describe("toRpc roundtrip", () => {
  it("preserves code, message, and data", () => {
    const e = new ScopeDeniedError("nope", { scope: "agent.spend:1000usd/day" });
    const wire = e.toRpc();
    const back = AAPError.fromRpc(wire);
    expect(back).toBeInstanceOf(ScopeDeniedError);
    expect(back.message).toBe("nope");
    expect(back.data).toEqual({ scope: "agent.spend:1000usd/day" });
  });
});
