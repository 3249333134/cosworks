import type { FlavorBucket, PartyGameId } from '@ruxiju/shared';

function shuffle<T>(arr: readonly T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 轻量玩法的题库与牌堆。
 * 所有内容都经过安全约束：不要求道具、不涉及危险动作、不强迫身体接触、不追问隐私。
 */
export interface PartyCard {
  /** 展示给所有人的标题；私密玩法里只有持有者看得到 */
  label: string;
  /** 公开的补充说明 */
  detail?: string;
  /** 答案 / 汤底 / 秘密词，只有揭晓后才下发 */
  answer?: string;
  /** 判定猜中时可接受的其它写法 */
  aliases?: string[];
  /** 桶位标签：抽牌按 MBTI 加权、文案按桶位变体 */
  tags?: FlavorBucket[];
  /** 预生成的个性化风味（AI 增强层产物）；缺省时由 party-flavor 本地计算 */
  kicker?: string;
  flavor?: string;
}

const KINGS: PartyCard[] = [
  { label: 'A · 指定一人', detail: '指定一位玩家做一个你提出的动作，对方可以要求换一个更轻的。' },
  { label: '2 · 小姐牌', detail: '从这一刻起，所有人称呼你为“大小姐 / 小少爷”，直到下一张 2 出现。' },
  { label: '3 · 逛三园', detail: '发起“星期天逛三园”，所有人依次说出园内的东西，重复或停顿的人受罚。' },
  { label: '4 · 猜拳', detail: '挑一位玩家猜拳，输的人接受一次轻量惩罚。' },
  { label: '5 · 照相机', detail: '喊出“照相机”后所有人定格，最后一个停住或动了的受罚。' },
  { label: '6 · 摸鼻子', detail: '悄悄摸一下自己的鼻子，最后一个跟着摸鼻子的人受罚。' },
  { label: '7 · 数七', detail: '从你开始轮流报数，遇到含 7 或 7 的倍数要拍手，出错的人受罚。' },
  { label: '8 · 离席牌', detail: '这张牌留给你：只有你能随时起身离席一次，用完作废。' },
  { label: '9 · 免罚牌', detail: '这张牌可以留到本场任意时刻抵消一次惩罚。' },
  { label: '10 · 神经病', detail: '从这一刻起所有人不能回应你说的话，直到下一张 10 出现。' },
  { label: 'J · 左边', detail: '坐在你左手边的人接受一次轻量惩罚。' },
  { label: 'Q · 右边', detail: '坐在你右手边的人接受一次轻量惩罚。' },
  { label: 'K · 全体', detail: '所有人一起做一个你指定的动作，坚持 3 秒。' }
];

const REACTION_RULES: PartyCard[] = [
  { label: '007', detail: 'A 喊“0”并指向 B，B 喊“0”并指向 C，C 喊“7”并指向 D，D 必须立刻喊“砰”并举手。反应错的人受罚。' },
  { label: '逛三园', detail: '发起者说“星期天，逛三园”，下一位说园名（动物园 / 植物园 / 果园），之后轮流说该园里的东西，重复或停顿受罚。' },
  { label: '数字炸弹', detail: '出题人在 1–100 里想一个数，其他人轮流猜，每猜一次范围收窄，猜中炸弹的人受罚。' },
  { label: '拍七', detail: '轮流报数，遇到含 7 或 7 的倍数要拍手不能报数，出错的人受罚。' },
  { label: '大西瓜小西瓜', detail: '说“大西瓜”时要用手比小，说“小西瓜”时要用手比大，做错或慢半拍的人受罚。' },
  { label: '左右手', detail: '听指令做相反动作：说“举左手”要举右手，说“摸右耳”要摸左耳。' },
  { label: '抢数字', detail: '从 1 开始抢着报数，同一秒只能有一个人出声，撞号的人受罚。' },
  { label: '节奏接龙', detail: '由发起者定一个四拍节奏并拍手，之后每人依次接一拍，漏拍或错拍的人受罚。' }
];

const TURTLE: PartyCard[] = [
  {
    label: '一个男人走进餐馆，点了一碗海龟汤，喝了一口之后，他走出餐馆结束了自己的生命。为什么？',
    detail: '提示：汤的味道和他记忆里的不一样。',
    answer: '他曾和同伴在海上遇难，同伴说给他喝的是海龟汤，其实是同伴用自己的身体救了他。他一直以为自己喝过海龟汤，今天尝到真正的味道，才明白同伴已经不在了，于是崩溃。'
  },
  {
    label: '一位女士住在十楼。每天下雨她坐电梯直达十楼，晴天却只坐到七楼再走楼梯。为什么？',
    detail: '提示：和她的身高有关。',
    answer: '她个子不高，只够得到七楼的按钮；下雨天她带着伞，可以用伞尖按到十楼。'
  },
  {
    label: '沙漠中央发现一具尸体，手里握着半根火柴，周围没有脚印。他是怎么死的？',
    detail: '提示：天上曾经有东西经过。',
    answer: '他和同伴乘热气球穿越沙漠，气球超重不断下降，众人抽签，抽到半根火柴的人必须跳下去，他就是抽中的人。'
  },
  {
    label: '姐姐在葬礼上遇见一位陌生男子，回家后她结束了自己妹妹的生命。为什么？',
    detail: '提示：她想再见到那位男子。',
    answer: '她认为只要再办一场葬礼，那位男子就会再次出现，于是对妹妹下了手。这是一道经典的推理题，用来讨论动机的荒谬。'
  },
  {
    label: '两个人冲进酒吧各要了一杯水，酒保却突然掏出一把枪指着他们。两人道谢后离开。为什么？',
    detail: '提示：他们本来是来求助的。',
    answer: '两人打嗝停不下来，想喝水止嗝。酒保用惊吓的方式帮他们止住了打嗝，所以他们道谢离开。'
  },
  {
    label: '钢琴声停下的一瞬间，房间里的女人松了一口气。为什么？',
    detail: '提示：她看不见。',
    answer: '她是盲人，独自在家时靠隔壁传来练琴的声音确认有人陪着；琴声停止，说明邻居回家了，她终于意识到自己其实是一个人。'
  },
  {
    label: '一个人在餐厅点完餐，服务员问了一句“你的另一位呢？”，他当场哭了出来。为什么？',
    detail: '提示：他们曾经分不开。',
    answer: '他和双胞胎兄弟是连体婴，刚做完分离手术，兄弟没能活下来。服务员习惯性地以为他们还是一起来的。'
  },
  {
    label: '男人每天早上都在同一家店买报纸，某天他看了一眼报纸就转身离开，再也没有回来。为什么？',
    detail: '提示：报纸上有一条他熟悉的名字。',
    answer: '报纸上刊登了他自己的讣告。他意识到有人以为他死了，而这件事只可能是一个知道他行程的人做的，于是他立刻去处理这件事。'
  }
];

const TRUTH_DARE: PartyCard[] = [
  { label: '真心话 · 说一件最近让你偷偷开心了很久的小事。' },
  { label: '真心话 · 用三个词形容你今天的状态，并解释其中一个。' },
  { label: '真心话 · 模仿在场一个人最常说的一句话。' },
  { label: '真心话 · 说出你手机里最常用的一个 App，以及为什么。' },
  { label: '真心话 · 讲一个可以模糊细节的糗事。' },
  { label: '真心话 · 说出你最想重看一遍的一部作品。' },
  { label: '真心话 · 你上一次笑到停不下来是因为什么？' },
  { label: '真心话 · 说一件你最近改变主意的事。' },
  { label: '真心话 · 如果只能拥有一个角色的能力，你选谁？' },
  { label: '真心话 · 说出你最近一次被陌生人帮到的经历。' },
  { label: '大冒险 · 用播音腔念一句“本次聚会正式开始”。' },
  { label: '大冒险 · 给左手边的人一个真诚的赞美。' },
  { label: '大冒险 · 用三个动作演完“赶地铁”。' },
  { label: '大冒险 · 学一种动物叫三声。' },
  { label: '大冒险 · 用方言说一句“今天真开心”。' },
  { label: '大冒险 · 做一个你自认为最夸张的表情，保持 3 秒。' },
  { label: '大冒险 · 现场编一句押韵的口号。' },
  { label: '大冒险 · 用最快速度说完“红鲤鱼与绿鲤鱼与驴”。' },
  { label: '大冒险 · 和右手边的人一起摆一个造型保持 5 秒。' },
  { label: '大冒险 · 模仿主持人主持节目 10 秒。' }
];

const NEVER: PartyCard[] = [
  { label: '我从来没有在电梯里假装按过楼层。' },
  { label: '我从来没有在电影院睡着过。' },
  { label: '我从来没有一个人吃过火锅。' },
  { label: '我从来没有把闹钟定早十分钟再赖床。' },
  { label: '我从来没有唱歌忘词但继续哼下去。' },
  { label: '我从来没有因为剧透和别人争过。' },
  { label: '我从来没有在超市试吃后什么都没买。' },
  { label: '我从来没有走路撞到过玻璃门。' },
  { label: '我从来没有在群里发错过消息。' },
  { label: '我从来没有熬夜看完一整季剧。' },
  { label: '我从来没有打扮成角色出过门。' },
  { label: '我从来没有在漫展排过一小时以上的队。' },
  { label: '我从来没有为了一个角色专门学一个动作。' },
  { label: '我从来没有在车上坐过站。' },
  { label: '我从来没有把外卖备注写得很长。' },
  { label: '我从来没有在雨天踩进水坑。' },
  { label: '我从来没有当众唱过歌。' },
  { label: '我从来没有给虚拟角色写过长评。' },
  { label: '我从来没有在半夜点过烧烤。' },
  { label: '我从来没有因为一句话笑到咳嗽。' }
];

const CHARADES: PartyCard[] = [
  { label: '打喷嚏', aliases: ['喷嚏'] }, { label: '系鞋带' }, { label: '刷牙' }, { label: '开车' },
  { label: '钓鱼' }, { label: '弹钢琴' }, { label: '跳绳' }, { label: '拍照' },
  { label: '切菜' }, { label: '游泳' }, { label: '打篮球', aliases: ['投篮'] }, { label: '写作业' },
  { label: '扫地' }, { label: '洗脸' }, { label: '打电话' }, { label: '吹蜡烛' },
  { label: '拔河' }, { label: '滑板' }, { label: '弹吉他' }, { label: '遛狗' },
  { label: '化妆' }, { label: '看手表' }, { label: '打伞' }, { label: '搬箱子' },
  { label: '开瓶盖' }, { label: '系领带' }, { label: '打鼓' }, { label: '拖地' },
  { label: '烤串' }, { label: '排队' }, { label: '点外卖' }, { label: '找钥匙' },
  { label: '戴口罩' }, { label: '量体温' }, { label: '数钱' }, { label: '打哈欠' },
  { label: '伸懒腰' }, { label: '鼓掌' }, { label: '照镜子' }, { label: '拎行李' }
];

const DESCRIBE: PartyCard[] = [
  { label: '火锅' }, { label: '地铁' }, { label: '空调' }, { label: '快递' },
  { label: '直播' }, { label: '二维码' }, { label: '充电宝' }, { label: '外卖' },
  { label: '共享单车', aliases: ['单车'] }, { label: '电梯' }, { label: '电影院' }, { label: '奶茶' },
  { label: '键盘' }, { label: '雨伞' }, { label: '闹钟' }, { label: '冰箱' },
  { label: '洗衣机' }, { label: '口罩' }, { label: '耳机' }, { label: '自拍杆' },
  { label: '机场' }, { label: '超市' }, { label: '出租车' }, { label: '咖啡' },
  { label: '乒乓球' }, { label: '图书馆' }, { label: '考试' }, { label: '加班' },
  { label: '宠物' }, { label: '医院' }, { label: '警察' }, { label: '厨师' },
  { label: '宇航员' }, { label: '快递员' }, { label: '老师' }, { label: '医生' },
  { label: '程序员' }, { label: '主播' }, { label: '司机' }, { label: '理发师' }
];

const TWENTY: PartyCard[] = [
  { label: '太阳' }, { label: '月亮' }, { label: '熊猫' }, { label: '奶茶' },
  { label: '火锅' }, { label: '飞机' }, { label: '钢琴' }, { label: '雨伞' },
  { label: '冰箱' }, { label: '龙' }, { label: '猫' }, { label: '篮球' },
  { label: '长城' }, { label: '咖啡' }, { label: '手机' }, { label: '蜘蛛' },
  { label: '彩虹' }, { label: '雪人' }, { label: '月饼' }, { label: '风筝' },
  { label: '眼镜' }, { label: '沙发' }, { label: '洗衣机' }, { label: '吉他' },
  { label: '乌龟' }, { label: '企鹅' }, { label: '灯笼' }, { label: '粽子' },
  { label: '显微镜' }, { label: '望远镜' }
];

const QUIZ: PartyCard[] = [
  { label: '中国最长的河流是哪一条？', answer: '长江' },
  { label: '一年有多少个节气？', answer: '24', aliases: ['二十四'] },
  { label: '光年是什么单位？', answer: '长度' },
  { label: '人体面积最大的器官是什么？', answer: '皮肤' },
  { label: '《西游记》的作者是谁？', answer: '吴承恩' },
  { label: '水的化学式是什么？', answer: 'H2O', aliases: ['h2o', 'H₂O'] },
  { label: '太阳系中体积最大的行星是哪一颗？', answer: '木星' },
  { label: '夏季奥运会多少年举办一次？', answer: '4', aliases: ['四年', '四'] },
  { label: '血液中负责运输氧气的是什么细胞？', answer: '红细胞' },
  { label: '世界上面积最大的海洋是哪一个？', answer: '太平洋' },
  { label: '一打等于多少个？', answer: '12', aliases: ['十二'] },
  { label: '《红楼梦》又被称为什么？', answer: '石头记' },
  { label: '彩虹通常有几种颜色？', answer: '7', aliases: ['七'] },
  { label: '标准钢琴有多少个琴键？', answer: '88', aliases: ['八十八'] },
  { label: '中国古代用于航海辨向的四大发明之一是？', answer: '指南针' },
  { label: '圆周率通常取近似值多少？', answer: '3.14', aliases: ['3.14159'] },
  { label: '地球上面积最大的大陆是哪一个？', answer: '亚欧大陆', aliases: ['亚洲', '欧亚大陆'] },
  { label: '珠穆朗玛峰位于哪两个国家的边境？', answer: '中国和尼泊尔', aliases: ['中国尼泊尔', '中尼'] },
  { label: '《静夜思》的作者是谁？', answer: '李白' },
  { label: '一天有多少秒？', answer: '86400', aliases: ['八万六千四百'] }
];

const WHOAMI = [
  '罗小黑','无限','小黑','小白','阿根','比丢','鹿野','哪吒','孙悟空','猪八戒','唐僧','白龙马',
  '哆啦A梦','皮卡丘','蜡笔小新','樱桃小丸子','江户川柯南','蒙奇·D·路飞','漩涡鸣人','罗罗诺亚·索隆',
  '米老鼠','唐老鸭','白雪公主','灰姑娘','蜘蛛侠','钢铁侠','蝙蝠侠','超人','葫芦娃','黑猫警长'
];

/** 我是谁的静态兜底名单：主题池不足时补位 */
export const WHOAMI_ROLES: readonly string[] = WHOAMI;

const WEREWOLF_ROLES = ['狼人','村民','预言家','女巫','猎人','守卫','白痴'] as const;

/** 52 张扑克，用于记牌挑战 */
function playingCards(): PartyCard[] {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return suits.flatMap(suit => ranks.map(rank => ({ label: `${suit}${rank}` })));
}

const DECKS: Partial<Record<PartyGameId, PartyCard[]>> = {
  kings: KINGS,
  memory: playingCards(),
  reaction: REACTION_RULES,
  turtle: TURTLE,
  truthdare: TRUTH_DARE,
  never: NEVER,
  charades: CHARADES,
  describe: DESCRIBE,
  twenty: TWENTY,
  quiz: QUIZ
};

/** 玩法级默认桶位：抽牌加权与文案变体的依据 */
const DECK_TAGS: Partial<Record<PartyGameId, FlavorBucket[]>> = {
  kings: ['speed'],
  reaction: ['speed'],
  turtle: ['observe'],
  never: ['verbal'],
  charades: ['perform'],
  describe: ['verbal'],
  twenty: ['observe']
};

function deckTagsFor(gameId: PartyGameId, card: PartyCard): FlavorBucket[] | undefined {
  if (gameId === 'truthdare') return card.label.startsWith('真心话') ? ['verbal'] : ['perform'];
  return DECK_TAGS[gameId];
}

export function partyDeck(gameId: PartyGameId): PartyCard[] {
  const deck = DECKS[gameId];
  return deck ? deck.map(card => ({ ...card, tags: card.tags ?? deckTagsFor(gameId, card) })) : [];
}

/** 狼人杀身份分配：按人数配平，主持人也拿一张，无人能查看他人身份 */
export function werewolfRoles(playerCount: number): string[] {
  const count = Math.max(2, playerCount);
  const wolves = Math.max(1, Math.min(Math.floor(count / 3), Math.floor((count - 1) / 2)));
  const roles: string[] = Array.from({ length: wolves }, () => '狼人');
  if (count >= 6) roles.push('预言家');
  if (count >= 7) roles.push('女巫');
  if (count >= 8) roles.push('猎人');
  if (count >= 9) roles.push('守卫');
  while (roles.length < count) roles.push('村民');
  return shuffle(roles.slice(0, count));
}

/** 我是谁：每人一个身份，自己看不到自己的；传入 pool（主题/在场角色名单）时优先用它 */
export function whoamiRoles(playerCount: number, pool?: readonly string[]): string[] {
  const count = Math.max(2, playerCount);
  const source = pool && pool.length >= count ? [...pool] : [...WHOAMI];
  return shuffle(source).slice(0, count);
}

export const PARTY_DICE_DEFAULT = { count: 2, sides: 6 };
export const TWENTY_QUESTIONS = 20;
