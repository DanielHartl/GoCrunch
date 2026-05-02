import * as path from 'path';
import * as vscode from 'vscode';

export interface DiscoveredTest {
  name: string;
  line: number;
  range: vscode.Range;
  packageDir: string;
  filePath: string;
}

const TEST_FUNC_RE = /^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)/gm;

export function discoverTestsInDocument(document: vscode.TextDocument): DiscoveredTest[] {
  if (!isGoTestFile(document)) {
    return [];
  }

  const text = document.getText();
  const tests: DiscoveredTest[] = [];
  for (const match of text.matchAll(TEST_FUNC_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + match[0].length);
    tests.push({
      name: match[1],
      line: startPos.line,
      range: new vscode.Range(startPos, endPos),
      filePath: document.uri.fsPath,
      packageDir: path.dirname(document.uri.fsPath),
    });
  }
  return tests;
}

export function isGoTestFile(document: vscode.TextDocument): boolean {
  return (
    document.languageId === 'go' &&
    document.uri.scheme === 'file' &&
    document.uri.fsPath.endsWith('_test.go')
  );
}
