import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const variants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      primary: "bg-amber-400 text-slate-950 hover:bg-amber-300",
      secondary: "border border-white/10 bg-white/[0.045] text-slate-200 hover:bg-white/[0.08] hover:text-white",
      ghost: "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
      danger: "text-red-300 hover:bg-red-400/10",
    },
    size: { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", icon: "size-9" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(variants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
