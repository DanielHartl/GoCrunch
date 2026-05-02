import * as path from 'path';
import * as vscode from 'vscode';
import { GoTestCodeLensProvider } from './ui/codeLens';
import { CoverageDecorations } from './ui/decorations';
import { CoverageHoverProvider } from './ui/hover';
import { CoverageStore } from './state/coverageStore';
import {
  listAllTests,
  runSingleTest,
  RunOptions,
  TestEnumeration,
  TestRunResult,
} from './goTest/runner';
import { readCoverProfile } from './goTest/coverage';
import { TestLocator } from './goTest/testLocator';

interface RunCommandArgs {
  testName: string;
  packageDir: string;
}

function getRunOptions(channel: vscode.OutputChannel): RunOptions {
  const cfg = vscode.workspace.getConfiguration('gocrunch');
  return {
    goPath: cfg.get<string>('goPath', 'go'),
    timeoutSec: cfg.get<number>('testTimeout', 60),
    channel,
  };
}

function cachePath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return path.join(folder.uri.fsPath, '.vscode', '.gocrunch-cache.json');
}

async function ingestResultIntoStore(
  store: CoverageStore,
  result: TestRunResult,
  importPathToDir: Map<string, string>,
  channel: vscode.OutputChannel,
): Promise<void> {
  if (!result.coverProfilePath) {
    return;
  }
  try {
    const profile = await readCoverProfile(result.coverProfilePath);
    store.recordCoverage(result.testName, profile, importPathToDir, result.passed);
  } catch (err) {
    channel.appendLine(`[WARN] could not parse coverprofile for ${result.testName}: ${(err as Error).message}`);
  }
}

function buildImportPathToDirMap(enumerations: TestEnumeration[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of enumerations) {
    m.set(e.packageImportPath, e.packageDir);
  }
  return m;
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('GoCrunch');
  context.subscriptions.push(channel);
  channel.appendLine('GoCrunch activated.');

  const store = new CoverageStore();
  const decorations = new CoverageDecorations(store);
  context.subscriptions.push(decorations);

  const testLocator = new TestLocator();

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = 'GoCrunch: idle';
  status.tooltip = 'Click to refresh GoCrunch coverage';
  status.command = 'gocrunch.refreshCoverage';
  status.show();
  context.subscriptions.push(status);

  let lastSummary = 'GoCrunch: idle';
  let stale = false;
  const setSummary = (text: string): void => {
    lastSummary = text;
    status.text = stale ? `${text} $(warning) stale` : text;
  };
  const markStale = (reason: string): void => {
    if (!stale) {
      stale = true;
      channel.appendLine(`Coverage marked stale: ${reason}`);
    }
    status.text = `${lastSummary} $(warning) stale`;
  };
  const clearStale = (): void => {
    stale = false;
    status.text = lastSummary;
  };

  // Per-package import-path → dir, refreshed on demand
  let importPathToDir = new Map<string, string>();

  const cp = cachePath();
  if (cp) {
    void store.loadFrom(cp).then(async (loaded) => {
      if (loaded) {
        channel.appendLine(`Loaded coverage cache from ${cp}`);
        decorations.refreshAll();
      } else {
        const action = await vscode.window.showInformationMessage(
          'GoCrunch: no coverage map found. Build initial coverage by running every test? (this can be slow)',
          'Run all tests',
          'Skip',
        );
        if (action === 'Run all tests') {
          await vscode.commands.executeCommand('gocrunch.runAllTests');
        }
      }
    });
  }

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: 'file' },
      new GoTestCodeLensProvider(),
    ),
    vscode.languages.registerHoverProvider(
      { language: 'go', scheme: 'file' },
      new CoverageHoverProvider(store, testLocator),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gocrunch.runTest', async (arg?: RunCommandArgs) => {
      if (!arg?.testName || !arg.packageDir) {
        vscode.window.showWarningMessage('GoCrunch: runTest requires {testName, packageDir}');
        return;
      }
      channel.show(true);
      setSummary(`$(sync~spin) GoCrunch: running ${arg.testName}`);
      try {
        const opts = getRunOptions(channel);
        const result = await runSingleTest(arg.packageDir, arg.testName, opts);
        const sym = result.passed ? '$(check)' : '$(error)';
        setSummary(
          `${sym} GoCrunch: ${arg.testName} ${result.passed ? 'passed' : 'failed'} (${result.durationMs}ms)`,
        );
        channel.appendLine(
          `[${result.passed ? 'PASS' : 'FAIL'}] ${arg.testName} in ${result.durationMs}ms`,
        );
        if (importPathToDir.size === 0) {
          // bootstrap mapping lazily so single-test runs still attribute correctly
          const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(arg.packageDir));
          if (folder) {
            try {
              importPathToDir = buildImportPathToDirMap(await listAllTests(folder.uri.fsPath, opts));
            } catch {
              // ignore — attribution will simply skip until we have a map
            }
          }
        }
        await ingestResultIntoStore(store, result, importPathToDir, channel);
        decorations.refreshAll();
        if (cp) {
          await store.saveTo(cp);
        }
      } catch (err) {
        setSummary('$(error) GoCrunch: run failed');
        channel.appendLine(`[ERROR] ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('gocrunch.debugTest', async (arg?: RunCommandArgs) => {
      if (!arg?.testName || !arg.packageDir) {
        vscode.window.showWarningMessage('GoCrunch: debugTest requires {testName, packageDir}');
        return;
      }
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(arg.packageDir));
      const ok = await vscode.debug.startDebugging(folder, {
        name: `GoCrunch: debug ${arg.testName}`,
        type: 'go',
        request: 'launch',
        mode: 'test',
        program: arg.packageDir,
        args: ['-test.run', `^${arg.testName}$`, '-test.v'],
      });
      if (!ok) {
        vscode.window.showErrorMessage(
          'GoCrunch: failed to start debugger. Is the Go extension installed?',
        );
      }
    }),
    vscode.commands.registerCommand('gocrunch.runAllTests', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage('GoCrunch: open a Go workspace first');
        return;
      }
      channel.show(true);
      const opts = getRunOptions(channel);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'GoCrunch: running all tests',
          cancellable: true,
        },
        async (progress, token) => {
          setSummary('$(sync~spin) GoCrunch: enumerating tests');
          let enumerations: TestEnumeration[];
          try {
            enumerations = await listAllTests(folder.uri.fsPath, opts);
          } catch (err) {
            channel.appendLine(`[ERROR] ${(err as Error).message}`);
            setSummary('$(error) GoCrunch: list failed');
            return;
          }
          importPathToDir = buildImportPathToDirMap(enumerations);
          // a full run is the source of truth — drop stale per-test entries
          store.clear();

          const total = enumerations.reduce((n, e) => n + e.tests.length, 0);
          if (total === 0) {
            vscode.window.showInformationMessage('GoCrunch: no tests found');
            setSummary('GoCrunch: no tests');
            return;
          }
          let done = 0;
          let passed = 0;
          let failed = 0;
          for (const e of enumerations) {
            for (const test of e.tests) {
              if (token.isCancellationRequested) {
                channel.appendLine('[CANCELLED]');
                break;
              }
              progress.report({
                message: `${test} (${done + 1}/${total})`,
                increment: (1 / total) * 100,
              });
              try {
                const result = await runSingleTest(e.packageDir, test, opts);
                if (result.passed) {
                  passed++;
                } else {
                  failed++;
                }
                channel.appendLine(
                  `[${result.passed ? 'PASS' : 'FAIL'}] ${e.packageImportPath}.${test} (${result.durationMs}ms)`,
                );
                await ingestResultIntoStore(store, result, importPathToDir, channel);
              } catch (err) {
                failed++;
                channel.appendLine(`[ERROR] ${test}: ${(err as Error).message}`);
              }
              done++;
            }
            if (token.isCancellationRequested) {
              break;
            }
          }
          if (cp) {
            await store.saveTo(cp);
            channel.appendLine(`Saved coverage cache to ${cp}`);
          }
          decorations.refreshAll();
          clearStale();
          const sym = failed === 0 ? '$(check)' : '$(error)';
          setSummary(`${sym} GoCrunch: ${passed} passing, ${failed} failing`);
        },
      );
    }),
    vscode.commands.registerCommand('gocrunch.refreshCoverage', () => {
      vscode.commands.executeCommand('gocrunch.runAllTests');
    }),
    vscode.commands.registerCommand(
      'gocrunch.openTest',
      async (arg?: { filePath: string; line: number; character: number }) => {
        if (!arg?.filePath) {
          return;
        }
        const pos = new vscode.Position(arg.line ?? 0, arg.character ?? 0);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(arg.filePath));
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(pos, pos),
          preserveFocus: false,
        });
      },
    ),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'go' || doc.uri.scheme !== 'file') {
        return;
      }
      testLocator.invalidate(doc.uri.fsPath);
      // MVP: don't auto-rerun; just flag that the cached map is now suspect.
      markStale(`saved ${vscode.workspace.asRelativePath(doc.uri)}`);
    }),
  );
}

export function deactivate(): void {
  // nothing yet
}
