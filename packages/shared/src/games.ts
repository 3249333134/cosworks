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
  shopping: { id:'shopping', name:'一起采购', shortRule:'在活动经费上限内为聚会采购零食、饮料和布置用品，并在清单中完成自己的秘密任务。', primaryAction:'登记采购结果', minPlayers:2, maxPlayers:30, durationMinutes:30, glyph:'购' }
};

export const GAME_IDS = Object.keys(GAME_DEFINITIONS) as GameId[];
