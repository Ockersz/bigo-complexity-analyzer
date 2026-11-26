export type RulePreset = 'relaxed' | 'recommended' | 'strict';

export type RuleLevel = 'off' | 'hint' | 'info' | 'warning';

export type HotspotThresholdLabel = 'O(n log n)' | 'O(n²)' | 'O(2^n)';

export type DiagnosticSeverityLabel = 'Hint' | 'Information' | 'Warning';

export interface BigORuleSet {
  noSpreadInLoop: RuleLevel;
  noShiftInLoop: RuleLevel;
  noHeavyLoopOp: RuleLevel;
  noRegexInLoop: RuleLevel;
  noNestedArrayLookup: RuleLevel;
  noSortInLoop: RuleLevel;
}

export interface BigOConfigFile {
  preset?: RulePreset;
  hotspotThreshold?: HotspotThresholdLabel;
  diagnosticSeverity?: DiagnosticSeverityLabel;
  rules?: Partial<BigORuleSet>;
  ignore?: string[];
}

export interface VSCodeBigOSettings {
  preset?: RulePreset;
  explicitHotspotThreshold?: HotspotThresholdLabel;
  explicitDiagnosticSeverity?: DiagnosticSeverityLabel;
  rules?: Partial<BigORuleSet>;
  ignore?: string[];
}

export interface ResolvedBigOConfig {
  preset: RulePreset;
  hotspotThresholdScore: number;
  defaultSeverity: DiagnosticSeverityLabel;
  rules: BigORuleSet;
  ignore: string[];
  configSignature: string;
  configSource: string;
}

interface PresetSpec {
  hotspotThreshold: HotspotThresholdLabel;
  diagnosticSeverity: DiagnosticSeverityLabel;
  rules: BigORuleSet;
}

export const PRESET_DEFAULTS: Record<RulePreset, PresetSpec> = {
  relaxed: {
    hotspotThreshold: 'O(n²)',
    diagnosticSeverity: 'Hint',
    rules: {
      noSpreadInLoop: 'info',
      noShiftInLoop: 'info',
      noHeavyLoopOp: 'off',
      noRegexInLoop: 'off',
      noNestedArrayLookup: 'info',
      noSortInLoop: 'off',
    },
  },
  recommended: {
    hotspotThreshold: 'O(n²)',
    diagnosticSeverity: 'Information',
    rules: {
      noSpreadInLoop: 'info',
      noShiftInLoop: 'info',
      noHeavyLoopOp: 'info',
      noRegexInLoop: 'info',
      noNestedArrayLookup: 'info',
      noSortInLoop: 'info',
    },
  },
  strict: {
    hotspotThreshold: 'O(n log n)',
    diagnosticSeverity: 'Warning',
    rules: {
      noSpreadInLoop: 'warning',
      noShiftInLoop: 'warning',
      noHeavyLoopOp: 'warning',
      noRegexInLoop: 'warning',
      noNestedArrayLookup: 'warning',
      noSortInLoop: 'warning',
    },
  },
};

export function hotspotLabelToScore(label: HotspotThresholdLabel | string | undefined): number {
  switch (label) {
    case 'O(n log n)':
      return 15;
    case 'O(2^n)':
      return 100;
    case 'O(n²)':
    default:
      return 30;
  }
}

export function resolveBigOConfig(
  vsCodeSettings: VSCodeBigOSettings = {},
  rcFile: BigOConfigFile | null = null,
  rcFilePath?: string
): ResolvedBigOConfig {
  const rawPreset = rcFile?.preset ?? vsCodeSettings.preset ?? 'recommended';
  const preset: RulePreset =
    rawPreset === 'relaxed' || rawPreset === 'strict' || rawPreset === 'recommended'
      ? rawPreset
      : 'recommended';
  const base = PRESET_DEFAULTS[preset];

  const thresholdLabel =
    rcFile?.hotspotThreshold ??
    vsCodeSettings.explicitHotspotThreshold ??
    base.hotspotThreshold;

  const defaultSeverity =
    rcFile?.diagnosticSeverity ??
    vsCodeSettings.explicitDiagnosticSeverity ??
    base.diagnosticSeverity;

  const rules: BigORuleSet = {
    ...base.rules,
    ...(vsCodeSettings.rules ?? {}),
    ...(rcFile?.rules ?? {}),
  };

  const ignore = Array.isArray(rcFile?.ignore)
    ? rcFile.ignore
    : Array.isArray(vsCodeSettings.ignore)
      ? vsCodeSettings.ignore
      : [];

  const hotspotThresholdScore = hotspotLabelToScore(thresholdLabel);
  const configSource = rcFile && rcFilePath ? rcFilePath : `preset:${preset}`;
  const configSignature = JSON.stringify({
    preset,
    hotspotThresholdScore,
    defaultSeverity,
    rules,
    ignore,
    configSource,
  });

  return {
    preset,
    hotspotThresholdScore,
    defaultSeverity,
    rules,
    ignore,
    configSignature,
    configSource,
  };
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let regexStr = '';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        regexStr += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      regexStr += `\\${ch}`;
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }

  if (!normalized.includes('/')) {
    return new RegExp(`^(?:.*/)?${regexStr}$`);
  }
  return new RegExp(`^${regexStr}$`);
}

export function matchesIgnorePatterns(relativePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }
    try {
      return globToRegExp(trimmed).test(normalizedPath);
    } catch {
      return false;
    }
  });
}
