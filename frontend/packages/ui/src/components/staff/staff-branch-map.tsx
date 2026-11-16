"use client"

import { useEffect, useId, useRef, useState } from "react"
import "leaflet/dist/leaflet.css"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { branchPoint, servicePolygon, type StaffMapsConfig } from "./staff-maps-model"
import { loadStaffMaps } from "./staff-maps-loader"
import type { Map as LeafletMap } from "leaflet"

/** Read-only branch geometry. No geocoding, booking data or device location. */
export function StaffBranchMap({ config = null, latitude, longitude, serviceArea, branchName, branchAddress = null }: {
  config?: StaffMapsConfig | null; latitude: string | null; longitude: string | null
  serviceArea: unknown; branchName: string | null; branchAddress?: string | null
}) {
  const point = branchPoint(latitude, longitude), polygon = servicePolygon(serviceArea)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [retry, setRetry] = useState(0)
  const node = useRef<HTMLDivElement>(null), instructionsId = useId()
  const geometry = JSON.stringify(polygon), name = branchName || "Chi nhánh được phân công"

  useEffect(() => {
    if (!open || !config || (!point && geometry === "null") || !node.current) return
    let disposed = false, tileFailed = false, loadedTile = false
    let map: LeafletMap | null = null, observer: ResizeObserver | null = null
    const target = node.current
    // Leaflet's map keyboard handler is inactive while the marker has focus.
    const escapePopup = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !target.querySelector(".leaflet-popup")) return
      map?.closePopup()
      target.querySelector<HTMLElement>("[data-staff-branch-marker]")?.focus({ preventScroll: true })
      event.preventDefault(); event.stopPropagation()
    }
    target.addEventListener("keydown", escapePopup, true)
    let timer: number | undefined
    const fail = () => { if (!disposed) { tileFailed = true; window.clearTimeout(timer); setState("error") } }
    const loading = () => {
      if (disposed || tileFailed) return
      setState("loading"); window.clearTimeout(timer)
      timer = window.setTimeout(fail, 20000)
    }
    loading()
    void loadStaffMaps().then(L => {
      if (disposed || tileFailed) return
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      map = L.map(target, { keyboard: true, scrollWheelZoom: false, zoomControl: false, attributionControl: false,
        zoomAnimation: !reducedMotion, fadeAnimation: !reducedMotion, markerZoomAnimation: !reducedMotion })
      L.control.zoom({ zoomInTitle: "Phóng to bản đồ", zoomOutTitle: "Thu nhỏ bản đồ" }).addTo(map)
      L.control.attribution({ prefix: false }).addTo(map)

      const attribution = document.createElement("span"), osm = document.createElement("a")
      osm.href = "https://www.openstreetmap.org/copyright"; osm.textContent = "OpenStreetMap contributors"
      attribution.append("© ", osm)
      if (config.providerName) {
        attribution.append(" · ")
        if (config.providerUrl) {
          const provider = document.createElement("a")
          provider.href = config.providerUrl; provider.textContent = config.providerName; attribution.append(provider)
        } else attribution.append(config.providerName)
      }
      const bounds = L.latLngBounds([])
      if (point) {
        const icon = L.divIcon({ className: "staff-branch-marker", html: '<span class="staff-branch-map-pin" aria-hidden="true"></span>',
          iconSize: [32, 40], iconAnchor: [16, 38], popupAnchor: [0, -36] })
        const popup = document.createElement("div"), title = document.createElement("strong"), address = document.createElement("p")
        title.textContent = name; address.textContent = branchAddress || "Chưa có địa chỉ chi nhánh."
        popup.append(title, address)
        const marker = L.marker([point.lat, point.lng], { icon, keyboard: true, autoPanOnFocus: true, title: name, alt: name })
          .bindPopup(popup, { maxWidth: 260 })
        // Leaflet creates the icon only after the map has its initial view.
        marker.on("add", () => {
          const element = marker.getElement()
          element?.setAttribute("aria-label", `Xem chi nhánh ${name}`)
          element?.setAttribute("data-staff-branch-marker", "true")
          element?.setAttribute("data-latitude", String(point.lat)); element?.setAttribute("data-longitude", String(point.lng))
        }).addTo(map)
        bounds.extend([point.lat, point.lng])
      }
      if (geometry !== "null") {
        const boundary = L.geoJSON(JSON.parse(geometry), { interactive: false,
          style: { className: "staff-service-area-boundary", color: "#2563eb", weight: 2, fillOpacity: 0.12 } }).addTo(map)
        bounds.extend(boundary.getBounds())
      }
      if (geometry !== "null") map.fitBounds(bounds, { padding: [24, 24], maxZoom: Math.min(15, config.maxZoom), animate: false })
      else if (point) map.setView([point.lat, point.lng], Math.min(13, config.maxZoom))

      const tiles = L.tileLayer(config.tileUrl, {
        attribution: attribution.innerHTML, maxZoom: config.maxZoom, minZoom: 1,
        // Only visible tiles, native browser caching and an identifying Referer.
        keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false, detectRetina: false, noWrap: true,
        referrerPolicy: "strict-origin-when-cross-origin",
      })
      tiles.on("loading", loading).on("tileload", () => { loadedTile = true }).on("tileerror", fail).on("load", () => {
        window.clearTimeout(timer)
        if (!disposed && !tileFailed && loadedTile) setState("ready")
      }).addTo(map)
      observer = new ResizeObserver(() => { if (!disposed) map?.invalidateSize({ pan: false }) })
      observer.observe(target)
    }).catch(fail)
    return () => {
      disposed = true; window.clearTimeout(timer); target.removeEventListener("keydown", escapePopup, true); observer?.disconnect(); map?.remove()
    }
  }, [open, config?.tileUrl, config?.maxZoom, config?.providerName, config?.providerUrl, point?.lat, point?.lng, geometry, name, branchAddress, retry])

  return <Card className="staff-branch-map" data-staff-map={state}><CardContent>
    <h2>Bản đồ khu vực phục vụ</h2>
    {!point && <p>Chưa có vị trí chi nhánh để hiển thị trên bản đồ.</p>}
    {!config
      ? <p>Bản đồ hiện chưa khả dụng.</p>
      : (point || polygon) && <>
        <p>{name} · Không yêu cầu vị trí thiết bị của bạn.</p>
        {!open ? <Button variant="outline" onClick={() => setOpen(true)}>Mở bản đồ</Button> : <>
          <p id={instructionsId}>Dùng Tab để chọn bản đồ, phím mũi tên để di chuyển, +/− để thu phóng. Chọn marker và nhấn Enter để xem chi nhánh; Escape để đóng popup.</p>
          <div ref={node} className="staff-branch-map-canvas" aria-label="Bản đồ vị trí chi nhánh và vùng phục vụ" aria-describedby={instructionsId} role="region" tabIndex={0} aria-busy={state === "loading"} />
          {state === "loading" && <p role="status">Đang tải bản đồ...</p>}
          {state === "error" && <div role="alert"><p>Chưa thể tải đầy đủ bản đồ. Kiểm tra kết nối rồi thử lại.</p><Button variant="outline" onClick={() => setRetry(n => n + 1)}>Thử tải bản đồ lại</Button></div>}
          {state === "ready" && <p role="status">Đã tải bản đồ chi nhánh.</p>}
        </>}
      </>}
    <p className="staff-areas-muted">{polygon ? "Ranh giới theo thông tin chi nhánh cung cấp." : "Chưa có ranh giới vùng phục vụ để hiển thị."}</p>
  </CardContent></Card>
}
