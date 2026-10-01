# 开发进度

2026-10-01：P0—P5 计划主链路已实现并按阶段实际验证，完整成果已提交为 `9ff0ec3`。按用户“继续推进”要求完成首轮交付后维护：工作台按需加载与失败恢复。最新实现、证据、限制和运行交接见本文末尾；历史记录保留。开发与验证均在主目录 D:\project\ProblemForge，没有公网发布。

## 已实现

- pnpm workspace / 固定版本与 lockfile；Fastify 模块化 API；Vue / Naive UI 工作台；Monaco、PDF.js。PostgreSQL / Prisma 八个实际部署迁移，独立 Redis / BullMQ 调度，私有持久文件存储及适配器接口。
- 管理员初始化、登录/会话/CSRF/限流/用户创建；按当前数据库权限鉴权题目、任务、日志、资源和产物。普通用户没有模板维护接口，目录也不返回模板源码和全局配置。
- 题目创建与按语言区分的三类独立稿件；不可变正文版本、启用开关、原子并发保存及 409 冲突、本地未保存编辑保护；私有 PNG/JPEG 资源与受限路径引用。
- 三类管理员模板包、递归模板资源、源码/配置编辑、JSON 上传、不可变发布、归档与撤回；发布要求匹配当前模板哈希的真实成功构建及预览确认。
- 真实独立 TeX Worker / Linux go-judge 1.8.5 / 固定 XeLaTeX+latexmk；内容 AST 子集和执行隔离分别检查，沙箱不可用时失败。数据库任务快照、补投/失联恢复、独占租约、取消/有限显式重试、真实日志、私有 PDF 与分类型发布/撤回；P5 补齐原子并发/存储配额、缓存、SSE 和管理员运行审计。

## 本轮题面模板纠正

此前 v2 仅复用 olymp 的通用外壳，偏离用户上传模板。用户指定压缩包 **main.tex 源码版** 后，修正为 v3：原 11pt / Overleaf 字体定义、完整导言宏包、双行比赛页眉、原始边距/间距、封面、主办方页、六张图片及原样例表格。题目内容与比赛预览信息接入受控插槽，默认空 style.tex 不覆盖参考样式。原文件逐字节和导言还原比对通过，来源详见 templates/builtin/SOURCES.md。

镜像补齐固定版本 texlive-science / texlive-humanities，保留原依赖；遇到缺失 qtree 的真实构建曾明确失败，补齐后重新运行同一题面链路成功。三页模板验证 PDF 为 601,069 字节（封面、主办方、单题）；已逐页渲染检查。管理员通过实际 PDF.js 预览发布 v3，旧 v2 归档保留历史绑定。只显式更新浏览器演示题的题面至正文 v4 / 模板 v3，两份题解仍为各自正文 v3 / 模板 v2，真实成功 PDF 均保留。

题册入口目前用于单题模板验证，尚未实现 P4 多题比赛组装。当前预览比赛信息来自该参考模板的 publication.json，P4 将接入独立比赛信息快照。

## 实际检查与证据

- Windows Node 22.12.0 / pnpm 10.11.1；Docker Linux 引擎。仅使用 ProblemForge 容器和独立端口 15432 / 16379 / 15050；未修改已有 OJ。
- 依赖安装、Prisma 生成及两个迁移、真实健康检查和管理员登录通过。contracts / database / domain / storage / template-engine / judge-adapter / api / web / tex-worker 的相关类型检查在实现对应块时通过；没有运行全项目生产构建。
- `pnpm test:quick template` 三个定向场景通过：三类稿件与原题册入口渲染、AST 拒绝文档入口/文件读取（含 exmp 参数内读取）、私有图片路径与尺寸限制。`pnpm test:quick storage` 私有路径及持久读取通过。默认 `pnpm test:quick` 已实际运行固定两个文件、四项快查并通过，不隐藏全量套件。
- `pnpm verify:p1` 真实 API / DB 验证登录、私有权限、普通用户维护模板 403、额外排版字段 400、并发保存 409、两种题解独立保存与停用保留、CSRF 拒绝。证据 `.local/verify-p1.json`。
- 浏览器实际创建、编辑、保存、构建、预览与刷新。三类真实 PDF 已成功生成；Beamer 为指定 CWNU 主题。题面修正后重新运行 `pnpm verify:tex --kind=STATEMENT`，并通过浏览器提交单题构建及刷新查看成功产物。证据 `.local/verify-tex.json`、`.local/verify-tex-statement.json`、`.local/source-check/proof.json`；后者与 workspace.jpg 保存本次纠正结果。
- 新建题目默认正文已改用原 InputFile / OutputFile 宏；真实 API 检查中文新题绑定 v3，缺少对应模板的 en 新题保留独立未绑定稿件。证据 `.local/source-check/new-problem.json`。
- `pnpm verify:publication <题目ID>` 真实题面独立公开、私有题解 401、撤回 404；普通用户目录不含模板源码/配置；私有图片经哈希快照与沙箱真实编译。畸形表格触发真实 TeX 失败并保留旧 PDF，其他题解不变；新语言稿件不覆盖原语言。证据 `.local/verify-publication.json`。没有因本次只改题面来源而重复运行这整条历史链路。
- `pnpm verify:sandbox` 实际非 root 执行、业务路径不可见、只读工具链、网络隔离、资源超限与连接失败明确报错通过；没有宿主机回退。证据 `.local/verify-sandbox.json`。当前新增宏包没有改变挂载与隔离配置。

证据 JSON / 导出的 PDF / 管理员凭据属于忽略的本地目录；不会提交密码或源题私有数据。验证过程中产生的题目与失败任务是实际持久记录，未伪装成功，也没有清理用户数据。

## 本轮 P2 实现

- 程序角色与 C++17 / C++20 / Python 3、管理员有限编译 profile；源码、测试数据、生成计划、工具自测各自保存不可变版本与 CAS 冲突。Interactor 当前仅管理/编译，未伪装交互执行。新增 Judge 与样例绑定两个迁移，未改原迁移校验和。
- 独立 Judge Worker / 独立 Linux go-judge v1.8.5 / 固定 GCC、Python 和官方 testlib 0.9.41 提交及哈希。所有作者编译和执行只经沙箱，业务进程不运行作者代码；只读工具链、无业务凭据、受限目录/网络/资源，服务不可用明确失败。协议版本现在按 `buildVersion` 和 `os` 精确校验。
- 原始字节手工/上传数据、受限流式 ZIP 导入、哈希与重复提醒、argv/种子生成计划和重复生成提示；校验、主标程答案、Validator / Checker 自测、正确/错误解验收矩阵，CPU/内存和源码/profile 来源。文件 I/O 的判题输出与 stdout/stderr 各自保存及鉴权下载。
- 按目的固定任务快照及依赖哈希、当前有效/历史结果区分、过期结果禁止收集、显式收集形成新数据版本。数据库持久任务、幂等提交及并发键冲突、队列补投、总预算、真实取消、失败/取消的显式重试与部分证据保留。P5 深层恢复/缓存/配额仍待完善。
- Vue 工作区增加程序、测试数据/生成计划、自测、验收、判题配置；管理员编译配置页和 Judge/TeX 任务中心。编辑保护、保存冲突、真实轮询、真实日志与矩阵点击诊断，没有模拟进度或判定。
- 题面绑定具体 TestCaseRevision 的样例输入/答案，构建按字节/哈希复制，由可信管理员模板读取。原始样例不内插到可执行正文；两份题解继续独立保存。更新数据后保留已选择样例版本，用户显式选择才能升级。协议和比较细则见 [JUDGE.md](JUDGE.md)。

## 本轮实际验证

- 本工作区新建独立 `problemforge_f054` 验证数据库、Redis DB 1、独立私有 storage 与本地管理员/出题人。沿用本项目 PostgreSQL / Redis / TeX 容器，新增仅监听 127.0.0.1:15051 的 Judge 沙箱；未迁移原数据库、未访问现有 OJ、未 push、未发布公网。依赖安装、Prisma 生成和四个迁移实际通过。
- contracts / database / domain / judge-core / judge-adapter / api / web / judge-worker / template-engine / tex-worker 的受影响类型检查在对应功能块完成后通过。样例、下载与提交键修正后分别重新检查相关包；没有用全仓生产构建替代定向检查。
- `pnpm test:quick judge` 三项通过：精确/token/浮点语义、退出状态/工具/CE 归因、原始 ZIP 字节与路径拒绝。`pnpm test:quick template` 新增可信样例插槽策略后四项通过。默认测试仍固定两个轻量文件，不自动加入 Judge/TeX/全部 E2E；本轮未重复运行默认全范围。
- `pnpm verify:sandbox --judge` 实际非 root uid 21000、业务文件不可见、工具链只读、网络隔离、CPU 超限终止、沙箱连接失败明确报错通过；精确版本校验修改后再次通过。原始二进制 stdin → stdout 回读及 stderr 分离也经真实沙箱检查。
- `pnpm verify:p2` 实际普通题四组数据、C++17 / Python 正确解 AC、正常退出错误解 WA、生成种子快照、Validator 接受/拒绝与内置 Checker 自测通过；C++20 testlib 多解 SPJ 接受与主标程不同的合法输出；严格行 Checker 接受行末空白、拒绝同一行全部整数。权限撤销后任务/输出 404、VIEWER 写 403、普通用户维护 profile 403、任意编译字段 400、CAS 409、按目的失效、CE 不算击败、Checker 真正崩溃归 TOOL_ERROR、二进制/CRLF/重复/ZIP/路径穿越与过期答案收集拒绝通过。证据 `.local/verify-p2.json`。
- 初次 SPJ 验证真实编译因样板 `readLong` 整数字面量重载歧义失败；改为 long long 字面量后重新执行代表链路通过。失败记录保留。Judge 镜像初次 Debian 下载失败，改用已有项目的签名镜像源后固定包安装成功，没有关闭签名校验。
- `pnpm verify:p2:results` 实际取消运行中的无限循环生成器，保留 CANCELED Invocation；该次取消到最终记录约 586ms，仅是本次测量。后续真实文件 I/O 题通过，主标程 stdout 为空、判题输出 `output.txt` 为 `3\n`，错误解 WA；判题输出下载与历史样例元信息另做授权拒绝检查。并发相同请求返回同一任务、不同请求复用同一键返回 409，Worker 重启后两条真实编译成功。证据 `.local/verify-p2-results.json`、`.local/verify-p2-concurrency.json`。
- 本地中文管理员题面模板实际三页编译、逐页 PDF.js 预览后发布；显式收集主标程答案、绑定样例数据 v2、构建一页 34,754 字节真实 XeLaTeX PDF。跨题及题解样例绑定 422。将正式数据更新至 v3 后，题面仍固定 v2，旧输入/答案可读，PDF 不静默改变。证据 `.local/verify-tex-statement.json`、`.local/verify-p2-sample.pdf` 与 `.local/p2-sample.png`。
- 浏览器以普通出题人实际登录、创建/全选替换/保存 C++ 源码 v2、提交隔离编译、切换 Python 编辑器、上传含 NUL/非法 UTF-8/CRLF/末尾空格的五字节文件并停用保存、运行当前验收、点击 WA 查看 exit=0 和独立下载、查看任务中心及刷新。刷新后源码/数据版本及原始字节实际持久；当前验收四组数据有 8 个 AC、4 个 WA 单元，相关依赖仍有效。证据 `.local/verify-p2-browser.json`、`.local/p2-workspace.png`。

本轮凭据、证据 JSON、PDF、截图与私有数据均在忽略目录，未纳入提交。没有删除或伪装历史失败/过期任务。

## 样例表格底边修复

此前 P2 样例 PDF 的底边仍有两段多余竖线，本轮根据用户截图修正。原管理员模板的 example 环境启用 obeylines，平台生成样例宏后的源文件换行被解释为额外空行；生成 samples.tex 时使用 TeX 行尾注释抑制结构性换行，原始输入/答案字节与管理员模板文件不改。新增样例渲染版本 pf-samples-2 到有样例构建的不可变快照和输入哈希；Worker 拒绝以新渲染器重试旧样例快照，需显式新建构建。

实际验证：template-engine / api / tex-worker 定向类型检查及 `pnpm test:quick template` 四项通过。对用户当前题面重新提交真实 Linux go-judge / XeLaTeX 构建，成功生成一页 34,725 字节 PDF；正文、模板及绑定样例 v2 均保持同一版本，历史 PDF 哈希不变。Poppler 150 dpi 整页渲染检查和 PDF.js 页面刷新确认底边完整；PDF 向量测量原两段各超出 15.781 pt，修复后均为零，提取全文一致。证据 `.local/verify-sample-border.json`、`.local/verify-sample-border.pdf`、`.local/sample-border-workspace.png`。本轮未重复 Judge / 全量 E2E，也未实际编译全部多样例和模板组合；此修复没有新增阻塞。

## 开发目录调整（2026-09-30）

根据用户要求，后续直接在主目录 `D:\project\ProblemForge` 修改和验证，已写入 AGENTS.md。主目录同步前干净，且与 f054 工作树基于同一提交；已复制当前 74 个修改/新增源码文件，逐文件 SHA-256 及同步后的 Git 状态一致。同步完成时改动保持未提交。同步证据为主目录 `.local/worktree-import-proof.json`。

本次仅同步源码，未覆盖主目录的本地配置、依赖、数据库或私有存储。前述 P2 与 PDF 实际验证及忽略目录证据仍来自 f054 工作树，运行中的开发服务也尚未切换目录；后续启动主目录服务时需先核对本地配置、安装更新的依赖并按目标数据库状态处理迁移。本次没有重复运行功能测试。

## 历史交接（2026-09-30，进入 P3）

- **工作目录与提交：**直接使用 `D:\project\ProblemForge`，当前分支 `master`。P2、样例表格修复和主目录规则已提交为 `550f0c8`；P3 详细步骤见 [PLAN.md](PLAN.md) 的 P3.0—P3.4。本轮按用户要求停在提交与计划，不提前实现 P3，也没有 push。
- **开始顺序：**先读 AGENTS、任务书第 7/8/10/12/13 节及本交接，再完成 P3.0 运行环境切换，然后实施对拍 → 交互 → 分组评分。现有源码有 INTERACTIVE/PARTIAL 契约字段，但 API 明确拒绝执行，Interactor 仅管理/编译；这些字段不代表 P3 已实现。EXTRA_VALIDATOR 在 P2 已可全局执行，P3 需补组级适用范围。
- **环境区别：**此前实际 P2 验证在 `C:\Users\Gaoming\.codex\worktrees\f054\ProblemForge`，数据库 `problemforge_f054`、Redis DB 1、该目录自己的私有存储。前端/API 为 5180/3100，PostgreSQL/Redis 为 15432/16379，TeX/Judge 沙箱为 15050/15051。当前开发进程尚未迁往主目录；新对话需重新核对存活进程、任务和配置，不能假定工具会话 ID 可跨对话复用。
- **本地证据：**P2 的 `.local/verify-p2.json`、`verify-p2-results.json`、`verify-p2-browser.json`、`verify-sample-border.json` 及 PDF/截图仍在上述 f054 目录；主目录只保留自己的 `.local/worktree-import-proof.json`。必要凭据在各自忽略的 `.local` / `.env` 中，核对目标环境后读取，不写入文档或提交。旧工作树含运行数据与证据，迁移核对完成前保留。
- **可用于接续的页面：**P2 验证题 `cmuo2ghni004wktkgjv9s4p1q`，路径 `/problems/cmuo2ghni004wktkgjv9s4p1q`；题面正文 v3 / 模板 v1 / 样例数据 v2，最新修复构建 `cmuo5c4im0002ktt0sxp20h3f`。该题正式数据已到 v3，但题面显式保留样例 v2，是已验证的版本行为。
- **本轮新增检查：**环境配置文件中仅 `.env.example` 纳入提交，本地凭据、产物、storage 与 node_modules 未入暂存区；自有代码的暂存差异空白检查通过。上游 testlib 原文件保留尾随空白，磁盘及暂存 blob 的 SHA-256 均与固定来源一致，未为消除提示而修改第三方字节。功能验证复用此前记录，本轮未在主目录重跑 Judge、TeX、E2E 或生产构建。

## 本轮 P3 实现与环境接续（2026-09-30）

- **P3.0：**所有开发直接在 D:\project\ProblemForge，未创建工作树。确认 f054 的 Build/TestRun 无进行中任务后停止该目录的 API/Vite/两个 Worker。先备份主目录配置和管理员本地凭据，再延续 problemforge_f054 数据库、Redis DB 1；168 个私有文件复制到主目录 .local/p3-storage 并逐文件 SHA-256 校验。原主目录 storage、原数据库及 f054 文件均保留。pnpm install --frozen-lockfile、Prisma 生成及迁移检查实际通过，四个服务已加载主目录源码。
- **P3.1：**版本化/CAS 对拍配置、固定程序/profile/Validator/Checker 快照，生成→校验→参考→被测→比较，预算与停止策略、每轮实际种子和完成次数。持久反例、私有输入/两方输出/日志/源码来源、按保存输入复现（附加生成只检查确定性）、显式加入新正式数据版本及重复/过期检查。复用数据库任务、幂等提交、取消、队列补投和历史有效性；界面保留编辑、刷新查询和当前/历史区分。
- **P3.2：**核对固定 go-judge v1.8.5 和本地 testlib，新增一次请求内真实 Linux pipeMapping。两个作者执行环境、受限可信中继、Interactor 内可信监督程序，隐藏输入只交给 Interactor。支持直接判定与 tout 交 Checker；各方 CPU/内存/进程/输出及总墙钟/空闲限制，有方向/顺序/截断标记的有界原始字节记录及私有下载，保存双方 Invocation。EOF 只关闭管道，监督程序确认作者真实退出后才清理对端；有效 WA 保留，工具/基础设施错误另行归因。可信辅助脚本组合哈希进入执行快照，仍无宿主机作者代码执行。
- **P3.3：**数据组配置和不可变修订、固定成员数据版本/权重、组级额外 Validator、同题完整成员集合及依赖 DAG 检查。旧标签只能显式映射为草稿。ACM 全部必需测试 AC；部分分支持 ALL / WEIGHTED，每组按整数千分之一分向下取整，再施加依赖阻断并汇总。报告含原始组分、最终组分、阻断原因与总分；解法支持组/总分范围预期，正确解仍要求满分，CE/工具/基础设施错误不能命中预期。
- **P3.4：**新增三个独立真实验证入口及 p3 纯逻辑快查范围，默认 test/test:quick 的固定清单未改变。更新工作区、Judge 协议、README 和 PLAN；P4/P5 全部范围保留。

新增数据库迁移为 20260930150000_stress 与 20260930160000_test_groups，已在目标数据库部署；未重写前四个迁移。收尾逐一确认六个本地迁移文件的 SHA-256 与数据库记录相同，迁移命令确认无待执行项。迁移 SQL 明确禁用 Git 换行转换，避免跨平台 checkout 改变已部署字节的校验和。Windows 第一次生成 Prisma 时遇到正在运行的进程占用 DLL，停止主目录服务后重新生成成功，没有使用未经确认的数据库或重置历史数据。

## 本轮 P3 实际验证

- **环境：**主目录登录成功，可读取原 P2 验收报告及样例修复 Build cmuo5c4im0002ktt0sxp20h3f 的 34,725 字节 PDF，哈希与原 Artifact 一致。迁移/文件证据 .local/p3-migration/proof.json；旧 P2 证据完整备份到 .local/p3-migration/p2-evidence。服务及沙箱仍仅使用本项目的 5180/3100、15432/16379、15050/15051，没有 push 或公网发布。
- **类型与轻量检查：**按功能块实际运行受影响 contracts / database / judge-core / judge-adapter / api / web / judge-worker 的类型检查并通过；后续交互归因和 UI 修改后重查相关包。pnpm test:quick p3 的两个固定场景通过（整数计分、DAG、CE 不命中分数预期、真实判错与清理/超限归因）；pnpm test:quick judge 的三个 P2 逻辑/ZIP 场景也通过。未将真实服务或新套件加入默认测试。
- **pnpm verify:p3:stress：**真实找到 WA，输入字节/哈希一致地复现同判定，显式生成 TestCaseRevision；重复、CAS 冲突、未登录下载、依赖过期入库拒绝通过。取消前已产生的反例和 CANCELED Invocation 保留，后续任务可执行。附加多解 SPJ 的两份不同合法输出被指定 Checker 接受；1000 ms 总预算任务明确预算耗尽且不产生假反例。证据 .local/verify-p3-stress.json。
- **pnpm verify:p3:interaction：**真实双向 AC、答错后仍等待的选手得到 WA 并被清理、未 flush 空闲 TLE、双方运行中取消和后续任务执行通过。选手脚本实际断言隐藏输入/答案/Interactor 输出文件不存在；私有记录最多 1024 个原始字节、有连续 seq 与 TRUNCATED，未授权下载 401。Interactor 输出交 Checker 实际判错。补充了关闭 stdout 后继续 400 ms 才退出的 Interactor，证明 EOF 不被误当完成。证据 .local/verify-p3-interaction.json。
- **pnpm verify:p3:groups：**20/30/50 组配置实测主标程 100 分、加权半过且后续组被阻断为 35 分、首组失败后传递阻断为 0 分。循环依赖返回 422，组级额外 Validator 仅对指定组执行，改为大数据组时真实 REJECT / INVALID_INPUT，修改组配置使旧报告过期，恢复后新报告当前有效。证据 .local/verify-p3-groups.json。
- **浏览器：**普通出题人实际将中间组权重保存为 2/2（组配置 v4）、提交验收并看到 100/35/0 和原始/依赖后分数，刷新后权重/版本保留。对拍配置 v5 从浏览器保存、启动、找到 WA、下载 6 字节私有输入、显式入库为 #2、复现保存输入并刷新；下载哈希与新正式数据版本一致。实际点击交互 WA 单元查看沙箱 Signalled/exit=9 与最终 WA 的分离诊断，并下载授权通信记录；下载内容与 API 持久文件一致。证据 .local/verify-p3-browser.json、p3-groups-browser.png、p3-stress-browser.png、p3-interaction-browser.png。

浏览器收尾另将交互空闲时限保存为 1200 ms（判题配置 v5），新任务 cmuo80bq40002ktmouzs3jdfv 成功，AC/WA 均符合预期且报告当前有效；两次 Interactor 作者子进程退出码为 0，清理状态未误记为工具失败。最终任务清单没有未结束的 Judge 任务。Git 差异空白检查通过，.env 与所有 .local 证据均确认被忽略。

真实失败、取消和历史快照均保留，没有为获得绿色结果而删除数据或伪造任务状态。本轮对拍/交互取消的测量约为半秒级，仅描述本机这些次运行，不作为性能承诺。

## 下一对话交接（2026-09-30，进入 P4）

- 继续使用 D:\project\ProblemForge，当前分支 master，基线提交仍为 550f0c8；本轮 P3 修改尚未提交。不要新建工作树，不 push、不发布公网。
- 前端使用 http://localhost:5180（匹配 APP_ORIGIN），API 为 127.0.0.1:3100。API/TeX/Judge 在主目录以 tsx watch 运行，Vite 也来自主目录；父进程记录在 .local/p3-services.json，下一次仍需重新核对存活进程，不能直接复用工具会话 ID。勿启动另一套 Worker 消费同一队列。
- 本地 .env 已与 problemforge_f054 / Redis DB 1 / .local/p3-storage 配套；.local/bootstrap-admin.txt 和 verify-p2-fixture.json 也与该数据库匹配。迁移前的主目录配置与管理员凭据在 .local/p3-migration 备份，原 storage 和 f054 运行数据保留。所有凭据/产物/验证 JSON/截图都在忽略范围，不写入提交。
- 浏览器可接续的分组题 cmuo79h820001ktxk0d4tdqwk，浏览器验收 cmuo7efu90004ktvogtu8xykw；对拍题 cmuo6n6bm0001ktwczlul56vo，浏览器反例 cmuo7jgsp001wkt8wzkvqfwl9、复现 cmuo7kgib0024kt8w2f02bn53；交互题 cmuo7pgja0001ktsk76q6yqcg，最新浏览器验收 cmuo80bq40002ktmouzs3jdfv。各完整报告固定自己的快照；后来编辑过的示范题可能有历史过期任务，按界面标记判断。
- 按 PLAN 的 P4 开始题目组织/协作权限、不可变修订与审核，再推进比赛冻结、第二套模板、整场资料与包导出；不要把模板三页预览当成已实现多题比赛。P3 的配置修订只是各功能独立版本，不代替 P4 的整题修订清单/审核。

## 未实现、未验证及阻塞（P3 收尾历史记录）

P4 修订审核/协作/比赛冻结/整场资料/题目包/每类第二套模板；P5 正式 Linux 应用镜像、完整 Compose、CI、SSE、缓存/配额/审计强化、失联恢复、生产部署和备份恢复仍未完成。已有数据库任务、补投、有限配额和取消不代表 P5 已完成。

本轮没有重跑全套 P0/P1/P2/TeX/E2E、全部语言×交互×计分×Checker 组合、压力/模糊测试、完整资源超限与故障注入、生产构建/部署或备份恢复。Interactor/可信中继的故障归因有纯逻辑检查，未全面实测所有信号、内存/输出/墙钟极限与网络中断时机。对拍不确定性警告已实现，未系统覆盖任意非确定性程序。交互与分组部分分的组合已接入同一执行/评分链，但本轮代表交互题为 ACM，代表部分分题为批处理，不宣称所有组合已验证。

当前没有阻塞 P3 主链路的环境问题；P3.0—P3.4 的完成条件已具备，后续进入 P4。

## 本轮 P4 实现（2026-10-01）

- **P4.0：**题目标签/负责人/备注/归档/检索/复制；用户组及题目/比赛直接或组授权，保留直接 OWNER。TRANSLATOR 限定语言，允许相应稿件和本题共享图片，不能读写程序、测试、整题修订或包。聚合 ProblemRevision 固定各功能具体版本、清单/审核/Judge 哈希；CAS、差异、版本评论和解决状态、提交/要求修改/批准/冻结。恢复追加新内容/程序/数据版本和新 DRAFT 修订，保留旧冻结与历史。纯模板绑定改变可以沿用审核，内容或判题依赖改变使审核过期。
- **P4.1：**独立 Contest 成员、比赛信息/语言/题号/顺序/讲解顺序、三类模板与已冻结题目选择、完整性检查。冻结核对固定题目及成功验收，保存完整 ContestRevision；源题继续编辑不会漂移既有比赛版本。比赛权限不授予源题编辑或直接访问权。
- **P4.2：**每类新增第二套管理员样式，现有样式也增加多题入口。六类单题/整场出版沿用三种独立内容，整场由统一源码生成，资源/样例/局部引用按题命名空间隔离；保留 Beamer 原比赛题号和独立讲解顺序。缺稿先返回题号和类型，显式子集才跳过；两类题解独立子任务允许 PARTIAL_FAILED。单材料 PDF/用途包分别发布与撤回，发布事务核对当前选择，拒绝过期或带判题语义阻塞项的包。
- **P4.3：**新增 problem-format Exporter 包和原生 v1；六种用途从空清单白名单挑选，原生 FULL 可导入新私有题，保留字节与版本引用，不继承成员/审批/发布/验收，模板仅引用。跨实例缺模板保持未绑定并提示重选，profile 不匹配需显式映射。Polygon problem.xml 子集的内容/程序/测试/生成计划/工具/组与兼容报告，原包隔离、未知语义阻塞、有界 ZIP/XML/资源校验。导入检查和原包持久化，刷新可重开，确认同一报告幂等创建题目。详情见 PACKAGES.md。
- **P4.4：**题目组织/修订/协作、比赛编排/构建/PDF、用途包与离线导入页面；用户组管理入口。新增四个显式真实验证脚本和独立 contest 快查范围，默认 test/test:quick 固定清单保持不变。README、架构、模板、包协议与阶段计划同步更新。

新增迁移 `20261001010000_collaboration` 已部署。迁移前确认没有正在执行的任务，停止已确认属于主目录的 API/两个 Worker 后生成 Prisma 并重启，避免 Windows DLL 占用；没有重置数据库、覆盖旧配置或创建工作树。依赖锁新增 problem-format、固定 yazl/saxes；旧迁移 SQL 和上游样式原文件不被重新格式化。

## 本轮 P4 实际验证

- **类型/快查：**contracts、database、domain、template-engine、problem-format、api、web、tex-worker 按修改范围检查通过；每块必要修正后仅重查相关包。`pnpm test:quick template` 四项通过；`pnpm test:quick contest` 检查多题同名 label/ref、图片和样例路径隔离、讲解次序和原题号、实际时间/内存插槽，并保留 verbatim 字面代码，通过。默认范围未扩大，未隐式运行全仓/E2E/真实沙箱。
- **协作脚本 `verify:p4:collaboration`：**实际复制验证题、语言 TRANSLATOR 对应语言读写和越权拒绝、用户组 REVIEWER 审批、版本评论/解决、审核冻结、草稿修改使审核过期但旧清单不漂移、CAS 409、回滚新版本和原冻结保留、撤销组成员后 404。复制后及回滚后真实 Judge 验收通过。证据 `.local/verify-p4-collaboration.json`。
- **六套模板：**每套实际 Linux XeLaTeX 验证、所有页渲染检查后由 ADMIN 发布。初次简洁题面缺 fancyhdr 的真实失败得到修复；逐页复查还修复了页首裁切及重复题号。新草稿单独发布，旧版本不变。证据 `.local/p4-templates/validation.json`、该目录 PDF 与 qa/contact 图片。
- **比赛脚本 `verify:p4:contest`：**分组求和、交互翻倍、文件 I/O 求和三道不同样例分别真实 Judge 通过后审阅冻结；生成统一源码题册、书面题解集和 Beamer。源题修改不漂移；讲解按 C/B/A 排序而题号不改。题面匿名 PDF 下载成功，题解仍私有，撤回后 404。故意制造合法内容策略但不能编译的 Beamer 源码，验证书面题解成功/Beamer 失败的 PARTIAL_FAILED；修复并重新冻结后各类型独立成功。旧选择的正式发布 409。证据 `.local/verify-p4-contest.json`，三份最终 PDF 在 `.local/p4-contest`，4 页题册、4 页书面题解、11 页 Beamer 全部逐页检查。
- **题包脚本 `verify:p4:packages`：**原生 FULL 源码/正文/字节哈希/组配置往返一致，导入无旧审批或成功验收，同一检查幂等；新题实际 Linux 验收通过。题面、两种题解、数据、参考解用途逐项隔离，DATA 从冻结验收取得固定答案；比赛包逐题 ZIP；题面包独立匿名下载/撤回，完整包私有。自建 Polygon ZIP 真正解析导入，程序验收与 Validator 接受/拒绝自测通过，生成计划 argv/末尾整数种子及组依赖对应，外部样式留隔离。导出 XML 可解析，未知评分策略阻塞确认，DTD/外部实体与 ZIP 路径穿越 422。证据 `.local/verify-p4-packages.json` 及 `.local/p4-packages`。
- **边界脚本 `verify:p4:boundaries`：**停用某题 Beamer 后先明确返回缺稿且不产生子任务，显式只选 B 题真实编译成功并保留题号；比赛 VIEWER 不能写比赛或直接访问源题，撤销后旧包与 Build 下载/读取 404。纯模板变更保持相同 Judge 哈希/run，产生带 CARRY_APPROVAL 的新修订。原生 NUL/非法 UTF-8/CRLF/尾空格字节哈希保持，导入后实际下载逐字节一致；缺失跨实例模板明确警告并保持未绑定。证据 `.local/verify-p4-boundaries.json`。收尾定向复核 Polygon 的两类题解单独作为附件、XML 仅列题面，带绑定样例的题面用途包输入/答案哈希一致且无题解和程序泄漏，证据 `.local/verify-p4-final-packages.json`；未重复真实 Judge 或全量验收。
- **浏览器：**普通作者真实保存比赛场次并刷新、冻结 #4、从页面发起题册及双题解任务并看到三份 SUCCEEDED、PDF.js 翻至 C/B/A 讲解目录。实际保存标签备注、建立修订 #3、评论并解决、提交/批准/冻结；生成题面用途包并实际下载；上传完整原生 ZIP、检查报告、明确确认创建新题，刷新后源码/数据与 DRAFT 状态保留，没有旧成功验收。历史导入检查可重开且原包只允许请求者访问。修复浏览器发现的 reactive 数据不能 structuredClone 问题。证据 `.local/verify-p4-browser.json`、p4-contest-browser.png、p4-collaboration-browser.png、p4-package-browser.png、p4-import-browser.png。

最终核对七个迁移 SQL 的 SHA-256 与数据库一致，所有 Build/TestRun 均无排队或运行任务；API/Vite/TeX/Judge 实际命令行均加载主目录源码，证据 `.local/p4-final-state.json`。修改仍未提交，没有 push 或公网发布。验证账户、凭据、私有包、PDF 和截图全部在忽略的本地数据中；历史失败和取消记录保留。

## P4 未验证范围与限制

Polygon 测试用的是按已记录字段自行构造的实际离线 ZIP，未下载带认证的外部题包、未向 Polygon 或其他 OJ 上传验证，不能宣称完整兼容。未知字段和不等价判题语义报告/隔离，详见 PACKAGES 的进出方向边界。没有覆盖全部语言×计分×交互×模板/资源组合、任意非标准 XML/压缩实现、模糊或并发压力、完整故障注入，也没有重跑全部 P0—P3、生产构建、生产部署或备份恢复。三个示范 PDF 和六套模板的逐页检查不代表所有作者内容均可排版成功。

P4 的计划主链路没有环境阻塞。生产运行保障、完整配额/缓存/SSE/审计强化/恢复和生产部署仍属 P5；当前已有任务清单/补投/取消不代表 P5 已实现。

## 历史交接（2026-10-01，进入 P5）

- 继续直接在 `D:\project\ProblemForge`；分支 master、基线 `550f0c8`，P3 与 P4 改动均未提交。先读 AGENTS、本文及 PLAN，按完整 P5 范围推进，不新建工作树，不 push，不发布公网，不访问现有 OJ。
- 前端 `http://localhost:5180`，API `127.0.0.1:3100`；数据库 problemforge_f054、Redis DB 1、私有存储 `.local/p3-storage`，容器端口仍为 15432/16379/15050/15051。主目录父进程记录 `.local/p3-services.json`：API 16724、Judge 78604、TeX 62140；Vite 本次 PID 74548。后续须重新核对存活命令行与队列，不盲用旧 PID 或启动第二组消费者。作者与管理员登录凭据仍分别在 `.local/verify-p2-fixture.json`、`.local/bootstrap-admin.txt`，禁止写进提交。
- 推荐打开比赛 `cmuoh0dm7006bktjk0bgeq57w`，当前冻结 #4 为 `cmuoi5ay7003uktdocwi3oj0t`，三类成功 Build / Artifact 见 `.local/verify-p4-browser.json`。原脚本记录的 #3 已成为历史清单，这是后续浏览器编辑场次产生的正常版本行为。
- 协作示例题 `cmuogcz7p0008ktc81l3k3pm2`，浏览器已冻结修订 `cmuoi9oie0002kthw80cw5sh0`；Polygon 导入示例 `cmuoi33z10028ktdok35j34a7` 已真实验收，需显式选择本地题面模板。浏览器新导入题 `cmuoidkui0002kt6cjolfphqy` 故意保留 DRAFT 且尚无新验收，不能当作已冻结题。
- P4 模板使用每类两套共六套已验证版本，数据表里仍保留旧草稿与失败记录。后续修改内置文件不自动更新已发布模板，必须新建草稿并真实验证。比赛渲染器现为 pf-contest-2，历史 pf-contest-1 产物保留，旧快照不能用新渲染器静默重试。
- 下一步先盘点现有 Build/TestRun 的租约、幂等、补投和恢复缺口，再实施 P5 的可靠调度/SSE/缓存配额/审计、Linux 应用镜像与完整私网 Compose、备份恢复和一次实际部署迁移验证。继续使用定向检查，默认快查不扩大；生产环境应选本项目隔离目标，不能覆盖当前开发证据或复用其他 OJ。

## 本轮 P5 实现（2026-10-01）

- **P5.0：**Build / TestRun 数据库租约及心跳、原子领取、进度/终态所有权检查，过期记为 WORKER_INTERRUPTED 并保留部分证据。已投递但 Redis 丢失的 QUEUED 记录仍可补投；重复配送不能抢占 RUNNING。单题/比赛/模板构建幂等，前端保留未确认请求键，取消排队任务立即终止；显式重试唯一子项、默认三次尝试上限。
- **P5.1：**同题编译缓存覆盖源码/profile/工具链/testlib/执行策略，固定对象 PDF 缓存覆盖完整快照和渲染版本。实际字节校验、来源标记、缓存不冒充新执行，私有下载继续检查当前权限。用户行锁序列化任务配额，ManagedStorage 在数据库全局锁下预留容量后写文件；迁移旧文件的离线登记工具核对不可变哈希，保留未完成预留。SSE 有界连接、按当前会话/对象重新鉴权、最新状态重连及断线低频回查。健康检查、Worker 心跳、业务/拒绝/失联审计与管理员界面。
- **P5.2：**Linux Node 应用镜像内实际生成 Prisma Client、构建 Vue 静态资源，以 Node 运行 API/Worker。完整 Compose 隔离数据库/Redis/两类沙箱和私有卷，API 仅回环端口，应用非 root、只读根目录、无 Docker socket，Linux 沙箱仍为独立特权组件。默认 CI 只按变更及下游依赖选类型/固定快查，范围失败不回退全仓；生产构建是独立手动工作流，不推送镜像。
- **P5.3—P5.4：**生成独立配置、部署/管理员初始化、清单核对、停止写入的一致备份与不同 project 空实例恢复工具。校验实际镜像 ID、dump/tar 摘要、安全成员路径/类型、SQL 迁移字节及私有文件后才启动恢复实例；不复制 Redis。新增显式 P5 验证入口及 DEPLOYMENT 说明，README/架构/PLAN 同步；P0—P4 未变化证据继续有效。

第八个迁移 `20261001020000_runtime` 已在开发库部署，也在全新 Linux 生产实例从零应用；旧迁移 SQL 未改写。停止已确认的主目录 API/两个 Worker 后生成 Windows Prisma，再以主目录源码重启；未建立工作树或重置旧库。升级时登记开发私有文件 509 个、2,643,431 字节，后续新增文件由 ManagedStorage 计量。

## 本轮 P5 实际验证

- **类型/构建与范围选择：**按功能块检查 contracts、database、domain、api、web、judge-worker、tex-worker 并通过；后续 TeX 中断分类及缓存文案修正后重查 tex-worker/web。`pnpm install --offline --frozen-lockfile` 成功。Linux 镜像实际 `pnpm install --frozen-lockfile`、Prisma 生成和 Vue 类型检查/Vite 生产构建成功，实际 Node 22.23.3。存在前端 3.42 MB 主块的体积提示，没有包装为无警告构建。CI 选择器验证文档空范围、仅 TeX Worker、共享 contracts 下游和删除脚本路径；空范围明确未执行，默认快查未扩大。没有重跑全套 P0—P4 或默认全范围测试。
- **`verify:p5:runtime`：**真实并发幂等、首编 PDF 与后续同字节缓存、Python 编译缓存及源码修改后实际重编；新增 C++ 正确解首次实际编译，第二次缓存二进制参与完整验收并全部 AC（run `cmuowm2md00a2ktqwf8wqcap7`）。SSE 连接有状态事件，授权撤销后收到关闭事件，缓存 PDF 下载转为 404；普通用户运行管理 403。并发提交配额与同时预留存储字节只有合法数量成功。非空 queuedAt 的缺失 Redis 记录补投成功；注入过期租约后失败，重复领取/旧 token 续租/旧终态提交均拒绝；并发重试同一子任务、重试链达到上限拒绝。证据 `.local/verify-p5-runtime.json`、`.local/p5-final-state.json`。
- **独立生产部署：**`problemforge-p5` 从空卷部署，八个迁移、Linux API/两个 Worker 与健康检查通过。修复了首次部署的 Worker 健康脚本包路径、Compose tmpfs 参数和内部网络端口映射；API 加入独立入口网络，其他服务保持 internal 且无宿主机端口。实际应用镜像 ID `sha256:bb5a8f046fe5f7af4b7d41db3553a6009a4d1ee7f3c6056322f71de0509c3449`。凭据与开发环境分开，没有访问其他项目或 OJ。
- **`verify:p5:deployment`：**三套第二样式在新实例真实验证，全部样稿页预览后发布。P4 的分组求和/交互翻倍/文件 I/O 三题原生 FULL 包导入新私有题，显式重绑模板，重新执行三次真实 Linux 验收、审核冻结和比赛冻结。实际生成 4 页题册、4 页书面题解、11 页 Beamer，逐页渲染检查；讲解 C/B/A 而题号不变。题面匿名下载、题解私有 401、撤回后 404。证据 `.local/verify-p5-deployment.json`、`.local/p5-deployment` PDF 及 qa 图片。
- **真实故障恢复：**对专用生产实例在生成器执行后实际 `SIGKILL` Judge Worker。旧任务 `cmuoxa11r006do707btfxszm9` 最后心跳 02:36:07.183 UTC、02:36:54.282 UTC 记为 FAILED / WORKER_INTERRUPTED，8 条已有 Invocation 保留，readiness 返回 503。重启后显式重试 `cmuoxb6d9006lo707t6ipl2qw` 完成全部 30 轮。随后停止该 Worker，提交 COMPILE，再真实删除对应 Redis job；API 补投后重启 Worker，任务 `cmuoxdtay006vo7079bqfo0h2` 成功。修正验收子进程继承开发 `.env` 的问题后从已完成中断阶段接续队列演练，没有伪造或删除历史任务。证据 `.local/verify-p5-recovery.json`、`.local/p5-deployment/crash-checkpoint.json`。
- **执行隔离：**在生产 toolbox 分别实际调用两类沙箱，作者 uid 20000/21000，业务文件不可见、工具链只读、执行网络隔离、CPU 超限终止，不可用端口明确 InfrastructureError。Docker inspect 确认 API/Worker uid/gid 10001、只读根、ALL capability drop、非 privileged、仅私有 `/data` 挂载；沙箱无业务卷/端口映射，后端网络 internal。证据 `.local/verify-p5-isolation.json`。
- **备份/恢复：**浏览器在停止的 Judge Worker 下提交真实排队任务 `cmuoxfjux006zo707dq59f974`。备份 `.local/backups/p5-proof` 包含 2 用户、8 题（含保留的演练准备记录）、1 比赛、6 Build、10 TestRun、6 Artifact、81 个登记文件共 2,494,083 字节及八个迁移。恢复到全新 `problemforge-p5-restore` / 独立卷，先逐项确认数据库计数、迁移与文件清单哈希相同，再健康启动；修正独立 storage-init 一次性容器被 `--wait` 误判的问题，未覆盖源库。恢复后的原账号可登录，冻结比赛和三份 PDF 原哈希/三次成功验收保留，备份内排队任务由空 Redis 自动补投成功，新建 PDF 缓存任务也成功。恢复后离线登记最新源码工具成功核对 82 个对象、2,540,559 字节，随后全部服务健康启动。证据 `.local/verify-p5-restore.json`、备份 manifest/state。
- **浏览器：**从生产静态入口登录管理员，查看健康/配额、筛选真实 TASK_LEASE_EXPIRED 审计；在题目工作区点击编译，任务中心显示 QUEUED 与“实时连接”。备份重启原 API/Worker 后未点击刷新，页面自动重连并显示 SUCCEEDED。编译日志明确“已复用编译缓存 · 本次未重新编译”，没有不存在的 stdout/stderr 下载；刷新页面后成功任务仍在。证据 `.local/verify-p5-browser.json`、`p5-operations-browser.png`、`p5-tasks-browser.png`、`p5-cache-browser.png`。
- **取消时序收尾修正：**取消到达续租前不再被误认为 LEASE_LOST；Judge 提交终态时读到取消也明确按 USER_CANCEL 归因。domain / api / 两个 Worker 重新定向类型检查通过，确定性取消/续租时序注入保留原持有者且拒绝错误 token。新版生产镜像中实际运行对拍后取消，得到 CANCELED、无错误码、保留已有执行证据；后续编译成功。证据 `.local/verify-p5-cancel.json`，小型时序回归已保留在显式 runtime 验证脚本。当前 5181 镜像 ID 为 `sha256:38fa5cb6fbb6aa860cdb8fd85312af0a1e05e38f41c8fa590f066afecb86addd`；上述备份原镜像另标 `problemforge-app:p5-backup-20261001` 并保留，5182 恢复实例继续固定该原镜像，未伪称重新做过第二次恢复。

收尾核对开发库八个迁移 SHA-256 与本地 SQL 一致，Build/TestRun 无排队或运行任务；四个开发进程命令行仍指向主目录。所有凭据、私有数据、PDF、截图和备份都在 Git 忽略目录；P5 验证收尾时 P3—P5 改动尚未提交，随后按用户新增要求补交，见文末。没有 push 或公网发布。

## P5 未验证范围与运行限制

已完成的是 Docker Desktop Linux 引擎中的单机生产镜像/私网部署演练。未在另一台原生 Linux 主机、域名 HTTPS/反向代理、公开网络、集群/多 API 副本、网络分区、数据库断电、磁盘损坏或并发压力下全面验证；没有覆盖所有租约故障时刻/资源上限组合。SSE 返回最新数据库状态，不提供独立历史事件日志；连接配额按单 API 进程计数。备份有短暂业务停机，未内置加密、异地上传或自动排程；必须保管原镜像 ID 与配置。崩溃文件预留保守占容量，不自动删历史或释放无文件记录。生产镜像体积和前端拆包仍有优化空间。GitHub 工作流没有在远端运行（本轮不 push）。这些边界不冒充已测试的高可用交付。

P4 的外部 Polygon 兼容、全部语言/模板/交互/评分组合和完整模糊/压力边界仍仅按原记录，不因本轮部署自动变成已验证。P0—P5 计划主链路没有环境阻塞。

## P5 收尾运行交接（2026-10-01，历史记录）

- 继续在 `D:\project\ProblemForge`，分支 master，不新建工作树，不推送。P3—P5 补交前的实际 HEAD 为 `cc1e309`（P3 计划与交接），其父提交 `550f0c8` 为 P2 功能基线；历史交接中的“基线”指后者，当前提交以 `git log` 为准。先核对当前服务/队列，不启动重复消费者。后续按具体用户反馈、维护或部署目标处理，既定 P0—P5 已满足阶段交付条件。
- 开发入口 `http://localhost:5180`，API `127.0.0.1:3100`，原 problemforge_f054 / Redis DB 1 / `.local/p3-storage`；主目录父进程 `.local/p5-services.json`：API 72472、Judge 31912、TeX 15392，Vite 74548。下一次重新核实存活命令行，不盲用 PID。原开发凭据继续在 bootstrap-admin.txt / verify-p2-fixture.json。
- 生产演练入口 `http://localhost:5181`，Compose project `problemforge-p5`，配置 `.local/p5-prod.env`；恢复入口 `http://localhost:5182`，project `problemforge-p5-restore`，配置 `.local/p5-restore.env`。两套都使用本项目独立卷/私网，当前保留运行；恢复实例账号密码沿用原数据库，不是 restore.env 随机初始化密码。演练作者凭据在 `.local/p5-deployment/author.json`。
- 部署示范比赛 `cmuowvtou007unq07ome47k89`，固定修订 `cmuowvtpo007ynq071eywug0z`；三题/成功运行/三份 PDF 见 `.local/verify-p5-deployment.json`。备份及原镜像 ID 保存在 `.local/backups/p5-proof/manifest.json`，恢复验证见 verify-p5-restore.json。不要清理这些卷或覆盖配置来复跑演练；新演练使用新的 project/备份目录。
- 操作流程见 [DEPLOYMENT.md](DEPLOYMENT.md)。故障脚本可用 `--resume-queue` 从成功的 crash-checkpoint 接续队列阶段；只对指定演练 project 使用。真实检查仍是显式入口，默认 test/test:quick 不扩大。

## 阶段提交规则与补交（2026-10-01）

用户要求每个阶段完成后先提交，再推进下一阶段。已同步到 AGENTS 与 PLAN：完成阶段实现、必要定向检查及交接记录后，创建本地 Git 提交，成功后才继续；不 push。

此前 P3—P5 的代码已经在共享文件中连续演进，尚无独立阶段提交；本次将已验证的完整成果补为一次 `feat: complete P3-P5 authoring and deployment` 提交。各阶段的实现、真实验证与未验证范围仍按上文保留，不将本次整理记为重新执行全部验收。既定 P0—P5 已完成，没有新增 P6 范围。本次仅修改规则和交接文档，复用已记录的功能检查，不重启服务、不改动数据库或私有运行数据。

提交前核对 168 个暂存文件，未纳入私有目录或本地凭据；8 个迁移及 58 个内置模板文件的暂存字节与工作区逐一相同。两份已部署迁移保留原始 CRLF，Git 迁移属性显式接受 CRLF/空白文件尾，不修改 SQL 字节或部署校验和。

## 交付后维护：工作台按需加载（2026-10-01）

**实现：**页面改为路由按需加载。SourceEditor / PdfPreview 保留原接口，分别在使用时加载 MonacoEditor / PdfRenderer；没有产物时只显示空预览。两个实际编辑/渲染实现与原版本内容相同，授权、保存和渲染逻辑未改写。判题与协作区首次进入才挂载，之后切换只隐藏，保留未保存草稿与编辑器状态。提供页面/组件加载反馈及失败后的明确刷新入口，不自动刷新。工作区在开始请求数据前注册未保存内容的 beforeunload 保护，避免异步初始化期间漏挂监听。

**实际验证：**

- `pnpm --filter @problemforge/web build --manifest` 完成 Vue 类型检查及实际 Vite 生产构建。按 manifest 递归计算入口和当前路由的全部静态依赖（包含共享块）：登录 JS 从 3,423,937 降为 365,422 字节，减少 89.3%；题目列表为 379,823 字节。登录 CSS 从 80,137 降为 12,229 字节；构建估算的登录 JS gzip 合计从 927,686 降为 121,399 字节。证据 `.local/verify-web-load-build.json`，基线构建 `.local/web-load-baseline`。
- 在原 5180 入口临时运行实际生产构建预览，保留 3100 API 和两个 Worker；本地预览中间件仅记录请求路径并按指定资源注入一次 503。登录/题目列表没有请求 Monaco / PDF.js，空 PDF 工作区没有请求 PDF 渲染器或 Worker，JudgeWorkspace / ProblemManagement 只在点击相应功能区后请求。证据 `.local/web-load-startup.json`、`web-load-panels.json`、`web-load-requests.jsonl`。
- 普通出题人实际编辑 LaTeX 和 Python 源码，来回切换功能区后两份未保存编辑均保留；协作区正常首次加载。编辑器资源 503 后显示明确失败，未保存元信息时刷新被阻止，原编辑仍在；保存后刷新恢复编辑器。路由资源 503 时保留原工作区并显示恢复提示，点击刷新后成功进入任务中心。浏览器会缓存失败模块，因此最终使用显式刷新恢复，不将无法可靠恢复的同页重试作为成功方案。
- 从既有冻结比赛选中成功 Beamer 构建，才请求 PdfRenderer、PDF Worker 和受保护 PDF；真实显示 11 页并翻至第 2 页 C/B/A 讲解目录。最终正常页面未见前端控制台错误。证据 `.local/web-load-pdf-browser.png`、`web-load-route-error.png`、`verify-web-load-browser.json`。
- 验证使用原 DRAFT 导入示例题 `cmuoidkui0002kt6cjolfphqy`。临时编辑已撤销，原始题面保存形成 v3；数据库逐项确认正文、元信息和样例引用与 v1 完全相同，程序仍为原 v1。没有提交新 Judge / TeX 任务，收尾开发库两个队列均无活动任务。证据 `.local/verify-web-load-state.json`。

**未验证与限制：**上述是生产构建依赖体积和本机实际交互验证，不是慢网/冷启动耗时或所有浏览器性能基准。Monaco 按需块仍为约 2.28 MB，Vite 的大块警告保留。未重跑全套页面/管理员流程、历史 Judge / TeX、Linux 镜像构建或备份恢复。5181 / 5182 演练容器仍为原 P5 镜像，不能将本轮前端优化宣称为已更新生产部署。

**当前交接：**主目录 master，基于 `9ff0ec3` 完成本阶段并单独提交，当前提交以 `git log` 为准，不 push。临时预览/故障注入进程已停止，5180 已恢复主目录 Vite 开发服务，当前 PID 2156，记录 `.local/web-load-services.json`；API / Judge / TeX 父进程仍见 `.local/p5-services.json`，后续先核对实际命令行。数据库、Redis、私有存储和 5181 / 5182 配置沿用 P5 交接。既定 P0—P5 与本维护块均已完成；后续按用户反馈继续范围补齐或体验维护，仍逐阶段验证、更新交接、提交。

## 后续计划交接（2026-10-01）

用户询问原计划是否完成并要求后续计划。核对 PLAN、现有接口及部署/包格式记录：P0—P5 与按需加载维护块已完成，功能提交分别为 `9ff0ec3`、`21c6915`。当前证据覆盖单机私网部署及代表业务流程；独立 Linux 主机/HTTPS、真实外部 Polygon 样包和代表规模验证仍未完成，5181 / 5182 仍为原 P5 镜像。

PLAN 已追加待实施 P6—P8：账号生命周期、历史分页检索、编辑体验/试用指引、版本化升级回退、备份与容量维护、指定 Linux/私网 HTTPS、真实 Polygon 样包与规模验证。排序依据包括实际代码中用户管理只有创建入口、Build/TestRun 查询固定最近 50 条，以及已有部署和格式验证边界。每个 Px.y 完成后定向验证、更新交接并单独提交，再继续下一项。

下一次从 **P6.0 账号生命周期** 开始。涉及指定主机、真实样包或外部备份目标的项明确列出依赖，不把缺少环境标为完成。本轮只更新计划和交接，未开始新功能实施，未重跑业务测试、变更运行服务或部署镜像；文档差异检查作为本次验证。
