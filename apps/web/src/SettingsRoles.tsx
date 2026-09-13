import { useMemo, useState } from 'react';
import type { IpRole } from '@ruxiju/shared';
import { api } from './api';
import { RoleEditor, type RoleDraft } from './RoleEditor';
import './settings-roles.css';

export function SettingsRoles({roles,onChange}:{roles:IpRole[];onChange:(roles:IpRole[])=>void}){
  const [expanded,setExpanded]=useState<string|null>(null),[pending,setPending]=useState<string|null>(null),[notice,setNotice]=useState('');
  const empty=useMemo<RoleDraft>(()=>({ipTheme:roles[0]?.ipTheme??'罗小黑战记',name:'',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true}),[roles[0]?.ipTheme]);
  const upsert=(role:IpRole)=>onChange([...roles.filter(r=>r.id!==role.id).map(r=>role.isDefault&&r.ipTheme===role.ipTheme?{...r,isDefault:false}:r),role]);
  const saved=(role:IpRole)=>{upsert(role);setExpanded(null);};
  const generated=(role:IpRole)=>{upsert(role);setExpanded(role.id);};
  const remove=async(id:string)=>{setPending(id);setNotice('');try{await api(`/profile/me/roles/${id}`,{method:'DELETE'});onChange(roles.filter(r=>r.id!==id));if(expanded===id)setExpanded(null);}catch(e){setNotice(e instanceof Error?e.message:'删除失败，请重试');}finally{setPending(null);}};
  return <section className="settings-section settings-roles">
    <div className="section-heading"><h2 className="section-label">IP 与角色</h2><button className="text-btn role-add" aria-expanded={expanded==='new'} onClick={()=>setExpanded(expanded==='new'?null:'new')}>{expanded==='new'?'收起新建':'添加角色'}</button></div>
    {expanded==='new'&&<RoleEditor key="new" role={empty} onSaved={saved} onGenerated={generated} onCancel={()=>setExpanded(null)}/>}
    <ul className="settings-role-list">{roles.map(role=><li key={role.id} className={`settings-role-card ${expanded===role.id?'is-expanded':''}`}>
      <div className="settings-role-heading"><button className="settings-role-toggle" aria-expanded={expanded===role.id} onClick={()=>setExpanded(expanded===role.id?null:role.id)}><span className="role-glyph">{role.name[0]}</span><span className="settings-role-summary"><strong>{role.name}</strong><span className="settings-role-meta">{role.ipTheme}{role.isDefault&&<span className="settings-role-default">默认</span>}</span></span></button><button className="role-delete" disabled={pending!==null} onClick={()=>void remove(role.id)}>删除</button></div>
      {expanded===role.id?<RoleEditor role={role} onSaved={saved} onGenerated={generated} onCancel={()=>setExpanded(null)}/>:role.generation&&<p className="role-message" role="status">{role.generation.message}</p>}
    </li>)}</ul>
    {!roles.length&&expanded!=='new'&&<p className="role-empty">还没有保存角色。</p>}{notice&&<p role="alert">{notice}</p>}
  </section>;
}
