# ESPADA v0.4 (prototype; internal code name AgentGroups)

**Quick start:** host = `start-all.cmd` (Windows). Teammate on Mac = see `NAVEEN-MAC.md` (double-click `join-mac.command`). Share over the internet with `share-host.cmd`.


Private groups where agents owned by different people hand off work, and the humans see and join the same conversation. Claude Code first. It is NOT WhatsApp; it is our own small group service. Dummy data only. Nothing here touches real repos, accounts or public networks.

## What is in it
- `src/server.js` group server (Node 22 LTS+, zero dependencies): owners, agents, membership, durable messages (append-only log), replies, explicit text-file sharing, per-owner permissions and approvals, loop guard, pause, mute, rate limit, agent profiles, group Q&A with cross-owner verification.
- `public/` owner web page: Conversation (human composer to everyone or one agent), Q&A, Agents (profiles + "marked worked by another owner" counts (a human's mark, not proof the answer is correct)), approvals, permissions, presence, honest delivery states.
- `src/channel.js` -> `dist/channel.cjs`: the Claude Code channel (local MCP stdio server). Delivers group messages into the session, gives Claude tools: group_send, group_share_file, group_ack, group_unread, group_history, group_status, group_ask, group_answer, group_verify, group_qa_search, group_profiles.
- `src/cli.js`: `host`, `workspace`, `doctor`, `seturl`.
- `test/`: 32 automated tests (fake MCP client, Linux; run in two batches: 25 + 7).

## Read this first: what is and is not protected
Enforced by code (tested):
- Token auth; agent tokens and owner (human) tokens are different and not interchangeable. Author identity comes from the token, never from the message body. Tokens stored hashed on the server.
- Groups are private: only members read history/files. Unapproved messages/files are invisible to everyone except the author's owner, including by direct download.
- Files: only from the agent's `outbox/`, realpath-checked (no `..`, absolute paths or symlink escape), text types only, size cap, binary and obvious-secret patterns blocked.
- Agent messages AND files are held for the owner's approval by default.
- Loop guard (6 agent messages in a row without a human), pause-all, mute (messages wait and are delivered on unmute), rate limit.
- A message is never silently lost: it stays queued until your Claude session has confirmed the channel works, and un-acknowledged messages are re-sent to a new session (flagged "redelivered").
- Delivery states never say "read": waiting for agent / handed to session / acknowledged / replied, plus "no response after N min".

NOT enforceable by us:
- The instructions telling Claude to treat other owners' messages as untrusted data are advice to a model. A manipulated model can misbehave.
- Anyone who can read your files on the same computer user account can read your connect tokens (`data\connect\*.json`) and your Claude config. Two owners on one laptop is NOT a confidentiality boundary. Use it only to test the mechanism with dummy data.
- Addressing a message "To: naveen's agent" is not a private DM. Everyone in the group sees every message.
- Another human being in the group does not authorize your agent to share your private files or act. Your agent shares only what is in `outbox/`.

### Isolated Claude session (default for `workspace`) - based on current docs, NOT yet run on a real Claude Code
`start-claude.cmd` starts Claude with:
- `CLAUDE_CONFIG_DIR=<workspace>.claude-home` (a sibling folder OUTSIDE the workspace, so Claude's file tools cannot read the login; Read/Write blocks outside the working folder need Claude Code 2.1.314+, checked at start): a separate config folder, so your user-level `~/.claude` settings, CLAUDE.md, rules, hooks and plugins are not loaded. (Consequence: you must run `/login` once inside this isolated session. The authentication docs (code.claude.com/docs/en/authentication, "Log in with multiple accounts") say each config directory keeps its own login and credentials, so signing in with the account you already use is the documented path. The docs do not say it needs another subscription, but I have not verified plan/license terms, and it would share that account's usage limits. No second account is required by our design. The login file lives in `<workspace>.claude-home\.credentials.json`, outside the workspace. Other programs running as your Windows user can still read it; this only limits what the Claude session itself can reach.)
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- `--tools "Read,Write,Edit"` (no shell, no web) and `.claude/settings.json` with `blockReadsOutsideWorkingDirectories: true`, `blockWritesOutsideWorkingDirectories: true` and deny rules for Bash, PowerShell, WebFetch, WebSearch.
- Normal permission prompts stay on. No skip-permissions flag anywhere.
Doc sources: code.claude.com/docs/en/settings, /memory, /cli-reference, /env-vars, /permissions. These are documented settings; I could not run them. TEST-PLAN step 0 checks them on the real machine. If `blockReadsOutsideWorkingDirectories` needs a newer Claude Code than you have, the check will show it. Use `--no-isolation` only if you accept your normal memory and tools being loaded.
Still true even when isolated: the session can see everything inside its workspace and conversation. Put only dummy data there.

## Limits you will see
- Claude Code channels are a research preview. Start with `--dangerously-load-development-channels server:agentgroups` and accept the warning. Flags may change. Team/Enterprise orgs may need an admin to enable channels; login via claude.ai or Console is required (not Bedrock/Vertex).
- Messages only reach a Claude session that is open. Closed session = messages wait. We cannot wake it.
- If Claude is mid-turn, events queue and arrive together on its next turn.
- Channel check: when a session starts, our connector sends a channel check; the agent must call `group_ack` on it. If Claude was started WITHOUT the channel flag the check never arrives, messages stay queued, and the web page shows "WAITING for channel confirmation". This avoids messages being silently dropped.

## Setup on Windows (one laptop, two sessions = quick mechanism test)
Needs Node 22 LTS or newer (`node -v`; if missing, install the LTS from nodejs.org or `winget install OpenJS.NodeJS.LTS`, then open a new PowerShell) and Claude Code. No `npm install`. The .cmd/.js scripts were never run on Windows by me. Reviewed by reading only: paths are quoted (spaces OK); `precheck` is a plain `node` call so errorlevel returns to the batch; `claude` is the last line, so it works whether it resolves to claude.exe or claude.cmd. If `precheck` blocks you, update Claude Code; do not use `--no-isolation` as a workaround.
1. Unzip, open PowerShell in the folder, run `.\host.cmd`. Leave it open. First run creates the group and prints two owner web links (each has a private token).
2. In a second PowerShell: `.\make-workspace.cmd asrul` and `.\make-workspace.cmd naveen`.
3. Check: `node src\cli.js doctor --connect data\connect\asrul.agent.json`.
4. Double-click `start-claude.cmd` in each workspace (under `%USERPROFILE%\agentgroups-ws`). Run `/login` inside it with your existing account, choose "I am using this for local development", then "Use this MCP server".
5. Open the two owner links in two browser profiles. Follow `TEST-PLAN.md`.

## Setup on Mac (Naveen, or any Mac) - NOT run on a Mac yet
Check first: `node -v` (need 22 LTS or newer; official installer from nodejs.org) and `claude --version` (Claude Code native installer: `curl -fsSL https://claude.ai/install.sh | bash`, macOS 13+, per code.claude.com/docs/en/setup). No Homebrew needed. No `npm install`.
1. Unzip, open Terminal in the folder. Host (only on the machine that runs the server): `./host.sh`. If macOS blocks the script: `chmod +x *.sh`.
2. Member session: put your own connect file (sent to you privately) anywhere, then `node src/cli.js workspace --connect /path/to/you.agent.json --dir ~/agentgroups-ws/me`, or on the host `./make-workspace.sh asrul`.
3. Start it with `~/agentgroups-ws/me/start-claude.sh`, run `/login` inside, then choose "Use this MCP server".
4. macOS keeps Claude logins in the Keychain keyed to the config folder; whether the isolated folder asks you to log in again is unverified. The shell scripts were reviewed by reading only.

## Two real computers (Asrul and Naveen)
The server must be reachable by both. Route that I tested end to end from my sandbox with fake Claude clients and dummy data: a Cloudflare quick tunnel (no account). Messages, approvals from the owner API and replies all passed through it; the plugin uses plain long-polling, so proxies that buffer streaming do not break it. NOT tested: cloudflared on Windows, real Claude Code through it.
1. Host laptop: `winget install Cloudflare.cloudflared`, then `cloudflared tunnel --url http://127.0.0.1:8787`. It prints `https://something.trycloudflare.com`. The address changes each time you restart it.
2. Stop `host.cmd` and start `.\host.cmd --public-url https://THAT-ADDRESS` (this rewrites the connect files).
3. Send Naveen, privately, only `data\connect\naveen.agent.json` and his owner link (`<address>/#token=...` from the host window). Never send his files over a shared channel.
4. Naveen: `node src\cli.js workspace --connect <his file> --dir <folder>`, then `start-claude.cmd`.
5. If the address changes later: `node src\cli.js seturl --connect <file> --url https://NEW`. A running session picks it up within about a minute.
6. Stop the tunnel when you finish. While it runs the address is public; only the tokens protect it. Quick tunnels are for testing, not for real work data.

## Developer
`npm install`, `npm test` (~2 min), `npm run build` rebuilds `dist/channel.cjs`. `node scripts/seed-demo.js` starts a dummy-data demo server for screenshots.
