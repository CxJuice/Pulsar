export type AppearanceTextRegion = 'ui' | 'listSource' | 'listTranslation' | 'editorSource' | 'editorTranslation'
export type AppearanceTheme = 'light' | 'dark'

export interface TypographyPreference {
  fontFamily: string
  fontSize: number | null
}

export interface AppearanceSettings {
  accentColors: Record<AppearanceTheme, string | null>
  backgroundColors: Record<AppearanceTheme, string | null>
  typography: Record<AppearanceTextRegion, TypographyPreference>
}

export const appearanceStorageKey = 'sckit-appearance'
export const defaultFontFamily = 'Inter, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
export const defaultAccentColors: Record<AppearanceTheme, string> = { light: '#6151d8', dark: '#a196fb' }
export const defaultBackgroundColors: Record<AppearanceTheme, string> = { light: '#ffffff', dark: '#202128' }
const systemFontPrefix = 'system:'

export function defaultAppearanceSettings(): AppearanceSettings {
  return {
    accentColors: { light: null, dark: null },
    backgroundColors: { light: null, dark: null },
    typography: {
      ui: { fontFamily: defaultFontFamily, fontSize: 13 },
      listSource: { fontFamily: '', fontSize: null },
      listTranslation: { fontFamily: '', fontSize: null },
      editorSource: { fontFamily: '', fontSize: null },
      editorTranslation: { fontFamily: '', fontSize: null },
    },
  }
}

export function safeFontFamily(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const family = value.trim()
  if (family.startsWith(systemFontPrefix)) {
    const systemFamily = family.slice(systemFontPrefix.length)
    return systemFamily && systemFamily.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(systemFamily) ? family : fallback
  }
  if (family.length > 160 || !/^[\p{L}\p{N}\s,"'_.&()+\-]+$/u.test(family)) return fallback
  return family || fallback
}

export function cssFontFamily(value: string, fallback = defaultFontFamily): string {
  const family = value.trim()
  if (!family) return fallback
  if (family.startsWith(systemFontPrefix)) {
    const name = family.slice(systemFontPrefix.length).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `"${name}", sans-serif`
  }
  if (family.includes(',') || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)$/i.test(family)) return family
  if ((family.startsWith('"') && family.endsWith('"')) || (family.startsWith("'") && family.endsWith("'"))) return family
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number]
}

function rgbToHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function mixColors(base: string, overlay: string, amount: number): string {
  const first = hexToRgb(base), second = hexToRgb(overlay)
  return rgbToHex([
    first[0] * (1 - amount) + second[0] * amount,
    first[1] * (1 - amount) + second[1] * amount,
    first[2] * (1 - amount) + second[2] * amount,
  ])
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function isLightColor(hex: string): boolean {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff')
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableText(background: string, foreground: string, minimum = 6): string {
  let low = 0, high = 1
  for (let index = 0; index < 12; index++) {
    const amount = (low + high) / 2
    if (contrastRatio(background, mixColors(background, foreground, amount)) >= minimum) high = amount
    else low = amount
  }
  return mixColors(background, foreground, high)
}

function accentForeground(accent: string): string {
  const darkText = '#000000'
  return contrastRatio(accent, darkText) >= contrastRatio(accent, '#ffffff') ? darkText : '#ffffff'
}

function accentHover(accent: string): string {
  const foreground = accentForeground(accent)
  return mixColors(accent, foreground === '#ffffff' ? '#000000' : '#ffffff', 0.1)
}

export function appearanceCssVariables(settings: AppearanceSettings, theme: string): Record<string, string> {
  const accentTheme: AppearanceTheme = theme === 'dark' ? 'dark' : 'light'
  const customBackground = settings.backgroundColors[accentTheme]
  const background = customBackground || defaultBackgroundColors[accentTheme]
  const customAccent = settings.accentColors[accentTheme]
  const accent = customAccent || defaultAccentColors[accentTheme]
  const light = isLightColor(background)
  const foreground = light ? '#000000' : '#ffffff'
  const ui = settings.typography.ui
  const variables: Record<string, string> = {
    '--accent': accent,
    '--accent-foreground': accentForeground(accent),
    '--accent-hover': accentHover(accent),
    '--app-font-family': cssFontFamily(ui.fontFamily, defaultFontFamily),
    '--app-font-size': `${ui.fontSize || 13}px`,
  }

  if (customBackground) {
    variables['--bg'] = background
    variables['--text'] = foreground
    variables['--secondary'] = mixColors(background, foreground, light ? 0.62 : 0.68)
    variables['--muted'] = readableText(background, foreground)
    variables['--border'] = mixColors(background, foreground, light ? 0.13 : 0.15)
    variables['--soft'] = mixColors(background, foreground, light ? 0.035 : 0.075)
    variables['--source'] = mixColors(background, foreground, light ? 0.055 : 0.11)
    variables['--accent-soft'] = mixColors(background, accent, light ? 0.09 : 0.21)
    variables['--hover'] = mixColors(background, accent, light ? 0.055 : 0.16)
    variables['--token'] = mixColors(background, foreground, light ? 0.11 : 0.2)
  } else if (customAccent) {
    variables['--accent-soft'] = mixColors(background, accent, light ? 0.09 : 0.21)
    variables['--hover'] = mixColors(background, accent, light ? 0.055 : 0.16)
  }

  const regions = [
    ['listSource', 'list-source'],
    ['listTranslation', 'list-translation'],
    ['editorSource', 'editor-source'],
    ['editorTranslation', 'editor-translation'],
  ] as const
  for (const [region, cssName] of regions) {
    const preference = settings.typography[region]
    variables[`--font-${cssName}`] = cssFontFamily(preference.fontFamily || ui.fontFamily, defaultFontFamily)
    variables[`--size-${cssName}`] = `${preference.fontSize ?? ui.fontSize ?? 13}px`
  }
  return variables
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}

function validSize(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null
  return Math.round(value)
}

export function parseAppearanceSettings(raw: string | null): AppearanceSettings {
  const defaults = defaultAppearanceSettings()
  if (!raw) return defaults
  try {
    const saved = JSON.parse(raw) as Partial<AppearanceSettings> & { accentColor?: unknown; backgroundColor?: unknown }
    if (!saved || typeof saved !== 'object') return defaults
    const savedTypography = saved.typography && typeof saved.typography === 'object'
      ? saved.typography as Partial<Record<AppearanceTextRegion, TypographyPreference>>
      : {}
    const legacyAccent = validColor(saved.accentColor) ? saved.accentColor : null
    const savedAccentColors = saved.accentColors && typeof saved.accentColors === 'object' && !Array.isArray(saved.accentColors)
      ? saved.accentColors as Partial<Record<AppearanceTheme, unknown>>
      : null
    const savedBackgroundColors = saved.backgroundColors && typeof saved.backgroundColors === 'object' && !Array.isArray(saved.backgroundColors)
      ? saved.backgroundColors as Partial<Record<AppearanceTheme, unknown>>
      : null
    const legacyBackground = validColor(saved.backgroundColor) ? saved.backgroundColor : null
    const typography = { ...defaults.typography }
    for (const region of Object.keys(typography) as AppearanceTextRegion[]) {
      const preference = savedTypography[region]
      if (!preference || typeof preference !== 'object') continue
      const fallback = defaults.typography[region]
      const fontFamily = safeFontFamily(preference.fontFamily, fallback.fontFamily)
      const minSize = region === 'ui' ? 10 : 8
      const maxSize = region === 'ui' ? 32 : 48
      const parsedSize = validSize(preference.fontSize, minSize, maxSize)
      typography[region] = {
        fontFamily,
        fontSize: preference.fontSize === null && region !== 'ui' ? null : parsedSize ?? fallback.fontSize,
      }
    }
    return {
      accentColors: savedAccentColors
        ? {
            light: validColor(savedAccentColors.light) ? savedAccentColors.light : null,
            dark: validColor(savedAccentColors.dark) ? savedAccentColors.dark : null,
          }
        : { light: legacyAccent, dark: legacyAccent },
      backgroundColors: savedBackgroundColors
        ? {
            light: validColor(savedBackgroundColors.light) ? savedBackgroundColors.light : null,
            dark: validColor(savedBackgroundColors.dark) ? savedBackgroundColors.dark : null,
          }
        : { light: legacyBackground, dark: legacyBackground },
      typography,
    }
  } catch {
    return defaults
  }
}
