# Data Wars project rules

- Repository: https://github.com/ereztdev/data-wars
- The user requires Git tags for project versions. Use semantic tags `vMAJOR.MINOR.PATCH`, for example `v1.3.0` and the next planned patch `v1.3.1`.
- Keep VERSION and release documentation consistent. Each completed release commit must have its matching immutable version tag. Never move or overwrite a published tag.
- The version-tags workflow creates the tag for a main-branch VERSION change. Verify the remote tag points at the intended release commit before reporting completion.
- `site/` is the authoritative deployed v1.3.0 runtime snapshot. The earlier root Vite entry and `src/` are preserved historical development sources and do not reproduce the current deployed game. Do not deploy their build as the current game until reconciled.
- Preserve existing saves and test migrations, reservations, graph references, and deterministic simulation continuation when gameplay changes.
- v1.3.1 requests in docs/roadmap.md are pending design work. Do not represent them as implemented or deploy them without an instruction to execute.
- Use AgentInboxPro only at the end when ready to deploy. A repository commit is not itself authorization for a website redeployment.
- Track exact token usage when exposed; otherwise state that exact usage is unavailable. Do not invent billed token counts.
