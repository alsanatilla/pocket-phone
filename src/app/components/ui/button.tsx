import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Pocket's one button: a key. Anything that does something when pressed is one of these, and nothing else looks
// like one. `default` is a quiet key, `go` the one main action of a screen (amber), `destructive` a key whose
// words warn. The older shadcn names (outline, secondary, ghost) draw the same quiet key, so no screen can make a
// second kind of button by accident. A key is 28px tall and reaches 44px to the touch through its ::before.
const KEY = "bg-secondary text-hi hover:bg-accent";
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[5px] text-xs font-normal whitespace-nowrap transition-[color,background-color,opacity,transform] duration-150 ease-out active:scale-[0.97] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 before:absolute before:-inset-y-2 before:inset-x-0 before:content-[''] sm:before:hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: KEY,
        go: "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
        destructive: "bg-secondary text-destructive hover:bg-accent",
        outline: KEY,
        secondary: KEY,
        ghost: KEY,
        link: "h-auto bg-transparent px-0 text-primary underline underline-offset-2",
      },
      size: {
        default: "h-7 px-2.5",
        xs: "h-7 px-2.5",
        sm: "h-7 px-2.5",
        lg: "h-8 px-3.5",
        icon: "size-8",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
