/**
 * @agentagora/protocol — wire types and Zod schemas for the AAP.
 *
 * This package is the single source of truth for the on-the-wire shape
 * of every AAP message. Other packages (SDK, Cloud Platform, Dashboard)
 * derive their types from here. Do not duplicate these types elsewhere;
 * import them.
 */

export * from "./constants.js";
export * from "./errors.js";
export * from "./identity.js";
export * from "./manifest.js";
export * from "./envelope.js";
export * from "./audit.js";
export * from "./conversation.js";
