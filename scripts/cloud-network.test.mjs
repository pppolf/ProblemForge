import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CLOUD_PROJECT, HOST_NETWORK, hostServices, inspectCloudPorts, assertCloudPorts, repairCloudNetwork, assertHostPortUse, probeHostPorts } from './cloud-network.mjs';
import { cloudSettings } from './cloud-config.mjs';

const ports = cloudSettings().ports, build = 'test-release';
const binding = (service, ip = '127.0.0.1') => ({ [service.containerPort]: [{ HostIp: ip, HostPort: String(service.hostPort) }] });
function fixture() {
  const containers = hostServices(ports).map((service, index) => ({
    id: String(index + 1).repeat(64), service: service.name, project: CLOUD_PROJECT, state: 'running',
    image: service.name.endsWith('-sandbox') ? `problemforge-${service.name.split('-')[0]}:${build}` : service.name,
    bindings: binding(service), published: { [service.containerPort]: null },
    networks: { [`${CLOUD_PROJECT}_backend`]: { NetworkID: 'private-network' } },
  }));
  const state = { containers, network: null, mutations: [] };
  const docker = async args => {
    if (args[0] === 'ps') {
      if (args[1] === '-q') return containers.map(row => row.id).join('\n');
      return containers.filter(row => `label=com.docker.compose.service=${row.service}` === args.at(-1)).map(row => row.id).join('\n');
    }
    if (args[0] === 'inspect') {
      return containers.filter(row => args.slice(3).includes(row.id)).map(row =>
        JSON.stringify(args[2].includes('"ports":') ? { ...row, ports: row.published } : row)).join('\n');
    }
    if (args[0] === 'network' && args[1] === 'ls') return state.network ? 'aaaa1111bbbb' : '';
    if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify([state.network]);
    if (args[0] === 'network' && args[1] === 'create') {
      state.mutations.push(args);
      state.network = { Name: HOST_NETWORK, Driver: 'bridge', Internal: false, EnableIPv6: false,
        Labels: { 'com.docker.compose.project': CLOUD_PROJECT, 'com.docker.compose.network': 'host-access' },
        Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' }, Containers: {} };
      return 'aaaa1111bbbb';
    }
    if (args[0] === 'network' && args[1] === 'connect') {
      state.mutations.push(args);
      const row = containers.find(row => row.id === args.at(-1));
      row.networks[HOST_NETWORK] = { NetworkID: 'host-network' };
      row.published = structuredClone(row.bindings);
      state.network.Containers[row.id] = {};
      return '';
    }
    throw new Error(`unexpected command ${args.join(' ')}`);
  };
  return { state, docker };
}

test('internal-only healthy containers are rejected until ports are really published', async () => {
  const { docker } = fixture();
  const rows = await inspectCloudPorts(docker, ports, build);
  assert.throws(() => assertCloudPorts(rows), /postgres 未实际发布 127\.0\.0\.1:25432/);
});

test('pending network recovery only attaches four owned containers and repeats without writes', async () => {
  const { state, docker } = fixture();
  await repairCloudNetwork(docker, ports, build);
  assert.equal(state.mutations.filter(args => args[1] === 'create').length, 1);
  assert.equal(state.mutations.filter(args => args[1] === 'connect').length, 4);
  assert.ok(state.mutations.every(args => args[0] === 'network'));
  const count = state.mutations.length;
  await repairCloudNetwork(docker, ports, build);
  assert.equal(state.mutations.length, count);
  assertCloudPorts(await inspectCloudPorts(docker, ports, build));
});

test('recovery rejects foreign services, public bindings, wrong images and stopped containers before any mutation', async () => {
  for (const change of [
    row => { row.project = 'other-app'; },
    row => { row.bindings['5432/tcp'][0].HostIp = '0.0.0.0'; },
    row => { row.bindings['5432/tcp'][0].HostPort = '5432'; },
    row => { row.state = 'exited'; },
  ]) {
    const { state, docker } = fixture(); change(state.containers[0]);
    await assert.rejects(repairCloudNetwork(docker, ports, build));
    assert.equal(state.mutations.length, 0);
  }
  const { state, docker } = fixture(); state.containers[2].image = 'problemforge-tex:other-release';
  await assert.rejects(repairCloudNetwork(docker, ports, build), /待完成版本/);
  assert.equal(state.mutations.length, 0);
});

test('same-name foreign networks are never adopted', async () => {
  const { state, docker } = fixture();
  state.network = { Name: HOST_NETWORK, Driver: 'bridge', Internal: false, Labels: { 'com.docker.compose.project': 'other-app' } };
  await assert.rejects(repairCloudNetwork(docker, ports, build), /拒绝接管/);
  assert.equal(state.mutations.length, 0);
});

test('port checks preserve existing 5432, refuse other services on desired ports and accept only owned listeners', async () => {
  const { state, docker } = fixture();
  await assertHostPortUse(docker, 'LISTEN 0 128 0.0.0.0:5432 0.0.0.0:* users:(("postgres",pid=700,fd=7))', ports);
  for (const line of [
    'LISTEN 0 128 127.0.0.1:25432 0.0.0.0:* users:(("other",pid=700,fd=7))',
    'LISTEN 0 128 [::]:5181 [::]:* users:(("node",pid=800,fd=7))',
    'LISTEN 0 128 127.0.0.1:5181 0.0.0.0:* users:(("node",pid=999,fd=7))',
  ]) await assert.rejects(assertHostPortUse(docker, line, ports, [800]), /停止部署/);
  await assertHostPortUse(docker, 'LISTEN 0 128 127.0.0.1:5181 0.0.0.0:* users:(("node",pid=800,fd=7))', ports, [800]);
  state.containers[0].published = state.containers[0].bindings;
  await assertHostPortUse(docker, 'LISTEN 0 128 127.0.0.1:25432 0.0.0.0:* users:(("docker-proxy",pid=900,fd=7))', ports);
  state.containers[0].project = 'other-app';
  await assert.rejects(assertHostPortUse(docker, '', ports), /其他容器/);
});

test('host TCP checks fail closed with all inaccessible services and never reveal error payloads', async () => {
  const calls = [], closed = [];
  const connect = ({ host, port }) => {
    calls.push({ host, port });
    const socket = new EventEmitter();
    socket.setTimeout = () => socket;
    socket.destroy = () => closed.push(port);
    queueMicrotask(() => socket.emit('error', { code: 'PRIVATE_SECRET', message: 'private data' }));
    return socket;
  };
  await assert.rejects(probeHostPorts(ports, connect, 1), error => {
    assert.match(error.message, /postgres 127\.0\.0\.1:25432/);
    assert.match(error.message, /judge 127\.0\.0\.1:25051/);
    assert.ok(!error.message.includes('private') && !error.message.includes('PRIVATE'));
    return true;
  });
  assert.equal(calls.length, 4); assert.equal(closed.length, 4);
  assert.ok(calls.every(call => call.host === '127.0.0.1'));
});
