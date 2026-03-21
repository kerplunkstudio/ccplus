import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import {
  saveCaptainState,
  loadCaptainState,
  removeCaptainState,
  saveTelegramState,
  loadTelegramState,
  removeTelegramState,
  type CaptainPersistedState,
  type TelegramPersistedState,
} from '../state-persistence.js'

// Mock logger to suppress output during tests
vi.mock('../logger.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('state-persistence', () => {
  let testDir: string
  let captainStateFile: string
  let telegramStateFile: string

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = path.join(os.tmpdir(), `ccplus-test-${crypto.randomUUID()}`)
    fs.mkdirSync(testDir, { recursive: true })
    captainStateFile = path.join(testDir, 'captain_state.json')
    telegramStateFile = path.join(testDir, 'telegram_state.json')
  })

  afterEach(() => {
    // Clean up test directory
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true })
      }
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Captain state persistence', () => {
    describe('saveCaptainState', () => {
      it('writes valid JSON to file', () => {
        const state: CaptainPersistedState = {
          sessionId: 'captain-123',
          sdkSessionId: 'sdk-456',
          workspace: '/test/workspace',
          savedAt: Date.now(),
        }

        saveCaptainState(state, captainStateFile)

        expect(fs.existsSync(captainStateFile)).toBe(true)
        const raw = fs.readFileSync(captainStateFile, 'utf8')
        const parsed = JSON.parse(raw)
        expect(parsed).toEqual(state)
      })

      it('does not throw on bad path', () => {
        const state: CaptainPersistedState = {
          sessionId: 'captain-123',
          sdkSessionId: 'sdk-456',
          workspace: '/test/workspace',
          savedAt: Date.now(),
        }

        // Should not throw, just log error
        expect(() => saveCaptainState(state, '/nonexistent/path/file.json')).not.toThrow()
      })

      it('overwrites existing file', () => {
        const state1: CaptainPersistedState = {
          sessionId: 'captain-123',
          sdkSessionId: 'sdk-456',
          workspace: '/test/workspace',
          savedAt: 1000,
        }
        const state2: CaptainPersistedState = {
          sessionId: 'captain-789',
          sdkSessionId: 'sdk-abc',
          workspace: '/test/workspace2',
          savedAt: 2000,
        }

        saveCaptainState(state1, captainStateFile)
        saveCaptainState(state2, captainStateFile)

        const raw = fs.readFileSync(captainStateFile, 'utf8')
        const parsed = JSON.parse(raw)
        expect(parsed).toEqual(state2)
      })
    })

    describe('loadCaptainState', () => {
      it('returns state from valid file', () => {
        const state: CaptainPersistedState = {
          sessionId: 'captain-123',
          sdkSessionId: 'sdk-456',
          workspace: '/test/workspace',
          savedAt: Date.now(),
        }

        fs.writeFileSync(captainStateFile, JSON.stringify(state), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toEqual(state)
      })

      it('returns null for missing file', () => {
        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null for corrupted JSON', () => {
        fs.writeFileSync(captainStateFile, 'not valid json{', 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when sessionId is missing', () => {
        const invalidState = {
          sdkSessionId: 'sdk-456',
          workspace: '/test/workspace',
          savedAt: Date.now(),
        }

        fs.writeFileSync(captainStateFile, JSON.stringify(invalidState), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when sdkSessionId is missing', () => {
        const invalidState = {
          sessionId: 'captain-123',
          workspace: '/test/workspace',
          savedAt: Date.now(),
        }

        fs.writeFileSync(captainStateFile, JSON.stringify(invalidState), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when workspace is missing', () => {
        const invalidState = {
          sessionId: 'captain-123',
          sdkSessionId: 'sdk-456',
          savedAt: Date.now(),
        }

        fs.writeFileSync(captainStateFile, JSON.stringify(invalidState), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when file is not an object', () => {
        fs.writeFileSync(captainStateFile, JSON.stringify('not an object'), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when file contains null', () => {
        fs.writeFileSync(captainStateFile, JSON.stringify(null), 'utf8')

        const loaded = loadCaptainState(captainStateFile)
        expect(loaded).toBeNull()
      })
    })

    describe('removeCaptainState', () => {
      it('deletes existing file', () => {
        fs.writeFileSync(captainStateFile, '{}', 'utf8')
        expect(fs.existsSync(captainStateFile)).toBe(true)

        removeCaptainState(captainStateFile)

        expect(fs.existsSync(captainStateFile)).toBe(false)
      })

      it('is no-op for missing file', () => {
        expect(fs.existsSync(captainStateFile)).toBe(false)

        // Should not throw
        expect(() => removeCaptainState(captainStateFile)).not.toThrow()
      })
    })
  })

  describe('Telegram state persistence', () => {
    describe('saveTelegramState', () => {
      it('writes valid JSON to file', () => {
        const ackMessages = [
          { chatId: 123, messageId: 456 },
          { chatId: 789, messageId: 101 },
        ]

        saveTelegramState(ackMessages, telegramStateFile)

        expect(fs.existsSync(telegramStateFile)).toBe(true)
        const raw = fs.readFileSync(telegramStateFile, 'utf8')
        const parsed = JSON.parse(raw) as TelegramPersistedState
        expect(parsed.ackMessages).toEqual(ackMessages)
        expect(typeof parsed.savedAt).toBe('number')
      })

      it('handles empty array', () => {
        saveTelegramState([], telegramStateFile)

        const raw = fs.readFileSync(telegramStateFile, 'utf8')
        const parsed = JSON.parse(raw) as TelegramPersistedState
        expect(parsed.ackMessages).toEqual([])
      })

      it('does not throw on bad path', () => {
        expect(() => saveTelegramState([], '/nonexistent/path/file.json')).not.toThrow()
      })
    })

    describe('loadTelegramState', () => {
      it('returns state from valid file', () => {
        const state: TelegramPersistedState = {
          ackMessages: [
            { chatId: 123, messageId: 456 },
            { chatId: 789, messageId: 101 },
          ],
          savedAt: Date.now(),
        }

        fs.writeFileSync(telegramStateFile, JSON.stringify(state), 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toEqual(state)
      })

      it('returns null for missing file', () => {
        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null for corrupted JSON', () => {
        fs.writeFileSync(telegramStateFile, 'not valid json{', 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when ackMessages is not an array', () => {
        const invalidState = {
          ackMessages: 'not an array',
          savedAt: Date.now(),
        }

        fs.writeFileSync(telegramStateFile, JSON.stringify(invalidState), 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when ackMessages is missing', () => {
        const invalidState = {
          savedAt: Date.now(),
        }

        fs.writeFileSync(telegramStateFile, JSON.stringify(invalidState), 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when file is not an object', () => {
        fs.writeFileSync(telegramStateFile, JSON.stringify('not an object'), 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })

      it('returns null when file contains null', () => {
        fs.writeFileSync(telegramStateFile, JSON.stringify(null), 'utf8')

        const loaded = loadTelegramState(telegramStateFile)
        expect(loaded).toBeNull()
      })
    })

    describe('removeTelegramState', () => {
      it('deletes existing file', () => {
        fs.writeFileSync(telegramStateFile, '{}', 'utf8')
        expect(fs.existsSync(telegramStateFile)).toBe(true)

        removeTelegramState(telegramStateFile)

        expect(fs.existsSync(telegramStateFile)).toBe(false)
      })

      it('is no-op for missing file', () => {
        expect(fs.existsSync(telegramStateFile)).toBe(false)

        // Should not throw
        expect(() => removeTelegramState(telegramStateFile)).not.toThrow()
      })
    })
  })
})
