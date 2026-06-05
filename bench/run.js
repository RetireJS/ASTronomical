#!/usr/bin/env node
/*
 * Benchmark harness for ASTronomical, focused on the real workload:
 * running the full retire.js fingerprint query set (~60 queries, mostly //Type
 * descendant selectors) over large minified/bundled JS files in a single
 * multiQuery call -- exactly like retire.js `deepScan`.
 *
 * Usage:
 *   npm run build && npm run bench
 *
 * Environment overrides:
 *   ASTRO_QUERIES  path to a CommonJS module exporting { queries }
 *                  (default: ../retire.js/repository/jsrepository-ast.js)
 *   ASTRO_CORPUS   directory of .js files to scan
 *                  (default: ../retire.js/repository/tmp)
 *   ASTRO_TOPN     how many of the largest corpus files to scan (default: 12)
 *   ASTRO_MINSIZE  only consider files at least this many bytes (default: 500000)
 *   ASTRO_REPEAT   times to repeat each file (default: 1)
 *
 * Numbers are only meaningful against the real corpus; if the retire.js paths
 * are missing the script falls back to a tiny vendored query set and whatever
 * .js files it can find, and prints a warning that the result is not
 * representative.
 */
const fs = require("fs");
const path = require("path");

// Consume the built library, exactly as downstream consumers do.
let astronomical;
try {
  astronomical = require("../lib/index.js");
} catch (e) {
  console.error("Could not load ../lib/index.js -- run `npm run build` first.");
  throw e;
}
const { multiQuery, parseSource } = astronomical;

const HERE = __dirname;
const DEFAULT_QUERIES = path.resolve(HERE, "../../retire.js/repository/jsrepository-ast.js");
const DEFAULT_CORPUS = path.resolve(HERE, "../../retire.js/repository/tmp");

const FALLBACK_QUERIES = {
  fallback: [
    `//AssignmentExpression[/:left/:property/:name == "version"]/:right/:value`,
    `//ObjectExpression/Property[/:key/:name == "version"]/:value/:value`,
    `//VariableDeclarator[/:id/:name == "VERSION"]/:init/:value`,
    `//CallExpression/:callee/:property/:name`,
    `//FunctionExpression//ReturnStatement//Literal/:value`,
  ],
};

function loadQueries() {
  const p = process.env.ASTRO_QUERIES || DEFAULT_QUERIES;
  let raw;
  try {
    raw = require(p).queries;
  } catch {
    console.warn(`! Query set not found at ${p} -- using small fallback set (NOT representative).`);
    raw = FALLBACK_QUERIES;
  }
  // Flatten into one named-query map, mirroring retire.js deepScan.
  const flat = {};
  for (const [name, list] of Object.entries(raw)) {
    list.forEach((q, i) => {
      flat[`${name}_${i}`] = q;
    });
  }
  return flat;
}

function pickFiles() {
  const dir = process.env.ASTRO_CORPUS || DEFAULT_CORPUS;
  const minSize = parseInt(process.env.ASTRO_MINSIZE || "500000", 10);
  const topN = parseInt(process.env.ASTRO_TOPN || "12", 10);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    console.warn(`! Corpus directory not found at ${dir} -- nothing to benchmark.`);
    return [];
  }
  const files = entries
    .filter((f) => f.endsWith(".js") || f.includes(".js") || f.endsWith(".mjs"))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        return { name: f, full, size: fs.statSync(full).size };
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.size >= minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, topN);
  return files;
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function main() {
  const queries = loadQueries();
  const queryCount = Object.keys(queries).length;
  const files = pickFiles();
  const repeat = parseInt(process.env.ASTRO_REPEAT || "1", 10);

  if (files.length === 0) {
    console.log("No files to benchmark. Set ASTRO_CORPUS to a directory of large .js files.");
    return;
  }

  console.log(`Queries: ${queryCount}   Files: ${files.length}   Repeat: ${repeat}\n`);
  console.log("file".padEnd(60), "size".padStart(10), "parse".padStart(9), "query".padStart(9));
  console.log("-".repeat(92));

  let totalParse = 0;
  let totalQuery = 0;
  let totalBytes = 0;

  for (const f of files) {
    const content = fs.readFileSync(f.full, "utf-8");
    let parseMs = 0;
    let queryMs = 0;
    // Warm + measure: parse once per repeat, query once per repeat.
    for (let r = 0; r < repeat; r++) {
      const p0 = process.hrtime.bigint();
      let ast;
      try {
        ast = parseSource(content);
      } catch {
        console.log(f.name.slice(0, 58).padEnd(60), "parse-fail");
        ast = null;
      }
      const p1 = process.hrtime.bigint();
      if (!ast) continue;
      multiQuery(ast, queries);
      const p2 = process.hrtime.bigint();
      parseMs += Number(p1 - p0) / 1e6;
      queryMs += Number(p2 - p1) / 1e6;
    }
    parseMs /= repeat;
    queryMs /= repeat;
    totalParse += parseMs;
    totalQuery += queryMs;
    totalBytes += f.size;
    console.log(
      f.name.slice(0, 58).padEnd(60),
      fmt(f.size).padStart(10),
      (parseMs.toFixed(1) + "ms").padStart(9),
      (queryMs.toFixed(1) + "ms").padStart(9)
    );
  }

  console.log("-".repeat(92));
  console.log(
    "TOTAL".padEnd(60),
    fmt(totalBytes).padStart(10),
    (totalParse.toFixed(1) + "ms").padStart(9),
    (totalQuery.toFixed(1) + "ms").padStart(9)
  );
  console.log(
    `\nQuery throughput: ${(totalBytes / 1024 / 1024 / (totalQuery / 1000)).toFixed(2)} MB/s` +
      `   (query-only, excludes parse)`
  );
}

main();
