import * as fs from 'fs';
import * as path from 'path';
import { CoverageProfile, allLines } from '../goTest/coverage';

export interface LineInfo {
  executable: boolean;
  // Set true if any single test's profile shows this line as both covered and
  // uncovered (multiple blocks on the same line). Drives the yellow partial bar.
  mixed: boolean;
  coveredBy: Set<string>;
  // Subset of coveredBy whose last run failed. Any non-empty value flips the
  // line to the "failing" decoration regardless of other coverage.
  failingBy: Set<string>;
}

export interface CacheShape {
  version: 2;
  files: Record<
    string,
    Record<
      string,
      { executable: boolean; mixed: boolean; coveredBy: string[]; failingBy?: string[] }
    >
  >;
}

export class CoverageStore {
  private readonly files = new Map<string, Map<number, LineInfo>>();

  getFile(absPath: string): Map<number, LineInfo> | undefined {
    return this.files.get(normalize(absPath));
  }

  testsCovering(absPath: string, line: number): string[] {
    const info = this.files.get(normalize(absPath))?.get(line);
    return info ? [...info.coveredBy] : [];
  }

  clearTest(testName: string): void {
    for (const lines of this.files.values()) {
      for (const info of lines.values()) {
        info.coveredBy.delete(testName);
        info.failingBy.delete(testName);
      }
    }
  }

  clear(): void {
    this.files.clear();
  }

  /**
   * Merge a single test's coverprofile. Re-records every executable line in
   * the profile and adds testName to the covering set for lines the test hit.
   * importPathToDir maps the package import path prefix (e.g. example.com/sample)
   * to its absolute directory.
   */
  recordCoverage(
    testName: string,
    profile: CoverageProfile,
    importPathToDir: Map<string, string>,
    passed: boolean,
  ): void {
    this.clearTest(testName);
    for (const [profilePath, blocks] of profile) {
      const abs = resolveProfilePath(profilePath, importPathToDir);
      if (!abs) {
        continue;
      }
      const norm = normalize(abs);
      let lineMap = this.files.get(norm);
      if (!lineMap) {
        lineMap = new Map();
        this.files.set(norm, lineMap);
      }
      for (const { line, covered, mixed } of allLines(blocks)) {
        let info = lineMap.get(line);
        if (!info) {
          info = {
            executable: true,
            mixed: false,
            coveredBy: new Set(),
            failingBy: new Set(),
          };
          lineMap.set(line, info);
        } else {
          info.executable = true;
        }
        if (mixed) {
          info.mixed = true;
        }
        if (covered) {
          info.coveredBy.add(testName);
          if (!passed) {
            info.failingBy.add(testName);
          }
        }
      }
    }
  }

  serialize(): CacheShape {
    const files: CacheShape['files'] = {};
    for (const [filePath, lineMap] of this.files) {
      const lines: CacheShape['files'][string] = {};
      for (const [line, info] of lineMap) {
        lines[String(line)] = {
          executable: info.executable,
          mixed: info.mixed,
          coveredBy: [...info.coveredBy],
          failingBy: [...info.failingBy],
        };
      }
      files[filePath] = lines;
    }
    return { version: 2, files };
  }

  load(data: CacheShape): void {
    this.clear();
    if (!data || data.version !== 2 || !data.files) {
      return;
    }
    for (const [filePath, lines] of Object.entries(data.files)) {
      const lineMap = new Map<number, LineInfo>();
      for (const [lineStr, info] of Object.entries(lines)) {
        lineMap.set(Number(lineStr), {
          executable: info.executable,
          mixed: Boolean(info.mixed),
          coveredBy: new Set(info.coveredBy),
          failingBy: new Set(info.failingBy ?? []),
        });
      }
      this.files.set(filePath, lineMap);
    }
  }

  async saveTo(cachePath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.promises.writeFile(cachePath, JSON.stringify(this.serialize(), null, 2), 'utf8');
  }

  async loadFrom(cachePath: string): Promise<boolean> {
    try {
      const text = await fs.promises.readFile(cachePath, 'utf8');
      this.load(JSON.parse(text) as CacheShape);
      return true;
    } catch {
      return false;
    }
  }

  filesCovered(): string[] {
    return [...this.files.keys()];
  }
}

function normalize(p: string): string {
  return path.normalize(p);
}

/**
 * Coverprofile entries look like "example.com/sample/math.go". Find the longest
 * import path prefix in the registry, then join its dir with the remaining
 * components.
 */
function resolveProfilePath(
  profilePath: string,
  importPathToDir: Map<string, string>,
): string | undefined {
  const parts = profilePath.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const importPath = parts.slice(0, i).join('/');
    const dir = importPathToDir.get(importPath);
    if (dir) {
      return path.join(dir, ...parts.slice(i));
    }
  }
  return undefined;
}
