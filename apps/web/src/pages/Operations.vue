<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NButton, NTag, NAlert, NInput, useMessage } from 'naive-ui';
import { api } from '../api';
import { copyToClipboard } from '../clipboard';
import AppIcon from '../components/AppIcon.vue';

const health = ref<any>(), rows = ref<any[]>([]), users = ref<Record<string, string>>({}), cursor = ref<string|null>(null), action = ref(''), busy = ref(false), message = useMessage();
function actorName(id?: string | null) { return !id ? '系统' : users.value[id] || id; }
async function copyId(value: string) { if (await copyToClipboard(value)) message.success('已复制到剪贴板'); }
async function load(more = false) {
  busy.value = true;
  try {
    if (!more) {
      const [ops, dir] = await Promise.all([api('/admin/operations'), api<any>('/directory').catch(() => ({ users: [] }))]);
      health.value = ops;
      users.value = Object.fromEntries((dir.users ?? []).map((u: any) => [u.id, u.name]));
    }
    const q = new URLSearchParams();
    if (action.value) q.set('action', action.value);
    if (more && cursor.value) q.set('cursor', cursor.value);
    const r = await api(`/admin/audit?${q}`);
    rows.value = more ? [...rows.value, ...r.rows] : r.rows;
    cursor.value = r.nextCursor;
  } catch (e) { message.error((e as Error).message); }
  finally { busy.value = false; }
}
onMounted(() => load());
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="page-kicker">SYSTEM OPERATIONS &amp; AUDIT</span>
      <h1>运行与审计</h1>
      <p>实时监测依赖服务、Linux 沙箱连通性、私有存储容量配额与系统安全审计日志。</p>
    </div>
    <NButton :loading="busy" @click="load()"><template #icon><AppIcon name="refresh" :size="15" /></template>刷新状态</NButton>
  </div>

  <template v-if="health">
    <div class="ops-kpi-grid">
      <div class="ops-kpi-card">
        <div class="ops-kpi-label">SYSTEM HEALTH</div>
        <div class="ops-kpi-value" :style="{ color: health.status === 'ok' ? 'var(--verdict-ac)' : 'var(--verdict-tle)' }">
          {{ health.status === 'ok' ? 'HEALTHY' : 'DEGRADED' }}
        </div>
        <div class="ops-kpi-sub">{{ Object.values(health.checks).filter(s => s === 'ok').length }} / {{ Object.keys(health.checks).length }} 项服务在线</div>
      </div>

      <div class="ops-kpi-card">
        <div class="ops-kpi-label">PRIVATE STORAGE</div>
        <div class="ops-kpi-value">{{ (health.storage.bytes / 1048576).toFixed(1) }} <span style="font-size: 13px; font-weight: 500; color: var(--text-muted)">/ {{ (health.storage.limit / 1048576).toFixed(0) }} MiB</span></div>
        <div class="storage-bar">
          <div class="storage-bar-fill" :class="{ warn: health.storage.status !== 'ok' }" :style="{ width: Math.min(100, Math.max(2, health.storage.percent)) + '%' }"></div>
        </div>
        <div class="ops-kpi-sub">{{ health.storage.objects }} 个文件 · 缓存 {{ health.storage.cache.objects }} 项</div>
      </div>

      <div class="ops-kpi-card">
        <div class="ops-kpi-label">ACTIVE QUEUES</div>
        <div class="ops-kpi-value">TeX {{ health.tasks.builds }} · Judge {{ health.tasks.judge }}</div>
        <div class="ops-kpi-sub">单人配额 {{ health.quotas.buildsPerUser }} / {{ health.quotas.judgePerUser }} · 最多 {{ health.quotas.attempts }} 次尝试</div>
      </div>

      <div class="ops-kpi-card">
        <div class="ops-kpi-label">RUNTIME &amp; SCHEMA</div>
        <div class="ops-kpi-value" style="font-size: 17px">{{ health.version.buildId }}</div>
        <div class="ops-kpi-sub">{{ health.version.mode }} · {{ health.version.migrations.length }} 个数据库迁移</div>
      </div>
    </div>

    <section class="panel p4-editor">
      <h2>依赖组件状态</h2>
      <div class="ops-check-grid">
        <div v-for="(state, name) in health.checks" :key="name" class="ops-check-card">
          <span>{{ name }}</span>
          <span class="ops-check-status" :class="state === 'ok' ? 'ok' : 'fail'">
            <span class="ops-check-dot" aria-hidden="true"></span>{{ state }}
          </span>
        </div>
      </div>

      <NAlert v-if="health.storage.status !== 'ok'" type="warning" class="spaced">
        私有存储已使用 {{ health.storage.percent.toFixed(1) }}%，告警线 {{ health.storage.warningPercent }}%。请安排扩容或离线盘点；不会自动删除历史。
      </NAlert>

      <p class="muted" style="margin: 0 0 12px">
        Git：<span class="mono">{{ health.version.gitCommit || '开发工作区（未标记发布版本）' }}</span> · 构建时间：{{ health.version.builtAt || '—' }} · 迁移状态：{{ health.version.migrationsMatch === true ? '与镜像一致' : health.version.migrationsMatch === false ? '与镜像不一致，请检查升级状态' : '开发环境' }}
      </p>
      <p class="muted" style="margin: 0 0 14px">
        未完成写入预留：{{ health.storage.pending }} 项（{{ (health.storage.pendingBytes / 1048576).toFixed(2) }} MiB，最早 {{ health.storage.oldestPendingAt ? new Date(health.storage.oldestPendingAt).toLocaleString() : '—' }}）；编译缓存占用 {{ (health.storage.cache.bytes / 1048576).toFixed(2) }} MiB（计入总用量）。
      </p>

      <details>
        <summary>数据库迁移清单（{{ health.version.migrations.length }}）</summary>
        <div style="margin-top: 10px">
          <p v-for="m in health.version.migrations" :key="m.name" style="margin: 6px 0">
            <span class="mono-num">{{ m.name }}</span>
            <small class="mono">{{ m.checksum }}</small>
          </p>
        </div>
      </details>

      <details>
        <summary>最近 30 天新增登记用量（UTC，包含预留）</summary>
        <table class="data-table" style="margin-top: 10px">
          <thead><tr><th>日期</th><th>新增文件</th><th>MiB</th></tr></thead>
          <tbody>
            <tr v-for="g in health.storage.growth" :key="g.day">
              <td class="mono-num">{{ g.day }}</td>
              <td class="mono-num">{{ g.objects }}</td>
              <td class="mono-num">{{ (g.bytes / 1048576).toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  </template>

  <section class="panel p4-editor">
    <div class="panel-toolbar" style="padding: 0 0 14px; margin-bottom: 14px">
      <h2>系统审计日志</h2>
      <div class="p4-toolbar" style="margin: 0">
        <NInput v-model:value="action" placeholder="按操作名筛选（留空查看全部）" style="width: 260px" clearable @keydown.enter="load()" />
        <NButton type="primary" secondary @click="load()">查询审计</NButton>
      </div>
    </div>
    <table class="data-table">
      <thead><tr><th>时间 / 操作</th><th>操作者 / 对象</th><th>详情</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            <div class="mono-num">{{ new Date(r.createdAt).toLocaleString('zh-CN') }}</div>
            <NTag size="small" :bordered="false" class="mono-num" style="margin-top: 4px">{{ r.action }}</NTag>
          </td>
          <td>
            <strong>{{ actorName(r.actorId) }}</strong>
            <div v-if="r.resourceId">
              <button type="button" class="mono-id copy-chip" :title="`复制对象 ID：${r.resourceId}`" @click="copyId(r.resourceId)">
                <span>{{ r.resourceId }}</span><AppIcon name="copy" :size="11" />
              </button>
            </div>
            <small v-else>—</small>
          </td>
          <td><pre class="audit-json">{{ r.detail ? JSON.stringify(r.detail) : '—' }}</pre></td>
        </tr>
      </tbody>
    </table>
    <div v-if="cursor" class="p4-toolbar" style="justify-content: center; margin-bottom: 0">
      <NButton :loading="busy" @click="load(true)">加载更早记录</NButton>
    </div>
  </section>
</template>
