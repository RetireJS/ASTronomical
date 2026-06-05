# Benchmark

Measures the real ASTronomical workload: running the full retire.js fingerprint
query set (~60 queries, mostly `//Type` descendant selectors) over large
minified/bundled JS files in a single `multiQuery` call — exactly like retire.js
`deepScan`.

The harness consumes the built library (`lib/`), so build first:

```bash
npm run build
npm run bench
```

It reports per-file parse and query time plus a query-only throughput number.
Query time dominates parse by ~20–30× on these files, which is why optimization
work targets the per-node traversal cost rather than parsing.

## Configuration (env vars)

| Var            | Default                                              | Meaning                                   |
| -------------- | ---------------------------------------------------- | ----------------------------------------- |
| `ASTRO_QUERIES`| `../retire.js/repository/jsrepository-ast.js`        | CommonJS module exporting `{ queries }`   |
| `ASTRO_CORPUS` | `../retire.js/repository/tmp`                        | Directory of `.js` files to scan          |
| `ASTRO_TOPN`   | `12`                                                 | Scan the N largest matching files         |
| `ASTRO_MINSIZE`| `500000`                                             | Ignore files smaller than this many bytes |
| `ASTRO_REPEAT` | `1`                                                  | Repeat each file N times (averaged)       |

The defaults assume a sibling `../retire.js` checkout (its `repository/tmp` is
populated by running `node repository/test-detection.js`). If the query set or
corpus is missing, the harness falls back to a tiny vendored query set and prints
a warning — those numbers are **not** representative of the real workload.

## Comparing a change

```bash
npm run build && ASTRO_REPEAT=2 npm run bench   # after
git stash && npm run build && ASTRO_REPEAT=2 npm run bench   # baseline
git stash pop && npm run build
```
