import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/identity.ts",
    "src/manifest.ts",
    "src/envelope.ts",
    "src/audit.ts",
    "src/errors.ts",
    "src/constants.ts",
    "src/conversation.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
});
