"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { SearchIcon, SlidersHorizontalIcon, SparklesIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ServiceCard } from "@/components/customer/service-card"
import { SERVICE_GROUP_LABEL } from "@/lib/config"
import { CLEANING_TYPE_LABEL, SERVICE_GROUPS } from "@/lib/service-taxonomy"
import { searchCustomerServices } from "@/lib/customer-service-search"
import type { Service } from "@/lib/types"

const selectClassName = "min-h-12 w-full min-w-0 rounded-xl border border-input bg-white px-3 py-2 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 md:text-sm"

export function ServiceCatalog({ services }: { services: Service[] }) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [cleaningType, setCleaningType] = useState("")
  const [sort, setSort] = useState("")
  const [retry, setRetry] = useState(0)
  const activeServices = useMemo(() => services.filter((service) => service.status === "active"), [services])
  const searchKey = JSON.stringify([query, category, cleaningType])
  const [search, setSearch] = useState<{ key: string; items: Service[]; error?: string }>(() => ({ key: searchKey, items: activeServices }))
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    if (!query.trim() && !category && !cleaningType) {
      setSearch({ key: searchKey, items: activeServices })
      return
    }
    const timer = setTimeout(() => {
      void searchCustomerServices({ query, group: category, cleaningType }, controller.signal).then(
        (items) => { if (!cancelled) setSearch({ key: searchKey, items }) },
        (error: unknown) => { if (!cancelled) setSearch({ key: searchKey, items: [], error: error instanceof Error ? error.message : "Chưa thể tìm dịch vụ. Vui lòng thử lại." }) },
      )
    }, 250)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [query, category, cleaningType, searchKey, activeServices, retry])
  const searching = search.key !== searchKey
  const result = useMemo(() => {
    return [...search.items].sort((a, b) => sort === "up" ? a.price - b.price : sort === "down" ? b.price - a.price : 0)
  }, [search.items, sort])
  const hasFilters = Boolean(query || category || cleaningType || sort)
  const resetFilters = () => { setQuery(""); setCategory(""); setCleaningType(""); setSort("") }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14" aria-labelledby={`${id}-heading`}>
      <div className="mb-8 max-w-3xl md:mb-10">
        <p className="m-0 mb-3 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          <SparklesIcon aria-hidden="true" className="size-4" />
          Dịch vụ CleanHome
        </p>
        <h1 id={`${id}-heading`} className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">Chọn dịch vụ cho ngôi nhà của bạn</h1>
        <p className="m-0 mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Từ dọn dẹp thường ngày đến vệ sinh chuyên sâu, tìm dịch vụ phù hợp với nhu cầu và không gian sống. Xem phạm vi công việc và giá tham khảo trước khi đặt lịch.</p>
      </div>

      <Card className="mb-8 rounded-2xl bg-slate-50/80 shadow-none ring-border [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
        <CardContent>
          <form role="search" aria-label="Tìm và lọc dịch vụ" className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_1fr_1fr_1fr]" onSubmit={(event) => { event.preventDefault(); setSearch({ key: "", items: [] }); setRetry((value) => value + 1) }}>
            <div className="min-w-0">
              <label htmlFor={`${id}-query`} className="mb-2 block text-sm font-semibold">Tìm dịch vụ</label>
              <div className="relative">
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input id={`${id}-query`} name="query" type="search" maxLength={120} placeholder="Tên hoặc nhu cầu dọn dẹp..." value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-12 rounded-xl bg-white pr-12 pl-10 [&::-webkit-search-cancel-button]:appearance-none" aria-controls={`${id}-results`} autoComplete="off" />
                {query && <span className="absolute top-1/2 right-0.5 -translate-y-1/2"><Button type="button" size="icon" variant="ghost" aria-label="Xóa từ khóa tìm kiếm" onClick={() => { setQuery(""); document.getElementById(`${id}-query`)?.focus() }}><XIcon aria-hidden="true" className="size-4" /></Button></span>}
              </div>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-category`} className="mb-2 block text-sm font-semibold">Nhóm dịch vụ</label>
              <select id={`${id}-category`} name="category" className={selectClassName} value={category} onChange={(event) => { setCategory(event.target.value); if (event.target.value && event.target.value !== "ve-sinh") setCleaningType("") }} aria-controls={`${id}-results`}>
                <option value="">Tất cả nhóm dịch vụ</option>
                {SERVICE_GROUPS.map((value) => <option key={value} value={value}>{SERVICE_GROUP_LABEL[value]}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-cleaning-type`} className="mb-2 block text-sm font-semibold">Loại vệ sinh</label>
              <select id={`${id}-cleaning-type`} className={selectClassName} value={cleaningType} onChange={(event) => setCleaningType(event.target.value)} disabled={Boolean(category && category !== "ve-sinh")} aria-controls={`${id}-results`}>
                <option value="">Tất cả loại vệ sinh</option>{Object.entries(CLEANING_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-sort`} className="mb-2 block text-sm font-semibold">Sắp xếp</label>
              <select id={`${id}-sort`} name="sort" className={selectClassName} value={sort} onChange={(event) => setSort(event.target.value)} disabled={!activeServices.length} aria-controls={`${id}-results`}>
                <option value="">Mặc định</option>
                <option value="up">Giá tăng dần</option>
                <option value="down">Giá giảm dần</option>
              </select>
            </div>
            <Button type="submit" className="sm:col-span-2 xl:col-span-4">Tìm kiếm<SearchIcon aria-hidden="true" className="size-4" /></Button>
          </form>
        </CardContent>
      </Card>

      <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 text-sm text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">{searching ? "Đang tìm dịch vụ..." : search.error ? "Chưa thể tải kết quả tìm kiếm" : result.length ? <>Tìm thấy <strong className="font-semibold text-foreground">{result.length}</strong> dịch vụ{hasFilters ? " phù hợp" : " đang cung cấp"}</> : "Không có dịch vụ để hiển thị"}</p>
        {hasFilters && <Button type="button" variant="ghost" className="text-primary" onClick={resetFilters}><XIcon aria-hidden="true" className="size-4" />Xóa bộ lọc</Button>}
      </div>

      <div id={`${id}-results`} aria-busy={searching}>
        {searching ? <p role="status" className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">Đang tải kết quả từ hệ thống...</p> : search.error ? <div role="alert" className="rounded-2xl border border-border p-6"><h2 className="m-0 text-xl font-semibold">Chưa thể tìm dịch vụ</h2><p className="my-4 text-sm leading-7 text-muted-foreground">{search.error}</p><Button variant="outline" onClick={() => { setSearch({ key: "", items: [] }); setRetry((value) => value + 1) }}>Thử lại</Button></div> : result.length > 0 ? (
          <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {result.map((service) => <ServiceCard key={service.id} service={service} showBooking headingLevel="h2" />)}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-slate-50 px-5 py-14 text-center sm:px-8" aria-labelledby={`${id}-empty-heading`}>
            <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-primary">{activeServices.length ? <SearchIcon aria-hidden="true" className="size-6" /> : <SlidersHorizontalIcon aria-hidden="true" className="size-6" />}</span>
            <h2 id={`${id}-empty-heading`} className="m-0 text-xl leading-7 font-semibold">{activeServices.length ? "Chưa tìm thấy dịch vụ phù hợp" : "Hiện chưa có dịch vụ đang cung cấp"}</h2>
            <p className="m-0 mt-3 max-w-md text-sm leading-6 text-muted-foreground">{activeServices.length ? "Thử một từ khóa khác hoặc xóa bộ lọc để xem các dịch vụ đang có." : "Vui lòng quay lại sau để xem danh sách dịch vụ của CleanHome."}</p>
            {activeServices.length > 0 && <Button type="button" className="mt-6 px-5" onClick={resetFilters}>Xem tất cả dịch vụ</Button>}
          </div>
        )}
      </div>
    </section>
  )
}
