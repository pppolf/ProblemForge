# 开发进度

2026-09-30：P0 工程与登录、P1 单题出版主链路已实现并实际验证；当前仍是开发版，P2—P5 尚未完成。

## 已实现

- pnpm workspace / 固定版本与 lockfile；Fastify 模块化 API；Vue / Naive UI 工作台；Monaco、PDF.js。PostgreSQL / Prisma 两个实际部署迁移，独立 Redis / BullMQ 调度，私有持久文件存储及适配器接口。
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

## 未实现、未验证及环境情况

P2 程序/生成器/数据/Validator/Checker/答案/验收矩阵与失效；P3 对拍/交互/分组评分；P4 修订审核/协作/比赛冻结/整场资料/题目包/每类第二套模板；P5 正式 Linux 应用镜像、完整 Compose、CI、配额强化、生产部署及备份恢复。完整清单保留在 PLAN，不将后续阶段写成已完成。

没有执行 Judge 判题集成、全部 E2E、压力/模糊测试、全部模板语言字体组合、生产部署或备份恢复；因此不宣称这些通过。testlib 仅核对并准备官方参考，尚未接入 Judge Worker。当前 Linux TeX 环境已可用；早先官方镜像下载缓慢及 Debian 镜像 HTTP 502 通过有签名的配置镜像源解决，qtree 缺包也已解决。

下一步按 P2 实现程序管理、独立 Judge Worker 和小样题的校验/Checker/验收链路；验收只覆盖新增主链路与关键失败路径。
