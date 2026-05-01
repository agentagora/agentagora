import { describe, expect, it } from "vitest";
import { z } from "zod";
import { capability, createAgent } from "../src/agent.js";

describe("createAgent", () => {
  it("builds an agent with at least one capability", () => {
    const a = createAgent({
      name: "code-review",
      accepts: ["stripe-fiat"],
      capabilities: {
        review_pr: capability({
          input: z.object({ repoUrl: z.string(), prNumber: z.number() }),
          output: z.object({ comments: z.array(z.string()) }),
          price: { amount: "0.50", currency: "USD" },
          handler: async ({ repoUrl, prNumber }) => {
            void repoUrl;
            void prNumber;
            return { comments: [] };
          },
        }),
      },
    });
    expect(a.name).toBe("code-review");
    expect(Object.keys(a.options.capabilities)).toEqual(["review_pr"]);
  });

  it("rejects an agent with zero capabilities", () => {
    expect(() =>
      createAgent({
        name: "broken",
        capabilities: {},
      }),
    ).toThrow(/at least one capability/);
  });

  it("serve() throws NotImplemented in v0.0.1", async () => {
    const a = createAgent({
      name: "x",
      capabilities: {
        ping: capability({
          input: z.object({}),
          output: z.object({ pong: z.boolean() }),
          price: { model: "free" },
          handler: () => ({ pong: true }),
        }),
      },
    });
    await expect(a.serve()).rejects.toThrow(/Agent.serve/);
  });
});

describe("capability", () => {
  it("brands the definition for type inference", () => {
    const cap = capability({
      input: z.object({}),
      output: z.object({}),
      price: { model: "free" },
      handler: () => ({}),
    });
    expect(cap.__aap_capability).toBe(true);
  });
});
