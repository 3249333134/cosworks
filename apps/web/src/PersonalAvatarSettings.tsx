import { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '@ruxiju/shared';
import { api } from './api';
import { AvatarColorPicker } from './AvatarColorPicker';
import { avatarBackground, isAvatarColor } from './avatar-colors';

export function PersonalAvatarSettings({profile,onSaved}:{profile:UserProfile;onSaved:(color:string)=>void}) {
  const savedColor=avatarBackground(profile.avatarColor);
  const [color,setColor]=useState(savedColor),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
  const previous=useRef(savedColor),pending=useRef(false);
  useEffect(()=>{const before=previous.current;setColor(current=>current===before?savedColor:current);previous.current=savedColor;},[savedColor]);
  const save=async()=>{
    if(pending.current||!isAvatarColor(color))return;
    pending.current=true;setBusy(true);setMessage('');setFailed(false);
    try {
      const result=await api<{profile:UserProfile}>('/profile/me',{method:'PUT',body:JSON.stringify({avatarColor:color})});
      const saved=avatarBackground(result.profile.avatarColor);setColor(saved);onSaved(saved);setMessage('头像颜色已保存');
    } catch(error) {setFailed(true);setMessage(error instanceof Error?error.message:'保存失败，请重试');}
    finally {pending.current=false;setBusy(false);}
  };
  return <section className="settings-section personal-avatar-settings"><h2 className="section-label">个人头像</h2><AvatarColorPicker label="个人头像颜色" name={profile.displayName} value={color} disabled={busy} onChange={value=>{setColor(value);setMessage('');}}/><button type="button" className="avatar-save" disabled={busy||!isAvatarColor(color)} onClick={()=>void save()}>{busy?'正在保存…':'保存颜色'}</button>{message&&<p className={failed?'avatar-color-error':'muted'} role={failed?'alert':'status'}>{message}</p>}</section>;
}
