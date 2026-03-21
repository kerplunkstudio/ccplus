import fs from 'fs'
import { log } from './logger.js'

export interface CaptainPersistedState {
  readonly sessionId: string
  readonly sdkSessionId: string
  readonly workspace: string
  readonly savedAt: number
}

export interface TelegramPersistedState {
  readonly ackMessages: ReadonlyArray<{ readonly chatId: number; readonly messageId: number }>
  readonly savedAt: number
}

export function saveCaptainState(state: CaptainPersistedState, filePath: string): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
    log.debug('Captain state saved', { filePath, sdkSessionId: state.sdkSessionId })
  } catch (err) {
    log.error('Failed to save Captain state', { filePath, error: String(err) })
  }
}

export function loadCaptainState(filePath: string): CaptainPersistedState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).sessionId !== 'string' ||
      typeof (parsed as Record<string, unknown>).sdkSessionId !== 'string' ||
      typeof (parsed as Record<string, unknown>).workspace !== 'string'
    ) {
      log.warn('Captain state file has invalid structure', { filePath })
      return null
    }
    return parsed as CaptainPersistedState
  } catch (err) {
    const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      log.warn('Failed to load Captain state', { filePath, error: String(err) })
    }
    return null
  }
}

export function removeCaptainState(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Failed to remove Captain state', { filePath, error: String(err) })
    }
  }
}

export function saveTelegramState(
  ackMessages: ReadonlyArray<{ chatId: number; messageId: number }>,
  filePath: string
): void {
  const state: TelegramPersistedState = { ackMessages, savedAt: Date.now() }
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
    log.debug('Telegram state saved', { filePath, count: ackMessages.length })
  } catch (err) {
    log.error('Failed to save Telegram state', { filePath, error: String(err) })
  }
}

export function loadTelegramState(filePath: string): TelegramPersistedState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).ackMessages)
    ) {
      log.warn('Telegram state file has invalid structure', { filePath })
      return null
    }
    return parsed as TelegramPersistedState
  } catch (err) {
    const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      log.warn('Failed to load Telegram state', { filePath, error: String(err) })
    }
    return null
  }
}

export function removeTelegramState(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Failed to remove Telegram state', { filePath, error: String(err) })
    }
  }
}
