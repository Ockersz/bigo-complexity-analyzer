import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  analyzeCode,
  FunctionComplexity,
  ResolvedImportSource,
} from './analyzer';
import {
  BigOConfigFile,
  BigORuleSet,
  DiagnosticSeverityLabel,
  HotspotThresholdLabel,
  matchesIgnorePatterns,
  resolveBigOConfig,
  ResolvedBigOConfig,
  RulePreset,
} from './config';

interface CacheEntry {
  version: number;
  configSignature: string;
  results: FunctionComplexity[];
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

function resolveRelativeFilePath(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }

  const baseDir = path.dirname(fromFile);
  const rawTarget = path.resolve(baseDir, specifier);

  const candidates: string[] = [];
  if (path.extname(rawTarget)) {
    candidates.push(rawTarget);
  } else {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${rawTarget}${ext}`);
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(path.join(rawTarget, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore unreadable filesystem entries
    }
  }
  return null;
}

function resolveImportFromWorkspace(
  specifier: string,
  fromFile: string
): ResolvedImportSource | null {
  const resolvedPath = resolveRelativeFilePath(specifier, fromFile);
  if (!resolvedPath) {
    return null;
  }

  const openDoc = vscode.workspace.textDocuments.find(
    (doc) => path.resolve(doc.fileName) === path.resolve(resolvedPath)
  );
  if (openDoc) {
    return {
      fileName: openDoc.fileName,
      sourceText: openDoc.getText(),
    };
  }

  try {
    return {
      fileName: resolvedPath,
      sourceText: fs.readFileSync(resolvedPath, 'utf8'),
    };
  } catch {
    return null;
  }
}

function getExplicitSetting<T>(
  config: vscode.WorkspaceConfiguration,
  key: string
): T | undefined {
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return undefined;
  }
  return (
    inspected.workspaceFolderLanguageValue ??
    inspected.workspaceFolderValue ??
    inspected.workspaceLanguageValue ??
    inspected.workspaceValue ??
    inspected.globalLanguageValue ??
    inspected.globalValue
  );
}

function findRcFileForDocument(
  document: vscode.TextDocument
): { rcFile: BigOConfigFile; rcPath: string } | null {
  if (document.uri.scheme !== 'file') {
    return null;
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const stopDir = folder ? path.resolve(folder.uri.fsPath) : undefined;
  let currentDir = path.dirname(path.resolve(document.fileName));

  while (true) {
    const candidate = path.join(currentDir, '.bigorc.json');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const openRc = vscode.workspace.textDocuments.find(
          (d) => path.resolve(d.fileName) === candidate
        );
        const rawText = openRc ? openRc.getText() : fs.readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(rawText) as BigOConfigFile;
        if (parsed && typeof parsed === 'object') {
          return { rcFile: parsed, rcPath: candidate };
        }
      }
    } catch {
      // Ignore invalid or unreadable .bigorc.json
    }

    if (stopDir && currentDir === stopDir) {
      break;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return null;
}

export class AnalysisCache {
  private readonly entries = new Map<string, CacheEntry>();

  public getConfigForDocument(document: vscode.TextDocument): ResolvedBigOConfig {
    const config = vscode.workspace.getConfiguration('bigoAnalyzer', document.uri);
    const rcMatch = findRcFileForDocument(document);

    return resolveBigOConfig(
      {
        preset: getExplicitSetting<RulePreset>(config, 'preset'),
        explicitHotspotThreshold: getExplicitSetting<HotspotThresholdLabel>(
          config,
          'hotspotThreshold'
        ),
        explicitDiagnosticSeverity: getExplicitSetting<DiagnosticSeverityLabel>(
          config,
          'diagnosticSeverity'
        ),
        rules: getExplicitSetting<Partial<BigORuleSet>>(config, 'rules'),
        ignore: getExplicitSetting<string[]>(config, 'ignore'),
      },
      rcMatch?.rcFile ?? null,
      rcMatch?.rcPath
    );
  }

  public getOrAnalyze(document: vscode.TextDocument): FunctionComplexity[] {
    const resolvedConfig = this.getConfigForDocument(document);
    const relPath = vscode.workspace.asRelativePath(document.uri, false);

    if (matchesIgnorePatterns(relPath, resolvedConfig.ignore)) {
      return [];
    }

    const key = document.uri.toString();
    const existing = this.entries.get(key);
    if (
      existing &&
      existing.version === document.version &&
      existing.configSignature === resolvedConfig.configSignature
    ) {
      return existing.results;
    }

    const results = analyzeCode(document.getText(), document.fileName, {
      hotspotThreshold: resolvedConfig.hotspotThresholdScore,
      rules: resolvedConfig.rules,
      resolveImport: resolveImportFromWorkspace,
    });
    this.entries.set(key, {
      version: document.version,
      configSignature: resolvedConfig.configSignature,
      results,
    });
    return results;
  }

  public delete(uri: vscode.Uri): void {
    this.entries.delete(uri.toString());
  }

  public invalidateAll(): void {
    this.entries.clear();
  }

  public clear(): void {
    this.entries.clear();
  }
}
