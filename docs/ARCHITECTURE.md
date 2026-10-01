# 架构与边界

浏览器（Vue / Naive UI / Monaco / PDF.js）→ Fastify 模块化单体（身份、题目、程序/数据、模板、Judge/出版任务）→ PostgreSQL。数据库保存事实，Redis / BullMQ 只调度。业务存储通过 StorageAdapter 使用私有目录，无静态文件根和可直达宿主机路径。

User.systemRole 与 ProblemMember.resourceRole 分离。所有私有读写、日志、历史构建、PDF 与下载按当前数据库权限授权；撤销不靠版本快照缓存。会话使用随机不透明 cookie，数据库仅保存 token 的 SHA-256；密码 scrypt（N=32768/r=8/p=1）。SameSite=Strict / HttpOnly；生产 Secure，写入检查 Origin 与 CSRF，登录使用 Redis 限流。

Problem → Document（problem/language/kind 唯一）→ 不可变 ContentRevision。STATEMENT、EDITORIAL_DOCUMENT、EDITORIAL_BEAMER 的记录、当前版本、enabled、模板选择及 Publication 完全独立。草稿保存用 expectedVersion 的原子比较更新，冲突 409，不覆盖。ProblemRevision 聚合固定跨稿件/程序/数据/配置/资源的审题清单及哈希；恢复追加新的各功能版本和 DRAFT 修订，旧历史与冻结状态不回写。

Template → TemplateVersion，只有系统 ADMIN 有维护接口。已发布版本不可修改，新编辑产生新草稿；归档版本保留已有绑定，撤回停止新构建。普通用户接口白名单拒绝 style/preamble/main.tex 等额外字段。模板 metadata schema 使用安全声明子集，不执行用户 schema 或代码。

Build 保存正文/元信息/模板文件/具体修订 ID、内容与模板哈希、内容策略和工具链版本。Worker 从单一不可变输入读取；不在编译中读取正在编辑的草稿。历史成功与当前有效分开。独立 Publication 将公开某个具体产物，各种稿件不同 token；公开题面入口不返回题解/数据/日志。

题面 ContentRevision 固定样例 TestCaseRevision ID，构建保存输入/答案私有对象、字节与哈希。可信模板插槽从隔离工作目录的样例文件渲染；作者正文不能获得任意文件读取宏。数据更新不改变已选版本。题解两类稿件不共享或引用这份样例绑定。

独立 TeX Worker 使用 go-judge v1.8.5 的 WebSocket 执行与取消协议；作者 TeX、管理员模板均在新任务的 Linux mount/pid/network namespaces 与 cgroup 内运行。API/Worker 不持有 Docker socket，不执行作者 Shell。沙箱服务是专门的受信执行组件，唯一需要 privileged 的容器，不挂载业务存储或凭据。

固定 latexmk -norc / XeLaTeX / no-shell-escape，最小环境，只有任务快照和预装字体/宏包。读写目录受限，CPU/墙钟/内存/进程/日志/文件大小/tmpfs 有界，文件缓存使用后删除。受控内容语法使用 unified-latex PEG AST 检查宏/环境/分组与 verbatim，拒绝 TeX 字符预处理及未批准能力；它与 OS 沙箱是两道独立约束，绝不把语法过滤视为完整安全隔离。

Program / TestCase / GeneratorPlan / ToolSelfTest 分别维护当前编辑与不可变历史。管理员 CompileProfile 只有有限配置，每个任务保存具体配置/profile 版本。TestRun 在提交前固定目的相关的程序、工具、数据、计划、自测、设置、哈希和工具链；按依赖哈希判断当前有效，不依赖题目总更新时间。

独立 Judge Worker 使用另一个 Linux go-judge 服务，固定 GCC / Python / testlib。在沙箱中编译、生成、校验、产生答案和验收；原始输入和输出通过缓存文件上传/下载，不经过会替换非法 UTF-8 的 JSON 文本。RunCase 保存生成来源和答案，Invocation 保存真实进程状态、资源与独立输出；内置比较在可信 Worker 中比较字节，不执行作者代码。报告允许历史成功且失效、执行完成但验收失败，以及明确的工具/基础设施失败。

Judge 与 TeX 均以数据库为持久任务清单，独立队列补投。请求键在用户及用途范围幂等；用户行锁串行核对并发配额。任务由 QUEUED 原子转为带独占 token 的 RUNNING，定期续租；进度/终态写入检查 token，失联旧持有者不能覆盖恢复结果。API 定期查找过期租约与缺失 Redis 记录，不依赖 queuedAt 是否为空。失联任务保留证据并失败，显式有限重试创建新记录；同一父任务只能有一个重试子项。取消真实终止沙箱进程。详细判题协议见 [JUDGE.md](JUDGE.md)。

CompileCache 按题目和源码/profile/工具链/testlib/策略哈希保存私有编译产物；读取校验字节、大小，不缓存判题结论。Build 缓存按对象/用途及完整输入哈希复用真实 PDF，缓存来源单独记录，不宣称重新执行。所有读取及历史下载仍检查当前授权。ManagedStorage 用 StoredObject 预留字节和 PostgreSQL 全局事务锁控制总容量，文件落地后标为 ready；崩溃残留预留保持计费，防止无声超限。

SSE 只发送有限的任务元信息，定期重新验证会话和当前对象权限；客户端用正常受保护接口加载详情。事件 id 为当前数据库视图哈希，重连取得最新状态，客户端断线时低频回查。审计保留业务变更、请求拒绝和失联恢复，管理员可筛选分页；不记录密码和正文。WorkerHeartbeat 与 DB/Redis/存储/沙箱检查构成 readiness，liveness 单独提供。

生产镜像提供静态前端与 Node API/Worker，Compose 只有 API 回环入口，其他服务在 internal 网络。API/Worker 非 root、只读根目录、无 Docker socket；特权 Linux 沙箱是独立受信组件。备份停止业务写入，数据库 dump 与私有文件一起保存，校验镜像/迁移/业务计数及登记文件哈希后才能在空实例恢复；Redis 从数据库任务重建。部署边界和命令见 [DEPLOYMENT.md](DEPLOYMENT.md)。

UserGroup 的当前成员关系与对象直接授权共同决定权限。Problem 的 TRANSLATOR 仅处理授权语言稿件及共享图片，不能读写程序、测试、整题修订或包；Contest 授权不授予源题编辑权。至少保留一位直接 OWNER，用户组不能间接成为 OWNER。权限不进入可回滚清单。

修订评论和 ReviewDecision 绑定不可变版本。提交/批准/要求修改检查当前 reviewHash，内容和判题依赖改变会过期。仅模板绑定变更可继承审核，但需要新的出版构建。FREEZE 核对完整工作清单、启用题面、内容策略及匹配的成功 Judge 依赖/验收，记录其 run ID。已冻结修订不因后续草稿改变而漂移。

ContestData 保存比赛信息、语言、题号/顺序、独立讲解顺序、三模板版本和所选 ProblemRevision。ContestRevision 固定题目清单和模板字节。构建按 kind 建立同 bundle ID 的独立 Build，按题命名空间处理资源、样例与引用，再由同一 XeLaTeX 源码工程生成；没有拼接 PDF。缺稿先返回逐题报告，只有显式 subset 才跳过题目；两类题解可出现 PARTIAL_FAILED，并保留成功产物和失败日志。

ExportArtifact 保存固定修订、用途、格式、私有 ZIP、哈希和兼容报告；Release 只关联一个具体 PDF 或用途包，发布时在对象锁与 Serializable 事务中核对当前选择。导入检查以独立私有隔离记录持久化，原包按请求人鉴权；确认 reportHash 后幂等创建新的 OWNER 私有题目，无历史审批、权限、发布或执行结果。包协议及安全限制见 [PACKAGES.md](PACKAGES.md)。
