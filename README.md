# ProblemForge

可自部署的 XCPC 算法竞赛出题工作台。完整范围和轻量开发验证规则见 [AGENT_PROMPT.md](AGENT_PROMPT.md)。这是出题平台；阶段进度见 [docs/PROGRESS.md](docs/PROGRESS.md)。

使用 pnpm workspace、TypeScript、Vue 3 / Vite / Naive UI、Monaco、PDF.js、Fastify、PostgreSQL / Prisma、Redis / BullMQ。业务 API 不执行作者代码，独立 TeX Worker 只调用 Linux go-judge。

开发使用 Node.js 22 LTS（本机实际 22.12.0）、pnpm 10.11.1 和 Docker Linux 引擎。依赖固定在 workspace 和 lockfile；Linux 正式应用镜像与完整部署流程在 P5 补齐。

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
pnpm dev
```

前端：[http://localhost:5180](http://localhost:5180)，API：`127.0.0.1:3100`，登录后的 OpenAPI：`/api/docs`。初始化随机管理员凭据保存在 Git 忽略的 `.local/bootstrap-admin.txt`。本项目使用独立端口 15432 / 16379 / 15050，不复用其他服务或数据库。数据位于 Docker 命名卷及私有 `storage/`。

`demo:init` 只创建三类模板草稿，**不会伪造编译验证或自动发布模板**。管理员在模板中心验证真实样稿、预览 PDF 后发布；题目所有者只能选具体已发布版本。每种稿件独立保存，切换标签/停用格式保留正文。保存使用版本检查，冲突保留本地编辑。

当前已实际运行：登录、题目创建、按语言独立保存三类稿件、私有 PNG/JPEG 资源、管理员模板编辑与版本发布、隔离构建、PDF.js 预览、真实日志、取消/重试、三类分别发布及撤回。题面模板以用户压缩包的 **main.tex 源码版** 为准，保留原封面、主办方页、图片、字体和 olymp 排版；Beamer 来自指定 CWNU 模板。详见 [来源](templates/builtin/SOURCES.md) 和 [模板协议](docs/TEMPLATES.md)。

模板样稿可预览封面→主办方→单题组成的三页题册；多题比赛编排、比赛信息模型、冻结和整场正式出版尚待 P4。参考预览的比赛名称及主办方仅属于该管理员模板。已发布版本不会随磁盘内置样式更新而改变；已有数据库更新内置题面时使用 `pnpm demo:init --new-drafts --only=statement`，再验证、预览、发布，并显式选择新版本。

按范围验证，默认不拉起集成环境：

```sh
pnpm check api web tex-worker
pnpm test:quick template
pnpm test:quick storage
# 以下独立入口需要对应真实服务，按需运行。
pnpm verify:p1
pnpm verify:tex
pnpm verify:tex --kind=STATEMENT
pnpm verify:sandbox
pnpm build:web
```

`test` / `test:quick` 默认只运行固定的模板策略与私有存储快查，也可指定 template / storage 单范围；不自动扩展到新增套件，不运行集成、E2E 或构建。`pnpm verify:publication <题目ID>` 需三类已有成功构建的验证题目，会创建定向验证稿件；具体已执行记录见 PROGRESS。真实执行受限于 Linux 沙箱，不可用时任务明确失败，不执行宿主机 TeX。Judge 数据验收、协作、比赛、题目包、生产部署与恢复尚未实现，保留完整 P2—P5 计划；不要将开发模式直接暴露公网。
