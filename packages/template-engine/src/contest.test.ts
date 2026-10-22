import{test}from'node:test';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';import{loadTemplateDirectory,renderContest,type ContestRenderInput}from'./index.ts';
test('booklet namespaces isolate equal labels, image names and samples without rewriting literal code',async()=>{
 const files=await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/statement-compact/',import.meta.url)));
 files['item.tex']=files['item.tex'].replace('{{{INPUT_FILE}}}{{{OUTPUT_FILE}}}{{{TIME_LIMIT}}}{{{MEMORY_LIMIT}}}', '{ {{INPUT_FILE}} }{ {{OUTPUT_FILE}} }{ {{TIME_LIMIT}} }{ {{MEMORY_LIMIT}} }');
 const original=structuredClone(files);
 const body='\\label{same}见\\ref{same}。\\includegraphics{assets/image.png}\n\\begin{verbatim}\n\\label{same} assets/image.png\n\\end{verbatim}\n\\Note\n样例说明。';
 const entry={body,metadata:{title:'A & B',author:'作者'},assetPaths:['assets/image.png'],samples:[{inputPath:'samples/sample-1.in',answerPath:'samples/sample-1.ans'}],timeLimitMs:2300,memoryLimitMb:512,inputFile:'input.txt',outputFile:'output.txt'};
 const context:ContestRenderInput={title:'比赛',author:'',stage:'',dateHeader:'',dateCover:'',entries:[{...entry,namespace:'p2',code:'C'},{...entry,namespace:'p1',code:'A'}]};
 const result=renderContest(files,'STATEMENT',context);assert(result['main.tex'].indexOf('p2/item.tex')<result['main.tex'].indexOf('p1/item.tex'));assert.match(result['p2/content.tex'],/\\label\{p2:same\}/);assert.match(result['p1/content.tex'],/\\ref\{p1:same\}/);assert.match(result['p2/content.tex'],/\\includegraphics\{p2\/assets\/image.png\}/);assert.match(result['p1/samples.tex'],/p1\/samples\/sample-1.in/);assert.match(result['p2/content.tex'],/verbatim\}\n\\label\{same\} assets\/image.png/);assert.match(result['p2/item.tex'],/Problem C\. A \\& B/);assert.match(result['p2/item.tex'],/2.3 s/);assert.match(result['p2/item.tex'],/512 MB/);
 assert.throws(()=>renderContest(files,'STATEMENT',{...context,entries:[context.entries[0],context.entries[0]]}));
 assert.match(result['p2/item.tex'],/\{input\.txt\}\{output\.txt\}\{2\.3 s\}\{512 MB\}/);assert.deepEqual(files,original);
 for(const namespace of ['p1','p2'])assert.match(result[`${namespace}/content.tex`],new RegExp(`\\\\input\\{${namespace}/samples\\.tex\\}\\n\\\\Note\\n样例说明。$`));
});

test('contest Beamer adds bounded cover, difficulty overview, introduction and frozen tags without author frames',async()=>{
 const context:ContestRenderInput={title:'含有 ] 和 & 的很长比赛标题'.repeat(5),author:'比赛组委会',stage:'',dateHeader:'',dateCover:'2026',beamerIntroduction:'\\begin{frame}{比赛总结}开场说明。\\end{frame}',entries:[
  {namespace:'p2',code:'B',body:'\\begin{frame}{解法}保留作者撰写的正文\\end{frame}',metadata:{title:'第二题',author:'不应单独展示的出题人'},expectedDifficulty:'提高 & 进阶',tags:['动态规划','C++_20','\\input{secret}'],assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'},
  {namespace:'p1',code:'A',body:'\\begin{frame}{思路}答案\\end{frame}',metadata:{title:'第一题',author:'另一位作者'},assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'},
 ]};
 for(const template of ['editorial-beamer','editorial-beamer-wide']){
  const files=await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${template}/`,import.meta.url)));
  for(const legacy of [false,true]){
   const input=structuredClone(files);
   if(legacy){input['booklet.tex']=input['booklet.tex'].replace('{{DIFFICULTY_OVERVIEW}}\n{{BEAMER_INTRODUCTION}}','\\begin{frame}{讲解顺序}\\tableofcontents\\end{frame}');input['item.tex']='\\section[{{CODE}}]{ {{CODE}}. {{TITLE}} }\n\\begin{frame}{ {{CODE}}. {{TITLE}} }\n\\centering {{AUTHOR}}\n\\end{frame}\n{{BODY}}';}
   const original=structuredClone(input),result=renderContest(input,'EDITORIAL_BEAMER',context);
   assert.deepEqual(input,original);
   assert.match(result['main.tex'],/\\title\[\{含有 \] 和 \\&/);
   assert.match(result['main.tex'],/\\PFContestTitle\{/);
   assert.match(result['pf-contest-beamer.tex'],/minipage.*0\.76\\paperwidth/);
   assert.match(result['pf-contest-beamer.tex'],/resizebox\*\{!\}\{1\.6cm\}/);
   assert(result['main.tex'].indexOf('题目难度预计')<result['main.tex'].indexOf('\\input{contest-introduction.tex}'));
   assert(result['main.tex'].indexOf('\\input{contest-introduction.tex}')<result['main.tex'].indexOf('\\input{p2/item.tex}'));
   assert(result['main.tex'].indexOf('\\item[B]')<result['main.tex'].indexOf('\\item[A]'));
   assert.equal(result['contest-introduction.tex'],context.beamerIntroduction);
   assert.match(result['p2/item.tex'],/提高 \\& 进阶/);
   assert.match(result['p2/item.tex'],/动态规划.*C\+\+\\_20.*\\textbackslash\{\}input\\\{secret\\\}/);
   assert.doesNotMatch(result['p2/item.tex'],/不应单独展示的出题人|\\centering/);
   assert.match(result['p1/item.tex'],/未设置/);assert.match(result['p1/item.tex'],/暂无标签/);
   assert.equal(result['p2/content.tex'],context.entries[0].body);
   assert.doesNotMatch(Object.values(result).join('\n'),/\{\{(?:BEAMER_INTRODUCTION|DIFFICULTY_OVERVIEW|PROBLEM_OVERVIEW)\}\}/);
  }
  const absent=renderContest(files,'EDITORIAL_BEAMER',{...context,beamerIntroduction:''});
  assert.equal(absent['contest-introduction.tex'],undefined);assert.doesNotMatch(absent['main.tex'],/input\{contest-introduction/);
  assert.throws(()=>renderContest(files,'EDITORIAL_BEAMER',{...context,beamerIntroduction:'\\input{secret}'}),/不在批准/);
  assert.throws(()=>renderContest(files,'EDITORIAL_BEAMER',{...context,beamerIntroduction:'\\includegraphics{assets/image.png}'}),/图片必须/);
 }
});

test('contest Beamer supports long unbroken metadata and paginated large overviews',async()=>{
 const files=await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/editorial-beamer/',import.meta.url)));
 const context:ContestRenderInput={title:'A'.repeat(160),author:'',stage:'',dateHeader:'',dateCover:'',entries:Array.from({length:100},(_,i)=>({namespace:`p${i+1}`,code:`A${i}`,body:'\\begin{frame}{解法}正文\\end{frame}',metadata:{title:'题目'.repeat(80),author:''},tags:Array.from({length:30},(_,j)=>`标签${j}`),expectedDifficulty:'D'.repeat(40),assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}))};
 const result=renderContest(files,'EDITORIAL_BEAMER',context);
 assert.match(result['main.tex'],/A\\hspace\{0pt\}A/);
 assert.match(result['main.tex'],/\\begin\{frame\}\[t,allowframebreaks\]\{题目难度预计\}/);
 assert.equal((result['main.tex'].match(/\\item\[A\d+\]/g)??[]).length,100);
 assert.match(result['p100/item.tex'],/标签29/);
});

test('contest introduction images use their own namespace and preserve literal examples',async()=>{
 const body=String.raw`\begin{frame}{AI 验题结果总览}
\centering
% \begin{verbatim} assets/image.png is only an example in this comment.
\includegraphics[width=1\linewidth,height=0.7\textheight,keepaspectratio]{assets/image.png}
\end{frame}
\begin{frame}{第二张图}
\includegraphics[width=0.8\linewidth]{assets/chart.jpg}
\includegraphics[height=2cm]{assets/image.png}
\end{frame}
\begin{frame}[fragile]{代码示例}
\begin{verbatim}
\includegraphics{assets/image.png}
\includegraphics{assets/notuploaded.png}
\end{verbatim}
\verb|assets/chart.jpg|
\end{frame}`;
 const input:ContestRenderInput={title:'比赛',author:'',stage:'',dateHeader:'',dateCover:'',beamerIntroduction:body,beamerIntroductionAssetPaths:['assets/image.png','assets/chart.jpg','assets/unused.png'],entries:[{namespace:'p1',code:'A',body:String.raw`\begin{frame}{解法}\includegraphics{assets/image.png}\end{frame}`,metadata:{title:'题目',author:''},assetPaths:['assets/image.png'],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}]};
 const original=structuredClone(input);
 for(const template of ['editorial-beamer','editorial-beamer-wide']){
  const files=await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${template}/`,import.meta.url)));
  const result=renderContest(files,'EDITORIAL_BEAMER',input);
  assert.equal(result['contest-introduction.tex'],body
   .replace('keepaspectratio]{assets/image.png}','keepaspectratio]{introduction/assets/image.png}')
   .replace('width=0.8\\linewidth]{assets/chart.jpg}','width=0.8\\linewidth]{introduction/assets/chart.jpg}')
   .replace('height=2cm]{assets/image.png}','height=2cm]{introduction/assets/image.png}'));
  assert.equal(result['p1/content.tex'],String.raw`\begin{frame}{解法}\includegraphics{p1/assets/image.png}\end{frame}`);
  assert.doesNotMatch(result['contest-introduction.tex'],/introduction\/introduction/);
  assert.doesNotMatch(Object.values(result).join('\n'),/assets\/unused\.png/);
  assert.deepEqual(input,original);
 }
});

test('contest introduction assets cannot borrow problem assets or bypass the local image allowlist',async()=>{
 const files=await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/editorial-beamer/',import.meta.url)));
 const input:ContestRenderInput={title:'比赛',author:'',stage:'',dateHeader:'',dateCover:'',entries:[{namespace:'p1',code:'A',body:String.raw`\begin{frame}{解法}\includegraphics{assets/image.png}\end{frame}`,metadata:{title:'题目',author:''},assetPaths:['assets/image.png'],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}]};
 for(const paths of [undefined,[],['assets/another.png']]){
  assert.throws(()=>renderContest(files,'EDITORIAL_BEAMER',{...input,beamerIntroduction:String.raw`\includegraphics{assets/image.png}`,beamerIntroductionAssetPaths:paths}),/图片必须/);
 }
 for(const path of ['../assets/image.png','/etc/passwd','https://example.com/image.png','introduction/assets/image.png','assets/../image.png','assets/image.svg']){
  assert.throws(()=>renderContest(files,'EDITORIAL_BEAMER',{...input,beamerIntroduction:`\\includegraphics{${path}}`,beamerIntroductionAssetPaths:[path]}),/图片必须/);
 }
 const legacy=renderContest(files,'EDITORIAL_BEAMER',{...input,beamerIntroduction:String.raw`\begin{frame}{总结}文字说明\end{frame}`});
 assert.equal(legacy['contest-introduction.tex'],String.raw`\begin{frame}{总结}文字说明\end{frame}`);
 assert.equal(renderContest(files,'EDITORIAL_BEAMER',input)['contest-introduction.tex'],undefined);
});

test('non-Beamer contest documents omit introduction text and images',async()=>{
 const input:ContestRenderInput={title:'比赛',author:'',stage:'',dateHeader:'',dateCover:'',beamerIntroduction:String.raw`\begin{frame}{总结}\includegraphics{assets/image.png}\end{frame}`,beamerIntroductionAssetPaths:['assets/image.png'],entries:[{namespace:'p1',code:'A',body:'正文',metadata:{title:'题目',author:''},assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}]};
 for(const [template,kind] of [['statement-compact','STATEMENT'],['editorial-document','EDITORIAL_DOCUMENT']] as const){
  const files=await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${template}/`,import.meta.url)));
  const result=renderContest(files,kind,input);
  assert.equal(result['contest-introduction.tex'],undefined);
  assert.doesNotMatch(Object.values(result).join('\n'),/contest-introduction\.tex|assets\/image\.png|\\begin\{frame\}/);
 }
});

test('custom Beamer entries load sizing before document startup and keep dynamic short titles plain',async()=>{
 const files=await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/editorial-beamer-wide/',import.meta.url)));
 const input:ContestRenderInput={title:'标题 ] $` & 竞赛',author:'',stage:'',dateHeader:'',dateCover:'',entries:[{namespace:'p1',code:'A',body:'\\begin{frame}{解法}正文\\end{frame}',metadata:{title:'题目',author:''},assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}]};
 files['booklet.tex']=files['booklet.tex'].replace('\\title{ {{CONTEST_TITLE}} }','\\title[{{CONTEST_TITLE}}]{ {{CONTEST_TITLE}} }').replace('\\begin{document}','\\input{entry.tex}');
 files['entry.tex']='\\input{pf-contest-beamer.tex}\n\\begin {document}';
 const result=renderContest(files,'EDITORIAL_BEAMER',input);
 assert.match(result['main.tex'],/^\\RequirePackage\{etoolbox\}\n\\BeforeBeginEnvironment\{document\}\{\\input\{pf-contest-beamer\.tex\}\}/);
 assert.match(result['main.tex'],/\\title\[\{标题 \] \\\$` \\& 竞赛\}\]/);
 assert.match(result['pf-contest-beamer.tex'],/\\ifdefined\\PFContestBeamerLoaded\\else/);
 assert.match(result['pf-contest-beamer.tex'],/pdfstringdefDisableCommands/);
 assert.match(result['pf-contest-beamer.tex'],/apptocmd\{\\beamer@section\}\{\\beamer@calculateheadfoot\}/);
 files['booklet.tex']=files['booklet.tex'].replace('[{{CONTEST_TITLE}}]','[管理员短标题]');
 assert.match(renderContest(files,'EDITORIAL_BEAMER',input)['main.tex'],/\\title\[管理员短标题\]/);
});
