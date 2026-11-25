# Changelog

All notable changes to **Big-O Complexity Analyzer** will be documented in this file.

## [1.1.0] - 2026-11-25

### Added
- **Hidden `O(n)` JS/TS Anti-Pattern Engine:** Detects object/array spread inside loops or `.reduce()` (`{ ...acc }`, `[...acc]`), `.shift()` / `.unshift()` / `.splice()` inside loops, `JSON.parse`/`stringify` & `Object.keys`/`values`/`entries`/`assign` inside loops, and `new RegExp(...)` compilation inside loops.
- **Square-Root & Divide-and-Conquer Heuristics:** Detects `O(√n)` loops (`i * i <= n`, `i <= Math.sqrt(n)`) and divide-and-conquer recursion (`mergeSort`/`quickSort` → `O(n log n)`).
- **Quick Fix Actions (`Ctrl+.`):** One-click `// bigo-ignore` suppression and quick navigation to the Complexity Dashboard directly from diagnostics.
- **Interactive Big-O Complexity Dashboard & Workspace Scan:** Theme-aware Webview with an interactive SVG asymptotic growth curve chart, `n` slider, worst-first file breakdown, and workspace-wide hotspot scanning (`Big-O: Open Complexity Dashboard`, `Big-O: Scan Workspace Hotspots`).

## [1.0.1] - 2026-11-25

### Added
- Added a `256×256` PNG Marketplace extension icon (`images/icon.png`) and Marketplace manifest metadata.

## [1.0.0] - 2026-11-25

### Added
- Pure TypeScript AST (`ts.createSourceFile`) time and space complexity analyzer for `.ts`, `.tsx`, `.js`, and `.jsx`.
- Two-pass call-graph propagation across nested helpers, sibling functions, `this.method()` calls, and relative `./` / `../` imports (with mutual/circular recursion guards).
- Logarithmic loop (`O(log n)`), constant-bounded loop (`O(1)`), `.sort()` (`O(n log n)` / `O(n * m log m)`), and memoized recursion (`O(2^n) -> O(n)`) heuristics.
- Inline CodeLens summaries, rich Markdown hover tooltips (showing total vs. self complexity and optimization tips), worst-bottleneck line highlights, Status Bar indicator, and Problems panel diagnostics.
- Per-function suppression via `// bigo-ignore` and configurable settings (`bigoAnalyzer.hotspotThreshold`, `bigoAnalyzer.showDiagnostics`, `bigoAnalyzer.diagnosticSeverity`).
