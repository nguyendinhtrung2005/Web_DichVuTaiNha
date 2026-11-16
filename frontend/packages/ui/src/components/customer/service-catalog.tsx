"use client"

import { useId, useMemo, useState } from "react"
import { SearchIcon, SlidersHorizontalIcon, SparklesIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ServiceCard } from "@/components/customer/service-card"
import { CATEGORY_LABEL } from "@/lib/config"
import type { Service, ServiceCategory } from "@/lib/types"

function searchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim().replace(/\s+/g, " ")
}

const selectClassName = "min-h-12 w-full min-w-0 rounded-xl border border-input bg-white px-3 py-2 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 md:text-sm"

export function ServiceCatalog({ services }: { services: Service[] }) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [sort, setSort] = useState("")
  const activeServices = useMemo(() => services.filter((service) => service.status === "active"), [services])
  const categories = useMemo(() => Array.from(new Set(activeServices.map((service) => service.category))), [activeServices])
  const result = useMemo(() => {
    const terms = searchText(query).split(" ").filter(Boolean)
    return activeServices.filter((service) => {
      const content = searchText(`${service.name} ${service.shortDesc} ${service.description}`)
      return (!category || category === service.category) && terms.every((term) => content.includes(term))
    }).sort((a, b) => sort === "up" ? a.price - b.price : sort === "down" ? b.price - a.price : 0)
  }, [activeServices, category, query, sort])
  const hasFilters = Boolean(query || category || sort)
  const resetFilters = () => { setQuery(""); setCategory(""); setSort("") }

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
          <form role="search" aria-label="Tìm và lọc dịch vụ" className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]" onSubmit={(event) => event.preventDefault()}>
            <div className="min-w-0">
              <label htmlFor={`${id}-query`} className="mb-2 block text-sm font-semibold">Tìm dịch vụ</label>
              <div className="relative">
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input id={`${id}-query`} name="query" type="search" placeholder="Tên hoặc nhu cầu dọn dẹp..." value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-12 rounded-xl bg-white pr-12 pl-10 [&::-webkit-search-cancel-button]:appearance-none" aria-controls={`${id}-results`} autoComplete="off" />
                {query && <span className="absolute top-1/2 right-0.5 -translate-y-1/2"><Button type="button" size="icon" variant="ghost" aria-label="Xóa từ khóa tìm kiếm" onClick={() => { setQuery(""); document.getElementById(`${id}-query`)?.focus() }}><XIcon aria-hidden="true" className="size-4" /></Button></span>}
              </div>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-category`} className="mb-2 block text-sm font-semibold">Nhóm dịch vụ</label>
              <select id={`${id}-category`} name="category" className={selectClassName} value={category} onChange={(event) => setCategory(event.target.value)} disabled={!categories.length} aria-controls={`${id}-results`}>
                <option value="">Tất cả nhóm dịch vụ</option>
                {categories.map((value: ServiceCategory) => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}
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
          </form>
        </CardContent>
      </Card>

      <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 text-sm text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">{result.length ? <>Tìm thấy <strong className="font-semibold text-foreground">{result.length}</strong> dịch vụ{hasFilters ? " phù hợp" : " đang cung cấp"}</> : "Không có dịch vụ để hiển thị"}</p>
        {hasFilters && <Button type="button" variant="ghost" className="text-primary" onClick={resetFilters}><XIcon aria-hidden="true" className="size-4" />Xóa bộ lọc</Button>}
      </div>

      <div id={`${id}-results`}>
        {result.length > 0 ? (
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
