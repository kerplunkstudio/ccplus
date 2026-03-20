import { Theme } from './themeTypes'

export const THEMES: Theme[] = [
  {
    name: 'Electric Ember',
    presetId: 'electric-ember',
    colors: {
      background: '#141316',
      accent: '#F07B3F',
      text: '#E8E4DF',
      border: '#332F2C',
      hover: '#1E1D20',
      success: '#A3D977',
      warning: '#F0C246',
      error: '#F25C5C',
    },
  },
  {
    name: 'Moonstone',
    presetId: 'moonstone',
    colors: {
      background: '#F4F5F7',
      accent: '#5B7FA4',
      text: '#2C3340',
      border: '#DFE2E8',
      hover: '#EBEDF2',
      success: '#4DA375',
      warning: '#D4873A',
      error: '#C75450',
    },
  },
  {
    name: 'Verdant',
    presetId: 'verdant',
    colors: {
      background: '#121A16',
      accent: '#7BAF7E',
      text: '#D8E0DA',
      border: '#243028',
      hover: '#1A241E',
      success: '#5DA36A',
      warning: '#D4A94B',
      error: '#C76A6A',
    },
  },
  {
    name: 'Rosewood',
    presetId: 'rosewood',
    colors: {
      background: '#1A1517',
      accent: '#C4848A',
      text: '#E2DAD8',
      border: '#352C2E',
      hover: '#221C1E',
      success: '#8FB87A',
      warning: '#D4A84D',
      error: '#D46B6B',
    },
  },
  {
    name: 'Arctic',
    presetId: 'arctic',
    colors: {
      background: '#111519',
      accent: '#6BA4CC',
      text: '#D6DDE4',
      border: '#242D36',
      hover: '#181E25',
      success: '#6BBF8A',
      warning: '#D4A94B',
      error: '#CC6B6B',
    },
  },
  {
    name: 'Parchment',
    presetId: 'parchment',
    colors: {
      background: '#F7F3ED',
      accent: '#8B6D4F',
      text: '#3D3429',
      border: '#E4DDD3',
      hover: '#EDE8E0',
      success: '#5E9E5E',
      warning: '#C47F3A',
      error: '#B85C4D',
    },
  },
]

export const THEME = THEMES[0]

export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.presetId === id) || THEMES[0]
}
