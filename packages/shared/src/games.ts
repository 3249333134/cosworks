import type { GameId } from './types.js';

export interface GameDefinition {
  id: GameId;
  name: string;
  shortRule: string;
  primaryAction: string;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  glyph: string;
  /** 轻量玩法的三步规则说明，用于规则抽屉 */
  rules?: string[];
}

export const GAME_DEFINITIONS: Record<GameId, GameDefinition> = {
  dont: { id:'dont', name:'不要做挑战', shortRule:'戴好自己的秘密词牌，引导其他玩家触发并保护自己。', primaryAction:'我已触发，抽下一张', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'禁' },
  must: { id:'must', name:'触发秘密任务', shortRule:'任意玩家触发卡片条件时都要完整执行；换卡越少、成功触发越多，排名越高。', primaryAction:'我已完整执行 1 次', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'触' },
  witch: { id:'witch', name:'女巫的毒药', shortRule:'每人埋下一份惩罚，再共同排查直到采完全部毒药。', primaryAction:'确认这个格子', minPlayers:3, maxPlayers:20, durationMinutes:15, glyph:'阵' },
  camera: { id:'camera', name:'不能被拍到', shortRule:'在倒计时结束前完成动作并避开镜头。', primaryAction:'开始挑战', minPlayers:2, maxPlayers:20, durationMinutes:8, glyph:'影' },
  draw: { id:'draw', name:'Cos 你画我猜', shortRule:'主持人先画原始词，之后每人照着上一幅继续画，最后一位猜词。', primaryAction:'提交画作', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'画' },
  imitate: { id:'imitate', name:'人设模仿', shortRule:'演出符合角色的一个瞬间。', primaryAction:'开始表演', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'演' },
  undercover: { id:'undercover', name:'谁是卧底', shortRule:'描述自己的词，但不要直接说出答案。', primaryAction:'完成发言', minPlayers:4, maxPlayers:20, durationMinutes:18, glyph:'卧' },
  truth: { id:'truth', name:'两真一假', shortRule:'围绕自己的角色写两条原作真设定和一条可信假设定，轮流陈述并找出虚构项。', primaryAction:'提交三条角色描述', minPlayers:2, maxPlayers:30, durationMinutes:12, glyph:'辨' },
  story: { id:'story', name:'故事接龙', shortRule:'AI 生成开头与结局，每人续写一段并完成秘密任务，投票选出最佳段落。', primaryAction:'提交这一段', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'续' },
  auction: { id:'auction', name:'物品拍卖会', shortRule:'每人拍一件随身物品，按上传顺序登台介绍，自由出价成交，最少加价 0.1 元。', primaryAction:'上传你的随身物品', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'拍' },
  shopping: { id:'shopping', name:'一起采购', shortRule:'在活动经费上限内为聚会采购零食、饮料和布置用品，并在清单中完成自己的秘密任务。', primaryAction:'登记采购结果', minPlayers:2, maxPlayers:30, durationMinutes:30, glyph:'购' },

  werewolf: {
    id:'werewolf', name:'狼人杀发牌', shortRule:'手机只负责私密发身份和阶段提示，发言、技能、投票与淘汰在线下主持。', primaryAction:'发身份', minPlayers:4, maxPlayers:20, durationMinutes:20, glyph:'狼',
    rules:[
      '房主随机发身份，每个人只看得到自己的牌；手机上只提示夜晚、白天、投票三个阶段。',
      '发言、技能、投票和淘汰都在线下进行，主持人按现场节奏推进阶段，主持人自己也只看到自己的身份。',
      '胜负：全部狼人出局则好人胜；狼人数量达到或超过其他存活玩家则狼人胜。结算后所有人的身份才会公开。'
    ]
  },
  dice: {
    id:'dice', name:'掷骰子', shortRule:'实时多人骰盅，比大小、定惩罚、选人都能当场用。', primaryAction:'摇一次', minPlayers:2, maxPlayers:30, durationMinutes:5, glyph:'骰',
    rules:[
      '所有人共用一副骰子，任何人点“摇一次”都会立刻出现在所有人的屏幕上，并记下是谁摇的。',
      '房主可以在开始前调整骰子数量和面数，用来比大小、定惩罚或随机选人。',
      '结果只作为现场判定依据，不累计分数；需要记输赢时由主持口头确认后结束本场。'
    ]
  },
  kings: {
    id:'kings', name:'小姐牌', shortRule:'按顺序轮流抽牌，抽到哪张就按那张牌的约定执行惩罚。', primaryAction:'抽一张牌', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'钗',
    rules:[
      '也叫金陵十三钗。所有人按顺序轮流抽牌，抽到的牌会同步显示在每个人屏幕上。',
      '每张牌对应一条现场惩罚，可以用喝水、零食或轻量模仿替代，不需要道具。',
      '牌堆抽完后本场结束；需要继续可以直接开启下一轮，牌堆会重新洗牌。'
    ]
  },
  memory: {
    id:'memory', name:'记牌挑战', shortRule:'依序抽牌，每人复述此前出现过的全部牌面，记错的人接受惩罚。', primaryAction:'抽一张牌', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'记',
    rules:[
      '所有人按顺序抽牌，每次抽到的牌都会进入公共牌序，所有人可见。',
      '轮到你时先复述从第一张到上一张的全部牌面，再抽新的一张；复述错误当场接受惩罚。',
      '牌序越长越难。牌堆抽完或主持结束本场时结算，记牌最稳的人获胜。'
    ]
  },
  turtle: {
    id:'turtle', name:'海龟汤', shortRule:'主持人读汤面，其他人只能问是 / 否问题，一起推理出汤底。', primaryAction:'开汤', minPlayers:2, maxPlayers:20, durationMinutes:20, glyph:'汤',
    rules:[
      '主持人抽题后向所有人朗读汤面，汤底在揭晓前只有主持人看得到。',
      '其他人只能提出可以用“是 / 否 / 无关”回答的问题，主持人把关键问答记录在页面上留档。',
      '有人说出接近汤底的推理，或主持点“揭晓汤底”时本场结束；20 个问题内推理成功算提问方获胜。'
    ]
  },
  truthdare: {
    id:'truthdare', name:'真心话大冒险', shortRule:'抽到的人现场完成一个真心话或大冒险，不适合就换一张。', primaryAction:'抽一张', minPlayers:2, maxPlayers:30, durationMinutes:15, glyph:'择',
    rules:[
      '按顺序抽取题目，抽到真心话必须如实回答，抽到大冒险必须现场完成。',
      '题目默认不涉及隐私披露、身体接触和危险动作；确实不想做可以换一张，换牌次数记在记录里。',
      '完成即轮到下一位。全部题目抽完或主持结束本场时结算。'
    ]
  },
  never: {
    id:'never', name:'我有你没有', shortRule:'说出只有少数人做过的经历，没做过的人放下一根手指。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:30, durationMinutes:10, glyph:'手',
    rules:[
      '按顺序抽题，抽到的人念出这条经历，然后从自己开始表态。',
      '做过这件事的人保持手指不放下，没做过的人放下一根；十根手指用完即出局。',
      '最后仍然竖着手指的人获胜；主持可以在任意时刻结束本场并公布结果。'
    ]
  },
  reaction: {
    id:'reaction', name:'反应小游戏', shortRule:'007、逛三园、数字炸弹等节奏玩法，慢半拍的人受罚。', primaryAction:'抽一条规则', minPlayers:3, maxPlayers:20, durationMinutes:10, glyph:'反',
    rules:[
      '按顺序抽一条节奏规则，所有人立刻按规则接龙，不能停顿或说错。',
      '出错、接不上或节奏乱掉的人当场受罚，并由主持点“下一位”继续。',
      '规则可以反复抽，每题单独判定；本场不自动计分，结束时由主持口头公布表现最好的人。'
    ]
  },
  whoami: {
    id:'whoami', name:'我是谁（猜身份）', shortRule:'额头上贴一个别人都看得到的身份，靠是 / 否问题猜出自己是谁。', primaryAction:'发身份', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'猜',
    rules:[
      '房主发牌后，每个人都能看到其他人额头上的身份，但看不到自己的。',
      '轮流提问，问题只能用“是 / 否”回答；也可以随时提交猜测，猜中即脱出。',
      '所有人猜出、或主持揭晓时本场结束，页面会公开全部身份。'
    ]
  },
  charades: {
    id:'charades', name:'你演我猜', shortRule:'表演者只看得到题目，用动作和表情演，其他人抢答。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'演',
    rules:[
      '轮到的人私密看题，只能用动作和表情表演，不能说话、不能提示题目里的字。',
      '其他人抢答，答案在揭晓前对猜的人隐藏；首位猜中的人得分。',
      '主持点“揭晓答案”或“下一位”结束本题，页面不强制计时，节奏由现场掌握。'
    ]
  },
  twenty: {
    id:'twenty', name:'秘密词二十问', shortRule:'一人知道秘密词，其他人合计最多问 20 个只能用是 / 否回答的问题。', primaryAction:'抽秘密词', minPlayers:2, maxPlayers:20, durationMinutes:15, glyph:'问',
    rules:[
      '抽到秘密词的人私密查看，只有他自己看得到答案；其他人只能通过问答推理。',
      '其他人合计最多提出 20 个是 / 否问题，页面记录剩余问题数和最终猜测。',
      '20 问内猜中则提问方成功；问题用完仍未猜中或主持直接揭晓则回答者获胜。'
    ]
  },
  describe: {
    id:'describe', name:'你说我猜', shortRule:'描述者不能说出题目里的字，其他人根据描述抢答。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:20, durationMinutes:10, glyph:'述',
    rules:[
      '轮到的人私密看题，用语言描述，但不能说出题目中的字、谐音或直接翻译。',
      '其他人抢答，答案在揭晓前对猜的人隐藏；首位猜中的人得分。',
      '主持点“揭晓答案”或“下一位”结束本题，出现违规提示时本题可以由主持直接判负。'
    ]
  },
  quiz: {
    id:'quiz', name:'知识问答', shortRule:'抽取常识题抢答，页面判定正误，分组总分由主持记录。', primaryAction:'抽一道题', minPlayers:2, maxPlayers:30, durationMinutes:10, glyph:'答',
    rules:[
      '房主抽题后所有人抢答，答案在揭晓前不会下发给其他人。',
      '提交后页面会立即告诉提交者本人是否正确，其他人只看到“有人答了”。',
      '揭晓答案后主持点“下一位”继续；总分由现场记录，页面只统计本场答对次数。'
    ]
  }
};

export const GAME_IDS = Object.keys(GAME_DEFINITIONS) as GameId[];
