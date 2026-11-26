# Changelog

All notable changes to **Big-O Complexity Analyzer** will be documented in this file.

## [1.2.0] - 2026-11-26

### Added
- **Configurable Team Rule Sets (`.bigorc.json` & Presets):** Commit a `.bigorc.json` file to share team complexity standards across your repository, or configure `bigoAnalyzer.preset`, `bigoAnalyzer.rules`, and `bigoAnalyzer.ignore` in VS Code settings.
- **Built-in Presets:** Choose from `relaxed`, `recommended` (default), or `strict` presets, or override individual rules (`noSpreadInLoop`, `noShiftInLoop`, `noHeavyLoopOp`, `noRegexInLoop`, `noNestedArrayLookup`, `noSortInLoop`) to `off`, `hint`, `info`, or `warning`.
- **Glob Ignore Patterns:** Exclude test, generated, or script files via `"ignore"` patterns in `.bigorc.json` or `bigoAnalyzer.ignore`.
- **Starter Config Command:** Run **`Big-O: Create Team Config (.bigorc.json)`** (`bigoAnalyzer.initConfig`) to scaffold a `.bigorc.json` in your workspace root with live auto-reload on save.

> 🙏 Special thanks to [Ghislain MITAHI](https://www.linkedin.com/in/ghislain-mitahi/) for suggesting configurable team rule sets!

## [1.1.3] - 2026-11-25

### Changed
- Updated Marketplace & Open VSX README documentation.

## [1.1.2] - 2026-11-25

### Improved
- **Prominent Bottom-Left Status Bar Pill:** Moved the `Big-O` status bar button to the bottom-left with a warning highlight for hotspots so it never clips in narrow side-by-side layouts.
- **Reliable Editor Title Button (`editorLangId`):** Switched the `editor/title` menu condition to `editorLangId` (`navigation@1`) for broader VS Code / Antigravity IDE compatibility.
- **Hover Dashboard Links:** Added direct clickable **Open Complexity Dashboard** and **Scan Workspace** links at the bottom of every hover tooltip.

## [1.1.1] - 2026-11-25

### Added
- **Editor Title Bar Button (`$(graph)`):** One-click **Open Big-O Dashboard** button directly in the top-right editor toolbar for JS/TS files.
- **Getting Started Walkthrough:** Built-in 4-step interactive VS Code / Antigravity walkthrough (`Big-O: Open Getting Started Walkthrough`) covering inline analysis, Dashboard, Workspace Scan, and Quick Fixes.
- **Visual README Demos:** Added animated workflow demo (`images/demo.gif`), Dashboard preview (`images/dashboard-preview.png`), and a Quick Access Cheat Sheet.

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
