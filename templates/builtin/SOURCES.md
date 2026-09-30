# 管理员模板来源

- STATEMENT：用户提供 `比赛题面模板示例.zip`（SHA-256 `35d0673b4ca5b335733665dc559e3f26ef3cd48f23ba1ae0bfd51aa8cba734e3`）。压缩包的 `main.pdf` 与源码年份和比赛不同；用户明确指定 **main.tex 源码版**。源码导言提取为 `preamble.tex`，保留 11pt、`fontset=overleaf`、完整宏包、双行页眉、页脚、原始边距、段间距和行距。`olymp.sty`、`ctex-fontset-overleaf.def`、`1.tex` 主办方页及六张引用图片原样复制。`0.tex` 保留封面排版，仅将标题、场次、日期、题目表换成受控插槽；`booklet.tex` 保留封面→主办方→页码重置→题目的顺序。单题入口使用同一导言与 `problem` 环境，正文用原有 `InputFile` / `OutputFile` / `Examples` / `exmp` / `Note` 语法。默认 `style.tex` 不覆盖原样式，管理员主动改配置才生成覆盖。`publication.json` 的原比赛信息仅作这套参考模板的出版预览默认值，比赛业务配置及多题组装仍属 P4。
- EDITORIAL_BEAMER：[CWNU-Beamer-Template](https://github.com/CWNU-Open-Source-Community/CWNU-Beamer-Template)，提交 `8e34d438e740d70264bb65ed4dea79e9eaca8f45`。保留 4:3、红色主题、题目/页面导航、标题块、页脚和 cwnublock。仅将 Windows / macOS 字体探测改为 Linux 镜像内预装 Noto 字体，入口与内容插槽由平台生成。
- EDITORIAL_DOCUMENT：独立 CTeX 书面题解外壳，正文独立保存，不由 Beamer 转换。

olymp.sty 的源文件保留作者与 [上游许可证](https://github.com/GassaFM/olymp.sty/blob/master/LICENSE) 注记。原始参考保存在 Git 忽略的 `.local/references/`，不执行其中脚本或自带编译命令。平台只使用固定的隔离编译 profile。管理员可编辑和发布版本，普通用户只能选择具体已发布版本。
