# Project: Garuda Our Guardian

## Git Branching Conventions

- **Integration branch**: `anoop.kp/master` — the central branch all feature work merges into.
- **Feature branches**: always named `anoop.kp/<feature-name>` (e.g. `anoop.kp/add-login`, `anoop.kp/fix-auth`).
- All feature branches **must be branched off** `anoop.kp/master`.
- All feature branches **must be merged back into** `anoop.kp/master` when complete — never directly into `main` or any other branch.
- Never create bare branch names (e.g. `feature/foo` or `fix/bar`); the `anoop.kp/` prefix is mandatory.

## Git Worktrees

- Each Bob agent instance **must work in its own dedicated git worktree** inside this repository folder.
- Worktree branches follow the same naming convention: `anoop.kp/<agent-or-task-name>` (e.g. `anoop.kp/agent-ui`, `anoop.kp/agent-api`).
- Never share a worktree branch between two agents — one worktree per agent, always.
- Worktrees must be branched off `anoop.kp/master` before work begins.
- When an agent's task is complete, its worktree branch is merged into `anoop.kp/master` and the worktree can be removed.
- Worktree directories should live **within this repository folder** (e.g. `../garuda-worktrees/<agent-name>` or a `worktrees/` subdirectory at the repo root).
