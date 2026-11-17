"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useStaffSupportWidget } from "./staff-support-widget-context"
import { staffSupportSuggestions } from "./staff-support-search"
import { STAFF_USAGE_HELP } from "./staff-support-questions.mjs"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Card, CardContent } from "@/components/ui/card"
export { STAFF_USAGE_HELP } from "./staff-support-questions.mjs"
export function StaffSupportKnowledge({ accountScope = "", chatEnabled = false, checkSession }: { accountScope?: string; chatEnabled?: boolean; checkSession?: () => unknown }) {
 const [search,setSearch]=useState(''), items=search.trim()?staffSupportSuggestions(search,6):STAFF_USAGE_HELP, widget=useStaffSupportWidget()
 return <section className="staff-support-knowledge" aria-labelledby="staff-usage-heading"><Card><CardContent><h2 id="staff-usage-heading">Trợ giúp sử dụng website</h2><p>Hướng dẫn thao tác trên CleanHome Staff.</p><label htmlFor="staff-help-search">Tìm hướng dẫn</label><input id="staff-help-search" type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Công việc, lịch, thu nhập..." /><p role="status">{items.length} hướng dẫn phù hợp</p><div>{items.map(item=><details key={item.id}><summary>{item.question}</summary><p>{item.answer}</p><Link href={item.href}>{item.label}</Link></details>)}</div>{!items.length&&<p>Chưa tìm thấy hướng dẫn phù hợp. Thử từ khóa khác.</p>}</CardContent></Card><Card><CardContent><h2>Liên hệ & trợ lý hỗ trợ</h2><p>Kênh liên hệ chính thức chưa được cung cấp. Hãy liên hệ người quản lý khi cần hỗ trợ trực tiếp.</p><p>Hỏi trợ lý về công việc, lịch, tiền công và tài khoản.</p><Button variant="outline" disabled={!widget} data-staff-chat-open onClick={()=>widget?.openChat()}>Mở Trợ lý CleanHome</Button><p>Trợ lý chỉ hướng dẫn, không thay đổi công việc hoặc dữ liệu tài khoản.</p></CardContent></Card></section>
}
