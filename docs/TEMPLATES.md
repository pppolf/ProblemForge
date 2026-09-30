# 模板与内容协议（P1，protocolVersion 1）

维护入口仅系统 ADMIN 可用；普通用户接口只接受稿件正文、启用状态、title / author 文本和具体 templateVersionId。严格字段白名单拒绝源码、导言、样式、字体、主题或编译命令字段。题目所有者不能取得管理员权限，也不能通过另一种稿件改变全局配置。

## 模板包

管理员上传 JSON 的 `files` 为相对文件名到字符串的映射：tex / sty / cls / def 为 UTF-8 文本，PNG / JPEG 为规范 Base64；支持中文相对图片名，禁止绝对路径、父目录、空路径段及符号链接。限 40 个文件、10MB，总图片单项限 1.5MB；图片字节验证类型，Worker 保留原字节后复制到任务沙箱。模板文件不以业务静态资源公开。

必含 manifest.yaml、metadata.schema.json、main.tex、preview.tex。manifest 声明类型 STATEMENT / EDITORIAL_DOCUMENT / EDITORIAL_BEAMER、语言列表、single / contest、固定入口与 `xelatex-2022-bookworm-v1`；本阶段含 zh-CN。声明 contest 时需 bookletEntry: booklet.tex。该能力声明目前支持题册样稿，正式多题出版在 P4 实现。

metadata.schema.json 为不执行代码的声明子集：type: object、additionalProperties: false，properties 仅 title / author 字符串，长度不超过 160。TeX 插槽仅 TITLE、AUTHOR、BODY、CONTEST_TITLE、CONTEST_STAGE、CONTEST_DATE_HEADER、CONTEST_DATE_COVER、PROBLEM_LIST。普通元信息转义后插入，BODY 固定生成 input{content.tex}，内容与入口分别保存。

题面 main.tex 通过 problem.tex 的 BODY 插槽容纳普通用户正文；booklet.tex 使用同一 preamble.tex 和 problem.tex。publication.json 仅含四项受限预览文字，比赛信息来自独立模型的正式快照接口将在 P4 增加。配置表单是管理员可选覆盖，未修改时保留上传源码；一旦覆盖也必须重新编译并发布新版本。

## 普通内容

`pf-content-3` 使用 unified-latex AST 检查宏、环境、分组及参数，限制深度和节点数。允许常见段落、列表、表格、数学语法；Beamer 增加 frame、block、columns 和受控覆盖命令。当前批准清单以 packages/template-engine/src/index.ts 为准，未批准语法返回具体位置与原因，不自动放开完整文档入口。

题面额外允许原 olymp 的 InputFile、OutputFile、Examples、exmp、Note 等宏及 example 环境。exmp 参数仍作为 TeX 遍历检查，不能借样例读取文件。verbatim / centerverbatim 为字面代码；原模板 listings 启用 escapeinside，故没有将 lstlisting 作为可跳过检查的字面环境开放。

图片仅通过本题私有资源的 assets/{id}.png 或 .jpg 引用。includegraphics 参数只允许有上限的 width / height 字面尺寸及 linewidth / textwidth 比例。未授权路径、宏生成路径、附加执行参数被拒绝。资产字节、哈希与存储键随内容构建固定。

禁止普通正文使用 documentclass、文档入口/导言、usepackage、定义/展开原语、主题/字体/全局布局修改、任意文件 I/O、TeX ^^ 字符预处理。语法限制不是执行隔离；作者内容和管理员模板均经 Linux namespace / cgroup / 有界文件和资源执行。

## 版本、验证、构建与发布

草稿保存通过 expectedVersion 比较，冲突返回 409。验证固定模板文件哈希、策略/profile、真实 go-judge 版本，模板样稿使用固定 latexmk -norc / XeLaTeX / no-shell-escape。成功要求真实 Accepted、退出码 0 与合法 PDF 产物；失败保存真实日志，绝不写空 PDF 或虚构通过。

生命周期为 DRAFT → VALIDATED → PUBLISHED；编辑使验证失效，发布后不可原地修改。管理员需预览匹配验证构建；归档停止新选择但保留旧绑定，撤回阻止新构建。管理员发布新版不重绑定已有题目或比赛。

三类 Document 各自保存 enabled、正文版本、templateVersionId、构建和 Publication。切换/停用不转换或覆盖另一稿件。Build 固定具体修订、模板、内容与文件哈希、私有资产及工具链标识；UI 对过期产物标注，发布事务拒绝过期版本。公开链接仅关联一个产物类型，撤回后返回 404，不返回其他类型、任务日志或私有资源。
