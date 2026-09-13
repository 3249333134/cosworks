import { useEffect, useRef, useState } from 'react';
import type { IpRole } from '@ruxiju/shared';
import { api } from './api';
import './settings-roles.css';

export type RoleDraft=Omit<IpRole,'id'>&{id?:string};
const fields=['ipTheme','name','personaTags','quote','signatureAction','ability','isDefault'] as const;
export function mergeRoleDraft(draft:RoleDraft,before:RoleDraft,after:RoleDraft):RoleDraft{
  const merged={...after};
  for(const key of fields)if(JSON.stringify(draft[key])!==JSON.stringify(before[key]))Object.assign(merged,{[key]:draft[key]});
  return merged;
}
export function RoleEditor({role,onSaved,onCancel,onGenerated}:{role:RoleDraft;onSaved:(role:IpRole)=>void;onCancel?:()=>void;onGenerated?:(role:IpRole)=>void}){
  const [draft,setDraft]=useState<RoleDraft>(role),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  const current=useRef(draft),previous=useRef(role),requestPending=useRef(false);current.current=draft;
  useEffect(()=>{const before=previous.current;setDraft(d=>mergeRoleDraft(d,before,role));previous.current=role;},[role]);
  const update=(patch:Partial<RoleDraft>)=>{setMessage('');setDraft(d=>({...d,...patch}));};
  const running=draft.generation?.status==='queued'||draft.generation?.status==='running';
  const submit=async(generate:boolean)=>{
    if(requestPending.current)return;requestPending.current=true;setPending(true);setMessage('');const submitted={...current.current};
    try{
      const path=generate?'/profile/me/role-generation':submitted.id?`/profile/me/roles/${submitted.id}`:'/profile/me/roles';
      const result=await api<{role:IpRole}>(path,{method:generate||!submitted.id?'POST':'PUT',body:JSON.stringify(submitted)});
      setDraft(d=>mergeRoleDraft(d,submitted,result.role));previous.current=result.role;
      if(generate){setMessage('已保存，资料补全中。可以离开，也可以继续编辑。');onGenerated?.(result.role);}else{setMessage('角色已保存');onSaved(result.role);}
    }catch(error){setMessage(error instanceof Error?error.message:'保存失败，请重试');}
    finally{requestPending.current=false;setPending(false);}
  };
  useEffect(()=>{if(draft.generation&& !['queued','running'].includes(draft.generation.status))setMessage('');},[draft.generation?.status]);
  return <form className="settings-role-editor" aria-label="编辑角色" onSubmit={e=>{e.preventDefault();void submit(false);}}><fieldset disabled={pending}>
    <label>IP 主题<input required maxLength={80} value={draft.ipTheme} onChange={e=>update({ipTheme:e.target.value})} placeholder="如：罗小黑战记"/></label>
    <label>角色名<input required maxLength={50} value={draft.name} onChange={e=>update({name:e.target.value})} placeholder="如：无限"/></label>
    <button type="button" className="ai-generate-btn" disabled={pending||running||!draft.ipTheme.trim()||!draft.name.trim()} onClick={()=>void submit(true)}><span>{pending?'正在保存…':running?'资料补全中…':draft.generation?.status==='failed'?'重试 AI 补全':'AI 生成'}</span><span className="ai-hint">先保存角色，再查找资料自动补全</span></button>
    <p className="role-message" role="status">{message||draft.generation?.message||'只需填写 IP 和角色名，其余资料可稍后补全。'}</p>
    <details className="role-details"><summary>角色资料 <small>可选 · 随时修改</small></summary><div className="role-details-fields">
      <label>人设关键词<input value={draft.personaTags.join(' / ')} onChange={e=>update({personaTags:e.target.value.split(/[/、,]/).map(v=>v.trim()).filter(Boolean)})} placeholder="沉稳 / 温柔"/></label>
      <label>代表台词<input maxLength={100} value={draft.quote} onChange={e=>update({quote:e.target.value})}/></label>
      <label>标志动作<input maxLength={100} value={draft.signatureAction} onChange={e=>update({signatureAction:e.target.value})}/></label>
      <label>能力标签<input maxLength={100} value={draft.ability??''} onChange={e=>update({ability:e.target.value})}/></label>
      {Boolean(draft.generation?.sources?.length)&&<div className="role-sources"><span>资料来源</span>{draft.generation!.sources!.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>}
    </div></details>
    <button className="primary" disabled={pending||!draft.ipTheme.trim()||!draft.name.trim()}>{pending?'正在保存…':'保存角色'}</button>
    {onCancel&&<button type="button" className="text-btn" onClick={onCancel}>收起</button>}
  </fieldset></form>;
}
