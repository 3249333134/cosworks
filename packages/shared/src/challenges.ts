import type { Challenge, GameId, IpRole, Mbti } from './types.js';

type Template = Omit<Challenge, 'id' | 'content' | 'roleTags'> & { content: (role: IpRole, mbti: Mbti, playerCount: number) => string };

const safe = (gameId: GameId, title: string, mode: Challenge['interactionMode'], socialLoad: 1|2|3, publicPerformance: boolean, content: Template['content'], completionCriteria: string): Template => ({
  gameId, title, content, interactionMode: mode, socialLoad, completionCriteria, riskLevel:'low',
  requirements:{ props:'none', camera:mode==='camera', drawing:mode==='draw', physicalContact:false, publicPerformance }
});

export const DONT_CHALLENGE_WORDS = [
  '拿出东西','转头','说谢谢','说钱','说明星名','说不知道','道歉','鼓掌','点头','说好听','拒绝表演节目','靠椅子','抖腿','摇头','扶眼镜','说不是','露齿笑','唱歌','大声说话','说好的','说可以','说你觉得','站起来','翘二郎腿','说数字','看时间','猜拳','夸别人','拒绝别人','说哪里','扶额','比耶','整理衣服','说老师名字','说没有','回头看','提问','回答问题','手指别人','说好难','说哦','瞪眼','摸后脑勺','说开始','说不要','捂嘴','说回家','说不怕','挥手','称赞别人','向上看','大笑','说为什么','怀疑别人','回忆','说别动','说考试','说英文','握拳','掌心向上','摸嘴唇','说加油','说成语','10秒静默','打哈欠','说咱们','说我想想','双手交叉抱胸','模仿别人','鞠躬','安慰别人','说方言','说该谁了','说轮到你了','使眼色','说我不说','讨论玩法','手放腿上','说听不清','说没事','打赌','摸头发','摸鼻子','说知道','说明天','手放口袋','说你','说我','表示同意'
] as const;

export const SECRET_MISSION_TRIGGERS = ['吃零食','喝水','笑出声','坐下','拿起手机','打哈欠','挠头','整理头发','叹气','主动搭话','戴着耳机刷手机','整理桌面物品','到处找东西','反复看时间','突然走神发呆','凑过去讲八卦','突然说脑洞话题','站起来走路','弯腰捡东西','挥手','喝饮料','指方向','拍手','点头','摇头','看向门口','说谢谢','说不知道','提问题','回答问题','看向窗外','整理衣服','伸懒腰','拿起杯子','放下手机','翻看菜单','叫别人名字','说可以','说为什么','说没事','看向天花板','摸鼻子','扶眼镜','双手抱胸','换座位','递出东西','回头看','说数字'] as const;
export type SecretMissionTier='stealth'|'balanced'|'meme';
export const SECRET_MISSION_ACTIONS:Record<SecretMissionTier,readonly string[]>={
  stealth:['轻轻咳嗽两声','揉一下自己的眼睛','慢慢伸一个懒腰','深呼吸一大口气','整理一下自己的衣领','搓一搓自己的双手','轻轻敲一下桌面','捋一下自己的袖子','轻轻摸一下自己的鼻子','眨三下眼睛','轻轻跺一下脚','双手交叉抱胸一次','扶一下自己的额头','抿一下嘴唇'],
  balanced:['原地轻轻跳一下','小声说一句“天气真好”','原地转半圈','拍手两下','打一个响指','捂一下嘴巴','竖起大拇指','比一个剪刀手','小声说一句“原来如此”','轻轻鼓掌三下','模仿一次猫爪动作','向上看三秒','握拳举到胸前一次','用播音腔说一句“收到”'],
  meme:['模仿一次正太扭腰动作','模仿哈兰德走姿走两步','做一个 Scuba 潜水舞动作','做出一次踢球假动作','说一句“真爱降临”','念一句“怀八荒，入酒虫”','做一个手搓 emoji 表情','大声说一句“太狂拽酷霸炫”','双手背后做一次负鼠式淡定动作','说一句“爱你老己”','摆手说一句“勿扰吧你”','做两个武BOT机械动作','说一句“活人感上线”','说一句“进城办事”']
};
export const SECRET_MISSION_TRENDS = [
  {id:'possum',label:'负鼠式淡定',action:'双手背后做一次负鼠式淡定动作',validFrom:'2026-06-01',validUntil:'2026-12-31',safe:true},
  {id:'love-yourself',label:'爱你老己',action:'说一句“爱你老己”',validFrom:'2026-06-01',validUntil:'2026-12-31',safe:true},
  {id:'do-not-disturb',label:'勿扰吧你',action:'摆手说一句“勿扰吧你”',validFrom:'2026-06-01',validUntil:'2026-12-31',safe:true},
  {id:'bot',label:'武BOT机械动作',action:'做两个武BOT机械动作',validFrom:'2026-06-01',validUntil:'2026-12-31',safe:true},
  {id:'alive',label:'活人感上线',action:'说一句“活人感上线”',validFrom:'2026-06-01',validUntil:'2026-12-31',safe:true}
] as const;

const SECRET_MISSION_PATTERN=/^当看到有人(.{1,32})，你必须(?:立刻)?(.{1,45})$/;
const SECRET_MISSION_SEMANTIC_GROUPS=[
  /吃|零食|咀嚼|喝|水|饮料|杯/,
  /坐|站|起身|蹲/,
  /笑|哭|生气|惊讶/,
  /点头|摇头|转头|抬头|甩头/,
  /挥手|鼓掌|拍手|拍一下手|比耶|握拳/,
  /手机|拍照|看时间|手表/,
  /说|提问|回答|喊|语气|播音|台词|收到|合理|想想|原来如此/,
  /伸懒腰|转一圈|跳/
] as const;

export function isLowCorrelationSecretMission(content:string):boolean{
  const parts=SECRET_MISSION_PATTERN.exec(content);if(!parts)return false;
  const trigger=parts[1];const action=parts[2];
  if(!SECRET_MISSION_TRIGGERS.includes(trigger as typeof SECRET_MISSION_TRIGGERS[number]))return false;
  const roleSpeech=/^(?:小声|用(?:沉稳|温柔|活泼|认真)的语气)说一句“[^“”\n]{1,12}”$/.test(action);
  const rolePose=/^做一次(?:抱拳|叉腰|托腮|竖起拇指|比出猫爪|双手背后站定)的姿势$/.test(action);
  if(!Object.values(SECRET_MISSION_ACTIONS).flat().includes(action)&&!roleSpeech&&!rolePose)return false;
  if(/亲吻|拥抱|脱衣|喝酒|密码|住址|手机号|辱骂|打人|自杀|去死/.test(action))return false;
  if(action.length>24||/或|以及|并且|同时|然后|随后/.test(trigger)||/然后|随后|并且|同时|接着|再做|后说|后再|保持.+后|，(?:用|并|再|然后|同时|接着)/.test(action))return false;
  if(SECRET_MISSION_SEMANTIC_GROUPS.some(group=>group.test(trigger)&&group.test(action)))return false;
  const normalize=(value:string)=>value.replace(/[“”"'，。！？、　\s]/g,'').replace(/别人|某人|立刻|一下|一次|三秒/g,'');
  const normalizedTrigger=normalize(trigger);const normalizedAction=normalize(action);
  return normalizedTrigger.length<2||(!normalizedAction.includes(normalizedTrigger)&&!normalizedTrigger.includes(normalizedAction));
}

function normalizeMissionPart(value:string){return value.replace(/[“”"'，。！？、　\s]/g,'').replace(/别人|某人|立刻|一下|一次|三秒/g,'');}
function missionParts(content:string){const parts=SECRET_MISSION_PATTERN.exec(content);return parts?{trigger:normalizeMissionPart(parts[1]),action:normalizeMissionPart(parts[2])}:null;}
function actionTemplate(action:string){
  if(/^用.+?(?:语气|口吻|声音)(?:说|喊|念)/.test(action))return '角色语气表达';
  if(/^双手背后/.test(action))return '背手淡定姿势';
  if(/摆手/.test(action))return '摆手表达';
  if(/模仿猫爪/.test(action))return '猫爪模仿';
  if(/展开双臂/.test(action))return '展开双臂表达';
  if(/整理衣领/.test(action))return '整理衣领表达';
  if(/武BOT|机械动作/.test(action))return '机械动作';
  const spoken=action.match(/(?:说|喊|念)(.+)$/);if(spoken)return `说:${spoken[1]}`;
  return action.replace(/^用.+?(?:的)?语气/,'用角色语气').replace(/^模仿(?:一次)?(?:.+?)(?:的)?(?:招牌)?动作$/,'模仿角色动作');
}

export function isDistinctSecretMission(content:string,existingContents:string[]):boolean{
  const candidate=missionParts(content);if(!candidate)return false;
  return existingContents.every(existing=>{
    const other=missionParts(existing);if(!other)return content!==existing;
    return candidate.trigger!==other.trigger&&actionTemplate(candidate.action)!==actionTemplate(other.action);
  });
}

export function secretMissionTier(role:IpRole,mbti:Mbti):SecretMissionTier {const active=role.personaTags.some(tag=>/活泼|外向|热情|搞笑|跳脱|大胆/.test(tag));return mbti.startsWith('I')?'stealth':active?'meme':'balanced';}
export function secretMissionTierPlan(role:IpRole,mbti:Mbti):SecretMissionTier[]{
  let counts=mbti.startsWith('I')?{stealth:5,balanced:4,meme:1}:{stealth:3,balanced:4,meme:3};
  const active=role.personaTags.some(tag=>/活泼|外向|热情|搞笑|跳脱|大胆/.test(tag));const calm=role.personaTags.some(tag=>/安静|内向|沉稳|温柔|冷静|克制/.test(tag));
  if(active&&counts.stealth>1){counts={...counts,stealth:counts.stealth-1,meme:counts.meme+1};}else if(calm&&counts.meme>1){counts={...counts,stealth:counts.stealth+1,meme:counts.meme-1};}
  const result:SecretMissionTier[]=[];const order:SecretMissionTier[]=['balanced','stealth','meme'];while(result.length<10)for(const tier of order)if(counts[tier]>0){result.push(tier);counts[tier]-=1;}const seed=[role.ipTheme,role.name,mbti].join('|');const shift=[...seed].reduce((total,char)=>total+char.charCodeAt(0),0)%result.length;return [...result.slice(shift),...result.slice(0,shift)];
}
export function parseSecretMission(content:string){const parts=SECRET_MISSION_PATTERN.exec(content);return parts?{trigger:parts[1],action:parts[2]}:null;}
export function composeSecretMission(trigger:string,action:string){return `当看到有人${trigger}，你必须立刻${action}`;}
export function isUniqueSecretMission(content:string,existingContents:string[]){const normalized=normalizeMissionPart(content);return existingContents.every(existing=>normalizeMissionPart(existing)!==normalized);}
export function buildSecretMissionBatch(context:ChallengeContext,count=10,excluded:string[]=[]):Challenge[]{
  const plan=secretMissionTierPlan(context.role,context.mbti);const seed=[context.role.ipTheme,context.role.name,context.mbti,...context.role.personaTags].join('|');const start=[...seed].reduce((total,char)=>((total*31)+char.charCodeAt(0))>>>0,0);const used=[...excluded];const result:Challenge[]=[];
  for(let index=0;index<count;index++){const tier=plan[index%plan.length];const actions=SECRET_MISSION_ACTIONS[tier];let chosen:string|undefined;for(let offset=0;offset<SECRET_MISSION_TRIGGERS.length*actions.length;offset++){const trigger=SECRET_MISSION_TRIGGERS[(start+index*7+offset)%SECRET_MISSION_TRIGGERS.length];const action=actions[(start+index*5+Math.floor(offset/SECRET_MISSION_TRIGGERS.length))%actions.length];const content=composeSecretMission(trigger,action);if(isLowCorrelationSecretMission(content)&&isUniqueSecretMission(content,used)){chosen=content;break;}}const content=chosen??composeSecretMission(SECRET_MISSION_TRIGGERS[(start+index)%SECRET_MISSION_TRIGGERS.length],actions[(start+index)%actions.length]);used.push(content);const source=templates.must[0];result.push({...source,id:`must-v7-${[...content].reduce((total,char)=>((total*31)+char.charCodeAt(0))>>>0,0)}`,title:{stealth:'基础隐蔽款',balanced:'MBTI 触发款',meme:'网络梗整活款'}[tier],content,socialLoad:tier==='stealth'?1:tier==='balanced'?2:3,completionCriteria:'每次出现触发动作时完整执行；被完整指认或确认违规后强制换卡',roleTags:[...context.role.personaTags]});}
  return result;
}
function secretMission(role:IpRole,mbti:Mbti,excluded:string[]=[]){
  const seed=[role.ipTheme,role.name,mbti,...role.personaTags].join('|');const start=[...seed].reduce((total,char)=>((total*31)+char.charCodeAt(0))>>>0,0);
  const actions=SECRET_MISSION_ACTIONS[secretMissionTier(role,mbti)];
  const combinations=SECRET_MISSION_TRIGGERS.flatMap(trigger=>actions.map(action=>`当看到有人${trigger}，你必须立刻${action}`)).filter(isLowCorrelationSecretMission);
  const ordered=Array.from({length:combinations.length},(_,offset)=>combinations[(start+offset)%combinations.length]);
  return ordered.find(content=>isDistinctSecretMission(content,excluded))??ordered.find(content=>!excluded.includes(content))??combinations[start%combinations.length];
}

const templates: Record<GameId, Template[]> = {
  dont: [safe('dont','秘密禁令','tap',1,false,()=>DONT_CHALLENGE_WORDS[0],'完成该动作或说出该词后被其他玩家明确指出')],
  must: [safe('must','触发秘密任务','tap',1,false,(r,m)=>secretMission(r,m),'看见他人完成触发动作后，立即完成卡片要求的动作')],
  witch: [safe('witch','秘密落点','tap',1,false,(r)=>`把「${r.ability || r.name + '的能力'}」藏进一个未选择的格子。`,'点击一个可用格子并确认')],
  camera: [safe('camera','避开镜头','camera',2,true,(r)=>`以${r.name}的姿态完成一个定格动作，并在倒计时内避开镜头。`,'摄像成功或主持人现场判定')],
  draw: [safe('draw','画出角色','draw',1,false,(r)=>`画出能让大家想到「${r.name}」的一个特征。`,'提交包含有效笔迹的画板')],
  imitate: [safe('imitate','角色瞬间','speak',2,true,(r)=>`用一句话和一个动作演出${r.name}的标志性瞬间。`,'完成表演并进入匿名评分')],
  undercover: [safe('undercover','秘密描述','speak',2,true,(r)=>`从${r.name}的视角描述你的秘密词，不要直接说出它。`,'完成一句不含答案的描述')],
  truth: [safe('truth','角色人设版','tap',1,false,(r)=>`围绕${r.name}写两条严格符合原作的描述和一条可信的虚构描述。`,'提交三条角色描述并标记虚构项')],
  story: [safe('story','接龙任务','speak',2,true,(r)=>`在你的段落中，让${r.name}用自己的方式推进剧情，同时完成一个隐藏目标。`,'提交一段 2-5 句话的续写，与上文连续且包含自己的角色')],
  auction: [safe('auction','随身拍品','camera',2,true,(r)=>`手持你私藏的一件随身物品，扮演${r.name}的身份介绍它的来历，并让大家竞相出价。`,'拍照上传物品并填写名称与介绍文本')],
  shopping: [safe('shopping','一起采购','tap',1,false,(r)=>`按${r.name}的角色气质采购一件聚会有用的物品。`,'在拍卖后的个人预算内登记采购结果')]
};

export interface ChallengeContext { gameId: GameId; mbti: Mbti; role: IpRole; playerCount?: number; seenIds?: string[]; excludedContents?: string[]; cameraAvailable?: boolean }

export function buildChallenge(context: ChallengeContext): Challenge {
  if(context.gameId==='dont'){
    const source=templates.dont[0];const excluded=new Set(context.excludedContents??[]);const seed=[context.role.ipTheme,context.role.name,context.mbti,...context.role.personaTags].join('|');
    const start=[...seed].reduce((total,char)=>((total*31)+char.charCodeAt(0))>>>0,0)%DONT_CHALLENGE_WORDS.length;
    const content=Array.from({length:DONT_CHALLENGE_WORDS.length},(_,offset)=>DONT_CHALLENGE_WORDS[(start+offset)%DONT_CHALLENGE_WORDS.length]).find(item=>!excluded.has(item))??DONT_CHALLENGE_WORDS[start];
    return {...source,id:`dont-${start}`,content,roleTags:[...context.role.personaTags]};
  }
  if(context.gameId==='must'){
    const source=templates.must[0];const tier=secretMissionTier(context.role,context.mbti);const content=secretMission(context.role,context.mbti,context.excludedContents);const title={stealth:'基础隐蔽款',balanced:'MBTI 触发款',meme:'网络梗整活款'}[tier];return {...source,id:`must-v7-${[...content].reduce((total,char)=>((total*31)+char.charCodeAt(0))>>>0,0)}`,title,content,socialLoad:tier==='stealth'?1:tier==='balanced'?2:3,completionCriteria:'每次出现触发动作时完整执行；被完整指认或确认违规后强制换卡',roleTags:[...context.role.personaTags]};
  }
  const pool = templates[context.gameId].filter(item => context.cameraAvailable !== false || !item.requirements.camera);
  const available = pool.length ? pool : templates[context.gameId];
  const unseen = available.filter((_, index) => !context.seenIds?.includes(`${context.gameId}-${index}`));
  const source = unseen[0] ?? available[0];
  const index = templates[context.gameId].indexOf(source);
  return { ...source, id:`${context.gameId}-${index}`, content:source.content(context.role, context.mbti, Math.max(2,context.playerCount??2)), roleTags:[...context.role.personaTags] };
}

export function validateChallenge(challenge: Challenge): boolean {
  const unsafe=/(亲吻|拥抱|触摸|拍打别人|拉手|推开|身体接触|脱衣|喝酒|饮酒|脏话|透露.{0,6}(密码|隐私|住址|手机号)|危险动作|购买道具)/;
  return challenge.riskLevel === 'low'
    && challenge.requirements.props === 'none'
    && challenge.requirements.physicalContact === false
    && challenge.content.length >= (challenge.gameId==='dont'?2:4)
    && challenge.content.length <= (challenge.gameId==='must'?100:200)
    && (challenge.gameId!=='must'||isLowCorrelationSecretMission(challenge.content))
    && challenge.completionCriteria.length >= 4
    && !unsafe.test(`${challenge.content}${challenge.completionCriteria}`);
}
