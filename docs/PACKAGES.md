# 版本化题包与离线兼容协议（P4）

题包由独立 `packages/problem-format` 生成。原生/Polygon 单题包读取指定不可变修订；Hydro / NovaJudge 专用导出也可直接固定当前已保存内容。比赛默认由有编辑权限的成员固定源题最新已保存内容（要求匹配成功验收），也可显式选择历史冻结版本。API 读取快照及已固定的私有字节，不在导出时运行程序。题目按当前题目权限下载，比赛按当前比赛权限下载；撤销后历史下载也重新鉴权。正式发布由 OWNER 单独发起，发布事务锁住对象并核对当前选择、全部源题内容哈希、冻结版本和兼容报告。存在 `BLOCKED` 项不能正式发布。

## 用途白名单

每个用途从空清单建立，不先生成完整包再删文件。比赛总包包含 `contest.json` 和按题号命名的单题 ZIP；没有管理员模板源码、登录凭据、私有任务日志、成员或审批记录。

| 用途 | 内容 |
| --- | --- |
| STATEMENT | 启用题面、引用的固定样例与图片；无题解、私有正式数据、程序 |
| EDITORIAL_DOCUMENT / EDITORIAL_BEAMER | 仅对应启用稿件与引用图片 |
| DATA | 启用且参与判题的数据、答案、判题设置、分组和 Checker / Validator / Interactor；交互样例不参与，不含参考解 |
| REFERENCE | 启用主标程和正确解源码及有限 profile 元信息；无测试数据 |
| FULL | 当前修订中的元信息、三类稿件、程序、数据、样例历史、资源、计划、自测、分组、对拍设置和版本标识 |

DATA 及 Polygon FULL 可补入该冻结修订所绑定成功验收的输入/答案，包括固定的生成数据，报告记录来源任务 ID。不读取后来任务，也不覆盖正式数据。原生 FULL 保留工作副本的原答案状态（例如未收集答案仍为 null），便于真实往返；导入后重新执行验收。内部任务定位信息、权限、负责人账号和审核发布记录不迁移。撤回仅阻止新的平台下载，无法追回已下载副本。

交互题的样例只用于展示：DATA、Polygon FULL 的判题测试集和 Hydro / NovaJudge 导出的判题数据排除 `isSample` 数据，从历史验收补入数据时也排除样例。原生 FULL 仍完整保留样例与历史版本，STATEMENT、Hydro 的 statement.md 和 NovaJudge 的 problem.json.samples 保留题面绑定样例。普通批处理题继续包含启用样例。交互题分组只覆盖参与判题的数据；旧组引用交互样例时需显式更新后再导出或导入。

## ProblemForge 原生 v1

`problemforge.json` 顶层字段为 `format: problemforge`、`version: 1`、`purpose`、`manifest`。清单包含原对象 ID / 修订 ID / 版本；资源的 `key` 在包中改为相对路径 `blobs/{sha256}`，并带哈希与字节数。输入和答案始终是二进制文件，保留 NUL、非法 UTF-8、CRLF 与末尾空白。源程序记录语言、有限 profile 配置和哈希，普通包不能创建编译 profile 或提交 shell 命令。

原生包支持 C17、C++17 / C++20 / C++23、Java 17 和 Python 3 的程序及 profile 往返。导入必须匹配同语言的本地启用 profile；C / Java / Python 不能用作 testlib 工具，不因来自题包而放宽校验。

只有 FULL 可恢复为工作副本。API 先有界解析并校验结构、引用、源码/资源哈希、内容策略、分组 DAG 与本地 profile，再保存持久兼容报告和隔离原包。用户核对报告后提交其 `reportHash`；重复提交同一检查记录返回同一新题目。新题目归导入人私有，所有内部引用重映射，建立 DRAFT 聚合修订，不继承成功验收或审批。

模板仅引用模板 ID、版本号和哈希。匹配的本地 PUBLISHED 版本可以沿用；缺失或不匹配时保持未绑定并明确提示在工作区重选，不导入或覆盖系统模板。profile 先按语言与哈希匹配；跨实例不匹配时可提供原 profile ID → 本地启用 profile ID 映射，改变配置会记录警告并要求重新验收。无法安全转换的正文保持在隔离原包，新稿为空且停用。

导入记录可从“我的历史检查”重新打开；原包仅导入人可下载，禁止通过发布接口公开隔离包。

## Polygon 离线明确子集

入口是包根目录 `problem.xml`，只离线转换，不使用 Polygon API 上传或测试私有题。字段结构参考 [Polygon 官方工具自测说明](https://codeforces.com/blog/entry/7979) 与 [官方路径模式示例](https://codeforces.com/blog/entry/2676?locale=ru)。本仓库 `fixtures/polygon/sum` 是按这些字段自行编写并实际打包/导入的样包，**不是从外部 Polygon 导出的兼容认证样本**。

| 领域 | 本阶段映射与边界 |
| --- | --- |
| 题名、语言、题面 | names；en/ru/zh-CN 与标准语言代码；application/x-tex 正文。完整文档壳、HTML、PDF 或未批准 TeX 留在隔离包，人工转为作者正文 |
| 程序 | solutions 的 main / accepted / wrong-answer / time-limit-exceeded / slow；C++17、C++20、Python 3 源码。旧 cpp.g++ 明确提示本地 CPP17 选择；C17、C++23、Java 17 尚未建立 Polygon 映射，导出明确 BLOCKED，仍按 .c / .cpp / .java 保留源码，完整往返使用原生包；不执行预编译二进制 |
| 工具 | testlib Checker / Validator / Interactor 源码；无源码 std::wcmp.cpp 显式映射为 TOKENS；其他标准比较器需可用源码。交互模式和本地限制有警告，必须重新验收 |
| 数据 | 唯一名为 tests 的 testset，time-limit 毫秒、memory-limit 字节、文件 I/O、manual/generated、sample；一个 %d 或 %01d…%06d 的相对路径模式；保留原字节 |
| 生成计划 | 已匹配 executable，简单无引号命令词和参数，末尾整数种子。映射 argv + seed；计划初始停用以避免覆盖已有编号。shell、重定向、宏和非整数种子会阻塞 |
| 工具自测 | 官方 checker / validator testset 的输入、答案、选手输出和 verdict 映射；不把工具自测当成真实通过记录 |
| 分组 | complete-group、整数 points、依赖关系 → ALL 分组；each-test、逐测试 points、其他评分策略不能静默降级，阻塞导入 |
| 资源与外部脚本 | 有界且被正文引用的 PNG/JPEG 可重映射；styles、导言、构建脚本、binary/copy 及其余文件保留隔离并逐项报告，均不执行 |

导出保存 `problem.xml`、源码、输入/答案、正文附件及 `compatibility.json`。两类题解作为分别标明类型的附件，不冒充 Polygon 题面。原始 profile、PF_SEED 约定、额外 Validator 范围、WEIGHTED 计分、分数预期、工具自测导出、对拍以及交互资源/判定细节尚无完全等价转换，逐项报告；涉及判题的项标为 BLOCKED，包可私下下载处理但不可正式发布。被隔离/未映射的字段不会被声称为完整兼容。

实际验证包括自建 Polygon 样包的导入、Linux 真实程序验收和 Validator 自测、分组依赖、生成计划 argv/seed、样式隔离、导出 XML 解析。原生 FULL 的内部往返成功不代表外部 Polygon 导入成功；本阶段没有外部上传或兼容认证。

## Hydro 题目包 / NovaJudge 测试数据 ZIP

题目「题包与发布」顶部提供 Hydro 题目包和 NovaJudge 数据导出。`POST /api/problems/:id/test-data-exports` 接收 `target: HYDRO | NOVAJUDGE`，可选 `revisionId`、`language`；省略修订时以 RepeatableRead 固定当前已保存工作副本，报告记录快照哈希。无需冻结或验收，已有匹配成功验收时可补入其固定生成输入/答案；导出不执行作者程序，不修改题目或自动保存修订。未保存的页面编辑应先保存，固定修订则始终导出该版本。下载继续逐次检查当前题目权限，这两种专用导出不能通过公开发布接口发布。

Hydro 按用户指定的目录生成私有 `HYDRO_PROBLEM` 包，ZIP 与顶层目录使用「题目名称_YYYY-MM-DD_HH-mm-ss」（北京时间）。保留中文，文件系统禁用字符替换为下划线，标题最多保留 80 个 Unicode 字符；下载头使用 UTF-8 文件名。名称随产物固定，后续改题名或下载时不会重新命名。历史 `HYDRO_DATA` 下载仍保留旧结构，需重新生成才能获得新包。

```text
题目名称_导出时间/
  statement.md
  题解.md
  tests/
    编号.in
    编号.ans          # 普通题
    checker.cc       # 需要 Checker 时
    interactor.cc    # 交互题
    config.yaml
    testlib.h        # 自定义工具依赖
    testlib.LICENSE
  assets/            # 仅存在图片引用时
```

题面和**文档题解**按工作区当前语言导出；API 省略语言时优先启用的 zh-CN 题面，否则取首个启用题面的语言。不混入 Beamer。缺少/停用题面时拒绝导出；缺少/停用该语言的文档题解时，仍提供 `题解.md`，明确注明缺失并在报告提示，不用其他语言或 Beamer 代替。

Hydro 的 statement.md 不额外添加一级题名；开头为无标题的描述正文时补 `## 题目描述`（英文为 Description），已有小节标题保留。样例直接使用带语言标记的 `input1` / `output1` 代码块，多组依次为 input2/output2 等；不添加“样例”“样例输入”“样例输出”标题。手写 exmp 与绑定样例按最终展示顺序统一编号，绑定样例置于首个顶层 Note/Notes/Explanation/Explanations 前；存在样例时 Note/Notes 映射为 `## 样例解释`。通用代码块仍保留原类型，题解的标题格式不变。

LaTeX 转换复用固定 unified-latex 1.8.4 AST 解析器，转换标题、平台题面/交互小节、粗体/强调、嵌套列表、普通表格、代码、引用段落与图片。行内/独立数学保留 `$…$` / `$$…$$`，align/gather 转换为可嵌入的 aligned/gathered，平台 mat 展开为数学命令；正文中的代码及样例不按 LaTeX 转换。题面按绑定的**样例修订**和顺序写入输入/输出代码块，放在顶层 Note 前，保留空格与换行；交互样例同样可展示。引用图片核验哈希后放入 assets/ 并使用相对链接，不导出无引用图片。无法对应的命令/环境和合并单元格表格保留可见 LaTeX 代码并逐项警告，不静默删内容；不声称支持任意 TeX 宏和模板排版。转换全程不执行 TeX、作者代码或外部资源。

Hydro 数据放在顶层目录内的 tests/，NovaJudge 测试数据 ZIP 保持根目录，均按原编号命名：普通题导出 `1.in` / `1.ans`，包含全部启用正式数据及样例；交互题只导出启用的非样例 `*.in`，即使已保存答案也不读取或打包 `.ans`，不补空答案。Hydro 交互用例明确设 `output: /dev/null`，NovaJudge 测试数据 ZIP 的交互 cases 仅列 input；均不引用答案文件。判题数据不含停用数据和样例历史；包中不含参考解、生成器或 Validator。逐个导出文件核验原字节、大小和 SHA-256。普通题缺答案、编号冲突、缺少/同时启用多个所需工具时拒绝生成；只有展示样例而无隐藏测试时直接提示补充数据。NovaJudge 测试数据 ZIP 不含题面、题解或图片；完整题目包见下一节。

| 目标 | 配置与上传 |
| --- | --- |
| Hydro | `tests/config.yaml`，所有引用相对 tests/，time、memory 取题目限制。普通题 `checker_type: testlib`、`checker.cc` / `lang: cc`；交互题 `type: interactive`、`interactor.cc` / `lang: auto`，用例置于 `subtasks` 的 `score: 100`、`id: 1`、`type: sum` 组，每项显式 `output: /dev/null`。解压完整包后分别使用 Markdown，在目标题目的数据管理中上传 tests/ 内的文件或仅将其内容另打成 ZIP；本自定义完整目录不冒充 Hydro 原生一键导入协议。用户自定义工具需核对目标站 C++ 标准 |
| NovaJudge | 根目录 `problem.yml`，明确 cases、`type: spj` / `interactive` 及 `checker.cpp` / `interactor.cpp` 工具文件名。上传入口为目标题目的测试数据管理；上传数据不会更新题目时空限制，报告给出需填写的毫秒和 MiB |

Hydro 使用常规缩进 YAML，复用仓库固定的 yaml 序列化；NovaJudge 测试数据 ZIP 保留 YAML 兼容的 JSON 写法。Hydro 交互用例按实际编号升序放入上述单组，不写顶层 cases、不写入 `/dev/null` 占位文件；这不自动转换本地部分分组，原分组评分兼容阻塞仍保留。EXACT / TOKENS / FLOAT 自动生成 C++11 可编译、testlib 返回协议兼容的 Checker，按目标命名为 `.cc` 或 `.cpp`，维持原始字节、六种 ASCII 空白、尾随 token、有限数值与误差规则；因此旧 NovaJudge 数据导出中的普通比较也使用 SPJ。自定义 Checker / Interactor 保留当前版本源码，随包附固定 `testlib.h` 与原 MIT 许可证；两站可能使用自带 testlib，目标编译配置及头文件版本仍需核对。

分组权重/依赖评分、文件 I/O、交互结束后再 Checker 的流程尚不自动转换，报告标记 `BLOCKED`，包可下载用于人工调整；不声称可以直接投入判题。NovaJudge 当前只向 Interactor 传 input/output 两个路径，不传参考答案，读取 `ans` / `argv[3]` 的交互器需修改。独立交互限制和输出限制无法完全随配置还原，报告明确提示；NovaJudge 对非法 UTF-8 数据的转换标记阻塞，ZIP 本身保留原始字节。

格式依据公开官方源码核对：Hydro [`ProblemConfig`](https://github.com/hydro-dev/Hydro/blob/b1e7989894677765fe0c6f01ca2b62ca1f3e5967/packages/common/types.ts) 与 [判题工具编译](https://github.com/hydro-dev/Hydro/blob/b1e7989894677765fe0c6f01ca2b62ca1f3e5967/packages/hydrojudge/src/task.ts)；NovaJudge [配置归一化](https://github.com/CWNU-Open-Source-Community/NovaJudge/blob/95a461f1774a951538c080d37bd5a61a74206c93/lib/problem-judge-config.ts)、[测试数据上传](https://github.com/CWNU-Open-Source-Community/NovaJudge/blob/95a461f1774a951538c080d37bd5a61a74206c93/app/admin/problems/%5Bid%5D/data/actions.ts) 与 [判题流程](https://github.com/CWNU-Open-Source-Community/NovaJudge/blob/95a461f1774a951538c080d37bd5a61a74206c93/lib/judge.ts)。没有访问、部署或上传到用户现有 OJ；格式检查与独立沙箱判定对照不等于外部站点上线验收。

定向检查：`node --import tsx --test scripts/hydro-package.test.ts scripts/test-data-export.test.ts`；真实 API / 原库必定回滚：`node --import tsx scripts/verify-test-data-export.ts --rollback`，另显式添加 `--sandbox` 才做原 Linux 沙箱比较器对照。默认轻量快查不变。

## NovaJudge 完整题目包

题目「题包与发布」顶部新增 **NovaJudge 题目包**，对应 `POST /api/problems/:id/novajudge-exports`。请求可指定 `revisionId`、`language` 和 `comparison: NATIVE | PRESERVE`；默认当前已保存内容、优先中文和 NATIVE。复用上述快照、私有存储、权限、审计及验收答案补入流程，保存为 `NOVAJUDGE_PROBLEM` / FULL；无需先冻结，不执行作者代码、不发布公开链接。原 NovaJudge 测试数据 ZIP 入口、接口和历史产物保持原格式。

按用户提供的三份 NovaJudge 导出 ZIP 与官方导入实现核对，每包一题：

```text
problem_1_题目名称/
  problem.json
  data/
    1.in
    1.ans              # 仅批处理题
    problem.yml
    checker.cpp        # SPJ
    interactor.cpp     # 交互题
    testlib.h          # 使用作者工具时附带
    testlib.LICENSE
  assets/              # 仅包含题面引用图片
```

ZIP 显式写入目录成员，使官方导入器能够发现题目根目录。包名与顶层目录相同，中文标题经过有界路径清理。`problem.json` 包含 `id/title/type/defaultTimeLimit/defaultMemoryLimit/sections/samples/hint/judgeConfig`；`id: 1` 只是单包内的资源引用号，NovaJudge 导入时新建题目并分配题号。图片路径为 `/api/problems/1/assets/文件名`，由其导入器同时重写 sections 和 hint 内的题号；不携带本地地址、会话或私有存储路径。

题面按 LaTeX AST 转换，Description / InputFile / OutputFile / Interaction 对应 Problem Description / Input / Output / Interaction，顶层 section 形成分节，子标题留在内容中；Note / Notes / Explanation / Explanations 进入 hint。手写 exmp 与固定绑定样例进入 samples，不重复嵌入正文；保留原始空白、空输出、顺序和绑定版本，代码块里的标题不会被当成结构。公式与引用图片保留，未支持结构沿用 Markdown 转换报告。题解、参考解、生成器、Validator 和私有备注不进入该包。

| 平台判题配置 | NovaJudge 类型与文件 |
| --- | --- |
| 批处理 EXACT / TOKENS，NATIVE | `default`；只有输入、答案和 cases，不附 Checker。采用 NovaJudge 的换行归一、行末空格及全文首尾空白忽略规则；与本地判定不同，界面及报告明确提示 |
| 自定义 Checker 或 FLOAT；EXACT / TOKENS 选择 PRESERVE | `spj`；保留固定 Checker，或生成保留本地比较语义的 checker.cpp；judgeConfig 引用该文件 |
| 交互 | `interactive`；只导出启用隐藏输入及固定 interactor.cpp，每项显式 `output: /dev/null`；不读取隐藏答案，不创建空答案文件，展示样例仍在 samples |

`judgeConfig` 与 `data/problem.yml` 使用同一份对象，YAML 为常规缩进，仅含 cases 和适用的 checker/interactor；题型在 problem.json。时空限制直接写入 problem.json，单位 ms / MiB。文件 I/O、部分分、交互后置 Checker、非法 UTF-8 的既有阻塞和工具编译/交互协议/输出上限提示继续保留，不能忽略报告直接当作判题等价保证。

在 NovaJudge **管理后台 → 导入题目** 上传整个 ZIP。依据：[官方导出](https://github.com/CWNU-Open-Source-Community/NovaJudge/blob/95a461f1774a951538c080d37bd5a61a74206c93/app/api/problems/export/route.ts)、[官方导入](https://github.com/CWNU-Open-Source-Community/NovaJudge/blob/95a461f1774a951538c080d37bd5a61a74206c93/app/api/problems/import/route.ts)。定向检查：`node --import tsx --test scripts/novajudge-package.test.ts`；上述 `verify-test-data-export.ts --rollback` 同时检查完整题包的三种题型、语言、固定修订、历史下载和权限。实际外部站点上传及判题仍需用户验收；未访问或操作现有 OJ。

## 安全与大小限制

ZIP 压缩内容最多 24MB，解压总计 64MB、单项 8MB、成员 1500、压缩比最多 2000。逐流读取且检查实际解压字节，拒绝加密、链接、设备节点、重复路径/大小写别名、绝对路径、盘符、父目录、Windows 保留名。原生/Polygon 导入继续拒绝非 ASCII 路径；仅 Hydro / NovaJudge 中文题包导出和其验证显式启用 Unicode 路径，仍拒绝控制/双向字符、非 NFC 名称和不安全文件名。NovaJudge 显式目录也计入成员限制并拒绝路径冲突。解析不将归档路径解压到宿主机目录。

XML 用固定版本 saxes 6.0.0 解析，最多 1MB / 10000 节点 / 24 层 / 每节点 30 属性；拒绝 DTD、实体声明、处理指令和非 UTF-8，不解析网络或文件实体。未消费的节点和属性有明确报告，未知判题语义默认阻塞。图片仍受平台 PNG/JPEG 尺寸/类型限制。所有作者程序与 TeX 后续执行仍只进入独立 Linux 沙箱。

本阶段没有覆盖任意 Polygon 扩展、全部压缩算法/畸形文件组合、模糊测试、并发压力或外部 OJ 部署。其他 OJ 格式应实现新的 Exporter，而不在 API 中执行外部包脚本。
