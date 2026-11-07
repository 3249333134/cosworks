export const MBTI_TYPES = [
  'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
  'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'
] as const;

export type Mbti = typeof MBTI_TYPES[number];
export type GameId = 'dont' | 'must' | 'witch' | 'camera' | 'draw' | 'imitate' | 'undercover' | 'truth' | 'story' | 'auction' | 'shopping'
  | 'werewolf' | 'dice' | 'kings' | 'memory' | 'turtle' | 'truthdare' | 'never' | 'reaction' | 'whoami' | 'charades' | 'twenty' | 'describe' | 'quiz';
/** 个性化桶位：MBTI 加权与文案变体的依据（定义在 types 供视图共用） */
export type FlavorBucket = 'perform' | 'observe' | 'verbal' | 'speed';
/** 轻量玩法：主持人驱动、手机只负责发牌与阶段提示 */
export const PARTY_GAME_IDS = ['werewolf','dice','kings','memory','turtle','truthdare','never','reaction','whoami','charades','twenty','describe','quiz'] as const;
export type PartyGameId = typeof PARTY_GAME_IDS[number];
export function isPartyGame(gameId: string | null | undefined): gameId is PartyGameId { return Boolean(gameId) && (PARTY_GAME_IDS as readonly string[]).includes(gameId as string); }
export type RoomStatus = 'waiting' | 'ready' | 'running' | 'paused' | 'settled' | 'stopped';
export type HostRole = 'owner' | 'cohost' | 'reviewer' | null;

export interface IpRole {
  avatarColor?: string;
  version?: number;
  generation?: { status: 'queued'|'running'|'complete'|'partial'|'failed'; taskId: string; message?: string; sources?: Array<{title:string;url:string;retrievedAt:string}>; evidence?: Record<string,string>; };
  id: string;
  ipTheme: string;
  name: string;
  personaTags: string[];
  quote: string;
  signatureAction: string;
  ability: string;
  isDefault: boolean;
}

export interface UserProfile {
  avatarColor?: string;
  accountId: string;
  displayName: string;
  mbti: Mbti | null;
  mbtiCompletedAt: string | null;
  roles: IpRole[];
}

export interface RoomMember {
  id: string;
  accountId: string;
  displayName: string;
  isOwner: boolean;
  hostRole: HostRole;
  playerRole: string;
  ipRoleId: string | null;
  team: string;
  ready: boolean;
  online: boolean;
  score: number;
}

export interface ChallengeRequirements {
  props: 'none';
  camera: boolean;
  drawing: boolean;
  physicalContact: false;
  publicPerformance: boolean;
}

export interface Challenge {
  id: string;
  gameId: GameId;
  title: string;
  content: string;
  interactionMode: 'tap' | 'draw' | 'camera' | 'speak';
  socialLoad: 1 | 2 | 3;
  roleTags: string[];
  completionCriteria: string;
  riskLevel: 'low';
  requirements: ChallengeRequirements;
}

export interface GameConfig {
  /** 游戏总轮数；不同游戏语义不同，默认 1（保持原行为） */
  rounds?: number;
  /** 女巫毒药棋盘边长（N×N），默认 5 */
  boardSize?: number;
}

export interface GameSnapshot {
  sessionId: string;
  planItemId: string | null;
  gameId: GameId;
  phase: 'idle' | 'ready' | 'playing' | 'review' | 'settled';
  round: number;
  prompt: string;
  primaryAction: string;
  endsAt: number | null;
  scores: Record<string, number>;
  publicState: Record<string, unknown>;
  privateState?: Record<string, unknown>;
  config?: GameConfig;
}

export interface GamePlanItem {
  id: string;
  gameId: GameId;
  createdAt: string;
  rounds?: number;
}

export interface RoomSnapshot {
  id: string;
  code: string;
  name: string;
  ipTheme: string;
  status: RoomStatus;
  ownerAccountId: string;
  members: RoomMember[];
  currentGame: GameId | null;
  game: GameSnapshot | null;
  gamePlan: GamePlanItem[];
  planCursor: number;
  planRound: number;
  closedAt: string | null;
}

export interface RecentRoomSummary {
  code: string;
  name: string;
  ipTheme: string;
  status: RoomStatus;
  currentGame: GameId | null;
  playerRole: string;
  isHost: boolean;
  memberCount: number;
  updatedAt: string;
  closedAt: string | null;
  canReenter: boolean;
}

export interface GameOverviewPlayer {
  accountId: string;
  displayName: string;
  playerRole: string;
  completed: boolean;
  wordCount?: number;
  currentWord?: string | null;
  currentWordHidden?: boolean;
  usedWords?: string[];
  triggerCount?: number;
  cardChangeCount?: number;
}

export interface GameOverviewCell {
  cell: number;
  state: 'hidden' | 'own' | 'safe' | 'hit';
  buriedByName?: string;
  punishment?: string;
}

export interface GameOverview {
  gameId: GameId;
  phase: GameSnapshot['phase'];
  round: number;
  endsAt: number | null;
  isHost: boolean;
  progressLabel: string;
  players: GameOverviewPlayer[];
  undercover?: UndercoverView;
  ownContent?: string;
  witch?: {
    stage: string;
    buriedCount: number;
    total: number;
    currentTurnName: string | null;
    cells: GameOverviewCell[];
  };
  truth?: {
    stage: 'setup'|'voting'|'reveal'|'complete';
    submittedCount: number;
    total: number;
    roundNumber: number;
    totalRounds: number;
    speakerName: string | null;
    speakerRole: string | null;
    statements: string[] | null;
    falseIndex: number | null;
    votedCount: number;
    voterCount: number;
    points: Record<string, number>;
    votesByStatement: number[];
  };
  draw?: {
    stage: 'drawing' | 'guessing' | 'reveal';
    currentIndex: number;
    total: number;
    turnName: string;
    order: string[];
    drawing: string | null;
    drawings: string[];
    liveDrawing: string | null;
    word: string | null;
    guess: string | null;
    correct: boolean | null;
    isHostDrawer: boolean;
    isGuesser: boolean;
    isCurrentDrawer: boolean;
  };
  auction?: {
    stage: 'init' | 'setup' | 'preview' | 'bidding' | 'complete';
    budgetsSubmitted: number;
    itemsSubmitted: number;
    total: number;
    roundNumber: number;
    totalRounds: number;
    currentLotIndex: number | null;
    currentLot: AuctionLotOverview | null;
    lots: AuctionLotOverview[];
    lotOrder: string[];
    topBid: AuctionBidOverview | null;
    priceIncrement: number;
    wallets: Record<string, number>;
    bidHistory: Array<{ accountId: string; displayName: string; price: number; bidAt: string }>;
    itemsByAccount: Record<string, string[]>;
    soldCount: number;
    lastActionAt: number | null;
    auctioneerMode: 'free' | 'designated';
    auctioneerAccountId: string | null;
    auctioneerName: string | null;
    rankingsPreview: {
      richRanking: Array<{ accountId: string; displayName: string; wallet: number }>;
      auctionRanking: Array<{ lotId: string; title: string; soldPrice: number | null; sellerName: string; winnerName: string | null }>;
    };
  };
  party?: PartyView;
  story?: {
    stage: StoryStage;
    opening: string;
    endingHint?: string;
    ending?: string;
    participants: StoryParticipant[];
    order: string[];
    turnStartedAt: number | null;
    readyToStart: boolean;
    source: 'ai' | 'local' | 'manual' | 'legacy' | null;
    tasks?: Record<string, string>;
    approvals?: Record<string, Record<string, boolean>>;
    rulings?: Record<string, StoryRuling>;
    details?: Record<string, StoryScoreDetail>;
    segments: StorySegmentOverview[];
    currentSpeakerId: string | null;
    currentSpeakerName: string | null;
    currentSpeakerRole: string | null;
    submittedCount: number;
    total: number;
    votedCount: number;
    voterCount: number;
    points: Record<string, number>;
    ownTask: string | null;
    ownVote: string | null;
  };
  shopping?: {
    stage: 'shopping' | 'complete';
    completedCount: number;
    total: number;
    budget: number;
    remaining: number;
    ownTask: ShoppingTask | null;
    ownPurchase: ShoppingPurchase | null;
    results: ShoppingResult[];
  };
}

export interface ShoppingTask { color: string; purpose: string; suggestion: string; brief: string }

/** 轻量玩法的统一视图：服务端已按账号裁剪私密内容 */
export interface PartyView {
  gameId: PartyGameId;
  mode: 'deal' | 'draw' | 'roll';
  stage: 'playing' | 'reveal' | 'complete';
  round: number;
  totalRounds: number;
  isHost: boolean;
  isMyTurn: boolean;
  turnAccountId: string | null;
  turnName: string | null;
  /** 当前牌面；answer 仅在揭晓后下发 */
  current: PartyCardView | null;
  /** 发牌型玩法：我自己的身份牌 */
  hand: string[] | null;
  /** 我是谁：其他人看得到的身份（不含自己） */
  others: Array<{ accountId: string; displayName: string; card: string }> | null;
  guesses: PartyGuessView[];
  ownGuess: string | null;
  points: Record<string, number>;
  deckLeft: number;
  log: Array<{ label: string; detail: string | null; ownerName: string | null; at: string; revealed: boolean }>;
  dice: PartyDiceRoll[];
  diceConfig: { count: number; sides: number };
  notes: Array<{ accountId: string; displayName: string; text: string; verdict: string; at: string }>;
  /** 秘密词二十问剩余可提问数 */
  limit: number | null;
  /** 狼人杀阶段：夜晚 / 白天 / 投票 */
  phase: string | null;
  /** 我是否还能提交猜测 */
  canGuess: boolean;
  results: Array<{ accountId: string; displayName: string; points: number; winner: boolean }> | null;
  revealAll: Array<{ accountId: string; displayName: string; card: string }> | null;
  /** 房间 IP 主题快照（开局时固化） */
  theme: string;
  /** 个性化来源：local=本地模板 / ai=AI 增强牌堆 / legacy=升级前旧局（无 flavor） */
  flavorSource: 'local' | 'ai' | 'legacy';
  /** 我的 MBTI 桶位（用于前端文案语气），缺 MBTI 时为 null */
  myBucket: FlavorBucket | null;
  /** 发牌型玩法：我自己身份牌的风味句（只有自己可见） */
  handFlavor: string | null;
}

export interface PartyCardView {
  id: string;
  label: string;
  detail: string | null;
  answer: string | null;
  revealed: boolean;
  mine: boolean;
  ownerName: string | null;
  /** 个性化：IP 主题 × 角色档案生成的题头（如「《罗小黑战记》· 罗小黑专属」）；hidden 时为 null */
  kicker: string | null;
  /** 个性化：按持有者 MBTI 桶位生成的玩法提示（不包含答案）；hidden 时为 null */
  flavor: string | null;
  /** 桶位标签，用于前端配色；hidden 时为空数组 */
  tags: FlavorBucket[];
}

export interface PartyGuessView { accountId: string; displayName: string; text: string; correct: boolean | null; at: string }
export interface PartyDiceRoll { accountId: string; displayName: string; values: number[]; total: number; at: string }
export interface ShoppingPurchase { itemName: string; price: number; note: string; completedAt: string }
export interface ShoppingResult { accountId: string; displayName: string; playerRole: string; budget: number; spent: number; remaining: number; task: ShoppingTask; purchase: ShoppingPurchase | null }

export interface StorySegmentOverview {
  accountId: string;
  displayName: string;
  playerRole: string;
  content: string;
  voteCount: number;
  submittedAt: string | null;
  audioAssetId?: string | null;
}

export type StoryStage = 'setup' | 'relay' | 'reveal' | 'voting' | 'review' | 'complete';
export interface StoryParticipant { accountId: string; displayName: string; playerRole: string; persona: string }
export interface StoryRuling { characterPresent: boolean; ooc: boolean; disconnected: boolean; endingConnection: boolean; spoiler: boolean; reason: string }
export interface StoryScoreDetail { votes: number; best: number; task: number; connection: number; missingCharacter: number; ooc: number; disconnected: number; skipped: number; spoiler: boolean; total: number }

export interface AuctionBidOverview {
  accountId: string;
  displayName: string | null;
  price: number;
  bidAt: string | null;
}

export interface AuctionLotOverview {
  lotId: string;
  sellerAccountId: string;
  sellerName: string | null;
  sellerRole: string | null;
  title: string | null;
  story: string | null;
  assetId: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  submittedAt: string | null;
  bidCount: number;
  reservePrice: number | null;
  soldPrice: number | null;
  winnerAccountId: string | null;
  winnerName: string | null;
  sold: boolean;
}

export interface PlayerLegend {
  accountId: string;
  displayName: string;
  playerRole: string;
  color: string;
  initial: string;
}

export type TimelineItemStatus = 'completed' | 'current' | 'next' | 'upcoming';

export interface PartyTimelineItem {
  planItemId: string;
  gameId: GameId;
  position: number;
  status: TimelineItemStatus;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  legacy?: boolean;
  rounds?: number;
  currentRound?: number;
  sessionIds?: string[];
}

export interface PartyTimeline {
  items: PartyTimelineItem[];
  extras: PartyTimelineItem[];
  players: PlayerLegend[];
}

export interface GameHistoryEvent {
  id: string;
  actorAccountId: string | null;
  actorName: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  legacy?: boolean;
}

export interface WitchHistoryBurial {
  accountId: string;
  displayName: string;
  playerRole: string;
  punishment: string;
  buriedAt: string | null;
}

export interface WitchHistoryClick {
  accountId: string;
  displayName: string;
  playerRole: string;
  color: string;
  initial: string;
  clickedAt: string | null;
  hit: boolean;
}

export interface WitchHistoryCell {
  cell: number;
  state: 'untouched' | 'safe' | 'hit';
  burials: WitchHistoryBurial[];
  clicks: WitchHistoryClick[];
}

export interface GameHistory {
  sessionId: string;
  planItemId: string | null;
  gameId: GameId;
  phase: GameSnapshot['phase'];
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  players: PlayerLegend[];
  overview: GameOverview | null;
  events: GameHistoryEvent[];
  dont?: {
    players: Array<{
      accountId: string;
      displayName: string;
      playerRole: string;
      words: string[];
      currentWord: string | null;
      usedWords: string[];
      wordCount: number;
      winner: boolean;
    }>;
  };
  challenges?: Array<{
    accountId: string;
    displayName: string;
    playerRole: string;
    title: string;
    content: string;
    completed: boolean;
    triggerCount?: number;
    cardChangeCount?: number;
    challengeHistory?: string[];
    winner?: boolean;
  }>;
  witch?: {
    cells: WitchHistoryCell[];
    buriedCount: number;
    investigatorCount: number;
  };
  draw?: {
    word: string;
    guess: string | null;
    correct: boolean | null;
    turns: Array<{
      accountId: string;
      displayName: string;
      playerRole: string;
      drawing: string;
    }>;
  };
  truth?: {
    rounds: Array<{
      speakerAccountId: string;
      speakerName: string;
      playerRole: string;
      statements: string[];
      falseIndex: number;
      votes: Array<{ accountId: string; displayName: string; statementIndex: number; correct: boolean }>;
    }>;
    results: Array<{ accountId: string; displayName: string; points: number; winner: boolean }>;
  };
  auction?: {
    initialBudgets: Record<string, number>;
    finalWallets: Record<string, number>;
    lots: Array<{
      lotId: string;
      sellerAccountId: string;
      sellerName: string;
      sellerRole: string;
      title: string;
      story: string;
      assetId: string;
      imageUrl: string;
      thumbUrl: string;
      submittedAt: string;
      bidHistory: Array<{ accountId: string; displayName: string; price: number; bidAt: string }>;
      winnerAccountId: string | null;
      winnerName: string | null;
      soldPrice: number | null;
      soldAt: string | null;
      sold: boolean;
    }>;
    richRanking: Array<{ accountId: string; displayName: string; playerRole: string; wallet: number; delta: number; score?: number; winner: boolean }>;
    auctionRanking: Array<{ lotId: string; title: string; sellerName: string; buyerName: string | null; soldPrice: number }>;
  };
  story?: {
    opening: string;
    endingHint?: string;
    ending: string;
    segments: Array<{
      accountId: string;
      displayName: string;
      playerRole: string;
      content: string;
      task: string;
      taskCompleted: boolean;
      voteCount: number;
      score: number;
      submittedAt: string | null;
      audioAssetId?: string | null;
    }>;
    votes: Array<{ voterAccountId: string; voterName: string; targetAccountId: string; targetName: string }>;
    results: Array<{ accountId: string; displayName: string; playerRole: string; points: number; winner: boolean; loser?: boolean }>;
    participants?: StoryParticipant[];
    order?: string[];
    tasks?: Record<string, string>;
    rulings?: Record<string, StoryRuling>;
    approvals?: Record<string, Record<string, boolean>>;
    details?: Record<string, StoryScoreDetail>;
  };
  shopping?: {
    ipTheme: string;
    results: ShoppingResult[];
  };
  undercover?: UndercoverView;
  legacy?: boolean;
}

export interface GameAction {
  actionId: string;
  gameId: GameId;
  action: string;
  payload?: Record<string, unknown>;
}

export interface UndercoverParticipant { accountId:string; displayName:string; playerRole:string }
export interface UndercoverRound { round:number; votes:Record<string,string>; eliminated:string|null; tied:string[] }
export interface UndercoverView {
  stage:'setup'|'speaking'|'voting'|'result'|'complete';
  ipTheme:string;
  participants:UndercoverParticipant[];
  count:number; recommended:number; maxCount:number;
  alive:string[]; round:number; speakerId:string|null;
  votedCount:number; totalVoters:number;
  ownVote:string|null; ownWord:string|null;
  lastResult:UndercoverRound|null;
  winner:'civilian'|'undercover'|null; aborted:boolean;
  reveal?:{ words:{civilian:string;undercover:string}|null; spies:string[]; rounds:UndercoverRound[] };
}
