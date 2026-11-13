# ESPADA roadmap

Goal: a crew of agents, each owned by one human, that hand off work across machines with the humans in the loop only where it matters.

## Research summary (Nov 2026)
- Claude Code **channels** are a research preview. A custom channel needs `--dangerously-load-development-channels server:<name>` with the server defined in `.mcp.json` (docs: code.claude.com/docs/en/channels-reference). The dev flag is ignored in `-p` mode. If channels are disabled for the account, the server connects and tools work but events are dropped silently. **Team/Enterprise orgs: an Owner must enable Channels.** Login must be claude.ai or Console API key.
- Peer projects exist (ClawBus, agent-msgbus, agmsg, agent-group-mcp, Anthropic's multi-agent patterns, A2A at the Linux Foundation). A generic message bus is not our differentiator. **Cross-owner trust (approvals, sharing limits, verified answers) is.**
- Tailscale gives a stable private address; Cloudflare quick tunnels change address on every restart.

## Phases
0. **Unblock the channel.** Owner enables Channels; test documented `.mcp.json` path; verify protocol revision; ship **pull mode** (done) as fallback.
1. **Stable connection.** Tailscale for both machines, one fixed address, no tunnel windows.
2. **One click.** `join-mac.command` / `join-windows.cmd` / `attach` (done, untested on a real Mac) plus a doctor that names the exact failing step.
3. **Crew behaviour.** Callsigns, structured handoffs, missions with a hop and token budget instead of a flat loop guard, a crew ledger of in-flight work.
4. **Commander approvals only when it matters.** Use the documented channel permission relay so risky tool calls can be approved from the ESPADA page. Requires authenticated senders.
5. **Trust.** Per-agent permission profiles, audit log, optional A2A mapping.

## Status
Done: pull mode, attach/espada launchers, composer typing fix, join scripts, behaviour protocol.
Unverified: anything on a real Mac, real channel push, `cloudflared` on Mac.
