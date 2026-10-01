import {SaxesParser}from'saxes';import{PackageError}from'./archive.ts';
export type Xml={name:string;attrs:Record<string,string>;children:Xml[];text:string};
export function readXml(bytes:Buffer):Xml{
 if(bytes.length>1_000_000)throw new PackageError('XML 超过 1MB');let xml:string;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new PackageError('XML 必须使用 UTF-8');}
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))throw new PackageError('禁止 XML DTD / 实体声明');
 const stack:Xml[]=[],parser=new SaxesParser({xmlns:false}),roots:Xml[]=[];let count=0;
 parser.on('doctype',()=>{throw new PackageError('禁止 DTD');});parser.on('processinginstruction',()=>{throw new PackageError('禁止 XML 处理指令');});
 parser.on('opentag',tag=>{if(++count>10000||stack.length>=24||Object.keys(tag.attributes).length>30)throw new PackageError('XML 结构超出限制');const node:Xml={name:tag.name,attrs:{...tag.attributes},children:[],text:''};if(stack.length)stack.at(-1)!.children.push(node);else roots.push(node);stack.push(node);});
 const text=(s:string)=>{if(stack.length)stack.at(-1)!.text+=s;};parser.on('text',text);parser.on('cdata',text);parser.on('closetag',()=>{stack.pop();});
 try{parser.write(xml).close();}catch(e){throw new PackageError(`XML 解析失败：${(e as Error).message}`);}if(roots.length!==1||roots[0].name!=='problem')throw new PackageError('需要唯一 problem 根节点');return roots[0];
}
export const escapeXml=(text:string|number)=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
