# Linux 部署与恢复

P5 提供单机 Linux Compose 部署。API 同时提供 Vite 的实际生产静态文件，两个独立 Worker 通过各自的 Linux go-judge 执行。数据库和私有文件是恢复依据；Redis 仅承担调度。开发环境的 `.env` 与生产配置、数据库、卷完全分开。

## 首次部署

需要 Docker Linux 引擎、Compose v2、Node.js 22 和 pnpm 10.11.1。下列命令在本仓库根目录执行，不使用其他项目的容器或目录：

```sh
pnpm install --frozen-lockfile
pnpm ops init --env .local/production.env --name problemforge-prod --port 5181
docker compose --env-file .local/production.env -f infra/compose.prod.yml build api tex-sandbox judge-sandbox
pnpm ops up --env .local/production.env
pnpm ops init-admin --env .local/production.env
```

`init` 在忽略目录生成互不相同的随机数据库密码、Redis 密码、沙箱令牌和管理员密码，已有配置拒绝覆盖。查看该本地文件取得登录信息，不将其提交。`init-admin` 不会更改已有管理员密码。`up` 先初始化私有卷所有权、应用全部待执行迁移，再启动 API/Worker 并等待健康。迁移不会重置数据库；失败会阻止应用启动。

默认访问 `http://localhost:5181`；只有 API 的 `127.0.0.1:5181` 映射到宿主机。API 加入入口网络和 internal 后端网络；数据库、Redis、Worker、沙箱没有宿主机端口。API/Worker 使用 uid/gid 10001、只读根目录、删除全部 capabilities、禁止提权和有界 tmpfs/进程/内存，仅挂载本项目私有卷。沙箱服务是专用受信执行组件，容器需要 privileged；作者进程另外运行在非 root、只读工具链和独立命名空间内，沙箱不挂载业务卷或 Docker socket。Docker 主机本身应为可信的 Linux 执行主机。

Node/Postgres/Redis 基础镜像固定摘要；Judge 和 TeX 镜像由仓库中固定版本的 Dockerfile 构建。应用镜像含 Linux Prisma Client、生产前端和运行所需 TypeScript 加载器，服务以 Node 运行，不启用 watch/Vite 开发服务器。镜像有源码及构建依赖，尚未做体积裁剪。正式保存发布镜像时记录 `docker image inspect problemforge-app:p5 --format '{{.Id}}'`；恢复要求与备份清单中的实际镜像 ID 相同。

局域网/域名使用独立 HTTPS 反向代理连接本机 API，并把 `APP_ORIGIN` 改成准确的 HTTPS origin。非回环 HTTP origin 在生产模式拒绝启动，cookie 为 Secure。代理需允许 SSE 持久连接、关闭事件响应缓冲（服务也返回 `X-Accel-Buffering: no`）。本次只实测回环私网入口，未配置域名/TLS 或公网发布。

首次部署没有已发布模板。可在 toolbox 中运行 `scripts/init-demo.ts` 生成六套草稿，再由管理员在模板中心真实验证、预览和发布。模板发布版本不可变，作者代码及管理员模板都只能经沙箱执行。

## 任务、容量与健康

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `TASK_LEASE_MS` | 45000 | RUNNING 任务最后一次续租后的失联阈值 |
| `TASK_MAX_ATTEMPTS` | 3 | 一个任务及其显式重试链的总尝试数 |
| `BUILD_QUOTA` / `JUDGE_QUOTA` | 6 / 3 | 每人 QUEUED + RUNNING 上限 |
| `TEX_CONCURRENCY` / `JUDGE_CONCURRENCY` | 1 / 1 | 各 Worker 消费并发 |
| `STORAGE_QUOTA_BYTES` | 10000000000 | 全实例私有对象的字节容量，包含写入预留 |

提交与重试都固定不可变快照。相同请求键返回同一记录，键与不同输入冲突返回 409；前端在网络或服务器错误时保留未确认提交键。任务只能从 QUEUED 取得一次租约；重复队列投递不能取得 RUNNING 任务的所有权。最终状态提交必须匹配租约，失联旧 Worker 不能覆盖结果。

API 每 5 秒协调数据库与队列，Redis 丢失已投递记录也会补投。RUNNING 租约过期记为 FAILED / `WORKER_INTERRUPTED`，已有部分日志/执行记录保留；用户显式重试形成一条新记录，不把失败结果改写成成功。取消排队任务立即终止，运行中任务请求沙箱中断。自动配送不自动无限执行，手工重试链受上限约束。恢复后的 Redis 可以为空。

编译缓存限定同题，键覆盖源码、profile、执行策略、testlib、工具链和沙箱版本；读取核对实际字节。仅复用成功编译产物，不复用验收 AC 或反例判定。PDF 缓存要求相同对象/用途和完整输入哈希，包括正文、模板、样例/资源及渲染版本，模板验证仍实际执行。两类缓存均有来源标记，仍需当前授权。内容或工具链变化产生新键；损坏缓存重新编译。

文件写入先在数据库全局锁下预留字节，再写私有文件并标记 ready。存储满返回 `STORAGE_QUOTA`，不删除历史版本。崩溃可能留下保守计费的预留；管理员页面显示该数量。历史实例升级后须停止 API 和两个 Worker，再运行 `pnpm exec tsx scripts/storage-account.ts --offline`（容器为 `node --import tsx scripts/storage-account.ts --offline`），登记现存文件并核对容量；超限失败，先扩容。此命令不自动释放无文件的预留或清理历史，容量调整应结合实际留存策略。

`/api/live` 只证明 API 可响应；`/api/health` 核对数据库、Redis、存储访问、两类沙箱版本及 Worker 心跳，异常返回 503。管理员 `/api/admin/operations` 和“运行与审计”界面显示具体检查、用量与进行中任务。审计记录业务操作、租约失联、写接口结果和请求拒绝，不保存密码、会话、CSRF 或请求正文。SSE 按当前会话和对象权限反复检查，撤权关闭连接；重新连接读取数据库最新状态，断线时前端 10 秒回查，没有独立事件历史重放。

## 一致备份与空实例恢复

备份会短暂停止 API 和两个 Worker，停止接受写入。先等待重要运行任务完成；若停止导致中断，保留取消/失败记录。备份脚本拒绝仍有 RUNNING 状态的实例，待协调到终态后重试。QUEUED 记录可以备份并在恢复后自动补投。备份结束或失败会重新启动原应用，不停止数据库。

```sh
pnpm ops backup --env .local/production.env --out .local/backups/snapshot-01
pnpm ops init --env .local/restore.env --name problemforge-restore --port 5182
# 设置 restore.env 的 PF_APP_IMAGE，确保实际镜像 ID 与备份一致。
pnpm ops restore --env .local/restore.env --from .local/backups/snapshot-01
```

备份目录包含 PostgreSQL custom dump、私有卷 tar、登记文件/迁移/对象计数的 state.json，以及逐文件 SHA-256 和镜像 ID 的 manifest.json。只有全部成功才生成 manifest；未完成目录不当作备份。目录已存在拒绝覆盖。配置与随机密钥不写进备份包，应另行保管；包中含私有题目、密码哈希和会话哈希，需要私有保存，当前不内置备份加密或异地上传。

恢复只接受不同 project 名称、未运行过应用、无表的数据库和空私有卷；不提供覆盖原库模式。先校验摘要、tar 路径和文件类型，再恢复数据库与文件；逐项核对所有 ready 对象字节/哈希、八个迁移的 SQL 校验和及业务计数，相同后才启动应用。恢复失败保留现场，不能跳过检查继续运行。不要使用 `down -v` 删除来源卷。

恢复的是原数据库账号：原用户密码继续有效，恢复配置中随机生成的初始化管理员密码不替换原密码。数据库/Redis/沙箱连接凭据用恢复实例的新配置。Redis 不从备份复制，数据库中的排队记录重新配送；历史成功/失败、冻结修订、发布/撤回状态保留。镜像升级应在相同版本恢复验收后另行执行迁移。

本机 `p5-proof` 备份对应的镜像已另标为 `problemforge-app:p5-backup-20261001`，恢复配置固定使用该标签。当前 5181 部署的 `problemforge-app:p5` 在收尾加入取消时序修复；不要用移动后的 p5 标签代替备份清单中的原镜像 ID。要把已验收的恢复实例升级到当前版本，应另行修改其镜像配置并执行 `ops up`，保留原备份及卷。

## 显式验证与本机演练

`pnpm check:affected --base <commit>` 分析变更及 workspace 下游依赖，执行选中的类型检查和固定轻量检查；缺失差异基准直接报错，不隐式回退全量。`--files <paths>` 可给出明确范围，`--plan` 只显示计划。GitHub 默认工作流按该规则检查；生产 Docker 构建是独立手动工作流，不推送镜像。

P5 验证脚本不进入默认 test/CI。`verify:p5:runtime` 使用开发 `.env` 及先前 P2/P4 的本地凭据和示范题，创建独立副本，验证幂等、真实缓存、并发容量、实时撤权和租约故障注入。它要求开始时无 TeX 任务，短暂暂停该验证队列。

本机完整部署演练使用 `.local/p5-prod.env` / `problemforge-p5` / 5181，恢复实例使用 `.local/p5-restore.env` / `problemforge-p5-restore` / 5182。先按首次部署流程构建/启动并初始化管理员，再按下列顺序执行：

```sh
pnpm verify:p5:deployment --templates
# 查看 .local/p5-deployment/template-*.pdf 所有页后：
pnpm verify:p5:deployment --reviewed-templates
pnpm verify:p5:recovery
pnpm verify:p5:restore --prepare
pnpm ops backup --env .local/p5-prod.env --out .local/backups/p5-proof
pnpm ops init --env .local/p5-restore.env --name problemforge-p5-restore --port 5182
pnpm ops restore --env .local/p5-restore.env --from .local/backups/p5-proof
pnpm verify:p5:restore
```

部署脚本从已有 P4 `verify-p4-contest.json` 三题固定修订导出原生包，在新实例重绑已审核模板、实际验收、冻结比赛并生成三份 PDF。故障脚本只允许专用 `problemforge-p5`，实际 SIGKILL Judge Worker、等待租约失效、检查保留证据和显式重试，再移除一条 Redis 调度记录验证补投。`--prepare` 停止专用 Judge Worker 并提交排队任务，应立即执行后面的备份命令，由备份恢复 Worker；不要对有其他使用者的实例运行故障演练。验证脚本创建真实数据，反复运行会保留新增及失败记录，连续登录也受正常限流约束。

两类部署沙箱可分别在 toolbox 中运行 `node --import tsx scripts/verify-sandbox.ts --stdout` 和 `--judge --stdout` 检查，命令不向只读应用目录写证明文件。所有作者代码执行仍由 Linux 沙箱完成。具体完成记录、PDF/截图和未测范围见 [PROGRESS.md](PROGRESS.md)。

## 可追踪版本与升级（P7）

`pnpm build:release <唯一构建标识>` 要求已检查、提交的干净工作区，直接将 `git archive HEAD` 输入 Docker，确保忽略目录中的配置、凭据和运行数据不会进入构建。构建标识仅使用小写字母、数字、点、下划线和连字符，已有标识或镜像标签拒绝覆盖。结果为 `problemforge-app:<标识>` 和 `.local/releases/<标识>.json`，记录 Git 提交、Git 树、构建时间及实际镜像 ID。镜像内 `release.json` 另含全部迁移校验和；管理员运行页面显示实际装载的版本和数据库迁移是否一致。普通 Compose 构建没有 Git 参数时明确显示 unversioned，不冒充发布版本；开发服务显示 development。

升级前先一致备份并保存原镜像 ID 和部署配置。在独立 project 恢复匹配版本的备份并验收，再停止应用/Worker，修改该目标配置的 `PF_APP_IMAGE`，运行 `pnpm ops up --env <目标配置>` 应用迁移和启动新版本。核对运行页面和 `docker inspect <project>-api-1 --format '{{.Image}}'`，检查原冻结修订及私有产物。重启后复核。

只有数据库和安全语义均兼容时，才可以停止应用后改回旧镜像、重新启动。P5 → P6 新增账号重置与会话语义，不能直接换回 P5 镜像绕过这些规则；应将 P5 匹配的旧备份恢复到另一个空 project，核对后再决定入口切换。恢复旧备份不会包含备份后的新数据。脚本不反向执行迁移，不覆盖来源卷，不自动切换用户入口。

本项目升级定向脚本为 `pnpm verify:p7:upgrade --env .local/<演练配置>.env --label <记录名> --release .local/releases/<标识>.json`，只允许 problemforge-p7 前缀的独立实例；复用原 P5 三题/三份 PDF 证据与账号。`--p5` 校验原版恢复，`--baseline` 校验保留 P6 能力的兼容回退镜像，不冒充该基线具备后来新增的版本面板。检查只读取旧报告与产物，不创建 Judge/TeX 任务。
