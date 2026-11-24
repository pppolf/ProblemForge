<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const paths: Record<string, string> = {
  forge: 'M6 4h8.5a4.5 4.5 0 0 1 0 9H10v7M6 4v16M10 8.5h4.2',
  problems: 'M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 13h6M9 17h4',
  contests: 'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v5m-4 2h8',
  tasks: 'M9 6h11M9 12h11M9 18h11M3.5 6.5l1.2 1.2 2.3-2.4M3.5 12.5l1.2 1.2 2.3-2.4M3.5 18.5l1.2 1.2 2.3-2.4',
  account: 'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  guide: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15',
  templates: 'M4 4h16v16H4V4Zm0 6h16M10 10v10',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm5-3a4 4 0 0 1 0 8m4 9v-2a4 4 0 0 0-3-3.87',
  groups: 'M3 4h6v6H3V4Zm12 0h6v6h-6V4ZM9 16h6v6H9v-6ZM6 10v3h12v-3m-6 3v3',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-4.35-4.35M17.5 10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  upload: 'M12 16V4m-4.5 4.5L12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  lock: 'M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Zm3 0V7a4 4 0 0 1 8 0v4m-4 4v2',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4m7-13 5 5-5 5m5-5H9',
  sun: 'M12 3v2m0 14v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M3 12h2m14 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
  sidebar: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 0v14',
  terminal: 'M4 17l6-5-6-5m8 12h8',
  shield: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3Z',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  cpu: 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7V7Zm3 3h4v4h-4v-4Z',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 4v4.5h-4.5',
  image: 'M4 5h16v14H4V5Zm4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18',
  edit: 'M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5Z',
  copy: 'M8 8h11v12H8V8Zm-3 8H4V4h11v1',
};
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="app-icon"><path :d="paths[name] || paths.problems" /></svg>
</template>
