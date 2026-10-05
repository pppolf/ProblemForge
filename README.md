# ProblemForge

可自部署的 XCPC 算法竞赛出题工作台。完整范围和轻量开发验证规则见 [AGENT_PROMPT.md](AGENT_PROMPT.md)。这是出题平台；阶段进度见 [docs/PROGRESS.md](docs/PROGRESS.md)。

使用 pnpm workspace、TypeScript、Vue 3 / Vite / Naive UI、Monaco、PDF.js、Fastify、PostgreSQL / Prisma、Redis / BullMQ。业务 API 不执行作者代码；独立 TeX / Judge Worker 只调用各自的 Linux go-judge。

开发使用 Node.js 22 LTS（本机实际 22.12.0）、pnpm 10.11.1 和 Docker Linux 引擎。依赖固定在 workspace 和 lockfile；P5 提供 Linux 应用镜像、私网 Compose 和备份/空实例恢复，操作见 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。

```sh
cp .env.example .env
# 全新环境：编辑 .env，配置数据库/Redis、沙箱令牌和 PF_ADMIN_PASSWORD（12—256 字符）。
# ASSOCIATION_APP_KEY 供普通用户登录使用，超级管理员不依赖它。
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm admin:init --email admin@example.org
# 初始化后可从配置中移除 PF_ADMIN_PASSWORD，登录使用数据库中的密码哈希。
pnpm demo:init
pnpm infra:tex
pnpm infra:judge
pnpm dev
```

前端：[http://localhost:5180](http://localhost:5180)，API：`127.0.0.1:3100`，登录后的 OpenAPI：`/api/docs`。超级管理员选择「超级管理员登录」，使用独立本地邮箱与密码，不需要 APPKEY 或协会 userId；普通用户选择协会账号或邮箱与密码登录，APPKEY 留空时仅协会入口不可用。详见 [账号说明](docs/ACCOUNTS.md)。本项目使用独立端口 15432 / 16379 / 15050 / 15051，不复用其他项目的服务或数据库。数据位于 Docker 命名卷及私有 `storage/`。

`demo:init` 创建每类两套、共六套模板草稿，**不会伪造编译验证或自动发布模板**。管理员在模板中心验证真实样稿、预览 PDF 后发布；题目所有者只能选具体已发布版本。每种稿件独立保存，切换标签/停用格式保留正文。保存使用版本检查，冲突保留本地编辑。

此前阶段已实际运行：本地登录、题目创建、按语言独立保存三类稿件、私有 PNG/JPEG 资源、管理员模板编辑与版本发布、隔离构建、PDF.js 预览、真实日志、取消/重试、三类分别发布及撤回。题面模板以用户压缩包的 **main.tex 源码版** 为准，保留原封面、主办方页、图片、字体和 olymp 排版；Beamer 来自指定 CWNU 模板。详见 [来源](templates/builtin/SOURCES.md) 和 [模板协议](docs/TEMPLATES.md)。

2026-10-02 已移除审批，普通用户接入协会登录，超级管理员使用独立本地密码。原管理员在 APPKEY / userId 为空时已实际登录；接口模拟与原库回滚验证通过，真实协会登录仍待 APPKEY 联调。原审批和本地密码要求以这次用户调整为准。

P4 已接入比赛编排、独立成员、聚合修订与直接冻结和整场正式出版。三类材料均使用统一源码组装，题解可以独立选择和发布，Beamer 讲解顺序保留原题号。参考预览的比赛名称及主办方仅属于该管理员模板。已发布版本不会随磁盘内置样式更新而改变；已有数据库更新内置题面时使用 `pnpm demo:init --new-drafts --only=statement`，再验证、预览、发布，并显式选择新版本。

比赛自动同步题目最新保存的内容，已有比赛无需重新选题；生成资料和题包默认固定最新内容，也可显式选择历史冻结版本。当前验收仍需有效，历史产物保持原内容。定向验证：`node --import tsx scripts/verify-contest-sync.ts --rollback`（真实 API / 原库回滚事务，队列与存储使用内存替身，不运行 Judge / TeX）。

P2 接入 C++17 / C++20 / Python 3，并按用户后续要求新增 C17 / C++23 / Java（JDK 17）；支持管理员编译配置、原始字节测试数据、受限 ZIP、argv/种子生成计划、固定 testlib Validator / Checker、自测、主标程答案与验收矩阵。文件 I/O、取消、版本冲突、依赖失效和私有下载均通过实际路径检查。题面样例绑定不可变数据版本，升级需显式选择。多解 SPJ 与严格行格式代表题已实际执行；语言入口、工具链支持范围、协议和边界见 [Judge 文档](docs/JUDGE.md)。

P3 已接入有预算对拍、原始反例保存/复现/显式入库、真实双向交互与有界通信记录、数据组和依赖 DAG、整组或加权部分分及分数预期。工作区可保存配置、运行/取消、刷新查看历史结果与私有下载；分组标签需显式映射到固定数据版本。

P4 还提供题目检索/标签/负责人/备注/归档/复制、用户组和限定语言翻译权限、版本评论/差异/CAS/回滚为新修订、六种用途独立题包及发布撤回。原生 FULL 包可往返为私有草稿；Polygon 离线子集先检查兼容报告，未转换内容留在隔离包。具体可映射字段、阻塞项和外部未验证范围见 [题包协议](docs/PACKAGES.md)。

P5 加入数据库任务租约、Redis 丢失补投、失联失败与有限显式重试、同题编译缓存及固定快照 PDF 缓存。缓存记录注明来源与未重新执行；下载继续按当前权限检查。并发任务和私有文件写入原子计量；SSE 更新任务状态，断线后有限频率回查。管理员的“运行与审计”页面显示依赖健康、配额和操作记录。

按范围验证，默认不拉起集成环境。当前登录与冻结定向验证：`pnpm verify:access`，使用原库中必定回滚的事务与模拟远端响应，不开端口、不发外网请求。模板重命名、独立复制及工作区文件保存定向验证：`pnpm verify:templates`，同样使用原库必定回滚事务，不新增用户、模板或真实构建。文件上传/替换的纯数据检查：`node --import tsx --test scripts/template-files.test.ts`。以下 P0—P7 集成脚本保留历史验收用途，其本地密码账号夹具不能直接用于新登录，须另行适配授权的协会测试账号；本轮未运行这些历史脚本。

六语言编译与判题定向验证：`pnpm verify:languages`，显式使用现有 Linux Judge 沙箱，原库测试夹具必定回滚、产物仅保存在内存；覆盖六语言验收/缓存和 Java 17 的文件 I/O、交互、TLE/MLE，不新增端口或持久测试数据，不加入默认快查。

```sh
pnpm check api web tex-worker
pnpm check judge-core judge-worker
pnpm test:quick template
pnpm test:quick storage
pnpm test:quick judge
pnpm test:quick p3
pnpm test:quick contest
# 以下独立入口需要对应真实服务，按需运行。
pnpm verify:p1
pnpm verify:tex
pnpm verify:tex --kind=STATEMENT
pnpm verify:sandbox
pnpm verify:sandbox --judge
pnpm verify:p2
# 需上一步的验证题、已发布题面模板及真实 TeX Worker
pnpm verify:p2:results
# 以下三个独立范围需要 API / DB / Redis / Judge Worker，以及 verify:p2 的本地出题人凭据；不依赖 TeX
pnpm verify:p3:stress
pnpm verify:p3:interaction
pnpm verify:p3:groups
# P4 独立范围：先准备已验证 P2/P3 题与每类两套已发布模板。
pnpm verify:p4:collaboration
pnpm verify:p4:contest
# packages 读取上一步的三题比赛证据；boundaries 使用 packages 创建的私有副本。
pnpm verify:p4:packages
pnpm verify:p4:boundaries
# CI 先报告变更及下游范围；不默认运行集成或生产构建。
pnpm check:affected --base <commit> --plan
pnpm check:affected --base <commit>
# P5 使用隔离的演练实例，前置数据和顺序见 DEPLOYMENT。
pnpm verify:p5:runtime
pnpm verify:p5:deployment --templates
# 逐页查看上一步的实际 PDF 后继续：
pnpm verify:p5:deployment --reviewed-templates
pnpm verify:p5:recovery
pnpm build:web
```

`test` / `test:quick` 默认只运行固定的模板策略与私有存储快查，也可指定 template / contest / storage / judge / p3 单范围；不自动扩展到新增套件，不运行集成、E2E 或构建。`pnpm verify:publication <题目ID>` 需三类已有成功构建的验证题目，会创建定向验证稿件；具体已执行记录见 PROGRESS。真实执行受限于 Linux 沙箱，不可用时任务明确失败，不执行宿主机 TeX 或作者程序。正式运行使用生产 Compose，默认仅监听本机回环；本次交付没有向公网发布。

团队首次试用见 [详细使用说明](docs/USER_GUIDE.md)，固定使用主目录原有 `http://localhost:5180`、原开发数据库与模板，包含登录、从零 A+B、验收冻结、比赛资料、题包和故障排查；网页侧栏「使用指引」提供简版。2026-10-02 已按用户要求备份并清空所有题目、比赛及关联内容，删除其他用户和全部旧会话，只保留原系统管理员 `admin-f054@problemforge.local`、6 套模板 / 13 个发布版本和编译配置。该管理员现可通过独立入口使用原本地密码登录，无需绑定协会。部署/恢复演练容器已全部清理，不用演练环境替代用户开发版，不擅自新增端口。当前状态以 PROGRESS 最新交接为准。编辑冲突可查看、下载或复制本地草稿，再与服务端版本手动合并。显式定向验收：`pnpm verify:p6:editing`（隔离数据库并发写入和延迟保存合并，不启动 Judge/TeX）。

版本镜像入口为 `pnpm build:release <构建标识>`；加密备份与只读容量维护见 [维护说明](docs/MAINTENANCE.md)。定向检查 `pnpm verify:p7:maintenance` 不加入默认快查。

Ubuntu 22.04/24.04 的 Caddy + PM2 一键部署见 [部署说明](docs/CADDY_PM2.md)。`pnpm package:cloud <版本标识>` 生成不含密钥和题库数据的上传包；服务器解压后执行 `sudo bash deploy.sh --secrets-file ../problemforge.secrets.json`。默认域名 `problems.cwnupaa.com`，PM2 运行 2 个 API 进程，两个 Worker 与 Linux 执行沙箱独立管理。

从 GitHub 克隆的仓库先使用 `node scripts/package-cloud.mjs` 生成带校验清单的发布目录，再执行其中的部署入口；完整首次拉取和后续 `git pull --ff-only` 步骤见上述部署说明的「从 GitHub 拉取部署」。APPKEY 单独上传到服务器，源码仓库不包含私有配置或现有题库数据。
