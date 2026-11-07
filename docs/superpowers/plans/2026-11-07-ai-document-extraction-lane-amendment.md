# AI extraction implementation-lane amendment

On 2026-11-07 the project manager conveyed Waleed's explicit instruction: "USE MINIMAX 3.1 CODING". This replaces the Cursor Grok implementation lane for remaining tasks in the approved 18-task plan, starting with Task 4. It does not change the approved specification, task scopes, acceptance criteria, or terminal state.

- Implementation provider: `acpRegistry_minimax_code` (MiniMax Code).
- Exact model: `m:minimax:MiniMax-M3.1-Flash:v:`.
- Option: `thinkingEffort=medium`, preserving the selected implementation effort.
- Live capability lookup in the owning session advertises this exact model and option. Lookup is not proof of a completed model run.
- Tests remain Antigravity Gemini 3.8 Flash high (`gemini-3.8-flash`, `thinking_level=high` in the current catalog).
- SQL, review, integration and local commits remain owned by the parent session.
- The earlier Cursor Task 4 run failed for quota before writing changes. Its clean worktree is preserved; no active run needs cancellation.
- Resume from foundation `3b03cc59d25984d04944df24b059260b349d2cf4`, retaining the independent mobile fix and uncommitted red contracts.

When historical plan headings or copied briefs say "Grok", read their implementation-owner designation as the MiniMax lane above. All other verbatim global constraints remain in force. No automatic fallback is authorized if MiniMax is unavailable.

Completion remains reviewed local commits only. No push, PR, deployment, production migration, OCR inference (including synthetic external inference), credential access, activation, real messages, or cleanup is authorized.
