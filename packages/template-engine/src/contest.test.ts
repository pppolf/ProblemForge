import{test}from'node:test';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';import{loadTemplateDirectory,renderContest,type ContestRenderInput}from'./index.ts';
test('booklet namespaces isolate equal labels, image names and samples without rewriting literal code',async()=>{
 const files=await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/statement-compact/',import.meta.url)));
 const body='\\label{same}见\\ref{same}。\\includegraphics{assets/image.png}\n\\begin{verbatim}\n\\label{same} assets/image.png\n\\end{verbatim}';
 const entry={body,metadata:{title:'A & B',author:'作者'},assetPaths:['assets/image.png'],samples:[{inputPath:'samples/sample-1.in',answerPath:'samples/sample-1.ans'}],timeLimitMs:2300,memoryLimitMb:512,inputFile:'input.txt',outputFile:'output.txt'};
 const context:ContestRenderInput={title:'比赛',author:'',stage:'',dateHeader:'',dateCover:'',entries:[{...entry,namespace:'p2',code:'C'},{...entry,namespace:'p1',code:'A'}]};
 const result=renderContest(files,'STATEMENT',context);assert(result['main.tex'].indexOf('p2/item.tex')<result['main.tex'].indexOf('p1/item.tex'));assert.match(result['p2/content.tex'],/\\label\{p2:same\}/);assert.match(result['p1/content.tex'],/\\ref\{p1:same\}/);assert.match(result['p2/content.tex'],/\\includegraphics\{p2\/assets\/image.png\}/);assert.match(result['p1/samples.tex'],/p1\/samples\/sample-1.in/);assert.match(result['p2/content.tex'],/verbatim\}\n\\label\{same\} assets\/image.png/);assert.match(result['p2/item.tex'],/Problem C\. A \\& B/);assert.match(result['p2/item.tex'],/2.3 s/);assert.match(result['p2/item.tex'],/512 MB/);
 assert.throws(()=>renderContest(files,'STATEMENT',{...context,entries:[context.entries[0],context.entries[0]]}));
});
