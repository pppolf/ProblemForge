<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  forge: 'M5 5h8a5 5 0 0 1 0 10H9V9h4M5 5v14M9 19v-4',
  problems: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  contests: 'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v5m-4 2h8',
  tasks: 'M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2',
  account: 'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  guide: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15',
  templates: 'M3 3h18v18H3V3Zm0 6h18M9 9v12',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm5-3a4 4 0 0 1 0 8m4 9v-2a4 4 0 0 0-3-3.87',
  groups: 'M3 4h6v6H3V4Zm12 0h6v6h-6V4ZM9 16h6v6H9v-6ZM6 10v3h12v-3m-6 3v3',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  lock: 'M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4m-4 5v2',
  logout: 'M9 3H4v18h5m6-14 5 5-5 5m-7-5h12',
};
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="app-icon"><path :d="paths[name] || paths.problems" /></svg>
</template>
