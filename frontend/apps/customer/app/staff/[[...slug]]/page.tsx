import { Portal } from "@/portal"
import { redirect } from "next/navigation"
import { IS_UNIFIED_APP, SITE_URLS } from "@/lib/env"

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params
  if (!IS_UNIFIED_APP) redirect(`${SITE_URLS.staff.replace(/\/$/, "")}/${slug.map(encodeURIComponent).join("/")}`)
  return <Portal role="staff" path={slug} />
}
