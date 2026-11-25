import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { FunctionComplexity } from './analyzer';

export interface WorkspaceFunctionEntry {
  uriString: string;
  relativePath: string;
  fn: FunctionComplexity;
}

interface DashboardState {
  activeFileName: string;
  activeUriString: string;
  activeFunctions: FunctionComplexity[];
  workspaceHotspots: WorkspaceFunctionEntry[];
  workspaceScanned: boolean;
  activeTab: 'file' | 'workspace';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class BigODashboardPanel {
  private static currentPanel: BigODashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private state: DashboardState = {
    activeFileName: 'No JS/TS file active',
    activeUriString: '',
    activeFunctions: [],
    workspaceHotspots: [],
    workspaceScanned: false,
    activeTab: 'file',
  };

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly onJump: (uriString: string, startOffset: number, endOffset: number) => void,
    private readonly onScanWorkspace: () => Promise<void>
  ) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message: {
        type: string;
        uriString?: string;
        startOffset?: number;
        endOffset?: number;
        tab?: 'file' | 'workspace';
      }) => {
        if (
          message.type === 'jump' &&
          message.uriString &&
          typeof message.startOffset === 'number' &&
          typeof message.endOffset === 'number'
        ) {
          this.onJump(message.uriString, message.startOffset, message.endOffset);
        } else if (message.type === 'scanWorkspace') {
          await this.onScanWorkspace();
        } else if (message.type === 'switchTab' && message.tab) {
          this.state.activeTab = message.tab;
          this.render();
        }
      },
      null,
      this.disposables
    );

    this.render();
  }

  public static createOrShow(
    onJump: (uriString: string, startOffset: number, endOffset: number) => void,
    onScanWorkspace: () => Promise<void>
  ): BigODashboardPanel {
    const column = vscode.ViewColumn.Beside;
    if (BigODashboardPanel.currentPanel) {
      BigODashboardPanel.currentPanel.panel.reveal(column);
      return BigODashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'bigoComplexityDashboard',
      'Big-O Complexity Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    BigODashboardPanel.currentPanel = new BigODashboardPanel(
      panel,
      onJump,
      onScanWorkspace
    );
    return BigODashboardPanel.currentPanel;
  }

  public static getCurrent(): BigODashboardPanel | undefined {
    return BigODashboardPanel.currentPanel;
  }

  public updateCurrentFile(
    filePath: string,
    uriString: string,
    functions: FunctionComplexity[]
  ): void {
    this.state.activeFileName = path.basename(filePath) || 'Untitled';
    this.state.activeUriString = uriString;
    this.state.activeFunctions = [...functions].sort(
      (a, b) => b.bottleneckScore - a.bottleneckScore
    );
    this.render();
  }

  public updateWorkspaceHotspots(entries: WorkspaceFunctionEntry[]): void {
    this.state.workspaceHotspots = [...entries].sort(
      (a, b) => b.fn.bottleneckScore - a.fn.bottleneckScore
    );
    this.state.workspaceScanned = true;
    this.state.activeTab = 'workspace';
    this.render();
  }

  private dispose(): void {
    BigODashboardPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private render(): void {
    const nonce = crypto.randomBytes(16).toString('hex');
    const activeNonIgnored = this.state.activeFunctions.filter((f) => !f.ignored);
    const worstFn = activeNonIgnored[0] ?? null;

    const chartData = JSON.stringify({
      selectedComplexity: worstFn ? worstFn.timeComplexity : 'O(1)',
    });

    const fileRowsHtml =
      this.state.activeFunctions.length === 0
        ? `<tr><td colspan="5" class="empty">Open a JavaScript or TypeScript file to inspect function complexities.</td></tr>`
        : this.state.activeFunctions
            .map((fn) => {
              const targetStart = fn.bottleneckLocation
                ? fn.bottleneckLocation.startOffset
                : fn.headerStartOffset;
              const targetEnd = fn.bottleneckLocation
                ? fn.bottleneckLocation.endOffset
                : fn.headerEndOffset;
              const badge = fn.ignored ? '🔇' : fn.isHotspot ? '🔥' : '⏱️';
              const selfSuffix =
                fn.selfTimeComplexity !== fn.timeComplexity
                  ? `<span class="muted"> (self: ${escapeHtml(fn.selfTimeComplexity)})</span>`
                  : '';
              const reasonsHtml = fn.reasons
                .slice(0, 3)
                .map((r) => `<li>${escapeHtml(r)}</li>`)
                .join('');
              const tipHtml = fn.optimizationTip
                ? `<div class="tip">💡 ${escapeHtml(fn.optimizationTip)}</div>`
                : '';

              return `<tr class="${fn.isHotspot ? 'hotspot-row' : ''} ${fn.ignored ? 'ignored-row' : ''}">
                <td>
                  <button class="link-btn" data-jump="1" data-uri="${escapeHtml(this.state.activeUriString)}" data-start="${targetStart}" data-end="${targetEnd}">
                    ${badge} <code>${escapeHtml(fn.name)}</code>
                  </button>
                  <div class="muted">Line ${fn.startLine}</div>
                </td>
                <td><code>${escapeHtml(fn.timeComplexity)}</code>${selfSuffix}</td>
                <td><code>${escapeHtml(fn.spaceComplexity)}</code></td>
                <td>${fn.bottleneckScore}</td>
                <td><ul class="reasons">${reasonsHtml}</ul>${tipHtml}</td>
              </tr>`;
            })
            .join('');

    const workspaceRowsHtml = !this.state.workspaceScanned
      ? `<tr><td colspan="5" class="empty">Click "Scan Workspace Hotspots" above to audit all JS/TS files in this workspace.</td></tr>`
      : this.state.workspaceHotspots.length === 0
        ? `<tr><td colspan="5" class="empty">No hotspots found above the current threshold across scanned files.</td></tr>`
        : this.state.workspaceHotspots
            .map(({ uriString, relativePath, fn }) => {
              const targetStart = fn.bottleneckLocation
                ? fn.bottleneckLocation.startOffset
                : fn.headerStartOffset;
              const targetEnd = fn.bottleneckLocation
                ? fn.bottleneckLocation.endOffset
                : fn.headerEndOffset;
              return `<tr class="hotspot-row">
                <td>
                  <button class="link-btn" data-jump="1" data-uri="${escapeHtml(uriString)}" data-start="${targetStart}" data-end="${targetEnd}">
                    🔥 <code>${escapeHtml(fn.name)}</code>
                  </button>
                  <div class="muted">${escapeHtml(relativePath)}:${fn.startLine}</div>
                </td>
                <td><code>${escapeHtml(fn.timeComplexity)}</code></td>
                <td><code>${escapeHtml(fn.spaceComplexity)}</code></td>
                <td>${fn.bottleneckScore}</td>
                <td>${fn.optimizationTip ? escapeHtml(fn.optimizationTip) : escapeHtml(fn.reasons[0] ?? '')}</td>
              </tr>`;
            })
            .join('');

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Big-O Complexity Dashboard</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    h1 { font-size: 18px; margin: 0; }
    .actions { display: flex; gap: 8px; }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary.active {
      outline: 2px solid var(--vscode-focusBorder);
    }
    .chart-card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 18px;
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 10px;
    }
    .slider-wrap { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    svg { width: 100%; max-height: 210px; display: block; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
    }
    th { font-size: 11px; text-transform: uppercase; opacity: 0.8; }
    .hotspot-row { background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, transparent); }
    .ignored-row { opacity: 0.6; }
    .link-btn {
      background: none;
      border: none;
      padding: 0;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 13px;
      text-align: left;
    }
    .link-btn:hover { text-decoration: underline; }
    .muted { font-size: 11px; opacity: 0.75; }
    .reasons { margin: 0; padding-left: 16px; }
    .tip { margin-top: 4px; font-size: 12px; color: var(--vscode-editorInfo-foreground); }
    .empty { text-align: center; padding: 24px; opacity: 0.75; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; margin-top: 8px; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .swatch { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Big-O Complexity Dashboard</h1>
      <div class="muted">Active file: ${escapeHtml(this.state.activeFileName)} (${activeNonIgnored.length} analyzed)</div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary ${this.state.activeTab === 'file' ? 'active' : ''}" id="tab-file">Current File (${this.state.activeFunctions.length})</button>
      <button class="btn btn-secondary ${this.state.activeTab === 'workspace' ? 'active' : ''}" id="tab-workspace">Workspace Hotspots (${this.state.workspaceHotspots.length})</button>
      <button class="btn" id="scan-btn">Scan Workspace Hotspots</button>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-header">
      <div><strong>Asymptotic Growth Curves</strong> <span class="muted" id="worst-label">Worst in file: ${escapeHtml(worstFn ? `${worstFn.name} (${worstFn.timeComplexity})` : 'O(1)')}</span></div>
      <div class="slider-wrap">
        <label for="n-slider">Input size n = <strong id="n-val">100</strong></label>
        <input id="n-slider" type="range" min="10" max="1000" step="10" value="100" />
        <span class="muted" id="ops-est"></span>
      </div>
    </div>
    <svg id="bigo-chart" viewBox="0 0 600 180" preserveAspectRatio="none"></svg>
    <div class="legend" id="chart-legend"></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Function</th>
        <th>Time</th>
        <th>Space</th>
        <th>Score</th>
        <th>${this.state.activeTab === 'file' ? 'Breakdown & Tips' : 'Optimization Tip'}</th>
      </tr>
    </thead>
    <tbody>
      ${this.state.activeTab === 'file' ? fileRowsHtml : workspaceRowsHtml}
    </tbody>
  </table>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = ${chartData};

    document.getElementById('tab-file').addEventListener('click', () => {
      vscode.postMessage({ type: 'switchTab', tab: 'file' });
    });
    document.getElementById('tab-workspace').addEventListener('click', () => {
      vscode.postMessage({ type: 'switchTab', tab: 'workspace' });
    });
    document.getElementById('scan-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'scanWorkspace' });
    });
    document.querySelectorAll('[data-jump="1"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'jump',
          uriString: btn.getAttribute('data-uri'),
          startOffset: Number(btn.getAttribute('data-start')),
          endOffset: Number(btn.getAttribute('data-end')),
        });
      });
    });

    const curves = [
      { label: 'O(1)', color: '#38bdf8', fn: () => 1 },
      { label: 'O(log n)', color: '#34d399', fn: (n) => Math.log2(Math.max(2, n)) },
      { label: 'O(√n)', color: '#a3e635', fn: (n) => Math.sqrt(n) },
      { label: 'O(n)', color: '#facc15', fn: (n) => n },
      { label: 'O(n log n)', color: '#fb923c', fn: (n) => n * Math.log2(Math.max(2, n)) },
      { label: 'O(n²)', color: '#f87171', fn: (n) => n * n },
      { label: 'O(2^n)', color: '#e879f9', fn: (n) => Math.pow(2, Math.min(n, 20)) },
    ];

    function matchCurveLabel(complexity) {
      if (complexity.includes('2^n')) return 'O(2^n)';
      if (complexity.includes('n²') || complexity.includes('n^')) return 'O(n²)';
      if (complexity.includes('log')) return complexity.includes('n ') || complexity.includes('m log') ? 'O(n log n)' : 'O(log n)';
      if (complexity.includes('√n')) return 'O(√n)';
      if (complexity === 'O(n)') return 'O(n)';
      return 'O(1)';
    }

    const activeCurve = matchCurveLabel(state.selectedComplexity);
    const svg = document.getElementById('bigo-chart');
    const legend = document.getElementById('chart-legend');
    const slider = document.getElementById('n-slider');
    const nValEl = document.getElementById('n-val');
    const opsEstEl = document.getElementById('ops-est');

    function drawChart(nMax) {
      const W = 600, H = 180, pad = 16;
      const yCap = Math.max(100, nMax * 4);
      let paths = '<line x1="16" y1="164" x2="584" y2="164" stroke="currentColor" stroke-opacity="0.2" />' +
                  '<line x1="16" y1="16" x2="16" y2="164" stroke="currentColor" stroke-opacity="0.2" />';

      for (const c of curves) {
        const isSelected = c.label === activeCurve;
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const n = 1 + (i / 40) * (nMax - 1);
          const x = pad + (i / 40) * (W - 2 * pad);
          const normY = Math.min(1, c.fn(n) / yCap);
          const y = H - pad - normY * (H - 2 * pad);
          pts.push(x.toFixed(1) + ',' + y.toFixed(1));
        }
        paths += '<polyline fill="none" stroke="' + c.color + '" stroke-width="' + (isSelected ? 3.5 : 1.5) + '" stroke-opacity="' + (isSelected ? 1 : 0.45) + '" points="' + pts.join(' ') + '" />';
      }
      svg.innerHTML = paths;

      const activeObj = curves.find((c) => c.label === activeCurve) || curves[0];
      const est = Math.round(activeObj.fn(nMax));
      opsEstEl.textContent = activeCurve + ' ≈ ' + est.toLocaleString() + (activeCurve === 'O(2^n)' ? '+ ops (capped)' : ' ops');
    }

    legend.innerHTML = curves.map((c) => {
      const bold = c.label === activeCurve ? 'font-weight:700;text-decoration:underline;' : 'opacity:0.75;';
      return '<span class="legend-item" style="' + bold + '"><span class="swatch" style="background:' + c.color + '"></span>' + c.label + '</span>';
    }).join('');

    slider.addEventListener('input', () => {
      const n = Number(slider.value);
      nValEl.textContent = String(n);
      drawChart(n);
    });
    drawChart(Number(slider.value));
  </script>
</body>
</html>`;
  }
}
