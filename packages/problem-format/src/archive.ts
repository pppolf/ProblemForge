import {fromBuffer,type Entry,type ZipFile} from 'yauzl';
import {ZipFile as Writer} from 'yazl';
import type {Readable} from 'node:stream';
export class PackageError extends Error {}
export const limits={compressed:24_000_000,expanded:64_000_000,entry:8_000_000,count:1500};
export function safePath(path:string){
  if(!path||path.length>200||!/^[\x20-\x7e]+$/.test(path)||/[\\:]/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new PackageError(`不安全的包路径：${path.slice(0,200)}`);
  return path;
}
// Opt-in for human-readable exports; import routes retain the ASCII policy.
export function safeExportPath(path:string){
  if(!path||path.length>200||Buffer.byteLength(path)>600||path!==path.normalize('NFC')||/[\p{Cc}\p{Cf}\p{Cs}\\:"<>|?*]/u.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new PackageError(`不安全的导出路径：${path.slice(0,200)}`);
  return path;
}
type ArchiveOptions={unicodePaths?:boolean};
export async function readArchive(bytes:Buffer,options:ArchiveOptions={}):Promise<Map<string,Buffer>>{
  if(bytes.length>limits.compressed)throw new PackageError('压缩包超过 24MB');
  const zip=await new Promise<ZipFile>((resolve,reject)=>fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(new PackageError(e.message)):resolve(z!)));
  return new Promise((resolve,reject)=>{const files=new Map<string,Buffer>(),names=new Set<string>();let total=0,count=0,done=false;
    const fail=(e:Error)=>{if(done)return;done=true;zip.close();reject(new PackageError(e.message));};zip.on('error',fail);
    zip.on('entry',async(e:Entry)=>{try{
      const directory=e.fileName.endsWith('/'),path=(options.unicodePaths?safeExportPath:safePath)(directory?e.fileName.slice(0,-1):e.fileName),fold=path.toLowerCase();
      if(++count>limits.count||names.has(fold))throw new PackageError('包成员过多或路径重复（包括大小写别名）');names.add(fold);
      const mode=(e.externalFileAttributes>>>16)&0xf000;
      if(mode&&mode!==0x8000&&mode!==0x4000||e.generalPurposeBitFlag&1)throw new PackageError('不接受链接、特殊文件或加密成员');
      if(e.uncompressedSize>limits.entry||total+e.uncompressedSize>limits.expanded||e.uncompressedSize>Math.max(1,e.compressedSize)*2000)throw new PackageError('解压大小或压缩比例超过限制');
      if(directory){if(e.uncompressedSize)throw new PackageError('目录不能包含数据');zip.readEntry();return;}
      const stream=await new Promise<NodeJS.ReadableStream>((res,rej)=>zip.openReadStream(e,(err,s)=>err?rej(err):res(s!)));
      const chunks:Buffer[]=[];let length=0;for await(const chunk of stream as AsyncIterable<Buffer>){length+=chunk.length;if(length>limits.entry||total+length>limits.expanded)throw new PackageError('实际解压大小超过限制');chunks.push(chunk);}total+=length;files.set(path,Buffer.concat(chunks));zip.readEntry();
    }catch(error){fail(error as Error);}});
    zip.on('end',()=>{if(done)return;done=true;zip.close();resolve(files);});zip.readEntry();
  });
}
export async function writeArchive(files:Map<string,Buffer>,options:ArchiveOptions={}){
  if(files.size>limits.count)throw new PackageError('导出成员过多');let total=0;const names=new Set<string>();for(const [path,bytes]of files){(options.unicodePaths?safeExportPath:safePath)(path);if(names.has(path.toLowerCase()))throw new PackageError('导出路径重复（包括大小写别名）');names.add(path.toLowerCase());total+=bytes.length;if(bytes.length>limits.entry||total>limits.expanded)throw new PackageError('导出内容超出包大小限制');}
  const zip=new Writer(),chunks:Buffer[]=[];let compressed=0;
  const output=new Promise<Buffer>((resolve,reject)=>{zip.outputStream.on('data',(chunk:Buffer)=>{compressed+=chunk.length;if(compressed>limits.compressed){(zip.outputStream as Readable).destroy(new PackageError('导出压缩包超过 24MB'));return;}chunks.push(chunk);});zip.outputStream.on('error',reject);zip.on('error',reject);zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));});
  for(const [path,bytes]of files)zip.addBuffer(bytes,path,{mtime:new Date('2000-01-01T00:00:00Z'),mode:0o100644});zip.end();return output;
}
