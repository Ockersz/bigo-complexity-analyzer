import * as vscode from 'vscode';
import { FunctionComplexity } from './analyzer';
import { AnalysisCache } from './cache';

function formatHoverMarkdown(fn: FunctionComplexity): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: ['bigoAnalyzer.openDashboard', 'bigoAnalyzer.scanWorkspace'],
  };

  if (fn.ignored) {
    md.appendMarkdown(`### 🔇 Suppressed: \`${fn.name}\`\n\n`);
    md.appendMarkdown(
      `Big-O analysis for this function is suppressed via \`// bigo-ignore\`.\n\n`
    );
    md.appendMarkdown(
      `Estimated: \`${fn.timeComplexity}\` time | \`${fn.spaceComplexity}\` space.`
    );
    return md;
  }

  const badge = fn.isHotspot ? '🔥 Hotspot' : '⏱️ Complexity';
  const timeDisplay =
    fn.selfTimeComplexity !== fn.timeComplexity
      ? `\`${fn.timeComplexity}\` (self: \`${fn.selfTimeComplexity}\`)`
      : `\`${fn.timeComplexity}\``;
  const spaceDisplay =
    fn.selfSpaceComplexity !== fn.spaceComplexity
      ? `\`${fn.spaceComplexity}\` (self: \`${fn.selfSpaceComplexity}\`)`
      : `\`${fn.spaceComplexity}\``;

  md.appendMarkdown(`### ${badge}: \`${fn.name}\`\n\n`);
  md.appendMarkdown(
    `| Metric | Estimate |\n| :--- | :--- |\n| **Time Complexity** | ${timeDisplay} |\n| **Space Complexity** | ${spaceDisplay} |\n| **Bottleneck Score** | \`${fn.bottleneckScore}\` |\n\n`
  );

  md.appendMarkdown('**Breakdown:**\n');
  for (const reason of fn.reasons) {
    md.appendMarkdown(`- ${reason}\n`);
  }

  if (fn.optimizationTip) {
    md.appendMarkdown(`\n> **Optimization Tip:** ${fn.optimizationTip}\n`);
  }

  if (fn.triggeredRule && fn.ruleSeverity && fn.ruleSeverity !== 'off') {
    md.appendMarkdown(
      `\nRule: \`${fn.triggeredRule}\` (\`${fn.ruleSeverity}\`)\n`
    );
  }

  md.appendMarkdown(
    `\n---\n[📊 Open Complexity Dashboard](command:bigoAnalyzer.openDashboard) · [🔍 Scan Workspace](command:bigoAnalyzer.scanWorkspace)\n`
  );

  return md;
}

export class BigOHoverProvider implements vscode.HoverProvider {
  constructor(private readonly cache: AnalysisCache) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.Hover | null {
    const config = vscode.workspace.getConfiguration('bigoAnalyzer');
    if (!config.get<boolean>('enabled', true)) {
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }

    const offset = document.offsetAt(position);
    const functions = this.cache.getOrAnalyze(document);

    // Prefer the innermost matching function header if nested
    let matched: FunctionComplexity | null = null;
    for (const fn of functions) {
      const headerStartLine = document.positionAt(fn.headerStartOffset).line;
      const headerEndLine = document.positionAt(fn.headerEndOffset).line;
      const inOffsetRange = offset >= fn.headerStartOffset && offset <= fn.headerEndOffset;
      const onHeaderLine = position.line >= headerStartLine && position.line <= headerEndLine;

      if (inOffsetRange || onHeaderLine) {
        if (
          !matched ||
          fn.headerEndOffset - fn.headerStartOffset <
            matched.headerEndOffset - matched.headerStartOffset
        ) {
          matched = fn;
        }
      }
    }

    if (!matched) {
      return null;
    }

    const range = new vscode.Range(
      document.positionAt(matched.headerStartOffset),
      document.positionAt(matched.headerEndOffset)
    );

    return new vscode.Hover(formatHoverMarkdown(matched), range);
  }
}
