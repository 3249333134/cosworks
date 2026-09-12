import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameId, IpRole, Mbti, RecentRoomSummary, RoomMember, RoomSnapshot, UserProfile } from '@ruxiju/shared';
import { config } from './config.js';

export interface UserRecord { id:string; account:string; passwordHash:string; displayName:string }
export interface GameSessionRecord { id:string; roomId:string; gameId:GameId; planItemId:string|null; state:unknown; startedAt:string; endedAt:string|null }
export type GameEventVisibility = 'public' | 'private' | 'public_after_settle';
export interface GameEventRecord { id:string; sessionId:string; actorAccountId:string|null; eventType:string; visibility:GameEventVisibility; payload:Record<string,unknown>; createdAt:string }
export interface GeneratedContentRecord { cacheKey:string; accountId:string|null; gameId:string; content:unknown; rulesVersion:number }
export interface AssetRecord { id:string; accountId:string; roomId:string|null; filename:string; mimeType:string; size:number; width:number|null; height:number|null; thumbSize:number|null; createdAt:string; dataUrl:string|null; imagePath?:string|null; thumbPath?:string|null; usedInSessionId?:string|null; usedAt?:string|null; }
export interface Store {
  atomic<T>(work:(store:Store)=>Promise<T>):Promise<T>;
  ping(): Promise<void>;
  ensureTimelineSchema(): Promise<void>;
  createUser(account:string, passwordHash:string, displayName:string): Promise<UserRecord>;
  findUserByAccount(account:string): Promise<UserRecord | null>;
  findUserById(id:string): Promise<UserRecord | null>;
  getProfile(accountId:string): Promise<UserProfile>;
  updateProfile(accountId:string, patch:{displayName?:string; mbti?:Mbti}): Promise<UserProfile>;
  saveRole(accountId:string, role:Omit<IpRole,'id'> & {id?:string}): Promise<IpRole>;
  deleteRole(accountId:string, roleId:string): Promise<void>;
  createRoom(room:RoomSnapshot): Promise<void>;
  getRoom(code:string): Promise<RoomSnapshot | null>;
  listRecentRooms(accountId:string, limit:number): Promise<RecentRoomSummary[]>;
  saveRoom(room:RoomSnapshot): Promise<void>;
  saveGameSession(room:RoomSnapshot, state:unknown, ended?:boolean): Promise<void>;
  getGameSession(sessionId:string): Promise<unknown | null>;
  getGameSessionRecord(sessionId:string): Promise<GameSessionRecord | null>;
  listGameSessions(roomId:string): Promise<GameSessionRecord[]>;
  addGameEvent(sessionId:string, actorAccountId:string|null, eventType:string, visibility:GameEventVisibility, payload?:Record<string,unknown>): Promise<void>;
  listGameEvents(sessionId:string): Promise<GameEventRecord[]>;
  getMemberEvents(roomId:string, accountId:string, limit?:number): Promise<GameEventRecord[]>;
  getGeneratedContent(cacheKey:string): Promise<GeneratedContentRecord | null>;
  listGeneratedContent(prefix:string): Promise<GeneratedContentRecord[]>;
  saveGeneratedContent(record:GeneratedContentRecord): Promise<void>;
  deleteGeneratedContent(cacheKey:string): Promise<void>;
  markAction(actionId:string, roomId:string, accountId:string, gameId:string, action:string, payload:unknown): Promise<boolean>;
  addAudit(roomId:string, actorId:string, type:string, reason:string, metadata?:unknown): Promise<void>;
  saveAsset(asset:AssetRecord): Promise<void>;
  getAsset(id:string): Promise<AssetRecord | null>;
}

export class MemoryStore implements Store {
  users = new Map<string,UserRecord>(); profiles = new Map<string,UserProfile>(); rooms = new Map<string,RoomSnapshot>(); roomUpdated = new Map<string,string>(); sessions = new Map<string,GameSessionRecord>(); events = new Map<string,GameEventRecord[]>(); generated = new Map<string,GeneratedContentRecord>(); actions = new Set<string>(); audits:unknown[] = []; assets = new Map<string,AssetRecord>();
  async atomic<T>(work:(store:Store)=>Promise<T>):Promise<T>{
    const draft=new MemoryStore();
    const maps=['users','profiles','rooms','roomUpdated','sessions','events','generated','assets'] as const;
    for(const key of maps)(draft[key] as Map<string,unknown>)=structuredClone(this[key]);
    draft.actions=new Set(this.actions);draft.audits=structuredClone(this.audits);
    const baseline=new Map(maps.map(key=>[key,new Map([...this[key]].map(([id,value])=>[id,JSON.stringify(value)]))]));
    const actionsBefore=new Set(this.actions);const auditsBefore=this.audits.length;
    const result=await work(draft);
    // Publish the write set synchronously; unrelated room commits remain intact.
    for(const key of maps){const target=this[key] as Map<string,unknown>;const before=baseline.get(key)!;
      for(const [id,value] of draft[key])if(before.get(id)!==JSON.stringify(value))target.set(id,value);
      for(const id of before.keys())if(!draft[key].has(id))target.delete(id);
    }
    for(const id of draft.actions)if(!actionsBefore.has(id))this.actions.add(id);
    this.audits.push(...draft.audits.slice(auditsBefore));return result;
  }
  async ping(){}
  async ensureTimelineSchema(){}
  async createUser(account:string,passwordHash:string,displayName:string){ if(await this.findUserByAccount(account)) throw new Error('账号已存在'); const user={id:randomUUID(),account,passwordHash,displayName}; this.users.set(user.id,user); this.profiles.set(user.id,{accountId:user.id,displayName,mbti:null,mbtiCompletedAt:null,roles:[]}); return user; }
  async findUserByAccount(account:string){ return [...this.users.values()].find(user=>user.account===account) ?? null; }
  async findUserById(id:string){ return this.users.get(id) ?? null; }
  async getProfile(accountId:string){ const value=this.profiles.get(accountId); if(!value) throw new Error('账号不存在'); return structuredClone(value); }
  async updateProfile(accountId:string,patch:{displayName?:string;mbti?:Mbti}){ const value=await this.getProfile(accountId); if(patch.displayName)value.displayName=patch.displayName; if(patch.mbti){value.mbti=patch.mbti;value.mbtiCompletedAt=new Date().toISOString();} this.profiles.set(accountId,value); const user=this.users.get(accountId); if(user&&patch.displayName)user.displayName=patch.displayName; return value; }
  async saveRole(accountId:string,role:Omit<IpRole,'id'>&{id?:string}){ const profile=await this.getProfile(accountId); const value={...role,id:role.id??randomUUID()}; if(value.isDefault)profile.roles.forEach(item=>{if(item.ipTheme===value.ipTheme)item.isDefault=false;}); const index=profile.roles.findIndex(item=>item.id===value.id); if(index>=0)profile.roles[index]=value;else profile.roles.push(value); this.profiles.set(accountId,profile); return value; }
  async deleteRole(accountId:string,roleId:string){ const profile=await this.getProfile(accountId); profile.roles=profile.roles.filter(role=>role.id!==roleId); this.profiles.set(accountId,profile); }
  async createRoom(room:RoomSnapshot){ this.rooms.set(room.code,structuredClone(room));this.roomUpdated.set(room.code,new Date().toISOString()); }
  async getRoom(code:string){ const value=this.rooms.get(code); return value?structuredClone(value):null; }
  async listRecentRooms(accountId:string,limit:number){return [...this.rooms.values()].filter(room=>room.members.some(member=>member.accountId===accountId)).sort((a,b)=>String(this.roomUpdated.get(b.code)).localeCompare(String(this.roomUpdated.get(a.code)))).slice(0,limit).map(room=>recentSummary(room,accountId,this.roomUpdated.get(room.code)??new Date().toISOString()));}
  async saveRoom(room:RoomSnapshot){ this.rooms.set(room.code,structuredClone(room));this.roomUpdated.set(room.code,new Date().toISOString()); }
  async saveGameSession(room:RoomSnapshot,state:unknown,ended=false){if(!room.game)return;const prior=this.sessions.get(room.game.sessionId);this.sessions.set(room.game.sessionId,{id:room.game.sessionId,roomId:room.id,gameId:room.game.gameId,planItemId:room.game.planItemId??null,state:structuredClone(state),startedAt:prior?.startedAt??new Date().toISOString(),endedAt:ended||room.game.phase==='settled'?new Date().toISOString():prior?.endedAt??null});}
  async getGameSession(sessionId:string){const value=this.sessions.get(sessionId);return value?structuredClone(value.state):null;}
  async getGameSessionRecord(sessionId:string){const value=this.sessions.get(sessionId);return value?structuredClone(value):null;}
  async listGameSessions(roomId:string){return [...this.sessions.values()].filter(item=>item.roomId===roomId).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).map(item=>structuredClone(item));}
  async addGameEvent(sessionId:string,actorAccountId:string|null,eventType:string,visibility:GameEventVisibility,payload:Record<string,unknown>={}){const record={id:randomUUID(),sessionId,actorAccountId,eventType,visibility,payload:structuredClone(payload),createdAt:new Date().toISOString()};this.events.set(sessionId,[...(this.events.get(sessionId)??[]),record]);}
  async listGameEvents(sessionId:string){return structuredClone(this.events.get(sessionId)??[]);}
  async getMemberEvents(roomId:string, accountId:string, limit=50){const sessions=await this.listGameSessions(roomId);const all:GameEventRecord[]=[];for(const session of sessions){const events=await this.listGameEvents(session.id);for(const event of events)if(event.actorAccountId===accountId)all.push(event);}return all.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);}
  async getGeneratedContent(cacheKey:string){const value=this.generated.get(cacheKey);return value?structuredClone(value):null;}
  async listGeneratedContent(prefix:string){return [...this.generated.values()].filter(item=>item.cacheKey.startsWith(prefix)).map(item=>structuredClone(item));}
  async saveGeneratedContent(record:GeneratedContentRecord){this.generated.set(record.cacheKey,structuredClone(record));}
  async deleteGeneratedContent(cacheKey:string){this.generated.delete(cacheKey);}
  async markAction(actionId:string){ if(this.actions.has(actionId))return false; this.actions.add(actionId); return true; }
  async addAudit(roomId:string,actorId:string,type:string,reason:string,metadata?:unknown){ this.audits.push({roomId,actorId,type,reason,metadata,at:Date.now()}); }
  async saveAsset(asset:AssetRecord){this.assets.set(asset.id,structuredClone(asset));}
  async getAsset(id:string){const value=this.assets.get(id);return value?structuredClone(value):null;}
}

export class MySqlStore implements Store {
  constructor(private pool:Pool|PoolConnection){}
  async atomic<T>(work:(store:Store)=>Promise<T>):Promise<T>{
    if(!('getConnection' in this.pool))return work(this);
    const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();const result=await work(new MySqlStore(connection));await connection.commit();return result;}
    catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async ping(){await this.pool.query('SELECT 1');}
  async ensureTimelineSchema(){const [columns]=await this.pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='game_sessions' AND column_name='plan_item_id' LIMIT 1");if(!columns.length)await this.pool.execute('ALTER TABLE game_sessions ADD COLUMN plan_item_id VARCHAR(80) NULL AFTER game_id');const [indexes]=await this.pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='game_sessions' AND index_name='idx_session_plan_item' LIMIT 1");if(!indexes.length)await this.pool.execute('CREATE INDEX idx_session_plan_item ON game_sessions(plan_item_id)');await this.pool.execute(`CREATE TABLE IF NOT EXISTS game_events (id CHAR(36) PRIMARY KEY,session_id CHAR(36) NOT NULL,actor_account_id CHAR(36) NULL,event_type VARCHAR(60) NOT NULL,visibility ENUM('public','private','public_after_settle') NOT NULL,payload_json JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX idx_event_session_time(session_id,created_at),CONSTRAINT fk_event_session FOREIGN KEY(session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,CONSTRAINT fk_event_actor FOREIGN KEY(actor_account_id) REFERENCES users(id) ON DELETE SET NULL)`);await this.pool.execute(`CREATE TABLE IF NOT EXISTS assets (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,room_id CHAR(36) NULL,filename VARCHAR(255) NOT NULL,mime_type VARCHAR(120) NOT NULL,size BIGINT UNSIGNED NOT NULL,width INT UNSIGNED NULL,height INT UNSIGNED NULL,thumb_size BIGINT UNSIGNED NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,data_url MEDIUMTEXT NULL,INDEX idx_asset_account(account_id),INDEX idx_asset_room(room_id))`);for(const [name,type] of Object.entries({image_path:'VARCHAR(512) NULL',thumb_path:'VARCHAR(512) NULL',used_in_session_id:'CHAR(36) NULL',used_at:'DATETIME(3) NULL'})){const [existing]=await this.pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='assets' AND column_name=?",[name]);if(!existing.length)await this.pool.execute(`ALTER TABLE assets ADD COLUMN ${name} ${type}`);}}
  async createUser(account:string,passwordHash:string,displayName:string){const user={id:randomUUID(),account,passwordHash,displayName};await this.pool.execute('INSERT INTO users(id,account,password_hash,display_name) VALUES(?,?,?,?)',[user.id,account,passwordHash,displayName]);await this.pool.execute('INSERT INTO user_profiles(account_id,display_name) VALUES(?,?)',[user.id,displayName]);return user;}
  async findUserByAccount(account:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,account,password_hash passwordHash,display_name displayName FROM users WHERE account=?',[account]);return (rows[0] as UserRecord)??null;}
  async findUserById(id:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,account,password_hash passwordHash,display_name displayName FROM users WHERE id=?',[id]);return (rows[0] as UserRecord)??null;}
  async getProfile(accountId:string){const [profiles]=await this.pool.query<mysql.RowDataPacket[]>('SELECT display_name displayName,mbti,mbti_completed_at mbtiCompletedAt FROM user_profiles WHERE account_id=?',[accountId]);if(!profiles[0])throw new Error('账号不存在');const [roles]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,ip_theme ipTheme,name,persona_tags personaTags,quote,signature_action signatureAction,ability,is_default isDefault FROM user_ip_roles WHERE account_id=? ORDER BY created_at',[accountId]);return {accountId,displayName:profiles[0].displayName,mbti:profiles[0].mbti,mbtiCompletedAt:profiles[0].mbtiCompletedAt,roles:roles.map(row=>({...row,personaTags:typeof row.personaTags==='string'?JSON.parse(row.personaTags):row.personaTags,isDefault:Boolean(row.isDefault)})) as IpRole[]};}
  async updateProfile(accountId:string,patch:{displayName?:string;mbti?:Mbti}){if(patch.displayName){await this.pool.execute('UPDATE users SET display_name=? WHERE id=?',[patch.displayName,accountId]);await this.pool.execute('UPDATE user_profiles SET display_name=? WHERE account_id=?',[patch.displayName,accountId]);}if(patch.mbti)await this.pool.execute('UPDATE user_profiles SET mbti=?,mbti_completed_at=NOW() WHERE account_id=?',[patch.mbti,accountId]);return this.getProfile(accountId);}
  async saveRole(accountId:string,role:Omit<IpRole,'id'>&{id?:string}){const id=role.id??randomUUID();if(role.isDefault)await this.pool.execute('UPDATE user_ip_roles SET is_default=0 WHERE account_id=? AND ip_theme=?',[accountId,role.ipTheme]);await this.pool.execute(`INSERT INTO user_ip_roles(id,account_id,ip_theme,name,persona_tags,quote,signature_action,ability,is_default) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ip_theme=VALUES(ip_theme),name=VALUES(name),persona_tags=VALUES(persona_tags),quote=VALUES(quote),signature_action=VALUES(signature_action),ability=VALUES(ability),is_default=VALUES(is_default)`,[id,accountId,role.ipTheme,role.name,JSON.stringify(role.personaTags),role.quote,role.signatureAction,role.ability,role.isDefault?1:0]);return {...role,id};}
  async deleteRole(accountId:string,roleId:string){await this.pool.execute('DELETE FROM user_ip_roles WHERE id=? AND account_id=?',[roleId,accountId]);}
  async createRoom(room:RoomSnapshot){await this.pool.execute('INSERT INTO rooms(id,code,name,ip_theme,status,owner_account_id,state_json) VALUES(?,?,?,?,?,?,?)',[room.id,room.code,room.name,room.ipTheme,room.status,room.ownerAccountId,JSON.stringify(room)]);await this.syncMembers(room);}
  async getRoom(code:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT state_json FROM rooms WHERE code=?',[code]);if(!rows[0])return null;return typeof rows[0].state_json==='string'?JSON.parse(rows[0].state_json):rows[0].state_json;}
  async listRecentRooms(accountId:string,limit:number){const [rows]=await this.pool.query<mysql.RowDataPacket[]>(`SELECT r.state_json stateJson,r.updated_at updatedAt FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.account_id=? ORDER BY r.updated_at DESC LIMIT ?`,[accountId,limit]);return rows.map(row=>{const room=(typeof row.stateJson==='string'?JSON.parse(row.stateJson):row.stateJson) as RoomSnapshot;return recentSummary(room,accountId,new Date(row.updatedAt).toISOString());});}
  async saveRoom(room:RoomSnapshot){await this.pool.execute('UPDATE rooms SET status=?,state_json=? WHERE id=?',[room.status,JSON.stringify(room),room.id]);await this.syncMembers(room);}
  async saveGameSession(room:RoomSnapshot,state:unknown,ended=false){if(!room.game)return;await this.pool.execute(`INSERT INTO game_sessions(id,room_id,game_id,plan_item_id,state_json,started_at,ended_at) VALUES(?,?,?,?,?,NOW(),?) ON DUPLICATE KEY UPDATE plan_item_id=VALUES(plan_item_id),state_json=VALUES(state_json),ended_at=COALESCE(VALUES(ended_at),ended_at)`,[room.game.sessionId,room.id,room.game.gameId,room.game.planItemId??null,JSON.stringify(state),ended||room.game.phase==='settled'?new Date():null]);}
  async getGameSession(sessionId:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT state_json stateJson FROM game_sessions WHERE id=?',[sessionId]);if(!rows[0])return null;return typeof rows[0].stateJson==='string'?JSON.parse(rows[0].stateJson):rows[0].stateJson;}
  async getGameSessionRecord(sessionId:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,room_id roomId,game_id gameId,plan_item_id planItemId,state_json stateJson,started_at startedAt,ended_at endedAt FROM game_sessions WHERE id=?',[sessionId]);return rows[0]?sessionRecord(rows[0]):null;}
  async listGameSessions(roomId:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,room_id roomId,game_id gameId,plan_item_id planItemId,started_at startedAt,ended_at endedAt FROM game_sessions WHERE room_id=?',[roomId]);return rows.map(sessionRecord).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));}
  async addGameEvent(sessionId:string,actorAccountId:string|null,eventType:string,visibility:GameEventVisibility,payload:Record<string,unknown>={}){await this.pool.execute('INSERT INTO game_events(id,session_id,actor_account_id,event_type,visibility,payload_json) VALUES(?,?,?,?,?,?)',[randomUUID(),sessionId,actorAccountId,eventType,visibility,JSON.stringify(payload)]);}
  async listGameEvents(sessionId:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,session_id sessionId,actor_account_id actorAccountId,event_type eventType,visibility,payload_json payloadJson,created_at createdAt FROM game_events WHERE session_id=?',[sessionId]);return rows.map(row=>({id:String(row.id),sessionId:String(row.sessionId),actorAccountId:row.actorAccountId?String(row.actorAccountId):null,eventType:String(row.eventType),visibility:row.visibility as GameEventVisibility,payload:(typeof row.payloadJson==='string'?JSON.parse(row.payloadJson):row.payloadJson)??{},createdAt:new Date(row.createdAt).toISOString()})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  async getMemberEvents(roomId:string, accountId:string, limit=50){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT ge.id,ge.session_id sessionId,ge.actor_account_id actorAccountId,ge.event_type eventType,ge.visibility,ge.payload_json payloadJson,ge.created_at createdAt FROM game_events ge JOIN game_sessions gs ON ge.session_id=gs.id WHERE gs.room_id=? AND ge.actor_account_id=? ORDER BY ge.created_at DESC LIMIT ?',[roomId,accountId,limit]);return rows.map(row=>({id:String(row.id),sessionId:String(row.sessionId),actorAccountId:row.actorAccountId?String(row.actorAccountId):null,eventType:String(row.eventType),visibility:row.visibility as GameEventVisibility,payload:(typeof row.payloadJson==='string'?JSON.parse(row.payloadJson):row.payloadJson)??{},createdAt:new Date(row.createdAt).toISOString()}));}
  async getGeneratedContent(cacheKey:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT cache_key cacheKey,account_id accountId,game_id gameId,content_json contentJson,rules_version rulesVersion FROM generated_content WHERE cache_key=?',[cacheKey]);const row=rows[0];return row?{cacheKey:String(row.cacheKey),accountId:row.accountId?String(row.accountId):null,gameId:String(row.gameId),content:typeof row.contentJson==='string'?JSON.parse(row.contentJson):row.contentJson,rulesVersion:Number(row.rulesVersion)}:null;}
  async listGeneratedContent(prefix:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT cache_key cacheKey,account_id accountId,game_id gameId,content_json contentJson,rules_version rulesVersion FROM generated_content WHERE cache_key LIKE ?',[`${prefix}%`]);return rows.map(row=>({cacheKey:String(row.cacheKey),accountId:row.accountId?String(row.accountId):null,gameId:String(row.gameId),content:typeof row.contentJson==='string'?JSON.parse(row.contentJson):row.contentJson,rulesVersion:Number(row.rulesVersion)}));}
  async saveGeneratedContent(record:GeneratedContentRecord){await this.pool.execute(`INSERT INTO generated_content(id,cache_key,account_id,game_id,content_json,rules_version) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),game_id=VALUES(game_id),content_json=VALUES(content_json),rules_version=VALUES(rules_version),created_at=CURRENT_TIMESTAMP`,[randomUUID(),record.cacheKey,record.accountId,record.gameId,JSON.stringify(record.content),record.rulesVersion]);}
  async deleteGeneratedContent(cacheKey:string){await this.pool.execute('DELETE FROM generated_content WHERE cache_key=?',[cacheKey]);}
  private async syncMembers(room:RoomSnapshot){for(const member of room.members)await this.pool.execute(`INSERT INTO room_members(id,room_id,account_id,display_name,is_owner,host_role,player_role,ip_role_id,team,ready,online,score) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),host_role=VALUES(host_role),player_role=VALUES(player_role),ip_role_id=VALUES(ip_role_id),team=VALUES(team),ready=VALUES(ready),online=VALUES(online),score=VALUES(score)`,[member.id,room.id,member.accountId,member.displayName,member.isOwner?1:0,member.hostRole,member.playerRole,member.ipRoleId,member.team,member.ready?1:0,member.online?1:0,member.score]);}
  async markAction(actionId:string,roomId:string,accountId:string,gameId:string,action:string,payload:unknown){try{await this.pool.execute('INSERT INTO game_actions(action_id,room_id,account_id,game_id,action,payload_json) VALUES(?,?,?,?,?,?)',[actionId,roomId,accountId,gameId,action,JSON.stringify(payload??{})]);return true;}catch(error){if((error as {code?:string}).code==='ER_DUP_ENTRY')return false;throw error;}}
  async addAudit(roomId:string,actorId:string,type:string,reason:string,metadata?:unknown){await this.pool.execute('INSERT INTO audit_logs(id,room_id,actor_account_id,event_type,reason,metadata_json) VALUES(?,?,?,?,?,?)',[randomUUID(),roomId,actorId,type,reason,JSON.stringify(metadata??{})]);}
  async saveAsset(asset:AssetRecord){await this.pool.execute(`INSERT INTO assets(id,account_id,room_id,filename,mime_type,size,width,height,thumb_size,created_at,data_url,image_path,thumb_path,used_in_session_id,used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),room_id=VALUES(room_id),filename=VALUES(filename),mime_type=VALUES(mime_type),size=VALUES(size),width=VALUES(width),height=VALUES(height),thumb_size=VALUES(thumb_size),data_url=VALUES(data_url),image_path=VALUES(image_path),thumb_path=VALUES(thumb_path),used_in_session_id=VALUES(used_in_session_id),used_at=VALUES(used_at)`,[asset.id,asset.accountId,asset.roomId,asset.filename,asset.mimeType,asset.size,asset.width,asset.height,asset.thumbSize,new Date(asset.createdAt),asset.dataUrl,asset.imagePath??null,asset.thumbPath??null,asset.usedInSessionId??null,asset.usedAt?new Date(asset.usedAt):null]);}
  async getAsset(id:string){const [rows]=await this.pool.query<mysql.RowDataPacket[]>('SELECT id,account_id accountId,room_id roomId,filename,mime_type mimeType,size,width,height,thumb_size thumbSize,created_at createdAt,data_url dataUrl,image_path imagePath,thumb_path thumbPath,used_in_session_id usedInSessionId,used_at usedAt FROM assets WHERE id=? LIMIT 1',[id]);const row=rows[0] as mysql.RowDataPacket|null|undefined;if(!row)return null;const createdAtRaw=row.createdAt as unknown;return {id:String(row.id),accountId:String(row.accountId),roomId:row.roomId!=null?String(row.roomId):null,filename:String(row.filename),mimeType:String(row.mimeType),size:Number(row.size)||0,width:row.width!=null?Number(row.width):null,height:row.height!=null?Number(row.height):null,thumbSize:row.thumbSize!=null?Number(row.thumbSize):null,createdAt:createdAtRaw instanceof Date?createdAtRaw.toISOString():String(createdAtRaw),imagePath:row.imagePath??null,thumbPath:row.thumbPath??null,usedInSessionId:row.usedInSessionId??null,usedAt:row.usedAt?new Date(row.usedAt).toISOString():null,dataUrl:row.dataUrl!=null?String(row.dataUrl):null};}
}

export function createStore():Store { if(config.dataMode==='mysql')return new MySqlStore(mysql.createPool({...config.db,connectionLimit:10,timezone:'Z'})); const store=new MemoryStore(); autoPersist(store); return store; }

const __dirname=dirname(fileURLToPath(import.meta.url));
const dataDir=resolve(__dirname,'..','data');
const dataFile=resolve(dataDir,'memory-store.json');
interface PersistedSnap { _v:number; users:Record<string,UserRecord>; profiles:Record<string,UserProfile>; rooms:Record<string,RoomSnapshot>; roomUpdated:Record<string,string>; sessions:Record<string,GameSessionRecord>; events:Record<string,GameEventRecord[]>; generated:Record<string,GeneratedContentRecord>; actions:string[]; audits:unknown[]; assets:Record<string,AssetRecord>; }
const persistMs=Math.max(200,Number(process.env.DATA_PERSIST_MS||1000));
const SNAP_V=1;
function mapToObj<T>(map:Map<string,T>):Record<string,T>{const o:Record<string,T>={};for(const [k,v] of map)o[k]=structuredClone(v);return o;}
function objToMap<T>(o:Record<string,T>|undefined):Map<string,T>{const m=new Map<string,T>();if(o)for(const [k,v] of Object.entries(o))m.set(k,structuredClone(v));return m;}
export function autoPersist(store:MemoryStore,file=dataFile){
  mkdirSync(dirname(file),{recursive:true});
  if(existsSync(file)){
    try{
      const snap=JSON.parse(readFileSync(file,'utf8')) as PersistedSnap;
      store.users=objToMap<UserRecord>(snap.users);
      store.profiles=objToMap<UserProfile>(snap.profiles);
      store.rooms=objToMap<RoomSnapshot>(snap.rooms);
      store.roomUpdated=objToMap<string>(snap.roomUpdated);
      store.sessions=objToMap<GameSessionRecord>(snap.sessions);
      const evMap=new Map<string,GameEventRecord[]>();
      if(snap.events)for(const [k,v] of Object.entries(snap.events))evMap.set(k,v.map(x=>structuredClone(x)));
      store.events=evMap;
      store.generated=objToMap<GeneratedContentRecord>(snap.generated);
      store.actions=new Set<string>(Array.isArray(snap.actions)?snap.actions:[]);
      store.audits=structuredClone(Array.isArray(snap.audits)?snap.audits:[]);
      store.assets=objToMap<AssetRecord>(snap.assets);
      console.log(`[store] loaded ${store.users.size} users / ${store.rooms.size} rooms / ${store.assets.size} assets from ${file}`);
    }catch(e){console.warn('[store] 加载本地数据文件失败，将使用空内存库',e instanceof Error?e.message:e);}
  }
  let dirty=false;
  const mark=()=>{dirty=true;};
  const atomicOriginal=store.atomic;
  const hook=<K extends keyof Store>(fn:Store[K]):Store[K]=>(async function(this:unknown,...args:unknown[]){const r=await (fn as (...a:unknown[])=>Promise<unknown>).apply(store,args);mark();if(fn===atomicOriginal)write();return r;}) as Store[K];
  const mutateMethods:Array<keyof Store>=['atomic','createUser','updateProfile','saveRole','deleteRole','createRoom','saveRoom','saveGameSession','addGameEvent','saveGeneratedContent','deleteGeneratedContent','markAction','addAudit','saveAsset'];
  for(const m of mutateMethods){const original=(store as unknown as Record<string,unknown>)[m as string] as Store[keyof Store];(store as unknown as Record<string,unknown>)[m as string]=hook(original);}
  const write=()=>{
    if(!dirty)return;
    try{
      const snap:PersistedSnap={
        _v:SNAP_V,
        users:mapToObj(store.users),
        profiles:mapToObj(store.profiles),
        rooms:mapToObj(store.rooms),
        roomUpdated:mapToObj(store.roomUpdated),
        sessions:mapToObj(store.sessions),
        events:mapToObj(store.events),
        generated:mapToObj(store.generated),
        actions:[...store.actions.values()],
        audits:structuredClone(store.audits),
        assets:mapToObj(store.assets)
      };
      const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(snap));try{renameSync(tmp,file);}catch{writeFileSync(file,JSON.stringify(snap));}
      dirty=false;
    }catch(e){console.warn('[store] 持久化失败',e instanceof Error?e.message:e);}
  };
  let t:NodeJS.Timeout|null=null;
  const schedule=()=>{if(t)return;t=setTimeout(()=>{t=null;write();schedule();},persistMs);};
  schedule();
  const shutdown=()=>{try{write();}catch{/* noop */}};
  const terminate=()=>{shutdown();process.exit(0);};
  process.on('SIGTERM',terminate);process.on('SIGINT',terminate);process.on('exit',shutdown);
  return {flush:write,close:()=>{if(t)clearTimeout(t);write();process.off('SIGTERM',terminate);process.off('SIGINT',terminate);process.off('exit',shutdown);}};
}

function recentSummary(room:RoomSnapshot,accountId:string,updatedAt:string):RecentRoomSummary {const member=room.members.find(item=>item.accountId===accountId)!;return {code:room.code,name:room.name,ipTheme:room.ipTheme,status:room.status,currentGame:room.currentGame,playerRole:member.playerRole,isHost:Boolean(member.hostRole),memberCount:room.members.length,updatedAt,closedAt:room.closedAt??null,canReenter:!room.closedAt};}
function sessionRecord(row:mysql.RowDataPacket):GameSessionRecord {const state=typeof row.stateJson==='string'?JSON.parse(row.stateJson):row.stateJson;return {id:String(row.id),roomId:String(row.roomId),gameId:row.gameId as GameId,planItemId:row.planItemId?String(row.planItemId):((state as {game?:{planItemId?:string}})?.game?.planItemId??null),state,startedAt:new Date(row.startedAt).toISOString(),endedAt:row.endedAt?new Date(row.endedAt).toISOString():null};}
