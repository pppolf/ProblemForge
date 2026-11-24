import { computed, ref, watch } from 'vue';
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'pf-theme';

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return 'light';
}

export const themeMode = ref<ThemeMode>(readInitialTheme());
export const isDark = computed(() => themeMode.value === 'dark');

function applyDomTheme(mode: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
  }
}

applyDomTheme(themeMode.value);

watch(themeMode, mode => {
  applyDomTheme(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
});

export function toggleTheme() {
  themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark';
}

const SANS = 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace';

const lightOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4f46e5', primaryColorHover: '#4338ca', primaryColorPressed: '#3730a3', primaryColorSuppl: '#4f46e5',
    successColor: '#059669', successColorHover: '#047857', successColorPressed: '#065f46',
    infoColor: '#2563eb', infoColorHover: '#1d4ed8', infoColorPressed: '#1e40af',
    warningColor: '#d97706', warningColorHover: '#b45309', warningColorPressed: '#92400e',
    errorColor: '#dc2626', errorColorHover: '#b91c1c', errorColorPressed: '#991b1b',
    bodyColor: '#f6f8fa', cardColor: '#ffffff', modalColor: '#ffffff', popoverColor: '#ffffff',
    textColorBase: '#0f172a', textColor1: '#0f172a', textColor2: '#334155', textColor3: '#64748b',
    placeholderColor: '#94a3b8', borderColor: '#e2e8f0', dividerColor: '#eef2f6',
    hoverColor: '#f1f5f9', tableHeaderColor: '#f8fafc', inputColor: '#ffffff',
    borderRadius: '8px', borderRadiusSmall: '6px', fontSize: '14px',
    fontFamily: SANS, fontFamilyMono: MONO,
    heightSmall: '30px', heightMedium: '36px', heightLarge: '42px',
  },
  Button: { fontWeight: '500', borderRadiusMedium: '8px', borderRadiusSmall: '6px', borderRadiusLarge: '9px' },
  Input: { boxShadowFocus: '0 0 0 3px rgba(79, 70, 229, 0.14)', borderHover: '1px solid #cbd5e1' },
  Card: { borderRadius: '12px', titleFontWeight: '600', borderColor: '#e2e8f0' },
  Tabs: {
    tabFontWeightActive: '600', tabBorderRadius: '7px',
    colorSegment: '#eef2f6', tabColorSegment: '#ffffff', tabTextColorActiveSegment: '#0f172a',
  },
  Tag: { borderRadius: '6px', fontWeightStrong: '600' },
  Alert: { borderRadius: '9px' },
  Empty: { textColor: '#64748b', extraTextColor: '#64748b', iconColor: '#cbd5e1' },
};

const darkOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6366f1', primaryColorHover: '#818cf8', primaryColorPressed: '#4f46e5', primaryColorSuppl: '#6366f1',
    successColor: '#34d399', successColorHover: '#6ee7b7', successColorPressed: '#10b981',
    infoColor: '#60a5fa', infoColorHover: '#93c5fd', infoColorPressed: '#3b82f6',
    warningColor: '#fbbf24', warningColorHover: '#fcd34d', warningColorPressed: '#f59e0b',
    errorColor: '#f87171', errorColorHover: '#fca5a5', errorColorPressed: '#ef4444',
    bodyColor: '#0b0e14', cardColor: '#111622', modalColor: '#131926', popoverColor: '#161d2d',
    textColorBase: '#f1f5f9', textColor1: '#f1f5f9', textColor2: '#cbd5e1', textColor3: '#94a3b8',
    placeholderColor: '#64748b', borderColor: '#222b3d', dividerColor: '#1a2232',
    hoverColor: '#1a2234', tableHeaderColor: '#141a28', inputColor: '#0e131e',
    borderRadius: '8px', borderRadiusSmall: '6px', fontSize: '14px',
    fontFamily: SANS, fontFamilyMono: MONO,
    heightSmall: '30px', heightMedium: '36px', heightLarge: '42px',
  },
  Button: { fontWeight: '500', borderRadiusMedium: '8px', borderRadiusSmall: '6px', borderRadiusLarge: '9px', textColorPrimary: '#ffffff', textColorHoverPrimary: '#ffffff', textColorPressedPrimary: '#ffffff', textColorFocusPrimary: '#ffffff' },
  Input: { boxShadowFocus: '0 0 0 3px rgba(99, 102, 241, 0.25)', borderHover: '1px solid #334155' },
  Card: { borderRadius: '12px', titleFontWeight: '600', borderColor: '#222b3d' },
  Tabs: {
    tabFontWeightActive: '600', tabBorderRadius: '7px',
    colorSegment: '#151b29', tabColorSegment: '#222c42', tabTextColorActiveSegment: '#f8fafc',
  },
  Tag: { borderRadius: '6px', fontWeightStrong: '600' },
  Alert: { borderRadius: '9px' },
  Empty: { textColor: '#94a3b8', extraTextColor: '#94a3b8', iconColor: '#475569' },
};

export const naiveTheme = computed(() => (isDark.value ? darkTheme : null));
export const themeOverrides = computed<GlobalThemeOverrides>(() => (isDark.value ? darkOverrides : lightOverrides));
export const theme = lightOverrides;
