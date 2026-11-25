### Audit Your Entire Workspace for Hotspots

Scan all `.ts`, `.tsx`, `.js`, and `.jsx` files in your repository (skipping `node_modules`, `dist`, and `out`) to catch nested loops, spread-in-`.reduce()` traps, `.shift()`/`.splice()` inside loops, and cross-file helper bottlenecks.

[Scan Workspace Hotspots](command:bigoAnalyzer.scanWorkspace)
