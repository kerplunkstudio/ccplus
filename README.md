<p align="center">
  <h1 align="center">cc+</h1>
</p>

<h3 align="center">Claude Code, but with a face.</h3>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.12%2B-blue?style=flat-square" alt="Python"/>
  <img src="https://img.shields.io/badge/claude--code--sdk-latest-blueviolet?style=flat-square" alt="SDK"/>
  <img src="https://img.shields.io/badge/vibes-immaculate-ff69b4?style=flat-square" alt="Vibes"/>
</p>

---

You already use Claude Code. It's great. It's also a terminal. And sometimes you want to see what the hell it's doing without squinting at scrolling text like it's 1998.

cc+ is a web UI that sits on top of Claude Code. You chat. It codes. You watch every agent spawn, every tool call, every file edit — live, in a tree, in your browser. Same Claude Code underneath. Better window into it.

## Why

- You type in a terminal. Claude Code types back. Somewhere in between, it spawned 4 agents, edited 12 files, and ran tests you didn't know existed. You find out when it's done. Maybe.
- **cc+ shows you all of it. In real time. As it happens.**

## What it does

- **Direct Claude Code session.** No middleman. No routing layer. Your message goes straight to the SDK. Whatever Claude Code can do in the terminal, it can do here.
- **Activity tree.** Right sidebar. Every agent spawn is a collapsible node. Every tool call nested under its parent. Spinning while running, checkmark when done, X when it ate shit. You see the whole execution tree.
- **Streaming responses.** Characters appear as Claude thinks them. Not "wait 30 seconds then get a wall of text." Actual streaming.
- **Zero config.** Install. Run. Open browser. No accounts, no API keys to paste into a UI, no onboarding wizard. If Claude Code works in your terminal, cc+ works in your browser.

## Quick Start

### Web UI

```bash
git clone git@github.com:mjfuentes/ccplus.git && cd ccplus
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd frontend && npm install && cd ..
./deploy.sh
```

Open `localhost:4000`. Start talking.

### Desktop App

```bash
# After setup above
./deploy.sh desktop
```

Launches cc+ as a standalone desktop app (no browser needed).

## What you see

```
┌─────────────────────────────────┬──────────────────────────┐
│                                 │  Activity                │
│  You: refactor auth to use JWT  │                          │
│                                 │  🤖 code_agent           │
│  cc+: On it. I'll refactor     │  ├── 🔧 Read auth.py     │
│  the auth module to use JWT     │  ├── 🔧 Edit auth.py     │
│  tokens instead of sessions...  │  ├── 🔧 Write tests.py   │
│                                 │  ├── 🔧 Bash pytest ✓    │
│  [streaming ▊]                  │  └── 🔧 Bash git commit ✓│
│                                 │                          │
│  ┌──────────────────────────┐   │  🤖 security-reviewer    │
│  │ Type a message...    Send│   │  ├── 🔧 Read auth.py     │
│  └──────────────────────────┘   │  └── 🔧 Grep "password" ✓│
└─────────────────────────────────┴──────────────────────────┘
```

Left panel: chat. Right panel: everything Claude Code is doing under the hood.

## How it works

```
Browser → WebSocket → Flask → Claude Code SDK → streams back
                                    ↓
                              SDK hooks write
                              tool events to
                              SQLite + WebSocket
                                    ↓
                              Activity tree
                              updates live
```

No task queue. No background workers. No orchestrator deciding what model to use. Claude Code handles all of that. cc+ just gives it a UI and shows you what's happening.

## Stack

Python 3.12 / Claude Code SDK / Flask-SocketIO / React + TypeScript / SQLite

## Project structure

```
ccplus/
├── backend/
│   ├── server.py          # Flask + WebSocket server
│   ├── sdk_session.py     # SDK session manager (one per user, streaming)
│   ├── sdk_hooks.py       # Tool event tracking + agent tree correlation
│   ├── database.py        # SQLite (conversations + tool_usage)
│   ├── auth.py            # Auto-login on localhost
│   └── config.py          # Environment config
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChatPanel.tsx       # Chat interface with streaming
│       │   ├── ActivityTree.tsx    # Real-time agent/tool tree
│       │   └── MessageBubble.tsx   # Markdown rendering
│       └── hooks/
│           ├── useSocket.ts        # WebSocket + activity tree state
│           └── useAuth.ts          # Auto-login
├── static/chat/           # Built frontend (served by Flask)
└── data/                  # SQLite database
```

## Run modes

cc+ can run in two modes:

1. **Web UI** (default): Flask server + browser at `localhost:4000`
2. **Desktop app**: Electron wrapper that launches the server and opens a native app window

Both modes use the same backend, same React UI, same everything. Desktop mode just skips the browser and gives you a proper app icon in your dock.

Launch desktop mode with:
```bash
./deploy.sh desktop
```

See `electron/README.md` for packaging distributable binaries.

## The difference

| | Terminal | cc+ |
|---|---|---|
| Chat | ✓ | ✓ |
| See agent spawns | If you're fast | Tree view, live |
| See tool calls | Scrolls by | Nested, expandable |
| See costs | After the fact | Real-time |
| Cancel | Ctrl+C and pray | Button |
| Share screen with someone | "look at my terminal" | "open localhost:4000" |

## FAQ

**Is this a Claude Code replacement?**
No. It IS Claude Code. Same SDK, same agents, same tools. Different window.

**Why not just use the terminal?**
Use both. Terminal for quick stuff. cc+ for when you want to actually see what 4 parallel agents are doing to your codebase.

**Does it cost more?**
Same tokens, same API calls. cc+ adds zero overhead. The UI is free. The agents bill the same.

**Can I use my existing .claude/ config?**
Yes. cc+ reads your agent definitions, hooks, and settings. It's the same Claude Code.

---

<p align="center">
  <strong>Same Claude Code. Better window.</strong>
</p>
<p align="center">
  <a href="https://docs.anthropic.com/">Anthropic Docs</a> · <a href="https://docs.claude.com/claude-code">Claude Code Docs</a>
</p>
