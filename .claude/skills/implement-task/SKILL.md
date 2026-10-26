---
name: implement-task
description: Implement one task from docs/tasks.md by its ID (e.g. /implement-task T014), test-first, verified, and committed.
disable-model-invocation: true
---
Implement task $ARGUMENTS from `docs/tasks.md`.

1. Find the task block for $ARGUMENTS in `docs/tasks.md`. If any task it depends on is not ticked, stop and say which.
2. Read only the spec sections the task lists under "Refs" (prd.md, technical-spec.md, openapi.yaml). Do not read the whole of every doc.
3. In 3–8 bullets, state what you will change: files, functions, tests. Note anything the specs leave unclear. If something is unclear and affects business behaviour, stop and ask instead of guessing.
4. Write the tests listed under "Tests" first. Run them and confirm they fail for the right reason.
5. Implement the smallest change that satisfies the task and the referenced FR/BR/AC IDs. Stay inside the task's scope.
6. Run the task's "Verify" command(s). Paste the relevant output. Iterate until green. Never delete, skip or loosen a test to get green; if a test seems wrong, explain why and ask.
7. Check the result against the task's "Done when" list item by item and report each as met / not met.
8. Mark $ARGUMENTS done in `docs/tasks.md` by changing its heading from `### [ ]` to `### [x]`. If you made a decision the specs did not cover, add one line to `docs/ai-workflow.md` → "Decisions made during implementation".
9. Commit: `<type>(<scope>): $ARGUMENTS <short summary>` (Conventional Commits). One task per commit.
