---
name: validate-change
description: Choose focused validation for the current repository changes
agent: agent
---

Validate the current changes with the smallest checks that adequately cover them.

1. Inspect `git status --short` and staged/unstaged diff summaries first. Establish the requested scope; do not attribute existing worktree changes to the current task. Review the scoped diff and relevant untracked files.
2. Read root `AGENTS.md` and only the folder-specific guidance relevant to changed paths. Consult `VALIDATION.md` for the applicable command profile.
3. Select checks based on changed behavior. Prefer repository scripts and focused test-name filters; do not run the full suite or scan unrelated subsystems unless the change is broad, cross-cutting, or focused checks reveal a reason to escalate.
4. Avoid direct root Vitest paths for API tests because generated copies in `infra/cdk.out` may be discovered. Use the scoped scripts documented in `VALIDATION.md`.
5. Run the selected checks, observe their exit codes and output, and fix failures caused by this change. Do not make unrelated cleanup changes.
6. Report exactly which commands passed or failed, what was not run and why, and separate pre-existing findings from new failures. A changed-file check does not make a failing full lint pass.

Reuse guidance and validation evidence already available in this conversation when it still applies to the current file versions. Do not reread unchanged files or rerun successful checks without a relevant subsequent change. Inspect dependencies only when needed to understand impact or diagnose a failure; read bounded sections rather than whole subsystems. Do not label an error as pre-existing solely because its file is unchanged.

Do not install dependencies, reset databases, import data into a configured database, or run cloud deployment/bootstrap commands unless the task explicitly requires it and the user has authorized the target and action.
