# 架构与边界

浏览器（Vue / Naive UI / Monaco / PDF.js）→ Fastify 模块化单体（身份、题目、模板、出版任务）→ PostgreSQL。数据库保存事实，Redis / BullMQ 只调度。业务存储通过 StorageAdapter 使用私有目录，无静态文件根和可直达宿主机路径。

User.systemRole 与 ProblemMember.resourceRole 分离。所有私有读写、日志、历史构建、PDF 与下载按当前数据库权限授权；撤销不靠版本快照缓存。会话使用随机不透明 cookie，数据库仅保存 token 的 SHA-256；密码 scrypt（N=32768/r=8/p=1）。SameSite=Strict / HttpOnly；生产 Secure，写入检查 Origin 与 CSRF，登录使用 Redis 限流。

Problem → Document（problem/language/kind 唯一）→ 不可变 ContentRevision。STATEMENT、EDITORIAL_DOCUMENT、EDITORIAL_BEAMER 的记录、当前版本、enabled、模板选择及 Publication 完全独立。草稿保存用 expectedVersion 的原子比较更新，冲突 409，不覆盖。此阶段 ContentRevision 是稿件历史；P4 ProblemRevision 将以清单固定跨稿件/程序/数据的审题修订。

Template → TemplateVersion，只有系统 ADMIN 有维护接口。已发布版本不可修改，新编辑产生新草稿；归档版本保留已有绑定，撤回停止新构建。普通用户接口白名单拒绝 style/preamble/main.tex 等额外字段。模板 metadata schema 使用安全声明子集，不执行用户 schema 或代码。

Build 保存正文/元信息/模板文件/具体修订 ID、内容与模板哈希、内容策略和工具链版本。Worker 从单一不可变输入读取；不在编译中读取正在编辑的草稿。历史成功与当前有效分开。独立 Publication 将公开某个具体产物，各种稿件不同 token；公开题面入口不返回题解/数据/日志。

独立 TeX Worker 使用 go-judge v1.8.5 的 WebSocket 执行与取消协议；作者 TeX、管理员模板均在新任务的 Linux mount/pid/network namespaces 与 cgroup 内运行。API/Worker 不持有 Docker socket，不执行作者 Shell。沙箱服务是专门的受信执行组件，唯一需要 privileged 的容器，不挂载业务存储或凭据。

固定 latexmk -norc / XeLaTeX / no-shell-escape，最小环境，只有任务快照和预装字体/宏包。读写目录受限，CPU/墙钟/内存/进程/日志/文件大小/tmpfs 有界，文件缓存使用后删除。受控内容语法使用 unified-latex PEG AST 检查宏/环境/分组与 verbatim，拒绝 TeX 字符预处理及未批准能力；它与 OS 沙箱是两道独立约束，绝不把语法过滤视为完整安全隔离。

Judge Worker、testlib、数据验收、对拍与交互将在 P2/P3 接入同类执行边界，绝不借用现有 OJ 服务。
