import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, root } from '@problemforge/domain';
import type { Api } from '../app.ts';

export async function staticRoutes(app:Api){
  if(!config.production)return;
  const dist=resolve(root,'apps/web/dist');
  app.get('/*',async(req,reply)=>{
    const path=req.url.split('?')[0];
    if(path.startsWith('/api/'))return reply.code(404).send({code:'NOT_FOUND',message:'接口不存在'});
    const isAsset=path.startsWith('/assets/');
    if(isAsset&&!/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))return reply.code(404).send();
    const file=isAsset?path.slice(1):'index.html',ext=file.split('.').at(-1)!;
    const mime:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2',wasm:'application/wasm'};
    try{const bytes=await readFile(resolve(dist,file));if(isAsset)reply.header('Cache-Control','public, max-age=31536000, immutable');return reply.type(mime[ext]??'application/octet-stream').send(bytes);}catch{return reply.code(404).send();}
  });
}
