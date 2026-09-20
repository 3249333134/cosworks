import { useId } from 'react';
import { AVATAR_COLORS, avatarBackground, avatarStyle, isAvatarColor } from './avatar-colors';
import './avatar.css';

export function AvatarColorPicker({label,name,value,onChange,disabled=false}:{label:string;name:string;value:string;onChange:(color:string)=>void;disabled?:boolean}) {
  const id=useId(),valid=isAvatarColor(value),preview=avatarBackground(value);
  return <div className="avatar-color-picker" role="group" aria-labelledby={`${id}-label`}>
    <div className="avatar-color-heading"><span id={`${id}-label`}>{label}</span><span className="avatar-color-preview" style={avatarStyle(preview)} aria-label={`${label}预览`}>{Array.from(name.trim())[0]||'角'}</span></div>
    <div className="avatar-presets">{AVATAR_COLORS.map(color=><button key={color.value} type="button" className="avatar-swatch" style={avatarStyle(color.value)} disabled={disabled} aria-label={`${label}：${color.name}`} aria-pressed={valid&&value.toUpperCase()===color.value} onClick={()=>onChange(color.value)}>{valid&&value.toUpperCase()===color.value?'✓':''}</button>)}</div>
    <div className="avatar-custom"><label>自定义<input type="color" value={preview} disabled={disabled} onChange={e=>onChange(e.target.value.toUpperCase())} aria-label={`${label}自定义`}/></label><label>颜色值<input type="text" value={value} required pattern="#[0-9a-fA-F]{6}" maxLength={7} disabled={disabled} spellCheck={false} autoComplete="off" aria-label={`${label}颜色值`} aria-invalid={!valid} aria-describedby={!valid?`${id}-error`:undefined} onChange={e=>onChange(e.target.value)} onBlur={()=>{if(valid)onChange(value.toUpperCase());}} placeholder="#RRGGBB"/></label></div>
    {!valid&&<small className="avatar-color-error" id={`${id}-error`}>请输入 # 加六位十六进制数字，例如 #55C4D5。</small>}
  </div>;
}
