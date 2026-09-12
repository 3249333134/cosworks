import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import sharp, { type OutputInfo } from 'sharp';
import { requireAuth } from './auth.js';
import type { AssetRecord, Store } from './store.js';

const DATA_DIR=resolve(dirname(fileURLToPath(import.meta.url)),'..','data');
const MAX_BYTES=8*1024*1024;
const accepted=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:1},fileFilter:(_req,file,done)=>{
  const heic=!file.mimetype||file.mimetype==='application/octet-stream';
  if(accepted.has(file.mimetype)||(heic&&/\.heic$/i.test(file.originalname)))done(null,true);
  else done(new Error('仅支持 JPEG、PNG、WebP、HEIC 图片'));
}}).single('file');

export function createMediaRoutes(store:Store){
  const router=Router();
  router.post('/api/media/upload',requireAuth,(req,res,next)=>upload(req,res,error=>{
    if(error)return next(new Error(error instanceof multer.MulterError&&error.code==='LIMIT_FILE_SIZE'?'图片不能超过 8 MB':error.message));
    void (async()=>{
      if(!req.file)throw new Error('请选择图片，上传字段名为 file');
      const roomId=typeof req.body?.roomId==='string'&&req.body.roomId?req.body.roomId:null;
      // Room existence and membership are checked at binding time; uploads may precede a room.
      let output:{data:Buffer;info:OutputInfo};let thumb:Buffer;
      try{
        const input=sharp(req.file.buffer,{limitInputPixels:80_000_000,failOn:'warning'});
        const meta=await input.metadata();
        if(!['jpeg','png','webp','heif'].includes(meta.format??''))throw new Error('format');
        output=await input.rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
        thumb=await sharp(output.data).resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
      }catch{throw new Error(/hei[cf]/i.test(req.file.mimetype+req.file.originalname)?'当前环境不支持这张 HEIC 图片，请转为 JPEG 或 PNG 后重试':'图片无法解码，请选择有效的 JPEG、PNG、WebP 或 HEIC 图片');}
      const id=randomUUID();const imagePath=`media/${id}.webp`;const thumbPath=`media/${id}.thumb.webp`;
      await mkdir(resolve(DATA_DIR,'media'),{recursive:true});
      try{
        await writeFile(resolve(DATA_DIR,imagePath),output.data);
        await writeFile(resolve(DATA_DIR,thumbPath),thumb);
        const record:AssetRecord={id,accountId:req.auth!.accountId,roomId,filename:req.file.originalname.slice(0,255),mimeType:'image/webp',size:output.data.length,width:output.info.width,height:output.info.height,thumbSize:thumb.length,createdAt:new Date().toISOString(),dataUrl:null,imagePath,thumbPath,usedInSessionId:null,usedAt:null};
        await store.saveAsset(record);
        res.status(201).json({ok:true,data:{assetId:id,url:`/api/media/${id}`,thumb:`/api/media/${id}?thumb=1`,size:record.size,mime:record.mimeType,width:record.width,height:record.height}});
      }catch(error){await Promise.allSettled([unlink(resolve(DATA_DIR,imagePath)),unlink(resolve(DATA_DIR,thumbPath))]);throw error;}
    })().catch(next);
  }));
  router.get('/api/media/:id',requireAuth,async(req,res,next)=>{try{
    const asset=await store.getAsset(String(req.params.id));if(!asset)return res.status(404).json({ok:false,error:'找不到该资源'});
    const bytes=await assetBytes(asset,req.query.thumb==='1');if(!bytes)return res.status(410).json({ok:false,error:'资源本体丢失'});
    res.setHeader('Content-Type',asset.mimeType);res.setHeader('Cache-Control','private, no-store');res.end(bytes);
  }catch(error){next(error);}});
  return {router};
}
async function assetBytes(asset:AssetRecord,thumb:boolean):Promise<Buffer|null>{
  const paths=[thumb?asset.thumbPath:asset.imagePath,asset.imagePath,`blobs/${asset.id}${thumb?'.thumb':''}`,`blobs/${asset.id}`];
  for(const path of paths)if(path){try{return await readFile(resolve(DATA_DIR,path));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const match=asset.dataUrl?.match(/^data:(image\/[a-z0-9+\-.]+);base64,(.+)$/i);
  return match?Buffer.from(match[2],'base64'):null;
}
