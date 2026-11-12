import type { GameId } from './types.js';

export interface GameRuleStep {
  /** 主持人可照念的步骤名，≤8 字 */
  title: string;
  /** 一句话说明，≤48 字 */
  detail: string;
}

/** 统一 5 区块规则卡：目标 / 人数时长（自动生成）/ 流程 / 胜负 / 注意 */
export interface GameRuleCard {
  /** 一句话目标，≤30 字，主持人开场念这句 */
  goal: string;
  /** 道具/场地补充说明，可选 */
  props?: string;
  /** 分步流程，3–5 步 */
  flow: GameRuleStep[];
  /** 胜负条件；无胜负玩法写明由主持口头宣布 */
  win: string;
  /** 注意事项，2–3 条短句 */
  tips: string[];
}

export interface GameDefinition {
  id: GameId;
  name: string;
  shortRule: string;
  primaryAction: string;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  glyph: string;
  /** 统一规则卡（唯一来源），规则抽屉渲染用 */
  ruleCard: GameRuleCard;
}

export const GAME_DEFINITIONS: Record<GameId, GameDefinition> = {
  dont: {
    id:'dont', name:'不要做挑战', shortRule:'戴好自己的秘密词牌，引导其他玩家触发并保护自己。', primaryAction:'我已触发，抽下一张', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'禁',
    ruleCard:{
      goal:'引导别人触发你的秘密词，自己别触发别人的。',
      flow:[
        { title:'领词', detail:'每人私密领一张「不要做」词牌，自己看不到内容。' },
        { title:'诱导', detail:'用提问和话题引导别人做出你牌上的动作。' },
        { title:'触发', detail:'有人做出动作并完整说出关键词，即触发成功。' },
        { title:'换牌', detail:'触发后换下一张，全场换牌次数实时排行。' }
      ],
      win:'本场结束时，用词最少、触发别人最多的人获胜。',
      tips:['触发必须完整说出关键词才算。','别主动问别人牌上写了什么。']
    }
  },
  must: {
    id:'must', name:'触发秘密任务', shortRule:'任意玩家触发卡片条件时都要完整执行；换卡越少、成功触发越多，排名越高。', primaryAction:'我已完整执行 1 次', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'触',
    ruleCard:{
      goal:'遇到卡片条件就完整执行任务，执行越多排名越高。',
      flow:[
        { title:'领任务', detail:'每人私密领一张条件任务卡。' },
        { title:'触发', detail:'任何玩家的行为触发你的条件时，你要完整执行。' },
        { title:'指认', detail:'执行后说明「谁 + 做了什么 + 触发了什么」。' },
        { title:'强制换卡', detail:'任务执行后立即换一张新任务。' }
      ],
      win:'换卡次数少者排前；次数相同比成功触发数，多者胜。',
      tips:['条件没被触发就不需要执行。','指认不完整不计入次数。']
    }
  },
  witch: {
    id:'witch', name:'女巫的毒药', shortRule:'每人埋下一份惩罚，再共同排查直到采完全部毒药。', primaryAction:'确认这个格子', minPlayers:3, maxPlayers:20, durationMinutes:15, glyph:'阵',
    ruleCard:{
      goal:'每人埋一份惩罚，再把场上毒药全部采出来。',
      flow:[
        { title:'埋毒', detail:'每人在棋盘选一个格子埋下惩罚（2–60 字）。' },
        { title:'排查', detail:'轮流点格子排查，采到毒药要接受那份惩罚。' },
        { title:'记录', detail:'采过的格子会公开，别重复点。' },
        { title:'循环', detail:'全部采完后进入下一轮或结算。' }
      ],
      win:'采到毒药最多的人获胜，同数并列。',
      tips:['惩罚要安全、当场可执行。','别埋需要道具或身体接触的项目。']
    }
  },
  camera: {
    id:'camera', name:'不能被拍到', shortRule:'在倒计时结束前完成动作并避开镜头。', primaryAction:'开始挑战', minPlayers:2, maxPlayers:20, durationMinutes:8, glyph:'影',
    ruleCard:{
      goal:'在镜头倒计时内完成任务，且不被镜头拍到。',
      flow:[
        { title:'领任务', detail:'私密领取要完成的动作。' },
        { title:'摆拍', detail:'倒计时内摆好造型并完成任务。' },
        { title:'提交', detail:'确认完成后提交，得 10 分。' }
      ],
      win:'多轮累计，完成任务得分最高者获胜。',
      tips:['镜头判定以提交时画面为准。','动作注意安全，别磕碰。']
    }
  },
  draw: {
    id:'draw', name:'Cos 你画我猜', shortRule:'主持人先画原始词，之后每人照着上一幅继续画，最后一位猜词。', primaryAction:'提交画作', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'画',
    ruleCard:{
      goal:'接力作画，让最后一人猜出最初的词。',
      flow:[
        { title:'起笔', detail:'主持人抽词并画下第一幅。' },
        { title:'接龙', detail:'每人只照上一幅画临摹，不能说话。' },
        { title:'揭晓', detail:'最后一位看全部画作，猜出原始词。' }
      ],
      win:'猜中则猜词人得 20 分；没猜中无人得分。',
      tips:['接龙时禁止任何语言提示。','画得越像越好猜。']
    }
  },
  imitate: {
    id:'imitate', name:'人设模仿', shortRule:'演出符合角色的一个瞬间。', primaryAction:'开始表演', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'演',
    ruleCard:{
      goal:'演出角色最有辨识度的一个瞬间。',
      flow:[
        { title:'领任务', detail:'私密领取模仿要求。' },
        { title:'表演', detail:'现场完成一个符合角色的瞬间。' },
        { title:'提交', detail:'完成后提交，得 10 分。' }
      ],
      win:'多轮累计，得分最高者获胜。',
      tips:['动作比台词更有效。','可以配合道具和音效。']
    }
  },
  undercover: {
    id:'undercover', name:'谁是卧底', shortRule:'描述自己的词，但不要直接说出答案。', primaryAction:'完成发言', minPlayers:4, maxPlayers:20, durationMinutes:18, glyph:'卧',
    ruleCard:{
      goal:'平民找出卧底，卧底撑到最后。',
      flow:[
        { title:'发词', detail:'多数人拿平民词，少数人拿相近的卧底词。' },
        { title:'发言', detail:'轮流用一句话描述自己的词，不能直接说出。' },
        { title:'投票', detail:'全员投票，票最高者出局；平票无人出局。' },
        { title:'下一轮', detail:'出局者身份公开，存活者进入下一轮。' }
      ],
      win:'卧底全部出局则平民胜；存活卧底数≥其余存活者则卧底胜。',
      tips:['描述要模糊，别暴露自己的词。','卧底要装作很熟悉自己的词。']
    }
  },
  truth: {
    id:'truth', name:'两真一假', shortRule:'围绕自己的角色写两条原作真设定和一条可信假设定，轮流陈述并找出虚构项。', primaryAction:'提交三条角色描述', minPlayers:2, maxPlayers:30, durationMinutes:12, glyph:'辨',
    ruleCard:{
      goal:'写三条角色设定骗过大家，同时识破别人。',
      flow:[
        { title:'写设定', detail:'围绕角色写两条真设定和一条假设定。' },
        { title:'陈述', detail:'随机顺序念出三条，语气保持一致。' },
        { title:'投票', detail:'其他人指出假的那条，提交后不可更改。' },
        { title:'揭晓', detail:'公布答案，然后轮到下一位。' }
      ],
      win:'猜中假设定 +1 分，每误导一人再 +1 分。',
      tips:['假设定要贴近角色才骗得到人。','真设定别太冷门。']
    }
  },
  story: {
    id:'story', name:'故事接龙', shortRule:'AI 生成开头与结局，每人续写一段并完成秘密任务，投票选出最佳段落。', primaryAction:'提交这一段', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'续',
    ruleCard:{
      goal:'每人续写一段故事，完成任务并争夺最佳段落。',
      flow:[
        { title:'开场', detail:'AI 生成故事开头、结局和每人的秘密任务。' },
        { title:'接龙', detail:'按顺序限时续写，要自然衔接上文。' },
        { title:'投票', detail:'公布结局后，全员投票选最佳段落。' },
        { title:'结算', detail:'按票数、任务完成度和衔接度计分。' }
      ],
      win:'综合得分最高者获胜；剧透结局者计零分。',
      tips:['别剧透自己或别人的任务。','衔接上文有额外加分。']
    }
  },
  auction: {
    id:'auction', name:'物品拍卖会', shortRule:'每人拍一件随身物品，按上传顺序登台介绍，自由出价成交，最少加价 0.1 元。', primaryAction:'上传你的随身物品', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'拍',
    ruleCard:{
      goal:'用有限预算拍下心水物品，冲上富豪榜。',
      flow:[
        { title:'备钱', detail:'设定初始预算，可继承上一场拍卖余额。' },
        { title:'上架', detail:'每人上传一件随身物品并排好顺序。' },
        { title:'竞拍', detail:'按顺序登台，自由加价，最少加 0.1 元。' },
        { title:'落槌', detail:'价高者得，资金实时转账。' }
      ],
      win:'富豪榜前三名得 5/3/1 分，成交双方再各得 2/1 分。',
      tips:['出价不能超过自己的余额。','留住资金也能进富豪榜。']
    }
  },
  shopping: {
    id:'shopping', name:'一起采购', shortRule:'在活动经费上限内为聚会采购零食、饮料和布置用品，并在清单中完成自己的秘密任务。', primaryAction:'登记采购结果', minPlayers:2, maxPlayers:30, durationMinutes:30, glyph:'购',
    ruleCard:{
      goal:'在预算内为聚会采购，并悄悄完成自己的任务。',
      flow:[
        { title:'定预算', detail:'主持设定总经费，或继承拍卖余额。' },
        { title:'领任务', detail:'每人私密领取一条采购任务。' },
        { title:'登记', detail:'把实际买到的物品和价格登记进清单。' },
        { title:'揭晓', detail:'共同核对清单，公开谁完成了任务。' }
      ],
      win:'本场不计分，剩余经费最多者由主持口头表扬。',
      tips:['登记前可以改预算，登记后锁定。','超支的条目无法登记。']
    }
  },

  werewolf: {
    id:'werewolf', name:'狼人杀发牌', shortRule:'手机只负责私密发身份和阶段提示，发言、技能、投票与淘汰在线下主持。', primaryAction:'发身份', minPlayers:4, maxPlayers:20, durationMinutes:20, glyph:'狼',
    ruleCard:{
      goal:'手机只发身份和阶段，发言投票都在线下。',
      flow:[
        { title:'发身份', detail:'开局随机发牌，每人只看自己那张，看完扣下手机。' },
        { title:'夜晚', detail:'全体闭眼，狼人确认目标，预言家女巫守卫依次行动。' },
        { title:'白天', detail:'公布昨夜结果，全员依次发言，说出你怀疑的人。' },
        { title:'投票', detail:'同时投票，票数最高者出局；平票本轮无人出局。' },
        { title:'标记出局', detail:'主持在页面点人标记，达成胜负条件自动结算。' }
      ],
      win:'狼人全部出局则好人胜；存活狼数≥其他存活玩家则狼人胜。',
      tips:['别把屏幕给旁边的人看，身份只属于你。','主持只标记出局，不代替发言和投票。']
    }
  },
  dice: {
    id:'dice', name:'掷骰子', shortRule:'实时多人骰盅，比大小、定惩罚、选人都能当场用。', primaryAction:'摇一次', minPlayers:2, maxPlayers:30, durationMinutes:5, glyph:'骰',
    ruleCard:{
      goal:'全场共用一副骰子，比大小、定惩罚、选人。',
      flow:[
        { title:'摇骰', detail:'任何人点摇一次，结果全员同步可见。' },
        { title:'记录', detail:'页面记录是谁摇的、点数多少。' },
        { title:'应用', detail:'按现场约定决定大小或惩罚。' }
      ],
      win:'本场不计分，输赢由主持口头确认后结束。',
      tips:['开始前可调整骰子数量和面数。','别拿结果当真实赌注。']
    }
  },
  kings: {
    id:'kings', name:'小姐牌', shortRule:'按顺序轮流抽牌，抽到哪张就按那张牌的约定执行惩罚。', primaryAction:'抽一张牌', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'钗',
    ruleCard:{
      goal:'轮流抽牌，抽到哪张就执行哪条的惩罚。',
      flow:[
        { title:'抽牌', detail:'按顺序轮流抽，牌面全员同步显示。' },
        { title:'执行', detail:'按牌上的约定当场完成。' },
        { title:'继续', detail:'完成后轮到下一位。' }
      ],
      win:'本场不计分；牌堆抽完或主持结束时本场结束。',
      tips:['惩罚可以用喝水、零食或轻量模仿替代。','不想做可跳过，但要全场同意。']
    }
  },
  memory: {
    id:'memory', name:'记牌挑战', shortRule:'依序抽牌，每人复述此前出现过的全部牌面，记错的人接受惩罚。', primaryAction:'抽一张牌', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'记',
    ruleCard:{
      goal:'记住全部出现过的牌面，复述不出错。',
      flow:[
        { title:'抽牌', detail:'按顺序抽，牌面进入公共牌序，所有人可见。' },
        { title:'复述', detail:'轮到你先复述从第一张起的全部牌面，再抽新的。' },
        { title:'受罚', detail:'复述错误当场接受惩罚。' }
      ],
      win:'撑到最后、复述最稳的人获胜。',
      tips:['牌序越长越难，别急着抽。','可以慢慢复述，没人催你。']
    }
  },
  turtle: {
    id:'turtle', name:'海龟汤', shortRule:'主持人读汤面，其他人只能问是 / 否问题，一起推理出汤底。', primaryAction:'开汤', minPlayers:2, maxPlayers:20, durationMinutes:20, glyph:'汤',
    ruleCard:{
      goal:'在 20 个问题内，一起推理出汤底。',
      flow:[
        { title:'开汤', detail:'主持抽题并向全员朗读汤面。' },
        { title:'提问', detail:'只能提出用「是 / 否 / 无关」回答的问题。' },
        { title:'记录', detail:'主持把关键问答留在页面上留档。' },
        { title:'揭晓', detail:'有人推出汤底，或主持点揭晓汤底。' }
      ],
      win:'20 问内推理成功则提问方胜，否则主持守擂成功。',
      tips:['揭晓前汤底只有主持看得到。','从汤面里反常的细节问起。']
    }
  },
  truthdare: {
    id:'truthdare', name:'真心话大冒险', shortRule:'抽到的人现场完成一个真心话或大冒险，不适合就换一张。', primaryAction:'抽一张', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'择',
    ruleCard:{
      goal:'轮流抽真心话或大冒险，现场完成。',
      flow:[
        { title:'抽题', detail:'按顺序抽；真心话如实答，大冒险当场做。' },
        { title:'完成', detail:'完成后轮到下一位。' },
        { title:'换题', detail:'确实不想做可以换一张，次数会记录。' }
      ],
      win:'本场不计分，重在气氛；抽完全部题目或主持结束即止。',
      tips:['题目默认不含隐私、接触和危险动作。','尊重每个换牌的人。']
    }
  },
  never: {
    id:'never', name:'我有你没有', shortRule:'说出只有少数人做过的经历，没做过的人放下一根手指。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:30, durationMinutes:10, glyph:'手',
    ruleCard:{
      goal:'说出罕见的经历，淘汰到只剩一人。',
      flow:[
        { title:'抽题', detail:'抽到的人念出这条经历。' },
        { title:'表态', detail:'做过的保持手指，没做过的放下一根。' },
        { title:'出局', detail:'十根手指用完即出局。' }
      ],
      win:'最后仍然竖着手指的人获胜。',
      tips:['经历越罕见越难倒人。','主持可随时结束并公布结果。']
    }
  },
  reaction: {
    id:'reaction', name:'反应小游戏', shortRule:'007、逛三园、数字炸弹等节奏玩法，慢半拍的人受罚。', primaryAction:'抽一条规则', minPlayers:3, maxPlayers:20, durationMinutes:10, glyph:'反',
    ruleCard:{
      goal:'按抽到的节奏规则接龙，慢半拍就受罚。',
      flow:[
        { title:'抽规则', detail:'按顺序抽一条节奏玩法。' },
        { title:'接龙', detail:'所有人立刻跟上，不能停顿或说错。' },
        { title:'受罚', detail:'出错者当场受罚，主持点「下一位」继续。' }
      ],
      win:'本场不自动计分，最佳表现由主持口头公布。',
      tips:['节奏一起就要跟上。','规则可反复抽，每题单独判定。']
    }
  },
  whoami: {
    id:'whoami', name:'我是谁（猜身份）', shortRule:'额头上贴一个别人都看得到的身份，靠是 / 否问题猜出自己是谁。', primaryAction:'发身份', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'猜',
    ruleCard:{
      goal:'靠是/否问题，猜出自己额头上的身份。',
      flow:[
        { title:'发牌', detail:'每人能看到别人的身份，看不到自己的。' },
        { title:'提问', detail:'轮流提问，问题只能用是/否回答。' },
        { title:'猜测', detail:'每人每轮可提交一次猜测，猜中即脱出。' }
      ],
      win:'全员猜中本场自动结束；每猜中一次得 1 分。',
      tips:['问题从大类问起，再逐步缩小。','记住别人的提问和答案。']
    }
  },
  charades: {
    id:'charades', name:'你演我猜', shortRule:'表演者只看得到题目，用动作和表情演，其他人抢答。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'演',
    ruleCard:{
      goal:'表演者无声演题，大家抢答。',
      flow:[
        { title:'看题', detail:'轮到的人私密看题。' },
        { title:'表演', detail:'只能用动作和表情，不能说话。' },
        { title:'抢答', detail:'其他人抢答，首位猜中的人得分。' }
      ],
      win:'首位猜中者得 1 分，多轮累计，最高者获胜。',
      tips:['别用嘴型或口型提示。','揭晓前答案对猜的人隐藏。']
    }
  },
  twenty: {
    id:'twenty', name:'秘密词二十问', shortRule:'一人知道秘密词，其他人合计最多问 20 个只能用是 / 否回答的问题。', primaryAction:'抽秘密词', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'问',
    ruleCard:{
      goal:'20 个是/否问题内猜出秘密词。',
      flow:[
        { title:'抽词', detail:'回答者私密查看秘密词，别人看不到。' },
        { title:'提问', detail:'其他人合计最多提 20 个是/否问题。' },
        { title:'猜测', detail:'随时可提交最终猜测。' }
      ],
      win:'20 问内猜中提问方胜；问完未中或主持揭晓则回答者胜。',
      tips:['页面会记录剩余问题数。','按范围二分最快。']
    }
  },
  describe: {
    id:'describe', name:'你说我猜', shortRule:'描述者不能说出题目里的字，其他人根据描述抢答。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'述',
    ruleCard:{
      goal:'描述题目但不能说题里的字，大家抢答。',
      flow:[
        { title:'看题', detail:'轮到的人私密看题。' },
        { title:'描述', detail:'不能说题目中的字、谐音或直接翻译。' },
        { title:'抢答', detail:'其他人抢答，首位猜中的人得分。' }
      ],
      win:'首位猜中者得 1 分；违规时主持可判本题负。',
      tips:['描述要快，别冷场。','违规提示由主持掌握。']
    }
  },
  quiz: {
    id:'quiz', name:'知识问答', shortRule:'抽取常识题抢答，页面判定正误，分组总分由主持记录。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:30, durationMinutes:10, glyph:'答',
    ruleCard:{
      goal:'抢答常识题，看谁答对得多。',
      flow:[
        { title:'抽题', detail:'主持抽题后全员抢答。' },
        { title:'作答', detail:'提交后本人立即知道对错，别人只看到有人答了。' },
        { title:'揭晓', detail:'主持点揭晓答案并推进下一题。' }
      ],
      win:'页面统计本场答对次数，答对最多者获胜。',
      tips:['答案揭晓前不会下发给其他人。','分组总分可由主持现场记录。']
    }
  }
};

export const GAME_IDS = Object.keys(GAME_DEFINITIONS) as GameId[];
