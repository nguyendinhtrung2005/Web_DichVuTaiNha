
# CleanHome - Project Instructions

## Project structure
- frontend/: New CleanHome frontend (Next.js, React, TypeScript).
- frontend/apps/customer/: Customer website.
- frontend/apps/staff/: Staff website.
- frontend/apps/admin/: Admin dashboard.
- frontend/packages/: Shared frontend packages.
- frontend-legacy/: Previous Vite/React frontend.
- backend/: Existing backend services.
- databases/: Database resources.

## Development rules
- Communicate with the user in Vietnamese.
- Only inspect files relevant to the current task.
- Do not scan the entire repository for simple changes.
- Do not modify backend or databases for frontend-only tasks.
- Preserve existing functionality and architecture.
- Reuse existing components before creating new ones.
- Never modify node_modules, .next, dist or build outputs.
- Do not add dependencies unless necessary.
- Never expose secrets or credentials.
- Never run destructive commands without approval.
- Do not commit, push, or change Git branches automatically.

## Working process
1. Identify relevant files.
2. Briefly explain the proposed solution.
3. For complex or high-risk changes, obtain approval before editing.
4. Make the smallest necessary changes.
5. Run relevant checks if available.
6. Report changed files, test results and remaining issues.

## Efficiency
- Prefer concise responses.
- Avoid unnecessary web searches.
- Avoid repeating project analysis in every task.
- Do not run all services unless required.
- Do not refactor unrelated code.

For backend tasks, also read `BACKEND_TEAM_RULES.md` at the repository root.
