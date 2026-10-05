"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Icon } from "./icon";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  icon,
  wide = false,
  bare = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  icon?: ReactNode;
  wide?: boolean;
  bare?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={`dialog-content ${wide ? "dialog-wide" : ""} ${bare ? "dialog-bare" : ""}`}
        >
          {bare ? (
            <>
              <DialogPrimitive.Title className="sr-only">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {description ?? title}
              </DialogPrimitive.Description>
            </>
          ) : (
            <div className="dialog-header">
              {icon}
              <div>
                <DialogPrimitive.Title className="dialog-title">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  className={description ? "dialog-description" : "sr-only"}
                >
                  {description ?? title}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                className="icon-button dialog-close"
                aria-label="Close"
              >
                <Icon name="cross" size={18} />
              </DialogPrimitive.Close>
            </div>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
