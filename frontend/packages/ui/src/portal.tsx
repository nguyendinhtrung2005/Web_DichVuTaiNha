"use client"
import {useEffect,useRef,useState} from 'react'
import {toast} from 'sonner'
import Link from 'next/link'
import {useRouter,useSearchParams} from 'next/navigation'
import {Sparkles} from 'lucide-react'
import {actions,executeStoreCommand,useAppState,useCurrentUser,useDataStatus} from '@/lib/store'
import {IS_UNIFIED_APP} from '@/lib/env'
import {AreaRoutesProvider,areaHref} from '@/components/shared/area-routes'
import {AREA_HOME,safeReturnTo,validAreaPath} from '@/components/shared/route-policy'
import {DataSetupGate} from '@/components/shared/data-setup'
import {DEMO_CREDENTIALS,HOME_PATH} from '@/lib/auth'
import type {Role} from '@/lib/types'
import {Context,Heading,Panel,Field,Btn,Go,Empty,act} from './common'
import {Home,Services,Booking} from './customer'
import {CustomerOrders} from '@/components/customer/customer-orders'
import {CustomerOrderDetail} from '@/components/customer/customer-order-detail'
import {CustomerProfile} from '@/components/customer/customer-profile'
import {CustomerAuth} from '@/components/customer/customer-auth'
import {Profile} from './manage'
import {SiteHeader} from "@/components/customer/site-header"
import {SiteFooter} from "@/components/customer/site-footer"
import {PageSkeleton} from "@/components/shared/role-guard"
import {StaffLayout} from '@/components/staff/staff-layout'
import {StaffLogin} from '@/components/staff/staff-login'
import {StaffDashboard} from '@/components/staff/staff-dashboard'
import {StaffJobs} from '@/components/staff/staff-jobs'
import {StaffCalendar} from '@/components/staff/staff-calendar'
import {StaffJobDetail} from '@/components/staff/staff-job-detail'
import {StaffProfile} from '@/components/staff/staff-profile'
import {StaffEmpty,StaffLoading} from '@/components/staff/staff-shared'
import {AdminLayout} from '@/components/admin/admin-layout'
import {AdminDashboard} from '@/components/admin/admin-dashboard'
import {AdminOrders} from '@/components/admin/admin-orders'
import {AdminOrderDetail} from '@/components/admin/admin-order-detail'
import {AdminAssignment} from '@/components/admin/admin-assignment'
import {AdminCalendar} from '@/components/admin/admin-calendar'
import {AdminAccounts} from '@/components/admin/admin-accounts'
import {AdminServices} from '@/components/admin/admin-services'
import {AdminPayments} from '@/components/admin/admin-payments'
import {AdminReviews} from '@/components/admin/admin-reviews'
import {AdminReports} from '@/components/admin/admin-reports'
import {AdminEmpty,AdminLoading,AdminPageHeader} from '@/components/admin/admin-shared'
import {Button} from '@/components/ui/button'
const titles={customer:'Khách hàng',staff:'Nhân viên',admin:'Quản trị viên'}
export function Portal({role,path}:{role:Role;path:string[]}) {
  return <AreaRoutesProvider role={role}><PortalScreen role={role} path={path}/></AreaRoutesProvider>
}
function PortalScreen({role,path}:{role:Role;path:string[]}){const s=useAppState(),user=useCurrentUser(),dataStatus=useDataStatus();const router=useRouter();const loggingOut=useRef(false);const route=path[0]||'';
const logout=async()=>{if(loggingOut.current)return;loggingOut.current=true;try{const result=await executeStoreCommand(()=>actions.logout());if(result&&result.ok===false){toast.error(result.error);return}router.replace('/dang-nhap')}finally{loggingOut.current=false}};
if(IS_UNIFIED_APP&&dataStatus.status!=='loading'&&dataStatus.status!=='ready')return <DataSetupGate/>;
if(!s)return role==='customer'?<CustomerLayout route={route} user={null} onLogout={logout}><div className="ch-container" role="status" aria-label="Đang tải CleanHome"><PageSkeleton/></div></CustomerLayout>:role==='staff'?<StaffLayout route={route} user={null} onLogout={logout}><StaffLoading/></StaffLayout>:<AdminLayout route={route} user={null} onLogout={logout}><AdminLoading/></AdminLayout>;
const auth=route==='dang-nhap'||route==='dang-ky';const allowed=user?.role===role;const publicPage=role==='customer'&&['','dich-vu'].includes(route);const needsLogin=!auth&&!publicPage&&!allowed;
let content:React.ReactNode;
if(!validAreaPath(role,path))content=<><Empty text="Trang không tồn tại."/><Go href="/">Về trang chính</Go></>;
else if(IS_UNIFIED_APP&&auth&&role!=='customer')content=<AccessRedirect href={(route==='dang-ky'?'/dang-ky':'/dang-nhap')}/>;
else if(auth)content=IS_UNIFIED_APP?<Auth role="customer" register={route==='dang-ky'}/>:role==='staff'?(route==='dang-ky'?<StaffEmpty title="Tài khoản nhân viên được người quản lý cấp" description="Liên hệ người quản lý để được cấp tài khoản làm việc." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/>:<StaffLogin/>):<Auth role={role} register={route==='dang-ky'}/>;
else if(needsLogin)content=IS_UNIFIED_APP?user?<section className="mx-auto w-full max-w-xl p-5 py-12"><Heading title="Bạn không có quyền truy cập" sub="Vui lòng trở về khu vực dành cho tài khoản của bạn."/><Button render={<Link href={AREA_HOME[user.role]}/>} nativeButton={false}>Về khu vực của tôi</Button></section>:<AccessRedirect href={'/dang-nhap?next='+encodeURIComponent(areaHref(role,'/'+path.join('/'),true))}/>:role==='staff'?<StaffEmpty title="Đăng nhập để tiếp tục" description="Sử dụng tài khoản nhân viên để xem công việc được phân công." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/>:role==='admin'?<><AdminPageHeader title="Đăng nhập để tiếp tục"/><AdminEmpty title="Khu vực dành cho quản trị viên" description="Sử dụng tài khoản quản trị viên đang hoạt động để quản lý dịch vụ." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/></>:<><Heading title="Đăng nhập để tiếp tục" sub={`Khu vực dành cho ${titles[role].toLowerCase()}.`}/><Go href={role==='customer'&&route==='dat-dich-vu'&&path[1]?`/dang-nhap?next=${encodeURIComponent(`/dat-dich-vu/${path[1]}`)}`:'/dang-nhap'}>Đăng nhập</Go></>;
else if(!route)content=role==='customer'?<Home/>:role==='staff'?<StaffDashboard/>:<AdminDashboard/>;
else if(route==='ho-so')content=role==='customer'?<CustomerProfile/>:role==='staff'?<StaffProfile/>:<Profile/>;
else if(route==='dich-vu')content=role==='customer'?<Services slug={path[1]}/>:role==='admin'?<AdminServices/>:<Empty text="Trang không tồn tại."/>;
else if(route==='dat-dich-vu'&&role==='customer')content=<Booking id={path[1]}/>;
else if(route==='don'&&path[1])content=role==='customer'?<CustomerOrderDetail id={path[1]}/>:role==='staff'?<StaffJobDetail id={path[1]}/>:<AdminOrderDetail id={path[1]}/>;
else if(role==='staff'&&route==='cong-viec')content=<StaffJobs/>;
else if(role==='customer'&&route==='don-cua-toi')content=<CustomerOrders/>;
else if(role==='customer'&&route==='lich-su')content=<CustomerOrders history/>;
else if(role==='admin'&&route==='don-dich-vu')content=<AdminOrders/>;
else if(role==='admin'&&route==='phan-cong')content=<AdminAssignment/>;
else if(route==='lich-lam-viec'&&role!=='customer')content=role==='staff'?<StaffCalendar/>:<AdminCalendar/>;
else if(role==='admin'&&route==='tai-khoan')content=<AdminAccounts/>;
else if(role==='admin'&&route==='thanh-toan')content=<AdminPayments/>;
else if(role==='admin'&&route==='danh-gia')content=<AdminReviews/>;
else if(role==='admin'&&route==='bao-cao')content=<AdminReports/>;
else content=<><Empty text="Trang không tồn tại."/><Go href="/">Về trang chính</Go></>;
return (
  <Context.Provider value={{s,user,role}}>
    {role!=='customer'&&(dataStatus.error||dataStatus.sessionError)&&<div role="alert" className="relative z-50 flex flex-wrap items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><span>{dataStatus.error||dataStatus.sessionError}</span>{dataStatus.dirty&&<Link href="/du-lieu" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{IS_UNIFIED_APP?'Sao lưu dữ liệu':'Sao lưu dữ liệu gốc'}</Link>}</div>}
    {role==='customer'?(
      <CustomerLayout route={route} user={IS_UNIFIED_APP?user:allowed?user:null} onLogout={logout}>
        <div className={route&&route!=='dich-vu'&&!auth&&!(allowed&&['dat-dich-vu','don-cua-toi','don','lich-su','ho-so'].includes(route))?'ch-container':''} key={role+'/'+path.join('/')+'/'+(user?.id||'guest')}>{content}</div>
      </CustomerLayout>
    ):role==='staff'?(
      <StaffLayout route={route} user={allowed?user:null} onLogout={logout}><div key={role+'/'+path.join('/')+'/'+(user?.id||'guest')}>{content}</div></StaffLayout>
    ):(
      <AdminLayout route={route} user={allowed?user:null} onLogout={logout}><div className={auth||(allowed&&!['','don-dich-vu','don','phan-cong','lich-lam-viec','tai-khoan','dich-vu','thanh-toan','danh-gia','bao-cao'].includes(route))?'admin-legacy ch-app':''} key={role+'/'+path.join('/')+'/'+(user?.id||'guest')}>{content}</div></AdminLayout>
    )}
  </Context.Provider>
)}
function CustomerLayout({route,user,onLogout,children}:{route:string;user:ReturnType<typeof useCurrentUser>;onLogout:()=>void;children:React.ReactNode}){
  return <div className="ch-app customer min-h-screen bg-white"><SiteHeader route={route} user={user} onLogout={onLogout}/><main id="noi-dung-chinh" tabIndex={-1} className="min-h-[50vh] outline-none">{children}</main><SiteFooter/></div>
}
function AccessRedirect({href}:{href:string}) {
  const router=useRouter()
  useEffect(()=>{router.replace(href)},[href,router])
  return <div className="mx-auto w-full max-w-4xl px-4 py-8" role="status" aria-label="Đang chuyển trang"><PageSkeleton/></div>
}
function Auth({role,register}:{role:Role;register:boolean}){
  const params=useSearchParams()
  const user=useCurrentUser()
  const requested=params.get('next')||''
  if(IS_UNIFIED_APP&&user)return <AccessRedirect href={safeReturnTo(user.role,requested)}/>
  const returnTo=IS_UNIFIED_APP?requested:role==='customer'&&/^\/dat-dich-vu\/[A-Za-z0-9_-]+$/.test(requested)?requested:HOME_PATH[role]
  if(role==='customer')return <CustomerAuth register={register} returnTo={returnTo} switchHref={(register?'/dang-nhap':'/dang-ky')+(returnTo&&returnTo!==HOME_PATH[role]?'?next='+encodeURIComponent(returnTo):'')}/>
  return <InternalAuth role={role} register={register}/>
}
function InternalAuth({role,register}:{role:Role;register:boolean}){const router=useRouter();const params=useSearchParams();const requested=params.get('next')||'';const returnTo=role==='customer'&&/^\/dat-dich-vu\/[A-Za-z0-9_-]+$/.test(requested)?requested:HOME_PATH[role];const demo=DEMO_CREDENTIALS.find(x=>x.role===role)!;const [v,V]=useState({email:'',password:'',name:'',phone:'',confirm:''});const [err,E]=useState('');if(register&&role!=='customer')return <Empty text="Tài khoản được quản trị viên cấp, không đăng ký công khai."/>;return <div className="ch-auth"><div className="ch-auth-art"><Sparkles size={40}/><h1>Nhà sạch hơn.<br/>Cuộc sống nhẹ nhàng hơn.</h1><p>{titles[role]} · CleanHome</p><img src="/images/hero.png" alt="Dịch vụ vệ sinh CleanHome"/></div><Panel title={register?'Tạo tài khoản khách hàng':`Đăng nhập ${titles[role].toLowerCase()}`}><p>Chào mừng bạn đến với CleanHome.</p><form className="ch-form" onSubmit={e=>{e.preventDefault();E('');if(register&&v.password!==v.confirm){E('Mật khẩu xác nhận không khớp.');return}const result=register?actions.register(v):actions.login(v.email,v.password);if(!result.ok){E(result.error);return}act(result,register?'Đăng ký thành công':'Đăng nhập thành công');router.push(returnTo)}}>{register&&<><Field label="Họ và tên"><input required value={v.name} onChange={e=>V({...v,name:e.target.value})}/></Field><Field label="Số điện thoại"><input required pattern="[0-9+ ()-]{9,15}" value={v.phone} onChange={e=>V({...v,phone:e.target.value})}/></Field></>}<Field label="Email"><input type="email" required autoComplete="email" value={v.email} onChange={e=>V({...v,email:e.target.value})}/></Field><Field label="Mật khẩu"><input type="password" minLength={register?8:1} required autoComplete={register?'new-password':'current-password'} value={v.password} onChange={e=>V({...v,password:e.target.value})}/></Field>{register&&<Field label="Nhập lại mật khẩu"><input type="password" required autoComplete="new-password" value={v.confirm} onChange={e=>V({...v,confirm:e.target.value})}/></Field>}{err&&<p role="alert" className="ch-error">{err}</p>}<Btn type="submit">{register?'Đăng ký':'Đăng nhập'} →</Btn>{role==='customer'&&<Link className="ch-link" href={(register?'/dang-nhap':'/dang-ky')+(returnTo!==HOME_PATH[role]?`?next=${encodeURIComponent(returnTo)}`:'')}>{register?'Đã có tài khoản? Đăng nhập':'Chưa có tài khoản? Đăng ký'}</Link>}</form>{role!=='customer'&&<><details className="ch-demo-help"><summary>Tài khoản trải nghiệm</summary><p>{demo.email}</p><p>Mật khẩu: <code>{demo.password}</code></p><Btn secondary onClick={()=>V({...v,email:demo.email,password:demo.password})}>Điền tài khoản demo</Btn></details><small>Đăng nhập mô phỏng, không dùng mật khẩu thật. Vai trò khác cần mở website tương ứng.</small></>}</Panel></div>}
