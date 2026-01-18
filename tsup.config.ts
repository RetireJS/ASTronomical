import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  outDir: "lib",
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  treeshake: false,
  external: ["meriyah"],
  // Ensure proper file extensions
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".js" : ".mjs",
    };
  },
  // Banner for license
  banner: {
    js: `/**
 * ASTronomical - AST query language for JavaScript
 * @license Apache-2.0
 * Copyright (c) Erlend Oftedal
 */`,
  },
});
