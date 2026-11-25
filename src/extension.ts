import * as vscode from 'vscode';
import { FunctionComplexity } from './analyzer';
import { AnalysisCache } from './cache';
import {
  BigOCodeLensProvider,
  getHotspotThresholdScore,
  REVEAL_BOTTLENECK_COMMAND,
} from './codeLensProvider';
import { BigOHoverProvider } from './hoverProvider';

const SUPPORTED_LANGUAGES = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
];

const DOCUMENT_SELECTOR: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({
  language,
}));

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return SUPPORTED_LANGUAGES.includes(document.languageId);
}

function findWorstBottleneck(functions: FunctionComplexity[]): FunctionComplexity | null {
  let worst: FunctionComplexity | null = null;
  for (const fn of functions) {
    if (fn.ignored || !fn.bottleneckLocation || fn.bottleneckScore <= 1) {
      continue;
    }
    if (!worst || fn.bottleneckScore > worst.bottleneckScore) {
      worst = fn;
    }
  }
  return worst;
}

function getDiagnosticSeverity(config: vscode.WorkspaceConfiguration): vscode.DiagnosticSeverity {
  const level = config.get<string>('diagnosticSeverity', 'Information');
  switch (level) {
    case 'Warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'Hint':
      return vscode.DiagnosticSeverity.Hint;
    case 'Information':
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('[Big-O Complexity Analyzer] Extension activated');
  const cache = new AnalysisCache();
  const codeLensProvider = new BigOCodeLensProvider(cache);
  const hoverProvider = new BigOHoverProvider(cache);
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('bigo-complexity');

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.name = 'Big-O Complexity Analyzer';

  const hotspotDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editorWarning.background'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('editorWarning.foreground'),
    after: {
      margin: '0 0 0 1.5em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
  });

  const updateDiagnosticsForDocument = (
    document: vscode.TextDocument,
    functions: FunctionComplexity[],
    config: vscode.WorkspaceConfiguration
  ): void => {
    const enabled = config.get<boolean>('enabled', true);
    const showDiagnostics = config.get<boolean>('showDiagnostics', true);

    if (!enabled || !showDiagnostics || !isSupportedDocument(document)) {
      diagnosticCollection.delete(document.uri);
      return;
    }

    const severity = getDiagnosticSeverity(config);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const fn of functions) {
      if (fn.ignored || !fn.isHotspot) {
        continue;
      }

      const startOffset = fn.bottleneckLocation
        ? fn.bottleneckLocation.startOffset
        : fn.headerStartOffset;
      const endOffset = fn.bottleneckLocation
        ? fn.bottleneckLocation.endOffset
        : fn.headerEndOffset;
      const startPos = document.positionAt(startOffset);
      const endPos = document.positionAt(endOffset);
      const range =
        startPos.line === endPos.line
          ? new vscode.Range(startPos, endPos)
          : document.lineAt(startPos.line).range;

      const tipSuffix = fn.optimizationTip ? ` Tip: ${fn.optimizationTip}` : '';
      const message = `${fn.name}() has ${fn.timeComplexity} time (${fn.spaceComplexity} space).${tipSuffix}`;
      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.source = 'Big-O Analyzer';
      diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
  };

  const updateStatusBar = (
    document: vscode.TextDocument | undefined,
    functions: FunctionComplexity[],
    enabled: boolean
  ): void => {
    if (!enabled || !document || !isSupportedDocument(document)) {
      statusBarItem.hide();
      return;
    }

    const activeFns = functions.filter((fn) => !fn.ignored);
    if (activeFns.length === 0) {
      statusBarItem.hide();
      return;
    }

    const worst = findWorstBottleneck(activeFns);
    if (!worst || !worst.bottleneckLocation) {
      statusBarItem.text = '$(clock) Big-O: O(1)';
      statusBarItem.tooltip = 'All active functions in this file run in O(1) time';
      statusBarItem.command = undefined;
      statusBarItem.show();
      return;
    }

    const icon = worst.isHotspot ? '$(flame)' : '$(clock)';
    statusBarItem.text = `${icon} Big-O: ${worst.timeComplexity} (${worst.name})`;
    statusBarItem.tooltip = `${worst.name}: ${worst.timeComplexity} time, ${worst.spaceComplexity} space — Click to jump to bottleneck`;
    statusBarItem.command = {
      title: 'Jump to Bottleneck',
      command: REVEAL_BOTTLENECK_COMMAND,
      arguments: [
        document.uri,
        worst.bottleneckLocation.startOffset,
        worst.bottleneckLocation.endOffset,
      ],
    };
    statusBarItem.show();
  };

  const updateEditorState = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || !isSupportedDocument(editor.document)) {
      statusBarItem.hide();
      return;
    }

    const config = vscode.workspace.getConfiguration('bigoAnalyzer');
    const enabled = config.get<boolean>('enabled', true);
    const showDecorations = config.get<boolean>('showDecorations', true);
    const threshold = getHotspotThresholdScore(config);

    if (!enabled) {
      editor.setDecorations(hotspotDecorationType, []);
      diagnosticCollection.delete(editor.document.uri);
      statusBarItem.hide();
      return;
    }

    const functions = cache.getOrAnalyze(editor.document, threshold);
    updateDiagnosticsForDocument(editor.document, functions, config);
    updateStatusBar(editor.document, functions, enabled);

    if (!showDecorations) {
      editor.setDecorations(hotspotDecorationType, []);
      return;
    }

    const worst = findWorstBottleneck(functions);
    if (!worst || !worst.bottleneckLocation) {
      editor.setDecorations(hotspotDecorationType, []);
      return;
    }

    const targetPos = editor.document.positionAt(worst.bottleneckLocation.startOffset);
    const lineRange = editor.document.lineAt(targetPos.line).range;
    const icon = worst.isHotspot ? '🔥' : '⏱️';

    const decoration: vscode.DecorationOptions = {
      range: lineRange,
      hoverMessage: `**Worst bottleneck in file:** \`${worst.name}\` (${worst.timeComplexity} time, ${worst.spaceComplexity} space) — ${worst.bottleneckLocation.description}`,
      renderOptions: {
        after: {
          contentText: `  ← ${icon} Worst bottleneck: ${worst.timeComplexity} in ${worst.name}`,
        },
      },
    };

    editor.setDecorations(hotspotDecorationType, [decoration]);
  };

  let debounceTimer: NodeJS.Timeout | undefined;
  const scheduleRefresh = (editor: vscode.TextEditor | undefined): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      updateEditorState(editor);
      codeLensProvider.refresh();
    }, 150);
  };

  const revealBottleneckCommand = vscode.commands.registerCommand(
    REVEAL_BOTTLENECK_COMMAND,
    async (uri?: vscode.Uri, startOffset?: number, endOffset?: number) => {
      if (!uri || typeof startOffset !== 'number' || typeof endOffset !== 'number') {
        return;
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      const startPos = document.positionAt(startOffset);
      const endPos = document.positionAt(endOffset);
      const selectionRange = new vscode.Range(startPos, endPos);

      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(selectionRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  );

  const toggleEnabledCommand = vscode.commands.registerCommand(
    'bigoAnalyzer.toggleEnabled',
    async () => {
      const config = vscode.workspace.getConfiguration('bigoAnalyzer');
      const current = config.get<boolean>('enabled', true);
      await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        `Big-O Complexity Analyzer ${!current ? 'enabled' : 'disabled'}`,
        3000
      );
    }
  );

  context.subscriptions.push(
    hotspotDecorationType,
    diagnosticCollection,
    statusBarItem,
    codeLensProvider,
    revealBottleneckCommand,
    toggleEnabledCommand,
    vscode.languages.registerCodeLensProvider(DOCUMENT_SELECTOR, codeLensProvider),
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, hoverProvider),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateEditorState(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isSupportedDocument(event.document)) {
        // Clear cross-file cached results so helper edits propagate to callers
        cache.invalidateAll();
      }
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        scheduleRefresh(activeEditor);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cache.delete(document.uri);
      diagnosticCollection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('bigoAnalyzer')) {
        cache.invalidateAll();
        updateEditorState(vscode.window.activeTextEditor);
        codeLensProvider.refresh();
      }
    }),
    {
      dispose: () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        cache.clear();
        diagnosticCollection.clear();
      },
    }
  );

  updateEditorState(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Resources are disposed via context.subscriptions
}
