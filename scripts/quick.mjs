import { spawnSync } from 'node:child_process';
// A fixed, small default. Never glob future suites or run integration/build commands.
const scope = process.argv[2] ?? 'quick';
const suites = { quick: ['packages/template-engine/src/policy.test.ts', 'packages/storage/src/storage.test.ts'], template: ['packages/template-engine/src/policy.test.ts'], storage: ['packages/storage/src/storage.test.ts'] };
if (!suites[scope]) {
  console.error('可用范围：pnpm test:quick [template|storage]。未知范围未执行测试。');
  process.exit(2);
}
console.log(`轻量检查 ${scope}：${suites[scope].length} 个指定文件；不运行 E2E、真实 TeX、Judge 或生产构建。`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...suites[scope]], { stdio: 'inherit' });
process.exit(result.status ?? 1);
