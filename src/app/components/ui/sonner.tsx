import { Toaster as Sonner, type ToasterProps } from "sonner"

// Pocket is dark only, so the theme is fixed instead of read from a theme provider. A toast is one quiet line on the
// floating surface, with a hairline and no icon: what happened is said, not decorated.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: { toast: "flex w-full items-center gap-2 rounded-sm border bg-popover px-3 py-2 font-sans text-xs text-foreground" },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
