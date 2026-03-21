import type { Server as SocketIOServer, Socket } from "socket.io";
import type { SessionCallbacks } from "../sdk-session.js";
import { eventLog } from "../event-log.js";
import { log } from "../logger.js";
import { validateCronExpression, type Scheduler } from "../scheduler.js";
// Helper: Join a session room and sync state
function joinSession(
  socket: Socket,
  sessionId: string,
  userId: string,
  lastSeq: number,
  deps: {
    connectedClients: Map<string, { session_id: string; sessions: Set<string> }>;
    sdkSession: any;
    database: any;
    getWorkspaceForSession: (sessionId: string | undefined) => string;
    buildSocketCallbacks: (sessionId: string, projectPath?: string) => SessionCallbacks;
  }
): void {
  const { connectedClients, sdkSession, database, getWorkspaceForSession, buildSocketCallbacks } = deps;

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
  deps: {
    connectedClients: Map<string, { session_id: string; sessions: Set<string> }>;
    database: any;
    sdkSession: any;
    ptyService: any;
    captain: any;
    scheduler: Scheduler;
    getWorkspaceForSession: (sessionId: string | undefined) => string;
    buildSocketCallbacks: (sessionId: string, projectPath?: string) => SessionCallbacks;
  }
): void {
  const { connectedClients, database, sdkSession, ptyService, captain, scheduler, getWorkspaceForSession, buildSocketCallbacks } = deps;

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
      socket.join(`captain:${captainSessionId}`);

      captain.registerResponseCallback(`socket:${socket.id}`, {
        onText: (text: string, messageIndex: number) => {
          socket.emit('captain_text', { text, message_index: messageIndex });
        },
        onThinking: (thinking: string) => {
          socket.emit('captain_thinking', { thinking });
        },
        onComplete: () => {
          socket.emit('captain_complete', {});
        },
        onError: (message: string) => {
          socket.emit('captain_error', { message });
        },
      });
    });

    socket.on('captain_message', (data: { content: string }) => {
      if (!captain.isCaptainAlive()) {
        socket.emit('captain_error', { message: 'Captain is not active' });
        return;
      }
      try {
        captain.sendCaptainMessage(data.content, 'web', socket.id);
      } catch (error) {
        socket.emit('captain_error', { message: String(error) });
      }
    });

    socket.on('leave_captain', () => {
      captain.unregisterResponseCallback(`socket:${socket.id}`);
    });

    // -- Disconnect --

    socket.on("disconnect", () => {
      const client = connectedClients.get(socket.id);
      connectedClients.delete(socket.id);
      if (client) {
        log.debug("Client disconnected", { sessions: [...client.sessions] });
      }

      // Kill all terminals owned by this socket
      for (const terminalId of socketTerminals) {
        ptyService.killTerminal(terminalId);
      }
      socketTerminals.clear();

      // Cleanup Captain callback for this socket
      captain.unregisterResponseCallback(`socket:${socket.id}`);
    });
  });
}
