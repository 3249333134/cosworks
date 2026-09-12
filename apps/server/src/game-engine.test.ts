import { describe, expect, it } from 'vitest';
import type { GameAction, IpRole, Mbti, RoomSnapshot } from '@ruxiju/shared';
import { advanceGameStage, ensureWitchGame, gameOverview, handleGameAction, playerSnapshot, settleGame, startGame } from './game-engine.js';

const role=(id:string,name:string):IpRole=>({id,ipTheme:'罗小黑战记',name,personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true});
const witchPlan={id:'plan-witch',gameId:'witch' as const,createdAt:'2026-01-01T00:00:00.000Z'};
const action=(actionId:string,accountId:string,actionName:string,payload:Record<string,unknown>):[string,GameAction]=>[accountId,{actionId,gameId:'witch',action:actionName,payload}];
const privateWitch=(room:RoomSnapshot,accountId:string)=>playerSnapshot(room,accountId).game?.privateState?.witch as {revealedCells:Array<{cell:number;hit:boolean;buriedByName?:string;punishment?:string}>};

describe('witch game',()=>{
  it('collects one punishment each, then shares every investigation until all poison is found',()=>{
    const room:RoomSnapshot={id:'room-1',code:'ABC234',name:'测试局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:[
      {id:'ma',accountId:'a',displayName:'阿一',isOwner:true,hostRole:'owner',playerRole:'无限',ipRoleId:'ra',team:'甲',ready:true,online:true,score:0},
      {id:'mb',accountId:'b',displayName:'阿二',isOwner:false,hostRole:null,playerRole:'小黑',ipRoleId:'rb',team:'甲',ready:true,online:true,score:0},
      {id:'mc',accountId:'c',displayName:'阿三',isOwner:false,hostRole:null,playerRole:'风息',ipRoleId:'rc',team:'甲',ready:true,online:true,score:0},
    ],currentGame:null,game:null,gamePlan:[witchPlan],planCursor:0,planRound:1,closedAt:null};
    const profiles=new Map<string,{mbti:Mbti;role:IpRole}>([['a',{mbti:'ENFP',role:role('ra','无限')}],['b',{mbti:'ISTJ',role:role('rb','小黑')}],['c',{mbti:'INTJ',role:role('rc','风息')}]]);
    startGame(room,'witch',profiles);
    for(const [accountId,input] of [action('bury-a','a','witch-bury',{cell:1,punishment:'模仿角色说一句台词'}),action('bury-b','b','witch-bury',{cell:2,punishment:'夸下一位玩家一句'}),action('bury-c','c','witch-bury',{cell:3,punishment:'摆一个角色招牌动作'})])handleGameAction(room,accountId,input);
    expect(room.game?.publicState).toMatchObject({stage:'investigate',buriedCount:3,foundPoisonCount:0,revealedCellCount:0});
    expect(playerSnapshot(room,'b').game?.privateState?.witch).toMatchObject({hasBuried:true,ownCell:2,punishment:'夸下一位玩家一句',revealedCells:[],completed:false});
    expect(playerSnapshot(room,'b').game?.privateState).not.toHaveProperty('witch.deposits');
    const hostBoard=gameOverview(room,'a')?.witch?.cells??[];
    const guestBoard=gameOverview(room,'b')?.witch?.cells??[];
    expect(hostBoard.find(cell=>cell.cell===1)).toEqual({cell:1,state:'hidden'});
    expect(hostBoard.find(cell=>cell.cell===2)).toEqual({cell:2,state:'hidden'});
    expect(guestBoard.find(cell=>cell.cell===2)).toEqual({cell:2,state:'hidden'});
    expect(guestBoard.find(cell=>cell.cell===1)).toEqual({cell:1,state:'hidden'});

    handleGameAction(room,...action('find-a1','a','witch-investigate',{cell:1}));
    expect(privateWitch(room,'b').revealedCells).toEqual(expect.arrayContaining([expect.objectContaining({cell:1,hit:true,buriedByName:'阿一'})]));
    expect(()=>handleGameAction(room,...action('find-b1','b','witch-investigate',{cell:1}))).toThrow('已经被大家排查过');
    handleGameAction(room,...action('find-b2','b','witch-investigate',{cell:2}));
    expect(room.status).toBe('running');
    handleGameAction(room,...action('find-c3','c','witch-investigate',{cell:3}));
    expect(room.status).toBe('settled');
    expect(room.game?.publicState).toMatchObject({stage:'complete',foundPoisonCount:3,revealedCellCount:3});
    expect(room.game?.publicState).not.toHaveProperty('revealedCells');
    expect(privateWitch(room,'a').revealedCells).toEqual(expect.arrayContaining([
      expect.objectContaining({cell:1,hit:true,buriedByName:'阿一',punishment:'模仿角色说一句台词'}),
      expect.objectContaining({cell:2,hit:true,buriedByName:'阿二',punishment:'夸下一位玩家一句'}),
    ]));
  });

  it('reveals duplicate deposits together and records the player who clicked',()=>{
    const room:RoomSnapshot={id:'room-2',code:'DEF234',name:'测试局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:['a','b','c'].map((accountId,index)=>({id:`m${accountId}`,accountId,displayName:`玩家${index+1}`,isOwner:index===0,hostRole:index===0?'owner':null,playerRole:'角色',ipRoleId:`r${accountId}`,team:'甲',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[witchPlan],planCursor:0,planRound:1,closedAt:null};
    const profiles=new Map<string,{mbti:Mbti;role:IpRole}>(['a','b','c'].map(accountId=>[accountId,{mbti:'ENFP',role:role(`r${accountId}`,'角色')} ]));
    startGame(room,'witch',profiles);
    handleGameAction(room,...action('bury-a','a','witch-bury',{cell:1,punishment:'说一句台词'}));
    handleGameAction(room,...action('bury-b','b','witch-bury',{cell:1,punishment:'摆一个动作'}));
    handleGameAction(room,...action('bury-c','c','witch-bury',{cell:3,punishment:'夸一句'}));
    handleGameAction(room,...action('find-a','a','witch-investigate',{cell:1}));
    expect(privateWitch(room,'a').revealedCells).toHaveLength(2);
    expect(privateWitch(room,'b').revealedCells).toHaveLength(2);
    expect(privateWitch(room,'c').revealedCells).toHaveLength(2);
    expect(room.game?.publicState).toMatchObject({foundPoisonCount:2,revealedCellCount:1});
    expect(()=>handleGameAction(room,...action('find-b','b','witch-investigate',{cell:1}))).toThrow('已经被大家排查过');
    handleGameAction(room,...action('find-c','c','witch-investigate',{cell:3}));
    expect(room.status).toBe('settled');
  });

  it('upgrades a running legacy witch room without changing its members',()=>{
    const room:RoomSnapshot={id:'legacy',code:'GHJ234',name:'旧房间',ipTheme:'罗小黑战记',status:'running',ownerAccountId:'a',members:['a','b','c'].map((accountId,index)=>({id:`m${accountId}`,accountId,displayName:`玩家${index+1}`,isOwner:index===0,hostRole:index===0?'owner':null,playerRole:'角色',ipRoleId:`r${accountId}`,team:'甲',ready:true,online:true,score:0})),currentGame:'witch',game:{sessionId:'session-legacy',planItemId:'plan-witch',gameId:'witch',phase:'playing',round:1,prompt:'旧规则',primaryAction:'确认这个格子',endsAt:Date.now()+1000,scores:{a:0,b:0,c:0},publicState:{completed:0,total:3}},gamePlan:[witchPlan],planCursor:1,planRound:1,closedAt:null};
    ensureWitchGame(room);
    expect(room.members).toHaveLength(3);
    expect(room.game?.primaryAction).toBe('埋下这个惩罚');
    expect(room.game?.publicState).toMatchObject({stage:'bury',buriedCount:0,total:3});
    expect(room.game?.privateState?.witch).toEqual({boardSize:5,currentRound:1,deposits:{},investigations:{},lastActionAt:{}});
  });
});

describe('secret trigger mission',()=>{
  it('counts every complete execution and settles by fewer card changes then more triggers',()=>{
    const room:RoomSnapshot={id:'must-room',code:'MST234',name:'秘密任务局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:['a','b'].map((accountId,index)=>({id:`m${accountId}`,accountId,displayName:`玩家${index+1}`,isOwner:index===0,hostRole:index===0?'owner':null,playerRole:'角色',ipRoleId:`r${accountId}`,team:'甲',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[{id:'plan-must',gameId:'must',createdAt:'2026-01-01T00:00:00.000Z'}],planCursor:0,planRound:1,closedAt:null};
    const profiles=new Map<string,{mbti:Mbti;role:IpRole}>([['a',{mbti:'INFP',role:role('ra','小黑')}],['b',{mbti:'ENFP',role:{...role('rb','无限'),personaTags:['活泼']} }]]);
    startGame(room,'must',profiles);
    handleGameAction(room,'a',{actionId:'must-a-001',gameId:'must',action:'must-triggered'});
    handleGameAction(room,'a',{actionId:'must-a-002',gameId:'must',action:'must-triggered'});
    handleGameAction(room,'b',{actionId:'must-b-001',gameId:'must',action:'must-triggered'});
    expect(playerSnapshot(room,'a').game?.privateState?.must).toEqual({triggerCount:2,cardChangeCount:0});
    expect(room.status).toBe('running');
    settleGame(room);
    expect(room.game?.publicState.winnerAccountIds).toEqual(['a']);
    expect(room.game?.publicState.results).toEqual([
      {accountId:'a',displayName:'玩家1',cardChangeCount:0,triggerCount:2},
      {accountId:'b',displayName:'玩家2',cardChangeCount:0,triggerCount:1},
    ]);
  });
});

describe('role canon two truths and a lie',()=>{
  it('reports the exact invalid statement instead of silently blocking submission',()=>{
    const room:RoomSnapshot={id:'truth-validation-room',code:'TRUVAL',name:'角色人设局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:[{id:'ma',accountId:'a',displayName:'玩家甲',isOwner:true,hostRole:'owner',playerRole:'无限',ipRoleId:'ra',team:'甲',ready:true,online:true,score:0},{id:'mb',accountId:'b',displayName:'玩家乙',isOwner:false,hostRole:null,playerRole:'小黑',ipRoleId:'rb',team:'甲',ready:true,online:true,score:0}],currentGame:null,game:null,gamePlan:[{id:'plan-truth-validation',gameId:'truth',createdAt:'2026-01-01T00:00:00.000Z'}],planCursor:0,planRound:1,closedAt:null};
    startGame(room,'truth',new Map([['a',{mbti:'ENFJ' as Mbti,role:role('ra','无限')}],['b',{mbti:'INFP' as Mbti,role:role('rb','小黑')}]]));
    expect(()=>handleGameAction(room,'a',{actionId:'truth-submit-invalid',gameId:'truth',action:'truth-submit',payload:{statements:['','2','3'],falseIndex:2}})).toThrow('请填写描述 1（最多 80 个字）');
    expect(()=>handleGameAction(room,'a',{actionId:'truth-submit-short-but-valid',gameId:'truth',action:'truth-submit',payload:{statements:['1','2','3'],falseIndex:2}})).not.toThrow();
  });

  it('keeps the answer private, rotates speakers, scores guesses and deception, then settles',()=>{
    const room:RoomSnapshot={id:'truth-room',code:'TRU234',name:'角色人设局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:['a','b'].map((accountId,index)=>({id:`m${accountId}`,accountId,displayName:index===0?'玩家甲':'玩家乙',isOwner:index===0,hostRole:index===0?'owner':null,playerRole:index===0?'无限':'小黑',ipRoleId:`r${accountId}`,team:'甲',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[{id:'plan-truth',gameId:'truth',createdAt:'2026-01-01T00:00:00.000Z'}],planCursor:0,planRound:1,closedAt:null};
    const profiles=new Map<string,{mbti:Mbti;role:IpRole}>([['a',{mbti:'ENFJ',role:role('ra','无限')}],['b',{mbti:'INFP',role:role('rb','小黑')}]]);
    startGame(room,'truth',profiles);
    const submissions:Record<string,{statements:string[];falseIndex:number}>={
      a:{statements:['无限是会馆的馆长','无限擅长金属系法术','无限害怕所有猫咪'],falseIndex:2},
      b:{statements:['小黑是猫妖','小黑拥有空间系能力','小黑最爱吃辣椒'],falseIndex:2},
    };
    handleGameAction(room,'a',{actionId:'truth-submit-a',gameId:'truth',action:'truth-submit',payload:submissions.a});
    expect(room.game?.publicState).not.toHaveProperty('falseIndex');
    expect(playerSnapshot(room,'b').game?.privateState?.truth).toMatchObject({hasSubmitted:false,falseIndex:null});
    handleGameAction(room,'b',{actionId:'truth-submit-b',gameId:'truth',action:'truth-submit',payload:submissions.b});
    const order=(room.game!.privateState as any).truth.order as string[];
    const first=order[0],second=order[1],firstOther=first==='a'?'b':'a';
    expect(room.game?.publicState).toMatchObject({stage:'voting',speakerAccountId:first,statements:submissions[first].statements,votedCount:0,voterCount:1});
    expect(room.game?.publicState).not.toHaveProperty('falseIndex');
    expect(()=>handleGameAction(room,first,{actionId:'truth-self-vote',gameId:'truth',action:'truth-vote',payload:{statementIndex:2}})).toThrow('不能给自己的描述投票');
    handleGameAction(room,firstOther,{actionId:'truth-vote-other',gameId:'truth',action:'truth-vote',payload:{statementIndex:submissions[first].falseIndex}});
    expect(room.game?.publicState).toMatchObject({stage:'reveal',falseIndex:submissions[first].falseIndex,points:{[firstOther]:1}});
    // 只有当 firstOther 既非当前陈述者也非主持时，推进才会被拒绝
    if(firstOther!=='a'&&firstOther!==first){
      expect(()=>handleGameAction(room,firstOther,{actionId:'truth-next-wrong',gameId:'truth',action:'truth-next'})).toThrow('由当前陈述者或主持人推进下一位');
    }
    handleGameAction(room,first,{actionId:'truth-next-first',gameId:'truth',action:'truth-next'});
    expect(room.game?.publicState).toMatchObject({stage:'voting',speakerAccountId:second});
    const secondOther=second==='a'?'b':'a';
    handleGameAction(room,secondOther,{actionId:'truth-vote-second',gameId:'truth',action:'truth-vote',payload:{statementIndex:0}});
    expect(room.game?.publicState).toMatchObject({stage:'complete',falseIndex:submissions[second].falseIndex});
    expect(room.status).toBe('settled');
  });
});

describe('auction item game',()=>{
  const auctionPlan={id:'plan-auction',gameId:'auction' as const,createdAt:'2026-01-01T00:00:00.000Z'};
  const roomOf=(code:string):RoomSnapshot=>({id:`room-${code}`,code,name:'拍卖测试局',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:[
    {id:'ma',accountId:'a',displayName:'阿甲',isOwner:true,hostRole:'owner',playerRole:'无限',ipRoleId:'ra',team:'甲',ready:true,online:true,score:0},
    {id:'mb',accountId:'b',displayName:'阿乙',isOwner:false,hostRole:null,playerRole:'小黑',ipRoleId:'rb',team:'甲',ready:true,online:true,score:0},
    {id:'mc',accountId:'c',displayName:'阿丙',isOwner:false,hostRole:null,playerRole:'风息',ipRoleId:'rc',team:'甲',ready:true,online:true,score:0},
  ],currentGame:null,game:null,gamePlan:[auctionPlan],planCursor:0,planRound:1,closedAt:null});
  const profilesOf=()=>new Map<string,{mbti:Mbti;role:IpRole}>([['a',{mbti:'ENFP',role:role('ra','无限')}],['b',{mbti:'ISTJ',role:role('rb','小黑')}],['c',{mbti:'INTJ',role:role('rc','风息')}]]);
  const aucAct=(accountId:string,actionId:string,action:string,payload:Record<string,unknown>={}):[string,GameAction]=>[accountId,{actionId,gameId:'auction',action,payload}];
  const start=()=>{const r=roomOf('AU001');startGame(r,'auction',profilesOf());return r;};
  const setBudgetsAll=(r:RoomSnapshot)=>{
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100.10}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:200}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:300.55}));
  };
  const submitAllItems=(r:RoomSnapshot)=>{
    handleGameAction(r,...aucAct('a','s-a','auction-submit-item',{assetId:'asset-a',title:'钢笔',story:'钢笔一支，写过无数便签。'}));
    handleGameAction(r,...aucAct('b','s-b','auction-submit-item',{assetId:'asset-b',title:'手绘明信片',story:'去海边旅行时手绘的一张。'}));
    handleGameAction(r,...aucAct('c','s-c','auction-submit-item',{assetId:'asset-c',title:'老怀表',story:'爷爷传下来的黄铜怀表，还能走。'}));
  };
  it('1. init阶段：设置初始预算进入钱包，全员齐后自动进setup，gameOverview正确同步',()=>{
    const r=start();
    expect(r.game?.publicState).toMatchObject({stage:'init',budgetsSubmitted:0,itemsSubmitted:0,total:3,roundNumber:0,totalRounds:0,priceIncrement:0.1});
    handleGameAction(r,...aucAct('a','b-a1','auction-set-budget',{initialBudget:100.10}));
    expect(r.game?.publicState).toMatchObject({stage:'init',budgetsSubmitted:1,wallets:{a:100.1,b:0,c:0}});
    expect(()=>handleGameAction(r,...aucAct('a','b-a2','auction-set-budget',{initialBudget:500}))).toThrow('你已经输入过初始金额');
    handleGameAction(r,...aucAct('b','b-b1','auction-set-budget',{initialBudget:200}));
    handleGameAction(r,...aucAct('c','b-c1','auction-set-budget',{initialBudget:300.55}));
    expect(r.game?.publicState.stage).toBe('setup');
    const overview=gameOverview(r,'a');
    expect(overview?.auction?.wallets).toEqual({a:100.1,b:200,c:300.55});
  });
  it('2. 非法预算值拒绝：非数字、负数、上限超100万',()=>{
    const r=start();
    expect(()=>handleGameAction(r,...aucAct('a','bad-1','auction-set-budget',{initialBudget:'hello'}))).toThrow('金额必须是最多两位小数的有效数字');
    expect(()=>handleGameAction(r,...aucAct('a','bad-2','auction-set-budget',{initialBudget:-0.01}))).toThrow('初始金额必须在 0.00～1000000.00 元之间');
    expect(()=>handleGameAction(r,...aucAct('a','bad-3','auction-set-budget',{initialBudget:1_000_001}))).toThrow('初始金额必须在 0.00～1000000.00 元之间');
  });
  it('3. setup阶段：每人上传一件物品，物品顺序与提交顺序一致，重复上传会报错，全员到齐后进入preview并下发lots数组',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:100}));
    expect(r.game?.publicState.stage).toBe('setup');
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'asset-a',title:'旧钢笔',story:'伴随大学四年。'}));
    expect(r.game?.publicState).toMatchObject({stage:'setup',itemsSubmitted:1});
    const lots0=(r.game!.publicState as any).lots as Array<{lotId:string;sellerAccountId:string;title:string}>;
    expect(lots0).toHaveLength(1);expect(lots0[0].title).toBe('旧钢笔');expect(lots0[0].sellerAccountId).toBe('a');
    expect(()=>handleGameAction(r,...aucAct('a','si-a2','auction-submit-item',{assetId:'asset-a2',title:'重复',story:'每人只能一件。'}))).toThrow('你已经提交过一件物品');
    expect(()=>handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'asset-b',title:'',story:'没名字。'}))).toThrow('物品名称需要 1～20 个字');
    handleGameAction(r,...aucAct('b','si-b2','auction-submit-item',{assetId:'asset-b',title:'明信片',story:'旅行手绘。'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'asset-c',title:'老怀表',story:'爷爷传下来的。'}));
    expect(r.game?.publicState.stage).toBe('preview');
    const lots=(r.game!.publicState as any).lots as Array<{title:string}>;
    expect(lots.map(l=>l.title)).toEqual(['旧钢笔','明信片','老怀表']);
  });
  it('3b. setup→preview后，gameOverview.auction.lots 和 lotOrder 同步下发',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:200}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:300}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'asset-a',title:'钢笔',story:'A的钢笔。'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'asset-b',title:'明信片',story:'B的明信片。'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'asset-c',title:'怀表',story:'C的怀表。'}));
    expect(r.game?.publicState.stage).toBe('preview');
    const overview=gameOverview(r,'b');
    expect(overview?.auction?.lots).toHaveLength(3);
    expect(overview?.auction?.lotOrder).toHaveLength(3);
    expect(overview?.auction?.lots.map(l=>l.title)).toEqual(['钢笔','明信片','怀表']);
    expect(overview?.auction?.itemsByAccount).toEqual({a:overview!.auction!.lots[0].lotId,b:overview!.auction!.lots[1].lotId,c:overview!.auction!.lots[2].lotId});
  });
  it('4. bidding出价规则：出售人不能出价、少于+0.1加价拒绝、余额不足拒绝、合法出价写入topBid并留下bidHistory',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:10}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:20}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:30}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'asset-a',title:'钢笔',story:'A的钢笔。'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'asset-b',title:'明信片',story:'B的明信片。'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'asset-c',title:'怀表',story:'C的怀表。'}));
    advanceGameStage(r); // preview→bidding 第一件：A的钢笔
    expect(r.game?.publicState.stage).toBe('bidding');
    expect((r.game!.publicState as any).currentLot.sellerAccountId).toBe('a');
    expect(()=>handleGameAction(r,...aucAct('a','sell-bid','auction-bid',{price:10}))).toThrow('出售人不能给自己的物品出价');
    // 最低出价0.1
    expect(()=>handleGameAction(r,...aucAct('b','low','auction-bid',{price:0.05}))).toThrow('出价必须 ≥ 当前最高价 + 0.1 元（当前最低可出：0.10 元）');
    handleGameAction(r,...aucAct('b','b1','auction-bid',{price:0.10}));
    expect((r.game!.publicState as any).topBid).toMatchObject({accountId:'b',price:0.1});
    // 再次必须≥0.2
    expect(()=>handleGameAction(r,...aucAct('c','low2','auction-bid',{price:0.15}))).toThrow('出价必须 ≥ 当前最高价 + 0.1 元');
    handleGameAction(r,...aucAct('c','c1','auction-bid',{price:0.2}));
    expect((r.game!.publicState as any).topBid).toMatchObject({accountId:'c',price:0.2});
    // B余额20，超出预算报错
    expect(()=>handleGameAction(r,...aucAct('b','over','auction-bid',{price:100}))).toThrow('余额不足');
    // bidHistory 最近记录
    const bh=(r.game!.publicState as any).bidHistory as Array<{accountId:string;price:number}>;
    expect(bh[0]).toMatchObject({accountId:'c',price:0.2});
    expect(bh[1]).toMatchObject({accountId:'b',price:0.1});
  });
  it('5. 出售人轮流落锤成交：钱包买家扣款、卖家加款，lot记录winner和成交价，自动进入下一件，最后一件成交后自动complete并进入settled',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'asset-a',title:'钢笔',story:'A'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'asset-b',title:'明信片',story:'B'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'asset-c',title:'怀表',story:'C'}));
    advanceGameStage(r); // 进入第一件：A的钢笔
    handleGameAction(r,...aucAct('b','bid-a-b','auction-bid',{price:10.00}));
    handleGameAction(r,...aucAct('c','bid-a-c','auction-bid',{price:20.00}));
    handleGameAction(r,...aucAct('a','sold-a','auction-sold')); // 出售人A落锤
    // A卖了钢笔得20，C买了钢笔扣20，B不变
    const w1=(r.game!.publicState as any).wallets as Record<string,number>;
    expect(w1.a).toBeCloseTo(120,2);expect(w1.c).toBeCloseTo(80,2);expect(w1.b).toBeCloseTo(100,2);
    const lotA=(r.game!.publicState as any).lots[0];expect(lotA.sold).toBe(true);expect(lotA.winnerAccountId).toBe('c');expect(lotA.soldPrice).toBeCloseTo(20,2);
    // 进入第二件：B的明信片
    expect((r.game!.publicState as any).stage).toBe('bidding');
    expect((r.game!.publicState as any).currentLot.sellerAccountId).toBe('b');
    handleGameAction(r,...aucAct('c','bid-b-c','auction-bid',{price:5.5}));
    handleGameAction(r,...aucAct('a','bid-b-a','auction-bid',{price:7.9}));
    handleGameAction(r,...aucAct('b','sold-b','auction-sold'));
    const w2=(r.game!.publicState as any).wallets;
    expect(w2.b).toBeCloseTo(107.9,2);expect(w2.a).toBeCloseTo(112.1,2); // A扣7.9；B加7.9
    // 第三件C的怀表：由出售人C流拍
    handleGameAction(r,...aucAct('c','pass-c','auction-pass-lot'));
    expect((r.game!.publicState as any).stage).toBe('complete');
    const lotC=(r.game!.publicState as any).lots[2];expect(lotC.sold).toBe(false);expect(lotC.winnerAccountId).toBe(null);
    expect(r.status).toBe('settled');
  });
  it('6. preview主持重排顺序：仅host有权限，非host抛错；顺序异常情况会被拒绝',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'a1',title:'笔',story:'s'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'b1',title:'卡',story:'s'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'c1',title:'表',story:'s'}));
    const orderBefore=(r.game!.publicState as any).lotOrder as string[];
    expect(orderBefore).toHaveLength(3);
    expect(()=>handleGameAction(r,...aucAct('b','guest-reorder','auction-reorder',{lotOrder:[orderBefore[2],orderBefore[1],orderBefore[0]]}))).toThrow('只有主持能重排拍品顺序');
    expect(()=>handleGameAction(r,...aucAct('a','dup','auction-reorder',{lotOrder:[orderBefore[0],orderBefore[0],orderBefore[1]]}))).toThrow('拍品顺序不能重复');
    expect(()=>handleGameAction(r,...aucAct('a','ghost','auction-reorder',{lotOrder:[orderBefore[0],orderBefore[1],'不存在的id']}))).toThrow('顺序里存在未知拍品');
    handleGameAction(r,...aucAct('a','ok','auction-reorder',{lotOrder:[orderBefore[2],orderBefore[1],orderBefore[0]]}));
    const orderAfter=(r.game!.publicState as any).lotOrder as string[];
    expect(orderAfter).toEqual([orderBefore[2],orderBefore[1],orderBefore[0]]);
    advanceGameStage(r); // 进入bidding第一件，现在是C的物品
    expect((r.game!.publicState as any).currentLot.sellerAccountId).toBe('c');
  });
  it('7. 完整全流程积分规则：富豪榜Top3 5/3/1、成交买卖双方2/1、流拍无分、score累加到member.score',()=>{
    const r=start();
    // 初始预算：A 100 / B 100 / C 100
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:100}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'a1',title:'钢笔',story:'A'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'b1',title:'明信片',story:'B'}));
    handleGameAction(r,...aucAct('c','si-c','auction-submit-item',{assetId:'c1',title:'怀表',story:'C'}));
    advanceGameStage(r);
    // 第一件A的钢笔：B出 50 → 买走
    handleGameAction(r,...aucAct('b','bid1','auction-bid',{price:50}));
    handleGameAction(r,...aucAct('a','sold1','auction-sold'));
    // 钱包：A(+50=150)，B(-50=50)，C(100)
    // 第二件B的明信片：C出 80 → 买走
    handleGameAction(r,...aucAct('c','bid2','auction-bid',{price:80}));
    handleGameAction(r,...aucAct('b','sold2','auction-sold'));
    // 钱包：A(150)，B(+80=130)，C(-80=20)
    // 第三件C的怀表：A出 10 → 买走
    handleGameAction(r,...aucAct('a','bid3','auction-bid',{price:10}));
    handleGameAction(r,...aucAct('c','sold3','auction-sold'));
    // 最终钱包：A(-10=140)，B(130)，C(+10=30)
    // 富豪榜：A=140(+5), B=130(+3), C=30(+1)
    // 买卖积分：每件成交卖家+2 买家+1
    //   第一件：A卖家+2，B买家+1
    //   第二件：B卖家+2，C买家+1
    //   第三件：C卖家+2，A买家+1
    // 合计：A=5+2+1=8  B=3+2+1=6  C=1+2+1=4
    expect(r.status).toBe('settled');
    const membersById=Object.fromEntries(r.members.map(m=>[m.accountId,m]));
    expect(membersById.a.score).toBe(8);
    expect(membersById.b.score).toBe(6);
    expect(membersById.c.score).toBe(4);
    const results=(r.game?.publicState.results as Array<{accountId:string;wallet:number;score:number;delta:number}>)??[];
    expect(results.map(x=>({id:x.accountId,w:x.wallet,s:x.score}))).toEqual([
      {id:'a',w:140,s:8},{id:'b',w:130,s:6},{id:'c',w:30,s:4}
    ]);
    // 富豪Top1 id
    expect(r.game?.publicState.winnerAccountIds).toEqual(['a']);
  });
  it('8. history复盘 buildAuctionHistory：包含所有lots、出价历史、富豪榜和拍卖榜',()=>{
    const r=start();
    handleGameAction(r,...aucAct('a','b-a','auction-set-budget',{initialBudget:50}));
    handleGameAction(r,...aucAct('b','b-b','auction-set-budget',{initialBudget:50}));
    handleGameAction(r,...aucAct('c','b-c','auction-set-budget',{initialBudget:50}));
    handleGameAction(r,...aucAct('a','si-a','auction-submit-item',{assetId:'a1',title:'笔',story:'A的笔'}));
    handleGameAction(r,...aucAct('b','si-b','auction-submit-item',{assetId:'b1',title:'卡',story:'B的卡'}));
    advanceGameStage(r); // setup → preview（C没上传物品，不会自动进preview）
    advanceGameStage(r); // preview → 第一件出价
    handleGameAction(r,...aucAct('b','bid-ab','auction-bid',{price:20}));
    handleGameAction(r,...aucAct('a','sold-a','auction-sold')); // 成交进入第二件B的卡
    handleGameAction(r,...aucAct('a','bid-ba','auction-bid',{price:30.2}));
    handleGameAction(r,...aucAct('b','sold-b','auction-sold')); // 2件都拍完, complete
    expect(r.status).toBe('settled');
    // 最终钱包：A 50-30.2+20=39.8 ; B 50-20+30.2=60.2 ; C 50
    const res=(r.game?.publicState as any).richRanking as Array<{accountId:string;wallet:number}>;
    expect(res[0]).toMatchObject({accountId:'b'});expect(res[0].wallet).toBeCloseTo(60.2,2);
    expect(res[1]).toMatchObject({accountId:'c'});expect(res[1].wallet).toBe(50);
    expect(res[2]).toMatchObject({accountId:'a'});expect(res[2].wallet).toBeCloseTo(39.8,2);
    const aucRank=(r.game?.publicState as any).auctionRanking as Array<{lotId:string;title:string;soldPrice:number;sellerAccountId:string;winnerAccountId:string}>;
    expect(aucRank).toHaveLength(2);
    expect(aucRank[0].soldPrice).toBeGreaterThanOrEqual(aucRank[1].soldPrice);
  });
});
