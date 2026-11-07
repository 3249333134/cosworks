/**
 * 轻量玩法答案判定：从 party-engine 抽出的稳定行为。
 * 服务端判定与 AI 牌堆校验共用，保证「AI 生成的答案必须能被同一套规则命中」。
 */
export interface PartyMatchCard { label: string; answer?: string; aliases?: string[] }

export function normalizePartyText(value: string) {
  return value.replace(/[\s，。！？、,.!?“”"'’：:；;（）()【】\[\]·-]/g, '').toLowerCase();
}

export function partyMatches(card: PartyMatchCard | undefined, guess: string): boolean {
  if (!card) return false;
  const target = card.answer ?? card.label;
  const text = normalizePartyText(guess);
  if (!text) return false;
  if (normalizePartyText(target) === text) return true;
  if ((card.aliases ?? []).some(alias => normalizePartyText(alias) === text)) return true;
  const normalizedTarget = normalizePartyText(target);
  return normalizedTarget.length >= 2 && (normalizedTarget.includes(text) && text.length >= Math.max(2, normalizedTarget.length - 2));
}
