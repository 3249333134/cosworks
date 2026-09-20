import { describe, expect, it, vi } from 'vitest';
import { AVATAR_COLORS, avatarBackground, avatarForeground, roleAvatarColor } from './avatar-colors';
import { mergeRoleDraft } from './RoleEditor';
vi.mock('./api',()=>({api:vi.fn()}));

describe('avatar presentation and draft preservation',()=>{
  it('uses stable role defaults and handles legacy or invalid colors',()=>{
    expect(roleAvatarColor('role-123')).toBe(roleAvatarColor('role-123'));
    expect(AVATAR_COLORS.map(c=>c.value)).toContain(roleAvatarColor('role-123'));
    expect(avatarBackground(undefined)).toBe('#E8B45A');
    expect(avatarBackground('url(https://invalid)')).toBe('#E8B45A');
    expect(avatarBackground('#abcdef')).toBe('#ABCDEF');
  });
  it('keeps avatar text contrast at least 4.5:1 for every gray shade and preset',()=>{
    for(const color of [...AVATAR_COLORS.map(c=>c.value),...Array.from({length:256},(_,i)=>'#'+i.toString(16).padStart(2,'0').repeat(3))]){
      const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      const l=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
      const contrast=avatarForeground(color)==='#000000'?(l+.05)/.05:1.05/(l+.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('retains unsaved color while applying generated fields and accepts remote colors when untouched',()=>{
    const before={id:'role',ipTheme:'test',name:'角色',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true,avatarColor:'#E8B45A'};
    const after={...before,ability:'新的能力',avatarColor:'#82AEED'};
    expect(mergeRoleDraft({...before,avatarColor:'#123456'},before,after)).toMatchObject({ability:'新的能力',avatarColor:'#123456'});
    expect(mergeRoleDraft(before,before,after).avatarColor).toBe('#82AEED');
  });
});
