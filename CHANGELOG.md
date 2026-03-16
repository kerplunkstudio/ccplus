# Changelog

All notable changes to cc+ (ccplus) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-16

**First stable release** of cc+ (ccplus), a web UI and observability layer for Claude Code.

cc+ provides a browser-based chat interface backed by the Claude Code SDK, with a real-time activity tree showing every agent spawn and tool call as it happens. This release marks the culmination of 212 commits and establishes a production-ready foundation for Claude Code observability.

### Added

#### Core Features
- **Live Activity Tree**: Real-time hierarchical visualization of all tool calls and subagent spawns with collapsible nodes, status indicators, and duration tracking
- **Tabbed Sessions**: Multiple concurrent conversations with independent SDK sessions, tab duplication, and persistent state across refreshes
- **Desktop Application**: Electron wrapper for macOS, Linux, and Windows with native window management, dock integration, and window state persistence
- **Session Insights Dashboard**: Aggregate statistics including tool usage patterns, cost breakdowns, token consumption, and CSV export for analysis
- **Workspace Browser**: Navigate project files and directories directly from the UI with file path integration to chat

#### User Experience
- **Interactive Onboarding**: First-run setup wizard for workspace configuration, model selection, and environment setup
- **One-Line Install**: curl-based installer script with automated dependency checks and setup
- **Markdown Rendering**: GitHub-flavored markdown with syntax highlighting, code blocks, LaTeX support, and copy-to-clipboard
- **Path Autocomplete**: Intelligent file path completion in chat input with tab-based context menu
- **Text Selection Tools**: Send selected text to new sessions or copy to clipboard
- **Drag-and-Drop Support**: Extract file paths from dropped files and directories into chat input
- **Thinking Indicators**: Visual display of Claude's reasoning process during query execution
- **Context Usage Indicator**: Real-time tracking of context window usage with visual warnings

#### Integration & Extensibility
- **MCP Integration**: Custom Model Context Protocol tools for Claude to report progress back to the UI
- **In-App Browser Tabs**: Navigate external links without leaving the application
- **Profile Panel**: Persistent user preferences and settings across sessions
- **Dynamic Model Selection**: Switch between Claude models on-the-fly (Sonnet, Haiku, Opus)

#### Developer Experience
- **TypeScript Backend**: Fully typed Node.js backend with Express + Socket.IO for WebSocket communication
- **React 19 Frontend**: Modern React architecture with hooks, TypeScript strict mode, and immutable state patterns
- **SQLite Database**: better-sqlite3 with WAL mode for conversation history and tool usage tracking
- **Unified Launcher**: Single `./ccplus` script for all operations (build, deploy, run, test)
- **Comprehensive Testing**: Vitest test suite for backend (149 tests), Jest + React Testing Library for frontend
- **Health Check API**: Diagnostic endpoints for system status, database stats, and active sessions

#### Architecture
- **Async Streaming**: Claude Agent SDK integration using async generators for in-process streaming
- **WebSocket Protocol**: Real-time bidirectional communication with structured tool events and text deltas
- **Hierarchical Tool Tracking**: SDK-native `agent_id` field for parent-child correlation in activity tree
- **Session Persistence**: Conversation history restoration across page refreshes and server restarts
- **Parallel Desktop Mode**: Run desktop app alongside web server without conflicts

### Changed
- **Agent Activity Display**: Refactored from flat list to hierarchical tree with nested agent visualization
- **Database Schema**: Added `parent_agent_id` and `tool_use_id` columns for parent-child tracking
- **Frontend State Management**: Migrated to immutable tree reducer pattern for activity tree updates
- **Desktop App Architecture**: Separate backend launcher with shared SDK worker for parallel mode

### Fixed
- **Session ID Persistence**: Resolved duplicate session creation on page refresh
- **WebSocket Reconnection**: Fixed Socket.IO room management and event routing after disconnect
- **Activity Tree Updates**: Corrected recursive node insertion for deeply nested agent hierarchies
- **Tab Duplication**: Fixed conversation history cloning and SDK session state transfer
- **Context Window Accuracy**: Improved token counting for context usage indicator
- **Markdown Edge Cases**: Resolved rendering issues with nested code blocks and LaTeX expressions

### Security
- **JWT Authentication**: Token-based auth with configurable expiry and local mode for single-user deployments
- **Input Validation**: Sanitized WebSocket messages and API parameters to prevent injection attacks
- **Environment Secrets**: Secure handling of API keys and secrets via `.env` with example template
- **Path Traversal Protection**: Validated file paths in workspace browser and drag-and-drop handlers

---

## Links
- **Repository**: https://github.com/mjfuentes/ccplus
- **Documentation**: See CLAUDE.md for architecture and development guide
- **Issue Tracker**: https://github.com/mjfuentes/ccplus/issues
