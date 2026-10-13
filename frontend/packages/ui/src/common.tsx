"use client"
import React,{createContext,useContext,useState,useEffect,useRef,useId} from 'react'
import {AreaLink as Link} from '@/components/shared/area-routes'
import {toast} from 'sonner'
import type {AppState,User,Role,Order} from '@/lib/types'
import {ORDER_STATUS_LABEL,JOB_STATUS_LABEL,PAYMENT_STATUS_LABEL} from '@/lib/config'
export const Context=createContext<{s:AppState;user:User|null;role:Role}>({} as never)
export const useData=()=>useContext(Context)
export const money=(n:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n)
export const date=(s:string)=>new Date(s).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
export const day=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
export function act(r:unknown,message='Đã lưu thay đổi'){if(r && typeof r==='object' && 'ok' in r && !r.ok){toast.error(String(("error" in r ? r.error : "Không thể thực hiện thao tác.")));return false}toast.success(message);return true}
export function Btn({children,secondary=false,danger=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{secondary?:boolean;danger?:boolean}){return <button type="button" {...props} className={`ch-btn ${secondary?'secondary':''} ${danger?'danger':''} ${props.className||''}`}>{children}</button>}
export function Go({href,children}:{href:string;children:React.ReactNode}){return <Link className="ch-btn" href={href}>{children}</Link>}
export function Panel({children,title}:{children:React.ReactNode;title?:string}){return <section className="ch-panel">{title&&<h2>{title}</h2>}{children}</section>}
export function Heading({title,sub,action}:{title:string;sub?:string;action?:React.ReactNode}){return <div className="ch-heading"><div><div className="ch-eyebrow">CLEANHOME / DỊCH VỤ TẬN TÂM</div><h1>{title}</h1>{sub&&<p>{sub}</p>}</div>{action}</div>}
export function Field({label,children,hint,error}:{label:string;children:React.ReactNode;hint?:React.ReactNode;error?:string}){
  const generatedId=useId()
  const control=React.isValidElement(children)?children as React.ReactElement<{id?:string;'aria-describedby'?:string;'aria-invalid'?:React.AriaAttributes['aria-invalid']}>:null
  const id=control?.props.id||generatedId
  const describedBy=[control?.props['aria-describedby'],hint?`${id}-hint`:null,error?`${id}-error`:null].filter(Boolean).join(' ')||undefined
  return <div className={`ch-field${error?' has-error':''}`}><label htmlFor={id}>{label}</label>{control?React.cloneElement(control,{id,'aria-describedby':describedBy,...(error?{'aria-invalid':true as const}:{})}):children}{hint&&<small id={`${id}-hint`} className="ch-field-hint">{hint}</small>}{error&&<small id={`${id}-error`} className="ch-field-error" role="alert">{error}</small>}</div>
}
export function Badge({value}:{value:string}){const labels:Record<string,string>={...ORDER_STATUS_LABEL,...JOB_STATUS_LABEL,...PAYMENT_STATUS_LABEL,active:'Hoạt động',inactive:'Ngừng cung cấp',locked:'Đã khóa',waiting:'Chờ tiếp nhận',accepted:'Đã tiếp nhận'};return <span className={`ch-badge ${value}`}>{labels[value]||value}</span>}
export function Empty({text='Chưa có dữ liệu phù hợp.'}:{text?:string}){return <div className="ch-empty"><span>◇</span><h3>{text}</h3><p>Thử thay đổi bộ lọc hoặc quay lại sau.</p></div>}
export function Modal({title,children,close}:{title:string;children:React.ReactNode;close:()=>void}){const ref=useRef<HTMLDialogElement>(null);const titleId=useId();useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close()},[]);return <dialog ref={ref} className="ch-dialog" aria-labelledby={titleId} onCancel={close} onClick={e=>{if(e.target===e.currentTarget)close()}}><div className="ch-row"><h2 id={titleId}>{title}</h2><Btn secondary onClick={close} aria-label="Đóng">×</Btn></div>{children}</dialog>}
export function Table({headers,rows}:{headers:string[];rows:React.ReactNode[][]}){const [page,setPage]=useState(0);const pages=Math.ceil(rows.length/8);const current=Math.min(page,Math.max(0,pages-1));return <>{rows.length?<><div className="ch-table-wrap"><table className="ch-table"><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.slice(current*8,current*8+8).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div><div className="ch-row ch-pagination"><span>{rows.length} kết quả · Trang {current+1}/{pages}</span><div className="ch-actions"><Btn secondary disabled={current===0} onClick={()=>setPage(current-1)}>Trước</Btn><Btn secondary disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Sau</Btn></div></div></>:<Empty/>}</>}
export function OrderTable({orders}:{orders:Order[]}){const {s,role}=useData();return <Table headers={['Mã đơn / Dịch vụ','Khách hàng / Địa chỉ','Lịch thực hiện','Trạng thái','Thao tác']} rows={orders.map(o=>[<><strong>{o.code}</strong><small>{s.services.find(x=>x.id===o.serviceId)?.name}</small></>,<>{o.contact.name}<small>{o.contact.address}</small></>,<>{date(o.scheduledAt)}<small>{money(o.price)}</small></>,<><Badge value={o.status}/>{role==='staff'&&o.jobStatus&&<small><Badge value={o.jobStatus}/></small>}</>,<Link className="ch-link" href={`/don/${o.id}`}>Xem chi tiết →</Link>])}/>}
export function csv(name:string,headers:string[],rows:(string|number)[][]){const safe=(v:string|number)=>{let s=String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};const a=document.createElement('a');const url=URL.createObjectURL(new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
