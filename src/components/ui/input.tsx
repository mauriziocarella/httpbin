import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/10", className)} {...props} />
));
Input.displayName = "Input";
