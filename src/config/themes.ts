export const themes = {
  cardano: {
    primary: '#00c7f3',
    secondary: '#00ffd1',
    accent: '#2f9cac',
    light: '#00DFF3',
    dark: '#00BAAD',
    darker: '#155B75',
    muted: '#009DAB',
    bright: '#00D1FF',
    gradient1: '#00dff3',
    gradient2: '#00fad5'
  },
  // Shifted toward deeper terracotta/red-orange to distinguish from Bitcoin's golden orange
  apex: {
    primary: '#d45d2b',
    secondary: '#f08050',
    accent: '#c05025',
    light: '#e8793a',
    dark: '#b04420',
    darker: '#8b3215',
    muted: '#b5633a',
    bright: '#e86b38',
    gradient1: '#e06030',
    gradient2: '#f08040'
  },
  // Bitcoin — authentic brand orange (#F7931A) with a warm golden-amber palette
  bitcoin: {
    primary: '#F7931A',
    secondary: '#FFB84D',
    accent: '#E8820C',
    light: '#FFAD33',
    dark: '#D97706',
    darker: '#92400E',
    muted: '#B45309',
    bright: '#FCD34D',
    gradient1: '#F7931A',
    gradient2: '#F59E0B'
  }
}

export const iconFilters = {
  cardano: 'brightness(0) saturate(100%) invert(62%) sepia(93%) saturate(1287%) hue-rotate(136deg) brightness(102%) contrast(101%)',
  apex: 'brightness(0) saturate(100%) invert(52%) sepia(85%) saturate(1100%) hue-rotate(345deg) brightness(108%) contrast(98%)',
  bitcoin: 'brightness(0) saturate(100%) invert(63%) sepia(88%) saturate(2100%) hue-rotate(8deg) brightness(104%) contrast(103%)'
}