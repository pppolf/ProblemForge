export const CLOUD_PROJECT = 'problemforge-cloud';
export const HOST_NETWORK = `${CLOUD_PROJECT}_host-access`;
const projectLabel = 'com.docker.compose.project', networkLabel = 'com.docker.compose.network';
const bindingOption = 'com.docker.network.bridge.host_binding_ipv4';
const containerFormat = '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"state":{{json .State.Status}},"bindings":{{json .HostConfig.PortBindings}},"published":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}';

export function hostServices(ports) {
  return [['postgres', 'postgres', 5432], ['redis', 'redis', 6379], ['tex-sandbox', 'tex', 5050], ['judge-sandbox', 'judge', 5050]]
    .map(([name, key, port]) => ({ name, hostPort: ports[key], containerPort: `${port}/tcp` }));
}

// Look only at listener ownership and published port metadata from other
// containers. A conflict stops deployment; no port renumbering or process kill.
export async function assertHostPortUse(docker, listeners, ports, appPids = []) {
  const expected = new Map(hostServices(ports).map(service => [service.hostPort, service]));
  const relevant = new Set(Object.values(ports)), owned = new Set();
  const ids = (await docker(['ps', '-q'])).split(/\s+/).filter(Boolean);
  if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('无法确认 Docker 端口占用');
  if (ids.length) {
    const format = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .NetworkSettings.Ports}}}';
    const output = await docker(['inspect', '--format', format, ...ids]);
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      const container = JSON.parse(line);
      for (const [containerPort, bindings] of Object.entries(container.ports ?? {})) for (const binding of bindings ?? []) {
        const port = Number(binding.HostPort);
        if (!relevant.has(port)) continue;
        const service = expected.get(port);
        if (!service || container.project !== CLOUD_PROJECT || container.service !== service.name ||
            containerPort !== service.containerPort || binding.HostIp !== '127.0.0.1') {
          throw new Error(`端口 ${port} 已由其他容器或非预期映射占用；停止部署，不更改端口或已有服务`);
        }
        owned.add(port);
      }
    }
  }
  for (const line of listeners.split(/\r?\n/).filter(Boolean)) {
    const address = line.trim().split(/\s+/)[3];
    const port = Number(address?.match(/:(\d+)$/)?.[1]);
    if (!relevant.has(port)) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map(match => Number(match[1]));
    if (address === `127.0.0.1:${port}` && (owned.has(port) ||
        port === ports.api && pids.length && pids.every(pid => appPids.includes(pid)))) continue;
    throw new Error(`端口 ${port} 已有非本项目或无法确认归属的监听；停止部署，不更改端口或已有服务`);
  }
}

function exactBinding(bindings, service) {
  const rows = bindings?.[service.containerPort];
  return Array.isArray(rows) && rows.length === 1 && rows[0].HostIp === '127.0.0.1' &&
    rows[0].HostPort === String(service.hostPort) &&
    Object.entries(bindings).every(([port, value]) => port === service.containerPort || !value?.length);
}

// Inspect only non-secret fields: never capture Config.Env or compose config.
export async function inspectCloudPorts(docker, ports, buildId) {
  return Promise.all(hostServices(ports).map(async service => {
    const ids = (await docker(['ps', '-aq', '--filter', `label=${projectLabel}=${CLOUD_PROJECT}`,
      '--filter', `label=com.docker.compose.service=${service.name}`])).split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0])) throw new Error(`${service.name} 必须恰有一个本项目容器；停止网络操作`);
    const actual = JSON.parse(await docker(['inspect', '--format', containerFormat, ids[0]]));
    if (actual.project !== CLOUD_PROJECT || actual.service !== service.name || actual.state !== 'running') throw new Error(`${service.name} 不属于运行中的本项目服务`);
    if (!exactBinding(actual.bindings, service)) throw new Error(`${service.name} 的配置端口不是指定的 127.0.0.1:${service.hostPort}；停止网络操作`);
    if (service.name.endsWith('-sandbox') && actual.image !== `problemforge-${service.name.split('-')[0]}:${buildId}`) throw new Error(`${service.name} 不是待完成版本的镜像`);
    return { ...service, actual };
  }));
}

export function assertCloudPorts(rows) {
  for (const row of rows) if (!exactBinding(row.actual.published, row)) {
    throw new Error(`${row.name} 未实际发布 127.0.0.1:${row.hostPort} → ${row.containerPort}；容器内健康不代表宿主机可连接，尚未开始本次数据库迁移`);
  }
}

// Only for a pending deployment: attach its existing containers without editing
// the immutable release, recreating a database, or changing the Docker daemon.
export async function repairCloudNetwork(docker, ports, buildId) {
  const rows = await inspectCloudPorts(docker, ports, buildId);
  const backend = `${CLOUD_PROJECT}_backend`;
  if (rows.some(row => !row.actual.networks?.[backend])) throw new Error('容器缺少本项目 backend 网络；停止自动修复');
  const networkIds = (await docker(['network', 'ls', '--filter', `name=^${HOST_NETWORK}$`, '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean);
  if (networkIds.length > 1) throw new Error('宿主机访问网络不唯一');
  if (networkIds.length) {
    const [network] = JSON.parse(await docker(['network', 'inspect', HOST_NETWORK]));
    const owned = new Set(rows.map(row => row.actual.id));
    if (network.Name !== HOST_NETWORK || network.Driver !== 'bridge' || network.Internal || network.EnableIPv6 ||
        network.Labels?.[projectLabel] !== CLOUD_PROJECT || network.Labels?.[networkLabel] !== 'host-access' ||
        network.Options?.[bindingOption] !== '127.0.0.1' ||
        Object.keys(network.Options).some(key => key !== bindingOption) ||
        Object.keys(network.Containers ?? {}).some(id => !owned.has(id))) {
      throw new Error('同名 host-access 网络不是预期的本项目回环访问网络，拒绝接管');
    }
  } else {
    await docker(['network', 'create', '--driver', 'bridge', '--label', `${projectLabel}=${CLOUD_PROJECT}`,
      '--label', `${networkLabel}=host-access`, '--opt', `${bindingOption}=127.0.0.1`, HOST_NETWORK]);
  }
  for (const row of rows) if (!row.actual.networks[HOST_NETWORK]) {
    await docker(['network', 'connect', HOST_NETWORK, row.actual.id]);
  }
  assertCloudPorts(await inspectCloudPorts(docker, ports, buildId));
}

// Self-contained so it can run under the real service UID via node --eval even
// when recovering a release which predates this module. No credentials needed.
export async function probeHostPorts(ports, connectOverride, attempts = 10) {
  const connect = connectOverride ?? (await import('node:net')).createConnection;
  const results = await Promise.allSettled(['postgres', 'redis', 'tex', 'judge'].map(async name => {
    const port = ports[name];
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${name} 端口无效`);
    let code;
    for (let attempt = 0; attempt < attempts; attempt++) {
      code = await new Promise(resolve => {
        const socket = connect({ host: '127.0.0.1', port });
        const finish = value => { socket.destroy(); resolve(value); };
        socket.once('connect', () => finish(null));
        socket.once('error', error => finish(['ECONNREFUSED', 'ETIMEDOUT', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code) ? error.code : '连接失败'));
        socket.setTimeout(2000, () => finish('ETIMEDOUT'));
      });
      if (!code) return;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`${name} 127.0.0.1:${port} ${code}`);
  }));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (failures.length) throw new Error(`应用用户无法连接基础服务：${failures.join('；')}。尚未开始本次数据库迁移。`);
}

export const hostProbeCode = `(${probeHostPorts.toString()})(JSON.parse(process.argv[1])).then(() => console.log('[ProblemForge] 应用用户连接数据库、Redis、TeX / Judge 回环端口均成功。')).catch(error => { console.error('[ProblemForge] ' + error.message); process.exitCode = 1; });`;
