# 上云准备与待办（2026-10-05）

核心出题、判题、TeX、比赛及导出流程已实现，生产 Compose、版本镜像和备份恢复有本机演练记录。用户已确定 Ubuntu 22.04/24.04、Caddy + PM2 和域名 `problems.cwnupaa.com`，并提供协会 APPKEY；[一键部署入口](CADDY_PM2.md) 已实现并通过本地定向检查，依赖安全更新已完成。下一步是目标主机验收与原数据一致迁移。服务器规格/访问方式、访问范围和预计并发仍待确认，目前没有连接云服务器、切换入口或开放新端口。

## 必须先完成

| 顺序 | 项目 | 当前证据与下一步 |
| --- | --- | --- |
| 1 | 依赖安全更新 | 2026-10-05 部署包锁文件已修复此前 10 high / 9 moderate / 1 low，官方 npm 生产审计为 0 条。Linux Prisma 生成、6 个后端包类型及 24 项代理/Swagger/JSON/ZIP/YAML 检查通过；原 Windows 开发服务仍使用原安装依赖，尚未切换。目标云主机真实运行仍需验收。 |
| 2 | 普通用户登录 | 原 `.env` 已配置用户提供的 APPKEY，原页面已启用协会登录，单次随机不存在账号的请求收到 `LOGIN_FAILED`。真实账号成功登录由用户自行在 5180 测试；云端私有配置及云主机普通用户登录仍待验收。管理员独立入口继续可用。 |
| 3 | 主机与 HTTPS | 已确定 Ubuntu 22.04/24.04、Caddy + PM2 与 `https://problems.cwnupaa.com`，2026-10-05 查询 A 记录为 `43.136.170.90`。脚本生成 HTTPS Origin、精确代理信任、请求限额与独立配置；Caddy 配置和真实 PM2 双进程/重载夹具检查通过。CPU/内存/磁盘、架构、Docker/cgroup、证书和实际云端运行仍需核对。 |
| 4 | 原数据迁移 | 迁移原数据库及实际私有目录，不能只上传源码、导出 Hydro 包或复制旧演练实例。需要确定停写窗口、生成一致备份，并在空目标恢复、逐文件核对。 |
| 5 | 最新发布与验收 | 当前采用从干净提交生成的 Caddy / PM2 源码包，含版本、迁移与逐文件哈希；云端由锁文件构建前端，API/Worker 由 PM2 运行，仅两类沙箱构建容器镜像。旧全 Compose 发布镜像不作为本方案上线版本。目标主机必须完成全部运行验收。 |
| 6 | 备份与运行维护 | 设置加密备份频率、异机保存、密钥独立保管、失败通知、磁盘阈值和容器日志轮转；做一次目标环境恢复验收。现有维护脚本不会自动配置这些调度/上传/通知。 |

## APPKEY 与域名补充验证

2026-10-05 将 APPKEY 保存到原主目录 Git 忽略的 `.env`，确认零活动任务后仅重启原 `pnpm dev`。原 5180 登录页 HTTP 200、健康接口 ok，公开认证配置返回 `configured: true`，不返回密钥。原题目、比赛及模板指纹前后一致，端口、数据库、Redis、存储和两个 Worker 保持原环境。

用随机不存在账号对固定协会登录接口发起一次请求，得到本地认证模块的 401 / `LOGIN_FAILED`，仅证明接口可达和失败响应链路正常，不代表真实账号成功登录或完整云端验收；没有同步账号、创建本地会话或写业务数据。用户已选择自行在原页面登录测试。证据位于 Git 忽略的 `.local/association-connection/`，不保存 APPKEY、密码或远端原始响应。

早期 Nginx 示例保留供旧方案参考，当前按用户指定的 Caddy 生成站点配置；生产私有配置使用 `APP_ORIGIN=https://problems.cwnupaa.com`，原开发配置继续 `http://localhost:5180`。DNS 查询不代表已登录目标主机或完成部署，尚未在云端安装证书或访问目标域名的 HTTP/HTTPS 服务。

## Caddy / PM2 本地验证（2026-10-05）

一键入口提供首次安装、重复执行、升级前停写备份、状态检查、API 平滑重载和独立开机服务。配置 / 源码完整性 / 失败顺序共 11 项检查通过；使用真实 Caddy 2.10.2 解析和验证配置、PM2 7.0.4 启动并重载两个不监听 HTTP 的 TypeScript 夹具进程，确认环境文件加载、首次 jlist 解析和正常退出。API 与初始化脚本类型、生产前端构建、四个基础服务的 Compose 配置检查通过。两个真实 Redis 客户端的 SSE 配额竞争/释放/过期回收检查通过，仅使用随机临时键并清理。

以上没有启动新应用实例或端口、写原业务数据库、执行作者程序/TeX，亦未运行 Ubuntu 主机完整安装、真实 TLS、恢复或系统重启。原 5180/3100 服务继续运行原安装依赖；部署包使用更新后的锁文件，不能把 Linux 构建验证说成原开发服务已经升级。

## 首次上云准备检查

- 保持 `D:\project\ProblemForge` 原 5180 / API 3100 和原库、Worker、沙箱，未重启、迁移或修改业务数据。
- `pnpm build:web` 通过类型检查和生产打包。Monaco 的约 2.28 MB 按需代码块仍有体积提示，不属于此次构建失败或已验证的性能容量。
- 从干净提交 `7517acdbd32fe54c34f904cddb51c43e33bbc3b5` 成功构建 Linux amd64 基线镜像 `problemforge-app:cloud-prep-20261005-7517acd`；镜像 ID 与构建清单保存在 `.local/releases/cloud-prep-20261005-7517acd.json`。该镜像早于本轮代理配置补丁，且仍含审计命中依赖，**不作为最终上线版本**。
- 新增受信任代理 IP/CIDR 配置、Compose API 环境传递、初始化配置占位和 Nginx 示例。默认不信任代理，原开发配置不变。3 项实际 Fastify 定向检查通过：配置拒绝、受信任/伪造转发 IP 与链路边界、两个客户端独立限流；`pnpm check api` 和 Compose 静态配置检查通过。没有监听测试端口，没有写数据库。
- 通过官方 npm registry 执行生产依赖审计；原 npm 镜像的 audit 端点不可用，改用本次命令参数指定官方地址，没有修改用户 npm 配置。完整报告 `.local/cloud-readiness/dependency-audit.json`；未执行依赖升级，也未运行系统/容器镜像漏洞扫描。

依赖命中路径如下，部分来自 Prisma 管理工具链，需与直接对外 API 区分，但均存在于当前应用镜像的依赖中：

| 依赖 | 引入路径 | 本轮最高级别 |
| --- | --- | --- |
| fastify | API 直接依赖，当前 5.6.2 | high |
| @fastify/static | @fastify/swagger-ui | high |
| ws | judge-adapter | high |
| effect、deepmerge-ts | Prisma / @prisma/config | high |
| yaml | problem-format | moderate |
| yauzl | judge-core | moderate |

Fastify 的请求校验和受限 trustProxy 下的转发头问题已有[维护者公告](https://github.com/fastify/fastify/security/advisories/GHSA-jx2c-rxcm-jvmq)、[转发头公告](https://github.com/fastify/fastify/security/advisories/GHSA-444r-cwp2-x5xf)。以上表格是首次审计记录；后续部署准备已固定 Fastify 5.12.5、Swagger UI 6.1.1 / static 10.1.5、Prisma 6.19.3、ws 8.21.0、yauzl 3.2.1、yaml 2.8.3，并对 Prisma 配置中的 deepmerge-ts 使用兼容的 8.0.0 安全覆盖。新生产审计为 0 条，证据 `.local/caddy-pm2/dependency-audit.json`；原开发进程未加载新依赖，代理配置继续留空。

## 原开发数据如何迁移

只读盘点时有 7 道题、1 场比赛、7 套模板 / 15 个模板版本、34 个程序、117 组测试、1 位用户；2623 个登记对象共 585256226 字节，约 558 MiB，无未完成存储预留和活动构建/判题。实际私有文件位于 `D:\project\ProblemForge\.local\p3-storage`，不是默认 `storage/`。证据 `.local/cloud-readiness/local-state.json`。最终迁移前需重新盘点，后续编辑会改变数量。

现有 `pnpm ops backup` 只停止生产 Compose 内的 API/Worker，并归档其 `/data` 命名卷。当前 Windows 开发服务由宿主机 `pnpm dev` 启动，文件在宿主机目录，**不能把旧 Compose 备份命令直接当作原开发环境的一致迁移方案**。

迁移步骤：记录并停止原开发写入进程，核对零活动任务；用匹配 PostgreSQL 版本导出原库，同时归档上述完整私有目录、文件清单及哈希，另外保管配置/密钥；将这些私有备份传到用户指定云主机的项目专用目录；在空库和空卷恢复，修正服务用户权限，核对迁移 SQL、业务计数、全部登记文件和必要历史 PDF/题包；数据库/Redis/沙箱使用云端独立凭据，Redis 可为空；全部验收通过后再切换入口。整个过程保留原库和文件，不覆盖本机数据。该跨环境迁移本轮尚未执行，也没有生成可宣称一致的原库备份。

## 主机与资源初始方案

针对小团队、Judge/TeX 各 1 个 Worker 并发，可先按 **4 vCPU / 8 GB RAM / 80 GB SSD、Ubuntu 24.04 LTS x86_64** 规划；这是按现有进程/沙箱限制估算的起点，不是压测保证。已有机器应先核对配置，不据此直接购买或扩容。更高内存题目、频繁双向交互、多人同时编译/TeX 或在服务器构建镜像时需额外余量。

当前已构建镜像为 linux/amd64；选 ARM 需要另行构建并验证工具链。应用镜像约 1 GB、Judge 约 1.11 GB、TeX 约 1.98 GB，磁盘还要容纳构建缓存、数据库、私有文件、历史镜像和备份；现有 10 GB 应用存储配额不代表整个服务器只需 10 GB。

需要可运行 rootful Docker 及专用 privileged 沙箱容器的 Linux 虚拟机，并实测 cgroup；普通无此能力的受限容器服务不直接等同于可用云主机。依据：[Docker Ubuntu 支持](https://docs.docker.com/engine/install/ubuntu/)、[项目固定 go-judge v1.8.5 要求](https://github.com/criyle/go-judge/blob/v1.8.5/README.md)。数据库、Redis、两类沙箱保持无宿主机公网端口；只有 HTTPS 入口对指定用户开放，SSH 按管理来源限制。

## 云端验收通过后再切换

1. 明确运行提交/镜像 ID；迁移和文件核对通过，API、两个 Worker、两个沙箱健康。
2. 真实域名 HTTPS 下验证管理员与普通用户登录、Secure Cookie、跨来源/无权请求拒绝，以及不同客户端的登录限流。
3. 保存和重开题目/程序，运行一次普通题 Judge、一次双向交互和一次 TeX PDF，检查页面日志及 SSE 断线恢复。
4. 核对 PDF 时空限制、比赛最新内容同步、Hydro Markdown 和编号样例、私有下载及无权下载拒绝。
5. 核对大输入/题包上传通过反代，停止/重启后历史文件与任务状态仍正常；按目标资源安排一个有明确时长和并发上限的小规模试用。
6. 成功完成一次加密备份及空目标恢复，确认密钥与备份不在同一份分发包，备份失败可发现。

真实 Polygon 样包兼容和更大规模稳定性可以继续作为后续阶段；当前先确保实际使用的出题流程、数据保全和基础部署验证完成。仓库中的历史故障注入脚本会写数据/停 Worker，不对共享云实例盲目执行。
