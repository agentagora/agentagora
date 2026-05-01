import { describe, expect, it } from "vitest";
import { ErrorCodes, ErrorNames, makeRpcError } from "../src/errors.js";

describe("makeRpcError", () => {
  it("uses the canonical name when message is omitted", () => {
    const err = makeRpcError(ErrorCodes.PaymentRequired);
    expect(err.code).toBe(-32005);
    expect(err.message).toBe("aap.payment_required");
    expect(err.data).toBeUndefined();
  });

  it("preserves custom message and data", () => {
    const err = makeRpcError(ErrorCodes.PaymentRequired, "need a channel", {
      required_channels: ["stripe-fiat"],
    });
    expect(err.message).toBe("need a channel");
    expect(err.data).toEqual({ required_channels: ["stripe-fiat"] });
  });

  it("ErrorNames covers every ErrorCode", () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorNames[code]).toBeTruthy();
    }
  });
});
