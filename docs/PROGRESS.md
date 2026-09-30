# 开发进度

2026-09-30：P0 工程与登录、P1 单题出版、P2 普通题与 SPJ 主链路已实现并实际验证。当前仍是开发版，P3—P5 未完成。以下 P0/P1 验证事实保留自前轮工作；本轮 P2 使用独立验证数据库，旧本地证据没有复制到本工作区。

## 已实现

- pnpm workspace / 固定版本与 lockfile；Fastify 模块化 API；Vue / Naive UI 工作台；Monaco、PDF.js。PostgreSQL / Prisma 四个实际部署迁移，独立 Redis / BullMQ 调度，私有持久文件存储及适配器接口。
- 管理员初始化、登录/会话/CSRF/限流/用户创建；按当前数据库权限鉴权题目、任务、日志、资源和产物。普通用户没有模板维护接口，目录也不返回模板源码和全局配置。
- 题目创建与按语言区分的三类独立稿件；不可变正文版本、启用开关、原子并发保存及 409 冲突、本地未保存编辑保护；私有 PNG/JPEG 资源与受限路径引用。
- 三类管理员模板包、递归模板资源、源码/配置编辑、JSON 上传、不可变发布、归档与撤回；发布要求匹配当前模板哈希的真实成功构建及预览确认。
- 真实独立 TeX Worker / Linux go-judge 1.8.5 / 固定 XeLaTeX+latexmk；内容 AST 子集和执行隔离分别检查，沙箱不可用时失败。数据库任务快照、队列补投、租约、取消/显式重试、真实编译日志、私有 PDF 与分类型发布/撤回。P5 仍需完善恢复和并发配额。

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

## 下一对话交接（2026-09-30，进入 P3）

- **工作目录与提交：**直接使用 `D:\project\ProblemForge`，当前分支 `master`。P2、样例表格修复和主目录规则已提交为 `550f0c8`；P3 详细步骤见 [PLAN.md](PLAN.md) 的 P3.0—P3.4。本轮按用户要求停在提交与计划，不提前实现 P3，也没有 push。
- **开始顺序：**先读 AGENTS、任务书第 7/8/10/12/13 节及本交接，再完成 P3.0 运行环境切换，然后实施对拍 → 交互 → 分组评分。现有源码有 INTERACTIVE/PARTIAL 契约字段，但 API 明确拒绝执行，Interactor 仅管理/编译；这些字段不代表 P3 已实现。EXTRA_VALIDATOR 在 P2 已可全局执行，P3 需补组级适用范围。
- **环境区别：**此前实际 P2 验证在 `C:\Users\Gaoming\.codex\worktrees\f054\ProblemForge`，数据库 `problemforge_f054`、Redis DB 1、该目录自己的私有存储。前端/API 为 5180/3100，PostgreSQL/Redis 为 15432/16379，TeX/Judge 沙箱为 15050/15051。当前开发进程尚未迁往主目录；新对话需重新核对存活进程、任务和配置，不能假定工具会话 ID 可跨对话复用。
- **本地证据：**P2 的 `.local/verify-p2.json`、`verify-p2-results.json`、`verify-p2-browser.json`、`verify-sample-border.json` 及 PDF/截图仍在上述 f054 目录；主目录只保留自己的 `.local/worktree-import-proof.json`。必要凭据在各自忽略的 `.local` / `.env` 中，核对目标环境后读取，不写入文档或提交。旧工作树含运行数据与证据，迁移核对完成前保留。
- **可用于接续的页面：**P2 验证题 `cmuo2ghni004wktkgjv9s4p1q`，路径 `/problems/cmuo2ghni004wktkgjv9s4p1q`；题面正文 v3 / 模板 v1 / 样例数据 v2，最新修复构建 `cmuo5c4im0002ktt0sxp20h3f`。该题正式数据已到 v3，但题面显式保留样例 v2，是已验证的版本行为。
- **本轮新增检查：**环境配置文件中仅 `.env.example` 纳入提交，本地凭据、产物、storage 与 node_modules 未入暂存区；自有代码的暂存差异空白检查通过。上游 testlib 原文件保留尾随空白，磁盘及暂存 blob 的 SHA-256 均与固定来源一致，未为消除提示而修改第三方字节。功能验证复用此前记录，本轮未在主目录重跑 Judge、TeX、E2E 或生产构建。

## 未实现、未验证及阻塞

P3 对拍/真实交互/分组评分与依赖 DAG；P4 修订审核/协作/比赛冻结/整场资料/题目包/每类第二套模板；P5 正式 Linux 应用镜像、完整 Compose、CI、SSE、缓存/配额/审计强化、失联恢复、生产部署和备份恢复。P2 已做的队列补投、预算/取消和有限基础配额不代表 P5 已完成。完整清单保留在 PLAN。

没有运行全部 E2E、压力/模糊测试、全部角色/资源超限/模板语言字体组合、生产构建/部署或备份恢复，不宣称这些通过。浮点比较做了定向语义快查，未开展所有语言的真实浮点题矩阵；预期超时解和暴力解角色已接入，未逐一跑全部组合。生成器不确定性提示、重试/失联恢复和配额耗尽尚未做全面故障注入。

当前 Linux Judge 与 TeX 环境可用，没有阻塞 P2 主链路的待办。下一阶段按 P3 接入有预算的对拍、反例复现与显式入库，再推进双向交互和分组计分；不省略 P4/P5 范围。
