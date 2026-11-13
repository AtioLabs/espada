# ESPADA execution plan (all phases, today)

Vision: a crew of agents, each owned by one human, that hand off work across machines. Humans step in only for what matters.
Differentiator vs ClawBus / agent-msgbus / agmsg / A2A: **cross-owner trust** (approvals, sharing limits, verified answers, injection resistance), not the message bus.

## What the research decided
| Finding | Decision |
|---|---|
| Custom channels need `--dangerously-load-development-channels server:<name>`, server in `.mcp.json`; ignored with `-p`; blocked silently if org has Channels off (Team/Enterprise Owner must enable) | Phase 0: Owner toggle + documented launch path + pull mode fallback |
| Channel push is a research preview and may change | Pull mode is a permanent, first-class mode, not a stopgap |
| Tailscale = stable private address, tunnels change URL each restart | Phase 1: Tailscale |
| Permission relay exists for channels (`claude/channel/permission`) | Phase 4: approve risky tool calls from the ESPADA page |
| Peers exist; plain bus is commodity | Invest in trust + crew behaviour, not transport |

## Who does what (humans are the bottleneck, plan around them)
- **Asrul:** ask Naveen to enable Channels; install Tailscale; close old Claude windows (folder move); run `share-host`/`host`.
- **Naveen:** enable Channels in the org; install Tailscale on Mac; run `join-mac.command` once.
- **Claude (me):** all code, scripts, docs, tests, repo.

## Phase 0: unblock the channel  (owner: Naveen toggle; Claude: code)
- [x] Pull mode: server reports `pull` state, UI shows "Ready (pull mode)", workspace tells agent to poll `group_unread`.
- [x] `attach` + `espada.cmd/.sh` using documented `.mcp.json` path.
- [ ] Naveen enables Channels (claude.ai, Organization settings, Claude Code, Channels).
- [ ] Verify protocol revision negotiated by our bundle (docs: revision `2026-07-28` fails on v2 runtime). Pin SDK, rebuild, retest.
- [ ] Known-good control: run Anthropic's fakechat channel to separate account problems from our bugs.
- **Done when:** banner shows `Channels ... server:agentgroups` AND page shows "Ready" (not pull) after a check, in a real interactive session.

## Phase 1: stable connection  (owner: both install; Claude: scripts)
- [ ] Both install Tailscale and join one tailnet.
- [ ] `host` binds to the Tailscale address; connect files rewritten once with `--public-url http://<tailscale-name>:8787`.
- [ ] Remove tunnel from the normal path (keep `share-host` as fallback).
- **Done when:** restart the host and Naveen reconnects with no new file.

## Phase 2: one click  (Claude)
- [x] `join-mac.command`, `join-windows.cmd`, `attach`, `espada.*`.
- [ ] `doctor` names the exact failing step (server, token, claude version, login type hint, channel registered, pull state) and prints the fix.
- [ ] `join-mac.command` runs doctor automatically and stops with a readable message.
- **Done when:** a fresh Mac goes from `git clone` to a working session with one double-click and the three Claude prompts.

## Phase 3: crew behaviour  (Claude)
- [x] Callsigns, tags, handoff format (`AGENT-BEHAVIOUR.md`).
- [ ] **Missions:** a mission has an id, objective, hop budget, token/time budget. Replaces the flat "6 agent messages" loop guard with a per-mission budget; humans can top up.
- [ ] **Crew ledger:** server keeps who-owns-what and in-flight missions; `group_crew` tool returns it; page shows it.
- **Done when:** two agents finish a multi-step mission unattended and stop cleanly at budget.

## Phase 4: commander approvals only when it matters  (Claude, needs Phase 0 working)
- [ ] Declare `claude/channel/permission` only after senders are authenticated (they are: token-based).
- [ ] Relay tool-approval requests to the owner's ESPADA page; approve/deny buttons post the verdict back.
- [ ] Per-owner policy: which tools may auto-approve.
- **Done when:** a tool request from the agent appears on the page and approving it unblocks the agent.

## Phase 5: trust  (Claude)
- [ ] Per-agent permission profiles, audit log (append-only, exportable), rate and size limits already exist.
- [ ] Optional A2A mapping of handoff states (submitted/working/completed/failed).
- **Done when:** every approval, share and denial is in the audit log with who/when/what.

## Test gates (run before calling anything done)
1. `npm test` green (needs `npm install`).
2. Interactive channel session confirms (Phase 0 gate).
3. Two real machines exchange a mission over Tailscale.
4. Injection check: a hostile message from the other owner does not make the agent reveal files or run commands.

## Risks
- Channels are a research preview; flags and behaviour may change. Pull mode keeps us alive.
- Team org policy is outside our control.
- Nothing has been run on a real Mac.
- Tokens live in plain files per user account; two owners on one account is not a security boundary.
