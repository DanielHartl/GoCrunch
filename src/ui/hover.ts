import * as path from 'path';
import * as vscode from 'vscode';
import { CoverageStore } from '../state/coverageStore';
import { FailureStore } from '../state/failureStore';
import { TestLocator } from '../goTest/testLocator';

export class CoverageHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly store: CoverageStore,
    private readonly locator: TestLocator,
    private readonly failureStore: FailureStore,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (document.languageId !== 'go') {
      return undefined;
    }
    const line = position.line + 1;
    const lineMap = this.store.getFile(document.uri.fsPath);
    const info = lineMap?.get(line);
    if (!info || !info.executable) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;

    const tests = [...info.coveredBy].sort();
    if (tests.length === 0) {
      md.appendMarkdown('**GoCrunch:** _no test covers this line_');
      return new vscode.Hover(md);
    }

    const packageDir = path.dirname(document.uri.fsPath);
    const failCount = info.failingBy.size;
    // Failing first, then passing, alphabetic within each group — so the
    // problem you care about is at the top of the list.
    tests.sort((a, b) => {
      const af = info.failingBy.has(a) ? 0 : 1;
      const bf = info.failingBy.has(b) ? 0 : 1;
      return af - bf || a.localeCompare(b);
    });
    const header =
      failCount > 0
        ? `**GoCrunch:** $(error) ${failCount} failing of ${tests.length} test${tests.length === 1 ? '' : 's'}`
        : `**GoCrunch:** $(pass) covered by ${tests.length} test${tests.length === 1 ? '' : 's'}`;
    md.appendMarkdown(`${header}\n\n`);
    const locations = await Promise.all(tests.map((t) => this.locator.find(packageDir, t)));
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const loc = locations[i];
      const runArgs = encodeURIComponent(JSON.stringify({ testName: t, packageDir }));
      const runLink = `command:gocrunch.runTest?${runArgs}`;
      const debugLink = `command:gocrunch.debugTest?${runArgs}`;
      const failed = info.failingBy.has(t);
      const icon = failed ? '$(error)' : '$(pass)';
      const nameMd = failed ? `**\`${t}\`**` : `\`${t}\``;
      const label = loc
        ? `[${nameMd}](command:gocrunch.openTest?${encodeURIComponent(JSON.stringify(loc))} "Go to definition")`
        : nameMd;
      const outputLink =
        failed && this.failureStore.get(packageDir, t)
          ? ` · [output](command:gocrunch.showFailure?${runArgs} "Show failure output")`
          : '';
      md.appendMarkdown(
        `- ${icon} ${label} — [run](${runLink}) · [debug](${debugLink})${outputLink}\n`,
      );
    }
    if (info.mixed) {
      md.appendMarkdown('\n_partial: some blocks on this line are uncovered._');
    }
    return new vscode.Hover(md);
  }
}
