# 程序、数据与验收

P2 支持普通批处理题与自定义 SPJ；P3 增加对拍、真实交互、数据组和依赖 DAG、ACM / 部分分验收。三种维度独立配置，交互题也可以使用 Checker 和部分分。

## 固定执行边界

API 只保存数据、鉴权和提交不可变任务。独立 Judge Worker 调用独立 Linux go-judge v1.8.5，编译与运行作者程序均不使用宿主机进程。沙箱不可用明确失败。默认 Judge 与 TeX 使用不同服务、令牌及端口（15051 / 15050）；执行环境不挂载业务存储、数据库凭据或 Docker socket。

镜像和请求协议在 `infra/judge-sandbox.Dockerfile`、`infra/judge-mount.yaml` 固定。工具链为 Debian 12 / GCC 12.2.0 / Python 3.11.2；具体 Debian 修订记录在 Dockerfile 与 `JUDGE_TOOLCHAIN`，镜像内另存包清单。固定 testlib 0.9.41 的提交、头文件哈希、许可与官方来源见 [vendor/testlib/SOURCE.md](../vendor/testlib/SOURCE.md)。不从作者请求执行 Shell 编译命令。

管理员独占编译 profile 维护。配置仅包含语言 C++17 / C++20 / Python 3、O0 / O2、警告、编译 CPU 与内存限制；程序和任务固定具体 profile 版本与哈希。testlib 工具角色使用 C++ profile。Python 先在沙箱内做语法编译，运行使用隔离解释器参数。

## 程序与数据版本

程序保存名称、角色、源码、预期判定、备注和启用状态。保存使用 `expectedVersion`，产生不可变 ProgramRevision；冲突返回 409。正确解与主标程声明 AC，预期超时解声明 TLE，错误解声明非 AC 的预期。CE、工具崩溃和基础设施故障不能算作成功击败错误解。

手工、文件上传和 ZIP 导入都保留原始输入/答案字节与 SHA-256，不 trim、不转换换行。测试数据保存编号、分组标签、样例标记、启用、备注及来源，每次更新产生新 TestCaseRevision。重复输入提示并保留。原 `groupName` 仍为整理标签；使用计分时需显式保存下述数据组配置，不自动将旧标签当作分数。

单个输入/答案最多 1 MiB。ZIP 使用 `[tests/]编号.in` 与可选 `编号.ans`，最多 100 组、250 个成员、8 MB 压缩输入及 16 MB 实际展开内容；流式读取，不在宿主机解压。拒绝路径穿越、反斜杠/绝对路径、链接、加密、重复成员或编号、未知成员、孤立答案与超限。编号冲突时整批数据库导入失败，不静默覆盖。

生成计划支持「逐行命令」与旧的「固定参数、种子递增」。逐行文本每行格式为 `生成器名称 参数… 整数种子`，按本题程序名称解析为程序 ID、argv 和 seed 的结构化数组；同一计划可使用不同生成器，数量固定等于行数。空行忽略，支持引号和转义，拒绝未知/重名生成器、未闭合引号、管道/重定向等 Shell 表达式。固定参数模式继续使用 JSON 字符串数组 argv、起始种子和数量，种子逐次加一。两种模式均将各组种子作为最后一个 argv 及 `PF_SEED` 传入，不解释 Shell。

计划保存 CAS 与不可变版本；逐行数组随计划/题目修订及任务保存，原生 FULL 题包保留，复制/导入会重映射每行引用的生成器。API 校验每一行的程序属于本题且角色为 GENERATOR，任务固定所有引用程序的源码/profile、计划版本、实际 argv/seed、输出字节与哈希；每个计划的第一组重复执行一次检查确定性。含逐行命令的任务使用独立策略标识，旧 Worker 会拒绝该任务，避免按旧的首行参数重复执行；原固定参数任务的策略和依赖哈希不变。正式数据仍需显式收集，收集后停用对应计划以避免再次生成同编号输入。

题面选择具体的已标记样例且含答案的数据版本，正文不另存一份输入/输出。构建按哈希复制原始样例文件，由管理员模板的可信样例插槽读取；作者正文仍不能读取文件。供题面显示的样例限定为不含危险控制字符的 UTF-8、每段最多 64 KiB。测试数据更新后既有绑定保持旧版本，升级需要显式重新选择。

## 比较和 testlib 协议

| 模式 | 语义 |
| --- | --- |
| EXACT | 全部原始字节相同才 AC，包括空格、换行与末尾内容。 |
| TOKENS | 只按 ASCII 空格、TAB、LF、CR、VT、FF 分 token，逐 token 比较字节；多余 token 拒绝。 |
| FLOAT | 分 token 方式相同；有限数值满足绝对误差或 `relativeTolerance × abs(答案值)`，非数值 token 必须完全相同；NaN、Infinity、数值溢出和多余 token 拒绝。 |
| CUSTOM | 在 Linux 沙箱执行本题 Checker，固定参数顺序为输入、待检输出、标准答案。多解合法性由 Checker 判定。 |

Checker 正常退出 0 / 1 / 2 或 4 对应 AC / WA / PE。testlib `_fail=3`、异常退出、信号和工具资源超限属于 TOOL_ERROR。Validator 退出 0 接受、testlib validation 模式正常退出 3 拒绝；崩溃、其他状态与基础设施错误分别归因。严格行格式 Checker 样板保留在 `fixtures/judge/strict-lines-checker.cpp`：每行整数及行末空白可接受，同一行放全部整数拒绝。

标准 I/O 与工作目录文件 I/O 独立配置。文件名必须是安全的单个名称，输入与输出不同且不能覆盖执行器保留文件。判题读取所选 `outputFile`，stdout/stderr 分别保留；缺少输出文件属于程序 RE。报告可独立下载判题输出、stdout、stderr。

## 任务与失效

可分别提交编译、生成输入、校验、生成答案、工具自测、完整验收。完整链路为固定快照 → 编译 → 收集/生成输入 → 主 Validator / 全局额外 Validator / 适用组级额外 Validator → 主标程答案 → 保存的工具自测 → 解法执行与 Checker → 解法 × 数据矩阵及预期检查。自测允许指定已停用工具，普通验收不会隐式启用它。

请求键按用户作用域幂等；数据库是任务清单，队列入队失败后台补投。每用户最多三个排队/运行 Judge 任务。默认总预算 300 秒，显式范围 1–600 秒。取消终止 go-judge 的真实运行，保留已有记录；重试失败/取消任务创建新任务并复用旧输入快照，不覆盖旧报告。Worker 失联重新投递时将中断尝试标为失败，需显式重试。P5 仍需完整失联恢复、缓存、配额、SSE 与生产恢复验证。

状态 SUCCEEDED 表示该任务执行完成；`accepted=false` 表示解法/预期验收未通过，不伪装成成功验收。每次真实进程执行保存 Invocation，包括源码版本、阶段、沙箱状态、退出码、CPU/墙钟/内存和有界输出。内置字节比较不伪造一条沙箱执行记录。工具故障使任务明确失败，不改写为选手 WA。

依赖哈希按任务目的选择：正文/模板编辑不使 Judge 报告失效；Checker 影响答案和判定，不使独立输入校验过期；主标程影响答案/验收；生成器、计划、输入、Validator、运行限制及相关自测影响各自依赖。页面区分历史成功与当前有效。过期生成/答案任务不能直接收集数据；有效任务的显式收集产生新的正式数据版本，因此需重新验收新的数据版本。

源码、数据、任务、日志、历史版本和下载始终按当前题目权限鉴权，撤销权限即时生效。结果不自动公开发布。

## 定向验证入口

`pnpm test:quick judge` 只检查比较语义、故障/预期归因与受限 ZIP，默认 test 仍是固定的模板/存储轻量检查。`pnpm verify:sandbox --judge` 独立检查真实 Linux Judge 隔离。`pnpm verify:p2` 需要 API、DB、Redis 和 Judge Worker，会创建普通题、多解 SPJ 与严格行格式代表题，执行真实编译和判题。

`node --import tsx --test scripts/generator-plans.test.ts` 是逐行生成计划的单独纯数据检查，覆盖命令解析/还原、旧参数语义、命令边界和原生包/程序 ID 映射，不连接数据库或执行作者程序，不加入默认快查。

`pnpm verify:p2:results` 使用前一步生成的私有本地验证凭据；另外需要 TeX Worker 和已实际预览并发布的中文题面模板。它创建取消/文件 I/O 验证题、显式收集样例答案、构建真实样例 PDF，并确认样例版本绑定。两个验证入口均不会混入默认测试。实际已执行的范围与未验证内容见 [PROGRESS.md](PROGRESS.md)。

## P3 对拍与反例

每题的 StressConfig 使用版本与 CAS（首次 expectedVersion=0），每次保存另存不可变修订。配置选择本题启用的生成器、两个不同的参考/被测解法、自定义 Checker 或当前内置比较器、argv、起始种子、1–200 次迭代、1–600 秒总预算以及首例停止/继续策略。总预算包括编译；配置本身与程序/profile、判题设置、主 Validator、全局及所选数据组的额外 Validator 固定到任务清单。

每轮实际执行生成 → 校验 → 参考解 → 参考输出自检 → 被测解 → Checker。CUSTOM 按所选 Checker 接受多解，不按字节代替。参考解、生成器、工具编译/执行失败，以及无效生成输入都使任务失败，不算反例；被测解 CE 也不算反例。正常进程退出后的 WA/PE 与选手 TLE/MLE/OLE/RE 才能形成反例。

报告保存 completedIterations、每轮实际种子/输入哈希/判定，并区分 COUNTEREXAMPLE_FOUND、ITERATION_LIMIT、BUDGET_EXHAUSTED、CANCELED、TOOL_ERROR、INFRA_ERROR。预算耗尽为 FAILED / TASK_BUDGET_EXCEEDED；用户取消为 CANCELED。继续策略下，即使后来取消或预算耗尽，已完成的反例仍保留。未发现反例不等于证明正确。

每条反例保留原始输入、参考答案、被测输出及相应 Invocation、参数和种子；完整源码、源码版本/hash、profile 配置/版本/hash 在不可变任务 input 中。被测 Invocation 的 verdict 是比较后的判定，原始沙箱状态和退出码另存。

复现创建 REPLAY 任务，优先使用已保存输入字节及原任务的程序/profile/Checker/Validator/运行限制。可附加重新生成确定性检查；不同结果只作警告，不能替换原输入。REPRODUCED / NOT_REPRODUCED 比较本次与原反例的最终判定；参考输出变化而不能通过保存答案/Checker 时明确失败。旧依赖的复现允许查看历史，但不冒充当前验收。

显式入库按当前题目编辑权限检查输入/答案 1 MiB 上限、编号冲突、重复输入与依赖有效性；重复输入需显式选择保留。完整反例可从取消/失败任务入库，不需要抹除后续失败。新建 TestCase 和 TestCaseRevision，来源保留 run/case/seed/argv/判定与快照哈希，使相关普通验收过期；不会自动覆盖已有正式数据。

## P3 真实交互协议

接口以固定 [go-judge v1.8.5 README](https://github.com/criyle/go-judge/blob/v1.8.5/README.md)、[stream 实现](https://github.com/criyle/go-judge/blob/v1.8.5/cmd/go-judge/stream/stream.go)、[二进制帧](https://github.com/criyle/go-judge/blob/v1.8.5/cmd/go-judge/ws_executor/stream.go) 和本仓库固定 testlib registerInteraction 源码核对。核对的 go-judge tag 对应 d20feda117956d0eb09ab5acf5d246babbe31c08。

一次 /stream 请求包含两个独立作者执行环境和一个受限的可信中继环境。pipeMapping 在 Linux 内连接选手 ↔ 中继 ↔ Interactor，正文通信不经业务进程转发。Interactor 内的可信监督程序等待作者子进程真实退出；私有控制 fd 不传给作者子进程，用于通知对端清理。控制流通过 /stream 返回，作者程序不在宿主机执行。监督程序和中继原始字节的组合 SHA-256 进入 interactionPolicy，改变策略后需新建任务。

只有 Interactor 环境得到 hidden-input 和 jury-answer；选手仅得到自己的程序及通信管道。双方工作目录、stderr 和工具文件相互隔离。固定 testlib argv 为 input-file、output-file、answer-file；tout 写入 interaction-output。

- DIRECT：Interactor 的有效 testlib 0 / 1 / 2、4 对应 AC / WA / PE。
- CHECKER：Interactor 先正常接受，再把 tout 的输出交当前内置比较器或自定义 Checker。主标程的 tout 提供参考答案，已上传答案存在时先比对。选手 stdout 通信与用于比较的 tout 分别保存。
- testlib _fail=3、工具崩溃和工具资源超限属于 TOOL_ERROR；沙箱或可信中继失败属于 INFRA_ERROR。双方 Invocation 保留真实沙箱状态、CPU、墙钟、内存、stderr，以及真实 Interactor 子进程退出控制记录。有效判错不会被平台清理对端的 SIGKILL 改成无关 RE。

双方分别限制 CPU、内存、进程及输出；另有限制总墙钟、通信空闲时间与有界记录。中继使用非阻塞管道和有限缓冲；输出达到上限会终止整组。EOF 正确关闭对向输入，但 EOF 本身不等于 Interactor 已判定；只有监督程序报告真实退出后才清理滞留对端。空闲超时记 TLE，并提示检查 flush、EOF 和协议等待；平台不能仅凭这一状态证明具体是哪个语句漏 flush。查询次数由 Interactor 自己实施，平台不统计 stdout 行数冒充查询协议。

通信记录是私有 JSONL：seq 为中继观察到的顺序，elapsedMs 为相对时间，direction 区分双方，DATA.base64 保存原始字节。到用户配置的字节上限（1–256 KiB）或 2048 个数据/事件步骤后停止记录 DATA，并写 TRUNCATED；继续执行不会无限增加记录。少量 EOF、退出和限制元数据在额度外保留，文件总量仍被固定上限约束。数据块边界不等于协议消息边界；记录可经当前题目权限下载。

取消经同一沙箱请求终止并回收整组，持久保存双方 Invocation 和已经写入的记录后才返回终态。默认限制为选手题目配置、Interactor 2 秒 CPU/256 MiB、总墙钟 10 秒、空闲 1 秒、记录 64 KiB；管理员固定的执行环境限制仍适用。监督程序开销计入 Interactor 沙箱资源。

## P3 数据组和计分

TestGroupConfig 与修订表保存整套分组的不可变版本。组标识在本题内唯一；成员明确固定 TestCase ID 与 Revision ID、正整数权重，组满分为 0–10000 的整数且合计不超过 10000。依赖只引用同配置内存在的组，拒绝自环、循环和重复成员。

配置非空时，成员必须恰好覆盖本题全部启用正式数据的当前版本，每条数据只能属于一个计分组。停用/更新数据后，原组成员版本不会偷偷更新；需在组编辑中显式重选或升级。生成计划的输出应先显式收集，再停用该生成计划并选择具体数据版本，之后才能用于分组验收。无数据组时 ACM 使用全部启用数据；PARTIAL 必须有非空组和正满分，不静默退回其他评分方式。已有 groupName 标签可通过“按现有标签建立草稿”显式映射，仍需填写分数和保存。

主 Validator 和 GLOBAL 额外 Validator 对全部输入执行；GROUPS 范围的额外 Validator 仅在配置了其 ID 的组执行。组级来源及具体程序/profile 版本进入任务快照；未绑定组的此类工具不会全局执行。对拍可显式选适用组，其额外 Validator 同样进入对拍快照；不以生成输入的文本标签猜测所属组。

| 评分规则 | 计算 |
| --- | --- |
| ACM | 声明正确的解法必须在全部必需数据 AC。组分仅供诊断，分数预期需显式使用 PARTIAL。 |
| ALL | 全部组成员 AC 才得到该组满分。 |
| WEIGHTED | 组满分 × AC 成员权重之和 / 全部成员权重之和。分母不会因失败数据而减少。 |
| 依赖 | 默认任一依赖未全过或被其自身依赖阻断时，本组最终分为零；保留本组原始分和阻断组。 |

统一使用千分之一分的整数固定点，WEIGHTED 每组向下取整到 0.001 分再求和，无浮点累计误差。报告逐组显示通过权重、原始分、依赖后分和总分。正确解与主标程必须全部 AC 并满分；其他解法可声明总分/指定组最终分的闭区间（同时满足），或继续声明 WA/TLE/RE 等判定。CE、SKIPPED、工具和基础设施故障不能命中分数预期。

已实测的例子：20 分 ALL 组全过，30 分 WEIGHTED 组通过一半权重，50 分 ALL 组虽全过但依赖 30 分组未全过，得到 20+15+0=35；若第一个组失败，后续依赖链全部阻断。分组成员、分数、依赖、Validator 适用范围或分数预期变化使相关报告过期。

## P3 定向验证

- pnpm test:quick p3：固定两个纯逻辑场景，检查整数计分、依赖环、CE 不能命中分数预期及交互故障归因。默认 test/test:quick 清单不变。
- pnpm verify:p3:stress：真实反例、按保存输入复现、显式入库、重复/CAS/未授权/过期拒绝、取消保留证据、后续任务执行、多解 Checker 和预算耗尽。
- pnpm verify:p3:interaction：正常双向通信、判错与对端清理、未 flush 空闲超时、EOF 后延迟判定、双方取消、隐藏输入隔离、有界私有记录，以及 Interactor 输出交 Checker。
- pnpm verify:p3:groups：20/30/50 的 100/35/0 分数、DAG 拒绝、组级 Validator 的范围与拒绝、配置变更过期。

三个真实入口均需要本项目 API、DB、Redis、Judge Worker 和 Linux 沙箱，以及 .local/verify-p2-fixture.json 中已创建的本地出题人；各入口创建自己的验证题，不依赖 TeX。浏览器操作和实际证据另见 PROGRESS。未声称已经运行全量组合、压力测试或 P5 生产恢复。
