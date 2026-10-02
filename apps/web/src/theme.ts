import type { GlobalThemeOverrides } from 'naive-ui';

// Keep component colors in sync with the semantic tokens in style.css.
export const theme: GlobalThemeOverrides = {
  common: {
    primaryColor: '#42634e', primaryColorHover: '#52765e', primaryColorPressed: '#304e3b', primaryColorSuppl: '#42634e',
    successColor: '#397456', successColorHover: '#498465', successColorPressed: '#2d6046',
    infoColor: '#597467', infoColorHover: '#698477', infoColorPressed: '#426051',
    warningColor: '#996b25', warningColorHover: '#ac7b30', warningColorPressed: '#80581e',
    errorColor: '#b34f49', errorColorHover: '#c3615b', errorColorPressed: '#983f3a',
    bodyColor: '#f7f8f5', cardColor: '#ffffff', modalColor: '#ffffff', popoverColor: '#ffffff',
    textColorBase: '#29362e', textColor1: '#29362e', textColor2: '#536158', textColor3: '#637066',
    placeholderColor: '#637066', borderColor: '#dfe4dc', dividerColor: '#e9ece6',
    hoverColor: '#f1f4ee', tableHeaderColor: '#f6f8f3', inputColor: '#ffffff',
    borderRadius: '8px', borderRadiusSmall: '5px', fontSize: '14px',
    fontFamily: 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontFamilyMono: '"Cascadia Code", Consolas, monospace',
    heightSmall: '30px', heightMedium: '36px', heightLarge: '42px',
  },
  Button: { fontWeight: '500' },
  Input: { boxShadowFocus: '0 0 0 3px rgba(66, 99, 78, .10)' },
  Card: { borderRadius: '12px', titleFontWeight: '600' },
  Tabs: { tabFontWeightActive: '600', tabBorderRadius: '7px', colorSegment: '#f0f3ed', tabColorSegment: '#ffffff', tabTextColorActiveSegment: '#304e3b' },
  Tag: { borderRadius: '5px' },
  Empty: { textColor: '#637066', extraTextColor: '#637066', iconColor: '#a7b3a4' },
};
