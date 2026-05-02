import * as fs from 'fs';

export interface CoverageBlock {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  numStatements: number;
  count: number;
}

export type CoverageProfile = Map<string, CoverageBlock[]>;

const BLOCK_RE = /^(.+?):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)\s*$/;

export function parseCoverProfile(text: string): CoverageProfile {
  const out: CoverageProfile = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('mode:')) {
      continue;
    }
    const m = BLOCK_RE.exec(line);
    if (!m) {
      continue;
    }
    const [, file, sl, sc, el, ec, n, cnt] = m;
    const block: CoverageBlock = {
      startLine: Number(sl),
      startCol: Number(sc),
      endLine: Number(el),
      endCol: Number(ec),
      numStatements: Number(n),
      count: Number(cnt),
    };
    let arr = out.get(file);
    if (!arr) {
      arr = [];
      out.set(file, arr);
    }
    arr.push(block);
  }
  return out;
}

export async function readCoverProfile(profilePath: string): Promise<CoverageProfile> {
  const text = await fs.promises.readFile(profilePath, 'utf8');
  return parseCoverProfile(text);
}

export function* coveredLines(blocks: CoverageBlock[]): Generator<number> {
  for (const b of blocks) {
    if (b.count === 0) {
      continue;
    }
    for (let line = b.startLine; line <= b.endLine; line++) {
      yield line;
    }
  }
}

export function* allLines(
  blocks: CoverageBlock[],
): Generator<{ line: number; covered: boolean; mixed: boolean }> {
  // For each line, track whether any block was covered and whether any was uncovered.
  // mixed = both seen on the same line within this single profile.
  const sawCovered = new Set<number>();
  const sawUncovered = new Set<number>();
  for (const b of blocks) {
    const covered = b.count > 0;
    for (let line = b.startLine; line <= b.endLine; line++) {
      if (covered) {
        sawCovered.add(line);
      } else {
        sawUncovered.add(line);
      }
    }
  }
  const allLineNumbers = new Set<number>([...sawCovered, ...sawUncovered]);
  for (const line of allLineNumbers) {
    const covered = sawCovered.has(line);
    const uncovered = sawUncovered.has(line);
    yield { line, covered, mixed: covered && uncovered };
  }
}
