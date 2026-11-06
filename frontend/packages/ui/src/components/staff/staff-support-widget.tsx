"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { BotIcon } from "lucide-react"
import { StaffSupportAssistant } from "./staff-support-assistant"
import { StaffSupportWidgetContext } from "./staff-support-widget-context"
import { useStaffDisplayPreferences } from "./staff-display-preferences"

/** One in-memory conversation per authenticated account, preserved across Staff routes. */
export function StaffSupportWidgetProvider({ children, active, accountScope, checkSession }: { children: ReactNode; active: boolean; accountScope: string; checkSession: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [mounted, setMounted] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null), panelId = useId(), display = useStaffDisplayPreferences()
  useEffect(() => { if (!active) { setOpen(false); setMounted(false) } }, [active])
  const openChat = () => { if (active) { setMounted(true); setOpen(true) } }
  const minimize = () => { setOpen(false); launcher.current?.focus() }
  return <StaffSupportWidgetContext.Provider value={active ? { openChat } : null}>
    {children}
    {active && <div className="staff-chat-widget staff-preference-surface" data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} data-staff-chat-widget>
      {mounted && <section id={panelId} role="dialog" aria-modal="false" aria-label="Trợ lý CleanHome" className="staff-chat-panel" data-staff-chat-panel hidden={!open} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); minimize() } }}>
        <StaffSupportAssistant accountScope={accountScope} checkSession={checkSession} open={open} onMinimize={minimize} />
      </section>}
      <button ref={launcher} type="button" className="staff-chat-launcher" aria-label={open ? "Thu nhỏ trợ lý CleanHome" : "Mở trợ lý CleanHome"} aria-expanded={open} aria-controls={mounted ? panelId : undefined} aria-haspopup="dialog" data-staff-chat-launcher onClick={() => open ? minimize() : openChat()}><BotIcon aria-hidden="true" /></button>
    </div>}
  </StaffSupportWidgetContext.Provider>
}
