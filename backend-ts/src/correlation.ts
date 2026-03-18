import { randomUUID } from "crypto";

export interface CorrelationContext {
  correlationId: string;
  sessionId: string;
  startedAt: number;
}

export function generateCorrelationId(): string {
  return `corr_${randomUUID()}`;
}

export function createCorrelationContext(sessionId: string): CorrelationContext {
  return {
    correlationId: generateCorrelationId(),
    sessionId,
    startedAt: Date.now(),
  };
}
