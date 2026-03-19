// Append-only, per-session, in-memory event log with sequence numbers.
// Enables cursor-based catch-up: client sends last_seq on rejoin,
// server replays missed events.

interface SessionEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

class EventLog {
  private logs = new Map<string, SessionEvent[]>();
  private seqs = new Map<string, number>();
  private readonly maxEvents: number;

  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
  }

  append(sessionId: string, type: string, data: Record<string, unknown>): SessionEvent {
    const rawEvents = this.logs.get(sessionId) ?? [];
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    const event: SessionEvent = { seq, type, data, timestamp: Date.now() };

    const withNew = [...rawEvents, event];
    const trimmed = withNew.length > this.maxEvents
      ? withNew.slice(withNew.length - this.maxEvents)
      : withNew;

    this.logs.set(sessionId, trimmed);
    this.seqs.set(sessionId, seq);
    return event;
  }

  getEventsSince(sessionId: string, afterSeq: number): SessionEvent[] {
    const events = this.logs.get(sessionId) ?? [];
    return events.filter(e => e.seq > afterSeq);
  }

  getLastSeq(sessionId: string): number {
    return this.seqs.get(sessionId) ?? 0;
  }

  getOldestSeq(sessionId: string): number {
    const events = this.logs.get(sessionId) ?? [];
    return events.length > 0 ? events[0].seq : 0;
  }

  clear(sessionId: string): void {
    this.logs.delete(sessionId);
    this.seqs.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.logs.has(sessionId);
  }

  getEventCount(sessionId: string): number {
    return this.logs.get(sessionId)?.length ?? 0;
  }
}

const eventLog = new EventLog();
export { EventLog, eventLog, type SessionEvent };
