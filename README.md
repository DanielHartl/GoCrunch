# GoCrunch

Continuous-test-style coverage and CodeLens for Go inside VS Code, inspired by NCrunch.

## What it does (MVP)

- **CodeLens** above every `func TestXxx(t *testing.T)`: `▶ run test` and `🐞 debug test`.
- **Gutter bars** in production code:
  - Green — line is covered by at least one test.
  - Red — line is executable but no test reached it.
  - Yellow — partially covered (some blocks on the line are hit, others aren't).
  - Bright red + faint line-background tint — at least one **failing** test runs through this line. This preempts the green/yellow/dim-red states so a regression is impossible to miss.
- **Hover on a covered line** lists every test that hits the line, sorted failing-first:
  - `$(error)` for failing tests (bold name), `$(pass)` for passing.
  - Click the test name to jump straight to its `func TestXxx` definition.
  - `[run]` · `[debug]` command links per test.
  - `[output]` link on failing tests opens the captured stdout + stderr in a side panel; any `file.go:NN` references in the trace are clickable and jump to that file/line.
- **Status bar** shows the most recent run result and a `⚠ stale` glyph after a save until you refresh.
- **Run All / Refresh** runs every test individually so each one's `-coverprofile` can be attributed back to its lines.
- **Cross-package attribution**: by default each test is instrumented with `-coverpkg=./...`, so a test in package A can light up coverage for source in package B (controllable via `gocrunch.coverPkg`).

## Requirements

- Go 1.21+ on your `PATH` (or set `gocrunch.goPath`).
- The official [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.Go) — GoCrunch declares it as an `extensionDependencies` entry and uses its debug adapter.

## Settings

| Key | Default | Purpose |
|---|---|---|
| `gocrunch.goPath` | `go` | Go binary used for `go test` / `go list`. |
| `gocrunch.testTimeout` | `60` | Per-test timeout in seconds (`-timeout=Ns`). |
| `gocrunch.coverPkg` | `./...` | Value passed to `go test -coverpkg`. The default instruments every package in the module so a test in package A can attribute coverage to source in package B. Set to `""` to disable cross-package attribution (faster, smaller profiles). When non-empty, GoCrunch resolves the module root via `go env GOMOD` and runs `go test` from there so `./...` means "every package in the module". |
| `gocrunch.autoRunOnSave` | `false` | Reserved for post-MVP auto re-run. |

## Install (local)

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host. Open `testdata/sample-project` (or any Go module) in the new window. On first activation GoCrunch offers to build the initial coverage map; accepting runs every test in the workspace once.

For local install of a packaged version: `npx vsce package` produces `gocrunch-<version>.vsix`, which `code --install-extension` accepts.

## Limitations (MVP)

- Every test is run separately to attribute coverage. This is intentionally slow; incremental selection and live re-running are post-MVP.
- Subtests (`t.Run`) don't get their own CodeLens yet.
- Test discovery is regex-based; non-standard test signatures may be missed.
