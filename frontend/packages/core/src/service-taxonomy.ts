import type { CleaningType, Service, ServiceGroup } from "./types"
import { SERVICE_GROUP_LABEL } from "./config"

export const SERVICE_GROUPS: ServiceGroup[] = ["ve-sinh", "cham-soc", "bao-duong"]
export const CLEANING_TYPE_LABEL: Record<CleaningType, string> = {
  "phong-tro": "Vệ sinh phòng trọ",
  "nha-gia-dinh": "Vệ sinh nhà ở gia đình",
  khac: "Vệ sinh khác",
}
type TaxonomyService = Pick<Service, "id" | "name" | "category"> & Pick<Partial<Service>, "group" | "categoryName" | "cleaningType">

export function normalizeServiceSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim().replace(/[-_\s]+/g, " ")
}

/** Read-time compatibility only: never rewrite legacy IDs, categories or saved snapshots. */
export function serviceGroupOf(service: TaxonomyService): ServiceGroup {
  if (service.group && SERVICE_GROUPS.includes(service.group)) return service.group
  const source = normalizeServiceSearch((service.categoryName || service.category) + " " + service.name)
  if (source.includes("cham soc")) return "cham-soc"
  if (source.includes("bao duong") || source.includes("thiet bi")) return "bao-duong"
  return "ve-sinh"
}
export function cleaningTypeOf(service: TaxonomyService): CleaningType | undefined {
  if (serviceGroupOf(service) !== "ve-sinh") return undefined
  if (service.cleaningType && Object.hasOwn(CLEANING_TYPE_LABEL, service.cleaningType)) return service.cleaningType
  const source = normalizeServiceSearch((service.categoryName || "") + " " + service.name)
  if (source.includes("phong tro")) return "phong-tro"
  if (source.includes("nha gia dinh") || source.includes("nha o gia dinh")) return "nha-gia-dinh"
  // Known demo records retain their original names and URLs.
  if (["dv-01", "dv-02"].includes(service.id)) return "nha-gia-dinh"
  return undefined
}
export const serviceGroupLabel = (service: TaxonomyService) => SERVICE_GROUP_LABEL[serviceGroupOf(service)]
export const serviceRequiresHouseDetails = (service: TaxonomyService) => ["phong-tro", "nha-gia-dinh"].includes(cleaningTypeOf(service) || "")

export function filterCustomerServices(services: Service[], { query = "", group = "", cleaningType = "" }: { query?: string; group?: string; cleaningType?: string } = {}) {
  const terms = normalizeServiceSearch(query).split(" ").filter(Boolean)
  return services.filter((service) => {
    if (service.status !== "active" || (group && serviceGroupOf(service) !== group) || (cleaningType && cleaningTypeOf(service) !== cleaningType)) return false
    const type = cleaningTypeOf(service)
    const source = normalizeServiceSearch([service.name, service.shortDesc, service.description, service.categoryName || "", serviceGroupLabel(service), type ? CLEANING_TYPE_LABEL[type] : ""].join(" "))
    return terms.every((term) => source.includes(term))
  })
}
