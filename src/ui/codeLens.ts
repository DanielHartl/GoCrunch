import * as vscode from 'vscode';
import { discoverTestsInDocument } from '../goTest/discovery';

export class GoTestCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const tests = discoverTestsInDocument(document);
    const lenses: vscode.CodeLens[] = [];
    for (const t of tests) {
      const lensRange = new vscode.Range(t.range.start, t.range.start);
      lenses.push(
        new vscode.CodeLens(lensRange, {
          title: '$(play) run test',
          command: 'gocrunch.runTest',
          arguments: [{ testName: t.name, packageDir: t.packageDir }],
        }),
        new vscode.CodeLens(lensRange, {
          title: '$(debug-alt) debug test',
          command: 'gocrunch.debugTest',
          arguments: [{ testName: t.name, packageDir: t.packageDir }],
        }),
      );
    }
    return lenses;
  }
}
