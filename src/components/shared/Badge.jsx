import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brandBlue text-white shadow-xs",
        secondary: "border-transparent bg-slate-100 text-slate-800",
        destructive: "border-transparent bg-red-100 text-red-800 border-red-200",
        success: "border-transparent bg-emerald-100 text-emerald-800 border-emerald-200",
        warning: "border-transparent bg-amber-100 text-amber-800 border-amber-200",
        outline: "text-foreground border-slate-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
