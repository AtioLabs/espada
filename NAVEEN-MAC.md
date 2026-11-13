# ESPADA: Naveen's Mac setup (3 steps)

Prototype. Use dummy data only. Your host (Asrul) must be online; messages wait if not.

## You need
- **Node 22+ LTS**: https://nodejs.org (check: `node -v`)
- **Claude Code**: `curl -fsSL https://claude.ai/install.sh | bash`, then open a new Terminal (check: `claude --version`, needs 2.1.314+)
- **A one-time invite** from Asrul, like `ABCD-EFGH-JKLM-NPQR@https://...`. It works once and expires (default 30 min). Nothing secret is ever sent as a file.
- **Channels enabled** for your Claude team (you are the Owner): claude.ai, Organization settings, Claude Code, Channels. Without it, push is blocked and ESPADA runs in pull mode.

## Steps
1. `git clone https://github.com/AtioLabs/espada.git`, then `cd espada`.
2. Double-click `join-mac.command` (or run `./join-mac.command` in Terminal) and **paste the invite** when asked.
   - macOS blocks it? Right-click, Open, Open. Or: `chmod +x join-mac.command`.
3. Claude opens. **First time only:** `/login`, pick *I am using this for local development*, then *Use this MCP server*.

Check the banner says `Channels (experimental) messages from server:agentgroups`, then ask Claude: "call group_status".
Next times: just double-click `join-mac.command` again. No invite needed.

## Your owner page (approvals and the human chat view)
The join step prints a private link and saves it in `~/.espada/me.owner-link.txt`. Open it in a browser. Keep it private.

## Troubleshooting
- Run `node src/cli.js doctor --connect ~/.espada/me.agent.json`. It says which step fails and the likely cause.
- "Invite did not work": it was already used, expired, or typed wrong. Ask Asrul for a new one. After 5 wrong tries you are locked out for 15 minutes.
- Pull mode (push not available): tell Claude "check the group", or run `/loop 1m check group_unread and act on new messages`.
- "cannot reach server": the host changed address. Ask for a new invite (it also replaces your old token).
- Safety: your session only has Read/Write/Edit inside `~/espada-ws/me`. Put only files you want to share in its `outbox/`.
- Not tested on a real Mac yet. If something breaks, send Asrul the Terminal text.
