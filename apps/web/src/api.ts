import type { GameHistory, PartyTimeline } from '@ruxiju/shared';
const API_BASE=import.meta.env.VITE_API_BASE_URL||'/api';
let token=sessionStorage.getItem('rxj-token')||'';

export function setToken(value:string){token=value;sessionStorage.setItem('rxj-token',value);}
export function clearToken(){token='';sessionStorage.removeItem('rxj-token');}
export function socketUrl(roomCode:string){const configured=import.meta.env.VITE_WS_URL||'/ws';const base=configured.startsWith('ws')?configured:`${location.protocol==='https:'?'wss':'ws'}://${location.host}${configured}`;const url=new URL(base);url.searchParams.set('room',roomCode);if(token)url.searchParams.set('token',token);return url.toString();}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`${API_BASE}${path}`,{...options,credentials:'include',headers:{...(options.body instanceof FormData?{}:{'content-type':'application/json'}),...(token?{authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const text=await response.text();let body:{ok?:boolean;error?:string;data?:T};
  try{body=JSON.parse(text) as typeof body;}catch{throw new Error(response.ok?'服务器返回了异常内容，请刷新后重试':'游戏服务暂时不可用，请稍后重试');}
  if(!response.ok||!body.ok)throw new Error(body.error||'请求失败，请稍后重试');return body.data as T;
}
export interface UploadedAsset { assetId:string; url:string; thumb:string; size:number; mime:string; width:number; height:number; }
export async function uploadImage(file:File,roomId?:string|null,onProgress?:(percent:number)=>void):Promise<UploadedAsset>{
  if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)&&!((!file.type||file.type==='application/octet-stream')&&/\.heic$/i.test(file.name)))throw new Error('仅支持 JPEG、PNG、WebP、HEIC 图片');
  if(file.size>8*1024*1024)throw new Error('图片不能超过 8 MB');
  const form=new FormData();form.append('file',file);if(roomId)form.append('roomId',roomId);
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',API_BASE+'/media/upload');xhr.withCredentials=true;xhr.timeout=60000;
    if(token)xhr.setRequestHeader('Authorization','Bearer '+token);
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress?.(Math.round(event.loaded/event.total*100));};
    xhr.onerror=()=>reject(new Error('上传失败，请检查网络后重试'));xhr.ontimeout=()=>reject(new Error('图片处理超时，请重试'));
    xhr.onload=()=>{try{if(!xhr.responseText)throw new Error('游戏服务暂时不可用，请稍后重试');const body=JSON.parse(xhr.responseText);if(xhr.status>=400||!body.ok)throw new Error(body.error||'上传失败');resolve(body.data);}catch(error){reject(error instanceof SyntaxError?new Error('服务器返回了异常内容，请稍后重试'):error);}};xhr.send(form);
  });
}
export function getTimeline(roomCode:string){return api<{timeline:PartyTimeline}>(`/rooms/${roomCode}/timeline`).then(r=>r.timeline);}
export function getHistory(roomCode:string,sessionId:string){return api<{history:GameHistory}>(`/rooms/${roomCode}/sessions/${sessionId}/history`).then(r=>r.history);}
export interface MemberHistoryEvent { id:string; actorAccountId:string|null; actorName:string|null; eventType:string; payload:Record<string,unknown>; createdAt:string; }
export interface MemberHistory { member:{ accountId:string; displayName:string; playerRole:string; team:string; score:number; online:boolean; hostRole:string|null; isOwner:boolean; ready:boolean; }; events:MemberHistoryEvent[]; }
export function getMemberHistory(roomCode:string,accountId:string){return api<MemberHistory>(`/rooms/${roomCode}/members/${accountId}/history`);}
export const uid=()=>{
  const uuid=globalThis.crypto?.randomUUID?.();
  if(uuid)return `${Date.now().toString(36)}-${uuid}`;
  const bytes=new Uint8Array(16);globalThis.crypto?.getRandomValues?.(bytes);
  const suffix=bytes.some(Boolean)?Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join(''):`${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now().toString(36)}-${suffix}`;
};
