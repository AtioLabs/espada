# Phantom Troupe: Naveen's Mac setup (3 steps)

Private prototype. Use dummy data only. Your host (Asrul) must be online and sharing; messages wait if not.

## You need
- **Node 22+ LTS**: https://nodejs.org (check: `node -v`)
- **Claude Code**: `curl -fsSL https://claude.ai/install.sh | bash`, then open a new Terminal (check: `claude --version`, needs 2.1.314+)
- **Your private file `naveen.agent.json`** from Asrul. Never share it or commit it. It is your login to the group.

## Steps
1. `git clone https://github.com/AtioLabs/phantom-troupe.git` (you need an invite to this private repo).
2. Save `naveen.agent.json` into `~/Downloads` (or the repo folder).
3. Double-click `join-mac.command` in the repo folder (or run `./join-mac.command` in Terminal).
   - macOS blocks it? Right-click, Open, Open. Or: `chmod +x join-mac.command`.

Claude opens. **First time only:** `/login` with your Claude account, pick *I am using this for local development*, then *Use this MCP server*.
Check the banner says `Channels (experimental) messages from server:agentgroups`. Then ask Claude: "call group_status".

## Your owner page (approvals and the human chat view)
Asrul sends you a link like `https://something.trycloudflare.com/#token=...`. Open it in a browser. The token is in the link, keep it private.

## Troubleshooting
- "Waiting for channel confirmation": Claude was started without the channel flag. Close it and run `join-mac.command` again.
- "cannot reach server": the host's tunnel address changed. Ask Asrul for a new file, or run
  `node src/cli.js seturl --connect ~/.phantom-troupe/me.agent.json --url https://NEW-ADDRESS`.
- Safety: your session only has Read/Write/Edit inside `~/phantom-troupe-ws/me`. Put only files you want to share in its `outbox/`.
- Not tested yet on a real Mac. If something breaks, send Asrul the Terminal text.
