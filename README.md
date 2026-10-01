# ProblemForge

可自部署的 XCPC 算法竞赛出题工作台。完整范围和轻量开发验证规则见 [AGENT_PROMPT.md](AGENT_PROMPT.md)。这是出题平台；阶段进度见 [docs/PROGRESS.md](docs/PROGRESS.md)。

使用 pnpm workspace、TypeScript、Vue 3 / Vite / Naive UI、Monaco、PDF.js、Fastify、PostgreSQL / Prisma、Redis / BullMQ。业务 API 不执行作者代码；独立 TeX / Judge Worker 只调用各自的 Linux go-judge。

开发使用 Node.js 22 LTS（本机实际 22.12.0）、pnpm 10.11.1 和 Docker Linux 引擎。依赖固定在 workspace 和 lockfile；P5 提供 Linux 应用镜像、私网 Compose 和备份/空实例恢复，操作见 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。

```sh
cp .env.example .env
# 编辑 .env，配置独立随机密码和沙箱令牌。不要使用 CHANGE_ME。
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm admin:init --email admin@example.org --generate-password
pnpm demo:init
pnpm infra:tex
pnpm infra:judge
pnpm dev
```

前端：[http://localhost:5180](http://localhost:5180)，API：`127.0.0.1:3100`，登录后的 OpenAPI：`/api/docs`。初始化随机管理员凭据保存在 Git 忽略的 `.local/bootstrap-admin.txt`。本项目使用独立端口 15432 / 16379 / 15050 / 15051，不复用其他项目的服务或数据库。数据位于 Docker 命名卷及私有 `storage/`。

`demo:init` 创建每类两套、共六套模板草稿，**不会伪造编译验证或自动发布模板**。管理员在模板中心验证真实样稿、预览 PDF 后发布；题目所有者只能选具体已发布版本。每种稿件独立保存，切换标签/停用格式保留正文。保存使用版本检查，冲突保留本地编辑。

当前已实际运行：登录、题目创建、按语言独立保存三类稿件、私有 PNG/JPEG 资源、管理员模板编辑与版本发布、隔离构建、PDF.js 预览、真实日志、取消/重试、三类分别发布及撤回。题面模板以用户压缩包的 **main.tex 源码版** 为准，保留原封面、主办方页、图片、字体和 olymp 排版；Beamer 来自指定 CWNU 模板。详见 [来源](templates/builtin/SOURCES.md) 和 [模板协议](docs/TEMPLATES.md)。

P4 已接入比赛编排、独立成员、聚合修订审核/冻结和整场正式出版。三类材料均使用统一源码组装，题解可以独立选择和发布，Beamer 讲解顺序保留原题号。参考预览的比赛名称及主办方仅属于该管理员模板。已发布版本不会随磁盘内置样式更新而改变；已有数据库更新内置题面时使用 `pnpm demo:init --new-drafts --only=statement`，再验证、预览、发布，并显式选择新版本。

P2 接入 C++17 / C++20 / Python 3、管理员编译配置、原始字节测试数据、受限 ZIP、argv/种子生成计划、固定 testlib Validator / Checker、自测、主标程答案与验收矩阵。文件 I/O、取消、版本冲突、依赖失效和私有下载均通过实际路径检查。题面样例绑定不可变数据版本，升级需显式选择。多解 SPJ 与严格行格式代表题已实际执行；协议、比较语义和边界见 [Judge 文档](docs/JUDGE.md)。

P3 已接入有预算对拍、原始反例保存/复现/显式入库、真实双向交互与有界通信记录、数据组和依赖 DAG、整组或加权部分分及分数预期。工作区可保存配置、运行/取消、刷新查看历史结果与私有下载；分组标签需显式映射到固定数据版本。

P4 还提供题目检索/标签/负责人/备注/归档/复制、用户组和限定语言翻译权限、版本评论/差异/CAS/回滚为新修订、六种用途独立题包及发布撤回。原生 FULL 包可往返为私有草稿；Polygon 离线子集先检查兼容报告，未转换内容留在隔离包。具体可映射字段、阻塞项和外部未验证范围见 [题包协议](docs/PACKAGES.md)。

P5 加入数据库任务租约、Redis 丢失补投、失联失败与有限显式重试、同题编译缓存及固定快照 PDF 缓存。缓存记录注明来源与未重新执行；下载继续按当前权限检查。并发任务和私有文件写入原子计量；SSE 更新任务状态，断线后有限频率回查。管理员的“运行与审计”页面显示依赖健康、配额和操作记录。

按范围验证，默认不拉起集成环境：

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

团队首次试用见 [操作指引](docs/USER_GUIDE.md)，网页侧栏也有对应入口。编辑冲突可查看、下载或复制本地草稿，再与服务端版本手动合并。显式定向验收：`pnpm verify:p6:editing`（隔离数据库并发写入和延迟保存合并，不启动 Judge/TeX）。

版本镜像入口为 `pnpm build:release <构建标识>`；加密备份与只读容量维护见 [维护说明](docs/MAINTENANCE.md)。定向检查 `pnpm verify:p7:maintenance` 不加入默认快查。
