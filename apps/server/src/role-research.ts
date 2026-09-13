import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import type { IpRole } from '@ruxiju/shared';
import type { Store } from './store.js';
import { aiJson } from './ai-client.js';

export interface ResearchSource {title:string;url:string;retrievedAt:string;text:string}
export interface RoleResearch {personaTags:string[];quote:string;signatureAction:string;ability:string;sources:Omit<ResearchSource,'text'>[];evidence:Record<string,string>;retrievedAt:string}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const clean=(html:string)=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function publicAddress(ip:string){if(ip.includes(':'))return /^[23][0-9a-f]{3}:/i.test(ip);const [a,b]=ip.split('.').map(Number);return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127);}
export async function readPublicPage(url:string):Promise<string>{
  let current=new URL(url);
  for(let hop=0;hop<3;hop++){
    if(current.protocol!=='https:'||current.username||current.password||current.port&&current.port!=='443'||isIP(current.hostname))throw new Error('不支持此资料地址');
    const ips=await lookup(current.hostname,{all:true});if(!ips.length||ips.some(v=>!publicAddress(v.address)))throw new Error('资料地址不可访问');
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'RuxijuRoleResearch/1.0 (public character reference)','accept':'application/json,text/html'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('资料跳转失败');current=new URL(location,current);continue;}
    if(!response.ok)throw new Error('资料站暂不可用');
    const reader=response.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let bytes=0,text='';
    try{while(true){const value=await reader.read();if(value.done)break;bytes+=value.value.length;if(bytes>512_000)throw new Error('资料页面过大');text+=decoder.decode(value.value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel();}
  }throw new Error('资料跳转过多');
}
export async function searchRoleSources(ip:string,name:string):Promise<ResearchSource[]>{
  const sources:ResearchSource[]=[];const references:string[]=[];let pageReads=0;
  // Search only actual sites; the model never supplies a URL to fetch.
  for(const base of ['https://zh.moegirl.org.cn/api.php','https://zh.wikipedia.org/w/api.php','https://en.wikipedia.org/w/api.php']){
    if(sources.length>=6)break;
    try{
      const url=new URL(base);url.search=new URLSearchParams({action:'query',generator:'search',gsrsearch:`${ip} ${name}`,gsrlimit:'2',prop:'info',inprop:'url',format:'json',formatversion:'2'}).toString();
      const found=JSON.parse(await readPublicPage(url.href)) as {query?:{pages?:Array<{pageid:number;title:string;fullurl:string}>}};
      for(const page of found.query?.pages??[]){if(pageReads>=4)break;try{
        pageReads++;
        const content=new URL(base);content.search=new URLSearchParams({action:'parse',pageid:String(page.pageid),prop:'text|externallinks',format:'json',formatversion:'2'}).toString();
        const parsed=JSON.parse(await readPublicPage(content.href)) as {parse?:{text?:string;externallinks?:string[]}};
        const text=clean(parsed.parse?.text??'');
        if(!text.includes(name)||!text.includes(ip))continue;
        sources.push({title:page.title,url:page.fullurl,retrievedAt:new Date().toISOString(),text:text.slice(0,14000)});
        references.push(...(parsed.parse?.externallinks??[]));
      }catch{/* Other sources can still provide useful evidence. */}}
    }catch{/* Do not bypass unavailable sites or login restrictions. */}
  }
  for(const url of [...new Set(references)].slice(0,8)){
    if(pageReads>=6)break;
    pageReads++;
    try{const html=await readPublicPage(url),text=clean(html);if(!text.includes(ip)||!text.includes(name))continue;sources.push({url,title:clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??name),text:text.slice(0,14000),retrievedAt:new Date().toISOString()});}catch{/* Skip inaccessible references. */}
  }
  return sources;
}
export function validateResearch(raw:unknown,sources:ResearchSource[]):RoleResearch{
  const value=raw as Record<string,unknown>|null;
  const result:RoleResearch={personaTags:[],quote:'',signatureAction:'',ability:'',sources:sources.map(({text,...source})=>source),evidence:{},retrievedAt:new Date().toISOString()};
  if(value?.identityConfirmed!==true)return result;
  for(const key of ['personaTags','quote','signatureAction','ability'] as const){
    const field=(value.fields as Record<string,unknown>|undefined)?.[key] as {value?:unknown;sourceIndex?:number;excerpt?:string}|undefined;
    const source=sources[field?.sourceIndex??-1];if(!source||typeof field?.excerpt!=='string'||!field.excerpt.trim()||!source.text.includes(field.excerpt))continue;
    if(key==='personaTags'){if(Array.isArray(field.value))result.personaTags=field.value.filter((v):v is string=>typeof v==='string'&&v.length>0&&v.length<=12).slice(0,5);}
    else if(typeof field.value==='string'&&field.value.length<=100&&(key!=='quote'||field.excerpt.includes(field.value)))result[key]=field.value;
    result.evidence[key]=`${source.url}\n${field.excerpt.slice(0,300)}`;
  }
  return result;
}
export async function researchRole(store:Store,role:Pick<IpRole,'ipTheme'|'name'>){
  const key='role-research:v1:'+digest(`${role.ipTheme.trim()}:${role.name.trim()}`);
  const cached=(await store.getGeneratedContent(key))?.content as RoleResearch|undefined;
  if(cached&&Date.now()-Date.parse(cached.retrievedAt)<7*86400_000)return {key,result:cached};
  const sources=await searchRoleSources(role.ipTheme,role.name);
  if(!sources.length)throw new Error('暂未找到可核实的角色资料，可继续使用角色或稍后重试');
  const raw=await aiJson('你是角色资料整理员。只依据给出的网页正文确认 IP 与角色身份；同名歧义不能确认时 identityConfirmed=false。提取3–5个人设关键词、一条有原文依据的短台词、标志动作和核心能力；不确定字段为空。每个字段提供原文连续摘录 excerpt 和从0开始的 sourceIndex，台词必须出现在摘录中。返回 {identityConfirmed:boolean,fields:{personaTags:{value:string[],sourceIndex:number,excerpt:string},quote:{value:string,sourceIndex:number,excerpt:string},signatureAction:{value:string,sourceIndex:number,excerpt:string},ability:{value:string,sourceIndex:number,excerpt:string}}}。不要把二创当原作事实。',{...role,sources},2400);
  return {key,result:validateResearch(raw,sources)};
}
