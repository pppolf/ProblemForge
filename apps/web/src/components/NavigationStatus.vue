<script setup lang="ts">
import { NAlert, NButton } from 'naive-ui';
import { navigation } from '../navigation';

function retry() { if (navigation.failedPath) window.location.assign(navigation.failedPath); }
</script>

<template>
  <div v-if="navigation.pending || navigation.failedPath" class="navigation-feedback">
    <div v-if="navigation.pending" class="navigation-loading" role="status">正在打开页面…</div>
    <NAlert v-else type="error" role="alert" title="页面暂时无法打开" closable @close="navigation.failedPath = ''">
      请检查连接，保存当前编辑后再刷新重试。
      <div class="navigation-actions"><NButton size="small" @click="retry">刷新页面重试</NButton></div>
    </NAlert>
  </div>
</template>

<style scoped>
.navigation-feedback { position: fixed; top: 16px; right: 24px; z-index: 2000; max-width: min(430px, calc(100vw - 32px)); }
.navigation-loading { padding: 10px 16px; border: 1px solid var(--line); border-radius: 5px; background: white; color: var(--text-secondary); font-size: 13px; box-shadow: 0 2px 8px #25364b12; }
.navigation-actions { margin-top: 10px; }
</style>
