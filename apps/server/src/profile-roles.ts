import type { IpRole, Mbti, PartyRoleProfile, RoomSnapshot } from '@ruxiju/shared';
import type { Store } from './store.js';

/**
 * 房间花名册解析：把「房间成员 → 用户档案」的 4 级角色兜底逻辑收敛到一个公用模块。
 * 兜底顺序：ipRoleId 精确匹配 → 同主题默认角色 → 同主题任意角色 → 无角色（用 member.playerRole / 昵称）。
 * 轻量玩法不要求全员准备，所以这里包含所有在线成员；下游按需再过滤。
 */
export type RosterSource = 'ipRoleId' | 'theme-default' | 'theme' | 'fallback';

export interface RoomRosterEntry {
  accountId: string;
  displayName: string;
  /** 服务端最终采用的角色名：角色档案名优先，其次 member.playerRole，最后昵称 */
  playerRole: string;
  mbti: Mbti | null;
  role: IpRole | null;
  source: RosterSource;
  ready: boolean;
}

function resolveRole(member: RoomSnapshot['members'][number], room: RoomSnapshot, profile: { roles: IpRole[]; mbti: Mbti | null }): { role: IpRole | null; source: RosterSource } {
  const byId = member.ipRoleId ? profile.roles.find(role => role.id === member.ipRoleId) : undefined;
  if (byId) return { role: byId, source: 'ipRoleId' };
  const themeDefault = profile.roles.find(role => role.ipTheme === room.ipTheme && role.isDefault);
  if (themeDefault) return { role: themeDefault, source: 'theme-default' };
  const themeRole = profile.roles.find(role => role.ipTheme === room.ipTheme);
  if (themeRole) return { role: themeRole, source: 'theme' };
  return { role: null, source: 'fallback' };
}

export async function resolveRoomRoster(store: Store, room: RoomSnapshot, options: { includeUnready?: boolean } = {}): Promise<RoomRosterEntry[]> {
  const members = options.includeUnready === false ? room.members.filter(member => member.ready) : room.members;
  return Promise.all(members.map(async member => {
    const profile = await store.getProfile(member.accountId);
    const { role, source } = resolveRole(member, room, profile);
    return {
      accountId: member.accountId,
      displayName: member.displayName,
      playerRole: role?.name ?? member.playerRole ?? member.displayName,
      mbti: profile.mbti,
      role,
      source,
      ready: member.ready
    };
  }));
}

/** 轻量玩法引擎使用的精简档案：缺角色/缺 MBTI 的成员也保留（mbti=null，下游均衡权重） */
export function toPartyProfiles(entries: RoomRosterEntry[], theme: string): PartyRoleProfile[] {
  return entries.map(entry => ({
    accountId: entry.accountId,
    displayName: entry.displayName,
    playerRole: entry.playerRole || entry.displayName,
    ipTheme: entry.role?.ipTheme ?? theme,
    mbti: entry.mbti,
    personaTags: entry.role?.personaTags ?? [],
    quote: entry.role?.quote ?? '',
    signatureAction: entry.role?.signatureAction ?? '',
    ability: entry.role?.ability ?? ''
  }));
}
