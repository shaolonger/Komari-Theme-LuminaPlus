# Homepage Multi-Ping Phase 2 TODO

Scope: second-stage upgrade after v1.11.0. Phase 1 made multi-task homepage Ping bindings possible and compactly aggregated them on node cards. Phase 2 makes the result explainable and easier to operate: users should be able to understand which Ping tasks contribute to a VPS, spot missing or weak sources, and manage bindings from a VPS-first perspective without changing the persisted settings shape.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, committed, and then marked complete before moving on.

## Product Decisions

- Keep `homepagePingBindings: Record<taskId, nodeUuid[]>` as the only persisted data structure.
- Keep homepage cards compact; deeper multi-task explanation belongs in details, settings, and tooltips.
- Use worst-first operational semantics consistently: highest current latency and highest loss are the aggregate signals, while per-source details explain why.
- Avoid automatic Ping-task creation or background mutation. Users explicitly bind existing tasks only.

## Tasks

- [x] Create this Phase 2 TODO with product decisions, acceptance criteria, and recovery instructions.
- [ ] Add reusable multi-Ping insight helpers for source status, labels, counts, and worst-source explanation.
- [ ] Upgrade instance details with a Ping source panel showing all bound homepage Ping tasks for the VPS.
- [ ] Upgrade theme settings with a VPS-first binding overview so users can audit multi-task assignments quickly.
- [ ] Update workbench/detail binding checks to use multi-task helpers and improve Ping health wording for multiple sources.
- [ ] Add targeted tests for source insight helpers, settings overview data, instance/workbench wording, and multi-task binding checks.
- [ ] Run browser smoke verification for Phase 2 routes and record local limitations.
- [ ] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.

## Acceptance Criteria

- A VPS bound to multiple Ping tasks can be understood from the instance detail page without opening theme settings.
- Theme settings expose a VPS-first overview with bound task counts and task names.
- Multi-task aggregate health explains the contributing source count and no-sample sources where possible.
- Existing single-task behavior remains unchanged.
- Tests and package build pass before release.
