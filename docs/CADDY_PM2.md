# Ubuntu 一键部署：Caddy + PM2

适用于 Ubuntu 22.04 / 24.04 x86_64。域名默认为 `problems.cwnupaa.com`，安装目录为 `/opt/problemforge`。API 由 PM2 cluster 运行 2 个进程，共享回环端口 5181；TeX 和 Judge 各 1 个独立 Worker。Caddy 使用服务器现有服务负责 HTTPS 和反代，PostgreSQL、Redis、两个执行沙箱由本项目专用 Docker Compose 管理。

用户现有 Caddyfile 在 `/root/.hydro/Caddyfile` 时，直接按 [Hydro Caddy 分步命令](DEPLOY_HYDRO_CADDY.md) 操作，首次传入 `infra/cloud-settings.hydro.json`。该模式通过 Caddy 自身的管理接口平滑重载，兼容 PM2 管理的 Caddy，不要求 caddy.service。

## 首次部署

服务器需已具备：Node.js 22.12+ 或 24、**pnpm 10.11.1**、PM2、rootful Docker 与 Compose v2，以及正在运行的 Caddy。默认配置使用 `/etc/caddy/Caddyfile` 和 caddy.service；自定义路径可用 `caddyFile` 指定，`caddyReload: "caddy"` 通过 Caddy CLI 重载。Node、pnpm、PM2 必须能由专用系统用户读取和执行；仅装在 `/root/.nvm` 下的工具通常不满足此条件。脚本会检查系统与工具，不自动改变其他站点依赖的全局版本。

域名解析到目标云主机，服务器允许 Caddy 接收入站 80/443。Caddyfile 可保留已有其他站点；目标域名首次接入时应尚未被现有非托管站点块占用。首次构建需要访问 npm registry、Docker 镜像仓库和 Debian 软件源，TeX / Judge 镜像构建可能持续数分钟。

将交付的 `problemforge-caddy-pm2-<版本>.tar.gz`、对应 `.sha256` 和私有 `problemforge.secrets.json` 上传到同一目录。源码包不包含 APPKEY、数据库、私有题目文件或本机 `.env`；私有 JSON 单独保存 APPKEY，可选 `adminEmail`。示例见 [cloud-secrets.example.json](../infra/cloud-secrets.example.json)。

```sh
sha256sum -c problemforge-caddy-pm2-<版本>.tar.gz.sha256
chmod 600 problemforge.secrets.json
tar -xzf problemforge-caddy-pm2-<版本>.tar.gz
cd problemforge
sudo bash deploy.sh --secrets-file ../problemforge.secrets.json
```

最后一条即部署命令。执行前也可用 `bash deploy.sh plan` 查看默认进程、端口和操作步骤，不启动服务或修改系统。APPKEY 不通过命令行参数值传入，不写到前端、Git、PM2 的进程配置或源码包。

脚本按清单核对源码哈希，创建专用 `problemforge` 用户和私有配置，安装锁定依赖并构建生产前端；构建两类独立 Linux 沙箱，启动专用数据库和 Redis，应用数据库迁移；首次初始化独立管理员及六套内置模板草稿，启动 PM2。模板仍需管理员实际编译、预览后发布。

本机完整健康检查通过后，脚本备份 Caddyfile，只追加/更新带 `PROBLEMFORGE MANAGED SITE` 标记的本站配置，验证后 reload；保留其他站点内容。已有同域名配置、配置并发修改、无效 Caddyfile 会停止操作。Caddy 自动办理证书，最后以真实域名 HTTPS 健康检查为成功条件；响应还必须匹配本站随机部署标识，避免域名误指向其他健康实例时误报成功。

管理员初始密码随机生成，默认邮箱 `admin@problems.cwnupaa.com`；可在首次私有 JSON 中改 `adminEmail`。在服务器查看凭据：

```sh
sudo cat /opt/problemforge/shared/bootstrap-admin.txt
```

管理员使用 `/login?mode=admin`，首次登录后可在账户设置改密。普通用户使用协会账号或邮箱登录。重复部署保留管理员身份、密码、APPKEY、数据库密钥和存储；不会重新随机生成或覆盖它们。

## 从 GitHub 拉取部署

也可以在服务器克隆公开仓库 [pppolf/ProblemForge](https://github.com/pppolf/ProblemForge)，读取源码无需 GitHub 登录。先按上文准备 Node、pnpm、PM2、Docker 和 Caddy，将单独交付的 `problemforge.secrets.json` 放在克隆目录旁，首次执行：

```sh
git clone https://github.com/pppolf/ProblemForge.git ProblemForge
cd ProblemForge
pf_build="git-$(git rev-parse HEAD)"
pf_release="$PWD/.local/releases/cloud-$pf_build/problemforge"
if [ ! -f "$pf_release/cloud-release.json" ]; then
  node scripts/package-cloud.mjs "$pf_build"
fi
sudo bash "$pf_release/deploy.sh" --secrets-file "$PWD/../problemforge.secrets.json"
```

Git 仓库保存源码，`cloud-release.json` 和 `release.json` 在打包时生成。因此需要先生成上面的固定发布目录，再调用其中的 `deploy.sh`；直接在新克隆的仓库根目录运行安装会提示缺少清单。打包只用 Git、Node 和 tar，无需提前安装项目 node_modules；服务器部署过程会安装项目依赖。密钥不要提交到 GitHub，根目录同名私有 JSON 也已加入忽略规则。

以后升级先在克隆目录执行 `git pull --ff-only`，再运行上面的 `pf_build` 至 `sudo bash` 部分。同一 Git 提交复用同一构建标识，失败时重试原命令；有未完成迁移时先完成当前版本，不先拉取其他版本。已有站点会继续使用服务器保存的私有配置，升级不要求再次上传密钥文件。保持克隆目录的源码干净，服务器修改放在 `/opt/problemforge/shared`，不要直接修改发布目录中的代码。

## 目录、进程和访问边界

| 位置 / 端口 | 用途 |
| --- | --- |
| `/opt/problemforge/releases/<版本>` | 独立构建的版本代码；构建完成后归 root 所有，应用用户只读 |
| `/opt/problemforge/current` | 当前通过本机健康检查的版本链接 |
| `/opt/problemforge/shared/storage` | 持久化私有题目、程序、数据和产物 |
| `shared/app.env` / `api.env` | 应用配置 / API 专用协会 APPKEY，权限 640；Worker 不加载 api.env |
| `shared/infra.env` / `bootstrap-admin.txt` | 容器密钥 / 初始管理员凭据，权限 600 |
| `shared/pm2` / `logs` | 本项目专用 PM2_HOME / 日志；与服务器其他 PM2 进程组独立 |
| `shared/backups` | 升级或手动生成的数据库、文件和哈希清单，目录权限 700 |
| `127.0.0.1:5181` | PM2 API cluster，共同提供生产网页、API 和 SSE |
| `127.0.0.1:25432 / 26379` | 专用 PostgreSQL / Redis |
| `127.0.0.1:25050 / 25051` | TeX / Judge 独立 Linux 沙箱，需各自令牌 |

Docker Compose project 固定为 `problemforge-cloud`，首次发现同名已有资源会拒绝接管。只有沙箱容器 privileged；应用用户不加入 Docker 组。作者程序和 TeX 继续仅通过沙箱执行，不在 PM2 宿主机直接编译或执行。

会话、权限、任务与存储配额继续由 PostgreSQL / Redis 共享。登录限流使用 Redis，API 只信任 Caddy 的 `127.0.0.1/32`，Caddy 覆盖外部转发头。每用户 SSE 上限为跨 API 进程共 5 个，使用 Redis 租约，崩溃后 30 秒内释放；reload 主动关闭连接，浏览器按已有重连机制恢复。Caddy 对 `text/event-stream` 自动即时刷新，不设置无限缓冲或对写请求自动重试。

首次需要其他空闲回环端口或 2—8 个 API 进程时，可通过 `--settings-file` 指定 JSON，例如：

```json
{
  "domain": "problems.cwnupaa.com",
  "instances": 2,
  "ports": { "api": 5181, "postgres": 25432, "redis": 26379, "tex": 25050, "judge": 25051 }
}
```

配置只在首次创建实例时写入，升级使用原配置；不直接手工改其中一个环境文件来迁移端口。脚本拒绝占用原开发环境 5180/3100。本机开发环境继续使用原入口和原库。

Caddy 自定义示例：`{"caddyFile":"/root/.hydro/Caddyfile","caddyReload":"caddy"}`，与上面的域名/进程/端口字段放在同一个 JSON 中。CLI 重载模式先验证该文件，并读取配置中的回环管理地址（默认 localhost:2019），确认运行配置与文件一致后才允许追加本站；不会自动接管运行中的未保存配置。需要启用本地 TCP 管理接口；关闭管理接口、非回环地址或 Unix socket 会明确拒绝，需先确定实际管理方式。备份、同目录候选文件、相对 import 和重载失败恢复均使用指定路径，保留已有其他站点。

直接以 `caddy run` 启动的实例可能使用相对 `Caddyfile`，与绝对路径适配结果的自动隐藏文件列表不同。安装器尝试两种文件名表示，只有完整 JSON 匹配才继续，重载和失败恢复沿用匹配的表示。可从源码目录运行 `node scripts/cloud-deploy.mjs check-caddy --settings-file infra/cloud-settings.hydro.json` 进行只读检查；失败时仅显示差异字段路径，不输出配置值。

## 状态、重载、升级和备份

```sh
sudo bash /opt/problemforge/current/deploy.sh status
sudo bash /opt/problemforge/current/deploy.sh reload-api
sudo bash /opt/problemforge/current/deploy.sh backup
```

`status` 检查 API / 两个 Worker 的进程数、本机全部依赖及域名 HTTPS。`reload-api` 只滚动重载同一版本的 API，不执行迁移或重启 Worker；已有 SSE 会重新连接。PM2 仅控制本项目三个名称的进程，发现未知进程则拒绝维护操作。

升级：把新源码包解压到新的上传目录，在其中执行 `sudo bash deploy.sh`。无需再次传入私有 JSON。先构建新版本，再要求无排队/执行任务和未完成存储预留，关闭本项目 API、再次检查后停止 Worker；保存原库 `pg_dump`、完整私有文件、业务计数/文件哈希和备份清单，才开始迁移和切换。升级会有短暂维护窗口，不承诺零停机数据库升级。

迁移开始前失败会恢复原进程。迁移开始后失败不会自动运行旧版本或反向修改数据库；`pending-deploy.json` 保留待完成版本和原备份位置，只允许检查状态或重试同一个部署包。新应用不健康时会停下；应用本机健康但 HTTPS 失败时保留新应用，修复域名/Caddy 后重试同一部署包完成收尾。

备份文件是服务器私有目录中的原始数据，不是对外分发包；如需异机保存，按 [维护说明](MAINTENANCE.md) 的密钥管理原则加密并独立保管。当前一键入口提供部署、重载、升级前备份和手动备份；没有提供覆盖现有数据库的自动回退。恢复需按备份版本在空目标完成数据库和全部文件校验，再进行版本升级。

`problemforge-pm2.service` 用于开机恢复已保存的本项目 PM2 进程组；不替换其他 PM2 服务。日志由 `/etc/logrotate.d/problemforge` 轮转，容器 JSON 日志也有大小与份数限制。当前运行的 PM2 无需为安装开机服务而被强制关闭，实际主机重启仍属于云端验收。

## 打包与验证范围

开发者在干净的已提交工作区执行 `pnpm package:cloud <版本标识>`，输出位于 Git 忽略的 `.local/releases/`。包包含来源提交、迁移清单及逐文件 SHA-256，打包器拒绝私有数据路径、路径越界和符号链接；部署前重新核对，不复制开发 node_modules。

定向入口：`node --test scripts/cloud-deploy.test.mjs`；跨进程 SSE 的实 Redis 检查为 `PF_VERIFY_REDIS=1 node --import tsx --test apps/api/src/stream-lease.test.ts`，仅使用随机验证键并清理；默认快查没有扩展。`scripts/verify-cloud-runtime.mjs --build-check` 是独立 Linux 构建检查，用无 HTTP 监听、无应用数据库的夹具核对真实 PM2 的 ESM / tsx 加载、环境文件、两个 cluster 进程及重载信号，同时运行 Caddy adapt/validate。

2026-10-05 实际通过：11 项部署定向检查、API 与初始化脚本类型检查、生产前端构建、Compose 配置解析、跨客户端 Redis 租约检查；独立 Linux 构建使用 Caddy 2.10.2 和 PM2 7.0.4，确认首次守护进程启动、两个 API 夹具进程及 reload 后旧进程正常退出。生产依赖审计为 0 条告警。这里的版本是本次验证环境记录，服务器现有工具仍须通过脚本预检。

当前原 Windows 数据库和 `.local/p3-storage` **没有装入部署包**；首次命令建立新站。已有题库、比赛和发布模板的迁移继续按 [上云清单](CLOUD_READINESS.md) 单独做一致备份和空目标恢复。目标 Ubuntu 主机、真实证书、协会成功登录、实际 Judge / TeX、系统重启、迁移恢复尚须云端验收；本地脚本检查或无监听 PM2 夹具不代表已经上线。

配置依据：[PM2 cluster](https://pm2.keymetrics.io/docs/usage/cluster-mode/)、[PM2 启停信号](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)、[PM2 开机恢复](https://pm2.keymetrics.io/docs/usage/startup/)、[Caddy 反向代理与 SSE](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[Caddy 请求大小](https://caddyserver.com/docs/caddyfile/directives/request_body)、[Caddy 配置验证](https://caddyserver.com/docs/command-line#caddy-validate)。
