/**
 * Agent definition via factory function (idiomatic TS — no decorators).
 *
 * ```ts
 * import { z } from "zod";
 * import { createAgent, capability } from "@agentagora/sdk";
 *
 * const codeReview = createAgent({
 *   name: "code-review",
 *   accepts: ["stripe-fiat"],
 *   capabilities: {
 *     review_pull_request: capability({
 *       input: z.object({ repoUrl: z.string(), prNumber: z.number() }),
 *       output: z.object({ comments: z.array(z.string()) }),
 *       price: { amount: "0.50", currency: "USD" },
 *       handler: async ({ repoUrl, prNumber }) => ({ comments: [] }),
 *     }),
 *   },
 * });
 *
 * await codeReview.serve({ port: 8080 });
 * ```
 */

import type { Privacy } from "@agentagora/protocol";
import type { z } from "zod";

export interface CapabilityPrice {
  amount?: string;
  currency?: string;
  /** Defaults to "per_call". Use "free" to omit amount/currency. */
  model?: "per_call" | "per_token" | "negotiated" | "free";
}

export interface CapabilitySLA {
  p50_ms?: number;
  p99_ms?: number;
  success_rate?: number;
}

export interface CapabilityDefinition<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  input: I;
  output: O;
  price?: CapabilityPrice;
  sla?: CapabilitySLA;
  description?: string;
  handler: (input: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>;
}

/**
 * Marker function — declares a capability. Returns the same object
 * unchanged plus a brand for type inference.
 */
export function capability<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: CapabilityDefinition<I, O>,
): CapabilityDefinition<I, O> & { readonly __aap_capability: true } {
  return Object.assign(def, { __aap_capability: true as const });
}

export interface AgentOptions {
  name: string;
  description?: string;
  accepts?: string[];
  privacy?: Partial<Privacy>;
  tags?: string[];
  homepage?: string;
  contact?: string;
  capabilities: Record<string, CapabilityDefinition<z.ZodTypeAny, z.ZodTypeAny>>;
}

export interface ServeOptions {
  host?: string;
  port?: number;
  /** Path prefix where AAP routes are mounted. Defaults to "/aap/v1". */
  basePath?: string;
}

export interface Agent {
  readonly name: string;
  readonly options: AgentOptions;
  serve(options?: ServeOptions): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Build an agent from a name, capabilities, and options. Does not
 * start a server — call `.serve()` for that.
 */
export function createAgent(options: AgentOptions): Agent {
  if (Object.keys(options.capabilities).length === 0) {
    throw new Error(`agent ${options.name}: at least one capability is required`);
  }

  return {
    name: options.name,
    options,
    async serve(_serveOptions?: ServeOptions): Promise<void> {
      throw new Error("Agent.serve — implemented in M1 task #7 (HTTPS) / #5 (mock)");
    },
    async stop(): Promise<void> {
      throw new Error("Agent.stop — implemented in M1 task #7");
    },
  };
}
