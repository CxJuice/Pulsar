export type AppearanceTextRegion = 'ui' | 'listSource' | 'listTranslation' | 'editorSource' | 'editorTranslation'
export type AppearanceTheme = 'light' | 'dark'

export interface TypographyPreference {
  fontFamily: string
  fontSize: number | null
}

export interface AppearanceSettings {
  accentColors: Record<AppearanceTheme, string | null>
  backgroundColor: string | null
  typography: Record<AppearanceTextRegion, TypographyPreference>
}

export const appearanceStorageKey = 'sckit-appearance'
export const defaultFontFamily = 'Inter, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
export const defaultAccentColors: Record<AppearanceTheme, string> = { light: '#6151d8', dark: '#a196fb' }
const systemFontPrefix = 'system:'

export function defaultAppearanceSettings(): AppearanceSettings {
  return {
    accentColors: { light: null, dark: null },
    backgroundColor: null,
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

function isLightColor(hex: string): boolean {
  const [red, green, blue] = hexToRgb(hex).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.42
}

export function appearanceCssVariables(settings: AppearanceSettings, theme: string): Record<string, string> {
  const background = settings.backgroundColor || (theme === 'dark' ? '#202128' : '#ffffff')
  const accentTheme: AppearanceTheme = theme === 'dark' ? 'dark' : 'light'
  const customAccent = settings.accentColors[accentTheme]
  const accent = customAccent || defaultAccentColors[accentTheme]
  const light = isLightColor(background)
  const foreground = light ? '#292932' : '#f0eff6'
  const muted = light ? '#858691' : '#9b9ca9'
  const ui = settings.typography.ui
  const variables: Record<string, string> = {
    '--accent': accent,
    '--app-font-family': cssFontFamily(ui.fontFamily, defaultFontFamily),
    '--app-font-size': `${ui.fontSize || 13}px`,
  }

  if (settings.backgroundColor) {
    variables['--bg'] = background
    variables['--text'] = foreground
    variables['--secondary'] = mixColors(background, foreground, light ? 0.62 : 0.68)
    variables['--muted'] = mixColors(background, muted, light ? 0.84 : 0.86)
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
    const saved = JSON.parse(raw) as Partial<AppearanceSettings> & { accentColor?: unknown }
    if (!saved || typeof saved !== 'object') return defaults
    const savedTypography = saved.typography && typeof saved.typography === 'object'
      ? saved.typography as Partial<Record<AppearanceTextRegion, TypographyPreference>>
      : {}
    const legacyAccent = validColor(saved.accentColor) ? saved.accentColor : null
    const savedAccentColors = saved.accentColors && typeof saved.accentColors === 'object' && !Array.isArray(saved.accentColors)
      ? saved.accentColors as Partial<Record<AppearanceTheme, unknown>>
      : null
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
      backgroundColor: validColor(saved.backgroundColor) ? saved.backgroundColor : null,
      typography,
    }
  } catch {
    return defaults
  }
}
