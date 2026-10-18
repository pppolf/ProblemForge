import { escapeTex, type ContestRenderInput, type TemplateFiles } from './index.ts';

// All text here is metadata, never author-supplied TeX. Give very long Latin
// words break opportunities too; CJK already breaks naturally in ctexbeamer.
function flowingText(value: string) {
  return value.replace(/\s+/gu, ' ').split(/([A-Za-z0-9]{16,})/u).map(part =>
    /^[A-Za-z0-9]{16,}$/u.test(part) ? [...part].map(escapeTex).join('\\hspace{0pt}') : escapeTex(part),
  ).join('');
}

export const CONTEST_BEAMER_PREAMBLE = String.raw`
% Platform-owned sizing: the original theme and its colours remain in place.
\ifdefined\PFContestBeamerLoaded\else
\let\PFContestBeamerLoaded\relax
\newsavebox{\PFContestTitleBox}
\DeclareRobustCommand{\PFContestTitle}[1]{%
  \begingroup
  \sbox{\PFContestTitleBox}{\begin{minipage}{0.76\paperwidth}\centering\usebeamerfont{title}#1\par\end{minipage}}%
  \ifdim\dimexpr\ht\PFContestTitleBox+\dp\PFContestTitleBox\relax>1.6cm
    \resizebox*{!}{1.6cm}{\usebox{\PFContestTitleBox}}%
  \else\usebox{\PFContestTitleBox}\fi
  \endgroup
}
\pdfstringdefDisableCommands{\def\PFContestTitle#1{#1}\def\hspace#1{}}
% CWNU reveals its navigation bar only after the first section. Recalculate
% Beamer's reserved header height then, without replacing admin section hooks.
\makeatletter
\@ifundefined{cwnuProgressBarHeight}{}{\apptocmd{\beamer@section}{\beamer@calculateheadfoot}{}{}}
\makeatother
\fi
`;

// Adapt copies of the previously published built-ins. Their immutable stored
// bytes stay intact, and custom templates can place the explicit slots instead.
export function contestBeamerFiles(files: TemplateFiles, title: string): TemplateFiles {
  let booklet = files['booklet.tex'];
  const short = [...title].length > 24 ? [...title].slice(0, 24).join('') + '…' : title;
  booklet = booklet.replace(/\\title\s*\[([^\]]*)\]/g, (match, value: string) =>
    value.includes('{{CONTEST_TITLE}}') ? `\\title[{${value.replaceAll('{{CONTEST_TITLE}}', () => escapeTex(short))}}]` : match);
  booklet = booklet.replace(/\\title\s*\{\s*\{\{CONTEST_TITLE\}\}\s*\}/g,
    () => `\\title[{${escapeTex(short)}}]{ {{CONTEST_TITLE}} }`);
  if (!booklet.includes('{{DIFFICULTY_OVERVIEW}}')) {
    const oldContents = /\\begin\{frame\}\{讲解顺序\}\s*\\tableofcontents\s*\\end\{frame\}/;
    booklet = oldContents.test(booklet)
      ? booklet.replace(oldContents, '{{DIFFICULTY_OVERVIEW}}')
      : booklet.replace('{{CONTENTS}}', '{{DIFFICULTY_OVERVIEW}}\n{{CONTENTS}}');
  }
  if (!booklet.includes('{{BEAMER_INTRODUCTION}}')) booklet = booklet.replace('{{CONTENTS}}', '{{BEAMER_INTRODUCTION}}\n{{CONTENTS}}');
  let item = files['item.tex'];
  // Only the legacy template's dedicated author frame is removed. The author
  // controls their explanation body; we never strip frames from that body.
  item = item.replace(/\\begin\{frame\}\{\s*\{\{CODE\}\}\.\s*\{\{TITLE\}\}\s*\}\s*\\centering\s*\{\{AUTHOR\}\}\s*\\end\{frame\}/g, '');
  if (!item.includes('{{PROBLEM_OVERVIEW}}')) item = item.replace('{{BODY}}', '{{PROBLEM_OVERVIEW}}\n{{BODY}}');
  return { ...files, 'booklet.tex': booklet, 'item.tex': item };
}

export function contestBeamerTitle(title: string) {
  return `\\PFContestTitle{${flowingText(title)}}`;
}

export function difficultyOverview(entries: ContestRenderInput['entries']) {
  return String.raw`\begin{frame}[t,allowframebreaks]{题目难度预计}
\small
按讲解顺序排列，难度为赛前预计。\par
\begin{description}
` + entries.map(entry => `\\item[${escapeTex(entry.code)}] \\textbf{${flowingText(entry.expectedDifficulty?.trim() || '未设置')}}\\par ${flowingText(entry.metadata.title)}\n`).join('') + String.raw`\end{description}
\end{frame}`;
}

export function problemOverview(entry: ContestRenderInput['entries'][number]) {
  const tags = entry.tags?.filter(tag => tag.trim()) ?? [];
  return `\\begin{frame}[t,allowframebreaks]{${escapeTex(entry.code)}. 题目概览}
\\textbf{${flowingText(entry.metadata.title)}}\\par
\\medskip
预计难度：${flowingText(entry.expectedDifficulty?.trim() || '未设置')}\\par
\\medskip
\\textbf{题目标签}\\par
${tags.length ? tags.map(flowingText).join(' \\enspace / \\enspace ') : '暂无标签'}
\\end{frame}`;
}
