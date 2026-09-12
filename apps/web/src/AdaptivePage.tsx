import { Children, Fragment, isValidElement, createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

const PageScope = createContext('page');
const expanded = new Map<string, boolean>();

/** One layout tree at every breakpoint: inputs, media and canvas never remount on resize. */
export function PageFrame({scope, className = '', children, ...props}: ComponentProps<'main'> & {scope?: string}) {
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{
    const viewport=window.visualViewport;
    const fit=()=>ref.current?.style.setProperty('--page-height',`${viewport?.height??window.innerHeight}px`);
    fit();viewport?.addEventListener('resize',fit);window.addEventListener('resize',fit);
    return()=>{viewport?.removeEventListener('resize',fit);window.removeEventListener('resize',fit);};
  },[]);
  return <PageScope.Provider value={scope ?? className}><main {...props} ref={ref} className={`adaptive-page ${className}`}>{children}</main></PageScope.Provider>;
}

// Keep actions outside the scrolling task body, including actions inside React fragments.
function flatten(nodes:ReactNode):ReactNode[]{return Children.toArray(nodes).flatMap(node=>isValidElement<{children?:ReactNode}>(node)&&node.type===Fragment?flatten(node.props.children):[node]);}
export function TaskPanel({children,className='',...props}:ComponentProps<'div'>){
  const actions:ReactNode[]=[],body:ReactNode[]=[];
  for(const node of flatten(children)){
    if(isValidElement<{className?:string}>(node)&&((node.props.className??'').split(' ').includes('primary')||typeof node.type==='function'&&node.type.name==='Primary'))actions.push(node);
    else body.push(node);
  }
  return <div {...props} className={`task-panel ${className}`}><div className="task-scroll" tabIndex={0}>{body}</div>{actions.length>0&&<div className="task-actions">{actions}</div>}</div>;
}

export function SummaryPanel({id, title, status, defaultOpen = false, children}: {id:string; title:ReactNode; status?:ReactNode; defaultOpen?:boolean; children:ReactNode}) {
  const scope = useContext(PageScope), key = `${scope}:${id}`, contentId = useId();
  const [open, setOpen] = useState(() => expanded.get(key) ?? (matchMedia("(min-width:1024px) and (min-height:601px)").matches && defaultOpen));
  const ref = useRef<HTMLDetailsElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const media=matchMedia('(max-width:1023px), (max-height:600px)');
    const sync=()=>{const el=dialog.current;if(!el)return;el.close();if(open){if(media.matches)el.showModal();else el.show();}};
    sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);
  },[open]);
  useEffect(() => { setOpen(expanded.get(key) ?? (matchMedia("(min-width:1024px) and (min-height:601px)").matches && defaultOpen)); }, [key, defaultOpen]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reveal = () => { setOpen(true); expanded.set(key, true); };
    const check = () => { if (node.querySelector('[role="alert"], [aria-invalid="true"]')) reveal(); };
    const observer = new MutationObserver(check);
    observer.observe(node, {childList:true, subtree:true, attributes:true, attributeFilter:['aria-invalid']});
    node.addEventListener('invalid', reveal, true); check();
    return () => { observer.disconnect(); node.removeEventListener('invalid', reveal, true); };
  }, [key]);
  return <details ref={ref} className="summary-panel" open={open} onToggle={event => {
    const value = event.currentTarget.open; setOpen(value); expanded.set(key, value);
  }}><summary aria-controls={contentId} aria-expanded={open}><span><strong>{title}</strong>{status != null && <small>{status}</small>}</span><span className="summary-chevron" aria-hidden="true">⌄</span></summary><dialog ref={dialog} id={contentId} className="summary-content" aria-label={typeof title==='string'?title:'详情'} onCancel={e=>{e.preventDefault();expanded.set(key,false);setOpen(false);}}><header className="summary-dialog-header"><strong>{title}</strong><button type="button" aria-label="关闭详情" onClick={()=>{expanded.set(key,false);setOpen(false);}}>×</button></header><div className="summary-scroll">{children}</div></dialog></details>;
}

export function DetailDialog({title, onClose, children}: {title:string;onClose:()=>void;children:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!, previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    document.documentElement.classList.add('dialog-open');
    return () => {
      dialog.close();
      if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('dialog-open');
      if (previous?.isConnected) previous.focus({preventScroll:true});
    };
  }, []);
  return <dialog ref={ref} className="adaptive-dialog" aria-label={title} onCancel={e => {e.preventDefault();close.current();}} onClick={e => {if(e.target===e.currentTarget)close.current();}}><section className="sheet"><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="关闭">×</button></header><div className="dialog-content">{children}</div></section></dialog>;
}

export function ExpandableImage({src, alt, ...props}:ComponentProps<'img'>) {
  const [open,setOpen] = useState(false);
  return <><button className="image-expand" type="button" onClick={()=>setOpen(true)} aria-label={`查看大图：${alt ?? '图片'}`}><img {...props} src={src} alt={alt}/></button>{open&&<DetailDialog title={alt??'图片'} onClose={()=>setOpen(false)}><img className="expanded-image" src={src} alt={alt}/></DetailDialog>}</>;
}
