import type { IpRole } from './types.js';
import { flavorBucket, type FlavorBucket } from './party-flavor.js';

/** 原 11 款玩法模板共用的角色风味助手：把 personaTags/quote/signatureAction/ability 用进本地文案 */
export function clipFlavor(value: string, max: number): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, Math.max(1, max - 1))}…` : v;
}

/** 角色称谓：优先带第一个人设标签，其次带能力，最后裸名 */
export function roleEpithet(role: IpRole): string {
  const tag = role.personaTags[0]?.trim();
  if (tag) return `${role.name}（${clipFlavor(tag, 10)}）`;
  const ability = role.ability.trim();
  if (ability) return `${role.name}（擅长${clipFlavor(ability, 10)}）`;
  return role.name;
}

export function roleBucket(mbti: Parameters<typeof flavorBucket>[0]): FlavorBucket {
  return flavorBucket(mbti);
}

/** 动作语气：表演型放得开，观察型收着做，语言型突出台词，竞速型突出快 */
export function bucketActionTone(bucket: FlavorBucket): string {
  switch (bucket) {
    case 'perform': return '放开了做';
    case 'observe': return '轻轻做';
    case 'verbal': return '边说边做';
    case 'speed': return '快速做';
  }
}

/** 社交语气：给社交型玩法（imitate/camera/auction）的桶位差异 */
export function bucketSocialTone(bucket: FlavorBucket): string {
  switch (bucket) {
    case 'perform': return '让全场都注意到你';
    case 'observe': return '只用细节让最熟的人认出你';
    case 'verbal': return '用你标志性的语气说服大家';
    case 'speed': return '节奏快一点，别给大家反应时间';
  }
}
