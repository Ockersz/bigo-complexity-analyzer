import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  analyzeCode,
  FunctionComplexity,
  ResolvedImportSource,
} from './analyzer';

interface CacheEntry {
  version: number;
  hotspotThreshold: number;
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

export class AnalysisCache {
  private readonly entries = new Map<string, CacheEntry>();

  public getOrAnalyze(
    document: vscode.TextDocument,
    hotspotThreshold = 30
  ): FunctionComplexity[] {
    const key = document.uri.toString();
    const existing = this.entries.get(key);
    if (
      existing &&
      existing.version === document.version &&
      existing.hotspotThreshold === hotspotThreshold
    ) {
      return existing.results;
    }

    const results = analyzeCode(document.getText(), document.fileName, {
      hotspotThreshold,
      resolveImport: resolveImportFromWorkspace,
    });
    this.entries.set(key, {
      version: document.version,
      hotspotThreshold,
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
