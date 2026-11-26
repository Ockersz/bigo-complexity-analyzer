import * as vscode from 'vscode';
import { AnalysisCache } from './cache';

export const REVEAL_BOTTLENECK_COMMAND = 'bigoAnalyzer.revealBottleneck';

export function getHotspotThresholdScore(config: vscode.WorkspaceConfiguration): number {
  const setting = config.get<string>('hotspotThreshold', 'O(n²)');
  switch (setting) {
    case 'O(n log n)':
      return 15;
    case 'O(2^n)':
      return 100;
    case 'O(n²)':
    default:
      return 30;
  }
}

export class BigOCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this.onDidChangeCodeLensesEmitter.event;

  constructor(private readonly cache: AnalysisCache) {}

  public refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('bigoAnalyzer');
    if (!config.get<boolean>('enabled', true) || !config.get<boolean>('showCodeLens', true)) {
      return [];
    }

    if (token.isCancellationRequested) {
      return [];
    }

    const functions = this.cache.getOrAnalyze(document);
    const lenses: vscode.CodeLens[] = [];

    for (const fn of functions) {
      if (token.isCancellationRequested) {
        break;
      }
      if (fn.ignored) {
        continue;
      }

      const headerPos = document.positionAt(fn.headerStartOffset);
      const lineRange = new vscode.Range(headerPos.line, 0, headerPos.line, 0);

      const prefix = fn.isHotspot ? '🔥' : '⏱️';
      const title = `${prefix} Time: ${fn.timeComplexity} | 💾 Space: ${fn.spaceComplexity}`;

      const targetStart = fn.bottleneckLocation
        ? fn.bottleneckLocation.startOffset
        : fn.headerStartOffset;
      const targetEnd = fn.bottleneckLocation
        ? fn.bottleneckLocation.endOffset
        : fn.headerEndOffset;

      lenses.push(
        new vscode.CodeLens(lineRange, {
          title,
          tooltip: fn.bottleneckLocation
            ? `Click to jump to bottleneck: ${fn.bottleneckLocation.description}`
            : `Jump to ${fn.name}`,
          command: REVEAL_BOTTLENECK_COMMAND,
          arguments: [document.uri, targetStart, targetEnd],
        })
      );
    }

    return lenses;
  }

  public dispose(): void {
    this.onDidChangeCodeLensesEmitter.dispose();
  }
}
