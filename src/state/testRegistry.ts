/**
 * Maps a Go test name to the directory of the package that defines it.
 *
 * Needed because with cross-package coverage (`gocrunch.coverPkg`) a test in
 * package A can attribute coverage to source in package B. The hover for B's
 * line then needs A's package dir to run/debug/locate the test correctly.
 *
 * Populated from `go test -list` enumerations and from individual test runs.
 */
export class TestRegistry {
  private readonly map = new Map<string, string>();

  set(testName: string, packageDir: string): void {
    this.map.set(testName, packageDir);
  }

  get(testName: string): string | undefined {
    // Subtest names like TestX/case_1 share their parent's location.
    return this.map.get(testName) ?? this.map.get(testName.split('/')[0]);
  }

  populateFromEnumerations(enums: Array<{ packageDir: string; tests: string[] }>): void {
    for (const e of enums) {
      for (const t of e.tests) {
        this.map.set(t, e.packageDir);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
