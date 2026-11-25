// Press F5 in VS Code to launch the Extension Development Host with this file open.
import { binarySearch, linearFind } from './helpers';

export interface User {
  id: number;
  name: string;
  group: string;
}

// 1. O(1) Time | O(1) Space
export function getFirstElement<T>(items: T[]): T | undefined {
  return items[0];
}

// 2. O(n) Time | O(1) Space
export function sumArray(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}

// 3. O(n log n) Time | O(n) Space
export function sortNumbers(numbers: number[]): number[] {
  return [...numbers].sort((a, b) => a - b);
}

// 4. O(n²) Time | O(n) Space
export function findDuplicatePairs(nums: number[]): number[] {
  const duplicates = new Set<number>();
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] === nums[j]) {
        duplicates.add(nums[i]);
      }
    }
  }
  return Array.from(duplicates);
}

// 5. O(n²) Time | O(n²) Space
export function filterMatchingUsers(users: User[], groups: string[]): User[][] {
  const grouped: User[][] = [];
  for (const group of groups) {
    const matched = users.filter((user) => user.group === group);
    grouped.push(matched);
  }
  return grouped;
}

// 6. Class method: O(n * m log m) Time | O(1) Space
export class DataProcessor {
  public sortBuckets(buckets: number[][]): number[][] {
    for (const bucket of buckets) {
      bucket.sort((a, b) => a - b);
    }
    return buckets;
  }
}

// 7. Linear recursion: O(n) Time | O(n) Space
export function factorial(n: number): number {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}

// 8. Exponential recursion: O(2^n) Time | O(n) Space
export function fibonacci(n: number): number {
  if (n <= 1) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// 9. Arrow function with nested array iteration: O(n²) Time | O(1) Space
export const hasOverlap = (first: number[], second: number[]): boolean =>
  first.some((item) => second.includes(item));

// 10. Nested inner sub-function called inside a loop: O(n²) Total Time (O(n) self) | O(1) Space
export function findAllMatches(matrix: number[][], target: number): number {
  function linearSearch(row: number[], value: number): boolean {
    for (const item of row) {
      if (item === value) {
        return true;
      }
    }
    return false;
  }

  let matchCount = 0;
  for (const row of matrix) {
    if (linearSearch(row, target)) {
      matchCount++;
    }
  }
  return matchCount;
}

// 11. Sibling helper composition: O(n * m log m) Total Time (O(n) self) | O(n) Space
export function sortAllGroups(groups: number[][]): number[][] {
  const sorted: number[][] = [];
  for (const group of groups) {
    sorted.push(sortNumbers(group));
  }
  return sorted;
}

// 12. Logarithmic binary search: O(log n) Time | O(1) Space
export function localBinarySearch(sorted: number[], target: number): number {
  let left = 0;
  let right = sorted.length - 1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    if (sorted[mid] === target) {
      return mid;
    }
    if (sorted[mid] < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return -1;
}

// 13. Constant-bounded loop: O(1) Time | O(1) Space
export function fixedTripletSum(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += values[i] ?? 0;
  }
  return sum;
}

// 14. Memoized recursion: O(n) Time | O(n) Space (reduced from O(2^n))
export function fibonacciMemo(
  n: number,
  memo: Map<number, number> = new Map()
): number {
  if (n <= 1) {
    return n;
  }
  if (memo.has(n)) {
    return memo.get(n)!;
  }
  const result = fibonacciMemo(n - 1, memo) + fibonacciMemo(n - 2, memo);
  memo.set(n, result);
  return result;
}

// 15. Cross-file relative import composition: O(n²) Total Time | O(1) Space
export function searchAcrossMatrix(matrix: number[][], target: number): number {
  let count = 0;
  for (const row of matrix) {
    if (linearFind(row, target)) {
      count++;
    }
  }
  return count;
}

// 16. Cross-file O(log n) helper inside loop: O(n log n) Total Time | O(1) Space
export function searchSortedMatrix(matrix: number[][], target: number): number {
  let count = 0;
  for (const row of matrix) {
    if (binarySearch(row, target) !== -1) {
      count++;
    }
  }
  return count;
}

// 17. Suppressed via comment (hidden from CodeLens, diagnostics, and decorations)
// bigo-ignore
export function ignoredNestedExample(items: number[]): number {
  let total = 0;
  for (const a of items) {
    for (const b of items) {
      total += a * b;
    }
  }
  return total;
}

// 18. Hidden O(n²) trap: spreading accumulator inside .reduce()
export function reduceSpreadTrap(items: { id: string; value: number }[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    return { ...acc, [item.id]: item.value };
  }, {});
}

// 19. Hidden O(n²) trap: array .shift() inside while loop
export function queueShiftTrap(queue: number[]): number {
  let sum = 0;
  while (queue.length > 0) {
    sum += queue.shift() ?? 0;
  }
  return sum;
}

// 20. Square-root loop: O(√n) Time | O(1) Space
export function isPrime(n: number): boolean {
  if (n < 2) {
    return false;
  }
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) {
      return false;
    }
  }
  return true;
}

// 21. Divide-and-conquer recursion: O(n log n) Time | O(n) Space
export function mergeSort(arr: number[]): number[] {
  if (arr.length <= 1) {
    return arr;
  }
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return left.concat(right);
}
