import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock captain-tick module BEFORE any imports that use it
vi.mock('../captain-tick.js', () => ({
  sleepTicks: vi.fn((n: number) => ({ sleepUntilTick: 100 + n })),
  getSleepRemaining: vi.fn(() => 5),
}));

// Mock other dependencies
vi.mock('../workflow-state.js');
vi.mock('../workflow-config.js');
vi.mock('../fleet-monitor.js');
vi.mock('../database.js');
vi.mock('../session-api.js');
vi.mock('../sdk-session.js');
vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the SDK tool function to capture handlers
const toolHandlers = new Map<string, Function>();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, desc: string, schema: any, handler: Function) => {
    toolHandlers.set(name, handler);
    return { name, description: desc, schema, handler };
  },
}));

import { buildFleetMcpTools, type CaptainToolDependencies } from '../captain-tools.js';
import * as captainTick from '../captain-tick.js';
import { log } from '../logger.js';

describe('captain-tools - sleep', () => {
  const mockDeps: CaptainToolDependencies = {
    database: {
      getConversationHistory: vi.fn().mockReturnValue([]),
      getToolEvents: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        total_conversations: 0,
        total_tool_events: 0,
        events_by_tool: {}
      }),
    } as any,
    sdkSession: {
      cancelQuery: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
      submitQuery: vi.fn(),
    } as any,
    sessionWorkspaces: new Map(),
    io: {},
    buildSocketCallbacks: vi.fn().mockReturnValue({}),
    log: log as any,
    getLastQuerySource: vi.fn().mockReturnValue(null),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
  });

  describe('buildFleetMcpTools', () => {
    it('builds 19 tools (including sleep)', () => {
      const tools = buildFleetMcpTools(mockDeps);
      expect(tools).toHaveLength(19);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('returns success with correct duration and calculated sleep_until_tick', async () => {
      vi.mocked(captainTick.sleepTicks).mockReturnValue({ sleepUntilTick: 105 });
      vi.mocked(captainTick.getSleepRemaining).mockReturnValue(5);

      const handler = toolHandlers.get('sleep');
      expect(handler).toBeDefined();

      const result = await handler!({ duration_ticks: 5 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.sleep_ticks).toBe(5);
      expect(parsed.sleep_until_tick).toBe(105);
      expect(parsed.remaining_ticks).toBe(5);

      expect(vi.mocked(captainTick.sleepTicks)).toHaveBeenCalledWith(5);
      expect(vi.mocked(captainTick.getSleepRemaining)).toHaveBeenCalledOnce();
    });

    it('uses default duration (5) when not provided', async () => {
      vi.mocked(captainTick.sleepTicks).mockReturnValue({ sleepUntilTick: 105 });
      vi.mocked(captainTick.getSleepRemaining).mockReturnValue(5);

      const handler = toolHandlers.get('sleep');
      const result = await handler!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.sleep_ticks).toBe(5);
      expect(vi.mocked(captainTick.sleepTicks)).toHaveBeenCalledWith(5);
    });

    it('respects max boundary (60 ticks)', async () => {
      vi.mocked(captainTick.sleepTicks).mockReturnValue({ sleepUntilTick: 160 });
      vi.mocked(captainTick.getSleepRemaining).mockReturnValue(60);

      const handler = toolHandlers.get('sleep');
      const result = await handler!({ duration_ticks: 60 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.sleep_ticks).toBe(60);
      expect(parsed.sleep_until_tick).toBe(160);
      expect(vi.mocked(captainTick.sleepTicks)).toHaveBeenCalledWith(60);
    });

    it('respects min boundary (1 tick)', async () => {
      vi.mocked(captainTick.sleepTicks).mockReturnValue({ sleepUntilTick: 101 });
      vi.mocked(captainTick.getSleepRemaining).mockReturnValue(1);

      const handler = toolHandlers.get('sleep');
      const result = await handler!({ duration_ticks: 1 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.sleep_ticks).toBe(1);
      expect(parsed.sleep_until_tick).toBe(101);
      expect(vi.mocked(captainTick.sleepTicks)).toHaveBeenCalledWith(1);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(captainTick.sleepTicks).mockImplementation(() => {
        throw new Error('Tick system failure');
      });

      const handler = toolHandlers.get('sleep');
      const result = await handler!({ duration_ticks: 5 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Tick system failure');
    });
  });
});
