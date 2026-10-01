import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, appendFile, lstat, open } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
export const backupFiles=['database.dump','storage.tar','state.json','manifest.json'];
const magic=Buffer.from('PFBK01\r\n');
async function regular(path) {const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw new Error('备份成员必须为普通文件，禁止链接');return s;}
export const keyId=key=>createHash('sha256').update(key).digest('hex').slice(0,24);
export async function readKey(path) { const raw=await readFile(path);const key=/^[a-fA-F0-9]{64}\s*$/.test(raw.toString())?Buffer.from(raw.toString().trim(),'hex'):raw;if(key.length!==32)throw new Error('备份密钥必须为随机 32 字节或 64 位十六进制，不能使用普通口令');return key; }
export async function encryptBackup(source,dest,key,id) {
  const aad=name=>Buffer.from(`problemforge-backup/v1:${id}:${name}`);
  for(const name of backupFiles) {
    await regular(join(source,name));
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(name));
    const path=join(dest,name+'.enc');await writeFile(path,Buffer.concat([magic,iv]),{flag:'wx',mode:0o600});
    await pipeline(createReadStream(join(source,name)),cipher,createWriteStream(path,{flags:'a',mode:0o600}));
    await appendFile(path,cipher.getAuthTag());
  }
  await writeFile(join(dest,'encryption.json'),JSON.stringify({format:'problemforge-encrypted-backup/v1',algorithm:'AES-256-GCM',id,keyId:keyId(key),createdAt:new Date().toISOString(),files:backupFiles},null,2),{flag:'wx',mode:0o600});
}
export async function decryptBackup(source,dest,key) {
  await regular(join(source,'encryption.json'));
  const meta=JSON.parse(await readFile(join(source,'encryption.json'),'utf8'));
  if(meta.format!=='problemforge-encrypted-backup/v1'||meta.algorithm!=='AES-256-GCM'||!/^backup-[a-z0-9-]+$/.test(meta.id)||JSON.stringify(meta.files)!==JSON.stringify(backupFiles))throw new Error('加密备份格式不受支持');
  if(meta.keyId!==keyId(key))throw new Error('备份密钥不匹配');
  for(const name of backupFiles) {
    const path=join(source,name+'.enc'),info=await regular(path);if(info.size<=36)throw new Error('加密备份已截断');
    const handle=await open(path,'r'),header=Buffer.alloc(20),tag=Buffer.alloc(16);
    try {await handle.read(header,0,20,0);await handle.read(tag,0,16,info.size-16);}finally{await handle.close();}
    if(!header.subarray(0,8).equals(magic))throw new Error('加密备份头已损坏');
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAuthTag(tag);decipher.setAAD(Buffer.from(`problemforge-backup/v1:${meta.id}:${name}`));
    try {await pipeline(createReadStream(path,{start:20,end:info.size-17}),decipher,createWriteStream(join(dest,name),{flags:'wx',mode:0o600}));}
    catch {throw new Error(`备份认证失败：${name}（密钥错误或内容损坏）；未启动恢复`);}
  }
  return meta;
}
export function retentionPreview(entries,{keepLatest=7,maxAgeDays=30},now=new Date()) {
  if(!Number.isInteger(keepLatest)||keepLatest<1||!Number.isInteger(maxAgeDays)||maxAgeDays<1)throw new Error('保留最新数和天数必须为正整数');
  const sorted=[...entries].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return sorted.map((e,i)=>({...e,decision:i>=keepLatest&&Date.parse(e.createdAt)<now.getTime()-maxAgeDays*86400000?'review':'keep'}));
}
