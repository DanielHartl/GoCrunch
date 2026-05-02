import * as fs from 'fs';
import * as path from 'path';

export interface TestLocation {
  filePath: string;
  line: number;
  character: number;
}

const TEST_FUNC_RE = /^func\s+(Test\w+)\s*\(/dgm;

/**
 * Locates Go test function definitions on disk. Scans `<packageDir>/*_test.go`
 * lazily and caches results per package dir. Subtest names like `TestX/case_1`
 * resolve to the parent `TestX` function.
 */
export class TestLocator {
  private readonly cache = new Map<string, Map<string, TestLocation>>();

  async find(packageDir: string, testName: string): Promise<TestLocation | undefined> {
    const key = path.normalize(packageDir);
    let pkgIndex = this.cache.get(key);
    if (!pkgIndex) {
      pkgIndex = await this.scan(key);
      this.cache.set(key, pkgIndex);
    }
    const root = testName.split('/')[0];
    return pkgIndex.get(root);
  }

  invalidate(filePath: string): void {
    if (!filePath.endsWith('_test.go')) {
      return;
    }
    this.cache.delete(path.normalize(path.dirname(filePath)));
  }

  clear(): void {
    this.cache.clear();
  }

  private async scan(packageDir: string): Promise<Map<string, TestLocation>> {
    const index = new Map<string, TestLocation>();
    let entries: string[];
    try {
      entries = await fs.promises.readdir(packageDir);
    } catch {
      return index;
    }
    for (const name of entries) {
      if (!name.endsWith('_test.go')) {
        continue;
      }
      const filePath = path.join(packageDir, name);
      let text: string;
      try {
        text = await fs.promises.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(TEST_FUNC_RE)) {
        const indices = match.indices?.[1];
        if (!indices) {
          continue;
        }
        const [start] = indices;
        const { line, character } = offsetToPosition(text, start);
        // First occurrence wins — duplicates would be a build error anyway.
        if (!index.has(match[1])) {
          index.set(match[1], { filePath, line, character });
        }
      }
    }
    return index;
  }
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}
