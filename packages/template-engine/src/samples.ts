// Trusted preamble for platform-bound samples. Measure the literal files with
// the template's verbatim font and column widths; never parse sample bytes as TeX.
export const SAMPLE_LAYOUT_PREAMBLE = String.raw`\RequirePackage{fvextra}
\AddToHook{class/after}{\RequirePackage{longtable}}
\makeatletter
\newif\ifpfsamplewide
\newdimen\pf@samplelimit
\newcommand{\pf@measuresample}[2]{%
  \begingroup%
  \pf@samplelimit=#2\relax%
  \let\do\@makeother\dospecials%
  \verbatim@font\frenchspacing\@vobeyspaces%
  \def\verbatim@processline{%
    \setbox\tw@\hbox{\the\verbatim@line}%
    \ifdim\wd\tw@>\pf@samplelimit\global\pfsamplewidetrue\fi%
  }%
  \verbatim@readfile{#1}%
  \endgroup%
}
\newcommand{\pf@widesampleblock}[1]{%
  \begin{minipage}[t]{\exmpwidewid}%
  \rightskip=0pt plus 1fill\relax%
  \VerbatimInput[breaklines=true,breakanywhere=true,breakautoindent=false,breakindent=0pt,breaksymbolleft={},breaksymbolright={},breakanywheresymbolpre={},breakanywheresymbolpost={},commandchars=none,commentchar=none,listparameters={\topsep=0pt\partopsep=0pt}]{#1}%
  \medskip\end{minipage}%
}
\newcommand{\pf@samplerow}[2]{%
  \begin{minipage}[t]{\exmpwidinf}%
  \rightskip=0pt plus 1fill\relax\verbatiminput{#1}%
  \medskip\end{minipage}&%
  \begin{minipage}[t]{\exmpwidouf}%
  \rightskip=0pt plus 1fill\relax\verbatiminput{#2}%
  \medskip\end{minipage}\\\hline%
}
\newcommand{\pf@flushsamples}{%
  \ifx\pf@samplerows\@empty\else%
    \par\begingroup\ttfamily\frenchspacing%
    \LTleft=\fill\LTright=\fill\LTpre=0pt\LTpost=0pt%
    % One header per table, repeated only when the table continues on a new page.
    \begin{longtable}{|l|l|}%
    \hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{\InputFileName}}&%
    \multicolumn{1}{|c|}{\bfseries\texttt{\OutputFileName}}\\\hline%
    \endhead%
    \pf@samplerows%
    \end{longtable}%
    \endgroup\par\medskip%
    \let\pf@samplerows\@empty%
  \fi%
}
\newenvironment{pfsamples}{%
  \par%
  % Template geometry may change after olymp initializes its sample widths.
  \pf@samplelimit=\dimexpr\linewidth-2\tabcolsep-2\arrayrulewidth\relax%
  \ifdim\exmpwidewid>\pf@samplelimit\exmpwidewid=\pf@samplelimit\fi%
  \ifdim\dimexpr\exmpwidinf+\exmpwidouf+4\tabcolsep+3\arrayrulewidth\relax>\linewidth%
    \pf@samplelimit=\dimexpr(\linewidth-4\tabcolsep-3\arrayrulewidth)/2\relax%
    \ifdim\exmpwidinf>\pf@samplelimit\exmpwidinf=\pf@samplelimit\fi%
    \ifdim\exmpwidouf>\pf@samplelimit\exmpwidouf=\pf@samplelimit\fi%
  \fi%
  \centering%
  \let\pf@samplerows\@empty%
}{%
  \pf@flushsamples\par%
}
\newcommand{\pfsamplepair}[2]{%
  \global\pfsamplewidefalse%
  \pf@measuresample{#1}{\exmpwidinf}%
  \pf@measuresample{#2}{\exmpwidouf}%
  \ifpfsamplewide%
    \pf@flushsamples%
    \par\noindent\begingroup\ttfamily\frenchspacing%
    \begin{tabular}{|c|}%
    \hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{\InputFileName}}\\\hline%
    \pf@widesampleblock{#1}\\\hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{\OutputFileName}}\\\hline%
    \pf@widesampleblock{#2}\\\hline%
    \end{tabular}%
    \par\endgroup\medskip%
  \else%
    % Collect consecutive narrow pairs before opening the shared table.
    \edef\pf@samplerows{\unexpanded\expandafter{\pf@samplerows}\noexpand\pf@samplerow{#1}{#2}}%
  \fi%
}
\newcommand{\pfcommsample}[4]{%
  \pf@flushsamples%
  \global\pfsamplewidefalse%
  \pf@measuresample{#1}{\exmpwidinf}%
  \pf@measuresample{#2}{\exmpwidouf}%
  \pf@measuresample{#3}{\exmpwidinf}%
  \pf@measuresample{#4}{\exmpwidouf}%
  \ifpfsamplewide%
    \par\noindent\begingroup\ttfamily\frenchspacing%
    \begin{tabular}{|c|}%
    \hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{first: \InputFileName}}\\\hline%
    \pf@widesampleblock{#1}\\\hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{first: \OutputFileName}}\\\hline%
    \pf@widesampleblock{#2}\\\hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{second: \InputFileName}}\\\hline%
    \pf@widesampleblock{#3}\\\hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{second: \OutputFileName}}\\\hline%
    \pf@widesampleblock{#4}\\\hline%
    \end{tabular}%
    \par\endgroup\medskip%
  \else%
    \par\noindent\begingroup\ttfamily\frenchspacing%
    \begin{tabular}{|l|l|}%
    \hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{first: \InputFileName}}&%
    \multicolumn{1}{|c|}{\bfseries\texttt{first: \OutputFileName}}\\\hline%
    \pf@samplerow{#1}{#2}%
    \multicolumn{1}{|c|}{\bfseries\texttt{second: \InputFileName}}&%
    \multicolumn{1}{|c|}{\bfseries\texttt{second: \OutputFileName}}\\\hline%
    \pf@samplerow{#3}{#4}%
    \end{tabular}%
    \par\endgroup\medskip%
  \fi%
}
\makeatother
`;

export function renderSamplePairs(samples: { inputPath: string; answerPath: string; firstOutputPath?: string; secondInputPath?: string }[]) {
  return '\\Examples\n\\begin{pfsamples}\n' + samples.map(s => (
    s.firstOutputPath && s.secondInputPath
      ? `\\pfcommsample{${s.inputPath}}{${s.firstOutputPath}}{${s.secondInputPath}}{${s.answerPath}}`
      : `\\pfsamplepair{${s.inputPath}}{${s.answerPath}}`
  )).join('\n') + '\n\\end{pfsamples}\n';
}
