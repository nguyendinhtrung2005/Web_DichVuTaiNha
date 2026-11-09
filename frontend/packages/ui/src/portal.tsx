"use client"
import {useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react'
import {toast} from 'sonner'
import Link from 'next/link'
import {useRouter,useSearchParams} from 'next/navigation'
import {Sparkles} from 'lucide-react'
import {actions,executeStoreCommand,useAppState,useCurrentUser,useDataStatus} from '@/lib/store'
import {CUSTOMER_API_ENABLED,IS_UNIFIED_APP,PORTAL_API_ENABLED} from '@/lib/env'
import {logoutCustomer,refreshCustomerData} from '@/lib/customer-api-store'
import {logoutPortal,portalAuthServerSnapshot,portalAuthSnapshot,refreshPortalSession,subscribePortalAuth} from '@/lib/portal-auth'
import {loginPortal} from '@/lib/portal-auth'
import {setProductCustomer} from '@/lib/product-commerce'
import {clearBookingDrafts,selectBookingDraftCustomer} from '@/components/customer/booking-draft'
import {AreaRoutesProvider,areaHref} from '@/components/shared/area-routes'
import {AREA_HOME,safeReturnTo,validAreaPath} from '@/components/shared/route-policy'
import {DataSetupGate} from '@/components/shared/data-setup'
import {HOME_PATH} from '@/lib/auth'
import type {Role} from '@/lib/types'
import {Context,Heading,Panel,Field,Btn,Go,Empty,act} from './common'
import {Home,Services,Booking} from './customer'
import {CustomerOrders} from '@/components/customer/customer-orders'
import {CustomerOrderDetail} from '@/components/customer/customer-order-detail'
import {Products,ProductCartPage,ProductCheckoutPage,ProductOrdersPage} from '@/components/customer/product-pages'
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
function PortalScreen({role,path}:{role:Role;path:string[]}){const s=useAppState(),localUser=useCurrentUser(),dataStatus=useDataStatus();const portalAuth=useSyncExternalStore(subscribePortalAuth,portalAuthSnapshot,portalAuthServerSnapshot);const user=role==='customer'||!PORTAL_API_ENABLED?localUser:portalAuth.user;const router=useRouter();const loggingOut=useRef(false);const route=path[0]||'';
const pathKey=path.join('/');
const search=useSearchParams().toString();
const customerReturnPath='/'+pathKey+(search?'?'+search:'');
useEffect(()=>{if(role==='customer'&&CUSTOMER_API_ENABLED)void refreshCustomerData()},[role,pathKey]);
useEffect(()=>{if(role!=='customer'&&PORTAL_API_ENABLED)void refreshPortalSession(role)},[role]);
useEffect(()=>{if(role==='customer'&&CUSTOMER_API_ENABLED)setProductCustomer(user?.id??null)},[role,user?.id]);
useEffect(()=>{if(role==='customer'&&CUSTOMER_API_ENABLED)selectBookingDraftCustomer(user?.id??null)},[role,user?.id]);
const logout=async()=>{if(loggingOut.current)return;loggingOut.current=true;try{if(role!=='customer'&&PORTAL_API_ENABLED)await logoutPortal();else {const result=role==='customer'&&CUSTOMER_API_ENABLED?await logoutCustomer():await executeStoreCommand(()=>actions.logout());if(result&&result.ok===false){toast.error(result.error);return}}if(role==='customer')clearBookingDrafts();router.replace('/dang-nhap')}catch(error){toast.error(error instanceof Error?error.message:'Chưa thể đăng xuất. Vui lòng thử lại.')}finally{loggingOut.current=false}};
if(role!=='customer'&&PORTAL_API_ENABLED&&portalAuth.status==='loading')return role==='staff'?<StaffLayout route={route} user={null} onLogout={logout}><StaffLoading/></StaffLayout>:<AdminLayout route={route} user={null} onLogout={logout}><AdminLoading/></AdminLayout>;
if(role!=='customer'&&PORTAL_API_ENABLED&&portalAuth.status==='unavailable')return role==='staff'?<StaffLayout route={route} user={null} onLogout={logout}><StaffEmpty title="Chưa thể xác minh phiên nhân viên" description={portalAuth.error} action={<Button onClick={()=>void refreshPortalSession(role)}>Thử lại</Button>}/></StaffLayout>:<AdminLayout route={route} user={null} onLogout={logout}><AdminEmpty title="Chưa thể xác minh phiên quản trị" description={portalAuth.error} action={<Button onClick={()=>void refreshPortalSession(role)}>Thử lại</Button>}/></AdminLayout>;
if(role==='customer'&&CUSTOMER_API_ENABLED&&!s&&dataStatus.status==='unavailable')return <CustomerLayout route={route} user={null} onLogout={logout}><section className="mx-auto max-w-4xl px-4 py-16" role="alert"><h1 className="text-2xl font-semibold">Chưa thể tải dữ liệu Customer</h1><p className="my-5 text-sm leading-7">{dataStatus.error}</p><Button onClick={()=>void refreshCustomerData(true)}>Thử lại</Button></section></CustomerLayout>;
if(IS_UNIFIED_APP&&dataStatus.status!=='loading'&&dataStatus.status!=='ready')return <DataSetupGate/>;
if(!s)return role==='customer'?<CustomerLayout route={route} user={null} onLogout={logout}><div className="ch-container" role="status" aria-label="Đang tải CleanHome"><PageSkeleton/></div></CustomerLayout>:role==='staff'?<StaffLayout route={route} user={null} onLogout={logout}><StaffLoading/></StaffLayout>:<AdminLayout route={route} user={null} onLogout={logout}><AdminLoading/></AdminLayout>;
const auth=route==='dang-nhap'||route==='dang-ky';const allowed=user?.role===role;const publicPage=role==='customer'&&['','dich-vu','san-pham','gio-hang'].includes(route);const needsLogin=!auth&&!publicPage&&!allowed;
let content:React.ReactNode;
if(!validAreaPath(role,path))content=<><Empty text="Trang không tồn tại."/><Go href="/">Về trang chính</Go></>;
else if(IS_UNIFIED_APP&&auth&&role!=='customer')content=<AccessRedirect href={(route==='dang-ky'?'/dang-ky':'/dang-nhap')}/>;
else if(auth)content=IS_UNIFIED_APP?<Auth role="customer" register={route==='dang-ky'}/>:role==='staff'?(route==='dang-ky'?<StaffEmpty title="Tài khoản nhân viên được người quản lý cấp" description="Liên hệ người quản lý để được cấp tài khoản làm việc." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/>:<StaffLogin/>):<Auth role={role} register={route==='dang-ky'}/>;
else if(needsLogin)content=IS_UNIFIED_APP?user?<section className="mx-auto w-full max-w-xl p-5 py-12"><Heading title="Bạn không có quyền truy cập" sub="Vui lòng trở về khu vực dành cho tài khoản của bạn."/><Button render={<Link href={AREA_HOME[user.role]}/>} nativeButton={false}>Về khu vực của tôi</Button></section>:<AccessRedirect href={'/dang-nhap?next='+encodeURIComponent(areaHref(role,'/'+path.join('/'),true))}/>:role==='staff'?<StaffEmpty title="Đăng nhập để tiếp tục" description="Sử dụng tài khoản nhân viên để xem công việc được phân công." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/>:role==='admin'?<><AdminPageHeader title="Đăng nhập để tiếp tục"/><AdminEmpty title="Khu vực dành cho quản trị viên" description="Sử dụng tài khoản quản trị viên đang hoạt động để quản lý dịch vụ." action={<Button render={<Link href="/dang-nhap"/>} nativeButton={false}>Đăng nhập</Button>}/></>:<><Heading title="Đăng nhập để tiếp tục" sub={`Khu vực dành cho ${titles[role].toLowerCase()}.`}/><Go href={role==='customer'?`/dang-nhap?next=${encodeURIComponent(customerReturnPath)}`:'/dang-nhap'}>Đăng nhập</Go></>;
else if(!route)content=role==='customer'?<Home/>:role==='staff'?<StaffDashboard/>:<AdminDashboard/>;
else if(route==='ho-so')content=role==='customer'?<CustomerProfile/>:role==='staff'?<StaffProfile/>:<Profile/>;
else if(route==='dich-vu')content=role==='customer'?<Services slug={path[1]}/>:role==='admin'?<AdminServices/>:<Empty text="Trang không tồn tại."/>;
else if(role==='customer'&&route==='san-pham')content=<Products slug={path[1]}/>;
else if(role==='customer'&&route==='gio-hang')content=<ProductCartPage/>;
else if(role==='customer'&&route==='thanh-toan-san-pham')content=<ProductCheckoutPage/>;
else if(role==='customer'&&route==='don-san-pham')content=<ProductOrdersPage id={path[1]}/>;
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
    {role==='customer'&&CUSTOMER_API_ENABLED&&(dataStatus.error||dataStatus.sessionError)&&<div role="alert" className="relative z-50 flex flex-wrap items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><span>{dataStatus.error||dataStatus.sessionError}</span>{dataStatus.error&&<Button variant="outline" onClick={()=>void refreshCustomerData(true)}>Thử tải lại</Button>}{dataStatus.sessionError&&<Link className="inline-flex min-h-11 items-center font-semibold underline" href={'/dang-nhap?next='+encodeURIComponent(customerReturnPath)}>Đăng nhập lại</Link>}</div>}
    {role!=='customer'&&PORTAL_API_ENABLED&&portalAuth.error&&<div role="alert" className="relative z-50 border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm leading-6 text-amber-950">{portalAuth.error}</div>}
    {role!=='customer'&&!PORTAL_API_ENABLED&&(dataStatus.error||dataStatus.sessionError)&&<div role="alert" className="relative z-50 flex flex-wrap items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><span>{dataStatus.error||dataStatus.sessionError}</span>{dataStatus.dirty&&<Link href="/du-lieu" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{IS_UNIFIED_APP?'Sao lưu dữ liệu':'Sao lưu dữ liệu gốc'}</Link>}</div>}
    {role==='customer'?(
      <CustomerLayout route={route} user={IS_UNIFIED_APP?user:allowed?user:null} onLogout={logout}>
        <div className={route&&!['dich-vu','san-pham','gio-hang','thanh-toan-san-pham','don-san-pham'].includes(route)&&!auth&&!(allowed&&['dat-dich-vu','don-cua-toi','don','lich-su','ho-so'].includes(route))?'ch-container':''} key={role+'/'+path.join('/')+'/'+(user?.id||'guest')}>{content}</div>
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
  const localUser=useCurrentUser()
  const portalAuth=useSyncExternalStore(subscribePortalAuth,portalAuthSnapshot,portalAuthServerSnapshot)
  const user=role==='customer'||!PORTAL_API_ENABLED?localUser:portalAuth.user
  const requested=params.get('next')||''
  if(IS_UNIFIED_APP&&user)return <AccessRedirect href={safeReturnTo(user.role,requested)}/>
  const returnTo=role==='customer'?safeReturnTo('customer',requested):IS_UNIFIED_APP?safeReturnTo(role,requested):HOME_PATH[role]
  if(role==='customer')return <CustomerAuth register={register} returnTo={returnTo} switchHref={(register?'/dang-nhap':'/dang-ky')+(returnTo&&returnTo!==HOME_PATH[role]?'?next='+encodeURIComponent(returnTo):'')}/>
  return <InternalAuth role={role} register={register}/>
}
function InternalAuth({role,register}:{role:Role;register:boolean}){
  const router=useRouter()
  const [identifier,setIdentifier]=useState("")
  const [password,setPassword]=useState("")
  const [error,setError]=useState("")
  const [busy,setBusy]=useState(false)
  if(register&&role!=='customer')return <Empty text="Tài khoản được quản trị viên cấp, không đăng ký công khai."/>
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(busy)return
    setBusy(true);setError("")
    try {
      await loginPortal(role,identifier,password)
      toast.success("Đăng nhập thành công")
      router.push(HOME_PATH[role])
    } catch (reason) {
      setError(reason instanceof Error?reason.message:"Chưa thể đăng nhập. Vui lòng thử lại.")
    } finally {setBusy(false)}
  }
  return <div className="ch-auth"><div className="ch-auth-art"><Sparkles size={40}/><h1>Nhà sạch hơn.<br/>Cuộc sống nhẹ nhàng hơn.</h1><p>{titles[role]} · CleanHome</p><img src="/images/hero.png" alt="Dịch vụ vệ sinh CleanHome"/></div><Panel title={`Đăng nhập ${titles[role].toLowerCase()}`}><p>Dùng tài khoản đã được cấp để tiếp tục.</p><form className="ch-form" onSubmit={submit}><Field label="Email hoặc số điện thoại"><input type="text" autoComplete="username" required maxLength={254} value={identifier} onChange={event=>setIdentifier(event.target.value)}/></Field><Field label="Mật khẩu"><input type="password" required autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></Field>{error&&<p role="alert" className="ch-error">{error}</p>}<Btn type="submit" disabled={busy}>{busy?"Đang đăng nhập...":"Đăng nhập →"}</Btn></form><small>Đăng nhập được xác thực qua backend; không sử dụng tài khoản demo trên trình duyệt.</small></Panel></div>
}
