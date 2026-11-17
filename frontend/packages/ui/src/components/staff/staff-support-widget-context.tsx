"use client"
import { createContext, useContext } from "react"

export const StaffSupportWidgetContext = createContext<{ openChat: () => void } | null>(null)
export function useStaffSupportWidget() { return useContext(StaffSupportWidgetContext) }
