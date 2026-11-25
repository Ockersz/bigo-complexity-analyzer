export function linearFind(items: number[], target: number): boolean {
  for (const item of items) {
    if (item === target) {
      return true;
    }
  }
  return false;
}

export function binarySearch(sorted: number[], target: number): number {
  let left = 0;
  let right = sorted.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
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
