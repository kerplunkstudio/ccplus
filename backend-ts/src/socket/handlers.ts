import type { Server as SocketIOServer, Socket } from "socket.io";
import { eventLog } from "../event-log.js";
import { log } from "../logger.js";
import { validateCronExpression, type Scheduler } from "../scheduler.js";
import type { RouteDependencies } from "../routes/types.js";
import type { InteractiveMessage } from "../interactive-message.js";
import * as sessionApi from "../session-api.js";
import { getPendingSessionForMessage } from "../captain-tools.js";

// Terminal focus tracking
let terminalFocused = false;

export function isTerminalFocused(): boolean {
  return terminalFocused;
}

// Helper: Join a session room and sync state
function joinSession(
  socket: Socket,
  sessionId: string,
  userId: string,
  lastSeq: number,
  deps: RouteDependencies
): void {
  const { connectedClients, sdkSession, database, getWorkspaceForSession, buildSocketCallbacks } = deps;
  if (!connectedClients || !sdkSession || !database || !getWorkspaceForSession || !buildSocketCallbacks) {
    throw new Error("Missing required dependencies");
  }

  // Check if full reset is required (client is too far behind)
  if (lastSeq > 0 && eventLog.fullResetRequired(sessionId, lastSeq)) {
    socket.emit("full_reset_required", { session_id: sessionId });
    return;
  }

  // Replay missed events if client provides lastSeq
  if (lastSeq > 0) {
    const missedEvents = eventLog.getEventsSince(sessionId, lastSeq);
    for (const event of missedEvents) {
      socket.emit(event.type, { ...event.data, seq: event.seq, replay: true });
    }
  }

  socket.join(sessionId);

  const client = connectedClients.get(socket.id);
  if (client) {
    client.sessions.add(sessionId);
    client.session_id = sessionId;
  }

  // Check if session has active query — re-register callbacks
  if (sdkSession.isActive(sessionId)) {
    const sessionProjectPath = getWorkspaceForSession(sessionId);
    sdkSession.registerCallbacks(sessionId, buildSocketCallbacks(sessionId, sessionProjectPath));

    const payload = { session_id: sessionId };
    const event = eventLog.append(sessionId, 'stream_active', payload);
    socket.emit("stream_active", { ...payload, seq: event.seq });

    const bufferedContent = sdkSession.getStreamingContent(sessionId);
    if (bufferedContent) {
      socket.emit("stream_content_sync", { content: bufferedContent, session_id: sessionId });
    }

    const pq = sdkSession.getPendingQuestion(sessionId);
    if (pq) {
      socket.emit("user_question", {
        questions: pq.questions ?? [],
        tool_use_id: pq.tool_use_id ?? "",
      });
    }

    // Sync todos from active session
    const todos = sdkSession.getSessionTodos(sessionId);
    if (todos) {
      socket.emit("todo_sync", { todos, session_id: sessionId });
    }
  } else {
    // Session not active - query database for last TodoWrite event
    try {
      const events = database.getToolEvents(sessionId);
      const lastTodoEvent = [...events].reverse().find(
        (e) => e.tool_name === 'TodoWrite' && typeof e.parameters === 'object' && e.parameters !== null && 'todos' in e.parameters
      );
      if (lastTodoEvent && typeof lastTodoEvent.parameters === 'object' && lastTodoEvent.parameters !== null && 'todos' in lastTodoEvent.parameters) {
        socket.emit("todo_sync", { todos: (lastTodoEvent.parameters as { todos: unknown }).todos, session_id: sessionId });
      }
    } catch (err) {
      // Failed to query todos - safe to ignore
    }
  }

  socket.emit("connected", { session_id: sessionId });
}

export function setupSocketHandlers(
  io: SocketIOServer,
  deps: RouteDependencies & {
    ptyService: any;
    captain: any;
    scheduler: Scheduler;
  }
): void {
  const { connectedClients, database, sdkSession, sessionWorkspaces, ptyService, captain, scheduler, getWorkspaceForSession, buildSocketCallbacks } = deps;
  if (!connectedClients || !database || !sdkSession || !sessionWorkspaces || !getWorkspaceForSession || !buildSocketCallbacks) {
    throw new Error("Missing required dependencies");
  }

  io.on("connection", (socket) => {
    const sessionId = (socket.handshake.auth.session_id as string) ?? "";

    connectedClients.set(socket.id, { session_id: sessionId, sessions: new Set() });

    // If session_id provided in auth (backward compat or initial connect), auto-join
    if (sessionId) {
      joinSession(socket, sessionId, "local", 0, { connectedClients, sdkSession, database, getWorkspaceForSession, buildSocketCallbacks });
    }

    // -- Message handler --

    socket.on("message", (data: Record<string, unknown>) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        socket.emit("error", { message: "Not connected" });
        return;
      }

      const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
      const uid = "local";
      const content = ((data?.content as string) ?? "").trim();
      const workspace = (data?.workspace as string) ?? getWorkspaceForSession(sid);
      const model = (data?.model as string) || undefined;
      const imageIdsData = (data?.image_ids as string[]) ?? [];
      const projectPathData = (data?.workspace as string) ?? "";
      const workflow = (data?.workflow as string) || undefined;

      if (!content && !imageIdsData.length) return;

      // Record user message
      try {
        database.recordMessage(
          sid, uid, "user",
          content || "[Image]",
          undefined,
          projectPathData || undefined,
          imageIdsData.length ? imageIdsData : undefined,
        );

        const existing = database.getConversationHistory(sid, 1);
        if (existing.length <= 1) {
          try {
            database.incrementUserStats(uid, 1);
          } catch (e) {
            log.error("Failed to increment session count", { error: String(e) });
          }
        }
      } catch (err) {
        log.error("Failed to record user message", { sessionId, error: String(err) });
      }

      socket.emit("message_received", { status: "ok" });

      // Submit to SDK — inject into active query if one is running
      if (sdkSession.isActive(sid)) {
        sdkSession.injectMessage(sid, content || "[Image attached]", imageIdsData.length ? imageIdsData : undefined)
          .then((injected: any) => {
            if (!injected) {
              // Query ended between check and inject, fall back to new query
              sdkSession.submitQuery(
                sid,
                content || "[Image attached]",
                workspace,
                buildSocketCallbacks(sid, projectPathData || undefined),
                model,
                imageIdsData.length ? imageIdsData : undefined,
                undefined,
                undefined,
                workflow,
              );
            }
          })
          .catch(() => {
            // Injection failed, fall back to new query
            sdkSession.submitQuery(
              sid,
              content || "[Image attached]",
              workspace,
              buildSocketCallbacks(sid, projectPathData || undefined),
              model,
              imageIdsData.length ? imageIdsData : undefined,
              undefined,
              undefined,
              workflow,
            );
          });
      } else {
        sdkSession.submitQuery(
          sid,
          content || "[Image attached]",
          workspace,
          buildSocketCallbacks(sid, projectPathData || undefined),
          model,
          imageIdsData.length ? imageIdsData : undefined,
          undefined,
          undefined,
          workflow,
        );
      }
    });

    // -- Cancel --

    socket.on("cancel", (data?: { session_id?: string }) => {
      const client = connectedClients.get(socket.id);
      if (!client) return;
      const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
      sdkSession.cancelQuery(sid);
      socket.emit("cancelled", { status: "ok" });
    });

    // -- Ping --

    socket.on("ping", () => {
      socket.emit("pong", { timestamp: Date.now() });
    });

    // -- Question response --

    socket.on("question_response", (data: Record<string, unknown>) => {
      const client = connectedClients.get(socket.id);
      if (!client) return;
      const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
      const response = (data?.response as Record<string, unknown>) ?? {};
      sdkSession.sendQuestionResponse(sid, response);
    });

    // -- Duplicate session --

    socket.on("duplicate_session", (data: { sourceSessionId: string; newSessionId: string }, callback?: (response: { success: boolean; error?: string; conversations?: number; toolEvents?: number; images?: number }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ success: false, error: "Not connected" });
        return;
      }

      try {
        const result = database.duplicateSession(data.sourceSessionId, data.newSessionId, "local");
        callback?.({ success: true, conversations: result.conversations, toolEvents: result.toolEvents, images: result.images });
      } catch (err) {
        log.error("Failed to duplicate session", { sourceSessionId: data.sourceSessionId, newSessionId: data.newSessionId, error: String(err) });
        callback?.({ success: false, error: String(err) });
      }
    });

    // -- Join session (room-based multiplexing) --

    socket.on("join_session", (data: { session_id: string; last_seq?: number; lastSeq?: number }, callback?: (response: { status: string }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ status: "error" });
        return;
      }

      const newSessionId = data?.session_id;
      if (!newSessionId || typeof newSessionId !== "string") {
        callback?.({ status: "error" });
        return;
      }

      const lastSeq = (data?.last_seq ?? data?.lastSeq ?? 0) as number;
      joinSession(socket, newSessionId, "local", lastSeq, { connectedClients, sdkSession, database, getWorkspaceForSession, buildSocketCallbacks });
      callback?.({ status: "ok" });
    });

    // -- Leave session --

    socket.on("leave_session", (data: { session_id: string }) => {
      const client = connectedClients.get(socket.id);
      if (!client) return;

      const oldSessionId = data?.session_id;
      if (!oldSessionId || typeof oldSessionId !== "string") return;

      socket.leave(oldSessionId);
      client.sessions.delete(oldSessionId);
    });

    // -- Scheduled tasks --

    socket.on("schedule_create", (data: { prompt: string; interval: string; session_id?: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ success: false, error: "Not authenticated" });
        return;
      }

      const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
      const prompt = data?.prompt?.trim();
      const interval = data?.interval?.trim();

      if (!prompt || !interval) {
        callback?.({ success: false, error: "Missing prompt or interval" });
        return;
      }

      try {
        validateCronExpression(interval);
        const task = scheduler.addTask(sid, prompt, interval);
        callback?.({ success: true, task });
        socket.emit("schedule_created", { task });
      } catch (err) {
        const errorMsg = String(err);
        log.error("Failed to create scheduled task", { sessionId: sid, error: errorMsg });
        callback?.({ success: false, error: errorMsg });
      }
    });

    socket.on("schedule_delete", (data: { id: string }, callback?: (response: { success: boolean; error?: string }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ success: false, error: "Not authenticated" });
        return;
      }

      const taskId = data?.id;
      if (!taskId) {
        callback?.({ success: false, error: "Missing task id" });
        return;
      }

      const removed = scheduler.removeTask(taskId);
      if (removed) {
        callback?.({ success: true });
        socket.emit("schedule_deleted", { id: taskId });
      } else {
        callback?.({ success: false, error: "Task not found" });
      }
    });

    socket.on("schedule_list", (data: { session_id?: string }, callback?: (response: { tasks: unknown[] }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ tasks: [] });
        return;
      }

      const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
      const tasks = scheduler.listTasks(sid);
      callback?.({ tasks });
      socket.emit("schedule_list", { tasks });
    });

    socket.on("schedule_pause", (data: { id: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ success: false, error: "Not authenticated" });
        return;
      }

      const taskId = data?.id;
      if (!taskId) {
        callback?.({ success: false, error: "Missing task id" });
        return;
      }

      const paused = scheduler.pauseTask(taskId);
      if (paused) {
        const tasks = scheduler.listTasks(client.session_id);
        const task = tasks.find(t => t.id === taskId);
        callback?.({ success: true, task });
        socket.emit("schedule_updated", { task });
      } else {
        callback?.({ success: false, error: "Task not found" });
      }
    });

    socket.on("schedule_resume", (data: { id: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
      const client = connectedClients.get(socket.id);
      if (!client) {
        callback?.({ success: false, error: "Not authenticated" });
        return;
      }

      const taskId = data?.id;
      if (!taskId) {
        callback?.({ success: false, error: "Missing task id" });
        return;
      }

      const resumed = scheduler.resumeTask(taskId);
      if (resumed) {
        const tasks = scheduler.listTasks(client.session_id);
        const task = tasks.find(t => t.id === taskId);
        callback?.({ success: true, task });
        socket.emit("schedule_updated", { task });
      } else {
        callback?.({ success: false, error: "Task not found" });
      }
    });

    // -- Terminal handlers --

    const socketTerminals = new Set<string>();

    socket.on("terminal_spawn", (data: { terminalId: string; cwd: string }) => {
      const { terminalId, cwd } = data;

      try {
        ptyService.spawnTerminal(
          terminalId,
          cwd,
          (output: string) => {
            socket.emit("terminal_output", { terminalId, data: output });
          },
          (exitCode: number) => {
            socket.emit("terminal_exit", { terminalId, exitCode });
            socketTerminals.delete(terminalId);
          }
        );
        socketTerminals.add(terminalId);
        socket.emit("terminal_spawned", { terminalId });
      } catch (error) {
        log.error("Failed to spawn terminal", { terminalId, error: String(error) });
        socket.emit("terminal_error", { terminalId, error: String(error) });
      }
    });

    socket.on("terminal_input", (data: { terminalId: string; data: string }) => {
      const { terminalId, data: input } = data;
      ptyService.writeTerminal(terminalId, input);
    });

    socket.on("terminal_resize", (data: { terminalId: string; cols: number; rows: number }) => {
      const { terminalId, cols, rows } = data;
      ptyService.resizeTerminal(terminalId, cols, rows);
    });

    socket.on("terminal_kill", (data: { terminalId: string }) => {
      const { terminalId } = data;
      ptyService.killTerminal(terminalId);
      socketTerminals.delete(terminalId);
    });

    socket.on("terminal_focus", (data: { focused: boolean }) => {
      terminalFocused = data.focused === true;
    });

    // -- Room handlers (for fleet monitor) --

    socket.on('join_room', (data: { room: string }) => {
      if (data.room) {
        socket.join(data.room);
      }
    });

    socket.on('leave_room', (data: { room: string }) => {
      if (data.room) {
        socket.leave(data.room);
      }
    });

    // -- Captain handlers --

    socket.on('join_captain', () => {
      const captainSessionId = captain.getCaptainSessionId();
      if (!captainSessionId) return;
      const captainRoom = `captain:${captainSessionId}`;
      socket.join(captainRoom);

      const callbackId = `room:${captainRoom}`;

      // Register room-based callback (idempotent — only one per captain session)
      if (!captain.hasResponseCallback(callbackId)) {
        captain.registerResponseCallback(callbackId, {
          onText: (text: string, messageIndex: number) => {
            io.to(captainRoom).emit('captain_text', { text, message_index: messageIndex });
          },
          onThinking: (thinking: string) => {
            io.to(captainRoom).emit('captain_thinking', { thinking });
          },
          onComplete: () => {
            io.to(captainRoom).emit('captain_complete', {});
          },
          onError: (message: string) => {
            io.to(captainRoom).emit('captain_error', { message });
          },
          onToolUse: (toolName: string, toolInput?: Record<string, unknown>) => {
            io.to(captainRoom).emit('captain_tool_use', { tool: toolName, input: toolInput });
          },
        });

        captain.registerInteractiveCallback(callbackId, {
          onInteractiveMessage: (message: InteractiveMessage) => {
            io.to(captainRoom).emit('captain_interactive', message);
          },
        });
      }
    });

    socket.on('captain_message', (data: { content: string; image_ids?: string[] }) => {
      if (!captain.isCaptainAlive()) {
        socket.emit('captain_error', { message: 'Captain is not active' });
        return;
      }
      try {
        const imageIds = Array.isArray(data.image_ids) && data.image_ids.length > 0 ? data.image_ids : undefined;
        captain.sendCaptainMessage(data.content, 'web', socket.id, imageIds);
      } catch (error) {
        socket.emit('captain_error', { message: String(error) });
      }
    });

    socket.on('captain_interactive_response', (data: { messageId: string; actionId?: string; actionIds?: string[]; actionValue?: string }) => {
      if (!captain.isCaptainAlive()) {
        socket.emit('captain_error', { message: 'Captain is not active' });
        return;
      }

      // Validate inputs - either actionId or actionIds must be provided
      if (typeof data.messageId !== 'string' || !data.messageId.trim()) {
        socket.emit('captain_error', { message: 'Invalid interactive response: messageId must be a non-empty string' });
        return;
      }

      // Check if message is pending
      const pendingMessage = captain.getPendingInteractiveMessage(data.messageId);
      if (!pendingMessage) {
        socket.emit('captain_error', { message: `No pending interactive message with id: ${data.messageId}` });
        return;
      }

      const validActionIds = pendingMessage.actions.map((a: { id: string }) => a.id);
      let finalActionId: string;

      // Handle multi-select response (actionIds array)
      if (data.actionIds && Array.isArray(data.actionIds)) {
        if (data.actionIds.length === 0) {
          socket.emit('captain_error', { message: 'Invalid interactive response: actionIds must not be empty' });
          return;
        }

        // Validate all actionIds are known
        for (const id of data.actionIds) {
          if (!validActionIds.includes(id)) {
            socket.emit('captain_error', { message: `Invalid actionId in selection: ${id}` });
            return;
          }
        }

        // Join with comma for backwards-compatible storage
        finalActionId = data.actionIds.join(',');
      } else if (data.actionId && typeof data.actionId === 'string' && data.actionId.trim()) {
        // Handle single-select response (actionId string)
        if (!validActionIds.includes(data.actionId)) {
          socket.emit('captain_error', { message: `Invalid actionId: ${data.actionId}` });
          return;
        }
        finalActionId = data.actionId;
      } else {
        socket.emit('captain_error', { message: 'Invalid interactive response: must provide actionId or actionIds' });
        return;
      }

      // Check if this is a pending session interactive (approve/reject)
      const sessionId = getPendingSessionForMessage(data.messageId);

      // All validations passed, respond
      const responded = captain.respondToInteractiveMessage(data.messageId, {
        messageId: data.messageId,
        actionId: finalActionId,
        actionValue: data.actionValue,
        respondedAt: Date.now(),
        source: 'web',
        sourceId: socket.id,
      });

      if (!responded) {
        socket.emit('captain_error', { message: `No pending interactive message with id: ${data.messageId}` });
        return;
      }

      // Handle session approval/rejection if this was a pending session interactive
      if (sessionId) {
        try {
          if (finalActionId === 'approve') {
            const result = sessionApi.approvePendingSession(sessionId, {
              database,
              sdkSession,
              sessionWorkspaces,
              io,
              buildSocketCallbacks,
              log,
            });

            if (result.success) {
              log.info('Session approved via interactive card', { sessionId });
            } else {
              log.error('Failed to approve session via interactive card', { sessionId, error: result.error });
            }
          } else if (finalActionId === 'reject') {
            const result = sessionApi.rejectPendingSession(sessionId);

            if (result.success) {
              log.info('Session rejected via interactive card', { sessionId });
            } else {
              log.error('Failed to reject session via interactive card', { sessionId, error: result.error });
            }
          }
        } catch (error) {
          log.error('Error handling session interactive response', { sessionId, actionId: finalActionId, error: String(error) });
        }
      }
    });

    // -- Pending Session Handlers --

    socket.on('approve_session', async (data: { session_id: string }) => {
      try {
        if (!data.session_id || typeof data.session_id !== 'string') {
          socket.emit('session_action_error', { error: 'session_id is required and must be a string' });
          return;
        }

        const result = sessionApi.approvePendingSession(data.session_id, {
          database,
          sdkSession,
          sessionWorkspaces,
          io,
          buildSocketCallbacks,
          log,
        });

        if (result.success) {
          socket.emit('session_approved', { session_id: result.sessionId });
        } else {
          socket.emit('session_action_error', { error: result.error });
        }
      } catch (error) {
        log.error('Failed to approve session', { error: String(error) });
        socket.emit('session_action_error', { error: String(error) });
      }
    });

    socket.on('reject_session', (data: { session_id: string }) => {
      try {
        if (!data.session_id || typeof data.session_id !== 'string') {
          socket.emit('session_action_error', { error: 'session_id is required and must be a string' });
          return;
        }

        const result = sessionApi.rejectPendingSession(data.session_id);

        if (result.success) {
          socket.emit('session_rejected', { session_id: result.sessionId });
        } else {
          socket.emit('session_action_error', { error: result.error });
        }
      } catch (error) {
        log.error('Failed to reject session', { error: String(error) });
        socket.emit('session_action_error', { error: String(error) });
      }
    });

    // -- Disconnect --

    socket.on("disconnect", () => {
      try {
        const client = connectedClients.get(socket.id);
        if (client) {
          log.debug("Client disconnected", { sessions: [...client.sessions] });
        }

        // Kill all terminals owned by this socket
        for (const terminalId of socketTerminals) {
          ptyService.killTerminal(terminalId);
        }
        socketTerminals.clear();

        // Note: Captain callbacks are now room-based (not socket-based), so no cleanup needed.
        // Socket.IO automatically removes disconnected sockets from rooms.

        // Expire pending interactive messages immediately (prevents up to 2min wait)
        captain.expirePendingInteractiveMessages('disconnected');
      } finally {
        // Always remove from connectedClients Map (defensive cleanup)
        connectedClients.delete(socket.id);
      }
    });
  });
}
