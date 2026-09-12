import { useRef, useState } from 'react';
import type { IpRole } from '@ruxiju/shared';
import { api } from './api';
import './settings-roles.css';

type Draft = Omit<IpRole, 'id'> & { id?: string };
const NEW_ROLE = 'new';
const emptyDraft = (ipTheme = '罗小黑战记'): Draft => ({ ipTheme, name: '', personaTags: [], quote: '', signatureAction: '', ability: '', isDefault: true });
const failureMessage = (action: string, error: unknown) => error instanceof TypeError ? `${action}失败，请检查网络后重试。` : error instanceof Error ? `${action}失败：${error.message}` : `${action}失败，请重试。`;

export function SettingsRoles({ roles, onChange }: { roles: IpRole[]; onChange: (roles: IpRole[]) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const requests = useRef<Record<string, symbol>>({});
  const mutation = useRef(false);
  const message = (key: string, text: string) => setMessages(current => ({ ...current, [key]: text }));
  const toggle = (key: string) => {
    setDrafts(current => current[key] ? current : { ...current, [key]: key === NEW_ROLE ? emptyDraft(roles[0]?.ipTheme) : { ...roles.find(role => role.id === key)! } });
    setExpanded(current => current === key ? null : key);
  };
  const update = (key: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [key]: { ...current[key], ...patch } }));
  const clearDraft = (key: string) => {
    delete requests.current[key];
    setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
    setGenerating(current => { const next = { ...current }; delete next[key]; return next; });
    message(key, '');
    setExpanded(current => current === key ? null : current);
  };
  const save = async (key: string) => {
    if (mutation.current) return;
    mutation.current = true;
    setPending(key);
    message(key, '');
    const draft = { ...drafts[key], personaTags: drafts[key].personaTags.filter(Boolean) };
    try {
      const { role } = await api<{ role: IpRole }>(draft.id ? `/profile/me/roles/${draft.id}` : '/profile/me/roles', { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      const next = draft.id ? roles.map(item => item.id === role.id ? role : item) : [...roles, role];
      onChange(next.map(item => role.isDefault && item.id !== role.id && item.ipTheme === role.ipTheme ? { ...item, isDefault: false } : item));
      clearDraft(key);
    } catch (error) { message(key, failureMessage('保存', error)); }
    finally { mutation.current = false; setPending(null); }
  };
  const remove = async (key: string) => {
    if (mutation.current) return;
    mutation.current = true;
    setPending(key);
    message(key, '');
    try {
      await api(`/profile/me/roles/${key}`, { method: 'DELETE' });
      onChange(roles.filter(role => role.id !== key));
      clearDraft(key);
    } catch (error) { message(key, failureMessage('删除', error)); }
    finally { mutation.current = false; setPending(null); }
  };
  const generate = async (key: string) => {
    if (requests.current[key]) return;
    const request = Symbol();
    requests.current[key] = request;
    const draft = drafts[key];
    setGenerating(current => ({ ...current, [key]: true }));
    message(key, '正在搜索角色资料…');
    try {
      const data = await api<{ found: boolean; partial: boolean; quote: string; signatureAction: string; ability: string; tags?: string[] }>('/roles/generate', { method: 'POST', body: JSON.stringify({ ipTheme: draft.ipTheme, name: draft.name, personaTags: draft.personaTags.filter(Boolean) }) });
      if (requests.current[key] !== request) return;
      if (data.found) {
        setDrafts(current => {
          const target = current[key];
          if (!target) return current;
          return { ...current, [key]: { ...target, quote: data.quote || target.quote, signatureAction: data.signatureAction || target.signatureAction, ability: data.ability || target.ability, personaTags: data.tags?.length ? data.tags : target.personaTags } };
        });
      }
      message(key, data.found ? data.partial ? '部分资料已填入，其余内容可手动补充。' : '已填入角色资料，保存后生效。' : '未搜到资料，请手动填写。');
    } catch { if (requests.current[key] === request) message(key, 'AI 服务暂时不可用，请重试或手动填写。'); }
    finally {
      if (requests.current[key] === request) {
        delete requests.current[key];
        setGenerating(current => ({ ...current, [key]: false }));
      }
    }
  };
  const editor = (key: string) => {
    const draft = drafts[key];
    const locked = pending === key || generating[key];
    return <form className="settings-role-editor" id={`role-panel-${key}`} aria-label={key === NEW_ROLE ? '新建角色' : `编辑${roles.find(role => role.id === key)?.name}`} onSubmit={event => { event.preventDefault(); void save(key); }}>
      <fieldset disabled={locked}>
        <label>IP 主题<input value={draft.ipTheme} onChange={event => update(key, { ipTheme: event.target.value })} /></label>
        <label>角色名<input required value={draft.name} onChange={event => update(key, { name: event.target.value })} /></label>
        <label>人设关键词<input value={draft.personaTags.join(' / ')} onChange={event => update(key, { personaTags: event.target.value.split(/[/、,]/).map(value => value.trim()) })} placeholder="沉稳 / 温柔" /></label>
        <button type="button" className="ai-generate-btn" disabled={!draft.name.trim()} onClick={() => void generate(key)}><span>{generating[key] ? '正在生成…' : '✨ AI 生成'}</span><span className="ai-hint">台词 · 动作 · 能力</span></button>
        <label>代表台词<input value={draft.quote} onChange={event => update(key, { quote: event.target.value })} /></label>
        <label>标志动作<input value={draft.signatureAction} onChange={event => update(key, { signatureAction: event.target.value })} /></label>
        <label>能力标签<input value={draft.ability ?? ''} onChange={event => update(key, { ability: event.target.value })} /></label>
        <button className="primary" disabled={Boolean(pending) || !draft.name.trim()}>{pending === key ? '正在保存…' : '保存角色'}</button>
      </fieldset>
    </form>;
  };
  return <section className="settings-section settings-roles">
    <div className="section-heading"><h2 className="section-label">IP 与角色</h2><button className="text-btn role-add" aria-expanded={expanded === NEW_ROLE} aria-controls={`role-panel-${NEW_ROLE}`} onClick={() => toggle(NEW_ROLE)}>{expanded === NEW_ROLE ? '收起新建' : '添加角色'}</button></div>
    {expanded === NEW_ROLE && <div className="settings-role-new">{editor(NEW_ROLE)}{messages[NEW_ROLE] && <p className="role-message" role="status">{messages[NEW_ROLE]}</p>}</div>}
    {roles.length ? <ul className="settings-role-list">{roles.map(role => <li key={role.id} className={`settings-role-card${expanded === role.id ? ' is-expanded' : ''}`}>
      <div className="settings-role-heading">
        <button className="settings-role-toggle" aria-label={role.name} aria-expanded={expanded === role.id} aria-controls={`role-panel-${role.id}`} onClick={() => toggle(role.id)}>
          <span className="role-glyph" aria-hidden="true">{role.name[0]}</span><span className="settings-role-summary"><strong>{role.name}</strong><span className="settings-role-meta"><span className="role-ip">{role.ipTheme}</span>{role.ability && <span>{role.ability}</span>}{role.isDefault && <span className="settings-role-default">默认</span>}</span></span>
          <svg className="role-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <button type="button" className="role-delete" disabled={Boolean(pending)} aria-label={`删除${role.name}`} onClick={() => void remove(role.id)}>删除</button>
      </div>
      {expanded === role.id && editor(role.id)}
      {messages[role.id] && <p className="role-message" role="status">{messages[role.id]}</p>}
    </li>)}</ul> : <p className="role-empty">还没有保存角色。</p>}
  </section>;
}
