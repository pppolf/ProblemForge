import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { digest } from './cloud-config.mjs';
import { sandboxRecipe, prepareCloudSandboxes, cleanupCloudSandboxImages } from './cloud-images.mjs';

const kinds = ['tex', 'judge'];
const id = number => `sha256:${String(number).repeat(64)}`;
const tag = (kind, build) => `problemforge-${kind}:${build}`;
const inputs = {
  '.dockerignore': '.git\nnode_modules\n',
  'infra/tex-sandbox.Dockerfile': 'FROM fixed-base\nCOPY infra/tex-mount.yaml /opt/mount.yaml\n',
  'infra/judge-sandbox.Dockerfile': 'FROM fixed-base\nCOPY --chmod=755 infra/java17-compile.sh /usr/bin/compile\nCOPY infra/judge-mount.yaml /opt/mount.yaml\n',
  'infra/tex-mount.yaml': 'tex mount', 'infra/judge-mount.yaml': 'judge mount',
  'infra/java17-compile.sh': '#!/bin/sh\n', 'apps/web/example.ts': 'old application',
};

async function fixture(t, changes = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pf-cloud-images-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function release(buildId, files) {
    const path = join(root, buildId), manifest = { buildId, files: [] };
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(path, name)), { recursive: true }); await writeFile(join(path, name), text);
      manifest.files.push({ path: name, sha256: digest(text) });
    }
    return { path, manifest };
  }
  const previous = await release('old-release', inputs);
  const next = await release('new-release', { ...inputs, 'apps/web/example.ts': 'new application', ...changes });
  const images = new Map(kinds.map((kind, i) => [tag(kind, 'old-release'), id(i + 1)]));
  const rows = kinds.map((kind, i) => ({ id: String(i + 1).repeat(64), project: 'problemforge-cloud', service: `${kind}-sandbox`,
    state: 'running', image: tag(kind, 'old-release'), imageId: id(i + 1) }));
  const commands = [], builds = [], saves = [];
  const docker = async args => {
    commands.push(args);
    if (args[0] === 'image') {
      if (args[1] === 'ls') return images.get(args.at(-1)) ?? '';
      if (args[1] === 'inspect') return images.get(args[2]) ?? '';
      if (args[1] === 'tag') { images.set(args[3], args[2]); return ''; }
    }
    if (args[0] === 'ps') return rows.filter(row => args.at(-1).endsWith(`=${row.service}`)).map(row => row.id).join('\n');
    if (args[0] === 'inspect') return JSON.stringify(rows.find(row => row.id === args.at(-1)));
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
  };
  const options = { directory: next.path, manifest: next.manifest, previous, docker, say: () => {},
    build: async service => { builds.push(service); const kind = service.split('-')[0]; images.set(tag(kind, 'new-release'), id(kinds.indexOf(kind) + 3)); },
    save: async receipt => { saves.push(structuredClone(receipt)); },
  };
  return { previous, next, options, builds, images, rows, commands, saves };
}

test('application-only updates reuse exactly the running project images without any builds', async t => {
  const f = await fixture(t);
  const receipt = await prepareCloudSandboxes(f.options);
  assert.deepEqual(f.builds, []);
  assert.equal(f.commands.filter(args => args[1] === 'tag').length, 2);
  for (const kind of kinds) assert.equal(receipt.images[kind].imageId, f.images.get(tag(kind, 'old-release')));
  assert.equal(f.saves.length, 2);
  f.commands.length = 0;
  assert.deepEqual(await prepareCloudSandboxes({ ...f.options, receipt }), receipt);
  assert.deepEqual(f.builds, []);
  assert.equal(f.commands.filter(args => args[1] === 'tag').length, 0);
});

test('changed compiler wrapper rebuilds only Judge; failed build retries reuse already prepared TeX', async t => {
  const f = await fixture(t, { 'infra/java17-compile.sh': '#!/bin/sh\necho updated\n' });
  await assert.rejects(prepareCloudSandboxes({ ...f.options, build: async service => {
    assert.equal(service, 'judge-sandbox'); throw new Error('download failed');
  } }), /download failed/);
  assert.equal(f.saves.length, 1);
  assert.deepEqual(Object.keys(f.saves[0].images), ['tex']);
  const receipt = await prepareCloudSandboxes({ ...f.options, receipt: f.saves[0] });
  assert.deepEqual(f.builds, ['judge-sandbox']);
  assert.equal(receipt.images.tex.imageId, id(1));
  assert.equal(receipt.images.judge.imageId, id(4));
});

test('fresh installs build both sandboxes', async t => {
  const f = await fixture(t);
  await prepareCloudSandboxes({ ...f.options, previous: null });
  assert.deepEqual(f.builds, ['tex-sandbox', 'judge-sandbox']);
});

test('different Dockerfile and dockerignore contents invalidate the affected recipes', async t => {
  const f = await fixture(t, { 'infra/judge-sandbox.Dockerfile': inputs['infra/judge-sandbox.Dockerfile'] + 'RUN echo patched\n' });
  await prepareCloudSandboxes(f.options);
  assert.deepEqual(f.builds, ['judge-sandbox']);
  const g = await fixture(t, { '.dockerignore': '.git\nnode_modules\n*.log\n' });
  await prepareCloudSandboxes(g.options);
  assert.deepEqual(g.builds, ['tex-sandbox', 'judge-sandbox']);
});

test('changed or unrecorded target tags are never overwritten', async t => {
  const f = await fixture(t);
  f.images.set(tag('tex', 'new-release'), id(9));
  await assert.rejects(prepareCloudSandboxes(f.options), /没有本次构建记录/);
  assert.equal(f.commands.filter(args => args[1] === 'tag').length, 0);
  f.images.delete(tag('tex', 'new-release'));
  const receipt = await prepareCloudSandboxes(f.options);
  f.images.set(tag('tex', 'new-release'), id(9));
  await assert.rejects(prepareCloudSandboxes({ ...f.options, receipt }), /已记录镜像发生变化/);
});

test('foreign, stopped, ambiguous or retagged running sandboxes are rejected before reuse', async t => {
  for (const change of [row => { row.project = 'other-project'; }, row => { row.state = 'exited'; },
    row => { row.image = tag('tex', 'foreign-release'); }, row => { row.imageId = id(9); }]) {
    const f = await fixture(t); change(f.rows[0]);
    await assert.rejects(prepareCloudSandboxes(f.options), /归属或镜像/);
    assert.equal(f.commands.filter(args => args[1] === 'tag').length, 0);
    assert.deepEqual(f.builds, []);
  }
  const f = await fixture(t); f.rows.push({ ...f.rows[0], id: '9'.repeat(64) });
  await assert.rejects(prepareCloudSandboxes(f.options), /恰有一个/);
});

test('recipe checks reject tampered inputs, unsupported COPY forms and invalid receipts', async t => {
  const f = await fixture(t);
  await writeFile(join(f.next.path, 'infra/tex-mount.yaml'), 'tampered');
  await assert.rejects(sandboxRecipe(f.next.path, f.next.manifest, 'tex'), /校验失败/);
  for (const copy of ['COPY infra/* /opt/', 'COPY ["infra/tex-mount.yaml", "/opt/"]', 'COPY infra/tex-mount.yaml \\\n /opt/', 'COPY --from=other /mount /opt/']) {
    const g = await fixture(t, { 'infra/tex-sandbox.Dockerfile': `FROM fixed-base\n${copy}\n` });
    await assert.rejects(sandboxRecipe(g.next.path, g.next.manifest, 'tex'), /COPY/);
  }
  const g = await fixture(t);
  for (const receipt of [{ format: 2 }, { format: 1, buildId: 'new-release', images: [] }, { format: 1, buildId: 'new-release', images: { foreign: {} } }]) {
    await assert.rejects(prepareCloudSandboxes({ ...g.options, receipt }), /记录无效/);
  }
});

function cleanupFixture() {
  const buildId = 'old-release';
  const receipt = { format: 1, buildId, images: Object.fromEntries(kinds.map((kind, i) => [kind, { imageId: id(i + 1), recipe: 'unused' }])) };
  const images = new Map(kinds.map((kind, i) => [tag(kind, buildId), id(i + 1)]));
  const containers = [], commands = [], messages = [];
  const docker = async args => {
    commands.push(args);
    if (args[0] === 'image') {
      if (args[1] === 'ls') return images.get(args.at(-1)) ?? '';
      if (args[1] === 'inspect') return images.get(args[2]) ?? '';
      if (args[1] === 'rm') {
        assert.equal(args.length, 3);
        assert.ok(args[2].startsWith('problemforge-'));
        images.delete(args[2]);
        return '';
      }
    }
    if (args[0] === 'ps') {
      assert.deepEqual(args.slice(0, 3), ['ps', '-aq', '--filter']);
      return containers.filter(row => args[3] === `ancestor=${row.imageId}`).map(row => row.id).join('\n');
    }
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
  };
  return { buildId, receipt, images, containers, commands, messages, docker,
    options: { removedReleases: [{ buildId, receipt }], docker, say: text => messages.push(text) } };
}

test('sandbox cleanup defaults to a read-only preview and only removes exact recorded tags on apply', async () => {
  const f = cleanupFixture();
  f.images.set(tag('tex', 'current-release'), id(1));
  const preview = await cleanupCloudSandboxImages(f.options);
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.skipped.map(row => row.reason), ['preview', 'preview']);
  assert.equal(f.commands.some(args => args[1] === 'rm'), false);
  const result = await cleanupCloudSandboxImages({ ...f.options, apply: true });
  assert.deepEqual(result.removed.map(row => row.tag), kinds.map(kind => tag(kind, f.buildId)));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(f.commands.filter(args => args[1] === 'rm'), kinds.map(kind => ['image', 'rm', tag(kind, f.buildId)]));
  assert.equal(f.images.get(tag('tex', 'current-release')), id(1), 'other tags sharing the layer are preserved');
});

test('sandbox cleanup preserves images referenced by current, foreign and stopped containers', async () => {
  for (const state of ['running', 'exited']) {
    const f = cleanupFixture();
    f.images.set(tag('tex', 'current-release'), id(1));
    f.containers.push({ id: 'a'.repeat(64), imageId: id(1), state, project: state === 'running' ? 'problemforge-cloud' : 'foreign' });
    const result = await cleanupCloudSandboxImages({ ...f.options, apply: true });
    assert.equal(result.skipped.find(row => row.kind === 'tex').reason, 'container-reference');
    assert.deepEqual(result.removed.map(row => row.kind), ['judge']);
    assert.equal(f.images.get(tag('tex', f.buildId)), id(1));
    assert.equal(f.images.get(tag('tex', 'current-release')), id(1));
  }
});

test('sandbox cleanup refuses missing, malformed or mismatched receipts before Docker access', async () => {
  for (const receipt of [null, { format: 2 }, { format: 1, buildId: 'another-release', images: {} },
    { format: 1, buildId: 'old-release', images: [] },
    { format: 1, buildId: 'old-release', images: { other: { imageId: id(1) } } },
    { format: 1, buildId: 'old-release', images: { tex: { imageId: '--force' } } }]) {
    const f = cleanupFixture();
    const result = await cleanupCloudSandboxImages({ ...f.options, removedReleases: [{ buildId: f.buildId, receipt }], apply: true });
    assert.deepEqual(result.removed, []);
    assert.equal(f.commands.length, 0);
    assert.equal(receipt ? result.errors.length : result.skipped.length, 1);
  }
  const f = cleanupFixture();
  const result = await cleanupCloudSandboxImages({ ...f.options, removedReleases: [{ buildId: '../foreign', receipt: f.receipt }], apply: true });
  assert.equal(result.errors.length, 1);
  assert.equal(f.commands.length, 0);
});

test('sandbox cleanup preserves retagged images and rechecks image identity immediately before deletion', async () => {
  const f = cleanupFixture();
  f.images.set(tag('tex', f.buildId), id(9));
  const changed = await cleanupCloudSandboxImages({ ...f.options, apply: true });
  assert.equal(changed.errors.length, 1);
  assert.match(changed.errors[0].message, /原记录不一致/);
  assert.equal(f.images.get(tag('tex', f.buildId)), id(9));
  const g = cleanupFixture();
  const raced = await cleanupCloudSandboxImages({ ...g.options, apply: true, docker: async args => {
    const value = await g.docker(args);
    if (args[0] === 'ps' && args.at(-1) === `ancestor=${id(1)}`) g.images.set(tag('tex', g.buildId), id(9));
    return value;
  } });
  assert.equal(raced.errors.length, 1);
  assert.match(raced.errors[0].message, /清理前变化/);
  assert.equal(g.images.get(tag('tex', g.buildId)), id(9));
});

test('sandbox cleanup reports an individual Docker failure and continues without force or global pruning', async () => {
  const f = cleanupFixture();
  const result = await cleanupCloudSandboxImages({ ...f.options, apply: true, docker: async args => {
    if (args[1] === 'rm' && args[2] === tag('tex', f.buildId)) throw new Error('image is now in use');
    return f.docker(args);
  } });
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.removed.map(row => row.kind), ['judge']);
  assert.ok(f.messages.some(message => message.startsWith('警告：')));
  assert.equal(f.images.get(tag('tex', f.buildId)), id(1));
  assert.equal(f.commands.some(args => args.includes('--force') || args.includes('prune')), false);
});

test('sandbox cleanup treats already absent tags and partial receipts as safe skips', async () => {
  const f = cleanupFixture();
  f.images.delete(tag('tex', f.buildId));
  delete f.receipt.images.judge;
  const result = await cleanupCloudSandboxImages({ ...f.options, apply: true });
  assert.deepEqual(result.skipped.map(row => row.reason), ['absent', 'missing-receipt']);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, []);
  assert.equal(f.commands.some(args => args[1] === 'rm'), false);
});
