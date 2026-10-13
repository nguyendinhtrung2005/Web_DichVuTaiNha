"use client"

import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react"
import NextLink from "next/link"
import { APP_ROLE, SITE_URLS } from "@/lib/env"
import type { Role } from "@/lib/types"

const unifiedApplication = process.env.NEXT_PUBLIC_APP_MODE === "unified"
type AreaRouting = { role: Role; unified: boolean }
const AreaRoutingContext = createContext<AreaRouting>({ role: APP_ROLE, unified: unifiedApplication })

/** Area chooses URLs; the authenticated account still determines permissions. */
export function areaHref(role: Role, path = "/", unified = unifiedApplication): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path
  const relativePath = path.startsWith("/") ? path : `/${path}`
  if (!unified || role === "customer" || /^\/(?:dang-nhap|dang-ky)(?:[/?#]|$)/.test(relativePath)) return relativePath
  const base = `/${role}`
  if (relativePath === base || relativePath.startsWith(`${base}/`) || relativePath.startsWith(`${base}?`) || relativePath.startsWith(`${base}#`)) return relativePath
  return relativePath === "/" ? base : `${base}${relativePath}`
}

export function AreaRoutesProvider({ role, unified = unifiedApplication, children }: { role: Role; unified?: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ role, unified }), [role, unified])
  return <AreaRoutingContext.Provider value={value}>{children}</AreaRoutingContext.Provider>
}

export function useAreaRoutes() {
  const { role, unified } = useContext(AreaRoutingContext)
  return useMemo(() => ({
    role,
    unified,
    href: (path: string) => areaHref(role, path, unified),
    homeHref: areaHref(role, "/", unified),
    loginHref: "/dang-nhap",
    siteHref: (target: Role, path = "/") => unified
      ? areaHref(target, path, true)
      : `${SITE_URLS[target].replace(/\/$/, "")}${path === "/" ? "" : path.startsWith("/") ? path : `/${path}`}`,
  }), [role, unified])
}

/** Keeps the existing screen links working in both prefixed and standalone apps. */
export function AreaLink({ href, ...props }: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  const routes = useAreaRoutes()
  return <NextLink {...props} href={routes.href(href)} />
}
