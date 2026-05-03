import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface TestRunResult {
  testName: string;
  packageDir: string;
  passed: boolean;
  output: string;
  // Concatenated `output` events plus stderr — populated for failing runs so
  // the hover "output" link can show the stack trace / failure message.
  failureOutput?: string;
  coverProfilePath?: string;
  durationMs: number;
}

interface GoTestEvent {
  Time?: string;
  Action: 'start' | 'run' | 'pass' | 'fail' | 'skip' | 'output' | 'pause' | 'cont' | 'bench';
  Package?: string;
  Test?: string;
  Output?: string;
  Elapsed?: number;
}

export interface RunOptions {
  goPath: string;
  timeoutSec: number;
  // Empty string disables cross-package attribution. Otherwise passed verbatim
  // to `go test -coverpkg`. When non-empty, the test runs from the module root
  // so patterns like "./..." mean "every package in the module".
  coverPkg: string;
  channel: vscode.OutputChannel;
}

export interface TestEnumeration {
  packageDir: string;
  packageImportPath: string;
  tests: string[];
}

export async function listAllTests(
  workspaceDir: string,
  opts: RunOptions,
): Promise<TestEnumeration[]> {
  const goListResult = await runGoCommand(
    opts.goPath,
    ['list', '-f', '{{.Dir}}\t{{.ImportPath}}', './...'],
    workspaceDir,
    opts.channel,
  );
  if (goListResult.exitCode !== 0) {
    throw new Error(`go list failed: ${goListResult.stderr.trim() || goListResult.stdout.trim()}`);
  }

  const enumerations: TestEnumeration[] = [];
  for (const line of goListResult.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [dir, importPath] = trimmed.split('\t');
    if (!dir) {
      continue;
    }
    const listResult = await runGoCommand(
      opts.goPath,
      ['test', '-list', '.*', '.'],
      dir,
      opts.channel,
    );
    if (listResult.exitCode !== 0) {
      // packages without _test.go return non-zero with "no test files" — skip silently
      continue;
    }
    const tests: string[] = [];
    for (const ln of listResult.stdout.split(/\r?\n/)) {
      const t = ln.trim();
      if (/^Test\w+$/.test(t)) {
        tests.push(t);
      }
    }
    if (tests.length > 0) {
      enumerations.push({ packageDir: dir, packageImportPath: importPath ?? dir, tests });
    }
  }
  return enumerations;
}

export async function runSingleTest(
  packageDir: string,
  testName: string,
  opts: RunOptions,
): Promise<TestRunResult> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gocrunch-'));
  const coverFile = path.join(tmpDir, 'cover.out');

  // With -coverpkg the pattern is interpreted relative to cwd, so we run from
  // the module root and target the test package via its relative path. Without
  // it, the historical behaviour (cwd=packageDir, target=".") is preserved.
  let cwd = packageDir;
  let target = '.';
  if (opts.coverPkg) {
    const moduleRoot = await findModuleRoot(packageDir, opts);
    if (moduleRoot && moduleRoot !== packageDir) {
      const rel = path.relative(moduleRoot, packageDir).split(path.sep).join('/');
      cwd = moduleRoot;
      target = rel ? `./${rel}` : './';
    }
  }

  const args = [
    'test',
    '-run',
    `^${escapeRegex(testName)}$`,
    '-count=1',
    '-coverprofile',
    coverFile,
    '-covermode=set',
    ...(opts.coverPkg ? ['-coverpkg', opts.coverPkg] : []),
    '-json',
    `-timeout=${opts.timeoutSec}s`,
    target,
  ];

  const start = Date.now();
  const result = await runGoCommand(opts.goPath, args, cwd, opts.channel);
  const durationMs = Date.now() - start;

  let passed = result.exitCode === 0;
  let sawTerminalEvent = false;
  const outputChunks: string[] = [];
  const events = parseJsonEvents(result.stdout);
  for (const ev of events) {
    if (ev.Test === testName && (ev.Action === 'pass' || ev.Action === 'fail')) {
      sawTerminalEvent = true;
      if (ev.Action === 'fail') {
        passed = false;
      }
    }
    if (ev.Action === 'output' && ev.Output) {
      opts.channel.append(ev.Output);
      outputChunks.push(ev.Output);
    }
  }
  if (result.stderr) {
    opts.channel.append(result.stderr);
  }
  // Non-zero exit with no pass/fail event = build error or panic outside the
  // test body. Surface it explicitly so callers don't silently report a "fail".
  if (!sawTerminalEvent && result.exitCode !== 0) {
    passed = false;
    opts.channel.appendLine(
      `[BUILD/SETUP ERROR] go test exited ${result.exitCode} without a pass/fail for ${testName}`,
    );
  }

  let coverProfilePath: string | undefined;
  if (await pathExists(coverFile)) {
    coverProfilePath = coverFile;
  }

  let failureOutput: string | undefined;
  if (!passed) {
    const parts = [outputChunks.join('')];
    if (result.stderr) {
      parts.push(result.stderr);
    }
    failureOutput = parts.join('').trim() || `(no output captured; exit code ${result.exitCode})`;
  }

  return {
    testName,
    packageDir,
    passed,
    output: result.stdout,
    failureOutput,
    coverProfilePath,
    durationMs,
  };
}

interface ProcResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runGoCommand(
  goPath: string,
  args: string[],
  cwd: string,
  channel: vscode.OutputChannel,
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    channel.appendLine(`> ${goPath} ${args.join(' ')}  (cwd=${cwd})`);
    const proc = spawn(goPath, args, { cwd, shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (b: Buffer) => stdout.push(b));
    proc.stderr.on('data', (b: Buffer) => stderr.push(b));
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find Go binary "${goPath}". Set gocrunch.goPath or add it to PATH.`,
          ),
        );
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function parseJsonEvents(stdout: string): GoTestEvent[] {
  const events: GoTestEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as GoTestEvent);
    } catch {
      // ignore malformed lines (e.g. compile errors interleaved)
    }
  }
  return events;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const moduleRootCache = new Map<string, string | null>();

/**
 * Resolve the module root for a given package dir via `go env GOMOD`. Returns
 * undefined for packages outside any module (legacy GOPATH or transient errors).
 * Cached per-dir for the lifetime of the extension host.
 */
async function findModuleRoot(packageDir: string, opts: RunOptions): Promise<string | undefined> {
  const cached = moduleRootCache.get(packageDir);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  try {
    const res = await runGoCommand(opts.goPath, ['env', 'GOMOD'], packageDir, opts.channel);
    if (res.exitCode !== 0) {
      moduleRootCache.set(packageDir, null);
      return undefined;
    }
    const gomod = res.stdout.trim();
    // Outside a module: "" on Unix, "NUL" on Windows, "/dev/null" elsewhere, or "off".
    if (!gomod || gomod === 'NUL' || gomod === '/dev/null' || gomod === 'off') {
      moduleRootCache.set(packageDir, null);
      return undefined;
    }
    const root = path.dirname(gomod);
    moduleRootCache.set(packageDir, root);
    return root;
  } catch {
    moduleRootCache.set(packageDir, null);
    return undefined;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}
