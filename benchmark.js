// Simple benchmark script to measure query performance
const { query, multiQuery } = require('./lib/cjs/index.js');
const fs = require('fs');
const v8 = require('v8');

// Enable GC exposure if possible
if (global.gc) {
  console.log('✓ GC is exposed (run with --expose-gc for GC stats)\n');
} else {
  console.log('⚠ GC not exposed. Run with: node --expose-gc benchmark.js\n');
}

// Generate a large code sample
function generateLargeCode(numFunctions) {
  let code = '';
  for (let i = 0; i < numFunctions; i++) {
    code += `
function func${i}(param${i}) {
  let var${i} = ${i};
  let result${i} = param${i} + var${i};
  if (result${i} > ${i * 10}) {
    return result${i} * 2;
  }
  return result${i};
}
`;
  }
  return code;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss
  };
}

function benchmark(name, fn, iterations = 5) {
  const times = [];
  const memoryBefore = [];
  const memoryAfter = [];
  const memoryDelta = [];
  
  // Force GC before warmup if available
  if (global.gc) {
    global.gc();
  }
  
  // Warmup
  for (let i = 0; i < 2; i++) {
    fn();
  }
  
  // Force GC before actual benchmark
  if (global.gc) {
    global.gc();
  }
  
  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    if (global.gc) {
      global.gc(); // GC before each iteration
    }
    
    const memBefore = getMemoryStats();
    const start = performance.now();
    fn();
    const end = performance.now();
    const memAfter = getMemoryStats();
    
    times.push(end - start);
    memoryBefore.push(memBefore);
    memoryAfter.push(memAfter);
    memoryDelta.push(memAfter.heapUsed - memBefore.heapUsed);
  }
  
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  
  const avgMemDelta = memoryDelta.reduce((a, b) => a + b, 0) / memoryDelta.length;
  const maxMemDelta = Math.max(...memoryDelta);
  const minMemDelta = Math.min(...memoryDelta);
  
  console.log(`${name}:`);
  console.log(`  Time:   ${avgTime.toFixed(2)}ms (min: ${minTime.toFixed(2)}, max: ${maxTime.toFixed(2)})`);
  console.log(`  Memory: ${formatBytes(avgMemDelta)} (min: ${formatBytes(minMemDelta)}, max: ${formatBytes(maxMemDelta)})`);
  
  if (global.gc) {
    const heapStats = v8.getHeapStatistics();
    console.log(`  Heap:   ${formatBytes(heapStats.used_heap_size)} / ${formatBytes(heapStats.heap_size_limit)}`);
  }
  
  console.log('');
  
  return { avgTime, avgMemDelta };
}

console.log('ASTronomical Performance Benchmark');
console.log('==================================\n');

const results = [];

// Test 1: Small code
console.log('Test 1: Small code (10 functions)');
const smallCode = generateLargeCode(10);
results.push(['Small - Descendant', benchmark('Simple descendant query', () => {
  query(smallCode, '//FunctionDeclaration');
})]);
results.push(['Small - Filtered', benchmark('Filtered query', () => {
  query(smallCode, '//FunctionDeclaration[/:id/:name == "func5"]');
})]);
results.push(['Small - Multi-query', benchmark('Multi-query', () => {
  multiQuery(smallCode, {
    functions: '//FunctionDeclaration',
    identifiers: '//Identifier/:name',
    numbers: '//Literal/:value'
  });
})]);

// Test 2: Medium code
console.log('Test 2: Medium code (100 functions)');
const mediumCode = generateLargeCode(100);
results.push(['Medium - Descendant', benchmark('Simple descendant query', () => {
  query(mediumCode, '//FunctionDeclaration');
})]);
results.push(['Medium - Complex', benchmark('Complex query', () => {
  query(mediumCode, '//FunctionDeclaration//VariableDeclarator[/:id/:name]');
})]);

// Test 3: Large code
console.log('Test 3: Large code (500 functions)');
const largeCode = generateLargeCode(500);
results.push(['Large - Descendant', benchmark('Simple descendant query', () => {
  query(largeCode, '//FunctionDeclaration');
})]);
results.push(['Large - Multi-query', benchmark('Multi-query (3 queries)', () => {
  multiQuery(largeCode, {
    functions: '//FunctionDeclaration/:id/:name',
    variables: '//VariableDeclarator/:id/:name',
    returns: '//ReturnStatement'
  });
})]);

// Test 4: Real-world example - if rsac file exists
try {
  const rsacPath = './tmp/rsac.js';
  if (fs.existsSync(rsacPath)) {
    console.log('Test 4: Real-world code (rsac.js)');
    const rsacCode = fs.readFileSync(rsacPath, 'utf8');
    console.log(`  File size: ${(rsacCode.length / 1024).toFixed(1)}KB\n`);
    
    results.push(['Real-world - Functions', benchmark('Find all functions', () => {
      query(rsacCode, '//FunctionDeclaration');
    }, 3)]);
    
    results.push(['Real-world - Binding', benchmark('Complex binding query', () => {
      query(rsacCode, '//VariableDeclarator[/:id/:name]/$:init');
    }, 3)]);
  }
} catch (e) {
  // Skip if file doesn't exist
}

// Summary
console.log('=== SUMMARY ===\n');
console.log('Test Case                      | Time (ms) | Memory');
console.log('-------------------------------|-----------|------------------');
for (const [name, stats] of results) {
  const namePadded = name.padEnd(30);
  const timePadded = stats.avgTime.toFixed(2).padStart(9);
  const memFormatted = formatBytes(stats.avgMemDelta);
  console.log(`${namePadded} | ${timePadded} | ${memFormatted}`);
}

// Total memory stats if GC is available
if (global.gc) {
  console.log('\n=== V8 HEAP STATISTICS ===\n');
  const heapStats = v8.getHeapStatistics();
  console.log(`Total heap size:        ${formatBytes(heapStats.total_heap_size)}`);
  console.log(`Used heap size:         ${formatBytes(heapStats.used_heap_size)}`);
  console.log(`Heap size limit:        ${formatBytes(heapStats.heap_size_limit)}`);
  console.log(`Total available size:   ${formatBytes(heapStats.total_available_size)}`);
  console.log(`Malloced memory:        ${formatBytes(heapStats.malloced_memory)}`);
  console.log(`Peak malloced memory:   ${formatBytes(heapStats.peak_malloced_memory)}`);
  
  const heapSpaces = v8.getHeapSpaceStatistics();
  console.log('\n=== HEAP SPACES ===\n');
  for (const space of heapSpaces) {
    console.log(`${space.space_name}:`);
    console.log(`  Size:      ${formatBytes(space.space_size)}`);
    console.log(`  Used:      ${formatBytes(space.space_used_size)}`);
    console.log(`  Available: ${formatBytes(space.space_available_size)}`);
  }
}

console.log('\n=== Benchmark complete! ===');
console.log('\nTip: Run with --expose-gc for detailed GC statistics:');
console.log('  node --expose-gc benchmark.js');
