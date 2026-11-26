import * as vscode from 'vscode';
import { FunctionComplexity } from './analyzer';
import { AnalysisCache } from './cache';

export const OPEN_DASHBOARD_COMMAND = 'bigoAnalyzer.openDashboard';

export class BigOCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly cache: AnalysisCache) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const bigoDiagnostics = context.diagnostics.filter(
      (diag) => diag.source === 'Big-O Analyzer'
    );
    if (bigoDiagnostics.length === 0) {
      return [];
    }

    const functions = this.cache.getOrAnalyze(document);
    const matchedFn = this.findMatchingFunction(document, functions, range, bigoDiagnostics[0]);

    const actions: vscode.CodeAction[] = [];

    if (matchedFn && !matchedFn.ignored) {
      const suppressAction = new vscode.CodeAction(
        `Suppress Big-O analysis for ${matchedFn.name} (// bigo-ignore)`,
        vscode.CodeActionKind.QuickFix
      );
      suppressAction.isPreferred = true;
      suppressAction.diagnostics = bigoDiagnostics;

      const headerPos = document.positionAt(matchedFn.headerStartOffset);
      const headerLine = document.lineAt(headerPos.line);
      const indentMatch = headerLine.text.match(/^\s*/);
      const indent = indentMatch ? indentMatch[0] : '';

      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        document.uri,
        new vscode.Position(headerPos.line, 0),
        `${indent}// bigo-ignore\n`
      );
      suppressAction.edit = edit;
      actions.push(suppressAction);
    }

    const dashboardAction = new vscode.CodeAction(
      'Open Big-O Complexity Dashboard',
      vscode.CodeActionKind.QuickFix
    );
    dashboardAction.diagnostics = bigoDiagnostics;
    dashboardAction.command = {
      title: 'Open Big-O Complexity Dashboard',
      command: OPEN_DASHBOARD_COMMAND,
    };
    actions.push(dashboardAction);

    return actions;
  }

  private findMatchingFunction(
    document: vscode.TextDocument,
    functions: FunctionComplexity[],
    range: vscode.Range,
    diagnostic: vscode.Diagnostic
  ): FunctionComplexity | null {
    const targetOffset = document.offsetAt(diagnostic.range.start);
    const fallbackOffset = document.offsetAt(range.start);

    for (const offset of [targetOffset, fallbackOffset]) {
      let best: FunctionComplexity | null = null;
      for (const fn of functions) {
        if (offset >= fn.headerStartOffset && offset <= fn.endOffset) {
          if (!best || fn.endOffset - fn.startOffset < best.endOffset - best.startOffset) {
            best = fn;
          }
        }
      }
      if (best) {
        return best;
      }
    }
    return null;
  }
}
