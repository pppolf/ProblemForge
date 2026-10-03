// Trusted preamble for platform-bound samples. Measure the literal files with
// the template's verbatim font and column widths; never parse sample bytes as TeX.
export const SAMPLE_LAYOUT_PREAMBLE = String.raw`\RequirePackage{fvextra}
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
\newcommand{\pfsamplepair}[2]{%
  \par\begingroup%
  % Template geometry may change after olymp initializes its sample widths.
  \pf@samplelimit=\dimexpr\linewidth-2\tabcolsep-2\arrayrulewidth\relax%
  \ifdim\exmpwidewid>\pf@samplelimit\exmpwidewid=\pf@samplelimit\fi%
  \ifdim\dimexpr\exmpwidinf+\exmpwidouf+4\tabcolsep+3\arrayrulewidth\relax>\linewidth%
    \pf@samplelimit=\dimexpr(\linewidth-4\tabcolsep-3\arrayrulewidth)/2\relax%
    \ifdim\exmpwidinf>\pf@samplelimit\exmpwidinf=\pf@samplelimit\fi%
    \ifdim\exmpwidouf>\pf@samplelimit\exmpwidouf=\pf@samplelimit\fi%
  \fi%
  \global\pfsamplewidefalse%
  \pf@measuresample{#1}{\exmpwidinf}%
  \pf@measuresample{#2}{\exmpwidouf}%
  \centering\noindent%
  \ifpfsamplewide%
    \ttfamily\frenchspacing%
    \begin{tabular}{|c|}%
    \hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{\InputFileName}}\\\hline%
    \pf@widesampleblock{#1}\\\hline%
    \multicolumn{1}{|c|}{\bfseries\texttt{\OutputFileName}}\\\hline%
    \pf@widesampleblock{#2}\\\hline%
    \end{tabular}%
  \else%
    \begin{example}%
    \exmpfile{#1}{#2}%
    \end{example}%
  \fi%
  \par\endgroup\medskip%
}
\makeatother
`;

export function renderSamplePairs(samples: { inputPath: string; answerPath: string }[]) {
  return '\\Examples\n' + samples.map(s => `\\pfsamplepair{${s.inputPath}}{${s.answerPath}}`).join('\n') + '\n';
}
