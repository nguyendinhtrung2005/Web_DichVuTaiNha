import { StaffAuthPortal } from "@/components/staff/staff-auth-portal"
import { isStaffIncomeDemoEnabled } from "../../lib/server/income-demo-config.mjs"
import { isStaffProfileDemoEnabled } from "../../lib/server/profile-demo-config.mjs"
import { isStaffNotificationsDemoEnabled } from "../../lib/server/notifications-demo-config.mjs"
import { isStaffAreasDemoEnabled } from "../../lib/server/areas-demo-config.mjs"
import { isStaffAchievementsDemoEnabled } from "../../lib/server/achievements-demo-config.mjs"
import { isStaffSupportDemoEnabled } from "../../lib/server/support-demo-config.mjs"
import { isStaffSettingsDemoEnabled } from "../../lib/server/settings-demo-config.mjs"

import { staffMapsConfig } from "../../lib/server/maps-config.mjs"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  return <StaffAuthPortal path={slug || []} incomeDemoEnabled={isStaffIncomeDemoEnabled()} profileDemoEnabled={isStaffProfileDemoEnabled()} notificationsDemoEnabled={isStaffNotificationsDemoEnabled()} areasDemoEnabled={isStaffAreasDemoEnabled()} achievementsDemoEnabled={isStaffAchievementsDemoEnabled()} supportDemoEnabled={isStaffSupportDemoEnabled()} settingsDemoEnabled={isStaffSettingsDemoEnabled()} mapsConfig={staffMapsConfig()} />
}
