import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("w-full resize-none rounded-md border border-white/10 bg-black/25 px-3 py-2 font-mono text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/10", className)} {...props} />
));
Textarea.displayName = "Textarea";
