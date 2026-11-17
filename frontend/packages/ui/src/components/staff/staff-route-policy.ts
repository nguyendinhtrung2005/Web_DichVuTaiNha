import { validAreaPath } from "@/components/shared/route-policy"

/** Extend navigation for Staff only; account/session authorization stays on the server. */
export function validStaffPath(path: string[]): boolean {
  return validAreaPath("staff", path) || (path.length === 1 && ["thong-bao", "lich-su", "ho-tro", "cai-dat", "thong-ke-cong-viec", "thu-nhap", "khu-vuc", "thanh-tich"].includes(path[0]))
}
