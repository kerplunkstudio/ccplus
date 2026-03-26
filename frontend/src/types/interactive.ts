export type ActionStyle = 'primary' | 'danger' | 'default'

export interface InteractiveAction {
  readonly id: string
  readonly label: string
  readonly style: ActionStyle
  readonly value?: string
}

export interface InteractiveMessage {
  readonly id: string
  readonly type: 'confirmation' | 'options' | 'multi-select' | 'status-action'
  readonly text: string
  readonly actions: readonly InteractiveAction[]
  readonly responseState: 'pending' | 'responded' | 'expired' | 'cancelled'
  readonly selectedActionId?: string
  readonly timeoutMs?: number
  readonly createdAt: number
  readonly expiresAt?: number
  readonly sessionId?: string
}
