<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NPopover, NButton } from 'naive-ui';
import AppIcon from './AppIcon.vue';
import {
  ACCENT_PRESETS,
  THEME_PRESETS,
  accentId,
  contrastTextFor,
  currentThemePreset,
  customAccent,
  isDark,
  normalizeHex,
  resetAppearance,
  resolvedAccent,
  setAccent,
  setCustomAccent,
  setThemeMode,
  themeMode,
} from '../theme';

const props = withDefaults(
  defineProps<{
    inline?: boolean;
    compact?: boolean;
  }>(),
  { inline: false, compact: false }
);

const hexInput = ref(customAccent.value);
watch(customAccent, value => {
  hexInput.value = value;
});

const isCustomized = computed(() => themeMode.value !== 'light' || accentId.value !== 'indigo');

function onColorInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  setCustomAccent(value);
}

function onHexCommit() {
  const cleaned = hexInput.value.trim();
  const withHash = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(withHash)) {
    setCustomAccent(withHash);
    hexInput.value = normalizeHex(withHash);
  } else {
    hexInput.value = customAccent.value;
  }
}
</script>

<template>
  <div v-if="props.inline" class="theme-panel theme-panel--inline">
    <div class="theme-section-head">
      <div>
        <div class="theme-section-title">界面主题</div>
        <div class="theme-section-sub">覆盖亮白、护眼暖纸/青岚、暮灰微暗、北欧霜蓝与极夜深黑，实时同步编辑器配色</div>
      </div>
      <NButton v-if="isCustomized" size="tiny" quaternary @click="resetAppearance">恢复默认</NButton>
    </div>

    <div class="theme-grid theme-grid--wide" role="radiogroup" aria-label="选择界面主题">
      <button
        v-for="preset in THEME_PRESETS"
        :key="preset.id"
        type="button"
        role="radio"
        :aria-checked="themeMode === preset.id"
        class="theme-card"
        :class="{ active: themeMode === preset.id }"
        @click="setThemeMode(preset.id)"
      >
        <div class="theme-preview" :style="{ background: preset.preview.canvas, borderColor: preset.preview.line }">
          <div class="theme-preview-side" :style="{ background: preset.preview.sidebar, borderColor: preset.preview.line }">
            <span class="tp-dot" :style="{ background: resolvedAccent.base }"></span>
            <span class="tp-bar" :style="{ background: preset.preview.ink, opacity: 0.22 }"></span>
            <span class="tp-bar short" :style="{ background: preset.preview.ink, opacity: 0.14 }"></span>
          </div>
          <div class="theme-preview-main">
            <div class="tp-card" :style="{ background: preset.preview.surface, borderColor: preset.preview.line }">
              <span class="tp-line" :style="{ background: preset.preview.ink, opacity: 0.55 }"></span>
              <span class="tp-line short" :style="{ background: resolvedAccent.base }"></span>
            </div>
            <div class="tp-card slim" :style="{ background: preset.preview.surface, borderColor: preset.preview.line }"></div>
          </div>
        </div>
        <div class="theme-card-meta">
          <div class="theme-card-name">
            <span>{{ preset.name }}</span>
            <span v-if="themeMode === preset.id" class="theme-check"><AppIcon name="check" :size="12" /></span>
          </div>
          <div class="theme-card-sub">{{ preset.subtitle }}</div>
        </div>
      </button>
    </div>

    <div class="theme-divider"></div>

    <div class="theme-section-head">
      <div>
        <div class="theme-section-title">强调色与个性化配色</div>
        <div class="theme-section-sub">自由搭配按钮、导航高亮、聚焦框与代码编辑器关键字颜色</div>
      </div>
    </div>

    <div class="accent-row" role="radiogroup" aria-label="选择主题强调色">
      <button
        v-for="item in ACCENT_PRESETS"
        :key="item.id"
        type="button"
        role="radio"
        :aria-checked="accentId === item.id"
        :title="item.name"
        class="accent-chip"
        :class="{ active: accentId === item.id }"
        @click="setAccent(item.id)"
      >
        <span class="accent-swatch" :style="{ background: isDark ? item.dark : item.light, color: contrastTextFor(isDark ? item.dark : item.light) }">
          <AppIcon v-if="accentId === item.id" name="check" :size="12" />
        </span>
        <span class="accent-name">{{ item.name }}</span>
      </button>
    </div>

    <div class="custom-accent-row">
      <label class="custom-color-trigger" :class="{ active: accentId === 'custom' }" title="点击选择自定义颜色">
        <input type="color" :value="customAccent" aria-label="自定义强调色取色器" @input="onColorInput" />
        <span class="custom-color-preview" :style="{ background: customAccent }"></span>
        <span>自定义颜色</span>
      </label>
      <input
        v-model="hexInput"
        type="text"
        class="custom-hex-input"
        maxlength="7"
        placeholder="#0d9488"
        aria-label="自定义颜色十六进制值"
        @change="onHexCommit"
        @keydown.enter.prevent="onHexCommit"
      />
      <span class="custom-accent-hint">自动适配当前明暗对比度</span>
    </div>
  </div>

  <NPopover v-else trigger="click" placement="bottom-end" :width="348" :raw="true" :show-arrow="false">
    <template #trigger>
      <button
        type="button"
        class="theme-trigger-btn"
        :class="{ 'theme-trigger-btn--compact': props.compact }"
        :aria-label="`外观与配色：${currentThemePreset.name}`"
        :title="`外观与主题配色（当前：${currentThemePreset.name}）`"
      >
        <AppIcon name="palette" :size="15" />
        <span v-if="!props.compact" class="theme-trigger-label">{{ currentThemePreset.name }}</span>
        <span class="theme-trigger-dot" :style="{ background: resolvedAccent.base }" aria-hidden="true"></span>
      </button>
    </template>

    <div class="theme-popover-card">
      <div class="theme-section-head">
        <div class="theme-section-title">外观主题</div>
        <button v-if="isCustomized" type="button" class="theme-reset-link" @click="resetAppearance">恢复默认</button>
      </div>

      <div class="theme-grid" role="radiogroup" aria-label="选择界面主题">
        <button
          v-for="preset in THEME_PRESETS"
          :key="preset.id"
          type="button"
          role="radio"
          :aria-checked="themeMode === preset.id"
          class="theme-card"
          :class="{ active: themeMode === preset.id }"
          @click="setThemeMode(preset.id)"
        >
          <div class="theme-preview" :style="{ background: preset.preview.canvas, borderColor: preset.preview.line }">
            <div class="theme-preview-side" :style="{ background: preset.preview.sidebar, borderColor: preset.preview.line }">
              <span class="tp-dot" :style="{ background: resolvedAccent.base }"></span>
              <span class="tp-bar" :style="{ background: preset.preview.ink, opacity: 0.22 }"></span>
              <span class="tp-bar short" :style="{ background: preset.preview.ink, opacity: 0.14 }"></span>
            </div>
            <div class="theme-preview-main">
              <div class="tp-card" :style="{ background: preset.preview.surface, borderColor: preset.preview.line }">
                <span class="tp-line" :style="{ background: preset.preview.ink, opacity: 0.55 }"></span>
                <span class="tp-line short" :style="{ background: resolvedAccent.base }"></span>
              </div>
              <div class="tp-card slim" :style="{ background: preset.preview.surface, borderColor: preset.preview.line }"></div>
            </div>
          </div>
          <div class="theme-card-meta">
            <div class="theme-card-name">
              <span>{{ preset.name }}</span>
              <span v-if="themeMode === preset.id" class="theme-check"><AppIcon name="check" :size="11" /></span>
            </div>
            <div class="theme-card-sub">{{ preset.subtitle }}</div>
          </div>
        </button>
      </div>

      <div class="theme-divider"></div>

      <div class="theme-section-head">
        <div class="theme-section-title">主题配色</div>
        <span class="theme-accent-badge mono">{{ resolvedAccent.base }}</span>
      </div>

      <div class="accent-dots" role="radiogroup" aria-label="选择主题强调色">
        <button
          v-for="item in ACCENT_PRESETS"
          :key="item.id"
          type="button"
          role="radio"
          :aria-checked="accentId === item.id"
          :title="item.name"
          class="accent-dot-btn"
          :class="{ active: accentId === item.id }"
          :style="{ background: isDark ? item.dark : item.light, color: contrastTextFor(isDark ? item.dark : item.light) }"
          @click="setAccent(item.id)"
        >
          <AppIcon v-if="accentId === item.id" name="check" :size="12" />
        </button>
      </div>

      <div class="custom-accent-row compact">
        <label class="custom-color-trigger" :class="{ active: accentId === 'custom' }" title="自由选择自定义强调色">
          <input type="color" :value="customAccent" aria-label="自定义强调色取色器" @input="onColorInput" />
          <span class="custom-color-preview" :style="{ background: customAccent }"></span>
          <span>自定义</span>
        </label>
        <input
          v-model="hexInput"
          type="text"
          class="custom-hex-input"
          maxlength="7"
          placeholder="#0d9488"
          aria-label="自定义颜色十六进制值"
          @change="onHexCommit"
          @keydown.enter.prevent="onHexCommit"
        />
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.theme-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .15s, border-color .15s, color .15s;
}
.theme-trigger-btn:hover {
  background: var(--hover);
  color: var(--ink);
  border-color: var(--accent-line);
}
.theme-trigger-btn--compact {
  padding: 0 9px;
  gap: 6px;
}
.theme-trigger-label {
  white-space: nowrap;
}
.theme-trigger-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--surface);
}
@media (max-width: 900px) {
  .theme-trigger-label { display: none; }
}

.theme-popover-card {
  width: 348px;
  max-width: calc(100vw - 24px);
  padding: 14px;
  border-radius: 13px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  color: var(--ink);
}

.theme-panel--inline {
  display: grid;
  gap: 12px;
}

.theme-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.theme-panel--inline .theme-section-head {
  margin-bottom: 2px;
}
.theme-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.theme-section-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}
.theme-reset-link {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 5px;
}
.theme-reset-link:hover {
  background: var(--accent-soft);
}
.theme-accent-badge {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-muted);
  padding: 2px 7px;
  border-radius: 999px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.theme-grid--wide {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 640px) {
  .theme-grid--wide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border-radius: 9px;
  border: 1.5px solid var(--line);
  background: var(--surface-soft);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background-color .15s, transform .1s;
}
.theme-card:hover {
  border-color: var(--accent-line);
  background: var(--hover);
}
.theme-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.theme-preview {
  height: 44px;
  border-radius: 6px;
  border: 1px solid transparent;
  overflow: hidden;
  display: grid;
  grid-template-columns: 26% 1fr;
}
.theme-preview-side {
  border-right: 1px solid transparent;
  padding: 6px 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tp-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
.tp-bar {
  height: 3px;
  border-radius: 2px;
  width: 100%;
}
.tp-bar.short { width: 65%; }
.theme-preview-main {
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tp-card {
  border-radius: 4px;
  border: 1px solid transparent;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tp-card.slim { height: 10px; padding: 0; }
.tp-line {
  height: 3px;
  border-radius: 2px;
  width: 75%;
}
.tp-line.short { width: 42%; }

.theme-card-meta {
  padding: 0 2px;
}
.theme-card-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.theme-card-sub {
  font-size: 10.5px;
  color: var(--text-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.theme-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent, #ffffff);
  flex-shrink: 0;
}

.theme-divider {
  height: 1px;
  background: var(--line-soft);
  margin: 12px 0;
}
.theme-panel--inline .theme-divider {
  margin: 4px 0;
}

.accent-dots {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.accent-dot-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  color: #ffffff;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: transform .12s, box-shadow .12s;
}
.accent-dot-btn:hover {
  transform: scale(1.1);
}
.accent-dot-btn.active {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
}

.accent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.accent-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px 5px 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color .15s, background-color .15s, color .15s;
}
.accent-chip:hover {
  border-color: var(--accent-line);
  color: var(--ink);
}
.accent-chip.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink);
}
.accent-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #ffffff;
  flex-shrink: 0;
}
.accent-name {
  white-space: nowrap;
}

.custom-accent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.custom-accent-row.compact {
  flex-wrap: nowrap;
}
.custom-color-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px 0 6px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color .15s, background-color .15s;
}
.custom-color-trigger:hover {
  border-color: var(--accent-line);
  color: var(--ink);
}
.custom-color-trigger.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink);
}
.custom-color-trigger input[type="color"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.custom-color-preview {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
}
.custom-hex-input {
  width: 88px;
  height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}
.custom-hex-input:focus {
  border-color: var(--accent);
}
.custom-accent-hint {
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
