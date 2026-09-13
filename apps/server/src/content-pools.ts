import { createHash, randomUUID } from 'node:crypto';
import { buildChallenge, buildSecretMissionBatch, DONT_CHALLENGE_WORDS, isDistinctSecretMission, isLowCorrelationSecretMission, SECRET_MISSION_TRIGGERS, validateChallenge, type Challenge, type ChallengeContext, type RoomSnapshot, type StoryParticipant } from '@ruxiju/shared';
import type { Store } from './store.js';
import { newJob, type BackgroundJob } from './jobs.js';
import { aiJson } from './ai-client.js';
import { validateStoryBundle } from './story-engine.js';
import { storyState } from './story-engine.js';

export type PoolGame='dont'|'must'|'draw'|'story';
export interface DrawWord {word:string;aliases:string[];difficulty:'easy'|'medium'}
export type StoryBundle=ReturnType<typeof validateStoryBundle>;
export interface PoolSpec {code:string;roomId:string;gameId:PoolGame;key:string;fingerprint:string;accountId:string|null;context?:ChallengeContext;participants:StoryParticipant[]}
export interface PoolItem {id:string;value:Challenge|DrawWord|StoryBundle;source:'ai'|'local';usedAt:string|null}
export interface ContentPool {fingerprint:string;items:PoolItem[]}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=(s:string)=>s.normalize('NFKC').replace(/[\s“”"'，。！？、]/g,'').toLowerCase();
const unsafe=/(亲吻|拥抱|脱衣|喝酒|饮酒|身体接触|隐私|密码|自残|自杀|辱骂|跳楼|购买道具)/;
export async function poolSpecs(store:Store,room:RoomSnapshot):Promise<PoolSpec[]>{
  const profiles=await Promise.all(room.members.map(async member=>{
    const profile=await store.getProfile(member.accountId);
    const role=profile.roles.find(r=>r.id===member.ipRoleId)??profile.roles.find(r=>r.ipTheme===room.ipTheme&&r.isDefault)??profile.roles.find(r=>r.ipTheme===room.ipTheme);
    return {member,profile,role};
  }));
  const roster=profiles.filter(p=>p.role&&p.profile.mbti).sort((a,b)=>a.member.accountId.localeCompare(b.member.accountId));
  const participants=roster.map(({member,role})=>({accountId:member.accountId,displayName:member.displayName,playerRole:role!.name,persona:[...role!.personaTags,role!.quote,role!.signatureAction,role!.ability].filter(Boolean).join('；')||role!.name}));
  const specs:PoolSpec[]=[];
  for(const {member,profile,role} of roster){
    const fingerprint=hash({role:{...role,version:undefined,isDefault:undefined,generation:undefined},mbti:profile.mbti,playerCount:roster.length,rules:1});
    for(const gameId of ['dont','must'] as const)specs.push({code:room.code,roomId:room.id,gameId,key:`content-pool:v1:${room.id}:${gameId}:${member.accountId}`,fingerprint,accountId:member.accountId,context:{gameId,role:role!,mbti:profile.mbti!,playerCount:roster.length,cameraAvailable:false},participants});
  }
  const fingerprint=hash({participants,profiles:roster.map(p=>[p.role?.version,p.profile.mbti]),rules:1});
  for(const gameId of ['draw','story'] as const){
    const selected=gameId==='story'&&room.currentGame==='story'?storyState(room)?.participants??participants:participants;
    specs.push({code:room.code,roomId:room.id,gameId,key:`content-pool:v1:${room.id}:${gameId}`,fingerprint:gameId==='story'?hash({participants:selected,rules:1}):fingerprint,accountId:null,participants:selected});
  }
  return specs;
}
export async function scheduleRoom(store:Store,code:string){await store.enqueueJob(newJob(`prepare:${code}`,'prepare',{code},null,5000));}
export async function scheduleAccount(store:Store,accountId:string){for(const room of await store.listRecentRooms(accountId,1000))if(room.canReenter)await scheduleRoom(store,room.code);}
async function readPool(store:Store,spec:PoolSpec){const saved=(await store.getGeneratedContent(spec.key))?.content as ContentPool|undefined;return saved??{fingerprint:spec.fingerprint,items:[]};}
async function savePool(store:Store,spec:PoolSpec,pool:ContentPool){await store.saveGeneratedContent({cacheKey:spec.key,accountId:spec.accountId,gameId:spec.gameId,content:pool,rulesVersion:1});}
const threshold=(game:PoolGame)=>game==='story'?1:3;
export async function enqueuePool(store:Store,spec:PoolSpec){
  if(spec.gameId==='story'&&spec.participants.length<2)return;
  const pool=await readPool(store,spec);const remaining=pool.fingerprint===spec.fingerprint?pool.items.filter(i=>!i.usedAt).length:0;
  if(remaining<=threshold(spec.gameId))await store.enqueueJob(newJob(`pool:${spec.key}:${spec.fingerprint}`,'pool',{spec},spec.accountId));
}
export async function prepareRoom(store:Store,code:string){const room=await store.getRoom(code);if(!room||room.closedAt)return;for(const spec of await poolSpecs(store,room))await enqueuePool(store,spec);}
const contentOf=(item:PoolItem)=>'content' in item.value?item.value.content:'word' in item.value?item.value.word:item.value.opening;
async function exclusions(store:Store,spec:PoolSpec){return (await store.listGeneratedContent(`content-pool:v1:${spec.roomId}:${spec.gameId}`)).flatMap(r=>(r.content as ContentPool).items.map(contentOf));}
export const DRAW_FALLBACK:DrawWord[]=['雨伞','猫咪','自行车','火锅','月亮','树屋','纸飞机','饭团','围巾','背包','雪人','灯笼','竹子','扇子','城堡','海盗船','火车站','生日蛋糕','风筝','蘑菇'].map((word,i)=>({word,aliases:word==='猫咪'?['猫','小猫']:[],difficulty:i<14?'easy':'medium'}));
export function fallbackStory(participants:StoryParticipant[],variant=0):StoryBundle{
  const place=variant%2?'会在日落后消失的旧车站':'只在月圆时开门的夜市';
  const opening=`来自不同地方的众人收到了一张没有署名的邀请函，约好在${place}见面。刚到入口，通往外面的路便悄悄消失了。守门人留下一盏没有点亮的灯，说只有找回散落的三段记忆，大家才能在钟声响起前离开。可是摊位上的地图被风吹乱，唯一知道线索的送信人又把名字忘了。众人只能先从眼前看得见的小事入手，观察周围，交换发现。每个人都带着自己的习惯和判断，没有谁知道全貌，也没有人必须独自承担所有难题。一阵铃声从街角传来，新的线索似乎已经出现。`;
  return {opening,endingHint:'旅程将从互相试探走向共同理解，一件原本不起眼的小事，会让大家重新看待这场相遇。',ending:`最后一段记忆被放回灯中时，众人发现邀请函并不是求救信，而是一封尚未写完的感谢信。送信人曾在不同时间得到过陌生人的帮助，却一直没能说声谢谢。那些看似无关的线索，正是帮助发生时留下的小小印记。灯终于亮起，消失的路重新出现在眼前。众人没有得到改变世界的宝物，只各自带走了一张空白明信片。离开时，守门人请他们把今天记住的一件小事写下来，寄给下一位需要勇气的人。`,tasks:Object.fromEntries(participants.map((p,i)=>[p.accountId,`让${p.playerRole.slice(0,12)}${['注意到一个被忽略的声音，并提出一个与当前线索有关的问题','用自己熟悉的方式安慰一个故事中的路人，并发现一件小物品','在自己的判断出现偏差后承认误会，主动换一种方法调查','用一个具体的动作表达信任，并为大家留下可以继续追查的线索'][i%4]}。`]))};
}
function fallback(spec:PoolSpec,excluded:string[],active:string[]):PoolItem{
  let value:PoolItem['value'];
  if(spec.gameId==='story')value=fallbackStory(spec.participants,excluded.length);
  else if(spec.gameId==='draw')value=DRAW_FALLBACK.find(w=>!excluded.includes(w.word))??DRAW_FALLBACK[excluded.length%DRAW_FALLBACK.length];
  else if(spec.gameId==='dont'){
    const base=buildChallenge({...spec.context!,excludedContents:excluded});
    const word=DONT_CHALLENGE_WORDS.find(w=>!excluded.includes(w)&&!/回忆|怀疑|静默|拒绝/.test(w))??base.content;
    value={...base,id:randomUUID(),content:word};
  }else{
    const candidates=buildSecretMissionBatch(spec.context!,100,excluded);
    value=candidates.find(c=>!excluded.includes(c.content)&&isDistinctSecretMission(c.content,active))??buildChallenge({...spec.context!,excludedContents:[...excluded,...active]});
  }
  return {id:randomUUID(),value,source:'local',usedAt:null};
}
// Caller owns the room transaction; the worker uses the same room row lock to append.
export async function takePoolItem(store:Store,room:RoomSnapshot,gameId:PoolGame,accountId:string|null=null,active:string[]=[]):Promise<PoolItem>{
  const spec=(await poolSpecs(store,room)).find(s=>s.gameId===gameId&&s.accountId===accountId);if(!spec)throw new Error('请先设置 MBTI 和角色');
  const pool=await readPool(store,spec),excluded=await exclusions(store,spec);
  if(pool.fingerprint!==spec.fingerprint){pool.items=pool.items.filter(i=>i.usedAt);pool.fingerprint=spec.fingerprint;}
  let item=pool.items.find(i=>!i.usedAt&&(gameId!=='must'||isDistinctSecretMission((i.value as Challenge).content,active)));
  if(!item){item=fallback(spec,excluded,active);pool.items.push(item);}
  item.usedAt=new Date().toISOString();await savePool(store,spec,pool);await enqueuePool(store,spec);return item;
}
export function validateBatch(gameId:PoolGame,raw:unknown,spec:PoolSpec,excluded:string[]):PoolItem[]{
  const values=(raw as {items?:unknown[]})?.items;if(!Array.isArray(values))throw new Error('AI 题库格式不正确');
  const seen=new Set(excluded.map(normalize));const accepted:PoolItem[]=[];
  for(const rawValue of values.slice(0,gameId==='story'?2:10)){
    try{
      let value:PoolItem['value'];
      if(gameId==='story'){
        value=validateStoryBundle(rawValue,spec.participants);
        if(value.opening.length<150||value.opening.length>250||value.ending.length<100||value.ending.length>200||value.endingHint.length<30||value.endingHint.length>60||Object.values(value.tasks).some(t=>t.length<20||t.length>60)||unsafe.test(JSON.stringify(value)))continue;
      }else if(gameId==='draw'){
        const w=rawValue as DrawWord;if(typeof w.word!=='string'||w.word.length<1||w.word.length>12||!['easy','medium'].includes(w.difficulty)||unsafe.test(w.word)||/勇气|命运|友情|能力|灵魂|剧情/.test(w.word)||spec.participants.some(p=>p.playerRole===w.word))continue;
        value={word:w.word,aliases:Array.isArray(w.aliases)?w.aliases.filter(a=>typeof a==='string'&&a.length>0&&a.length<=12&&!unsafe.test(a)).slice(0,4):[],difficulty:w.difficulty};
      }else{
        const content=typeof rawValue==='string'?rawValue:(rawValue as {content?:unknown})?.content;if(typeof content!=='string')continue;
        if(gameId==='dont'&&(content.length>12||/呼吸|眨眼|心跳|然后|并且|同时|或者|保持|10秒静默/.test(content)))continue;
        if(gameId==='must'&&!isLowCorrelationSecretMission(content))continue;
        value={...buildChallenge(spec.context!),id:randomUUID(),content};if(!validateChallenge(value)||unsafe.test(content))continue;
      }
      const item:PoolItem={id:randomUUID(),value,source:'ai',usedAt:null};const normalized=normalize(contentOf(item));if(seen.has(normalized))continue;seen.add(normalized);accepted.push(item);
    }catch{/* Reject only the malformed item, retaining the valid remainder. */}
  }
  return accepted;
}
const prompts:Record<PoolGame,string>={
  dont:'生成10个不要做词牌，2–12字，一个可观察动作或口头词。结合角色常用表达和自然习惯，避免冷门剧情、必然触发、复合条件、抽象心理活动。返回 {items:["点头",...]}。不要照抄示例。',
  must:'生成10张角色相关且容易玩的秘密任务。格式“当看到有人【触发】，你必须立刻【动作】”。触发从给定自然行为中选；执行须与触发低关联，不要重复同一类型。执行只用：小声说一句“1–12字角色风格短句”；用沉稳/温柔/活泼/认真的语气说一句“1–12字短句”；做一次抱拳/叉腰/托腮/竖起拇指/比出猫爪/双手背后站定的姿势。执行最长24字。角色风格新创短句不冒充原作台词。MBTI只调节表现强度。返回 {items:["当看到有人……，你必须立刻……"]}。',
  draw:'生成10个适合接力画画猜词的词条，7个easy、3个medium。具体可画的物品、生物、简单场景，融入已知角色代表物；不考冷门设定，不用抽象能力、复杂剧情或人物名字，不依赖文字作画。aliases仅为确切同义名称，不能包含过宽类别词。返回 {items:[{word:string,aliases:string[],difficulty:"easy"|"medium"}]}。',
  story:'生成指定数量的完整故事接龙套装。跨IP角色处于同一易懂场景。opening 150–250字，交代地点、共同目标、冲突与可续写线索；endingHint 30–60字，只透露氛围，不能暗示真相；ending 100–200字，解决开篇冲突，允许不同接龙路径；tasks为每个参与者恰好一条20–60字秘密任务，可在2–5句话中完成，贴合人设、不强迫其他玩家行动、不泄露结局。返回 {items:[{opening,endingHint,ending,tasks:{参与者accountId:任务}}]}。'
};
export async function generatePoolCommit(store:Store,job:BackgroundJob){
  const spec=job.payload.spec as unknown as PoolSpec;const room=await store.getRoom(spec.code);
  if(!room||room.closedAt)return async()=>{};
  const current=(await poolSpecs(store,room)).find(s=>s.key===spec.key);if(current?.fingerprint!==spec.fingerprint)return async()=>{};
  const pool=await readPool(store,spec);const remaining=pool.fingerprint===spec.fingerprint?pool.items.filter(i=>!i.usedAt).length:0;if(remaining>threshold(spec.gameId))return async()=>{};
  const excluded=await exclusions(store,spec);
  const raw=await aiJson('你是线下角色聚会出题编辑。角色相关且容易玩，禁止危险、身体接触、羞辱、隐私披露、需要特殊道具。'+prompts[spec.gameId],{context:spec.context?{...spec.context,role:{...spec.context.role,id:undefined,generation:undefined}}:undefined,participants:spec.participants,count:spec.gameId==='story'?2-remaining:10,excluded:excluded.slice(-150),triggers:spec.gameId==='must'?SECRET_MISSION_TRIGGERS:undefined},spec.gameId==='story'?14000:4000);
  let items=validateBatch(spec.gameId,raw,spec,excluded);
  if(!items.length)throw new Error('生成内容未通过质量检查');
  const review=await aiJson('审核聚会题目，只返回 {accepted:[合格项从0开始的索引]}。拒绝不能现场完成、角色事实无依据、触发与执行高关联、近义重复、画词不可画或别名不等价、故事前后矛盾、秘密任务泄露结局的内容。可以新创故事和角色风格表达，但不能冒充原作事实。',{game:spec.gameId,context:spec.context,participants:spec.participants,items:items.map(i=>i.value)},1000) as {accepted?:number[]};
  const approved=new Set(Array.isArray(review.accepted)?review.accepted:[]);items=items.filter((_,i)=>approved.has(i));if(!items.length)throw new Error('生成内容未通过质量复核');
  return async(tx:Store)=>{
    const latestRoom=await tx.getRoom(spec.code);if(!latestRoom||latestRoom.closedAt)return;
    const latest=(await poolSpecs(tx,latestRoom)).find(s=>s.key===spec.key);if(latest?.fingerprint!==spec.fingerprint)return;
    const saved=await readPool(tx,spec);if(saved.fingerprint!==spec.fingerprint){saved.items=saved.items.filter(i=>i.usedAt);saved.fingerprint=spec.fingerprint;}
    const used=new Set((await exclusions(tx,spec)).map(normalize));
    for(const item of items){const value=normalize(contentOf(item));if(!used.has(value)){saved.items.push(item);used.add(value);}}
    await savePool(tx,spec,saved);
  };
}
export function matchesDraw(word:DrawWord,guess:string){const answer=normalize(guess);return Boolean(answer)&&[word.word,...word.aliases].some(w=>normalize(w)===answer);}
