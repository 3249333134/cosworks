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
    const ips=(await lookup(current.hostname,{all:true})).filter(v=>v.family===4);if(!ips.length||ips.some(v=>!publicAddress(v.address)))throw new Error('资料地址不可访问');
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'RuxijuRoleResearch/1.0 (public character reference)','accept':'application/json,text/html'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('资料跳转失败');current=new URL(location,current);continue;}
    if(!response.ok)throw new Error('资料站暂不可用');
    const reader=response.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let bytes=0,text='';
    try{while(true){const value=await reader.read();if(value.done)break;bytes+=value.value.length;if(bytes>512_000)throw new Error('资料页面过大');text+=decoder.decode(value.value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel();}
  }throw new Error('资料跳转过多');
}
async function fetchSearchPage(url:string):Promise<string>{
  const current=new URL(url);
  const ips=(await lookup(current.hostname,{all:true})).filter(v=>v.family===4);
  if(!ips.length||ips.some(v=>!publicAddress(v.address)))throw new Error('不可访问');
  const response=await fetch(current,{redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36','accept':'text/html'}});
  if(!response.ok)throw new Error('请求失败');
  const buf=await response.arrayBuffer();if(buf.byteLength>1_048_576)throw new Error('页面过大');
  return new TextDecoder().decode(buf);
}
function bingResults(html:string):Array<{title:string;url:string;snippet:string}>{
  const out:Array<{title:string;url:string;snippet:string}>=[];
  for(const block of html.split('<li class="b_algo"').slice(1)){
    const m=block.match(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if(!m)continue;const url=m[1],title=clean(m[2]);if(url.includes('bing.com')||url.includes('microsoft.com'))continue;
    const sm=block.match(/class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const snippet=sm?clean(sm[1]):'';
    out.push({title,url,snippet});
  }
  return out;
}
export async function searchRoleSources(ip:string,name:string):Promise<ResearchSource[]>{
  const sources:ResearchSource[]=[];let pageReads=0;const maxPages=6;
  // 1. 萌娘百科：分别按 IP 名和角色名搜索词条，再抓页面正文验证
  const moegirlQueries=[ip,name,`${name} ${ip}`];
  const seenTitles=new Set<string>();
  for(const query of moegirlQueries){
    if(pageReads>=maxPages||sources.length>=6)break;
    try{
      const api='https://zh.moegirl.org.cn/api.php?'+new URLSearchParams({action:'opensearch',search:query,limit:'3',format:'json'}).toString();
      const data=JSON.parse(await readPublicPage(api)) as [string,string[],string[],string[]];
      for(const title of data[1]??[]){if(seenTitles.has(title))continue;seenTitles.add(title);if(pageReads>=maxPages||sources.length>=6)break;pageReads++;
        try{
          const pageUrl='https://zh.moegirl.org.cn/'+encodeURIComponent(title);
          const html=await readPublicPage(pageUrl);const text=clean(html);
          if(!text.includes(name)||!text.includes(ip))continue;
          if(title.includes('消歧义')||text.includes('消歧义'))continue;
          sources.push({title,url:pageUrl,retrievedAt:new Date().toISOString(),text:text.slice(0,14000)});
        }catch{/* 跳过无法访问的词条 */}
      }
    }catch{/* 萌娘百科不可用时继续其他来源 */}
  }
  // 2. Bing 搜索补源：优先抓百科/维基类页面，其余用搜索摘要作轻量来源
  if(sources.length<4){
    try{
      const q=encodeURIComponent(`${ip} ${name} 角色 人设`);
      const html=await fetchSearchPage(`https://www.bing.com/search?q=${q}&setlang=zh-CN`);
      const results=bingResults(html);
      for(const r of results){if(pageReads>=maxPages||sources.length>=6)break;
        const isWiki=/moegirl|wikipedia|wiki\.|baike\.so|灰机wiki|bilibili.*wiki/i.test(r.url);
        if(isWiki){pageReads++;
          try{const page=await readPublicPage(r.url);const text=clean(page);
            if(!text.includes(name)||!text.includes(ip))continue;
            sources.push({title:r.title,url:r.url,retrievedAt:new Date().toISOString(),text:text.slice(0,14000)});
            continue;
          }catch{/* 页面不可抓，用摘要 */}
        }
        if(r.snippet&&r.snippet.length>20&&(r.snippet.includes(name)||r.title.includes(name))){sources.push({title:r.title,url:r.url,retrievedAt:new Date().toISOString(),text:`${r.title}\n${r.snippet}`});}
      }
    }catch{/* Bing 不可用时跳过 */}
  }
  return sources;
}
const normWs=(s:string)=>s.replace(/\s+/g,' ').trim();
const normMatch=(s:string)=>s.replace(/\s+/g,'').replace(/[""''「」『』]/g,'');
export function validateResearch(raw:unknown,sources:ResearchSource[]):RoleResearch{
  const value=raw as Record<string,unknown>|null;
  const result:RoleResearch={personaTags:[],quote:'',signatureAction:'',ability:'',sources:sources.map(({text,...source})=>source),evidence:{},retrievedAt:new Date().toISOString()};
  if(value?.identityConfirmed!==true)return result;
  for(const key of ['personaTags','quote','signatureAction','ability'] as const){
    const field=(value.fields as Record<string,unknown>|undefined)?.[key] as {value?:unknown;sourceIndex?:number;excerpt?:string}|undefined;
    const source=sources[field?.sourceIndex??-1];
    if(!source)continue;
    // 有来源支撑时信任 AI 提取；摘录匹配则保存证据
    const excerpt=typeof field?.excerpt==='string'?field.excerpt:'';
    const excerptMatches=excerpt&&normMatch(source.text).includes(normMatch(excerpt));
    if(key==='personaTags'){if(Array.isArray(field?.value))result.personaTags=field.value.filter((v):v is string=>typeof v==='string'&&v.length>0&&v.length<=12).slice(0,5);}
    else if(typeof field?.value==='string'&&field.value.length<=100)result[key]=field.value;
    if(excerptMatches)result.evidence[key]=`${source.url}\n${excerpt.slice(0,300)}`;
  }
  return result;
}
export async function researchRole(store:Store,role:Pick<IpRole,'ipTheme'|'name'>){
  const key='role-research:v8:'+digest(`${role.ipTheme.trim()}:${role.name.trim()}`);
  const cached=(await store.getGeneratedContent(key))?.content as RoleResearch|undefined;
  if(cached&&Date.now()-Date.parse(cached.retrievedAt)<7*86400_000)return {key,result:cached};
  const sources=await searchRoleSources(role.ipTheme,role.name);
  if(!sources.length){
    const raw=await aiJson('你是角色资料整理员。根据给出的 IP 主题和角色名，生成角色人设：3–5个人设关键词、一条代表台词、一个标志动作、一个核心能力标签。返回 JSON：{"identityConfirmed":true,"fields":{"personaTags":{"value":["关键词1","关键词2"]},"quote":{"value":"代表台词"},"signatureAction":{"value":"标志动作"},"ability":{"value":"核心能力"}}}。不确定的字段留空字符串。',role,2400);
    const value=raw as Record<string,unknown>|null;const fields=(value?.fields as Record<string,{value?:unknown}>|undefined)??{};
    const v=fields.personaTags?.value;const q=fields.quote?.value;const a=fields.signatureAction?.value;const b=fields.ability?.value;
    const result:RoleResearch={personaTags:Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.length>0&&x.length<=12).slice(0,5):[],quote:typeof q==='string'?q.slice(0,100):'',signatureAction:typeof a==='string'?a.slice(0,100):'',ability:typeof b==='string'?b.slice(0,100):'',sources:[],evidence:{},retrievedAt:new Date().toISOString()};
    return {key,result};
  }
  try{
    const raw=await aiJson('你是角色资料整理员。只依据给出的网页正文确认 IP 与角色身份；同名歧义不能确认时 identityConfirmed=false。提取3–5个人设关键词、一条有原文依据的短台词、标志动作和核心能力；不确定字段为空。每个字段提供原文连续摘录 excerpt 和从0开始的 sourceIndex，台词必须出现在摘录中。重要：excerpt 中绝对不能出现任何引号字符（包括 " " \' \' 「」等），引用台词时直接写内容不加引号。返回 {identityConfirmed:boolean,fields:{personaTags:{value:string[],sourceIndex:number,excerpt:string},quote:{value:string,sourceIndex:number,excerpt:string},signatureAction:{value:string,sourceIndex:number,excerpt:string},ability:{value:string,sourceIndex:number,excerpt:string}}}。不要把二创当原作事实。',{...role,sources},2400);
    return {key,result:validateResearch(raw,sources)};
  }catch(e){
    console.warn(`[research] sources AI failed (${role.ipTheme}/${role.name}), fallback: ${(e as Error).message}`);
    const raw=await aiJson('你是角色资料整理员。根据给出的 IP 主题和角色名，生成角色人设：3–5个人设关键词、一条代表台词、一个标志动作、一个核心能力标签。返回 JSON：{"identityConfirmed":true,"fields":{"personaTags":{"value":["关键词1","关键词2"]},"quote":{"value":"代表台词"},"signatureAction":{"value":"标志动作"},"ability":{"value":"核心能力"}}}。不确定的字段留空字符串。',role,2400);
    const value=raw as Record<string,unknown>|null;const fields=(value?.fields as Record<string,{value?:unknown}>|undefined)??{};
    const v=fields.personaTags?.value;const q=fields.quote?.value;const a=fields.signatureAction?.value;const b=fields.ability?.value;
    const result:RoleResearch={personaTags:Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.length>0&&x.length<=12).slice(0,5):[],quote:typeof q==='string'?q.slice(0,100):'',signatureAction:typeof a==='string'?a.slice(0,100):'',ability:typeof b==='string'?b.slice(0,100):'',sources,evidence:{},retrievedAt:new Date().toISOString()};
    return {key,result};
  }
}
