## Quick context

ASTronomical (package name: `astronomical`) is a small TypeScript library that provides a query language for JavaScript ASTs (inspired by XPath/astq). The implementation lives in `src/` and compiled artifacts are in `lib/` (both CJS and ESM builds).

Key files to reference:

- `package.json` — scripts for build/test/typecheck and important dependency `meriyah`.
- `src/*.ts` — main implementation: `index.ts`, `parseQuery.ts`, `nodeutils.ts`, `utils.ts`.
- `lib/` — generated output. Use these for examples of the compiled API surface and types in `lib/*/types`.

## Big picture architecture (what to know first)

- Purpose: provide `query(code, query)` and `multiQuery(code, namedQueries)` which parse JS source (via `meriyah`) and run a small, custom AST-query engine implemented across `parseQuery.ts` and helpers.
- Flow: source string -> `parseSource` (in `index.ts`) -> AST nodes augmented with lightweight `NodePath` wrappers from `createTraverser()` -> query parsed by `parseQuery.ts` -> traverser resolves selectors, filters and function calls and returns matched nodes/primitive values.
- Scopes & Bindings: traverser registers bindings and scopes (see `createTraverser()` in `index.ts` and `nodeutils.ts`). Many query features rely on scope/binding resolution (selectors with `$:` or `$$:` and `/:...` attributes).

## Developer workflows (commands you will actually run)

- Build (local): npm run build — runs `tsc` twice (ESM and CJS) and creates `lib/`
- Typecheck: npm run typecheck (runs `tsc --noEmit`)
- Lint: npm run lint (eslint with --fix)
- Test: npm test (uses `jest --ci`). Use `npm run testWatch` for interactive development.
- Prepack: `npm pack` will run `prepack` which triggers `npm run build` via package scripts.

If you edit TypeScript sources, run `npm run build` (or `npm run watch` during development) before publishing; consumers import from `lib/`.

## Project-specific conventions and patterns

- Dual-build output: The repository ships both CJS and ESM builds in `lib/cjs` and `lib/esm`. The `exports` map in `package.json` points to these._Always update both builds via the `build` script._
- Minimal runtime types: The code augments AST nodes with small `extra` fields (e.g., `extra.scopeId`) and uses a `NodePath` wrapper (see `createNodePath`) rather than relying on Babel's NodePath. When making changes that touch traversal, update both binding registration and `getBinding` behaviour.
- Query language tokens & AST: The custom query parser (`parseQuery.ts`) tokenizes a compact domain-specific language (selectors `//`, `/`, `:attr`, `$:` binding selectors, `fn:` functions). When adding functions, register them in the `functions` map in `index.ts` and declare their type-safety in `parseQuery.ts` if needed.
- Memoization & performance: `createQuerier()` (in `index.ts`) memoizes subqueries during traversal with a Map keyed by QNode and NodePath. Be careful if you add stateful behavior to QNodes or NodePath objects — it can break memoization.

## Integration points and external dependencies

- Parsing: `meriyah` is the only runtime parser dependency (see `package.json`). `parseSource` calls `parseScript` with `webcompat` fallback when appropriate.
- Tests: Jest + ts-jest. Tests live in `tests/` and exercise query parsing and runtime behaviour. Look at `tests/parseQuery.test.ts` and `tests/query.test.ts` for representative cases.
- Consumers import the built files from `lib/` (types are under `lib/*/types`). Changing public API requires updating `exports` in `package.json` if you move files.

## Small, concrete examples for the agent

- To add a helper function to the query language (example: `/fn:uppercase(selector)`):

  1. Add the implementation to the `functions` map in `src/index.ts` (see `join`, `concat`, `first`, `nthchild`).
  2. Add the function name to `AvailableFunction` typing in `parseQuery.ts` if needed (or rely on the runtime `isAvailableFunction`).
  3. Update tests in `tests/` and run `npm run test`.

- To change how bindings are resolved:
  1. Inspect `createTraverser()` in `src/index.ts` — `registerBindings`, `registerBinding`, and `getBinding` are central.
  2. Keep in mind scopes are stored in a Map and may be stored as lightweight parent pointers (numbers) until populated; follow the existing pattern when mutating scope data.

## Files to inspect for common tasks

- Query parsing & language: `src/parseQuery.ts`
- Traversal, memoization and query execution: `src/index.ts` (big file — read top-to-bottom)
- Visitor keys and helper predicates: `src/nodeutils.ts`
- Small utilities: `src/utils.ts`
- Tests and usage examples: `tests/*.ts`, built runtime in `lib/` shows the final compiled layout

## Do not assume / gotchas

- Don't bypass `npm run build` — releases consume `lib/` not `src/`.
- Tests and internal logic rely on `NodePath` weakmap-based identity and `extra.scopeId`; modifying node identity or mutating AST nodes in-place can break binding lookups and memoization.
- The parser intentionally toggles parsing options (`module: true` then fallback to `module: false, webcompat: true`) — replicate this pattern when adding alternative parsing flows.

## Performance & large inputs

This library is frequently used to query large, minified bundles. Follow these concrete patterns to keep runs fast and memory-efficient:

- Parse with minimal AST metadata. The code already supports an `optimize` mode in `parseSource` which disables `loc` and `ranges`. For very large/minified input always use that (default behaviour when not requesting `returnAST`). Example:

```ts
// parse with minimal metadata (faster + lower memory)
const ast = parseSource(largeMinifiedString, /* optimize */ true);
```

- Run many queries in a single traversal. Use `multiQuery(code, namedQueries)` instead of calling `query` repeatedly — the traverser is designed to evaluate multiple queries in one pass and is the single biggest win for large files.

- Prefer child selectors (`/Type`) and attribute selectors (`/:name`) over wide descendant searches (`//Type`) when possible. `//` increases the traversal work and can drastically increase memory pressure on large ASTs.

- Avoid parent (`..`) filters and filters that cause nested sub-traversals where possible. Parent filters and filters that invoke `travHandle` on subqueries cause extra traversal work and reduce memoization effectiveness.

- Use function helpers to reduce returned result set early. For example, use `/fn:first(selector)` or implement a `limit` function in `src/index.ts` to cap results and avoid collecting large arrays in memory.

- Leverage attribute lookups for primitives. Selectors that target primitive attributes (e.g., `/:name`) avoid creating NodePath objects for full child traversal — use them where you only need simple values.

- Respect memoization rules. The querier memoizes subqueries by QNode and NodePath. Do not make QNodes or NodePath objects stateful, and avoid mutating node identity (the `nodePathMap` WeakMap is relied upon). Adding per-node state or mutating AST nodes can silently defeat memoization and explode memory use.

- If memory is still an issue:
  - Run Node with higher heap (`node --max-old-space-size=4096`) for CI runs that analyze very large bundles.
  - Consider splitting the bundle when feasible and run queries per-file/module.

Small example combining a fast parse with a multiQuery:

```ts
import { multiQuery, parseSource } from "astronomical";

const code = await fs.promises.readFile("bundle.min.js", "utf8");
const result = multiQuery(code, {
  findVersions: `//Literal[../:left/:name == "migrateVersion"]`,
  findFns: `/FunctionDeclaration/:id/:name`,
});
```

---

If any section is unclear or you'd like additional examples (e.g., adding a specific test or adding a new exported API), tell me which area to expand and I will update this file.
