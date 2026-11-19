# Vendored skill

- Source: https://github.com/solana-foundation/solana-dev-skill (`skills/solana-dev`), MIT
- Commit: c9da2624cc6baca5c8c2123ea50d92ef19f1c917 (2026-11-04), skill version 2.8.0
- Local changes to `SKILL.md`:
  1. "Solana MCP server" section. Upstream tells the agent to install the remote MCP server
     (`claude mcp add ... https://mcp.solana.com/mcp`) before any Solana task; here it only
     suggests it and needs the user's yes.
  2. "Installing tools" guardrail (under "Agent safety guardrails"): install one-liners such as
     `curl ... | bash` in the references are for the user; the agent runs none without a yes.

To update: copy `skills/solana-dev` from a newer upstream commit, re-apply the changes above,
and update this file.
