export interface Theme {
  name: string
  colors: {
    background: string
    accent: string
    text: string
    border: string
    hover: string
    success: string
    warning: string
    error: string
  }
  presetId: string
}
