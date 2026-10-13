"use client"

import { useId, useState, type ComponentProps } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PasswordFieldProps = Omit<ComponentProps<typeof Input>, "type"> & { toggleLabel?: string }

export function PasswordField({ id, className, style, disabled, autoComplete = "current-password", toggleLabel = "mật khẩu", ...props }: PasswordFieldProps) {
  const generatedId = useId()
  const inputId = id || generatedId
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative min-w-0">
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn("min-h-12 rounded-xl", className)}
        style={{ ...style, paddingRight: "3.5rem" }}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="size-11 min-h-11 min-w-11 text-muted-foreground hover:text-primary"
          aria-label={`${visible ? "Ẩn" : "Hiện"} ${toggleLabel}`}
          aria-pressed={visible}
          aria-controls={inputId}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOffIcon aria-hidden="true" className="size-5" /> : <EyeIcon aria-hidden="true" className="size-5" />}
        </Button>
      </div>
    </div>
  )
}
