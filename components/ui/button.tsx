"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

const baseStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const variants: Record<string, string> = {
  default:
    "bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-foreground",
  outline:
    "border border-foreground/20 bg-transparent text-foreground hover:bg-foreground/5 focus-visible:ring-foreground",
  ghost: "bg-transparent hover:bg-foreground/5 text-foreground",
};

const sizes: Record<string, string> = {
  sm: "h-9 px-3",
  md: "h-10 px-4",
  lg: "h-11 px-6",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", asChild, ...props }, ref) => {
    const Comp: React.ElementType = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";


