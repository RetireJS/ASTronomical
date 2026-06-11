# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # compile CJS + ESM into lib/ (via tsup)
npm run watch        # build in watch mode during development
npm run typecheck    # tsc --noEmit
npm run lint         # eslint --fix
npm run check        # lint + typecheck
npm test             # jest --ci
npm run testWatch    # jest --watchAll
```

Run a single test file: `npx jest tests/query.test.ts`

Consumers import from `lib/`, not `src/` — always run `npm run build` before testing integration or publishing.

## Architecture

**Purpose:** `query(code, query)` and `multiQuery(code, namedQueries)` parse JavaScript source and run a compact XPath-inspired query language over the resulting AST.

**Execution flow:**
1. `parseSource` (in `src/index.ts`) parses JS via `meriyah` — tries `module: true`, falls back to `module: false, webcompat: true`.
2. `createTraverser()` walks the AST once, building `NodePath` wrappers (via `createNodePath`, backed by a WeakMap) and registering scopes/bindings.
3. The query string is tokenized and parsed by `src/parseQuery.ts` into a tree of `QNode`s.
4. `createQuerier()` evaluates QNodes against NodePaths, memoizing subquery results by `(QNode, NodePath)` pair.

**Key source files:**
- [src/index.ts](src/index.ts) — traversal, binding registration (`registerBindings`, `getBinding`), querier, built-in `functions` map (`join`, `concat`, `first`, `nthchild`), public API
- [src/parseQuery.ts](src/parseQuery.ts) — tokenizer and parser for the query DSL; defines `AvailableFunction` type
- [src/nodeutils.ts](src/nodeutils.ts) — `VISITOR_KEYS`, type predicates (`isIdentifier`, `isScopable`, etc.), `NodePath` helpers
- [src/utils.ts](src/utils.ts) — small generic utilities

**Build output:** `tsup` produces both CJS (`lib/index.js`) and ESM (`lib/index.mjs`) plus `.d.ts`/`.d.mts` files. The `exports` map in `package.json` routes `require`/`import` to the right build.

## Key conventions

**Adding a query language function** (e.g. `/fn:uppercase(sel)`):
1. Add implementation to the `functions` map in `src/index.ts`.
2. The `AvailableFunction` type in `parseQuery.ts` is derived from `typeof functions` — no manual update needed unless you change the type structure.
3. Add tests in `tests/`.

**Bindings and scopes:** Scope IDs are stored on AST nodes as a flat `scopeId` property (a nested wrapper object would cost an allocation per node). The `nodePathMap` WeakMap ties AST nodes to their `NodePath`; during traversal a `NodePath` is only materialized when a selector actually matches. Do not mutate node identity or add per-node state — this silently breaks memoization and binding lookups.

**Performance (large/minified files):**
- Use `multiQuery` instead of repeated `query` calls — the traverser is designed for a single pass over multiple queries.
- Prefer child selectors (`/Type`) over descendant (`//Type`) when the depth is known.
- Avoid `../` (parent) filters in hot paths — they cause extra traversal and defeat memoization.
