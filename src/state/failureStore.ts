import * as path from 'path';
import * as vscode from 'vscode';

export interface FailureRecord {
  testName: string;
  packageDir: string;
  output: string;
  durationMs: number;
  timestamp: number;
}

interface FailureKey {
  packageDir: string;
  testName: string;
}

/**
 * In-memory cache of the most recent captured failure output per
 * (packageDir, testName). Cleared on window reload — failure output is
 * intentionally not persisted; callers re-run the test if they need it back.
 */
export class FailureStore {
  private readonly _onChange = new vscode.EventEmitter<FailureKey>();
  readonly onChange = this._onChange.event;
  private readonly map = new Map<string, FailureRecord>();

  static key(packageDir: string, testName: string): string {
    return `${path.normalize(packageDir)}::${testName}`;
  }

  set(rec: FailureRecord): void {
    this.map.set(FailureStore.key(rec.packageDir, rec.testName), rec);
    this._onChange.fire({ packageDir: rec.packageDir, testName: rec.testName });
  }

  get(packageDir: string, testName: string): FailureRecord | undefined {
    return this.map.get(FailureStore.key(packageDir, testName));
  }

  delete(packageDir: string, testName: string): void {
    if (this.map.delete(FailureStore.key(packageDir, testName))) {
      this._onChange.fire({ packageDir, testName });
    }
  }

  clear(): void {
    this.map.clear();
  }
}
