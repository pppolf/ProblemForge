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

## P6.0 账号生命周期（2026-10-01）

**范围调整：**用户已要求实施后续计划，并明确暂不进行独立 Linux / HTTPS、真实 Polygon 样包和代表规模验收（P7.2、P8.0、P8.1）。继续 P6 与本地 P7.0 / P7.1，每个阶段验证、更新交接并提交后再推进。

**实现：**管理员编辑账号信息、启停和角色调整，CAS 防覆盖；个人修改密码、查看有效会话、退出其他/所有设备；管理员一次性密码重置和会话撤销。重置凭据 30 分钟有效，只存摘要、单次消费，页面仅展示一次 fragment 链接，旧密码在重置期间停止登录。姓名以外的权限/身份变更撤销旧会话与重置链接。事务锁覆盖账户写入与登录签发，锁内重查操作者，保护最后一个可登录管理员及并发登录时序。业务审计事务提交且不含凭据，新增日志脱敏字段。规则详见 ACCOUNTS。

新增第九个迁移 `20261001030000_accounts`，开发库已实际应用，原八个迁移不变。迁移前确认无活动任务，停止已核实主目录服务后生成 Prisma / 部署迁移 / 隐藏重启；API / Judge / TeX 父进程现在分别为 48816 / 64348 / 12500，记录 `.local/p6-services.json`。Vite 仍为 PID 2156、5180；数据库、Redis、存储和沙箱沿用 P5。后续先重新核对命令行，不盲用 PID。

**实际验证：**`pnpm check contracts database api web` 通过。显式 `pnpm verify:p6:accounts` 在独立库 `problemforge_p60_verify_138efd64db0f` 从零部署九个迁移，验证普通用户管理越权、Origin/CSRF、DTO 无凭据、密码错误/正确更改与所有旧会话失效、其他设备撤销、账号版本冲突、停用后新旧登录拒绝、启用、角色变更、SSE 实际连接撤销、重置过期/替换/并发单次使用/重用拒绝、管理员撤销会话、保留登录限流及无凭据审计。确定性锁等待注入验证“旧密码已验证、停用后才签发”的登录竞态被拒绝；两个管理员并发自行降级只有一个成功，最后一个管理员的停用/重置均被拒绝。没有改动开发管理员或运行作者程序。证据 `.local/verify-p6-accounts.json`。

浏览器实际以开发管理员打开用户管理，对单独创建的普通验证账号 `cmup7p3i00002ktdkbs09ca28` 修改名称为“P6 浏览器验证 · 已核对”并停用，刷新后名称/状态仍保存且重置按钮禁用；证据 `.local/p6-accounts-browser.png`。该验证账号保留停用，不影响原作者。收尾开发 Build / TestRun 活动数均为零。

**未验证与限制：**密码重置/修改的安全语义通过真实数据库与 Fastify 接口验证，浏览器代表性验收覆盖资料编辑和停用，不将全部密码表单操作记为浏览器已走查。未重跑 Judge / TeX、完整回归、Linux 生产镜像或部署；5181 / 5182 仍为 P5 镜像。无邮件发送和开放注册。本阶段本地提交后进入 P6.1 历史与列表。

P6.0 已单独提交为 `f0348f1`，再开始以下阶段；未 push。

## P6.1 可检索的历史与列表（2026-10-01）

**实现：**新增 Build / TestRun 分页摘要接口及题目服务器检索，按创建时间和 ID 稳定排序、固定查询时间上界，游标绑定用户/集合/筛选。任务按状态、用途、题目或比赛、起止时间查询，详情继续使用原授权日志/报告/PDF 接口；列表不再传输正文、源码、输入快照和长日志。权限逐项检查，翻译成员保留语言隔离，有界扫描不会因最近 50 条都不可见而丢失更早记录。新增第十个迁移 `20261001040000_history_indexes` 已在开发库应用，只增查询索引，不改旧迁移。

任务中心分页、筛选和所选任务保存在 URL；页面刷新保留历史位置，SSE 关注可见及选中历史 ID，实时更新不替换分页或所选记录，新任务仅提示。断线回查沿用当前游标。修复首次页游标写回/刷新覆盖尚未提交筛选输入的情况。题目工作区增加完整历史入口，已选构建移出最近 50 条后仍保留。旧摘要接口保持兼容，比赛构建可在任务中心按比赛 ID 完整检索；当前比赛编排及修订选择沿用原入口，未扩大到无实际需要的全站分页重构。使用说明见 HISTORY。

**实际验证：**`pnpm check api web` 通过，筛选输入保持修正后再次检查 web 通过。显式 `pnpm verify:p6:history` 在独立库 `problemforge_p61_verify_77a3bd929d32` 从零应用十个迁移，64 条 Build 和 64 条 TestRun 的同时间戳分页无重复遗漏；插入新记录不改变既有查询；分页重开一致；历史记录详情可读。状态/用途/对象/日期筛选、伪造和跨用户/集合/筛选游标、私有对象越权、翻译语言隔离与撤权均通过；题目名称、标签子串、负责人、归档与权限分页通过。实际 SSE 包含最新 50 条之外的关注任务且收到注入状态变化，隐藏对象没有泄漏。全部为终态元数据夹具，未执行作者程序或 TeX，未改开发历史证据。证据 `.local/verify-p6-history.json`。

实际浏览器以原 P2 作者连续读取 25 / 25 / 24 条共 74 个不同的既有 Judge 任务，在第三页打开真实旧验收 `cmuo2ghuq006zktkg217j0ozy` 的矩阵；刷新后页游标和所选报告均保留。按比赛 ID 找到 11 条原构建，打开 Beamer `cmuoi5j8c0042ktdo8ob5q6wa` 的 11 页旧 PDF 并翻至第 2 页。为验证新任务提示，仅在开发库插入一条明确标注“未投递、未执行”的 CANCELED Build `cmup8fcb90001kt5kctxlqh3y`；页面收到新任务提示，同时仍显示原 11 条、本来的 Build 和 PDF 第 2 页。原记录未修改。题目页实际检索“分组”得到 4 道授权题，筛选进入 URL。证据 `.local/verify-p6-history-browser.json`、`p6-history-browser.png`、`p6-history-pdf-browser.png`、`p6-history-event.json`。

**边界：**游标固定插入时间上界，不冻结后续状态、权限或数据库；大量不可见候选可产生带下一游标的短/空页。刷新后页位置保留，内存中的“上一页”栈不保留，可回最新或继续更早记录。未进行代表规模压测（用户暂不要求）、Judge / TeX 新执行、全量回归或生产部署。开发服务位置与 P6.0 相同；提交本阶段后进入 P6.2。

## P6.2 编辑体验与试用指引（2026-10-01）

P6.1 已单独提交为 `83f40c6`，再开始本阶段。**实现：**文稿、程序、比赛编排和模板共用持续保存状态/失败提示与本地草稿导出窗口，可下载、复制或直接取回 JSON。保存按请求发出时的快照做三方合并，接受服务器版本/规范化字段，保留其后输入；数组作为整体保留本地改动。模板和比赛的 CAS 写入与返回快照放在同一事务，避免返回另一个请求刚写入的版本。模板保存/复制期间阻止切换和编辑，比赛冻结要求保存完成。统一路由离开/刷新保护，退出登录先经过编辑保护；401 保留当前编辑器和本地内容，提示先导出再登录。

按账号与对象在标签页 sessionStorage 只保存导航位置：语言、文稿、功能区、程序、比赛标签、模板版本及上次题目/列表搜索地址；不持久化正文、源码或凭据。添加网页「使用指引」及 USER_GUIDE，覆盖作者、审题人、管理员和比赛导出流程。

**实际验证：**`pnpm check api web` 通过。`pnpm verify:p6:editing` 在独立库 `problemforge_p62_verify_27f2056164c0` 验证文稿/程序延迟响应、模板生成文件/本地删除、比赛排序、深拷贝与稳定比较；六个模板写入者、六个比赛写入者竞争，分别出现 15 次版本冲突，成功响应均是本请求提交的内容及准确基准版本。导出窗口调整后 `--logic-only` 再验证合并和 JSON 取回通过。未扩展默认快查。

浏览器以原出题人编辑 DRAFT 示例标题，再由另一会话提交相同原始内容制造真实 409；页面持续保留待合并标题，导出窗口展示基准 v4 与完整正文，实际点击复制并读取剪贴板核对通过，保存 `.local/p62-exported-draft.json` 和 `p6-editing-conflict-browser.png`。示例服务端现为 v5，两个新版本都是原始内容；接口核对正文、元信息、程序版本未改，开发 Build/TestRun 活动数均为零。网页使用指引及既有六稿件示例成功加载；比赛、历史验收和 PDF 沿用 P4/P6.1 的真实记录，没有重新执行 Judge/TeX。

**验证限制：**内嵌浏览器的 Blob 下载事件未返回，文件下载未记为成功；页面提供并实测了复制 JSON 的恢复途径。原生离开确认触发后浏览器控制接口出现焦点命令超时，未完成本轮取消确认、导航恢复、401 保留和所有编辑器的逐一浏览器验证；刷新保护复用此前按需加载阶段的实测，当前统一实现已通过类型检查。没有把这些限制写成已实测成功。无服务端业务阻塞，继续本地 P7.0 / P7.1；P7.2/P8 仍按用户要求暂缓。开发服务和库/存储沿用 P6.0，生产 5181/5182 尚未升级。

## P7.0 版本追踪实现检查点（2026-10-01）

P6.2 已提交 `eaa8a26`。版本构建入口只接收当前干净提交的 Git archive，生成镜像内 Git/构建/迁移信息及外部镜像 ID 清单；运行页显示装载版本和数据库迁移一致性。新增独立演练验证脚本，读取 P5 冻结比赛、验收报告、三份 PDF，并检查 P6 接口、版本匹配及前端静态依赖。

`pnpm check api web`、两个构建脚本语法检查及差异检查通过。为使发布镜像对应确定提交，本次先提交已检查的版本追踪实现；**P7.0 演练尚未完成**，随后从此提交构建并执行升级/重启/回退，再单独提交实际结果，完成前不进入 P7.1。原 P5 两实例、卷及备份未修改。

## P7.0 升级与回退演练完成（2026-10-01）

**实际镜像：**从干净提交 `1d35083731b4f7270c9d8566549afd7544cdfbb4` 的 Git archive 构建 `problemforge-app:p7-20261001`，镜像 ID `sha256:97db6af078f53c9cdd7ad6f666f09a5a1b20401fe1253da85e9bc7f9d59167ed`，清单 `.local/releases/p7-20261001.json`。包含完整 P6、版本面板及生产按需前端；构建类型检查通过，Monaco 大块提示仍保留。另从真实 P6.2 提交 `eaa8a26` 构建兼容回退镜像 `problemforge-app:p6-baseline-20261001`，ID `sha256:39ad845f55499d830a1f67237a59d625aa90560aebf6bdbe7b67650b6f413b57`，没有伪造旧版本代码或移动原 P5 标签。

**实际路径：**新 project `problemforge-p7-upgrade`、配置 `.local/p7-upgrade.env`、5183，从原 p5-proof 匹配镜像恢复，核对数据库/文件清单一致；旧排队记录按原机制恢复，未创建新的 Judge/TeX 任务。再做独立 `.local/backups/p7-before-upgrade` 一致备份，升级至 P7 镜像，实际应用账号/历史两个迁移，重启 API/两 Worker，再切回相同十迁移及相同账号安全语义的 P6.2 镜像，最后回到 P7。升级、重启和兼容镜像回退的冻结比赛、三个验收报告和三份 PDF 哈希均通过；P6 会话/账号字段、历史连续分页、镜像 ID/提交/构建号及十个迁移校验和一致。生产入口静态依赖不含 Monaco/PDF 渲染器，Guide 分块存在且静态 JS 实际可取。

对于跨 P5/P6 的结构与安全语义变化，没有直接把 P5 镜像连到新库：将升级前备份恢复到另一个空 project `problemforge-p7-old-restore`（配置 `.local/p7-old-restore.env`、5184），八迁移及文件清单一致，原账号、冻结比赛和 PDF/报告实测成功。验证后停止这个演练 project 的容器，保留全部卷和配置。原 5181/5182 两套 P5 实例及 p5-proof 未改动。

证据 `.local/verify-p7-restored-p5.json`、`verify-p7-upgraded.json`、`verify-p7-restarted.json`、`verify-p7-image-rollback.json`、`verify-p7-old-backup-rollback.json`、`verify-p7-final-release.json`。最后回到 P7 时再次登录碰到正常 Redis 8 次/10 分钟限制，没有关闭或清除限流；最终通过容器镜像 ID、十迁移/81 文件哈希、无运行任务和公开健康检查确认恢复到已验收版本，不宣称该次重复登录成功。

**边界与交接：**仍是本机 Docker Linux 引擎、回环入口的独立演练，不是用户暂缓的独立主机/HTTPS 或压力测试；运行面板的数据接口、生产静态文件和构建已验证，本轮未重复全部浏览器流程。5183 保持 P7 运行，5184 保留停止的旧版恢复现场。提交本阶段结果后进入 P7.1；不 push。

## P7.1 维护功能实现检查点（2026-10-01）

P7.0 完成记录已提交 `ba2d95c`。新增配置式加密备份/恢复、逐次结果及失败退出状态、只读保留预览；随机 256 位密钥和 AES-GCM 文件认证，先全部认证再调用空实例恢复。临时明文仅在项目内逐成员清理，异常现场明确记录；同 project 的维护操作使用独占锁。管理员容量页面增加阈值、近 30 天新增登记量、未完成预留和缓存引用量。离线文件/数据库核对扫描全部 JSON 与文件键，保护冻结、发布/撤回、历史任务及缓存引用，只有完整且无引用的老文件进入人工复核预览，无删除入口。

`pnpm check domain api web` 及 Node 脚本语法检查通过；界面和 UTC 截止修正后 api/web 再查通过。`pnpm verify:p7:maintenance` 在独立库 `problemforge_p71_verify_65305a62a29a` 实测加密精确往返、错误密钥/损坏密文拒绝、保留最新规则、冻结/历史/撤回/缓存引用保留、缺失/损坏/未登记诊断、近期/预留不入候选、无删除、容量告警及管理员真实接口；没有 Judge/TeX 活动。证据 `.local/verify-p7-maintenance.json`。

为使实际维护镜像可对应确定提交，先提交已检查实现；**P7.1 真实加密备份的空实例恢复和生产离线盘点仍待执行**。后续从此提交构建新版本，在现有独立 P7 演练实例验证，再提交收尾；P7.2/P8 继续暂缓。

P7.1 真实演练中发现并修正：导入隔离报告保留原 ZIP 的 `blobs/...` 成员路径，不属于私有存储键。盘点改为在 ExportArtifact.report 中只保守匹配已登记/已存在的真实键，隔离 ZIP 本身仍按记录的 key 保留；其他历史修订与任务字段继续检查缺失键。`verify:p7:maintenance --references-only` 定向检查通过。首轮盘点的 12 条误报保留作诊断；81 个实际文件哈希均一致，77 个有明确引用，另外 4 个因未到宽限期而未列候选。首个加密备份已成功空实例恢复，但仍需用修正后的镜像完成最终盘点和备份恢复，不将误报写成真实文件丢失。

## P7.1 加密恢复与容量维护完成（2026-10-01）

**最终版本：**维护功能实现 `9b44638`，真实盘点中发现的导入 ZIP 路径误报修正为 `05375832fd9232732772b6e8d0a9c223bd282a43`。最终镜像 `problemforge-app:p71-20261001-r2`，ID `sha256:3ce3eff4fffd699a07554d476bf866a998fc8c06044da21b9dab8c02717c399b`，清单 `.local/releases/p71-20261001-r2.json`。没有新增数据库迁移，仍为十个迁移。两次实际生产构建均通过 Vue 类型检查；原大 Monaco 分块警告保留。

**实际演练：**升级前另保存 `.local/backups/p7-before-maintenance`，原 P5/P7 备份、镜像和卷均保留。在 `problemforge-p7-upgrade`（5183）停止写入并盘点：81 个文件 / 2,494,083 字节全部与登记哈希一致，无异常和未完成预留；77 个文件被当前数据库中的历史/冻结/发布/缓存引用保护，其余 4 个未到宽限期，没有清理候选，未删除任何文件或记录。最终报告 `.local/maintenance/p71-storage-final.json`；首轮误报报告保留用于说明修复。

按 `.local/p71-backup-policy.json` 创建实际 AES-256-GCM 备份。错误随机密钥和改动过密文的副本均在目标容器/数据库/卷创建前失败，生成 FAILED 记录；原密文不变，失败后临时明文被清除。第一份备份在独立 5185 空实例恢复并通过原账号、冻结比赛、三份 PDF 哈希、验收报告和 P6 接口核对，验证后停止其容器、保留全部卷。修正盘点后的最终版本再创建 `backup-20261001085800840-65ac789e`，在新的 `problemforge-p71-final-restore` / 5186 空实例恢复成功，逐项比较来源/恢复实例的十迁移校验和、业务计数、81 文件字节及 inventoryHash 完全一致。两个实例的运行镜像 ID、提交号、构建号、迁移一致性和按需生产 JS 均通过，全部服务健康，无新 Judge/TeX 任务或清理操作。

备份/恢复/失败/保留预览结果在 `.local/maintenance-results`；密钥 `.local/keys/p71-backup.key` 不输出、不提交。当前 `.local/maintenance-temp` 和 `.local/ops-locks` 均为空，正常清理及释放锁已核对。保留预览仅输出 keep/review，不删除。证据 `.local/verify-p71-negative.json`、`verify-p7-encrypted-restore.json`、`verify-p7-maintenance-final.json`、`verify-p7-encrypted-final-restore.json`、`verify-p71-final.json`。

**浏览器补验：**浏览器恢复可用后，实际核对已选「35 分解法」和 Judge 功能区在刷新后恢复；多语言示例切到 en/文档题解再刷新，语言及类型仍保留；没有改动稿件/程序。实际以演练管理员进入 5183 生产运行页，显示最终 `p71-20261001-r2`、Git `0537583`、十迁移一致、全部依赖可用、81 文件、0 预留、24 个缓存文件及 UTC 新增登记量，任务数为 0/0。截图 `.local/p71-final-operations-browser.png`。这补齐 P6.2 记录中导航恢复的浏览器验收；草稿文件下载、原生离开弹窗/401 编辑保留和全部表单组合仍仅按原限制，不因本次走查记为全量已测。

**最终交接：**主目录 master，代码和每阶段交接均本地提交，不 push、不发布公网。开发服务仍为主目录 Vite 2156、API watch 48816、Judge watch 64348、TeX watch 12500，实际命令行存于 `.local/p71-dev-processes.json`；开发库 problemforge_f054 / Redis DB 1 / `.local/p3-storage`，Build/TestRun 活动数 0/0。5183 `.local/p7-upgrade.env` 和 5186 `.local/p71-final-restore.env` 保持最终镜像运行；5184 `.local/p7-old-restore.env`、5185 `.local/p71-encrypted-restore.env` 保留停止的恢复现场。原 5181/5182 P5 两实例未升级或删除。下次先核对进程与配置，不盲用 PID。

P6.0—P6.2、P7.0—P7.1 本轮范围完成。按用户明确要求，P7.2 独立 Linux/HTTPS、P8.0 真实 Polygon 样包、P8.1 代表规模验证继续暂缓；未创建定时任务或外部备份/通知连接。容量历史为新增登记量，盘点是停写全量只读检查，不是在线 GC 或压力测试；跨主机维护锁、断电后自动清理等未宣称已实现。操作和密钥保管见 MAINTENANCE，阶段证据与浏览器限制按本文保留。

## 手动测试准备：容器清理与详细使用说明（2026-10-01，入口选择已更正）

用户要求清理测试容器并准备自行测试。本节当时错误地将恢复演练实例推荐为用户测试入口，已由下一节撤销和更正；以下保留实际操作历史，当前入口以下一节为准。

**实际清理：**先按本项目精确 Compose project 标签盘点容器与卷，核对配置路径；4 个运行中的部署 API 均无 QUEUED/RUNNING Build 或 TestRun。依次对 `problemforge-p5`、`problemforge-p5-restore`、`problemforge-p7-old-restore`、`problemforge-p71-encrypted-restore`、`problemforge-p71-final-restore` 执行各自配置的 Compose down，移除 45 个重复演练容器及对应网络；再移除主测试实例已成功退出的 migrate/storage-init 两个一次性容器。共从 58 个容器减到 11 个，前后核对本项目 20 个命名卷完全一致。没有使用 down -v、prune 或镜像清理；数据库/私有文件/Redis 卷、配置、镜像、备份和加密密钥全部保留，未操作其他项目。

**保留入口：**`http://localhost:5183` 为推荐手动测试入口，project `problemforge-p7-upgrade`，配置 `.local/p7-upgrade.env`，继续使用最终镜像 `problemforge-app:p71-20261001-r2` / Git `0537583`。保留其 7 个常驻容器；已移除的 5181/5182/5184/5185/5186 不再提供网页。5180 开发服务仍从主目录运行，实际命令行重新核对 Vite 2156、API watch 48816、Judge watch 64348、TeX watch 12500，因此保留 `problemforge` project 的 4 个基础容器；开发库仍为 problemforge_f054，活动 Build/TestRun 为 0/0。下次仍先核对实际进程，不盲用 PID。

**手册与账号：**扩展 `docs/USER_GUIDE.md`，覆盖本机启动/停止/日志、账号和角色、已有 A/B/C 与冻结比赛、复制示例、从零 A+B 的三稿/源码/Validator/错误解/数据/自测、有效验收、审核冻结、比赛出版、题包往返、进阶 Judge、保存冲突、账号模板维护、备份及手动检查清单；README 链接同步。5183 恢复数据库的管理员凭据来自 `.local/p5-prod.env`，示例出题人来自 `.local/p5-deployment/author.json`，不是新恢复配置中的初始化密码。为方便用户登录，汇总到忽略文件 `.local/manual-test-access.txt`，不输出或提交密码。当前实例实际发布的是三类各一套部署演练模板；手册没有将开发库六套模板混写成当前实例状态。

**实际验证：**清理后以管理员及示例出题人分别登录成功，读取题目、比赛、模板、profile 与运行管理后退出新建核对会话。运行管理状态 ok、版本/十迁移一致；5183、5180 网页和 3100 健康接口 HTTP 200。主测试 API/两 Worker/DB/Redis 健康，沙箱可用；ops-state 核对十迁移校验和及 81 个私有文件（2,494,083 字节）全部通过，inventoryHash 为 `fc5c4a0d6dca5be3412c26b4a235bc22b364e5c37a26978fc879298cc2d18388`。保留 2 用户、8 题、1 比赛、6 Build、10 TestRun、6 Artifact，与清理前业务基线一致。详细证据 `.local/manual-test-cleanup.json`、`manual-test-entry.json`、`manual-test-storage-state.json`，均未包含密码。

**验证边界：**本轮为容器清理和文档交付，不修改业务代码或示例内容，不启动新 Judge/TeX，不重跑全量/E2E。手册 A+B 和末尾勾选项是交给用户实际操作的教程，不记作本轮已执行验收。既有浏览器验证限制及 P7.2/P8 暂缓项保持原记录。文档差异检查通过，凭据和清理证据仍被 Git 忽略；本阶段单独本地提交，不 push。

## 更正测试入口：恢复主目录开发版的使用指引（2026-10-01）

**用户明确要求：**在原正式开发版测试，保留之前的题面/题解模板，不得擅自新开端口。上一提交 `9d223f5` 将用户引向 5183 恢复演练数据库是代理判断错误，导致用户看不到原开发库内容。5180 原服务一直运行，原数据库、模板和私有文件未删除或替换；不是需要从演练备份恢复数据的故障。

**当前唯一日常入口：**`http://localhost:5180`，工作目录 `D:\project\ProblemForge`，API `127.0.0.1:3100`，配置 `.env`，数据库 `problemforge_f054`，Redis DB 1，私有文件 `.local/p3-storage`。原 Vite/API/Judge/TeX 主目录进程重新核对为 2156/48816/64348/12500，未重启或替换。运行管理版本为 `development`，不是演练镜像版本号。后续仍应核对进程实际命令，不盲用历史 PID。

**已移除最后一套演练：**精确核对 project 标签、配置路径以及无 QUEUED/RUNNING 任务后，对 `problemforge-p7-upgrade` 执行不带 -v 的 Compose down，移除剩余 7 个容器及两个网络。项目现在只保留原 `problemforge` 的 postgres、redis、tex-sandbox、judge-sandbox 4 个基础容器；5181—5186 均不再监听。前后核对原清单 20 个命名卷仍存在；镜像、备份、配置和主目录私有文件保留，没有新增端口/实例，没有操作其他项目。

**原模板实际核对：**通过 5180 的代理接口，以原管理员和原 P2 出题人登录成功；管理员模板目录与普通用户已发布模板列表均可读取，6 套模板共 7 个 PUBLISHED 版本的文件哈希全部一致：CWNU 比赛题面 v1/v2、简洁蓝色题面 v1、经典书面题解 v1、蓝色书面题解 v1、CWNU 讲解 · 4:3 v1、宽屏讲解 · 16:9 v1。未重新初始化模板或更改任何版本。原出题人可见 22 道题、2 场比赛，「ProblemForge 三题示例赛」当前冻结 #4 和原分组求和示例可读取。

**已纠正文档与账号：**USER_GUIDE 全部改为原 5180、原开发账号、原示例地址、原六套模板及开发进程启动方式；撤掉演练镜像启动/备份指令，避免再次连接另一套库。`.local/manual-test-access.txt` 改为汇总原 `.local/bootstrap-admin.txt`（admin-f054@problemforge.local）和 `.local/verify-p2-fixture.json` 的账号，未创建账号或重置密码。README、PLAN 和 AGENTS 明确固定主目录现有入口、原开发数据与模板，不擅自新增端口或拿演练实例替代用户开发环境。历史部署证据保留，前一条错误入口建议显式标注为已撤销。

**验证与边界：**5180 网页及经其代理的 /api/health 均 HTTP 200，运行管理 status ok，开发 Build/TestRun 活动数 0/0；5181—5186 逐项确认不可访问。凭据和证据文件保持 Git 忽略，文档链接、代码框、无密码泄漏及 git diff --check 通过。证据 `.local/main-development-check.json`、`main-development-cleanup.json`、`main-development-after-cleanup.json`。本轮没有运行新 Judge/TeX、修改题目/模板/配置、重跑全量或进行备份恢复；既有未测项和 P7.2/P8 暂缓保持原记录。更正单独本地提交，不 push。

## 模板中心分类（2026-10-01）

用户要求直接修改代码增加分类，由用户手动测试。主目录原 5180 Vite、3100 API 与两 Worker 的实际命令行已核对；没有新增端口、环境或数据库。

**实现：**模板中心增加「全部 / 题面 / 文档题解 / Beamer 题解」分类按钮，显示每类模板套数；全部目录按题面、文档题解、Beamer 顺序分组，版本仍列在各模板下。切换分类仅筛选目录，保留右侧编辑和未保存内容；当前模板不在所选分类时提供返回入口。新建模板默认使用当前分类，新建成功后选中版本保持在可见分类。补充选中状态、键盘焦点沿用全站样式及窄屏换行布局，不改变模板数据和发布权限。

**验证边界：**按用户明确要求，本轮不运行测试、类型检查、构建、浏览器走查、Judge 或 TeX；由用户在原 5180 模板中心手动确认交互与显示。仅修改前端代码和交接记录，阶段本地提交，不 push。没有将实现写成已通过功能验证。

## 清空题目与比赛，保留原模板和账号（2026-10-01）

**用户要求与范围：**用户明确要求清理所有题目、比赛，从头开始。本次直接操作主目录 `.env` 指向的 `problemforge_f054` / Redis DB 1 / `.local/p3-storage`，沿用 5180 网页、3100 API；没有新增实例、端口或替换数据库，没有重新初始化示例。此记录取代前文关于旧示例仍可访问的当前状态描述，历史实现与验证证据仍保留。

**清理前备份：**操作时原网页、API 和两 Worker 已停止，确认无 QUEUED/RUNNING Build/TestRun 后，保存数据库与配套私有文件到 `.local/backups/main-before-clear-20261001T130049583Z`。自定义格式数据库 dump 为 16,968,745 字节，私有文件为 601 个 / 3,822,647 字节；同时保存环境配置、队列快照、计数、模板指纹及哈希清单。核对 dump 格式/目录及全部备份文件哈希后才执行删除。备份含凭据及私有数据，全部位于 Git 忽略目录；本轮没有实际恢复演练。首轮 dump 目录检查因提前关闭 stdin 出现 EPIPE，发生在删除前；限定处理该流错误并确认 pg_restore 成功后重新完成上述备份。

**实际清理：**事务中删除全部 25 道题目、2 场比赛，级联清理其文稿、程序、测试数据、生成计划、自测、对拍/分组配置、成员权限、修订、审核、发布和导入/导出记录。同步删除 37 个题目/比赛构建、89 个 Judge 任务、13 条编译缓存、2 份 Release 和 23 份导入/导出产物记录；按任务 ID 移除 36 个 TeX 和 84 个 Judge 队列项。对完成备份、哈希一致且已无数据库引用的 592 个文件逐一核对实际路径后清理，共 1,784,785 字节；没有清空 Redis、删除数据卷或操作其他项目。审计历史保留，并新增本次清理记录。

**保留与校验：**12 个用户、原 58 个会话、用户组、6 套模板 / 7 个 PUBLISHED 版本、3 套编译配置的数据指纹均与清理前一致；账号密码、角色、模板源码和发布版本未改。保留模板验证历史的 10 个 Build 和 9 个 PDF 文件，共 2,037,862 字节，模板预览继续可用。清理后题目、比赛及各关联内容表均为 0；私有文件盘点无缺失、哈希异常、未完成预留或无引用候选。结果 `.local/clear-main-result.json`，完整清单也保存在上述备份目录。

**恢复原入口与实际读取：**原主目录 API、Judge、TeX 和 Vite 后台进程已恢复，启动记录 `.local/main-fresh-services.json`，对应 watch PID 为 34648 / 18868 / 52732、Vite PID 76512；日志 `.local/main-fresh-{api,judge,tex,web}.out.log` 及 `.err.log`。下次仍先核对实际命令行，不盲用这些 PID。5180 网页、其代理健康接口及 3100 健康接口均 HTTP 200。经 5180 以原管理员与原 P2 出题人登录，题目（含归档）、比赛与 Judge 历史列表均为空，7 个模板发布版本和 3 套 profile 可读取；管理员逐版本下载原 7 份模板样稿 PDF，均与登记哈希一致。运行管理 status ok、模式 development，活动任务 0/0；核对后仅退出本次新建会话，原保留数据指纹再次一致。证据 `.local/clear-main-api-verification.json`。

**收尾与边界：**USER_GUIDE、PLAN、README 同步改为从空列表创建，移除已删除示例的直达链接，补充当前日志和备份位置。仅执行清理结果与服务/原模板的读取核对，没有运行测试套件、构建、浏览器走查或新 Judge/TeX，没有创建新题或比赛；模板分类交互仍由用户手动测试。P7.2/P8 暂缓状态不变。文档差异检查后单独本地提交，不 push；后续不得自动补回旧测试数据。

## 用户新建题目的生成计划使用诊断（2026-10-01）

用户已在原 5180 从头建题，本轮要求查看「交互 Easy」`cmuplnkvz001kktd8oppq13ki` 的生成计划用法及问题。确认服务仍运行于主目录、原 5180/3100 和 `problemforge_f054`；只读取该题保存的配置、源码、任务及产物，不修改用户正在手动操作的内容。

**实际发现：**生成器 `gen` v1 接收 `<n> <seed>` 并输出二者。计划 `gen` v2 的 argv 为 `["1"]`、seed 为 `10001`、count 为 10、起始编号为 1；生成任务 `cmupm16ck004dktd8nx9xk100` 已成功，10 组输入已由用户收集到正式数据。经原 5180 API 下载首尾输入，分别为 `1 10001\n`、`1 10010\n`。计划仍启用，后续 VALIDATE 和 ANSWERS 各执行了 20 组（10 组正式数据 + 10 组再次生成），因此报告有重复输入/编号提示；正式 TestCase 仍只有 10 条。

**交互配置问题：**该题实际保存的执行方式为 BATCH。答案任务 `cmupm2jwr005nktd8sh5uiygj` 的快照未包含 Interactor，首组答案下载内容为 `? 0\n? 1\n! 10001 10001\n`，执行成功不能用作交互验收证据。当前 Interactor v3 两处向选手发送消息使用 `tout`；根据本仓库 testlib 的 `registerInteraction` 实现与 Worker 管道配置，`tout` 写入 interaction-output 文件，实际通信应使用 stdout（例如 `cout << ... << endl`）。此外 Validator 允许 n 到 30，而当前生成器只允许 1～9、Interactor/主标程用 long long 阶乘运算；若本题预期 n≤9，应同步 Validator 范围，若要支持更大范围则需另行修改数值实现，未替用户决定范围。

**交付与边界：**USER_GUIDE 补充参数逐项解释、生成与收集的区别、收集后停用计划、编号避让、NOT_RUN 含义及交互 stdout/tout 协议。证据 `.local/generator-plan-diagnosis.json`、`.local/generator-plan-api-diagnosis.json` 均在 Git 忽略目录，仅临时登录原管理员读取并退出本次会话。未修改题目源码/计划/判题配置/测试数据，没有执行新的编译、Judge、TeX、测试套件或浏览器验证；交互修正后的运行结果未验证。文档差异检查后本地提交，不 push，后续由用户继续手动操作。

## 生成计划支持直接粘贴逐行命令（2026-10-01）

**用户要求：**希望直接在一个文本框填写 `gen 1 10001`、`gen 2 10002` …… `gen 9 10009`，一行生成一组，无需逐条配置计划。用户进一步明确采用页面粘贴命令方式，本轮直接修改主目录代码，仍使用原 5180/3100 和原开发数据。

**实现：**添加计划默认打开「逐行命令」文本框，按行识别本题生成器名称、普通参数与末尾整数种子；允许不同生成器、空行、带引号参数，错误定位到原始行号。名称可留空自动生成，数量由有效行数确定；显示逐行参数/种子及编号预览，默认编号避开现有数据和启用计划，重叠时提示。旧固定参数/递增种子模式保留，切换为逐行时可展开原配置。保存一个版本化计划，API 逐项检查格式、数量和本题生成器归属；任务快照固定所有引用的生成器，Worker 按每行 argv/seed 执行并记录来源。没有数据库迁移，也没有改动用户现有计划、程序、数据或判题配置。

**兼容与边界：**逐行数组在题目修订和原生 FULL 导出/导入中保留，复制/恢复时映射每行的生成器 ID。新模式使用 `problemforge-judge-command-lines-v1` 任务策略，旧 Worker 明确拒绝而不静默重复首行；原模式继续使用原策略。命令只解析为结构化参数，由既有 Linux 沙箱执行生成器，不调用 Shell。最多 100 行，每行 32 个普通参数/每个 512 字符，整数种子最多 18 位数字；每个计划第一组仍重复生成一次检查确定性。收集后的停用操作保持显式。

**实际验证：**`node --import tsx --test scripts/generator-plans.test.ts` 五项纯数据检查通过：用户提供的 9 行在保存/还原后保持 n/seed 配对；混合生成器、空白、引号、字面参数往返；错误行及受限语法；旧递增模式与新模式数量/摘要/编号约束；原生包保留及所有程序 ID 重映射。`pnpm check contracts problem-format api web judge-worker` 通过，最终映射调整后重新检查 api 通过。仅检查受影响范围，未新增业务测试数据、运行真实 Judge/TeX 或重跑全量/E2E；浏览器显示与真实生成由用户在原页面手动验收。USER_GUIDE/JUDGE 同步补充文本框用法，文档差异检查后本地提交，不 push。

## 正式测试数据支持单条和批量删除（2026-10-01）

**用户要求与实现：**生成错的数据需要能够删除。主目录「测试数据 / 生成计划」增加单条「删除」、复选框/表头全选、「删除所选」、编号确认窗口和「刷新数据」。输入与答案一起从当前列表移除，编号可重新生成或导入。API 复用本题编辑权限与 Origin/CSRF 校验，在题目锁事务内逐项校验所属题目、当前状态和 expectedVersion；过期、跨题、重复或已删除的选择整批拒绝，成功与审计一起提交。确认窗口固定点击时的 ID/版本，避免删除其后被其他人更新的内容。

**数据与引用：**新增 `TestCase.deletedAt`，所有当前列表/重复提示/500 组数量限制、Judge 与题目工作快照排除已删除数据，旧编辑和答案收集不能复活它们。保留不可变数据版本、私有文件、既有任务和冻结修订。题面已绑定的样例继续使用原固定版本，选择框与提示明确显示数据已删除，作者显式取消或替换；评分组也保留原配置，显示缺失成员并提供从草稿移除入口，重新选择/保存前不接受失配的验收。生成计划保持原状态。恢复旧题目修订时创建新的工作记录并映射评分组，删除历史保留。USER_GUIDE/JUDGE 已补充操作与语义。

**迁移与服务：**第 11 个迁移 `20261001050000_test_deletion` 已应用到原 `problemforge_f054`（127.0.0.1:15432），新增列及仅约束未删除数据编号的部分唯一索引，不修改既有业务行。Windows Prisma 客户端生成首次因运行进程占用 DLL 失败；确认 Build/TestRun 活动数均为 0 后，短暂停止并重启原 API/两个 Worker，再生成客户端成功。Vite 未更换，仍为 5180、API 3100、原 Redis DB 1 和 `.local/p3-storage`。当前 watch PID 为 API 73872 / Judge 68372 / TeX 79592，Vite 76512；下次先核对实际命令行。服务登记仍为 `.local/main-fresh-services.json`，新的 API/Worker 日志为 `.local/data-delete-{api,judge,tex}.out.log` / `.err.log`，旧日志保留。没有新容器、端口、数据库或工作树。

**实际验证：**`pnpm check contracts database api web` 通过，列表并发读取过滤调整后再次检查 api 通过。显式 `node --import tsx scripts/verify-test-deletion.ts --rollback` 通过：原数据库随机 ID 夹具仅存在于必定回滚的事务内，覆盖单条/批量、混合版本或跨题整批拒绝、重复选择、编号复用与唯一性、删除后编辑拒绝、样例/冻结记录不变、当前快照/任务依赖变化、评分组失配拒绝、事务审计，以及恢复旧修订后的新数据和分组映射；事务后确认夹具题目和审计均不存在。写权限矩阵用进程内只读模拟检查 OWNER/EDITOR、只读/审题/翻译成员、非成员和归档状态，未冒充真实多账号浏览器验证。

原 5180 健康接口和新 Vue 组件 HTTP 200；删除 API 未登录 401、空选择 400、不存在 ID 409。仅临时登录原管理员检查这些拒绝路径并退出本次会话；该题仍有原 10 条正式数据、0 条删除标记，检查前后列表完全一致，证据 `.local/test-delete-entry.json`。没有实际删除用户数据或持久保存测试夹具，也没有提交生成/答案/验收/TeX 任务。

**未验证与交接：**未做浏览器点击删除、成功删除的在线 HTTP/E2E、真实重新生成、压力或全量回归，页面交互继续由用户在原入口手动验收；没有环境阻塞。部分唯一索引由 SQL 迁移维护，不能以 db push 替代迁移。P7.2/P8 继续暂缓。更新交接并检查差异后，本功能单独本地提交，不 push。

## pnpm dev 终端入口导致 P2 账号登录失败（2026-10-02）

**诊断：**用户自行执行 `pnpm dev` 后无法登录。当前前端/API 仍来自主目录，监听 127.0.0.1:5180 / 3100，原 `problemforge_f054`、Redis DB 1 和四个基础容器正常。原 P2 出题人 `p2-author-41fa6a3604@problemforge.local` 存在、未禁用、不要求重置、版本仍为 1；私有凭据文件中的原密码与数据库哈希匹配。实际用相同凭据分别请求登录：Origin 为 `http://127.0.0.1:5180` 时返回 403 / ORIGIN_FAILED /「请求来源不被允许」，Origin 为配置的 `http://localhost:5180` 时登录及读取会话均为 200，随后退出本次诊断会话。Vite 的 dev 命令显示前一个地址，而 API 严格匹配后一个地址，足以复现报告的入口问题；未读取用户浏览器当前地址或其输入的密码。证据 `.local/p2-login-origin-diagnosis.json` 不含密码或会话凭据。

**修复：**Vite 开发中间件读取项目 APP_ORIGIN，将同端口本机别名上的 HTML GET/HEAD 导航临时重定向到规范地址，保留路径/查询并禁止缓存重定向。仅对本机 HTTP 开发页面生效，API、静态资源、生产构建及 Origin/CSRF 校验沿用原逻辑。当前 Vite 已自动加载配置；仍使用原 5180/3100，没有新进程实例、数据库或端口，也未重置账号或改动用户题目。USER_GUIDE 增加故障原因及入口说明。

**实际验证与边界：**`pnpm check web`（含 vite.config.ts）通过。通过原 IPv4 监听和显式 HTTP Host 核对：别名登录页 307、Location 保留路径/查询，规范 Host 页面 200，API 健康检查/前端源文件 200，直接来自错误 Origin 的 API POST 仍为 403；证据 `.local/dev-entry-redirect-check.json`。本机 Node 直接解析 localhost 的探测选择 ::1，而 Vite 按既有配置仅监听 IPv4，因此该探测连接失败，HTTP 核对改为显式 IPv4 连接及 Host；未宣称完成浏览器 DNS/跳转/手动登录验证。用户可从 `http://localhost:5180` 继续手动登录。未运行 Judge/TeX、全量/E2E 或新增业务数据。当前服务由用户终端的 pnpm dev 管理，之前 `.local/main-fresh-services.json` 的后台 PID 记录已不代表当前进程；本次核对的 Vite PID 79692、API PID 28536，下次仍重新检查实际命令行。差异检查后本地提交，不 push。

## 题面编辑器增加交互题正文格式（2026-10-02）

**需求与实现：**用户提供「多项式机器（Easy Version）」完整交互题面，并明确选择在题面编辑器一键插入格式。新增「交互题格式」入口，提供通用结构与完整示例，均可预览 LaTeX 正文；已有内容时显式选择替换或追加，空正文直接插入。示例可选同时修改题面标题。应用只进入当前独立文稿的未保存草稿，复用已有保存、版本冲突和离开保护，保留模板绑定、样例引用与其他文稿；保存/构建期间禁用套用操作。按钮按文稿编辑权限显示，中文格式可由作者继续改写。USER_GUIDE 第 4.4 节说明用法。

两份内容位于 `templates/content/interactive-statement.tex` 和 `polynomial-machine-easy.tex`，由前端按原始文本加载。完整示例保留用户给定的多项式、正整数系数、n 范围、n+1 次询问、10^16 返回范围、询问/回答格式、两种 C++ flush 写法与 2/3/8 交互过程，并说明通信方向；未加入算法题解。仅使用现有受限正文语法及标准 verbatim，不需要变更已发布管理员模板或扩展 TeX 宏权限。交互轨迹直接写正文，已有普通样例引用和双向交互/Interactor 配置均有操作提示，不自动修改判题配置。

**实际验证：**`pnpm check web` 通过。对两份正文及原开发库三版已发布题面模板（CWNU v1/v2、简洁蓝色 v1）完成六组正文策略与单题渲染组装检查；CWNU v1 检查其旧题册入口，其余检查完整比赛题册渲染，正文与逐行代码内容保持一致，没有生成普通样例文件。新组件、格式模块及两份 raw 内容经原 5180 返回 HTTP 200。证据 `.local/interactive-statement-format-check.json`，全程只有数据库读取，无业务内容写入、模板发布或新题目。服务仍由用户的原 pnpm dev 管理，API/Worker 无需重启，没有新增端口、数据库或容器。

**未验证与收尾：**未执行浏览器点击/保存、真实 TeX 编译或 Judge，未将文本渲染组装检查记为 PDF 编译通过；用户继续在原页面手动验收。现有题目正文未被替换，没有环境阻塞。更新交接并完成差异检查后单独本地提交，不 push，P7.2/P8 继续暂缓。

## 验收重复输入提示的再次诊断（2026-10-02）

**实际诊断：**用户报告 `test:cmuqfvlny001jktx086usvi6f:cmuqfvlo1001lktx0voalt9np` 与另一个 #1 输入哈希相同。重新读取原开发库「交互 Easy」及验收任务 `cmuqh0hyf000gkt0ob0x0pugz`：当前有 9 条启用的正式数据，输入哈希彼此不同；原 10 条数据已删除，均未进入本次任务。旧 10 组计划 gen v3 已停用，新逐行命令计划 gen v1（`cmuqfupni000dktx0oz108216`）仍启用，因此本次验收包含 9 条正式数据和 9 条重新生成的数据，共 18 条，产生 9 条重复输入提醒。

**来源与结果：**正式 #1 在答案任务 `cmuqfv50v000nktx0k0m6c3x7` 后收集，来源为新计划的 `gen 1 10001`；验收中的另一个 #1 来自该计划再次执行同一条命令。读取两份保存输入均为 `1 10001\n`（8 字节），重新计算 SHA-256 均与登记值 `b143a338f0a329b50d35e9c93bd90a6158969846891fce8e5233ee8457856d69` 一致。当前收集接口只保存正式数据，不自动停用计划；验收快照同时包含正式数据和全部启用计划。该任务为 SUCCEEDED / accepted=true，主标程 18 条均 AC；「均保留」指两份来源均保留在任务中，未自动新增第二套正式数据。

**交付与边界：**告知用户在「测试数据 / 生成计划」编辑 9 组的 gen 计划，取消「启用」并保存，再点击「验收当前版本」生成新快照；已保存的 9 组无需删除。旧报告保持历史结果。证据 `.local/acceptance-duplicate-diagnosis.json` 被 Git 忽略。本轮只读取现有数据库、输入文件和代码，未更改题目、数据、计划或程序，未启动新验收、Judge、TeX、测试套件或浏览器操作；停用后的新验收尚未执行。重新核对服务来自主目录现有 5180 / 3100，没有新增实例、端口或重启服务。仅更新本交接并本地提交，不 push；没有环境阻塞。

## 交互验收的空答案诊断与报告说明（2026-10-02）

**实际诊断：**用户报告验收后答案均为 0 字节。原开发库最新验收 `cmuqhb2vy001ckt0op6j82vh6`（12:44:31，本地时间）已有 9 条正式数据、0 个启用计划，SUCCEEDED / accepted=true，9 条均 AC。固定快照使用 INTERACTIVE，未显式填写的交互判定方式按默认 DIRECT 执行；Interactor v4 通过 cout/ouf 通信并 quitf 判定，不写 tout，也不读取 ans。Worker 将 Interactor 的 interaction-output（tout）保存到任务答案字段，因此为空；选手 stdout 和双向通信记录另存，并未丢失。

逐组读取现有文件核对：9 份答案文件实际均为 0 字节，哈希一致；主标程 stdout 为 30～141 字节，均与登记哈希一致。第 1 组 stdout 为 `? 0\n? 1\n! 536006801 411312339\n`（30 字节），通信记录 909 字节，Interactor 接受并报告使用 2 次询问。用户已从前一任务显式收集空附加输出到正式答案版本，本轮不改其内容。证据 `.local/interactive-empty-answer-diagnosis.json`。

**修复：**JudgeReport 按任务自身的固定配置区分交互与批处理，交互标签改为「输入与交互记录」；DIRECT 将原「答案」明确为「Interactor 附加输出」，0 字节注明允许为空，CHECKER 标为「比较用输出（tout）」。增加直接判定/Checker 说明，每组提供本次主标程 stdout 及通信记录入口，日志也标明双方输出来源。沿用既有授权下载和收集接口，不将通信内容自动转换成静态答案，不修改 Judge 语义、源码、数据或快照。USER_GUIDE / JUDGE 补充文件语义和查看路径。

**实际验证与边界：**`pnpm check web` 通过；原 5180 的更新组件经 Vite 转换返回 HTTP 200。临时登录原管理员，通过原 5180 读取该任务及第 1 组的答案、主标程 stdout 和 transcript，下载均 HTTP 200，长度分别为 0 / 30 / 909 字节，stdout/transcript 哈希与登记值一致，随后退出本次会话；证据 `.local/interactive-empty-answer-api-check.json`。仅核对已有结果，没有提交新验收、Judge、TeX 或全量/E2E；浏览器标签切换与点击由用户手动验证。主目录现有服务未重启，无新端口、数据库、容器或工作树。交接及差异检查后单独本地提交，不 push，没有环境阻塞。

## 交互章节命令、标题对齐与连续 PDF 预览（2026-10-02）

**用户范围：**交互正文按原模板的章节命令编写，包含小写 `\interactor`；题面和文档题解标题左对齐，Beamer 版式不变；所有 PDF 预览上下连续滚动；单题题面只展示题名，比赛题册保留题号。直接修改主目录，继续使用原 5180 / 3100、`problemforge_f054` 和 `.local/p3-storage`，未新增端口、实例、容器或工作树。

**实现：**两份交互正文格式改用 `\Description`、`\interactor`、`\InteractionStart`、`\InteractionQuery`、`\InteractionAnswer`、`\InteractionNotes`、`\InteractionExample`。两套题面在 `headings.tex` 中通过原 olymp 章节机制定义主标题，子标题与普通 ctex 章节左对齐；仅 STATEMENT 批准这些固定命令，正文仍不能定义宏或读取文件，策略升为 `pf-content-4`。单题 main.tex 启用 `\ShortProblemTitle`，比赛 item.tex 保留 CODE。两套文档题解的题名及各级章节左对齐，保留字体、配色和页边距；原题册封面、两套 Beamer 未改。

共享 PdfRenderer 改为完整页列，保留总页数、适应宽度、缩放和下载，移除页码选择与上一页/下一页。PdfPage 保留所有页面在连续布局中，仅渲染视口附近的画布，远页释放位图；限制每页像素量，取消旧渲染，处理文档切换、缩放、容器宽度变化和重载。题目三类稿件、模板中心、比赛与任务详情均复用此组件。

**原库模板更新：**先读取并保存原 7 个版本指纹，将四套模板各复制为新版本，只改对应入口和 headings.tex，其余文件与当前原模板逐文件一致。经原 5180 管理员接口真实验证、下载并逐页查看样稿后发布：CWNU 比赛题面 v3 `cmuqiohuu002pkt0olhiux7w5`、简洁蓝色题面 v2 `cmuqiokj8002wkt0olwqiim3j`、经典书面题解 v2 `cmuqiom6k0033kt0ojjxgrk3t`、蓝色书面题解 v2 `cmuqionu4003akt0ot378jy7i`。原 7 个版本的状态、登记哈希与实际文件哈希均不变，现在共 6 套 / 11 个发布版本。没有原地修改历史模板或历史 PDF，也没有公开发布题目材料。

**当前题目：**为使用户在原页面直接看到排版，显式将「交互 Easy」`cmuplnkvz001kktd8oppq13ki` 的题面绑定 CWNU v3、文档题解绑定蓝色 v2，按保存时 expectedVersion 保护并发。题面内容版本由 3 到 4，文档题解由 1 到 2；正文、元信息、启用状态和样例具体版本逐项保留，Beamer 不变。题面构建 `cmuqiue7a003ykt0ojrvlx9p4` / 产物 `cmuqiufx6000bkt5gxle4dfgu`（3 页），文档题解构建 `cmuqiugsv0045kt0oecc0zxv6` / 产物 `cmuqiuhaq000dkt5gqp4lfph0`（1 页），均成功。其他题目/比赛没有批量换绑。

**实际验证：**`pnpm check template-engine web` 通过，`node --import tsx --test packages/template-engine/src/policy.test.ts packages/template-engine/src/contest.test.ts` 共 6 项通过，覆盖新命令类型限制、禁止作者宏定义、模板渲染及比赛题号保留。复用现有 Linux TeX 沙箱编译四份单题样稿（新交互命令正文与两种书面题解）、四份模板比赛样稿，以及上述两份当前稿件，共 10 份 PDF / 20 页均渲染并逐页查看；无缺字、裁切或溢出问题，比赛 A 题号保留。没有宿主机 TeX 回退。原 5180 浏览器以原 P2 账号实际查看 3 页题面，检查滚动到末页、返回首页重新渲染、150% 缩放、切换文档题解及加载新产物。证据、保存前稿件和原模板指纹位于 Git 忽略目录 `.local/presentation-update/`。

**运行加载与未验证：**用户当前 `pnpm dev` 的 API / Worker 使用非 watch 的 tsx，仍运行 `pf-content-3`；已请用户在原终端 Ctrl+C 后重新执行 `pnpm dev`，本轮没有擅自替换其终端进程。新的格式插入内容与命令已实现并在现有 Linux 沙箱编译通过，但原运行中 API 尚不能接受新命令。当前题目暂保留原 `\section*` 正文，使用新模板也已左对齐；用户重启后可用新版交互格式，若继续协助转换现有稿件，应先重读最新版本，只替换章节命令，保留用户正文和样例。现有成功构建仍固定 `pf-content-3`，不得写成新策略在线 API / Worker 已验证。未做全量/E2E、Judge、超长 PDF 压力或各浏览器兼容性测试，比赛/模板/Beamer 的所有页面入口没有逐个点击。USER_GUIDE / TEMPLATES 已更新，差异检查后本地提交，不 push；P7.2/P8 继续暂缓。

## 比赛题面保留完整 Problem 前缀（2026-10-02）

**用户纠正与实现：**比赛题目标题需显示 `Problem A. 题名`，单题仍仅题名。两套题面仅修改 item.tex 的题名和目录条目，显式拼接 `Problem {{CODE}}. {{TITLE}}`，继续禁用 olymp 自增前缀，保证选择子集或改变顺序时仍使用比赛配置的题号。单题入口、正文、文档题解和 Beamer 均未改。同步收紧原有检查对 `Problem A.` / 非首个题号 `Problem C.` 的断言，没有新增测试套件。

**原开发环境落地：**核对主目录原 5180 / 3100；用户已重启 pnpm dev，新模板验证和比赛构建的 API / Worker 固定策略均为 `pf-content-4`，上一条的旧进程加载限制已解除。本轮未重启进程或新增端口。通过原管理员接口复制并验证、逐页预览后发布 CWNU 比赛题面 v4 `cmuqk5qf5005gktv0dc766mco`、简洁蓝色题面 v3 `cmuqk5t46005nktv0vyrmu24y`。与各自上一版仅 item.tex 不同，原 11 个版本的状态及文件哈希逐一核对不变，当前共 6 套 / 13 个发布版本。

用户当前比赛 `test`（`cmuqjnu41000iktv0u3o1wfcv`）原选 CWNU v3。按最新 expectedVersion 将比赛数据 v3 → v4，仅换绑题面模板为 CWNU v4，原 A/B 题号、题目冻结修订、顺序、比赛元信息及两套题解绑定全部保留。正常冻结接口确认原题目验收与修订有效后创建比赛冻结 #2 `cmuqkb1sg0063ktv0d11r7idq`，只生成题面，构建 `cmuqkb1vy0067ktv0dwjstino` 成功，PDF 产物 `cmuqkb3n3000fkt3ksxuzpxmx`（6 页）。已确认当前冻结匹配新编排、旧冻结哈希不变，没有改源题、建立新题或新比赛，也没有公开发布材料。

**实际验证与边界：**原 policy / contest 两个测试文件共 6 项通过；两份新模板样稿共 5 页及当前比赛题册 6 页均由现有 Linux TeX 沙箱编译，并渲染逐页查看。实际标题为 `Problem A. A+B`、`Problem B. 多项式机器（Easy Version）`，简洁模板目录也包含 Problem 前缀；当前题册的交互命令正文在 `pf-content-4` 在线构建通过。单题相关文件逐字保持上一版，沿用其已通过的单题 PDF 检查。没有重新执行前端、浏览器、Judge 或全量/E2E 检查，也没有执行宿主机 TeX。保存前比赛配置、原模板指纹及 PDF 证据位于 Git 忽略目录 `.local/contest-title-update/`。USER_GUIDE / TEMPLATES 同步说明格式及最新版本，差异检查后本地提交，不 push。

## 移除审批与接入协会账号密码登录（2026-10-02）

**用户范围与实现：**用户认为功能臃肿，明确移除审批，并提供协会外部登录协议，只使用账号密码，APPKEY 稍后提供。本次覆盖原任务书/P4 审批和 P6 本地密码要求，已同步 AGENT_PROMPT、PLAN、README、使用指南和账号/架构/部署文档。提交、批准、要求修改、审批沿用和审批记录界面/API 均移除；独立 `POST /api/revisions/:id/freeze` 允许负责人在成功验收后直接冻结草稿。事务内核对权限、归档状态、完整修订哈希、有效验收及非空题面/正文策略。评论、差异、固定版本、比赛/出版来源约束保留；旧审批数据未删除，旧未冻结状态在 API 显示为草稿，可直接冻结。

登录前端改为「协会账号或邮箱 + 密码」，后端固定 HTTPS 请求用户给定的 `/api/user/external/login`，传入 `loginType=password`。`ASSOCIATION_APP_KEY` 只在服务端配置，已在原 `.env` 和 `.env.example` 留空预留；未填时 API 503 / ASSOCIATION_NOT_CONFIGURED，页面提示并停用登录按钮，不回退本地密码。超时 8 秒、不跟随重定向、有界读取响应；Java Long userId 按原 JSON 十进制精确解析并唯一绑定。首次仅建 USER，已有身份同步昵称/账号/邮箱，权限与启停留在本地；邮箱冲突要求显式绑定，不自动接管原账号。密码/APPKEY/原始远端响应不持久化或写审计。保留 Origin/CSRF、Redis 登录限流、HttpOnly 会话及撤销。

本地密码用户创建/修改/重置页面及 API 已移除；账号页引导官网，管理员仅改本系统角色/启停和撤销会话。新增 `pnpm user:link --email 原本地邮箱 --user-id 协会userId`，显式保留旧 ID/权限并撤销对应旧会话；冲突拒绝覆盖。`admin:init` 改为初始化已绑定的协会管理员，生产 Compose 仅给 API 传 APPKEY，ops 配置相应预留。**本次没有真实 APPKEY / 身份 ID，未绑定或改动任一原账号。** 官网未提供会话失效通知，官网改密/停用不会主动撤销已签发的本地会话，已在 ACCOUNTS/USER_GUIDE 说明；本地停用/撤销仍有效。

**迁移与服务：**第 12 个迁移 `20261002000000_association_login` 已应用原 `problemforge_f054`（127.0.0.1:15432），只增加 User.associationUserId / associationAccount 两个可空列及唯一索引，不改原业务行。确认 Build/TestRun 活动数为 0 后，停止经命令行和父子关系核实的主目录 `pnpm dev` 进程树、生成 Prisma Client，再用普通终端 `pnpm dev` 恢复原 5180/3100 和两个 Worker。当前 Vite PID 69788、API PID 56784，登记 `.local/association-services.json`；下次先核对实际进程，不盲用 PID。继续原 Redis DB 1、`.local/p3-storage`、模板和数据库；没有新端口、实例、数据库或工作树。收尾原 12 个用户、2 道题、13 个模板版本均保留，已绑定用户数 0，活动 Build/TestRun 均为 0。

**实际验证：**`pnpm check contracts database domain problem-format api web` 通过；`pnpm verify:access` 通过，测试只模拟远端响应并在原库必定回滚事务内执行实际 Fastify 路由。覆盖精确请求字段和密码不 trim、Java Long 无精度丢失、缺少/无效 APPKEY、错误凭据/学号提示、非法/超长响应和网络/超时异常；同 ID 的账号/邮箱登录、普通用户默认、会话签发/退出、Origin/CSRF/权限、旧密码/创建接口 404、邮箱碰撞拒绝、显式绑定身份保留、资料同步、停用与旧会话撤销、版本冲突、最后一个已绑定管理员保护。冻结覆盖直接草稿/旧待审状态成功、旧审批路由 404、权限/缺验收/归档/差异/重复冻结拒绝、评论及冻结哈希保留。成功验收仅为事务内的终态元数据夹具，未冒充真实 Judge；用户、题目、修订、任务及审计夹具均已回滚，证据 `.local/verify-access-simplification.json`。默认 test/test:quick 未扩大。

原 5180 实测健康 HTTP 200、auth/config 明确 configured=false、缺密钥登录 503、未登录 me 401，登录及修订组件 Vite 转换 HTTP 200；证据 `.local/association-entry-check.json`。真实浏览器查看原 `http://localhost:5180/login`，账号/邮箱、密码、官网入口、未配置提示和禁用登录按钮均正常，截图 `.local/association-login-page.png`。Compose 仅静态 `config --quiet` 通过，ops 脚本语法检查和差异检查通过。

**未验证 / 下一步：**真实协会成功登录待用户给 APPKEY 后联调；原管理员/出题人需明确协会 userId 后显式绑定，原本地密码不能再登录，已有有效会话不统一清除。未浏览器操作已登录用户管理或冻结、未新运行 Judge/TeX、未全量/E2E/生产构建或部署。P0—P7 历史集成脚本依赖旧本地密码夹具，README/ACCOUNTS 已标注须先适配授权的协会测试账号，不宣称其通过；当前相关检查用 verify:access。P7.2/P8 继续暂缓。更新本交接后单独本地提交，不 push。

## 清空用户与题目，仅保留系统管理员（2026-10-02）

**用户要求与范围：**用户明确要求清空所有用户和题目数据，只保留一个超级管理员。核对原开发库只有一个 ADMIN（本系统最高系统权限）：`admin-f054@problemforge.local` / 系统管理员，ID `cmuo19g110000kta4qk0sh12b`，保留该记录及其角色、状态；删除其他 11 个用户。仍操作主目录原 `problemforge_f054`、Redis DB 1 和 `.local/p3-storage`，保留模板与编译配置，没有新增环境、端口、数据库或工作树。

**备份与实际清理：**确认 Build/TestRun 活动数均为 0 后，停止经监听和父子关系核实的主目录 `pnpm dev` 进程树，基础容器继续运行。清理前完整备份位于 `.local/backups/main-before-users-clear-20261002T084743836Z`，包含原 PostgreSQL custom dump（12,602,670 字节）、364 个私有文件（6,673,199 字节）、原环境配置、队列快照、清理计划和哈希清单；逐个文件比对 SHA-256/大小，并用 pg_restore 列出目录、完整读取归档到 `/dev/null`，没有写入恢复库。第一次备份目录检查遇到 Windows 管道提前关闭的 EOF，在任何数据删除前终止；适配该信号后重新备份并通过完整读取校验。旧备份和证据保留，不提交 Git。

在锁表的 Serializable 事务中删除 11 个用户、1 个用户组、58 个会话、全部 2 道题和 1 场比赛及级联内容，包括文稿、源程序、正式数据/版本、生成计划、修订、评论/审批、成员关系、验收历史等；删除 10 个题目/比赛 Build、26 个 TestRun、8 条编译缓存及原 1,285 条审计，新增一条本次清理审计。重置凭据、发布、导入/导出等原本为空，清理后仍为空。删除旧 Worker 心跳，重启时由原两个 Worker 自动登记新的心跳。按任务 ID 清理 10 个 TeX / 26 个 Judge 队列项，不清空 Redis。对已备份、哈希一致且无剩余数据库引用的 349 个私有文件逐个核实实际路径后删除（3,267,521 字节），同步清理 StoredObject 登记。执行脚本 `.local/clear-main-users-content.ts`，结果 `.local/clear-main-users-result.json`，备份内另存完整清单。

**保留与实际验证：**只剩 1 个启用的 ADMIN；题目、比赛和各关联业务内容表均为 0，Session / PasswordReset / UserGroup 均为 0。该管理员、6 套模板 / 13 个已发布版本及 3 套编译配置的完整数据指纹与清理前一致。保留模板验证历史 16 个 Build、15 份 PDF / StoredObject（3,405,678 字节），全部模板源码哈希正确；离线存储盘点无缺失、哈希差异、未完成预留或无引用文件。`pnpm exec tsx scripts/ops-state.ts --quiescent` 校验 12 个迁移的原始字节、全部剩余私有文件及无运行中任务，通过。

**原服务恢复：**普通终端 `pnpm dev` 从主目录恢复原 5180 / 3100 及两个 Worker，终端会话 50253；本轮核对 Vite PID 7196、API PID 27984，登记 `.local/users-clear-services.json`，停止前须重新核对实际命令行。登录页面、5180 代理健康及 3100 健康接口均 HTTP 200 / status ok，auth/config 仍为 configured=false；旧浏览器事件请求已因会话被清理返回 401。启动后再次只读核对所有业务表数量与保留数据指纹一致，Judge 队列为空，TeX 仅剩保留的模板验证历史；证据 `.local/verify-main-users-clear.json`。运行后正常产生新的 Worker 心跳与请求审计，不代表旧数据恢复。

**未验证 / 交接：**APPKEY 仍预留为空，唯一管理员的 associationUserId 仍未绑定；没有猜测身份、设置新密码或启用本地登录回退。需取得其真实协会 userId 后显式 `pnpm user:link`，填写 APPKEY 并重启原 API 后再联调官网登录。所有旧会话已撤销，原本地密码不可登录，其他用户以后通过协会首次登录会新建普通用户记录。README、PLAN、ACCOUNTS、USER_GUIDE 和本地手动访问说明同步更新。没有执行恢复演练、真实协会登录、浏览器登录后操作、新 Judge/TeX、全量/E2E 或测试夹具初始化；不自动补回已删用户、题目或比赛。完成数据/文件/服务定向核对及文档差异检查后单独本地提交，不 push，P7.2/P8 继续暂缓。

## 超级管理员独立本地登录（2026-10-02）

**用户纠正与实现：**用户明确超级管理员不用协会账号，不绑定 userId，要求独立登录。本轮覆盖上一条“保留管理员须绑定协会后登录”的交接结论：原 `admin-f054@problemforge.local` 继续保留 ID、最高系统角色 ADMIN 和原 scrypt 密码，associationUserId 保持 null，无需数据库迁移、创建第二个用户或配置 APPKEY。普通用户仍使用协会认证，没有恢复普通本地用户创建、密码重置或审批。

新增独立 `POST /api/auth/admin/login`，仅接受未绑定协会、具备有效本地密码且启用的 ADMIN，邮箱去首尾空白/转小写，密码原样校验；普通用户、协会管理员、停用/要求重置账号均拒绝。此路由不调用协会或读取 APPKEY，错误统一返回 LOGIN_FAILED，未知账号同样执行 scrypt 校验；保留 Origin、Redis 8 次/10 分钟限流、HttpOnly / SameSite=Strict、生产 Secure Cookie。密码校验后在账号事务锁内重查最新状态及密码哈希，再签发原 7 天会话。

登录页面提供「协会账号登录 / 超级管理员登录」切换，直达 `/login?mode=admin`；APPKEY 为空只停用协会入口。会话返回明确 authProvider，账户设置按身份显示本地改密或官网链接；用户列表、顶栏明确显示超级管理员及“无需绑定协会”，退出回到对应入口。本地改密须当前密码，新密码 12—256 字符，事务内保存哈希并撤销全部会话，带 CSRF、权限和限流；原管理员本次没有实际改密。最后一个可登录的独立管理员不可停用或降权，即使还存在协会管理员。`user:link` 拒绝转换独立管理员，同邮箱协会身份不能接管本地账号。

初始化 `admin:init` 改为使用 `PF_ADMIN_PASSWORD` 与管理员邮箱创建本地 ADMIN，不接受 userId，不覆盖已有记录；ops 只向一次性初始化命令传此密码，不传给常驻 API/Worker。`.env.example`、任务书、计划、README、账号/部署/架构/使用指引同步说明；当前开发库不重新初始化管理员，原 APPKEY 空值保留。

**实际验证：**`pnpm check contracts domain api web` 通过，最后补充顶栏/退出入口与网页使用指引后再定向 `pnpm check web` 通过。扩展原 `pnpm verify:access` 并通过：原库必定回滚事务内实际 Fastify 路由验证无 APPKEY / userId 的本地登录、邮箱规范化/密码空白保留、错误与普通/已绑定/停用/重置账号拒绝、Origin/CSRF、同邮箱隔离、密码检查/改密/旧会话撤销、Redis 登录限流、最后本地管理员保护，以及原协会登录与直接冻结路径；密码、哈希与 APPKEY 未进入 DTO/审计。夹具全部回滚，没有持久测试用户、题目、任务或产物，证据 `.local/verify-access-simplification.json`。ops 脚本语法与差异检查通过，默认快查未扩大。

**原环境与在线实测：**核对原 5180/3100 来自主目录，Build/TestRun 活动数均为 0 后短暂停止原 `pnpm dev` 进程树，再从主目录启动同一入口。收尾发现该终端会话已失效、应用进程已退出，原因未确认；原四个基础容器正常，确认无其他应用监听后再次恢复并重做在线登录/读取核对。最终终端会话 8865、Vite PID 71508、API PID 68824，服务记录 `.local/local-admin-services.json`，后续须核对实际命令行。继续原数据库、Redis DB 1、私有存储与四个基础容器，无新增环境。经 5180 使用 `.local/bootstrap-admin.txt` 的原凭据实际成功登录，返回 local-admin，读取唯一用户、空题目/比赛及原 6 套模板 / 13 个版本，健康正常，随后退出本次会话；管理员完整记录指纹与改造前一致。证据 `.local/local-admin-before.json`、`.local/local-admin-entry-check.json`，不含密码或会话令牌。

浏览器实际切换两个登录入口、使用原管理员密码登录、读取账户设置及用户管理，确认本地改密表单、已启用/无需绑定状态、顶栏“超级管理员”和空题目列表；退出后回到独立入口，本次验证会话已退出。截图 `.local/local-admin-login.png` / `.local/local-admin-account.png`。没有通过浏览器提交原账号改密；改密正确性由回滚事务验证，未改变用户原凭据。

**未验证 / 收尾：**真实协会登录仍待用户提供 APPKEY；新部署的管理员初始化/容器启动未执行，仅修改配置入口并静态检查。不执行真实 Judge/TeX、全量/E2E、生产构建/部署或恢复演练。原开发数据仍仅一个管理员、0 题目/比赛，6 套模板 / 13 个版本保留；原管理员可立即从独立入口登录，不再等待协会绑定。更新本交接及本地手动访问说明后本地提交，不 push，P7.2/P8 继续暂缓。

## 模板重命名与复制为独立模板（2026-10-02）

**用户要求与实现：**用户反馈模板名称无法修改，并要求基于其他模板复制后再改。原实现仅有创建模板与「复制为新版本」，没有修改名称接口。本轮新增目录名称旁「重命名」，调用管理员专用 `PATCH /api/admin/templates/:id`，名称去首尾空白、限 1—120 字符，使用 expectedName 比较避免覆盖已被他人修改的名称，事务内写入改名前后审计。包括没有版本的模板和已有发布版本的模板均可改名；只更新 Template.name，保留版本文件、哈希、状态、验证记录、已有绑定、历史 PDF 和冻结快照。

选中具体版本后新增「复制为新模板」及名称弹窗，默认“原名（副本）”；调用 `POST /api/admin/template-versions/:id/copy`，事务内锁定并检查来源 editVersion，复制所选版本的完整文件（含图片）与原 styleConfig，原子创建同类型、独立 ID 的模板及 v1 DRAFT，并记录来源审计。副本不沿用验证/发布状态、撤回原因、构建或题目绑定，须重新验证、预览并发布；支持各来源状态及空样式配置。前端有未保存源码时提示先保存再复制，提交期间锁定表单，失败保留输入。成功后自动进入新草稿；原「复制为新版本」保留。重命名不丢失当前未保存源码，异步预览返回时检查当前版本，避免复制后显示来源旧预览。无需数据库迁移，未实际给原模板改名或创建持久副本。

**实际验证：**`pnpm check contracts api web` 通过，补充预览切换保护与弹窗关闭细节后最终 `pnpm check web` 通过。新增显式 `pnpm verify:templates` 并通过：在原开发库必定回滚事务内执行真实 Fastify 路由，覆盖三类模板的管理员/普通/未登录权限、Origin/CSRF、空白/超长/多余字段、去空白、名称和编辑版本冲突、缺失记录、没有版本的模板改名、精确复制所选而非最新版本、所有来源状态、完整文件/配置及空配置、副本独立编辑、不可沿用发布、来源所有版本逐字段不变和审计。所有夹具用户、模板、会话、审计均回滚，无新增任务或产物；证据 `.local/verify-template-management.json`。默认 test/test:quick 不扩大。

**原环境与浏览器：**确认 5180/3100 的实际进程来自主目录且无活动 Build/TestRun 后，停止已核实的原 `pnpm dev` 树并用同一入口恢复，保持原库、Redis DB 1、存储、四个基础容器和端口。当前终端会话 12531、Vite PID 59804、API PID 70220，记录 `.local/template-management-services.json`，下次操作须重新核对实际进程。在线检查经原 5180 使用原管理员登录，确认两个新路由已加载并正确拒绝空白名称/过期来源，不写原模板；登录验证后退出。首次 Node fetch 将 localhost 解析为未监听的 IPv6 ::1，改用同一 5180 的 127.0.0.1 并保留 localhost Host / Origin 后通过。原管理员及 6 套模板 / 13 个版本完整数据指纹与检查前一致，用户仍仅 1 个、题目/比赛为 0、无活动任务；证据 `.local/template-management-before.json` 和 `.local/template-management-entry-check.json`。

浏览器在原 localhost:5180 实际登录，确认 6 套目录均有重命名入口、名称编辑后保存按钮可用、取消保留原名、选中版本的独立复制弹窗正确显示来源与默认副本名；修正重命名弹窗关闭时短暂切换为复制文案的动画问题并重新查看。截图 `.local/template-rename-dialog.png` / `.local/template-copy-dialog.png`，验证会话退出、临时标签关闭。浏览器未提交实际重命名或副本创建；成功写入和副本隔离由回滚路由检查验证。未运行真实 TeX/Judge、全量/E2E、生产构建/部署或跨浏览器检查；既有 PDF 预览可正常读取。README、PLAN、TEMPLATES 和 USER_GUIDE 已更新，差异检查后本地提交，不 push；P7.2/P8 继续暂缓。

## 精简模板编辑页的常驻提示（2026-10-02）

**实现：**按用户截图要求，删除模板编辑区关于原 main.tex 版式的蓝色说明、相邻的发布版本说明，以及配置旁“重新生成 style.tex”的常驻提示；移除专用 archivePreset 判断及无用样式。保留模板名称、版本状态、重命名/复制/保存/验证等操作及错误、未保存反馈，功能约束不变。

**实际验证与范围：**确认原 5180（Vite PID 70312）/3100（API PID 76712）进程来自主目录；无需重启服务。`pnpm check web` 和差异检查通过，原 5180 的 Templates.vue 模块转换 HTTP 200，核对三处文案及 archivePreset 已移除，重命名/复制入口和加载失败反馈仍在。没有写数据库、模板内容或运行配置；未重新进行浏览器、集成、TeX/Judge、全量/E2E 检查。完成交接后本地提交，不 push。

## 增加 C17、C++23 和 Java 17 编译与执行（2026-10-02）

**用户要求与实现：**编译配置增加 C、Java 和 C++23，Java 固定 JDK 17。C 采用 C17；共享语言枚举、数据库枚举、管理员 API、内置 profile、程序选择与源码编辑器同步支持六种语言。新建未修改源码的语言样板可自动切换，已编写或保存的源码保留。C / C++ 仍支持 O0 / O2，Java / Python 页面不显示不适用的优化选项；原三套 profile 的 ID、配置、版本和哈希保持不变。

**编译与运行：**C 使用 GCC 12 的 `-std=c17` 并链接 libm，C++23 使用现有 G++ 12 的 `-std=c++23`，不声称支持所有 C++23 新特性。Judge 镜像新增固定 `openjdk-17-jdk-headless` / `openjdk-17-jre-headless` 包 `17.0.20.1+1-1~deb12u1`，Java 入口为默认包中的 `public class Main`。可信助手仅在独立 go-judge 内以 `--release 17` 编译 UTF-8 源码，关闭注解处理，打包全部生成类；执行器支持 JAR 缓存、JVM 资源限制、生成器 argv/种子、文件 I/O 和交互选手。更新工具链/缓存标识，旧快照与缓存不被静默当作新工具链复用。没有宿主机执行作者源码或降级路径。

testlib 工具只允许 C++（含 C++23），API、任务快照、题包导入及执行器同步检查，C / Java / Python 用于解法与生成器。增加源码/JAR 文件 I/O 保留名。原生 FULL 题包支持新增三种语言往返；Polygon 尚未建立它们的语言映射，明确报告 BLOCKED 并以正确扩展名保留源码，不伪装成 C++17 或完整外部兼容。

**迁移与原环境：**确认原 `pnpm dev` 运行树来自主目录且无活动 Build / TestRun 后，停止该树以释放 Prisma DLL。第 13 个迁移 `20261002010000_more_program_languages` 已应用到原 `problemforge_f054`，只添加三个枚举值；Prisma 客户端生成成功。使用原 Compose 构建并替换原 `judge-sandbox`，实测 `java -version` 为 OpenJDK 17.0.20.1；PostgreSQL、Redis 和 TeX 容器未重建。恢复原目录 `pnpm dev`，仍为 5180/3100、Redis DB 1、`.local/p3-storage` 和原四个基础服务。当前终端会话 64561，API PID 58468、Vite PID 71064；服务记录 `.local/language-services.json`，下次先重新核对命令行，不盲用历史 PID。没有新端口、数据库或工作树。

**实际验证：**`pnpm check contracts database judge-core problem-format api web judge-worker` 全部通过。新增显式 `pnpm verify:languages` 并通过：真实 Fastify 路由、验收 pipeline 与执行器使用原库必定回滚事务，六种语言经现有 Linux go-judge 实际编译和判题全部 AC，包含 C17 标准/libm、C++23 `if consteval` / `std::expected` 和 Java 17 record / 多类打包。覆盖六语言缓存复用、新三语言 CE 诊断、Java 生成器带空格参数与 PF_SEED、文件 I/O、Java 选手与 C++23 testlib Interactor 双向执行、TLE、MLE、管理员 profile 新建/修改与普通用户拒绝、C / Java testlib 角色拒绝、保留文件名、原生包往返及 Polygon 阻塞说明。首次脚本因夹具漏传 provenance 在执行前失败，补齐后完整通过；不是产品编译故障。证据 `.local/verify-program-languages.json`。测试产物仅保存在内存，沙箱临时文件已清理，夹具账号、题目、程序、任务、profile 和审计全部回滚；默认快查范围不变。

浏览器经原 `localhost:5180` 使用原超级管理员登录，编译配置显示六套启用项，语言下拉含 C17 / C++23 / Java 17；Java 无原生优化项，切换 C17 出现 O2。关闭表单未保存临时选择，退出本次会话并关闭临时标签，无浏览器控制台错误。证据 `.local/program-languages-browser.json` / `.local/program-languages-profiles.png`。运行前后数据指纹核对：原一个管理员、6 套模板 / 13 个发布版本及原三套 profile 完全一致，题目/程序/比赛/TestRun 均为 0，保留 16 个模板构建、活动任务 0；仅持久增加三套预期内置 profile，证据 `.local/language-runtime-before.json` / `.local/language-runtime-after.json`。

**未验证与收尾：**此次真实验收直接调用 pipeline，没有持久提交队列任务；浏览器验证配置显示与表单切换，未创建真实题目走完整出题页面。没有运行 TeX、全量/E2E、对拍专项、生产部署、恢复演练或外部 Polygon/OJ 兼容验证；C++23 全标准覆盖及 Java 第三方依赖/自定义入口不在此次支持范围。没有环境阻塞，协会 APPKEY 仍待用户提供。JUDGE、PACKAGES、USER_GUIDE、PLAN、README 和任务书已同步，差异检查后本地提交，不 push；P7.2/P8 继续暂缓。

## 管理员模板文件工作区与图片替换（2026-10-02）

**用户要求与实现：**用户希望以类似 VS Code 的工作区维护模板，方便上传和替换图片。原模板文件已支持图片 Base64，但界面只有文件下拉与整包 JSON 导入。本轮沿用 Vue / Naive UI / Monaco 及原保存接口，增加独立 `TemplateFileWorkspace`：文件树、目录展开、源码/图片标签、图片尺寸/大小和透明背景预览、A / M 及未保存标记、可折叠 PDF / 日志与样式设置。模板目录可收起以扩大工作区；窄区域改为上下布局。发布版本只读，明显提供「创建草稿并编辑」入口。

草稿支持多文件上传、拖放、指定目标目录、新建文本文件、重命名、删除、单文件下载和还原。图片替换保留原路径及原始字节，PNG / JPEG 按原扩展名检查格式；同名批量上传在确认窗口逐项标出替换，整个批次验证成功才写入本地文件表。新增图片单张限 1.5MB，文本限 UTF-8 / 2MB，整个模板仍限 40 文件 / 10MB；前端拒绝危险路径、目录/文件冲突、非法图片、重复选择及超限。四个必需入口文件不能通过重命名/删除移除，其他文件改名/删除提示同步更新源码引用。不改动 TeX 执行策略或沙箱边界。

所有文件修改进入同一份未保存草稿，关闭标签保留内容，保存按钮或工作区内 Ctrl / ⌘ + S 复用原 expectedVersion / 权限 / CSRF / 后端校验；保存失败保留本地文件，成功清除旧验证。上传读取期间阻止编辑、保存及切换版本，避免晚到的读取覆盖另一版本。保留整包 JSON 导入，并支持读取下载的本地草稿 files。页面未新增大段常驻说明，文件删除/替换与失效状态在对应操作中提示。

**实际验证：**最终 `pnpm check web` 通过。`node --import tsx --test scripts/template-files.test.ts` 七项通过，覆盖 PNG / JPEG 原字节与中文/嵌套路径、UTF-8 / CRLF、不同上传名称的原路径替换、改名/删除及入口保护、原始文件表不变、非法批次拒绝、数量/字节限制和同 basename 文件树。扩展 `pnpm verify:templates` 并通过：原库必定回滚事务中，三类模板均实际经 API 保存上传、替换、改名、删除后的文件，检查权限/CSRF、过期编辑版本、非法图片/路径拒绝、字节/哈希、原 styleConfig 保留、清除已有验证和已发布来源完整不变。沿用原重命名/独立复制覆盖，夹具用户、模板、版本、会话和审计全部回滚，没有队列或私有文件写入，证据 `.local/verify-template-management.json`。

浏览器在原 `localhost:5180` 以原超级管理员进入模板中心，实际检查模板/版本目录、文件夹单击展开、图片预览、发布版本只读、创建草稿入口及原 CWNU v4 已保存的 3 页 PDF。相同端口临时内存验证页加载生产工作区组件，实际选择 PNG 与 TeX 多文件上传到 images、Ctrl+S、按原路径替换不同名称图片并逐字节对照 DOM 图片、新建/编辑/重命名、切换标签保留源码、删除、还原原图片及只读控制。520px 容器检查文件树在编辑器上方，scrollWidth 未超出实际宽度。修正文件夹点击展开、长名称省略和图片切换时尺寸显示；最终页面无控制台错误。临时 HTML 已移除、验证标签关闭、管理员会话退出。证据 `.local/template-workspace-browser.json`、`.local/template-workspace-page.png`、`.local/template-workspace-narrow.png`。浏览器保存事件在内存中验证，真实数据库保存成功由上述回滚 API 检查覆盖，未冒充完整在线发布流程。

**原环境与边界：**本轮无数据库迁移、依赖安装、服务重启、容器/端口变更，前端由原 Vite 热更新；实际服务仍为主目录原 5180 / 3100（Vite PID 71064、API PID 58468，后续先重新核对）。唯一管理员和 6 套模板 / 13 个发布版本的完整数据指纹一致，题目/程序/比赛/TestRun 仍为 0、16 个模板 Build 和 6 套编译配置保留、活动任务 0，证据 `.local/template-workspace-preserved-data.json`。没有持久创建测试模板或替换用户原图片。未新执行 TeX / Judge、全量/E2E、生产构建或发布；拖放和文件下载未单独做浏览器操作，文件解析路径由定向检查覆盖。无环境阻塞。TEMPLATES、USER_GUIDE、PLAN、README 已同步，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。

## 清爽简洁的工作台视觉更新（2026-10-02）

**用户要求与实现：**用户要求改善全系统样式，采用清爽简洁风格，摆脱常见的蓝色管理后台外观。本轮保留 Vue / Naive UI 和全部业务入口，新增统一组件主题与语义 CSS 配色：暖白画布、墨色文字、低饱和鼠尾草绿强调；统一圆角、细边框、留白、表格层级、表单焦点和状态颜色。侧栏使用自有 SVG 线性图标与轻量选中态，顶栏显示所在页面、账户与身份；窄屏侧栏自动收为图标导航并保留可访问名称。没有新增依赖、远端字体或图片请求。

登录页调整品牌标记、卡片、分段登录方式和表单间距，保留协会/独立管理员两个入口及原验证规则。题目/比赛页整理标题与操作区、搜索工具栏、分页和空状态；题目搜索无匹配与空题库分开呈现，创建入口复用原接口。模板目录、文件树、文件标签、图片/日志/PDF 容器、稿件/程序/验收/协作区域统一使用配色变量；Monaco 增加浅色绿系语法主题和更舒适的行距。管理表格、任务日期筛选、导入与运行审计面板同步调整。补齐键盘焦点、降低动态效果偏好、窄屏弹窗宽度；未修改模板内容或出版产物外观。

**实际验证：**最终 `pnpm check web` 通过；检查自有样式引用的 CSS 变量全部有定义，`git diff --check` 通过。原 `http://localhost:5180` 浏览器使用原超级管理员实际登录，检查新侧栏/顶栏、题目列表、搜索无匹配及清空恢复、创建弹窗的空名称禁用/输入启用/关闭（未提交）、比赛空列表、六套编译配置表格、任务筛选和实时连接。模板中心读取原六套模板/十三个发布版本，选择 CWNU v4，检查只读控件、文件树、Monaco 主题和已有三页 PDF 加载；未创建草稿、保存模板或提交构建。390px 视口检查题目及模板布局，页面内容未横向溢出；发现并修正窄屏侧栏额外滚动条和次要文字对比度。最终浏览器日志无 error/warn。截图与检查记录位于 Git 忽略目录 `.local/ui-refresh/`，包含桌面题目/比赛/编译配置/编辑器及窄屏截图。

**运行环境：**开始时 5180/3100 均未监听，未发现主目录开发 Node 进程。本轮仅在主目录用 `pnpm dev:web` / `pnpm dev:api` 恢复原前端/API（终端会话 96291 / 8567），最后核对 Vite PID 49008、API PID 63732 的命令行来自主目录；后续操作须重新核对实际进程，不能盲用 PID。沿用原数据库、Redis 和私有存储配置，没有改 .env、端口、容器或实例。按照页面变更的轻量验证规则没有启动 Judge/TeX Worker；如需执行新构建/判题，须恢复原开发 Worker，不能将本轮的前端/API进程误认为完整 pnpm dev。没有新建题目、比赛、模板或测试用户；仅正常登录/读取产生会话与审计，验证会话收尾退出。

**未验证 / 收尾：**当前库无题目/比赛，未为视觉检查重建业务数据，因此未浏览器操作真实题目/比赛编辑保存；共享编辑器通过现有模板只读页检查。未运行真实 Judge/TeX、全量/E2E、生产构建、部署或恢复演练，默认快查范围不变。协会真实登录仍待 APPKEY，与本轮样式无关。完成交接后本地 Git 提交，不 push；P7.2/P8 保持暂缓。

## 模板重复验证后 PDF 预览丢失修复（2026-10-03）

**原因与实现：**相同模板内容重复验证时，接口按 requestKey 复用已有成功 Build；原前端却将返回结果的 artifacts 强制清空，只依赖后续任务事件重新读取。已完成任务状态不再变化，因此 PDF 文件存在而页面一直没有预览。Templates 现在将验证响应视为任务回执，立即读取完整 Build，成功后自动展开 PDF，失败保留日志；单独追踪当前任务 ID 并加入事件订阅，使用请求序号、版本 ID 和任务 ID 防止晚到结果覆盖。详情读取失败提供明确错误和重试入口，发布按钮还需对应当前模板哈希、验证任务及已加载 PDF。

保存会清除模板的验证标记；恢复为曾成功编译的相同内容后，旧验证任务不会再次执行，原接口也未恢复标记。现在复用成功且有产物的任务时，以 editVersion / hash / 可编辑状态进行条件更新，恢复 VALIDATED 和匹配的 validationBuildId / hash；并发保存冲突返回 409。仅 QUEUED 任务提交队列，终态结果不重复入队。没有更改模板文件、发布不可变规则或 Linux 沙箱边界。

**实际验证：**`pnpm check api web` 与 `git diff --check` 通过。扩展并通过 `pnpm verify:templates`：原库必定回滚事务内验证重复请求返回同一 PDF 产物记录、保存相同内容后恢复验证、并发版本冲突、失败/缺产物不恢复验证、管理员/CSRF 权限；验证同一终态 Build 及产物记录不被改写，测试用户、模板、Build 和审计全部回滚。此部分产物仅为事务内元数据夹具，没有伪造实际 PDF 或提交 TeX/队列任务，证据 `.local/verify-template-management.json`。

在原 `http://localhost:5180` 使用原管理员会话，针对当前「CWNU 挑战赛比赛题面」v1 实际连续点击两次「验证样稿」，两次均自动显示已有两页 PDF，第一页画布可见且「确认预览并发布」可用；下载链接均为 `cmus01175000bktu0jt0c65qe`，构建 `cmus00zq1001dkt6w1w8lpx44` 和产物哈希/字节未变化，浏览器无 error/warn。未点击发布或保存源码，验证会话已退出、临时标签已关闭。证据 `.local/template-preview-fix/browser-repeat.json`、`repeated-compile-pdf.png` 及前后元数据快照。

**运行环境与数据边界：**本轮开始时主目录原 `pnpm dev` 的 API、前端、两个 Worker 均在运行。确认无活动 Build/TestRun 后，为加载后端修复短暂重启同一入口；收尾 Vite PID 79908 / API PID 67264，两个 Worker 亦正常启动，健康接口正常。隐藏启动进程及日志记录于 `.local/template-preview-fix/services.json` / `dev.out.log`；后续必须重新核对实际进程，不能沿用旧 PID。保持原 5180/3100、数据库、Redis、私有存储、容器和 .env，没有新增环境。

运行期间观察到用户开发数据继续更新：实测前后均为 7 套模板、22 个 Build、0 题目，现有源码哈希与 Build/产物一致；目标版本在本轮验证操作之外从 editVersion 8 / VALIDATED 变为 editVersion 9 / PUBLISHED，未回退这些变化，不能将快照记为全库指纹不变。本轮没有持久创建夹具、修改源码或提交新 TeX/Judge。新构建从队列到完成的自动切换、网络失败重试和快速切版本的浏览器故障注入未单独实测；已验证的是重复使用真实已有 PDF 与回滚接口边界。无阻塞，未跑全量/E2E、生产构建或部署，完成交接后本地提交，不 push；P7.2/P8 继续暂缓。

## 题面样例排在 Note 提示之前（2026-10-03）

**原因与实现：**用户反馈 Note 在样例之前，要求提示放在最后。读取当前「还差几个座位」题面发现作者已将 `\Note` 放在正文末尾，但平台将绑定的正式数据样例追加在整段正文后，产生“提示 → 样例”。模板引擎现通过已有 LaTeX AST 找到首个顶层 `\Note` / `\Notes`，将受控 samples.tex 插入其前面；没有提示时仍追加到正文末尾。单题、单题册及多题比赛共用此规则，生成顺序为描述 → 输入 → 输出 → 样例 → 提示。原正文切片保留，注释、verbatim / centerverbatim、宏参数和转义文本中的同名内容不会被当成章节。样例内容及文件权限规则不变。

样例渲染版本升级为 `pf-samples-3`，进入既有构建快照和缓存哈希，新构建不会复用旧顺序 PDF；原任务及发布模板版本仍不可变。TEMPLATES 和 USER_GUIDE 同步说明，无模板数据库迁移、源码改写或手动样例复制。

**实际验证：**指定 policy.test.ts / contest.test.ts 的 8 项检查通过，覆盖两套题面模板、Note / Notes、CRLF、单题/题册、多题命名空间、无提示/无绑定样例、注释/字面代码/嵌套参数及现有安全边界。`pnpm check template-engine api tex-worker` 与 `git diff --check` 通过。

经原 5180 代理与原管理员登录，为现有「还差几个座位」文稿 `cmus2d9770002kt5sxpnd8238` 新建一次真实题面构建：Build `cmus43rzb0004ktt830u3i1zi`、Artifact `cmus43tgk0001ktikmx7fpiqb`，使用原 CWNU 挑战赛比赛题面 v2、原稿件 revision `cmus3vfho0033kt5s9muntf8h` 及绑定样例。Linux go-judge 返回 Accepted，CPU 1568ms、222MiB，PDF 51898 字节，cacheSourceId 为 null。新旧 PDF 文本检查确认旧版“提示在样例前”，新版“样例在提示前”；Poppler 渲染完整单页并目视确认样例表格后为提示三段，内容、边框、页眉页脚完整。构建前后文稿、当前修订、模板记录深度比较一致，没有改动原正文、样例绑定或模板版本。验证会话已退出；证据位于 `.local/note-order/` 的 live-result.json、order-check.txt、statement-before/after.pdf、statement-after-1.png。

**环境与收尾：**原 5180 / 3100 及两个 Worker 确认来自主目录，活动 Build/TestRun 均为 0 后重启同一 `pnpm dev`，同步加载 API 与 Worker 的新渲染版本。收尾 Vite PID 40132、API PID 39932，两个 Worker 正常，健康接口正常；启动记录和日志在 `.local/note-order/services.json` / dev.out.log，后续重新核对 PID。沿用原数据库、存储、Redis、容器和端口，无新增实例。仅执行这一个真实 TeX 构建，未跑 Judge、全量/E2E、部署或发布；比赛题册顺序由定向渲染检查覆盖，未新增比赛实测。无阻塞，交接后本地提交，不 push，P7.2/P8 继续暂缓。

## 生成计划重复输入自动跳过（2026-10-03）

**原因与实现：**用户在「成对亮灯」先执行生成计划并收集输入，再点击生成答案；启用的计划重新生成 #2～#4，旧 pipeline 将正式输入和生成结果同时保留，出现三组重复输入及三组编号提醒。新 pipeline 按原始输入 SHA-256 跳过新生成的重复项，优先沿用已启用正式数据，再保留本任务首份生成结果。去重适用于 GENERATE / VALIDATE / ANSWERS / ACCEPTANCE，跳过项不创建 RunCase、不重复校验和计算答案，进度扣除相应后续步骤。报告保存跳过/保留来源，页面和日志只汇总一条数量提示。

单独 GENERATE 也固定已启用正式输入作为去重索引，但不将其再次列为可收集的生成结果，全部重复可以正常完成。已有正式数据逐条处理，保留其分组、样例、答案与 TEST 来源，答案仍可按对应记录显式收集；不会自动停用计划、删除数据或收集答案。同编号但不同字节仍保留并提示编号冲突；保留每个计划首组的确定性重复执行及已有答案冲突检查。含计划任务升级为 `problemforge-judge-generated-input-dedup-v1`，防止新旧 Worker 静默改变固定快照语义；历史报告保留，旧任务需按当前版本重新提交。JUDGE 与 USER_GUIDE 已同步。

**实际验证：**`pnpm check judge-core api judge-worker web` 通过。`node --import tsx --test scripts/generator-dedup.test.ts scripts/generator-plans.test.ts` 的 10 项定向检查通过；新增检查以内存替身运行生产 pipeline，覆盖正式输入/计划内/跨计划重复、全部重复、不同换行、编号冲突、已有答案不一致、确定性检查、进度和两种旧策略拒绝，不连接数据库或执行作者代码。`git diff --check` 通过，未扩大默认快查。

经原 5180 代理提交两个真实 Linux Judge 任务：GENERATE `cmus5i5qs0003kti0gkbfuukc` 成功，5/5 步、跳过 3 份、0 新输入；ANSWERS `cmus5i6o20007kti0nedl2pn8` 成功，24/24 步、跳过 3 份、仅 #1～#4 四条 TEST 来源，全部 ACCEPT 且生成答案（14 / 49 / 219 / 3 字节），两任务 warnings 均为空、依赖均有效。浏览器在原 localhost:5180 打开新答案任务，确认一条跳过提示、四条数据和答案下载链接，无 error/warn；验证会话退出、临时标签关闭。没有点击收集、验收或冻结。原题目、四条正式数据及其修订、程序、计划、文稿前后指纹一致。证据为 Git 忽略目录 `.local/generator-dedup/` 的 before/after.json、live-result.json、browser-result.json、report-after.png。

**运行环境 / 未验证：**确认原开发入口无活动任务后，在主目录重启同一 `pnpm dev` 加载 API 与 Worker；沿用原 5180/3100、数据库、Redis、存储、容器和 .env。收尾 Vite PID 72528、API PID 66744，两个 Worker 正常启动；根进程 33424 及日志记于 `.local/generator-dedup/services.json` / dev.out.log，后续重新核对实际进程。未新增端口、实例、测试用户、题目或模板。真实验证限于上述两个任务，完整验收去重由定向 pipeline 检查覆盖，未另跑完整验收/交互/评分/TeX、全量/E2E、部署或发布；固定评分组仍按原规则先收集并停用计划。无阻塞，完成交接后本地提交，不 push，P7.2/P8 继续暂缓。

## 极限输入误触发生成器 OLE 修复（2026-10-03）

**原因与实现：**「连号免单券」的校验任务 `cmus61f7q003ekti02k7e29wx` 在 `gen max 3003` 生成 #4 时失败，Invocation `cmus61fgy003xktfc3qx4qe8o` 的 stdout 被截为 1,048,577 字节。生成器需要输出 200,000 个整数，原执行器却沿用诊断命令的 1 MiB 默认输出上限。现在 contracts 提供统一 `MAX_TEST_BYTES = 8_000_000`，生成器 stdout / copyOutMax、正式输入/答案、前端文件上传、Base64 字段、ZIP 单成员和反例入库均采用 8 MB，与现有原生题包单文件容量一致。API 请求体按两份正式数据或三份自测文件的 Base64 大小计算，避免通过前端后再被旧请求体限制阻挡；appendTest 在新建/更新版本前校验输入和答案上限，包含任务显式收集路径。

主标程/其他解法继续使用题目 `outputLimitBytes`，Validator/Checker 的诊断及 stderr 上限不随数据容量放大；ZIP 总量、私有存储配额和独立 Linux 沙箱边界保留。生成计划及对拍/复现执行策略升级为 `problemforge-judge-generated-input-dedup-v2`，新旧 Worker 不静默改变固定任务的限额；旧任务仍保留，需要按当前版本创建新任务。JUDGE / USER_GUIDE 已同步容量与输出限制区别。

**定向验证：**`pnpm check contracts judge-core api judge-worker web` 通过；`node --import tsx --test scripts/generator-output.test.ts scripts/generator-dedup.test.ts` 的 7 项检查通过，覆盖生成器/确定性复跑的 8 MB 命令、解法限额独立、2.2 MB 极限输入 ZIP 字节保真、超限拒绝及此前去重行为。`pnpm exec tsx scripts/verify-large-test-data.ts --rollback` 通过：真实 API/原库事务内保存和更新两份各 8 MB 输入/答案、拒绝 8 MB + 1 字节、创建/更新三份各 8 MB 工具自测、导入 2.2 MB ZIP 以及收集 8 MB 生成数据。该检查的文件存储用内存替身，生成任务只为事务内元数据夹具，未执行作者程序；夹具用户/题目/任务/审计全部回滚，没有监听端口或提交队列。默认快查未扩展。

**真实 Linux 验证：**复用原题目、gen v2、计划 v1 与 seed=3003，经原 5180 API 提交 VALIDATE `cmus6gq5q0003kt2g4ihlxpdj`，11/11 步成功；ANSWERS `cmus6gr4i0007kt2g692j4wh9`，21/21 步成功。两次 #4 都生成 1,977,573 字节且 SHA-256 一致，下载核对完整 200,000 个合法整数及末尾换行，Validator ACCEPT；答案任务四组均有答案。生成器实际返回 Accepted / AC（约 10–12 ms、3.75 MiB），两任务没有警告。实测前后题目、原正式数据、程序、计划和文稿指纹一致；验证脚本没有收集或改写用户内容。

用户在验证之后自行收集本次答案并提交完整验收 `cmus6i3w8000vkt2gnnj41i5f`。浏览器只读确认新验收 SUCCEEDED / 符合预期、四组 AC、#4 正式输入 1,977,573 字节、跳过三份重复生成输入；原答案任务因已收集产生新数据版本而正确显示历史结果，未回退用户更新。浏览器无 error/warn，临时会话退出、标签关闭。证据 `.local/large-test-data/` 包含 api-result.json、live-result.json、before/after.json、max.in、report-after.png、acceptance-after.png 和 browser-result.json。

**环境 / 未验证 / 收尾：**确认活动任务为 0 后，仅重启主目录同一 `pnpm dev`；保持 5180/3100、原数据库/Redis/私有存储/容器/.env。收尾 Vite PID 68044、API PID 53224，两个 Worker 正常启动，根进程 68056 与日志见 `.local/large-test-data/services.json` / dev.out.log；后续重新核对 PID。本轮没有迁移、安装依赖、调整用户判题配置或缩小极限数据。8 MB 的精确文件边界通过 API 事务检查，真实沙箱实测到上述 1.98 MB；未另跑满 8 MB 沙箱、对拍/交互/TeX、全量/E2E、生产构建或部署。无阻塞，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。

## 过宽样例自动上下排列并居中（2026-10-03）

**原因与实现：**「连号免单券」样例一行五个 1000000000 超过左右表格输入列宽，原 verbatim 文本不折行而越过边框。模板引擎新增受控排版宏，在 Linux TeX 编译时按模板实际等宽字体逐行测量输入、输出，任一侧过宽则该组改为输入在上、输出在下；短样例仍左右排列，各组独立判断。按用户后续要求，两种布局的表格整体居中，数据内容仍左对齐。表格宽度受当前正文宽度约束，上下布局通过沙箱已有的 fvextra 折行，支持无空格长串，不缩小字号。测量和输出均按字面文件读取，特殊字符及 TeX 命令不执行。上下表格抑制结构空白，保留原文件名标题、字体和边框。

单题、单题册和多题比赛共用逻辑，样例仍排在 Note / Notes 前。宏随构建注入，不改已发布模板文件。渲染版本最终为 `pf-samples-5`：本轮先验证上下布局的 v4，用户补充居中后再升级，确保新构建不复用刚生成的左对齐 PDF。历史构建保留；TEMPLATES / USER_GUIDE 已同步。

**定向与 PDF 验证：**policy.test.ts / contest.test.ts 的 8 项定向检查及 `pnpm check template-engine api tex-worker` 通过。通过原独立 Linux TeX 沙箱编译默认题面单题和紧凑版比赛题册夹具，覆盖短样例左右、用户实际长输入、仅输出过宽、200 位无空格数字、空输出、字面 `\input{secret.tex}` 和特殊字符；最终均 Accepted、无 Overfull hbox。夹具只有沙箱临时文件，未写业务记录，临时缓存结束后清理。Poppler 渲染并目视检查 PDF 各页，确认居中、折行、边框、页眉页脚和末尾提示正常。PDF、日志及 PNG 留在 Git 忽略的 `.local/sample-layout/`。

经原 5180 API 为现有文稿 `cmus5sbt2001dkti0q5457yvp` 生成上下布局 Build `cmus75zn20003ktcsbbppi00w`，用户补充居中后生成最终 Build `cmus794m90003ktgonb236jqy` / Artifact `cmus7962l0001ktm0szt0h6te`。最终沿用修订 `cmus6j2wf0017kt2g13ltri6y`、CWNU 挑战赛比赛题面 v2 及原样例，Linux 返回 Accepted，CPU 1603 ms、226 MiB，PDF 57435 字节、cacheSourceId 为 null。完整两页检查确认样例上下居中、五个大整数未越界，全部四段提示自然位于第二页。两次构建前后文稿、修订、模板及目录记录深度比较一致，没有改动用户内容。验证登录均已退出，证据 live-result.json、build-after.json、before/after.pdf、after-1/2.png；中途左对齐产物另存 left-aligned.pdf。

**环境 / 未验证 / 收尾：**每次加载修复前核实原开发进程并确认活动 Build/TestRun 均为 0，仅重启主目录同一 `pnpm dev`。收尾 Vite PID 53552、API PID 71880，根进程 43160 与日志在 `.local/sample-layout/services.json` / dev-centered.out.log，后续重新核对 PID。沿用 5180/3100、原库、Redis、存储及容器，没有新增端口、实例、依赖或迁移。未另跑浏览器交互、真实多题比赛记录、Judge、全量/E2E、部署或发布；多题命名空间由定向检查覆盖，题册版式由沙箱夹具覆盖。无阻塞，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。
## Hydro / NovaJudge 独立测试数据 ZIP（2026-10-03）

**用户要求与实现：**在现有题目包之外增加可上传 OJ 的纯测试数据包，用户指定 Hydro 与 NovaJudge。题目「组织、修订与协作 → 题包与发布」顶部新增独立目标平台、数据来源和「导出测试数据 ZIP」按钮，默认当前已保存数据，也可选择固定修订；无需先冻结或成功验收，页面未保存编辑需先保存。新增严格参数接口 `/api/problems/:id/test-data-exports`，当前数据用 RepeatableRead 快照固定并记录哈希，已有匹配成功验收时补入其固定输入/答案。导出不执行生成器或作者工具、不改正式数据、不自动保存修订。产物进入既有私有导出历史，下载重新检查当前权限；不接入公开发布。

ZIP 根目录放原编号的 `*.in` / `*.ans`，包含启用正式数据及启用样例，不含停用数据、历史样例、题面、题解、标程、生成器或 Validator。导出核验原始字节、大小与 SHA-256，缺普通题答案、编号冲突、所需工具缺失/多选或源码损坏会明确拒绝。Hydro 写 `config.yaml`，NovaJudge 写 `problem.yml`，两者显式列 cases 和所需工具；自定义 Checker / Interactor 保留源码，附固定 testlib 和 MIT 许可证。内置 EXACT / TOKENS / FLOAT 自动生成独立 C++11 checker，维持字节、ASCII 空白、尾随 token、有限数值及误差语义；浮点词法用线性扫描，避免超长 token 的正则递归风险。

**兼容边界：**按两站公开官方源码核对格式，链接和固定提交记录于 PACKAGES。Hydro 自定义工具需核对目标 `cc` 配置支持原 C++ 标准；NovaJudge 上传数据不更新题目时空限制，报告明确显示需填写的 ms / MiB。分组权重/依赖评分、文件 I/O、交互结束后再 Checker 不自动转换，报告 BLOCKED，只可下载供人工调整。NovaJudge Interactor 不接收参考答案路径，报告提示使用 `ans` / `argv[3]` 的作者调整；独立交互/输出限制提示目标环境核对，非法 UTF-8 数据在 NovaJudge 标记阻塞，ZIP 原字节保留。两站可能使用自己的 testlib 版本。不声称所有设置均可无修改迁移。

**实际检查：**`pnpm check contracts problem-format api web` 全部通过；`node --import tsx --test scripts/test-data-export.test.ts` 五项通过，覆盖扁平文件白名单、2.1MB 与非法 UTF-8 / NUL / CRLF 原字节、配置、源码/头文件、交互及不支持项、空数据/缺答案/编号/哈希错误。`node --import tsx scripts/verify-test-data-export.ts --rollback --sandbox` 通过：真实 Fastify 路由在原库必定回滚事务内验证无修订/无验收导出、DRAFT 固定修订、原数据不变、后续修改不改变下载、CSRF / 参数 / 跨题 / 无权 / 撤销成员及禁止公开发布；存储替身仅内存，用户/题目/修订/导出/审计夹具全部回滚，零排队任务。三种自动 checker 在原 Linux go-judge 用 C++11 实际编译，每种 25 组、共 75 组与系统内比较器一致，含空白、尾随内容、二进制、NaN / Infinity、溢出/下溢、长 token；沙箱文件已清理。默认快查不变，没有宿主机执行作者代码。证据 `.local/data-export/verification.json`。

**浏览器与实际下载：**经原 `localhost:5180` 登录原管理员，对现有「连号免单券」实际分别点击生成并下载 Hydro `cmus8w86y0003ktdkbinb77n0`（998874 字节）、NovaJudge `cmus8xmp50006ktdkv9uzyhry`（998822 字节）。两包均为 4 组 `.in` / `.ans`、原自定义 `checker.cpp`、testlib/许可证和平台配置，没有 BLOCKED 项；逐文件哈希与原数据相同，NovaJudge 配置通过其公开官方归一化函数离线检查。原题目完整快照、模板版本指纹和用户 ID 集合前后相同；仅新增两个预期私有导出产物及正常登录/导出审计。原成功验收 `cmus7bt4n0008ktgopynvqsuh` 被读取但未重跑。浏览器无 warn/error；390px 检查修正报告长哈希换行，新增导出卡片和报告均不横向溢出，原工作区页面整体仍有 413px 宽度，不把本轮局部检查称为全站移动端通过。已恢复默认视口、退出验证会话并关闭临时标签。实际下载留在 Downloads，并在 `.local/data-export/hydro-testdata.zip` / `novajudge-testdata.zip` 留证；其余证据为 before/after.json、live-result.json、browser-result.json 和截图。

**运行环境与收尾：**沿用主目录、原 5180/3100、数据库、Redis、私有存储和沙箱，没有切换或新增端口。确认活动 Build/TestRun 为 0 后重启原 `pnpm dev` 以加载 API。第一次停止脚本的 PowerShell 参数错误导致旧服务未停、短暂重启尝试因原端口占用退出；已核实并清理该尝试留下的两个 Worker，重新启动并检查现只保留正常的一套服务。当前根进程 62168，Vite 61860、API 39368，Worker 36972 / 11196（后续须重新核对）；记录 `.local/data-export/services.json` 和 dev-running 日志。未创建持久测试用户或题目，未运行 TeX、全量/E2E、真实外部 OJ 上传/判题或部署。Hydro 全站配置解析和两站真实交互上传尚未验证；没有环境阻塞。PACKAGES、USER_GUIDE 已同步，检查差异后本地提交，不 push；P7.2/P8 继续暂缓。

## 交互样例仅展示，不进入判题流程（2026-10-03）

**原因与实现：**交互题的题面样例描述双方通信，不能当作 Interactor 的隐藏输入。此前快照把所有启用数据和生成计划一起加入校验、答案与验收，样例文本会触发 Validator 失败或交互双方等待。本轮统一参与判题规则：已保存配置为 INTERACTIVE 时，启用且非样例的数据才参与 Validator、答案生成、Interactor / 解法验收、评分与判题数据导出。样例计划不进入校验、答案和验收，显式 GENERATE 仍允许生成展示样例；已有交互样例也不作为隐藏输入的去重索引。普通批处理题样例行为不变，正式数据及历史样例、题面绑定不删除、不改写。

API 在固定快照时过滤，Worker 在统计步骤、去重、读取文件和执行前再次过滤；无非样例数据/计划时提交前返回清晰提示。交互数据任务携带 `problemforge-interactive-samples-display-only-v1` 策略，旧交互快照要求重新提交当前任务，不通过重试静默替换语义。展示样例内容和样例计划不进入校验/答案/验收依赖哈希，单独修改展示内容不使判题验收失效，出版修订仍完整记录。数据组成员只覆盖判题数据，前端排除交互样例候选，旧组可显式从草稿移除不参与判题成员后保存，不自动重算分数。

Hydro / NovaJudge 测试数据 ZIP、原生 DATA 与 Polygon FULL 判题测试集排除交互样例；从历史验收补入生成输入/答案时同样过滤，避免旧 RunCase 重新带回展示数据。原生 FULL 保留完整样例与历史，STATEMENT 保留绑定样例。前端根据已保存的双向交互配置显示「交互样例 · 仅展示，不参与判题」，样例答案改称示例输出，并在数据页说明隐藏测试不要勾选样例。仅新增 Interactor 程序或选择交互题面模板不会自动切换判题模式，仍需保存「双向交互」。

**实际定向检查：**`pnpm check contracts judge-core problem-format api judge-worker web` 全部通过；`node --import tsx --test scripts/interactive-samples.test.ts scripts/test-data-export.test.ts scripts/generator-dedup.test.ts` 共 14 项通过，覆盖样例/计划筛选、输入生成保留展示用途、普通题行为、依赖哈希、空数据拒绝、Worker 防御过滤、无样例文件读取/执行/计数/矩阵、历史策略拒绝、导出用途和原生成去重回归。默认轻量快查不扩展，`git diff --check` 通过。

`node --import tsx scripts/verify-interactive-samples.ts --rollback --sandbox` 通过：真实 API 路由在原数据库必定回滚事务内保存交互配置与样例，只有样例时校验/答案/验收及两类数据导出均返回 422、零入队；组成员拒绝样例并接受仅隐藏输入的 100 分组。原独立 Linux Judge 实际执行 Validator、双向交互答案和完整验收，三种任务只有非样例 #2，主标程 AC、错误解 WA，验收通过，样例无 Invocation。样例更新不改变验收依赖，旧样例文件仍可读取。固定修订的两种 ZIP 均只有 `2.in` / `2.ans`、Interactor、testlib/许可证和目标配置；专门插入的历史生成样例 RunCase 元数据夹具 #99 未被补入包（该 #99 仅验证历史补入分支，不声称执行过它）。原生 FULL 保留样例。用户/题目/任务/导出/审计夹具全部回滚，存储仅内存，沙箱临时文件清理；证据 `.local/interactive-samples/verification.json`。

**运行环境：**排查时原库没有已保存为 INTERACTIVE 的题目，活动 Build/TestRun 为 0；没有擅自更改用户题型、取消任务或重跑历史验收。为加载修复，在再次确认无活动任务并核对原进程树后重启主目录原 `pnpm dev`，仍用 5180/3100、原数据库/Redis/私有存储及 Linux 沙箱，无迁移、依赖、端口或实例变更。收尾根进程 68592，Vite 65112、API 81256、两个 Worker 59696 / 70152；监听及两个 Worker 均属于该进程树，没有额外 Worker。原 5180 首页返回 200，代理健康接口为 ok。记录 `.local/interactive-samples/services.json`、services-verified.json 及 dev.out/err.log；后续须重新核对 PID。

**未验证与收尾：**本轮未创建持久测试数据，未执行浏览器实际交互操作或现有题目的在线完整验收；UI 完成类型检查，交互流程使用上述真实 API / Linux 回滚夹具验证。未运行 TeX、全量/E2E、外部 OJ 上传或判题、部署或公网发布；现有 Polygon 交互兼容边界不变。无环境阻塞。JUDGE、PACKAGES、USER_GUIDE 和本交接已同步，差异检查后本地 Git 提交，不 push，P7.2/P8 继续暂缓。

## 交互数据 ZIP 仅输入与 Hydro 工具 .cc 文件名（2026-10-03）

**用户要求与实现：**用户要求交互题不再导出答案文件，Hydro 工具源码使用 `.cc`。独立 Hydro / NovaJudge 测试数据 ZIP 现仅打包交互题的非样例 `*.in`，即使保存过答案也不读取、不导出，不再补空 `.ans`；cases 仅列 input，去除不存在的答案文件引用与缺答案警告。普通题仍导出 `.in` / `.ans` 并要求答案完整。Hydro 内置比较器、自定义 Checker 和 Interactor 统一命名为 `checker.cc` / `interactor.cc`，配置引用复用同一文件名；NovaJudge 保留 `.cpp`。工具原始源码、testlib/许可证及原平台限制报告保留，原生完整备份与题面展示不变。页面导出说明和 PACKAGES / USER_GUIDE 已同步；历史 ZIP 不重写，用户需重新生成导出。

**实际检查：**`pnpm check problem-format api web` 通过。`node --import tsx --test scripts/test-data-export.test.ts` 六项通过，补充两站工具文件名与引用、交互题有/无答案都仅输入、已保存答案文件不可读也不会读取、原始清单不变，以及普通题答案、样例排除、工具源码/哈希和导出限制回归。`node --import tsx scripts/verify-test-data-export.ts --rollback` 通过真实 API / 原数据库必定回滚事务，分别检查两站当前数据与固定修订的四个交互 ZIP：仅 `8.in`、对应后缀 Interactor、testlib/许可证和配置，配置无答案引用；普通题仍保留答案且 Hydro Checker 改用 `.cc`。保留原权限/CSRF/跨题/撤权、历史下载不可变和零入队检查，用户/题目/修订/导出/审计夹具全部回滚，存储仅内存。证据复制至 `.local/interactive-export/verification.json`。原 `verify-interactive-samples.ts` 的导出断言也同步新格式，本轮未重跑其 Linux 判题部分，未将更新断言冒充新的沙箱实测。

**协议与验证边界：**按 PACKAGES 固定的 Hydro / NovaJudge 官方源码复核配置与工具引用；交互 cases 省略 output 可由两站归一化为空输出流，ZIP 无需提供答案占位文件。没有访问或修改用户现有 OJ，没有真实上传两站或运行其完整判题服务。本轮仅改打包与命名，未重新执行作者程序、Judge / TeX、全量/E2E、浏览器操作或部署；默认快查清单不变。源码检查与本地 API 导出不声称为外部 OJ 上线验收。

**运行环境与收尾：**检查主目录原服务进程树、确认活动 Build/TestRun 均为 0 后，仅重启原 `pnpm dev` 加载 API。沿用 5180/3100、原数据库/Redis/存储/沙箱，无迁移、依赖或新增实例。根进程 52372，Vite 81208、API 59080，两个 Worker 25276 / 59200，监听和 Worker 均属于此进程树、无额外 Worker；原 5180 首页 200、代理健康接口 ok，stderr 为空。记录 `.local/interactive-export/services.json`、services-verified.json、dev.out/err.log，后续重新核对 PID。无阻塞，差异检查后本地提交，不 push；P7.2/P8 继续暂缓。

## Hydro 交互配置按用户提供的 subtasks 格式导出（2026-10-03）

**用户纠正与实现：**用户给出完整 Hydro 交互题 config.yaml，要求 `interactor.file: interactor.cc`、`lang: auto`，用例放入 `subtasks` 下的 `score: 100`、`id: 1`、`type: sum` 组，每条用例显式 `output: /dev/null`。本轮按此格式修正，去除 Hydro 交互配置的顶层 cases。时间与内存来自实际导出版本的题目设置，用例仅取启用的非样例输入，按原编号升序排列；不硬编码用户示例的 2–54 或 1000ms/256m。ZIP 仍只有 `.in` 与交互器/依赖/配置，不导出 `.ans`，也不创建 `/dev/null` 文件。NovaJudge 配置及普通题判题内容不变，部分分组无法自动映射的报告继续保留。

Hydro config.yaml 改用常规缩进 YAML，工具编译说明同步 `lang: auto`。problem-format 显式依赖仓库已有且锁定的 yaml 2.8.1，用离线安装复用，不引入新版本；普通 Hydro 配置也使用此序列化，NovaJudge 保留原 JSON 兼容 YAML 写法。PACKAGES / USER_GUIDE 已同步，历史 ZIP 不改写，需重新点击导出。

**实际检查：**`pnpm check problem-format api` 通过。`node --import tsx --test scripts/test-data-export.test.ts` 七项通过；新增用户给定 2.in–54.in 完整 YAML 的逐字比对，并通过独立 YAML 解析检查工具、单组满分和 `/dev/null`。另检查改为不连续编号 3/10 及 2500ms/512m 时动态输出正确，包中引用的输入均存在、无答案与占位文件。原普通题、NovaJudge、样例排除、工具源码、字节/哈希和不可读交互答案回归保留。

`node --import tsx scripts/verify-test-data-export.ts --rollback` 通过真实 API / 原库回滚事务，两站当前数据与固定修订四个交互 ZIP 均下载并解析；Hydro 明确检查 auto、subtasks 单组和 output 空流，NovaJudge 保持原结构，夹具全部回滚、存储仅内存、零入队任务。证据复制至 `.local/hydro-interactive-config/verification.json`。`verify-interactive-samples.ts` 的解析和期望同步，本轮没有重新运行其沙箱判题部分。未执行浏览器、作者程序、Judge / TeX、全量/E2E 或外部 OJ 上传/判题，未部署或访问用户其他项目；没有将本地格式检查称为 Hydro 实站验收。

**运行环境与收尾：**再次核对原主目录进程树并确认无活动 Build/TestRun 后，重启原 `pnpm dev` 加载后端。原 5180/3100、数据库/Redis/存储/沙箱保持不变，无迁移或新增实例；新根进程 74336，Vite 62248、API 42944，两个 Worker 58496 / 81916，均属于同一进程树且无多余 Worker。首页 200、代理健康 ok、stderr 为空。证据 `.local/hydro-interactive-config/previous-processes.json`、services.json、services-verified.json、dev.out/err.log，后续重新核对 PID。差异检查通过后本地 Git 提交，不 push；无阻塞，P7.2/P8 继续暂缓。

## 比赛自动同步题目最新保存内容（2026-10-04）

**用户要求与原因：**用户反馈题目修改后，已加入比赛的内容仍停留在旧版本，要求比赛自动同步。原 ContestData 永久绑定加入时的 ProblemRevision，完整性、冻结和出版均读取旧清单。本轮将比赛工作编排改为关联源题 ID，读取最新已保存工作副本；兼容已有 JSON 中的 revisionId，在读取与后续保存时归一化，无需数据库迁移、移出重加或批量改写现有比赛。比赛自己的题号、顺序、语言与三类模板绑定仍由编排保存。

**实现：**新增共享 contest-snapshot 模块，使用一致事务读取完整源题清单；最新名称、文稿、样例绑定、设置、程序、数据与资源进入新快照。编排页面移除冻结修订选择，显示自动同步，打开时、前台约每 10 秒及窗口重新获得焦点时更新来源信息，刷新不覆盖本地未保存编排。资料和题包默认「最新题目内容（自动同步）」，API 在生成前校验 expectedVersion，在 Serializable 事务中检查当前成功验收、所选语言题面、正文策略与固定模板，再保存不可变 ContestRevision；相同快照复用。最新快照使用 WORKING:内容哈希标识来源，不自动创建或改动源题修订。题面、文档题解、Beamer 保持独立任务和显式子集；历史来源仍可明确选择。

比赛负责人或编辑可生成最新材料；手动冻结、公开发布继续限定负责人，加入新源题仍检查源题访问权，比赛成员不获得源题编辑权。比赛修订、构建列表/详情和 PDF / 题包新建发布的当前性同时比较编排与全部源题内容哈希，源题修改后旧产物标为历史，拒绝当作当前材料新建发布。已有冻结清单、PDF、ZIP 与已发布链接不改写；程序/数据/限制修改后仍需成功验收，仅文稿修改可复用匹配验收。任务书、计划、README、架构、题包和两份使用指引同步新行为。

**实际定向验证：**`pnpm check contracts api web` 通过，最后网页指引文字更新后 `pnpm check web` 再次通过。新增显式 `node --import tsx scripts/verify-contest-sync.ts --rollback` 并通过真实 Fastify 路由 / 原库必定回滚事务：覆盖旧固定引用与新比赛同步、同题在两场比赛的标题更新、三种文稿最新构建输入、关闭/缺失稿件、名称/标签/备注/负责人、修改限制与程序后验收失效及重新匹配、重新绑定的样例字节、当前题包下载、重复快照复用、旧快照/构建输入/下载不变、草稿选题与缺验收拒绝、源题缺失、版本冲突、CSRF、无权访问/加入、比赛编辑与源题权限隔离、撤销比赛权限以及过期 PDF/ZIP 发布拒绝。队列 add 与文件存储只用内存替身，成功验收及成功构建是明确标注的终态元数据夹具，**未声称执行 Judge 或 TeX**；用户、题目、比赛、修订、任务、导出、发布与审计夹具全部回滚，零真实入队任务。证据 `.local/contest-sync/verification.json`，默认 test/test:quick 不变。

**原环境在线与浏览器验证：**经原 5180 使用原独立管理员登录，读取现有「CWNU算协挑战赛」的 5 道题，每项标题和内容哈希与源题当前快照一致；4 个历史冻结版本与 4 次题册构建全部正确标为历史。缺少编排版本的最新构建请求返回 400，未创建冻结版本或任务。浏览器实看原比赛，确认全部自动同步提示、三类资料与题包默认最新来源、旧任务历史标记；临时编辑署名后刷新信息，本地输入仍在且构建按钮停用，随后放弃临时输入，未点击保存。最新题包按钮正常可用，浏览器无 warn/error。两个验证登录均退出，临时标签关闭；没有点击真实生成、导出、冻结或发布。证据 live-check.json、browser-result.json、arrange/materials/packages.png。原 5 道题完整快照哈希、比赛原 JSON/编排 v8 和全部模板版本指纹前后一致，活动 Build/TestRun 均为 0（before/after.json）。

**服务与未验证：**核对原开发进程树、确认无活动任务后，仅重启主目录同一 `pnpm dev` 加载 API。继续原 5180/3100、原数据库/Redis/存储/沙箱，无新增端口、实例、依赖或迁移。当前根进程 82132，Vite 65668、API 18840，两个 Worker 82432 / 70508，监听与 Worker 均属于该进程树且无多余服务；首页 HTTP 200、代理健康 ok、stderr 为空。服务记录 `.local/contest-sync/services.json`、services-verified.json 与 dev.out/err.log，后续重新核对实际 PID。本轮未新增真实 PDF、Judge 验收、全量/E2E、生产构建、外部 OJ 操作、部署或公网发布；快照组装正确性由路由回滚检查覆盖，既有渲染器与 Linux 隔离执行代码未改。无阻塞，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。

## Hydro 题目包目录与 LaTeX 转 Markdown（2026-10-04）

**用户要求与实现：**Hydro 从平铺测试数据 ZIP 改为 `题目名称_YYYY-MM-DD_HH-mm-ss/`，顶层含 statement.md、题解.md、tests/；包名同目录名，时间为北京时间，支持安全的中文文件名和 UTF-8 下载头。tests/ 放原编号输入、普通题答案、所需 checker.cc / interactor.cc、config.yaml、自定义工具的 testlib 与许可证。交互题继续只放非样例输入，保留用户指定的 auto、subtasks 单组与 /dev/null 配置，不创建答案占位。NovaJudge 平铺 .cpp / problem.yml 行为保留。新记录格式 HYDRO_PROBLEM，私有不可发布，文件名随不可变产物保存；既有 HYDRO_DATA 内容不重写。

**文稿转换：**新增有界 AST 转换，复用仓库固定的 unified-latex 1.8.4 parse/types/print-raw，离线安装直接依赖，未下载新版本。当前工作区语言沿 Workspace → 管理 → 导出传入 API，当前已保存内容和指定历史修订均受支持。转换标题、平台题面/交互小节、强调、嵌套列表、普通表格、代码和引用段落；数学保留 Markdown 数学定界符，展开 mat、调整 align/gather 环境。固定绑定样例按原顺序写入代码块并放在顶层 Note 前，交互样例输出只用于文稿；图片按引用打包到 assets/，核验字节及哈希。仅取启用题面和文档题解，不含 Beamer/标程/其他私有程序；缺题面拒绝，缺题解文件注明并警告。未知命令、环境及合并单元格表格保留可见 LaTeX 代码并报告，未声称任意 TeX/模板排版均可转换。不执行 TeX、作者代码或外部资源。Unicode 路径仅对 Hydro 导出显式启用，原生/Polygon 导入仍用 ASCII 限制，无数据库迁移。

**定向验证：**`pnpm check contracts problem-format api web` 通过，后续补充长 Emoji 标题截断与页面说明后 `pnpm check problem-format web` 再次通过。`node --import tsx --test scripts/hydro-package.test.ts scripts/test-data-export.test.ts` 共 15 项通过：目录/中文名称、数学与嵌套格式、表格/显式样例、代码围栏、固定样例、图片去重/哈希与缺失拒绝、语言/停用文稿、不可读交互答案不读取、原始二进制、工具配置、Unicode 路径和原导出规则；最后标题边界改动重跑 8 项新测试通过。默认 test/test:quick 未扩展。

`node --import tsx scripts/verify-test-data-export.ts --rollback` 通过真实 Fastify 路由/原数据库必定回滚事务：验证当前/固定内容、修改两份文稿后最新导出与旧包不变、指定语言与缺题解、中文 RFC 5987 下载、绑定样例、输入答案字节、交互两站新旧来源、权限/CSRF/跨题/撤权/禁止公开发布、无修订副作用和零判题任务。存储仅内存，全部用户/文稿/测试/修订/导出/审计夹具回滚；证据 `.local/hydro-package/api-verification.json`。`verify-interactive-samples.ts` 的题面夹具与嵌套路径断言同步，本轮未重跑其 Linux 执行部分。

**原环境实测：**读取原 5 题共 10 份题面/文档题解，全部转换无未映射警告，人工核对「蒂娜的谜箱」的交互列表、公式、表格与文字。经原 5180 独立管理员实际生成并下载「还差几个座位」「蒂娜的谜箱」两个私有题包（12/60 个成员），普通题 8 个输入/答案文件和交互题 53 个输入逐字节与原存储一致，中文目录/文件名、样例、Markdown 和工具/配置均在包中；Python 标准库独立读取 ZIP，全部 CRC 和 UTF-8 文件名标志正确。新导出记录保留供用户下载，ZIP 与 Markdown 预览在 `.local/hydro-package/downloads/`。Tina 现有判题配置为交互后 Checker，原有“交互判定待处理”报告保留，没有擅自修改题目判定模式或声称 Hydro 实站可直接判题。相关证据 live-check.json、zipfile-check.json、documents/。

浏览器实看原站新入口、zh-CN 来源、中文下载名和新/旧 Hydro 历史标签，检查导出按钮可用、专用包无公开发布按钮、NovaJudge 入口可切换，console 无 warn/error；没有在浏览器编辑业务数据。证据 browser-result.json、hydro-page.png。两次验证登录均退出，临时标签关闭。完整题目快照、比赛 JSON/编排 v8、模板版本指纹前后一致，活动 Build/TestRun 均为 0，见 before/after.json；仅新增上述两个私有导出及必要审计记录。

**运行环境与边界：**核对原开发进程树并确认无活动任务后，在主目录重启原 pnpm dev 加载最终实现；仍用原 5180/3100、数据库/Redis/存储/沙箱，没有新增实例、端口或迁移。收尾根进程 34060，Vite 68520、API 68804，Worker 20508 / 75980，均属同一进程树且无额外 Worker；首页 200、代理健康 ok、stderr 为空。证据 services.json、services-verified.json、dev.out/err.log，后续重新核对 PID。未执行 Judge、TeX、全量/E2E、生产构建、外部 OJ 上传/判题、部署或公网发布；用户自定义目录不冒充 Hydro 原生一键导入协议。PACKAGES、USER_GUIDE、PLAN 和本交接已同步，无本轮功能阻塞，差异检查通过后本地 Git 提交，不 push；P7.2/P8 继续暂缓。

## Hydro 样例采用 inputN / outputN 格式（2026-10-04）

**用户纠正与实现：**用户给出「还差几个座位」完整 Markdown 示例，要求样例使用 input1/output1 代码块。本轮将绑定样例及手写 exmp 统一为成对、从 1 连续编号的 inputN/outputN，去掉额外的“样例”“样例输入／输出”标题；编号按最终展示顺序，不使用测试点编号，混用手写与绑定样例也不会重复。题面不再额外加一级题名，无标题的开头描述补二级“题目描述”，已有标题保留。绑定样例置于首个顶层 Note/Notes/Explanation/Explanations 前，有样例时 Note/Notes 转为“样例解释”；英文稿用对应英文标题。文档题解、普通代码块、原始样例空白/换行、tests/ 数据/工具/配置及既有 ZIP 保持原行为。

**实际定向检查：**`pnpm check problem-format api` 通过；`node --import tsx --test scripts/hydro-package.test.ts` 9 项通过，包括多个内嵌/绑定样例连续配对、空输出、样例含反引号的围栏保护、CRLF、英文标题，以及图片、固定样例、交互仅输入和文件路径回归。`node --import tsx scripts/verify-test-data-export.ts --rollback` 通过原库回滚事务/真实 API，当前与固定题包中的 input1/output1、样例解释及无额外标题均核对，同时保留两站数据与权限回归。存储仅内存、夹具全部回滚，默认快查不扩展；证据 `.local/hydro-sample-format/api-verification.json`。

**原环境验证：**经原 5180 管理员登录新生成「还差几个座位_2026-10-04_13-53-26.zip」，下载并读取 statement.md，逐项核对用户给定的 5 组输入、输出及四个二级标题顺序。与上轮历史题包比较，本次题面恰好只有上述格式变化，其余 11 个文件逐字节相同；旧下载内容保留。包与 Markdown 在 `.local/hydro-sample-format/downloads/`，记录 live-check.json，验证登录已退出。原题目/比赛/模板指纹前后一致，活动 Build/TestRun 均为 0；只新增这个私有导出及必要审计，没有改用户正文、样例或判题设置。

**服务与收尾：**核对原主目录开发树、确认零活动任务后，重启同一 pnpm dev 加载改动；仍用 5180/3100 及原数据库/Redis/存储/沙箱，无新增实例、端口、依赖或迁移。收尾根进程 4044，Vite 54816、API 34928，Worker 79384 / 81236，均属于原服务树且无额外 Worker；首页 200、代理健康 ok、stderr 为空，见 services.json、services-verified.json，后续重新核对 PID。未重新操作浏览器、执行 Judge/TeX、全量/E2E、外部 OJ 上传或判题、部署/发布；本轮仅调整导出文本。文档和交接已更新，差异检查通过后本地提交，不 push，无阻塞。

## 补充带标注右箭头语法（2026-10-04）

**原因与实现：**「双色通行证」题面第 31 行含四处 `\xrightarrow`，既有 AST 批准清单遗漏该命令，导致保存成功但反复提示不能构建。按用户要求补入三类正文共用的数学语法，支持上方标注以及可选下方标注；两处参数继续遍历检查，不能借箭头引入文件访问、写入、宏定义或展开。内容策略升为 `pf-content-5`，新构建固定该版本并使用新的输入哈希，历史构建不改写。内置模板已加载 amsmath，本轮没有编辑或重新发布模板，没有修改用户正文。

**实际验证：**`pnpm test:quick template` 的 8 项定向检查和 `pnpm check template-engine api tex-worker` 通过。新增检查覆盖题面、文档题解与 Beamer 中连续箭头、上下标注内的数学/文本，以及两处参数中的 input、write18、def、csname 拒绝。原库读取确认受影响题面四处箭头全部通过新策略。

经原 `localhost:5180` 为这份已保存题面创建 Build `cmuthbot80003ktac6ya1qwu3`，沿用正文修订 `cmutgyfn0007akty83cufw9mo` 和 CWNU 挑战赛比赛题面 v2；原独立 Linux TeX 沙箱返回 Accepted，CPU 1647 ms、299 MiB，状态 SUCCEEDED、没有缓存复用、当前性有效。实际下载 Artifact `cmuthbqio0001ktg0oqnaa2m4`，核对 PDF 文件头、63891 字节及 SHA-256。保留模板 pgfplots 兼容提示和多轮编译初轮的引用提示，没有未定义箭头错误。证据、日志及 PDF 在 Git 忽略的 `.local/xrightarrow/`，验证会话已退出。前后题目完整快照、比赛编排、模板指纹一致，只有预期构建/产物及审计新增。

**环境与边界：**再次确认活动 Build/TestRun 为 0 并核对主目录服务树后，仅重启原 pnpm dev；仍使用 5180/3100、原数据库/Redis/存储/沙箱。收尾根进程 80008，Vite 82664、API 57396，两个 Worker 55008 / 67588；监听和 Worker 均属该树且无额外服务，首页 200、健康 ok、stderr 为空。服务记录 services.json / services-verified.json，后续重新核对 PID。未另跑题解/Beamer 的真实编译、PDF 逐页视觉检查、Judge、全量/E2E、外部 OJ 或部署；三类参数策略由上述定向检查覆盖。无依赖、迁移或新端口，本轮无阻塞；TEMPLATES、PLAN 和交接已同步，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。

## 单题 PDF 使用已保存时空限制（2026-10-04）

**原因与实现：**配置入口原本位于「程序、数据与验收 → 判题配置」，但单题构建未读取该配置，两套内置单题题头和渲染器均写死 1 s / 256 MB。新增 `pf-statement-1`，API 将时间、内存及有效输入输出名称固定进题面构建快照和缓存哈希，Worker 仅使用这份快照，模板预览使用受控默认值。新内置题头改为现有插槽，既有内置版本的原样标准题头仅在渲染副本中接入插槽，已发布模板原记录、作者正文及历史 PDF 不改写；任意自定义硬编码题头不做猜测替换。单题册目录和题头使用相同值，比赛原有逐题配置逻辑保留。

时间、内存、有效 I/O 或题面渲染版本不一致时，构建详情与列表标为历史，发布接口锁定并核对当前题目设置，拒绝过期题面；旧无配置快照的失败任务应新建构建，不通过重试改换快照。无关的 Checker/输出限制及标准输入模式下未使用的文件名不使 PDF 过期，文档题解不受题面设置影响。配置页补充单位换算和重新构建说明，保存配置后通知工作区刷新构建状态。

**定向验证：**`pnpm check template-engine api tex-worker web` 通过；显式运行 statement-settings.test.ts、policy.test.ts、contest.test.ts 的 11 项检查全部通过，覆盖新旧两套题面模板、单题/题册、分数秒和内存、文件名转义、源对象不变、既有正文/数学/样例及比赛回归。默认轻量快查未扩展。`node --import tsx scripts/verify-statement-settings.ts --rollback --sandbox` 通过真实 API / 原数据库事务：分别修改时间、内存、I/O 检查输入哈希与过期状态，拒绝过期发布，确认无关配置复用输入、旧快照不变及题解不受影响。队列使用内存替身，全部用户/题目/构建/发布/审计夹具回滚；成功状态元数据仅用于路由检查，不冒充实际 Worker 结果。

回滚结束后，用该固定的 2500 ms / 512 MiB 快照及现有已发布模板经原独立 Linux TeX 沙箱实际编译，Accepted，生成 22035 字节 PDF，临时沙箱文件清理。使用 Poppler 渲染并目视确认完整单页题头显示 2.5 s / 512 MB，布局正常。证据 `.local/statement-settings/api-verification.json`、sandbox-fixture.log/pdf/png。

**原服务实际验证：**经原 5180 为「双色通行证」保存中的修订 `cmuthfqzu000ektacf64ctrpj` 创建 Build `cmuthzn7g0003kttgqi18zxyj`，保留 CWNU 挑战赛比赛题面 v2 和用户已保存的 2000 ms / 256 MiB，未修改业务内容。原 Worker 实际编译 Accepted，CPU 1572 ms、224 MiB、没有缓存复用，Artifact `cmuthzonw0001ktig77cimv2b` 为 63894 字节。下载核对 SHA-256，渲染首页确认题头实际显示 2 s / 256 MB，正文与箭头正常；新记录当前有效，旧记录显示历史。证据 live-check.json、build-result.json、live.pdf、live-page-1.png；验证会话退出。题目完整快照、比赛编排与模板指纹前后一致，仅新增预期构建/私有 PDF 和审计。

**环境与收尾：**确认零活动任务并核对主目录服务树后重启同一 pnpm dev，仍用原 5180/3100、数据库/Redis/存储/沙箱，没有新端口、依赖或迁移。重启后第一次验证请求早于 API 就绪而失败，健康检查通过后重试成功。收尾根进程 81412，Vite 14248、API 30868、Worker 58620 / 82312，均属该树且无额外服务，首页 200、健康 ok、stderr 为空，见 services.json / services-verified.json，后续重新核对 PID。未执行浏览器表单交互、真实多题比赛构建、Judge、全量/E2E、部署或公网发布；前端通过类型检查，题册/比赛路径由定向检查覆盖。用户指南、模板协议与 PLAN 已更新，无阻塞，差异检查后本地提交，不 push，P7.2/P8 继续暂缓。

## 添加程序时提供模板与写法提示（2026-10-05）

**用户要求与实现：**「程序、数据与验收 → 程序」的源码编辑器上方新增按角色/编译语言筛选的「写法参考」。提供 A+B 读写框架、随机整数数组、随机排列、数组 Validator、整数答案 Checker、多解构造 Checker、单轮 Interactor 和配套交互解法，共 8 类模板、13 份语言实现。说明生成器参数与末尾种子、testlib 的 inf/ouf/ans/tout、严格格式校验、交互刷新及判题配置入口；错误解、超时解和暴力解明确需要作者补充实际算法，不能把读写框架当作对应算法。

新建时展开，已有程序默认收起，支持预览、复制和显式填入。填入只更新草稿，名称为空时补建议名；已保存程序或已修改源码需确认替换，确认回调再次核对草稿/角色/语言/源码及权限，避免异步覆盖。切换角色不替换源码，模板不会自动保存、编译或更改 profile/判题配置。C++17/20/23 共用兼容代码，A+B 覆盖 C/C++/Java/Python，数组生成器及交互解法另附 Python；不兼容语言显示提示，不注入 C++ 工具源码。API、数据库结构、版本保存和管理员权限边界不变。

**定向与真实沙箱验证：**`pnpm check web` 通过；`node --import tsx --test scripts/program-templates.test.ts` 两项通过，覆盖空白/初始/作者草稿与已保存程序的替换确认、角色和语言筛选。`node --import tsx scripts/verify-program-templates.ts --sandbox` 在原独立 Linux Judge 沙箱用生产语言编译计划实际编译全部 13 份实现并运行：四语言 A+B、C++/Python 数组生成器的种子复现及不同种子、随机排列完整性、生成输入被 Validator 接受、越界/缺换行/尾随内容被拒绝、两类 Checker 的 AC/WA/PE、C++ 与 Python 配套解法的真实双向管道交互及错误回复拒绝。13 个沙箱缓存均清理；无数据库写入和队列任务，未在宿主机执行作者代码。证据 `.local/program-templates/sandbox-verification.json`。默认 test/test:quick 未扩展，两个新增检查保持显式入口。

**原 5180 浏览器实查：**在「双色通行证」仅创建本地未保存草稿，检查新建默认展开、角色提示、数组/排列模板选择、初始源码填入与建议名称。通过页面「下载本地草稿」弹窗的完整 JSON 核对取消替换、切换角色时源码逐字保留；确认替换后源码与 Checker 预览逐字一致，原非空名称保留，仍是未保存草稿。桌面布局目视通过，截图 program-guide.png、检查记录 browser-result.json。未点击保存程序或编译；原 7 道题完整快照、比赛编排及模板指纹前后一致，活动 Build/TestRun 为 0（before/after.json）。

**环境与验证边界：**本轮仅前端功能，Vite 热更新已在原 5180 生效，无需重启。再次核对主目录原根进程 81412、Vite 14248、API 30868、Worker 58620 / 82312，原首页 200、代理健康 ok；原端口/数据库/Redis/模板/存储和沙箱不变，无依赖、迁移或新增实例，见 services-verified.json。浏览器最后切换已有程序以丢弃验证草稿时，原生确认框导致控制接口超时，未能确认退出登录/关闭验证标签；先前的模板替换弹窗及草稿核对均已完成。未单独实测剪贴板、窄屏及已有程序收起状态，未通过 API 持久保存模板程序或运行完整题目验收；没有 TeX、全量/E2E、外部 OJ、部署或公网发布。USER_GUIDE、JUDGE 与 PLAN 已同步，差异检查后本地提交，不 push；功能无阻塞，P7.2/P8 继续暂缓。

## 上云准备评估与反代配置（2026-10-05）

**用户意图与核对：**用户询问还需完成什么并准备上云，本轮转入 P7.2 部署准备，尚未提供云主机/域名/访问范围，没有连接远程主机或推断公网发布许可。先读取原计划/交接、生产 Compose、发布/恢复/维护脚本和认证实现；核实仍在主目录原 5180/3100，根进程 81412、Vite 14248、API 30868、Worker 58620 / 82312。本轮没有重启、改端口/数据库、创建新服务实例或写业务数据。

**实际检查：**`pnpm build:web` 的类型与生产打包通过，保留 Monaco 按需块体积提示。从干净 `7517acd` 的 Git archive 成功构建 Linux amd64 基线 `problemforge-app:cloud-prep-20261005-7517acd`，镜像 ID `sha256:4d2ab7982423440c139c2a18a0a681747242bc932d522f221b6f0a2513478a3b`，清单 `.local/releases/cloud-prep-20261005-7517acd.json`。该镜像仅验证此前业务代码可构建，早于本轮代理补丁，且保留以下待修依赖，不作为最终上线版本；未启动该镜像的新实例。

原库只读盘点为 7 题 / 1 比赛 / 7 模板、15 版本 / 34 程序 / 117 组测试 / 1 用户；私有目录实际是 `.local/p3-storage`，2623 个登记对象共 585256226 字节，无未完成预留和活动任务。ASSOCIATION_APP_KEY 未配置。记录 `.local/cloud-readiness/local-state.json`，不输出凭据。现有 ops backup 只适用于生产 Compose 的应用进程与私有卷，不能直接为宿主机 pnpm dev 和本地文件夹产生一致备份；跨环境迁移、停写窗口和空目标恢复需另行执行。

**已补代码与定向验证：**现有 Fastify 默认不识别代理后的客户端 IP，会把 Nginx 后的用户放入同一个登录限流桶。新增可选 `API_TRUSTED_PROXIES`，仅允许显式 IP/CIDR、默认关闭，拒绝布尔/通配/全网 `/0`；API、生产 Compose、配置示例和 ops init 占位接入。新增单层 Nginx HTTPS 示例，覆盖用户传入的转发头、40 MiB 请求限额、SSE 不缓冲与超时。`node --import tsx --test apps/api/src/trusted-proxies.test.ts` 3 项通过（配置校验、IP/链路防伪造、实际限流桶隔离）；`pnpm check api`、Compose config --quiet 通过，无监听测试端口，无 DB/Redis 写入。原开发 `.env` 未配置该项，运行中的 API 也未重启加载；Nginx 只保存示例，未安装、nginx -t 或实际 TLS 联调。

**待处理的上线阻塞：**官方 npm 生产依赖审计命中 10 high / 9 moderate / 1 low。原 registry.npm.taobao.org 缺少 audit 端点，改为本次命令显式 `--registry=https://registry.npmjs.org` 成功取回结果，未改用户 registry。报告 `.local/cloud-readiness/dependency-audit.json`；涉及 Fastify、Swagger UI 间接 static、Judge 的 ws、Prisma 工具链 effect/deepmerge-ts、YAML/ZIP 解析。查阅 Fastify 维护者的校验绕过和受限代理转发头公告，不能仅凭 IP 定向测试认为框架问题已解决；代理功能在框架安全更新前保持未启用。此轮是准备评估，尚未升级依赖或逐项验证实际可达性，审计命中不等同于已证实的平台可利用漏洞。系统与容器镜像漏洞扫描也未执行。

**交接与下一步：**新增 CLOUD_READINESS 清单并关联 DEPLOYMENT/PLAN，明确依赖修复 → 协会联调/目标配置 → 原数据迁移 → 新版本镜像 → 云端验收和备份。硬件 4 vCPU/8 GB/80 GB 的建议仅为小团队低并发初始估算，未作容量承诺。云端 DNS/TLS、真实反代/不同客户端、Judge/TeX、迁移/恢复/重启、小规模试用均未验证；本轮未运行作者程序、TeX、全量/E2E、上传数据、访问其他项目或公网发布。维护原环境，完成差异检查后本地提交，不 push。

## 协会 APPKEY 配置与生产域名确定（2026-10-05）

**用户要求与实现：**用户提供协会 APPKEY，要求配置并测试，确定域名为 `problems.cwnupaa.com`；随后明确真实账号登录由本人在页面测试。密钥仅填入 Git 忽略的原根目录 `.env`，不记入源码、文档或验证输出。Nginx 示例两个 server_name 和 HTTP 重定向已改为确定域名，DEPLOYMENT 明确生产私有配置使用 `APP_ORIGIN=https://problems.cwnupaa.com`。原开发配置继续 `APP_ORIGIN=http://localhost:5180`，未生成或启用新的生产实例。

**实际验证：**原 5180 登录页 HTTP 200、代理健康接口 ok，`/api/auth/config` 返回 association / configured=true / localAdmin=true。通过现有后端认证模块向固定协会接口发起一次随机不存在账号请求，得到 401 / `LOGIN_FAILED`，耗时 97 ms；检查使用随机凭据，未提供真实账号密码，没有调用身份同步或创建本地会话。该结果只确认接口可达和认证失败响应链路，不作为真实账号成功登录、APPKEY 完整权限或云端登录验收。证据 `.local/association-connection/auth-config.json`、association-probe.json，只保存非敏感状态。DNS A 查询为 `43.136.170.90`（dns.json），未访问目标域名 HTTP/HTTPS 或连接该主机。

**原环境状态：**核对主目录原进程树并确认活动 Build/TestRun 均为 0 后，仅重启原 `pnpm dev` 加载密钥。当前根进程 30600，Vite 69040、API 65472、两个 Worker 80592 / 85032；原 5180/3100 的监听与两个 Worker 均在同一进程树，无额外 Worker。数据库、Redis、私有存储、模板和 Linux 沙箱不变；原 7 题完整快照、比赛编排与模板版本指纹前后一致，活动任务仍为 0。记录 `.local/association-connection/pre-restart.json`、after.json、services.json、services-verified.json、dev.out/err.log；后续重新核对 PID。API 已加载上一轮代理配置代码，但本机 `API_TRUSTED_PROXIES` 仍未启用。

**未验证与下一步：**真实账号成功登录等待用户页面测试；云端私有配置、服务器规格/访问方式/开放范围、证书、`nginx -t` 和实际部署均未完成。依赖安全更新、原库一致迁移、新最终镜像及目标主机验收沿用 CLOUD_READINESS 待办，本轮未改依赖、运行 Judge/TeX、全量/E2E、重建镜像、改 DNS 或公网发布。ACCOUNTS、CLOUD_READINESS、DEPLOYMENT 和 PLAN 已同步。`git diff --check` 通过，`.env` 和验证目录被 Git 忽略，扫描全部 370 个已跟踪文件未发现该密钥；原开发 Origin 与未启用代理状态检查通过，见 private-config-check.json。收尾本地提交，不 push。

## Caddy / PM2 部署准备：依赖安全更新（2026-10-05）

用户要求一键部署版本，确认 Ubuntu 22.04/24.04、Caddy 反代与 PM2 负载均衡。先修复此前已记录的依赖阻塞：Fastify 5.12.5、Swagger UI 6.1.1（static 10.1.5）、Prisma/client 6.19.3、ws 8.21.0、yauzl 3.2.1、yaml 2.8.3；限定覆盖 Prisma 配置的 deepmerge-ts 8.0.0 和旧 YAML。Prisma 保持 6.x，未改数据库 schema 或迁移。新官方 npm 生产审计 high/moderate/low/critical 均为 0，报告 `.local/caddy-pm2/dependency-audit.json`。

升级检查发现 Swagger UI 的 uiHooks 不覆盖静态路由，因此将整个文档子树放入独立鉴权作用域，统一保护 HTML、JSON 与资源，新增两项依赖集成检查。独立 Linux 构建实际完成新锁文件安装、Prisma 6.19.3 客户端生成，database/domain/judge-adapter/judge-core/problem-format/api 六包类型检查，以及 24 项 Swagger 鉴权/严格 JSON/受信代理与限流/ZIP 路径/判定语义/Hydro Markdown/YAML 回归。镜像 `problemforge-dependency-check:20261005` 仅作构建验证，未启动服务或执行作者程序。

“停止开发服务并安装依赖”的组合命令被自动审批以策略阻止拒绝；未重试停服，改用锁文件更新与独立 Docker 构建。原 5180/3100、根进程 30600、Vite 69040、API 65472、两个 Worker 和原数据库/存储继续使用原安装依赖，未安装本机新 node_modules、重启服务、创建新应用实例或监听端口。新依赖尚未完成原库登录/实际 Judge 通信或云端运行验收；这些不能由纯构建检查代替。差异检查通过，先本地提交本依赖块再继续一键部署实现，不 push。

## Ubuntu Caddy / PM2 一键部署实现（2026-10-05）

**实现范围：**依赖块已提交 `6a5f468` 后，按用户确认的 Ubuntu 22.04/24.04 x86_64 实现 `deploy.sh` 和 `scripts/cloud-*.mjs/ts`。默认域名 `problems.cwnupaa.com`、安装目录 `/opt/problemforge`，复用服务器现有 Node 22.12+/24、pnpm 10.11.1、PM2、Caddy 和 rootful Docker Compose。独立用户、PM2_HOME、Compose project 与私有配置；API cluster 默认 2 个、两个 Worker 各 1 个，数据库/Redis/沙箱只绑定云端回环端口。作者程序和 TeX 仍只由两类 Linux 沙箱执行。首次随机生成数据库/Redis/沙箱/管理员密码，APPKEY 只由 API 环境文件加载；创建管理员和六套待编译发布的模板草稿。

源码包从干净提交生成，包含来源提交、迁移清单、逐文件 SHA-256；部署核对哈希，按锁文件安装、生成客户端并构建生产前端。复用已有私有配置和数据，不重新生成密钥。升级先检查任务空闲、关闭本站写入并再次确认，保存数据库/完整私有文件/状态哈希备份，才执行迁移。迁移后的失败不重启旧代码，保留待完成版本，只允许同包重试；本机及 HTTPS 健康响应必须匹配本站部署标识，未通过不会记录成功。Caddy 保留其他站点，验证、并发检查与备份后只替换本站标记块。新增独立 systemd 开机恢复、日志轮转、status / reload-api / backup 命令；备份为私有原始数据，未提供覆盖式自动回退。

**PM2 适配：**新增原生 ESM API 入口、启动 ready 通知和关闭去重；修正首次 PM2 守护进程日志污染 jlist JSON、上传目录位于 /root 时专用用户工作目录不可读的问题。原 SSE 单进程计数改为 Redis 原子租约，跨 API 进程共享每用户 5 个名额，正常关闭释放，崩溃/Redis 断连以 30 秒 TTL 回收。新 `/api/health` 部署标识仅在云端配置时返回，原本机健康响应保持原内容。

**实际检查：**Linux 独立 Docker 构建通过 bash / Node 语法、11 项配置/归档路径与哈希/重复执行/迁移失败顺序检查、API 类型和初始化脚本严格类型检查。Caddy 2.10.2 实际 adapt/validate、PM2 7.0.4 首次守护进程及两个 cluster 夹具实际启动、环境文件与 tsx/ESM 加载、reload 后两个 PID 替换并正常 SIGINT 退出均通过；夹具无 HTTP 监听、无应用数据库连接。证据 `.local/caddy-pm2/linux-evidence/runtime-check.json`。本轮此前已完成新依赖下的生产前端构建，最终脚本调整未改变前端，未重复扩大测试。

Compose config JSON 检查确认四个基础服务、全部回环映射、internal 网络及仅沙箱 privileged，未执行 up；证据 compose-verification.json。显式 SSE 检查通过两个原 Redis 客户端的 12 次竞争仅获 5 席、释放/替换、续租/过期回收和断连拒绝，只使用随机验证键并清理，无业务 DB 写入。默认快查未扩展。README、DEPLOYMENT、CADDY_PM2、CLOUD_READINESS 与 PLAN 已同步。

**边界与收尾：**尚未连接云主机、执行 Ubuntu 主机级完整安装、真实域名 TLS/成功协会登录、实际 Judge/TeX、重启或备份恢复验收。原 Windows 题库和 `.local/p3-storage` 不进入源码包；首次部署是新站，现有题库/比赛/发布模板的一致迁移仍需单独完成。本机保持原 5180/3100、数据库、Worker、存储与沙箱，没有新应用实例或端口、原库迁移或服务重启。本功能定向检查通过后本地提交，再生成并核验交付包；不 push、不公网发布。目标主机尚未提供访问方式，因此这里只交付可执行版本，不声称已经上云。

**打包兼容修正：**功能提交 `6e9155e` 后，首次打包遇到 Windows bsdtar 用系统代码页读取 Git tar 中的中文模板资源名，归档失败且未交付。显式使用 `hdrcharset=UTF-8` 解包原 source.tar 已成功，打包器据此对 Windows 设置 UTF-8，输出统一采用 PAX 格式；Linux 保留原生 tar，不引入额外打包依赖。收尾只读检查确认原根进程 30600、Vite 69040 / API 65472 / Worker 80592、85032 仍运行，5180 首页 200、健康 ok，未重启；证据 `.local/caddy-pm2/services-final.json`。密钥扫描覆盖已跟踪 386 个文件且无命中，原 Origin 和未启用代理状态保持。

**实际交付包：**兼容修正提交 `837356e` 后，成功执行 `pnpm package:cloud ubuntu-20261005-837356e`。交付 `.local/releases/problemforge-caddy-pm2-ubuntu-20261005-837356e.tar.gz`（1,292,126 字节）及同名 `.sha256`，SHA-256 为 `aaeba07194524c12b6815eb610fecf685bd58f697102e14ea60a25a590f41e86`。另外从原私有配置生成 Git 忽略的 `.local/releases/problemforge.secrets.json`，仅供用户上传，内容未写入日志或源码包。完整安装步骤见 CADDY_PM2。

Python 标准库独立读取最终 PAX/gzip 包，388 个文件全部核对路径、成员唯一性和内容哈希，其中 386 个已跟踪文件逐一与该提交 Git blob 完全一致；3 个中文资源名正确，deploy.sh 为 LF，未含 APPKEY、原 .env、题库数据、node_modules 或开发目录。独立解包后，再运行安装器的 verifyRelease，387 条清单全部通过；证据 `.local/caddy-pm2/package-verification.json`。部署包来源固定为 `837356ebfbf6044dd1bd07740e6e268bc1e57d8d`，后续收尾提交只补验证脚本和记录，不改变部署及应用代码。本轮无本地实现阻塞；云端完整安装/运行验收和原数据迁移仍未执行。

**Worker 启动补充检查：**因 Worker 使用直接 `.ts` 入口，与 API 的 `.mjs` 包装入口不同，补充真实 PM2 fork 夹具核对。独立 Linux 构建现同时启动 2 个 cluster API 夹具、TeX/Judge 各 1 个 fork 夹具；直接 TypeScript 入口和 app.env 加载成功，两个 Worker 未加载 APPKEY，API reload 保留两个 Worker PID 不变。更新后的 runtime-check.json 全部通过，无 HTTP 监听、应用数据库或真实任务。此项只增强验证脚本，已交付包中的实际 PM2 配置与应用代码无需修改。

## 用户授权上传 GitHub（2026-10-05）

用户明确要求上传 GitHub 供云服务器拉取，随后选择 `pppolf/ProblemForge` **公开仓库**，本轮因此获得创建该仓库及推送本项目的授权；此前“不 push”的默认规则不阻止本次明确操作，不扩展到部署站点或其他项目。工作区初始干净、无远程仓库。本机未安装 gh，GitHub 连接器需要重新认证，但现有 Git Credential Manager 的 pppolf 认证经 GitHub API 检查有效，使用该正常认证通道，凭据不输出、不写文件。

补充 GitHub clone → 从提交生成固定发布清单 → 执行发布目录 deploy.sh 的完整步骤，同一提交使用固定构建标识，支持失败后同包重试；源码仓库不提交生成的发布清单。根目录私有 JSON 和 cloud-release.json 加入忽略规则。此次只改部署指引和忽略规则，不改应用运行代码、依赖或原 5180 服务。

上传前扫描 HEAD 全部可达历史：1,583 个 Git 对象、901 个 blob，未发现真实协会 APPKEY、GitHub token、私钥标记或已提交的 .env/.local/私有 JSON；不把当前文件忽略误当成历史没有密钥。报告 `.local/github-upload/history-scan.json`，仅保存结果，不保存凭据或敏感原文。已创建公开仓库 `https://github.com/pppolf/ProblemForge`，新增 origin 并将 master 推送、建立上游跟踪；首次上传提交为 `eae6c72`。匿名 GitHub API 核对公开属性、默认分支、386 个源码文件、远端 SHA 与本地一致，以及部署说明字节完全相同，私有配置与原题库未上传。证据 `.local/github-upload/repository.json`、verification.json；后者随最终推送更新。

**首次 GitHub 检查修正：**首次上传的 Actions 已成功安装依赖及生成 Prisma 客户端，但差异检查收到 GitHub 新分支事件的全零 before SHA 后失败。`scripts/ci.mjs` 现仅对 push 事件的已知全零基准读取当前提交文件清单；其他未知基准仍拒绝，不任意回退全仓。Node 语法及定向 plan 检查通过：首次范围 386 个文件、正常 diff 保持、非 push 全零与未知基准拒绝；不执行真实集成、Judge/TeX，也不改变默认快查。记录 initial-ci-check.json，修正提交后由 GitHub 自动复核，实际结果在 verification.json / Actions 页面查看。本机开发服务与业务数据未更改，未在云主机安装或启动站点。

## 适配 /root/.hydro/Caddyfile 与详细服务器命令（2026-10-05）

用户说明服务器 Caddyfile 在 `/root/.hydro`，需要可直接复制的详细命令。原脚本固定 `/etc/caddy/Caddyfile` 和 caddy.service，不适合该路径及 PM2 管理方式。本轮新增 `caddyFile`、`caddyReload` 部署设置，旧配置继续默认 systemd；提供 `infra/cloud-settings.hydro.json` 选择 `/root/.hydro/Caddyfile` 和 Caddy CLI 平滑重载。初次与维护操作均从持久化设置读取实际路径；文件验证、备份、候选配置、相对 import 和失败恢复使用同一路径。CLI 模式只连接 Caddy 配置指定的回环 TCP 管理接口，核对实际运行 JSON 与文件一致后再合并，不自动覆盖未保存的其他站点；关闭管理接口、非回环或 Unix socket 当前明确拒绝，需单独确认管理方式。

新增 DEPLOY_HYDRO_CADDY 分步命令，覆盖 root/架构/原配置检查与备份、基础工具及缺失 Docker 安装、专用 `/opt/problemforge-tools` Node/pnpm/PM2、Git 拉取、静默输入 APPKEY、固定发布目录构建、部署与管理员登录。专用 Node 22.23.3 的 Linux x64 归档 SHA-256 已经从官方版本校验清单读回并固定；不会通过全局 Node/PM2 升级去改变 Hydro 的工具路径。实际 APPKEY 仍不进入文档或 Git。

**实际验证：**Node 语法、13 项部署定向检查、Hydro 设置的只读 plan 通过。Linux 独立构建使用真实 Caddy adapt/validate，验证自定义 `.hydro` 目录及相对导入的原站点保留，同时保留 PM2 双 cluster / 两个 fork 的启动、APPKEY 隔离与重载检查；未监听 HTTP 或访问应用数据库。证据 `.local/caddy-pm2/custom-caddy-evidence/runtime-check.json`。详细指引中 7 个 Bash 代码块均通过 `bash -n`，检查不执行代码块；安装命令设为出错即停止，归档校验失败不会继续解包。原 5180、API 3100、数据库/文件/Worker 保持原环境，没有运行上述服务器命令、连接云端、修改实际 Hydro、部署/重载线上 Caddy 或执行 Judge/TeX。Ubuntu 安装、真实管理接口与证书仍待目标主机验证。按此前用户明确的 GitHub 交付授权，本轮定向检查及记录后本地提交并推送同一公开仓库，供用户拉取执行。

## 服务器 APPKEY 输入失败恢复（2026-10-05）

用户反馈旧指引的内联 Node 命令报“APPKEY 格式不正确”。该异常在本地正则校验处抛出，早于写文件，没有调用协会接口；记录不能确定用户当时输入为空、混入命令还是含其他字符，也不能据此判定实际 APPKEY 无效。旧指引将隐藏输入和后续命令放在同一复制块，整块粘贴易让 `read` 读到空行。

新增 `scripts/configure-cloud-secrets.sh`，独立从控制终端隐藏读取，空输入或非法字符重新提示，Node 保存前仅去掉首尾空白；私有 JSON 使用排他创建、600 权限，不回显密钥，不覆盖已有文件。已有合法配置保留内容并收紧权限；已有非法 JSON、符号链接或无交互终端明确失败。DEPLOY_HYDRO_CADDY 改为单独运行脚本，提示出现后再粘贴 APPKEY，成功后才执行部署；安装器原校验规则未放宽。

**实际验证：**独立 Linux 构建通过 Bash 语法与真实伪终端输入检查，依次提交空行、错误格式和带首尾空白的虚构密钥，确认前两次重新提示、第三次保存正确且输出不含密钥；600 权限、已有配置重复执行不改内容、损坏文件与符号链接不覆盖、无终端不生成文件均通过。证据 `.local/caddy-pm2/secrets-input-evidence/secrets-input-check.json`。未使用真实密钥执行该检查或发起网络请求，没有启动应用、Judge/TeX、访问业务数据库或修改云主机；原 5180/3100 的 Vite 69040 和 API 65472 仍来自主目录。按已有 GitHub 交付授权提交并推送该修正；云端实际输入及完整部署结果仍待用户执行。

## Caddy 默认相对文件名比较兼容（2026-10-05）

用户云端日志显示 Caddyfile 验证成功，但安装器报告文件与运行配置不一致，发生在预检阶段，尚未开始本站安装。用户补充版本 `2.10.2`、进程 `/root/.nix-profile/bin/caddy run`。Caddy 官方 file_server 实现自动将配置文件加入 hide；独立 Linux 中用真实 2.10.2 对同一静态文件/反代示例适配，确认绝对路径会生成 `/tmp/.../Caddyfile`，默认相对文件名生成 `./Caddyfile`。这与用户启动方式相符，但尚未读取其实际运行 JSON，不能声称唯一差异已在目标主机确认。

安装器现先尝试绝对路径适配结果；不匹配时从同目录以 basename 再适配，只有完整 JSON 与管理接口配置一致才通过，不删除 hide、放宽路由顺序或忽略配置字段。激活和失败恢复沿用匹配的 config 参数。真实不匹配时返回最多 8 个 JSON 字段路径，不含配置值；增加 `check-caddy` 只读子命令，在源码目录即可执行，避免为排查问题启动安装。指南和当前计划同步。

**实际验证：**Linux 独立构建通过 Node 语法、14 项定向检查；真实 Caddy 2.10.2 相对/绝对适配差异复现、相对形式精确匹配、原站点与新增域名保留、上游变更及处理顺序变更仍拒绝通过。只读命令用真实 Caddy CLI 和模拟管理接口响应分别验证成功/失败分支，确认未写 Caddyfile、未创建安装标记、输出未含配置值。证据 `.local/caddy-pm2/caddy-compare-repro-evidence/caddy-compare-repro.json`，liveAdminMocked=true、listenerStarted=false。首次验证构建漏复制 cloud-workflow.mjs，补齐夹具依赖后通过；该失败不是应用代码错误。未接触实际云主机配置、重载 Caddy、启动新监听或业务实例，也未执行 TeX/Judge。原本机 5180/3100 进程不变。按已有 GitHub 交付授权提交推送，下一步用户拉取后运行只读检查，匹配成功再继续部署。

## 云端沙箱构建下载与取消修正（2026-10-05）

用户截图显示构建已运行 8869.9 秒，仍在从 deb.debian.org 下载 TeX 中文语言包；两个安装步骤都显示约 8817 秒。代码核对确认两类沙箱使用相同默认 APT cache id 和 sharing=locked，不能同时进入安装步骤，慢下载会阻塞另一侧。截图也保留 1799.5 秒的旧进度行；旧命令超时仅终止直接子进程并立即拒绝，没有保证 Docker Compose 插件已退出，但未读取服务器进程树，不能据截图断言具体遗留进程。已说明仅在仍处于镜像构建阶段时按一次 Ctrl+C，不停止 Docker 或删除其缓存、卷。

**实现：**compose.pm2 默认改用清华 TUNA Debian / Debian Security 镜像，支持通过既有私有 infra.env 覆盖两个 URL；不更改宿主机或开发 Compose 的源。实际核对固定 go-judge 基础镜像没有 CA 证书包，默认采用镜像站支持的 HTTP，保留 Debian 的源签名校验。两种 Dockerfile 使用各自的缓存 id，TeX 的 science、humanities 与其他依赖合为一次安装，所有直接固定版本保持不变。APT 空闲网络超时 30 秒、最多重试 3 次，关闭镜像帮助中提到可能引起连接重置的 HTTP pipelining。

构建输出改为 plain，单次构建 30 分钟超时。提取 cloud-process 执行器，仅为沙箱构建建立独立 Linux 进程组；超时或 Ctrl+C 先取消本次组，必要时强制结束同组插件，等待命令关闭再走原部署清理并释放锁，不影响其他 PM2 或 Docker 工作。其他命令保留原参数、捕获和私有备份排他写入语义。详细指南新增旧版构建恢复步骤：先确认没有未完成迁移且旧 PID 已退出，才清理固定路径的遗留锁并拉取新版，绝不直接覆盖进行中的部署。

**实际验证：**独立 Linux 通过 Node 语法与 16 项定向检查，覆盖超时/模拟 SIGINT 时父进程及忽略 SIGTERM 的插件均退出、监听恢复、捕获/退出码及备份不覆盖。真实并行构建 `problemforge-tex:download-check-20261005` 和 `problemforge-judge:download-check-20261005` 成功，仅执行 build、未 up。两个新缓存从下载索引开始，TeX 354 MB 依赖下载约 73 秒，下载与安装步骤 128.1 秒，Judge 安装步骤 71.1 秒；这是本机网络和硬件结果，不是云端 ETA。导出 dpkg 清单核对 TeX 10 项、Judge 7 项固定版本全部一致；报告与清单 `.local/caddy-pm2/download-build-evidence/`。Compose config 与部署只读 plan 通过。

**未验证与环境：**未重新运行作者 TeX、判题或业务集成；没有运行新应用实例、打开监听端口、切换本机原数据库/镜像或重启原 5180/3100（仍为 Vite 69040、API 65472）。云端停止、遗留进程、重新下载速度和完整部署结果均待用户执行；本轮没有云主机访问权限。按已有 GitHub 交付授权提交推送修正，保留原密钥与站点配置。

## 云端 PostgreSQL P1001 与宿主机端口映射恢复（2026-10-05）

**云端证据与用户约束：**用户在 Ubuntu 云服务器迁移时遇到 Prisma P1001，目标为 127.0.0.1:25432。用户返回的日志确认 PostgreSQL 16.13 已在容器内监听 5432 并接受连接，HostConfig.PortBindings 为 127.0.0.1:25432 → 5432，但 NetworkSettings.Ports 为 null；随后四个 problemforge-cloud 容器均运行，PG/Redis healthy，全部仅显示内部端口。PM2 部署 Compose 错误地只连接 internal backend，容器内健康检查未覆盖宿主机访问。用户说明原 PostgreSQL 用 5432，服务器有很多服务，要求每次先观察端口及服务归属，禁止随意变更已有服务；已补入 AGENTS。再次索取只读 ss 与容器信息，用户回复中没有 ss 输出，因此没有据此宣称预定端口为空闲。

**实现：**仅 PM2 部署的四个基础服务增加独立 host-access bridge，所有发布地址仍显式为 127.0.0.1，backend 保留 internal；作者执行的 go-judge 网络命名空间、挂载和命令不改。PostgreSQL 容器健康检查改用 TCP，避免临时初始化 Unix socket 提前通过。每次安装/恢复开始和启动基础设施前读取 ss、Docker 发布端口元数据及本项目 PM2 PID；非本站容器、非预期映射、未知监听或其他地址占用都会停止，既不自动换端口，也不终止占用进程。迁移前检查 Docker 实际映射，再以真实 problemforge UID 检查四个回环端口，失败时不新写迁移开始标记。

新增 `node scripts/cloud-deploy.mjs resume-network`，用于此次已有 pending 的恢复：从 pending 读取原 /opt/problemforge/releases/<buildId>，验证不可变源码哈希及准备标记，检查运行容器和同版本镜像 ID 后直接复用。不给原包打补丁、不生成新版、不执行 Compose up/build、容器重建或删除数据卷；只为本项目四个运行容器创建/连接有明确归属的 host-access 网络。随后重新核验实际映射与应用用户连接，调用原包的迁移和启动流程。重试可复用已连接网络，其他项目或选项异常的同名网络拒绝接管。原 pending、密钥与备份保留，只有完整部署成功才按原规则清除 pending。说明文件区分“拉取恢复工具”与“切换应用版本”，提供云端 root 可直接执行的命令。

**实际验证：**Node 语法、Windows 21 项部署/网络定向检查、Linux 23 项部署/网络/命令执行检查通过；覆盖原有 5432 保留、目标端口冲突/未知监听拒绝、其他容器及网络拒绝、仅四个容器连接与幂等、发布为 null 拒绝、原版本路径校验、迁移前失败顺序、TCP 错误脱敏。Linux 中执行真实恢复 CLI，以明确标注的 Docker/宿主机 TCP 命令替身模拟云端状态，在原版本迁移入口主动停止：确认选中原包、源码与密钥未变、无 Compose up/build、pending 保留、锁释放、Caddy 原文不变，没有启动监听或业务数据库。证据 `.local/caddy-pm2/network-recovery-evidence/verification.json`（dockerCommandsMocked/hostTcpMocked=true）。Compose config 核对两类网络、四个回环映射与 PG TCP 健康检查，通过；11 个指南 Bash 块仅做 bash -n。首轮 Linux 夹具因 .local 被 Docker 上下文忽略失败，补专用允许清单；随后原进程退出检查遇到 /proc 读取竞态 ESRCH，将其与 ENOENT 同样视为已退出，最终通过，未修改命令执行器。

**未验证与收尾：**尚未在用户云端执行恢复、实际网络连接、迁移、Caddy 合并或 HTTPS；本轮没有云服务器访问凭据，不能把命令替身检查称为实机部署。未执行真实作者 TeX/Judge、全量/E2E、生产依赖更新或本机业务数据库操作。原主目录 5180/3100 服务与数据库保留，无新增业务实例/端口。按既有公开 GitHub 交付授权提交并推送供用户拉取；云端命令自身再次检查实际端口占用，若冲突会停在修改本站服务之前。
