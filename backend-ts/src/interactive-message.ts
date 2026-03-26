/**
 * interactive-message.ts
 *
 * Types for interactive messages sent by Captain to users.
 * Supports confirmations, option selection, multi-select, and status actions.
 */

export type ActionStyle = 'primary' | 'danger' | 'default'
export type InteractiveResponseState = 'pending' | 'responded' | 'expired' | 'cancelled'

export interface InteractiveAction {
  readonly id: string           // max 52 chars (Telegram callback_data budget)
  readonly label: string        // max 64 chars (Telegram button label limit)
  readonly style: ActionStyle
  readonly value?: string       // defaults to id if omitted
}

export interface InteractiveMessageBase {
  readonly id: string
  readonly text: string
  readonly actions: readonly InteractiveAction[]
  readonly responseState: InteractiveResponseState
  readonly selectedActionId?: string
  readonly timeoutMs?: number
  readonly createdAt: number
  readonly expiresAt?: number
}

export interface ConfirmationMessage extends InteractiveMessageBase {
  readonly type: 'confirmation'
}

export interface OptionsMessage extends InteractiveMessageBase {
  readonly type: 'options'
}

export interface MultiSelectMessage extends InteractiveMessageBase {
  readonly type: 'multi-select'
  readonly minSelections?: number
  readonly maxSelections?: number
  readonly selectedActionIds?: readonly string[]
}

export interface StatusActionMessage extends InteractiveMessageBase {
  readonly type: 'status-action'
  readonly sessionId?: string
}

export type InteractiveMessage = ConfirmationMessage | OptionsMessage | MultiSelectMessage | StatusActionMessage

export interface InteractiveResponse {
  readonly messageId: string
  readonly actionId: string
  readonly actionValue?: string
  readonly respondedAt: number
  readonly source: 'web' | 'telegram' | 'discord' | 'api'
  readonly sourceId?: string
}
