import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeCode, FunctionComplexity } from './analyzer';

function byName(results: FunctionComplexity[], name: string): FunctionComplexity {
  const found = results.find((r) => r.name === name);
  assert.ok(found, `Expected function "${name}" in results: ${results.map((r) => r.name).join(', ')}`);
  return found;
}

test('O(1) constant function', () => {
  const results = analyzeCode(`
    function getFirst(arr: number[]) {
      return arr[0];
    }
  `);
  const fn = byName(results, 'getFirst');
  assert.equal(fn.timeComplexity, 'O(1)');
  assert.equal(fn.spaceComplexity, 'O(1)');
  assert.equal(fn.isHotspot, false);
  assert.equal(fn.optimizationTip, null);
});

test('single loop gives O(n) time and O(1) space', () => {
  const results = analyzeCode(`
    function sum(nums: number[]): number {
      let total = 0;
      for (const n of nums) {
        total += n;
      }
      return total;
    }
  `);
  const fn = byName(results, 'sum');
  assert.equal(fn.timeComplexity, 'O(n)');
  assert.equal(fn.spaceComplexity, 'O(1)');
  assert.equal(fn.isHotspot, false);
  assert.ok(fn.bottleneckLocation !== null);
});

test('nested loops produce O(n²) and O(n³) with optimization tip', () => {
  const results = analyzeCode(`
    function tripleLoop(n: number): number {
      let count = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          for (let k = 0; k < n; k++) {
            count++;
          }
        }
      }
      return count;
    }
  `);
  const fn = byName(results, 'tripleLoop');
  assert.equal(fn.timeComplexity, 'O(n³)');
  assert.equal(fn.spaceComplexity, 'O(1)');
  assert.equal(fn.isHotspot, true);
  assert.ok(fn.optimizationTip !== null);
  assert.ok(fn.reasons.some((r) => r.includes('Nested for loop inside for loop')));
});

test('nested .filter() inside for-of loop gives O(n²) time and O(n²) space', () => {
  const results = analyzeCode(`
    function filterGroups(users: { group: string }[], groups: string[]) {
      const out = [];
      for (const g of groups) {
        out.push(users.filter((u) => u.group === g));
      }
      return out;
    }
  `);
  const fn = byName(results, 'filterGroups');
  assert.equal(fn.timeComplexity, 'O(n²)');
  assert.equal(fn.spaceComplexity, 'O(n²)');
  assert.equal(fn.isHotspot, true);
  assert.ok(fn.reasons.some((r) => r.includes('.filter() inside for-of loop')));
});

test('.sort() standalone and inside a loop', () => {
  const results = analyzeCode(`
    function sortCopy(nums: number[]) {
      return [...nums].sort((a, b) => a - b);
    }
    class Sorter {
      sortAll(matrix: number[][]) {
        for (const row of matrix) {
          row.sort((a, b) => a - b);
        }
      }
    }
  `);
  const sortCopy = byName(results, 'sortCopy');
  assert.equal(sortCopy.timeComplexity, 'O(n log n)');
  assert.equal(sortCopy.spaceComplexity, 'O(n)');

  const sortAll = byName(results, 'Sorter.sortAll');
  assert.equal(sortAll.timeComplexity, 'O(n * m log m)');
  assert.equal(sortAll.kind, 'method');
});

test('linear and exponential recursion', () => {
  const results = analyzeCode(`
    function fact(n: number): number {
      return n <= 1 ? 1 : n * fact(n - 1);
    }
    function fib(n: number): number {
      if (n <= 1) return n;
      return fib(n - 1) + fib(n - 2);
    }
  `);
  const fact = byName(results, 'fact');
  assert.equal(fact.timeComplexity, 'O(n)');
  assert.equal(fact.spaceComplexity, 'O(n)');
  assert.equal(fact.isHotspot, false);

  const fib = byName(results, 'fib');
  assert.equal(fib.timeComplexity, 'O(2^n)');
  assert.equal(fib.spaceComplexity, 'O(n)');
  assert.equal(fib.isHotspot, true);
  assert.ok(fib.optimizationTip?.toLowerCase().includes('memoization'));
});

test('arrow function and function expression support + JSX/JS parsing', () => {
  const results = analyzeCode(
    `
      export const overlap = (a, b) => a.some((x) => b.includes(x));
      export const makeGrid = function buildGrid(n) {
        return new Array(n);
      };
    `,
    'component.jsx'
  );
  const overlap = byName(results, 'overlap');
  assert.equal(overlap.kind, 'arrow');
  assert.equal(overlap.timeComplexity, 'O(n²)');
  assert.equal(overlap.isHotspot, true);

  const makeGrid = byName(results, 'makeGrid');
  assert.equal(makeGrid.kind, 'functionExpression');
  assert.equal(makeGrid.timeComplexity, 'O(1)');
  assert.equal(makeGrid.spaceComplexity, 'O(n)');
});

test('sample/demo.ts yields expected complexity profile', () => {
  const demoPath = path.resolve(__dirname, '../sample/demo.ts');
  const source = fs.readFileSync(demoPath, 'utf8');
  const results = analyzeCode(source, demoPath, {
    resolveImport: (specifier, fromFile) => {
      const targetPath = path.resolve(path.dirname(fromFile), `${specifier}.ts`);
      if (fs.existsSync(targetPath)) {
        return { fileName: targetPath, sourceText: fs.readFileSync(targetPath, 'utf8') };
      }
      return null;
    },
  });

  assert.equal(byName(results, 'getFirstElement').timeComplexity, 'O(1)');
  assert.equal(byName(results, 'getFirstElement').spaceComplexity, 'O(1)');

  assert.equal(byName(results, 'sumArray').timeComplexity, 'O(n)');
  assert.equal(byName(results, 'sumArray').spaceComplexity, 'O(1)');

  assert.equal(byName(results, 'sortNumbers').timeComplexity, 'O(n log n)');
  assert.equal(byName(results, 'sortNumbers').spaceComplexity, 'O(n)');

  assert.equal(byName(results, 'findDuplicatePairs').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'findDuplicatePairs').spaceComplexity, 'O(n)');

  assert.equal(byName(results, 'filterMatchingUsers').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'filterMatchingUsers').spaceComplexity, 'O(n²)');

  assert.equal(byName(results, 'DataProcessor.sortBuckets').timeComplexity, 'O(n * m log m)');
  assert.equal(byName(results, 'DataProcessor.sortBuckets').spaceComplexity, 'O(1)');

  assert.equal(byName(results, 'factorial').timeComplexity, 'O(n)');
  assert.equal(byName(results, 'factorial').spaceComplexity, 'O(n)');

  assert.equal(byName(results, 'fibonacci').timeComplexity, 'O(2^n)');
  assert.equal(byName(results, 'fibonacci').spaceComplexity, 'O(n)');

  assert.equal(byName(results, 'hasOverlap').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'hasOverlap').spaceComplexity, 'O(1)');

  const findAllMatches = byName(results, 'findAllMatches');
  assert.equal(findAllMatches.timeComplexity, 'O(n²)');
  assert.equal(findAllMatches.selfTimeComplexity, 'O(n)');
  assert.equal(findAllMatches.spaceComplexity, 'O(1)');

  const sortAllGroups = byName(results, 'sortAllGroups');
  assert.equal(sortAllGroups.timeComplexity, 'O(n * m log m)');
  assert.equal(sortAllGroups.selfTimeComplexity, 'O(n)');
  assert.equal(sortAllGroups.spaceComplexity, 'O(n)');

  assert.equal(byName(results, 'localBinarySearch').timeComplexity, 'O(log n)');
  assert.equal(byName(results, 'fixedTripletSum').timeComplexity, 'O(1)');
  assert.equal(byName(results, 'fibonacciMemo').timeComplexity, 'O(n)');
  assert.equal(byName(results, 'searchAcrossMatrix').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'searchSortedMatrix').timeComplexity, 'O(n log n)');
  assert.equal(byName(results, 'ignoredNestedExample').ignored, true);
  assert.equal(byName(results, 'ignoredNestedExample').isHotspot, false);
  assert.equal(byName(results, 'reduceSpreadTrap').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'queueShiftTrap').timeComplexity, 'O(n²)');
  assert.equal(byName(results, 'isPrime').timeComplexity, 'O(√n)');
  assert.equal(byName(results, 'mergeSort').timeComplexity, 'O(n log n)');
});

test('nested inner sub-function propagates combined complexity to caller', () => {
  const results = analyzeCode(`
    function outer(rows: number[][], target: number): number {
      function contains(row: number[], x: number): boolean {
        for (const item of row) {
          if (item === x) return true;
        }
        return false;
      }

      let hits = 0;
      for (const r of rows) {
        if (contains(r, target)) hits++;
      }
      return hits;
    }
  `);
  const contains = byName(results, 'contains');
  assert.equal(contains.timeComplexity, 'O(n)');
  assert.equal(contains.selfTimeComplexity, 'O(n)');

  const outer = byName(results, 'outer');
  assert.equal(outer.timeComplexity, 'O(n²)');
  assert.equal(outer.selfTimeComplexity, 'O(n)');
  assert.equal(outer.isHotspot, true);
  assert.ok(outer.reasons.some((r) => r.includes('Calls contains() (O(n)) inside for-of loop')));
  assert.ok(outer.bottleneckLocation?.description.includes('Calls contains()'));
});

test('sibling helper and space propagation across calls', () => {
  const results = analyzeCode(`
    function buildCopy(arr: number[]): number[] {
      return [...arr].sort((a, b) => a - b);
    }

    function processSingle(arr: number[]): number[] {
      return buildCopy(arr);
    }

    function processMany(groups: number[][]): number[][] {
      const out: number[][] = [];
      for (const g of groups) {
        out.push(buildCopy(g));
      }
      return out;
    }
  `);

  const single = byName(results, 'processSingle');
  assert.equal(single.timeComplexity, 'O(n log n)');
  assert.equal(single.selfTimeComplexity, 'O(1)');
  assert.equal(single.spaceComplexity, 'O(n)');
  assert.equal(single.selfSpaceComplexity, 'O(1)');

  const many = byName(results, 'processMany');
  assert.equal(many.timeComplexity, 'O(n * m log m)');
  assert.equal(many.selfTimeComplexity, 'O(n)');
  assert.equal(many.spaceComplexity, 'O(n)');
});

test('class method calling this.helper() composes complexity', () => {
  const results = analyzeCode(`
    class Graph {
      hasEdge(neighbors: number[], target: number): boolean {
        return neighbors.includes(target);
      }

      countEdges(adj: number[][], target: number): number {
        let count = 0;
        for (const list of adj) {
          if (this.hasEdge(list, target)) count++;
        }
        return count;
      }
    }
  `);

  const hasEdge = byName(results, 'Graph.hasEdge');
  assert.equal(hasEdge.timeComplexity, 'O(n)');

  const countEdges = byName(results, 'Graph.countEdges');
  assert.equal(countEdges.timeComplexity, 'O(n²)');
  assert.equal(countEdges.selfTimeComplexity, 'O(n)');
  assert.equal(countEdges.isHotspot, true);
});

test('mutual recursion terminates safely and reports O(n) time and space', () => {
  const results = analyzeCode(`
    function isEven(n: number): boolean {
      if (n === 0) return true;
      return isOdd(n - 1);
    }

    function isOdd(n: number): boolean {
      if (n === 0) return false;
      return isEven(n - 1);
    }
  `);

  const isEven = byName(results, 'isEven');
  const isOdd = byName(results, 'isOdd');
  assert.equal(isEven.timeComplexity, 'O(n)');
  assert.equal(isEven.spaceComplexity, 'O(n)');
  assert.equal(isOdd.timeComplexity, 'O(n)');
  assert.equal(isOdd.spaceComplexity, 'O(n)');
  assert.ok(isOdd.reasons.some((r) => r.includes('Mutual recursion')));
});

test('logarithmic loops, nested log loops, and constant-bounded loops', () => {
  const results = analyzeCode(`
    function halveFor(n: number): number {
      let steps = 0;
      for (let i = n; i > 1; i = Math.floor(i / 2)) {
        steps++;
      }
      return steps;
    }

    function outerPlusLog(matrix: number[][]): number {
      let sum = 0;
      for (const row of matrix) {
        for (let step = 1; step < row.length; step *= 2) {
          sum += row[step];
        }
      }
      return sum;
    }

    function fixedLoop(arr: number[]): number {
      let acc = 0;
      for (let i = 0; i < 4; i++) {
        acc += arr[i] ?? 0;
      }
      return acc;
    }
  `);

  assert.equal(byName(results, 'halveFor').timeComplexity, 'O(log n)');
  assert.equal(byName(results, 'outerPlusLog').timeComplexity, 'O(n log n)');
  assert.equal(byName(results, 'fixedLoop').timeComplexity, 'O(1)');
});

test('memoized recursion reduces O(2^n) to O(n)', () => {
  const results = analyzeCode(`
    function fibMap(n: number, cache = new Map<number, number>()): number {
      if (n <= 1) return n;
      if (cache.has(n)) return cache.get(n)!;
      const val = fibMap(n - 1, cache) + fibMap(n - 2, cache);
      cache.set(n, val);
      return val;
    }

    function fibObj(n: number, memo: Record<number, number> = {}): number {
      if (n <= 1) return n;
      if (n in memo) return memo[n];
      memo[n] = fibObj(n - 1, memo) + fibObj(n - 2, memo);
      return memo[n];
    }
  `);

  const fibMap = byName(results, 'fibMap');
  assert.equal(fibMap.timeComplexity, 'O(n)');
  assert.equal(fibMap.spaceComplexity, 'O(n)');
  assert.equal(fibMap.isHotspot, false);
  assert.ok(fibMap.reasons.some((r) => r.includes('Memoized recursion')));

  const fibObj = byName(results, 'fibObj');
  assert.equal(fibObj.timeComplexity, 'O(n)');
  assert.equal(fibObj.spaceComplexity, 'O(n)');
});

test('bigo-ignore and custom hotspotThreshold', () => {
  const code = `
    // bigo-ignore
    function ignoredQuad(arr: number[]) {
      for (const a of arr) {
        for (const b of arr) {
          void (a + b);
        }
      }
    }

    function sorted(arr: number[]) {
      return [...arr].sort((a, b) => a - b);
    }
  `;

  const defaultRun = analyzeCode(code);
  assert.equal(byName(defaultRun, 'ignoredQuad').ignored, true);
  assert.equal(byName(defaultRun, 'ignoredQuad').isHotspot, false);
  assert.equal(byName(defaultRun, 'sorted').isHotspot, false);

  const strictRun = analyzeCode(code, 'file.ts', { hotspotThreshold: 15 });
  assert.equal(byName(strictRun, 'sorted').isHotspot, true);
});

test('cross-file relative import resolution handles named, namespace, and circular imports', () => {
  const files: Record<string, string> = {
    '/proj/helpers.ts': `
      export function scan(arr: number[]) {
        for (const x of arr) void x;
      }
      export const makeSet = (arr: number[]) => new Set(arr);
    `,
    '/proj/circA.ts': `
      import { b } from './circB';
      export function a(arr: number[]) {
        for (const x of arr) void x;
        return b(arr);
      }
    `,
    '/proj/circB.ts': `
      import { a } from './circA';
      export function b(arr: number[]) {
        return a(arr);
      }
    `,
  };

  const resolveImport = (specifier: string, fromFile: string) => {
    const resolved = path.posix.resolve(path.posix.dirname(fromFile), `${specifier}.ts`);
    return files[resolved] ? { fileName: resolved, sourceText: files[resolved] } : null;
  };

  const mainRes = analyzeCode(
    `
      import { scan } from './helpers';
      import * as helpers from './helpers';

      function run(matrix: number[][], arr: number[]) {
        for (const row of matrix) {
          scan(row);
        }
        return helpers.makeSet(arr);
      }
    `,
    '/proj/main.ts',
    { resolveImport }
  );

  const run = byName(mainRes, 'run');
  assert.equal(run.timeComplexity, 'O(n²)');
  assert.equal(run.spaceComplexity, 'O(n)');
  assert.ok(run.reasons.some((r) => r.includes("Calls imported scan() from './helpers'")));

  const circRes = analyzeCode(files['/proj/circA.ts'], '/proj/circA.ts', { resolveImport });
  assert.equal(byName(circRes, 'a').timeComplexity, 'O(n)');
});

test('hidden O(n) anti-patterns inside loops and .reduce()', () => {
  const results = analyzeCode(`
    function spreadInReduce(items: { id: string; v: number }[]) {
      return items.reduce((acc, item) => ({ ...acc, [item.id]: item.v }), {});
    }

    function spreadArrayInLoop(items: number[]) {
      let out: number[] = [];
      for (const x of items) {
        out = [...out, x];
      }
      return out;
    }

    function shiftInLoop(queue: number[]) {
      while (queue.length > 0) {
        queue.shift();
      }
    }

    function spliceInLoop(arr: number[]) {
      for (let i = 0; i < arr.length; i++) {
        arr.splice(i, 1);
      }
    }

    function jsonAndKeysInLoop(objs: Record<string, number>[]) {
      for (const obj of objs) {
        void JSON.stringify(obj);
      }
    }

    function regexInLoop(lines: string[]) {
      for (const line of lines) {
        const re = new RegExp('foo');
        void re.test(line);
      }
    }

    function loopOverObjectKeysOnce(obj: Record<string, number>) {
      let sum = 0;
      for (const k of Object.keys(obj)) {
        sum += obj[k];
      }
      return sum;
    }
  `);

  const spreadInReduce = byName(results, 'spreadInReduce');
  assert.equal(spreadInReduce.timeComplexity, 'O(n²)');
  assert.equal(spreadInReduce.spaceComplexity, 'O(n²)');
  assert.equal(spreadInReduce.isHotspot, true);
  assert.ok(spreadInReduce.optimizationTip?.includes('spreading accumulators'));

  assert.equal(byName(results, 'spreadArrayInLoop').timeComplexity, 'O(n²)');

  const shiftInLoop = byName(results, 'shiftInLoop');
  assert.equal(shiftInLoop.timeComplexity, 'O(n²)');
  assert.ok(shiftInLoop.optimizationTip?.includes('.shift()'));

  assert.equal(byName(results, 'spliceInLoop').timeComplexity, 'O(n²)');

  const jsonInLoop = byName(results, 'jsonAndKeysInLoop');
  assert.equal(jsonInLoop.timeComplexity, 'O(n²)');
  assert.ok(jsonInLoop.optimizationTip?.includes('JSON.parse/stringify'));

  const regexInLoop = byName(results, 'regexInLoop');
  assert.equal(regexInLoop.timeComplexity, 'O(n)');
  assert.ok(regexInLoop.optimizationTip?.includes('new RegExp'));

  // Object.keys(obj) in for-of header runs once before loop, so it must stay O(n)
  assert.equal(byName(results, 'loopOverObjectKeysOnce').timeComplexity, 'O(n)');
});

test('square-root loops and divide-and-conquer recursion', () => {
  const results = analyzeCode(`
    function isPrime(n: number): boolean {
      for (let i = 2; i * i <= n; i++) {
        if (n % i === 0) return false;
      }
      return true;
    }

    function sqrtBound(n: number): number {
      let count = 0;
      for (let i = 1; i <= Math.sqrt(n); i++) {
        count++;
      }
      return count;
    }

    function mergeSort(arr: number[]): number[] {
      if (arr.length <= 1) return arr;
      const mid = Math.floor(arr.length / 2);
      const left = mergeSort(arr.slice(0, mid));
      const right = mergeSort(arr.slice(mid));
      return left.concat(right);
    }
  `);

  assert.equal(byName(results, 'isPrime').timeComplexity, 'O(√n)');
  assert.equal(byName(results, 'isPrime').isHotspot, false);
  assert.equal(byName(results, 'sqrtBound').timeComplexity, 'O(√n)');

  const ms = byName(results, 'mergeSort');
  assert.equal(ms.timeComplexity, 'O(n log n)');
  assert.equal(ms.spaceComplexity, 'O(n)');
  assert.equal(ms.isHotspot, false);
  assert.ok(ms.reasons.some((r) => r.includes('Divide-and-conquer')));
});
