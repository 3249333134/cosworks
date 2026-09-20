import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { MemoryStore, MySqlStore, autoPersist } from './store.js';
import { createApp } from './app.js';
import { signSession } from './auth.js';
import { applyRoleResearch, saveUserRole } from './background.js';

const draft={ipTheme:'测试',name:'角色',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true};
async function fixture(){const store=new MemoryStore();const user=await store.createUser('avatar-test','unused','测试玩家');return {store,user,app:createApp(store),auth:{Authorization:`Bearer ${signSession(user.id)}`}};}
describe('account and role avatar colors',()=>{
  it('saves independent colors, normalizes input and preserves them for old clients',async()=>{
    const {store,user,app,auth}=await fixture();
    const personal=await request(app).put('/api/profile/me').set(auth).send({avatarColor:'#abcdef'});
    expect(personal.status).toBe(200);expect(personal.body.data.profile.avatarColor).toBe('#ABCDEF');expect(store.jobs.size).toBe(0);
    const first=await request(app).post('/api/profile/me/roles').set(auth).send({...draft,avatarColor:'#123456'});
    const second=await request(app).post('/api/profile/me/roles').set(auth).send({...draft,name:'角色二',avatarColor:'#654321'});
    expect(first.status).toBe(201);expect(second.status).toBe(201);
    await request(app).put('/api/profile/me').set(auth).send({mbti:'INFP'});
    const old=await request(app).put(`/api/profile/me/roles/${first.body.data.role.id}`).set(auth).send({...draft,quote:'旧客户端更新'});
    expect(old.status).toBe(200);expect(old.body.data.role.avatarColor).toBe('#123456');
    // A new client reading the account sees all three independent colors.
    const profile=(await request(app).get('/api/profile/me').set({Authorization:`Bearer ${signSession(user.id)}`})).body.data.profile;
    expect(profile.avatarColor).toBe('#ABCDEF');expect(profile.mbti).toBe('INFP');
    expect(profile.roles.map((r:{avatarColor:string})=>r.avatarColor)).toEqual(['#123456','#654321']);
  });
  it.each(['#fff','red','#12345G',null,123,'#12345678'])('rejects invalid color %s without changing saved data',async color=>{
    const {store,user,app,auth}=await fixture();await store.updateProfile(user.id,{avatarColor:'#123456'});
    const profile=await request(app).put('/api/profile/me').set(auth).send({avatarColor:color});
    const role=await request(app).post('/api/profile/me/roles').set(auth).send({...draft,avatarColor:color});
    expect(profile.status).toBeGreaterThanOrEqual(400);expect(role.status).toBeGreaterThanOrEqual(400);
    expect((await store.getProfile(user.id)).avatarColor).toBe('#123456');expect((await store.getProfile(user.id)).roles).toHaveLength(0);
  });
  it('preserves colors across background research and memory store restart',async()=>{
    const {store,user}=await fixture();const dir=mkdtempSync(join(tmpdir(),'avatar-colors-'));let close:(()=>void)|undefined;
    try {
      const file=join(dir,'state.json');close=autoPersist(store,file).close;
      await store.updateProfile(user.id,{avatarColor:'#55C4D5'});
      const role=await saveUserRole(store,user.id,{...draft,avatarColor:'#B49BEF'},true);
      const job=(await store.getJob(role.generation!.taskId))!;
      await saveUserRole(store,user.id,{...role,avatarColor:'#F28E85'});
      await applyRoleResearch(store,job,{personaTags:['温柔'],quote:'台词',signatureAction:'挥手',ability:'能力',sources:[],evidence:{},retrievedAt:new Date().toISOString()});
      close();const loaded=new MemoryStore();close=autoPersist(loaded,file).close;
      const profile=await loaded.getProfile(user.id);expect(profile.avatarColor).toBe('#55C4D5');expect(profile.roles[0]).toMatchObject({avatarColor:'#F28E85',ability:'能力'});
    } finally {close?.();rmSync(dir,{recursive:true,force:true});}
  });
  it('does not allow another account to recolor a role',async()=>{
    const {store,user,app}=await fixture();const role=await saveUserRole(store,user.id,{...draft,avatarColor:'#123456'});const other=await store.createUser('other','unused','其他人');
    const response=await request(app).put(`/api/profile/me/roles/${role.id}`).set('Authorization',`Bearer ${signSession(other.id)}`).send({...draft,avatarColor:'#FFFFFF'});
    expect(response.status).toBeGreaterThanOrEqual(400);expect((await store.getProfile(user.id)).roles[0].avatarColor).toBe('#123456');
  });
});
describe('MySQL avatar storage contract',()=>{
  it('binds colors, loads them and preserves omitted role colors',async()=>{
    const execute=vi.fn(async(_sql:string,_args?:unknown[])=>[{},[]]);
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes('FROM user_profiles'))return [[{displayName:'玩家',mbti:null,mbtiCompletedAt:null,avatarColor:'#123456'}],[]];
      if(sql.startsWith('SELECT avatar_color'))return [[{avatarColor:'#654321'}],[]];
      return [[{...draft,id:'role',avatarColor:'#654321',personaTags:'[]',isDefault:1}],[]];
    });
    const store=new MySqlStore({execute,query} as unknown as Pool);
    expect((await store.updateProfile('account',{avatarColor:'#123456'})).avatarColor).toBe('#123456');
    expect(execute).toHaveBeenCalledWith('UPDATE user_profiles SET avatar_color=? WHERE account_id=?',['#123456','account']);
    expect((await store.saveRole('account',{...draft,id:'role'})).avatarColor).toBe('#654321');
    const insert=execute.mock.calls.find(call=>String(call[0]).startsWith('INSERT INTO user_ip_roles'));
    expect(insert?.[1]).toContain('#654321');expect((await store.getProfile('account')).roles[0].avatarColor).toBe('#654321');
  });
  it('adds missing columns only once during schema initialization',async()=>{
    const present=new Set<string>();
    const query=vi.fn(async(sql:string,args?:unknown[])=>sql.includes("column_name='avatar_color'")?[present.has(String(args?.[0]))?[{found:1}]:[],[]]:[[{found:1}],[]]);
    const execute=vi.fn(async(sql:string)=>{const table=/ALTER TABLE (user_profiles|user_ip_roles) ADD COLUMN avatar_color/.exec(sql)?.[1];if(table)present.add(table);return [{},[]];});
    const store=new MySqlStore({execute,query} as unknown as Pool);await store.ensureTimelineSchema();await store.ensureTimelineSchema();
    expect(execute.mock.calls.filter(([sql])=>sql.includes('ADD COLUMN avatar_color'))).toHaveLength(2);
  });
});
