import * as vscode from 'vscode';
import { CoverageStore } from '../state/coverageStore';

function gutterSvgUri(color: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="16"><rect width="4" height="16" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export class CoverageDecorations implements vscode.Disposable {
  private readonly covered: vscode.TextEditorDecorationType;
  private readonly uncovered: vscode.TextEditorDecorationType;
  private readonly partial: vscode.TextEditorDecorationType;
  private readonly failing: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: CoverageStore) {
    this.covered = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutterSvgUri('#3fb950'),
      gutterIconSize: 'contain',
      overviewRulerColor: '#3fb950',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    // Neutral grey — red is reserved for failing tests so an uncovered line
    // doesn't masquerade as a regression.
    this.uncovered = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutterSvgUri('#9d9d9d'),
      gutterIconSize: 'contain',
      overviewRulerColor: '#9d9d9d',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.partial = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutterSvgUri('#d29922'),
      gutterIconSize: 'contain',
      overviewRulerColor: '#d29922',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    // Brighter red + a faint line background so a failing test is unmistakable
    // and clearly distinct from "uncovered" (which is just the gutter bar).
    this.failing = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutterSvgUri('#ff4d4d'),
      gutterIconSize: 'contain',
      overviewRulerColor: '#ff4d4d',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      isWholeLine: true,
      backgroundColor: 'rgba(255, 77, 77, 0.18)',
    });
    this.disposables.push(this.covered, this.uncovered, this.partial, this.failing);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.apply(editor);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === e.document) {
          this.apply(editor);
        }
      }),
    );
  }

  /**
   * Refresh decorations on every visible editor — call this after the store
   * changes (e.g. after a run completes).
   */
  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.apply(editor);
    }
  }

  apply(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'go') {
      this.clearAll(editor);
      return;
    }
    const lineMap = this.store.getFile(editor.document.uri.fsPath);
    if (!lineMap) {
      this.clearAll(editor);
      return;
    }

    const covered: vscode.Range[] = [];
    const uncovered: vscode.Range[] = [];
    const partial: vscode.Range[] = [];
    const failing: vscode.Range[] = [];

    for (const [line, info] of lineMap) {
      if (!info.executable) {
        continue;
      }
      const idx = line - 1; // VS Code lines are 0-based
      if (idx < 0 || idx >= editor.document.lineCount) {
        continue;
      }
      const range = editor.document.lineAt(idx).range;
      // A failing test on this line preempts every other state.
      if (info.failingBy.size > 0) {
        failing.push(range);
      } else if (info.coveredBy.size === 0) {
        uncovered.push(range);
      } else if (info.mixed) {
        partial.push(range);
      } else {
        covered.push(range);
      }
    }

    editor.setDecorations(this.covered, covered);
    editor.setDecorations(this.uncovered, uncovered);
    editor.setDecorations(this.partial, partial);
    editor.setDecorations(this.failing, failing);
  }

  private clearAll(editor: vscode.TextEditor): void {
    editor.setDecorations(this.covered, []);
    editor.setDecorations(this.uncovered, []);
    editor.setDecorations(this.partial, []);
    editor.setDecorations(this.failing, []);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

