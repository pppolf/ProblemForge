# 模板与内容协议（P1，protocolVersion 1）

维护入口仅系统 ADMIN 可用；普通用户接口只接受稿件正文、启用状态、title / author 文本和具体 templateVersionId。严格字段白名单拒绝源码、导言、样式、字体、主题或编译命令字段。题目所有者不能取得管理员权限，也不能通过另一种稿件改变全局配置。

## 模板包

管理员上传 JSON 的 `files` 为相对文件名到字符串的映射：tex / sty / cls / def 为 UTF-8 文本，PNG / JPEG 为规范 Base64；支持中文相对图片名，禁止绝对路径、父目录、空路径段及符号链接。限 40 个文件、10MB，总图片单项限 1.5MB；图片字节验证类型，Worker 保留原字节后复制到任务沙箱。模板文件不以业务静态资源公开。

必含 manifest.yaml、metadata.schema.json、main.tex、preview.tex。manifest 声明类型 STATEMENT / EDITORIAL_DOCUMENT / EDITORIAL_BEAMER、语言列表、single / contest、固定入口与 `xelatex-2022-bookworm-v1`。声明 contest 时需 bookletEntry: booklet.tex；P4 正式多题还要求 booklet.tex 的 CONTENTS 插槽与 item.tex 的 BODY 插槽。旧已发布模板可继续单题使用，补齐入口需新建管理员版本。

metadata.schema.json 为不执行代码的声明子集：type: object、additionalProperties: false，properties 仅 title / author 字符串，长度不超过 160。TeX 插槽含 TITLE、AUTHOR、BODY、CONTEST_TITLE、CONTEST_STAGE、CONTEST_DATE_HEADER、CONTEST_DATE_COVER、PROBLEM_LIST，以及 P4 的 CONTENTS、CODE、TIME_LIMIT、MEMORY_LIMIT、INPUT_FILE、OUTPUT_FILE。普通元信息转义后插入，BODY 为平台生成的 input，作者正文与入口分别保存。

题面 main.tex 通过 problem.tex 的 BODY 插槽容纳普通用户正文；多题 booklet.tex 使用同一导言与各题 item.tex。publication.json 仅含四项受限预览文字，正式比赛信息来自 ContestRevision。配置表单是管理员可选覆盖，未修改时保留上传源码；一旦覆盖也必须重新编译并发布新版本。

`pf-contest-2` 将每题源码、图片、样例和 label/ref/eqref/pageref 放进 p1、p2 等独立命名空间，字面代码保持原样。题面/文档题解按题册顺序，Beamer 按独立 lectureOrder，CODE 始终保留比赛题号。资源/样例文件由 Worker 校验固定字节与哈希后复制，不能拼接私有宿主路径。渲染版本进入任务输入哈希，旧版本重试不偷偷改用新组装器。

内置六套模板：CWNU 题面与简洁蓝色题面、经典/蓝色书面题解、CWNU 4:3 与宽屏 16:9 Beamer。P4 全部经真实沙箱编译及逐页预览；新套件仍只通过 ADMIN 新建草稿、验证、确认预览、发布的流程进入目录。

## 普通内容

`pf-content-4` 使用 unified-latex AST 检查宏、环境、分组及参数，限制深度和节点数。允许常见段落、列表、表格、数学语法；Beamer 增加 frame、block、columns 和受控覆盖命令。当前批准清单以 packages/template-engine/src/index.ts 为准，未批准语法返回具体位置与原因，不自动放开完整文档入口。

题面额外允许原 olymp 的 InputFile、OutputFile、Examples、exmp、Note 等宏及 example 环境。exmp 参数仍作为 TeX 遍历检查，不能借样例读取文件。verbatim / centerverbatim 为字面代码；原模板 listings 启用 escapeinside，故没有将 lstlisting 作为可跳过检查的字面环境开放。

交互题正文使用 `\Description`、`\interactor`、`\InteractionStart`、`\InteractionQuery`、`\InteractionAnswer`、`\InteractionNotes`、`\InteractionExample`，均为不带参数的题面章节命令；仅对 STATEMENT 开放。内置两套题面模板的 `headings.tex` 用原 olymp 的 `\createsection` 定义主章节，子章节使用左对齐的 `\subsection*`，兼容普通 `\section*` 标题。正文不能定义或重定义这些命令。原开发库从 CWNU v3 / 简洁蓝色 v2 开始支持，旧版本不会被原地补写。

两套题面单题入口设置 `\ShortProblemTitle`，只显示题名；比赛入口通过 item.tex 显式输出 `Problem {{CODE}}. {{TITLE}}`，目录使用同样的完整前缀，不依赖 olymp 自动递增题号，因此选定子集或调整顺序仍保留原 CODE。此格式从原库 CWNU v4 / 简洁蓝色 v3 开始。文档题解的 `headings.tex` 将题名及各级章节设为左对齐，同时保留字体、颜色和页边距。原题册封面和 Beamer 模板保持原样。发布版本与历史 PDF 不自动改变，使用者需选择新版并重新构建。

图片仅通过本题私有资源的 assets/{id}.png 或 .jpg 引用。includegraphics 参数只允许有上限的 width / height 字面尺寸及 linewidth / textwidth 比例。未授权路径、宏生成路径、附加执行参数被拒绝。资产字节、哈希与存储键随内容构建固定。

禁止普通正文使用 documentclass、文档入口/导言、usepackage、定义/展开原语、主题/字体/全局布局修改、任意文件 I/O、TeX ^^ 字符预处理。语法限制不是执行隔离；作者内容和管理员模板均经 Linux namespace / cgroup / 有界文件和资源执行。

## 版本、验证、构建与发布

模板中心可在目录名称旁「重命名」，名称去首尾空白、限 1—120 字符。名称属于整套模板的可编辑信息，已发布版本也可改名；不会改写版本文件、哈希、验证结果、现有绑定或历史 PDF / 冻结快照。接口 `PATCH /api/admin/templates/:id` 使用 `expectedName` 拒绝覆盖他人刚改过的名称。

选中具体版本后「复制为新模板」，输入名称即生成同类型、独立 ID 的 v1 草稿，完整保留该版本所有源码、图片与样式配置。来源可以是任一状态，但未保存的编辑需先保存；接口 `POST /api/admin/template-versions/:id/copy` 使用 `expectedVersion` 核对来源编辑版本，并在同一事务内读取文件/配置、创建模板及记录来源审计。副本不沿用原验证、发布状态、构建或题目绑定，须重新验证样稿、预览并发布。已有「复制为新版本」仍用于在同一套模板下继续迭代。

草稿保存通过 expectedVersion 比较，冲突返回 409。验证固定模板文件哈希、策略/profile、真实 go-judge 版本，模板样稿使用固定 latexmk -norc / XeLaTeX / no-shell-escape。成功要求真实 Accepted、退出码 0 与合法 PDF 产物；失败保存真实日志，绝不写空 PDF 或虚构通过。

生命周期为 DRAFT → VALIDATED → PUBLISHED；编辑使验证失效，发布后不可原地修改。管理员需预览匹配验证构建；归档停止新选择但保留旧绑定，撤回阻止新构建。管理员发布新版不重绑定已有题目或比赛。

三类 Document 各自保存 enabled、正文版本、templateVersionId、构建和 Publication。切换/停用不转换或覆盖另一稿件。Build 固定具体修订、模板、内容与文件哈希、私有资产及工具链标识；UI 对过期产物标注，发布事务拒绝过期版本。公开链接仅关联一个产物类型，撤回后返回 404，不返回其他类型、任务日志或私有资源。
