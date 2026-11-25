import { computed, ref, watch } from 'vue';
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui';

export type ThemeMode = 'light' | 'paper' | 'sage' | 'slate' | 'nord' | 'dark';
export type AccentId = 'indigo' | 'sky' | 'emerald' | 'teal' | 'amber' | 'rose' | 'violet' | 'slate' | 'custom';

export interface ThemePreset {
  id: ThemeMode;
  name: string;
  subtitle: string;
  isDark: boolean;
  preview: {
    canvas: string;
    sidebar: string;
    surface: string;
    line: string;
    ink: string;
  };
  palette: {
    bodyColor: string;
    cardColor: string;
    modalColor: string;
    popoverColor: string;
    textColor1: string;
    textColor2: string;
    textColor3: string;
    placeholderColor: string;
    borderColor: string;
    borderHover: string;
    dividerColor: string;
    hoverColor: string;
    tableHeaderColor: string;
    inputColor: string;
    tabSegmentBg: string;
    tabActiveBg: string;
    tabActiveText: string;
    emptyIcon: string;
  };
  monaco: {
    base: 'vs' | 'vs-dark';
    bg: string;
    fg: string;
    lineNumber: string;
    lineNumberActive: string;
    lineHighlight: string;
    indentGuide: string;
    widgetBg: string;
    widgetBorder: string;
    comment: string;
    keywordSection: string;
    type: string;
    string: string;
    math: string;
    number: string;
    delimiter: string;
  };
}

export interface AccentPreset {
  id: Exclude<AccentId, 'custom'>;
  name: string;
  light: string;
  dark: string;
  gradientEndLight: string;
  gradientEndDark: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'light',
    name: '晴空亮白',
    subtitle: '清爽通透 · 日间标准',
    isDark: false,
    preview: { canvas: '#f6f8fa', sidebar: '#eef2f6', surface: '#ffffff', line: '#e2e8f0', ink: '#0f172a' },
    palette: {
      bodyColor: '#f6f8fa', cardColor: '#ffffff', modalColor: '#ffffff', popoverColor: '#ffffff',
      textColor1: '#0f172a', textColor2: '#334155', textColor3: '#64748b', placeholderColor: '#94a3b8',
      borderColor: '#e2e8f0', borderHover: '#cbd5e1', dividerColor: '#eef2f6',
      hoverColor: '#f1f5f9', tableHeaderColor: '#f8fafc', inputColor: '#ffffff',
      tabSegmentBg: '#eef2f6', tabActiveBg: '#ffffff', tabActiveText: '#0f172a', emptyIcon: '#cbd5e1',
    },
    monaco: {
      base: 'vs', bg: '#ffffff', fg: '#0f172a', lineNumber: '#94a3b8', lineNumberActive: '#334155',
      lineHighlight: '#f8fafc', indentGuide: '#eef2f6', widgetBg: '#ffffff', widgetBorder: '#e2e8f0',
      comment: '64748b', keywordSection: '2563eb', type: '7c3aed', string: '059669', math: 'b45309', number: 'd97706', delimiter: '475569',
    },
  },
  {
    id: 'paper',
    name: '暖纸护眼',
    subtitle: '柔和米白 · 降蓝光不刺眼',
    isDark: false,
    preview: { canvas: '#f0e9dc', sidebar: '#e9e0cf', surface: '#faf6ee', line: '#dcd1be', ink: '#2c241b' },
    palette: {
      bodyColor: '#f0e9dc', cardColor: '#faf6ee', modalColor: '#fcf9f2', popoverColor: '#fcf9f2',
      textColor1: '#2c241b', textColor2: '#4f4335', textColor3: '#7a6c5b', placeholderColor: '#a0917e',
      borderColor: '#dcd1be', borderHover: '#c8baa2', dividerColor: '#e9e0cf',
      hoverColor: '#ece4d4', tableHeaderColor: '#f4eee1', inputColor: '#fcf9f2',
      tabSegmentBg: '#e7decd', tabActiveBg: '#faf6ee', tabActiveText: '#2c241b', emptyIcon: '#c8baa2',
    },
    monaco: {
      base: 'vs', bg: '#faf6ee', fg: '#2c241b', lineNumber: '#a0917e', lineNumberActive: '#4f4335',
      lineHighlight: '#f2eadc', indentGuide: '#e7decd', widgetBg: '#fcf9f2', widgetBorder: '#dcd1be',
      comment: '857664', keywordSection: '1d4ed8', type: '6d28d9', string: '047857', math: 'a16207', number: 'b45309', delimiter: '635544',
    },
  },
  {
    id: 'sage',
    name: '青岚护眼',
    subtitle: '淡雅薄荷绿 · 舒缓耐看',
    isDark: false,
    preview: { canvas: '#e7efea', sidebar: '#dde8e1', surface: '#f3f7f4', line: '#c8d8ce', ink: '#182620' },
    palette: {
      bodyColor: '#e7efea', cardColor: '#f3f7f4', modalColor: '#f6faf7', popoverColor: '#f6faf7',
      textColor1: '#182620', textColor2: '#334a41', textColor3: '#5a7268', placeholderColor: '#839a90',
      borderColor: '#c8d8ce', borderHover: '#b1c7ba', dividerColor: '#dbe6df',
      hoverColor: '#e1ebe5', tableHeaderColor: '#ebf2ee', inputColor: '#f6faf7',
      tabSegmentBg: '#dce7e0', tabActiveBg: '#f3f7f4', tabActiveText: '#182620', emptyIcon: '#b1c7ba',
    },
    monaco: {
      base: 'vs', bg: '#f3f7f4', fg: '#182620', lineNumber: '#7e968c', lineNumberActive: '#334a41',
      lineHighlight: '#e8f0eb', indentGuide: '#dae6df', widgetBg: '#f6faf7', widgetBorder: '#c8d8ce',
      comment: '60786e', keywordSection: '1d4ed8', type: '6d28d9', string: '047857', math: 'a16207', number: 'b45309', delimiter: '465e54',
    },
  },
  {
    id: 'slate',
    name: '暮灰微暗',
    subtitle: '中性灰暗 · 告别过黑压抑',
    isDark: true,
    preview: { canvas: '#22272e', sidebar: '#1d2229', surface: '#2b313a', line: '#404956', ink: '#e6edf3' },
    palette: {
      bodyColor: '#22272e', cardColor: '#2b313a', modalColor: '#2e3540', popoverColor: '#323a46',
      textColor1: '#e6edf3', textColor2: '#c4ced9', textColor3: '#8d99a8', placeholderColor: '#6f7b8a',
      borderColor: '#404956', borderHover: '#535e6e', dividerColor: '#343c47',
      hoverColor: '#343c48', tableHeaderColor: '#272d36', inputColor: '#242a32',
      tabSegmentBg: '#252b33', tabActiveBg: '#38414f', tabActiveText: '#f0f6fc', emptyIcon: '#556070',
    },
    monaco: {
      base: 'vs-dark', bg: '#262c34', fg: '#e6edf3', lineNumber: '#6f7b8a', lineNumberActive: '#c4ced9',
      lineHighlight: '#2f3640', indentGuide: '#38414e', widgetBg: '#2e3540', widgetBorder: '#404956',
      comment: '8592a1', keywordSection: '6cb6ff', type: 'dcbdfb', string: '56d364', math: 'e3b341', number: 'f69d50', delimiter: 'adbac7',
    },
  },
  {
    id: 'nord',
    name: '北欧霜蓝',
    subtitle: '雾蓝低对比 · 专注沉浸',
    isDark: true,
    preview: { canvas: '#2e3440', sidebar: '#292e39', surface: '#363d4b', line: '#4c566a', ink: '#eceff4' },
    palette: {
      bodyColor: '#2e3440', cardColor: '#363d4b', modalColor: '#394150', popoverColor: '#3e4656',
      textColor1: '#eceff4', textColor2: '#d8dee9', textColor3: '#9da9be', placeholderColor: '#7b879c',
      borderColor: '#4c566a', borderHover: '#606c84', dividerColor: '#414a5b',
      hoverColor: '#414a5b', tableHeaderColor: '#323946', inputColor: '#2f3542',
      tabSegmentBg: '#2f3643', tabActiveBg: '#465063', tabActiveText: '#eceff4', emptyIcon: '#616e88',
    },
    monaco: {
      base: 'vs-dark', bg: '#313845', fg: '#eceff4', lineNumber: '#7b879c', lineNumberActive: '#d8dee9',
      lineHighlight: '#3b4252', indentGuide: '#434c5e', widgetBg: '#394150', widgetBorder: '#4c566a',
      comment: '8795ad', keywordSection: '88c0d0', type: 'b48ead', string: 'a3be8c', math: 'ebcb8b', number: 'd08770', delimiter: 'c5cedd',
    },
  },
  {
    id: 'dark',
    name: '极夜深黑',
    subtitle: '深邃高对比 · 夜间编码',
    isDark: true,
    preview: { canvas: '#0b0e14', sidebar: '#0e121b', surface: '#111622', line: '#222b3d', ink: '#f1f5f9' },
    palette: {
      bodyColor: '#0b0e14', cardColor: '#111622', modalColor: '#131926', popoverColor: '#161d2d',
      textColor1: '#f1f5f9', textColor2: '#cbd5e1', textColor3: '#94a3b8', placeholderColor: '#64748b',
      borderColor: '#222b3d', borderHover: '#334155', dividerColor: '#1a2232',
      hoverColor: '#1a2234', tableHeaderColor: '#141a28', inputColor: '#0e131e',
      tabSegmentBg: '#151b29', tabActiveBg: '#222c42', tabActiveText: '#f8fafc', emptyIcon: '#475569',
    },
    monaco: {
      base: 'vs-dark', bg: '#111622', fg: '#e2e8f0', lineNumber: '#475569', lineNumberActive: '#cbd5e1',
      lineHighlight: '#161d2e', indentGuide: '#1e293b', widgetBg: '#131926', widgetBorder: '#222b3d',
      comment: '64748b', keywordSection: '60a5fa', type: 'c084fc', string: '34d399', math: 'fbbf24', number: 'fb923c', delimiter: '94a3b8',
    },
  },
];

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', name: '靛蓝', light: '#4f46e5', dark: '#6366f1', gradientEndLight: '#0ea5e9', gradientEndDark: '#38bdf8' },
  { id: 'sky', name: '晴蓝', light: '#0284c7', dark: '#38bdf8', gradientEndLight: '#2563eb', gradientEndDark: '#60a5fa' },
  { id: 'emerald', name: '翡翠', light: '#059669', dark: '#34d399', gradientEndLight: '#0d9488', gradientEndDark: '#2dd4bf' },
  { id: 'teal', name: '青瓷', light: '#0d9488', dark: '#2dd4bf', gradientEndLight: '#0284c7', gradientEndDark: '#38bdf8' },
  { id: 'amber', name: '琥珀', light: '#c26a08', dark: '#f59e0b', gradientEndLight: '#ea580c', gradientEndDark: '#fb923c' },
  { id: 'rose', name: '绯红', light: '#e11d48', dark: '#fb7185', gradientEndLight: '#db2777', gradientEndDark: '#f472b6' },
  { id: 'violet', name: '紫罗兰', light: '#7c3aed', dark: '#a78bfa', gradientEndLight: '#4f46e5', gradientEndDark: '#818cf8' },
  { id: 'slate', name: '墨岩', light: '#475569', dark: '#94a3b8', gradientEndLight: '#334155', gradientEndDark: '#cbd5e1' },
];

const THEME_KEY = 'pf-theme';
const ACCENT_KEY = 'pf-accent';
const CUSTOM_ACCENT_KEY = 'pf-custom-accent';
const DEFAULT_CUSTOM_ACCENT = '#0d9488';

const VALID_THEMES = new Set<string>(THEME_PRESETS.map(t => t.id));
const VALID_ACCENTS = new Set<string>([...ACCENT_PRESETS.map(a => a.id), 'custom']);

export function normalizeHex(input: string, fallback = DEFAULT_CUSTOM_ACCENT): string {
  const cleaned = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(cleaned)) {
    const [, r, g, b] = cleaned;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex, '#4f46e5').slice(1);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function mixHex(a: string, b: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * ratio, g1 + (g2 - g1) * ratio, b1 + (b2 - b1) * ratio);
}

function hexRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastTextFor(hex: string): string {
  return relativeLuminance(hex) > 0.42 ? '#0f172a' : '#ffffff';
}

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && VALID_THEMES.has(saved)) return saved as ThemeMode;
  } catch {}
  return 'light';
}

function readInitialAccent(): AccentId {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    if (saved && VALID_ACCENTS.has(saved)) return saved as AccentId;
  } catch {}
  return 'indigo';
}

function readInitialCustomAccent(): string {
  try {
    const saved = localStorage.getItem(CUSTOM_ACCENT_KEY);
    if (saved) return normalizeHex(saved);
  } catch {}
  return DEFAULT_CUSTOM_ACCENT;
}

export const themeMode = ref<ThemeMode>(readInitialTheme());
export const accentId = ref<AccentId>(readInitialAccent());
export const customAccent = ref<string>(readInitialCustomAccent());

export const currentThemePreset = computed<ThemePreset>(
  () => THEME_PRESETS.find(t => t.id === themeMode.value) ?? THEME_PRESETS[0]
);
export const isDark = computed(() => currentThemePreset.value.isDark);

export interface ResolvedAccent {
  base: string;
  hover: string;
  pressed: string;
  soft: string;
  line: string;
  focusShadow: string;
  gradient: string;
  onAccent: string;
  monacoSelection: string;
  monacoInactiveSelection: string;
  monacoIndentActive: string;
}

export const resolvedAccent = computed<ResolvedAccent>(() => {
  const dark = isDark.value;
  let base: string;
  let gradientEnd: string;
  if (accentId.value === 'custom') {
    const raw = normalizeHex(customAccent.value);
    const lum = relativeLuminance(raw);
    base = dark && lum < 0.08 ? mixHex(raw, '#ffffff', 0.25) : !dark && lum > 0.72 ? mixHex(raw, '#000000', 0.24) : raw;
    gradientEnd = mixHex(base, dark ? '#38bdf8' : '#0ea5e9', 0.35);
  } else {
    const preset = ACCENT_PRESETS.find(a => a.id === accentId.value) ?? ACCENT_PRESETS[0];
    base = dark ? preset.dark : preset.light;
    gradientEnd = dark ? preset.gradientEndDark : preset.gradientEndLight;
  }
  const hover = dark ? mixHex(base, '#ffffff', 0.16) : mixHex(base, '#000000', 0.12);
  const pressed = dark ? mixHex(base, '#000000', 0.16) : mixHex(base, '#000000', 0.24);
  const onAccent = relativeLuminance(base) > 0.42 ? '#0f172a' : '#ffffff';
  const monacoBg = currentThemePreset.value.monaco.bg;
  return {
    base,
    hover,
    pressed,
    soft: hexRgba(base, dark ? 0.17 : 0.10),
    line: hexRgba(base, dark ? 0.38 : 0.30),
    focusShadow: `0 0 0 3px ${hexRgba(base, dark ? 0.26 : 0.15)}`,
    gradient: `linear-gradient(135deg, ${base} 0%, ${mixHex(base, gradientEnd, 0.45)} 55%, ${gradientEnd} 100%)`,
    onAccent,
    monacoSelection: mixHex(monacoBg, base, dark ? 0.34 : 0.17),
    monacoInactiveSelection: mixHex(monacoBg, base, dark ? 0.20 : 0.09),
    monacoIndentActive: mixHex(monacoBg, base, dark ? 0.55 : 0.40),
  };
});

function applyDomAppearance() {
  if (typeof document === 'undefined') return;
  const preset = currentThemePreset.value;
  const accent = resolvedAccent.value;
  const root = document.documentElement;
  root.setAttribute('data-theme', preset.id);
  root.style.colorScheme = preset.isDark ? 'dark' : 'light';
  root.style.setProperty('--accent', accent.base);
  root.style.setProperty('--accent-hover', accent.hover);
  root.style.setProperty('--accent-pressed', accent.pressed);
  root.style.setProperty('--accent-soft', accent.soft);
  root.style.setProperty('--accent-line', accent.line);
  root.style.setProperty('--brand-gradient', accent.gradient);
  root.style.setProperty('--on-accent', accent.onAccent);
}

applyDomAppearance();

watch([themeMode, accentId, customAccent], () => {
  applyDomAppearance();
  try {
    localStorage.setItem(THEME_KEY, themeMode.value);
    localStorage.setItem(ACCENT_KEY, accentId.value);
    localStorage.setItem(CUSTOM_ACCENT_KEY, normalizeHex(customAccent.value));
  } catch {}
});

export function setThemeMode(mode: ThemeMode) {
  if (VALID_THEMES.has(mode)) themeMode.value = mode;
}

export function setAccent(id: AccentId) {
  if (VALID_ACCENTS.has(id)) accentId.value = id;
}

export function setCustomAccent(hex: string) {
  const normalized = normalizeHex(hex, customAccent.value);
  customAccent.value = normalized;
  accentId.value = 'custom';
}

export function resetAppearance() {
  themeMode.value = 'light';
  accentId.value = 'indigo';
  customAccent.value = DEFAULT_CUSTOM_ACCENT;
}

export function toggleTheme() {
  themeMode.value = isDark.value ? 'light' : 'slate';
}

const SANS = 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace';

function buildOverrides(preset: ThemePreset, accent: ResolvedAccent): GlobalThemeOverrides {
  const p = preset.palette;
  const dark = preset.isDark;
  return {
    common: {
      primaryColor: accent.base,
      primaryColorHover: accent.hover,
      primaryColorPressed: accent.pressed,
      primaryColorSuppl: accent.base,
      successColor: dark ? '#34d399' : '#059669',
      successColorHover: dark ? '#6ee7b7' : '#047857',
      successColorPressed: dark ? '#10b981' : '#065f46',
      infoColor: dark ? '#60a5fa' : '#2563eb',
      infoColorHover: dark ? '#93c5fd' : '#1d4ed8',
      infoColorPressed: dark ? '#3b82f6' : '#1e40af',
      warningColor: dark ? '#fbbf24' : '#d97706',
      warningColorHover: dark ? '#fcd34d' : '#b45309',
      warningColorPressed: dark ? '#f59e0b' : '#92400e',
      errorColor: dark ? '#f87171' : '#dc2626',
      errorColorHover: dark ? '#fca5a5' : '#b91c1c',
      errorColorPressed: dark ? '#ef4444' : '#991b1b',
      bodyColor: p.bodyColor,
      cardColor: p.cardColor,
      modalColor: p.modalColor,
      popoverColor: p.popoverColor,
      textColorBase: p.textColor1,
      textColor1: p.textColor1,
      textColor2: p.textColor2,
      textColor3: p.textColor3,
      placeholderColor: p.placeholderColor,
      borderColor: p.borderColor,
      dividerColor: p.dividerColor,
      hoverColor: p.hoverColor,
      tableHeaderColor: p.tableHeaderColor,
      inputColor: p.inputColor,
      borderRadius: '8px',
      borderRadiusSmall: '6px',
      fontSize: '14px',
      fontFamily: SANS,
      fontFamilyMono: MONO,
      heightSmall: '30px',
      heightMedium: '36px',
      heightLarge: '42px',
    },
    Button: {
      fontWeight: '500',
      borderRadiusMedium: '8px',
      borderRadiusSmall: '6px',
      borderRadiusLarge: '9px',
      textColorPrimary: accent.onAccent,
      textColorHoverPrimary: accent.onAccent,
      textColorPressedPrimary: accent.onAccent,
      textColorFocusPrimary: accent.onAccent,
    },
    Input: {
      boxShadowFocus: accent.focusShadow,
      borderHover: `1px solid ${p.borderHover}`,
    },
    Card: {
      borderRadius: '12px',
      titleFontWeight: '600',
      borderColor: p.borderColor,
    },
    Tabs: {
      tabFontWeightActive: '600',
      tabBorderRadius: '7px',
      colorSegment: p.tabSegmentBg,
      tabColorSegment: p.tabActiveBg,
      tabTextColorActiveSegment: p.tabActiveText,
    },
    Tag: { borderRadius: '6px', fontWeightStrong: '600' },
    Alert: { borderRadius: '9px' },
    Empty: { textColor: p.textColor3, extraTextColor: p.textColor3, iconColor: p.emptyIcon },
  };
}

export const naiveTheme = computed(() => (isDark.value ? darkTheme : null));
export const themeOverrides = computed<GlobalThemeOverrides>(() => buildOverrides(currentThemePreset.value, resolvedAccent.value));
export const theme = themeOverrides.value;
