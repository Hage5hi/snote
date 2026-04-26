import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 max-w-[260px] overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Context to share controlled open state between Tooltip and TooltipTrigger
 * so we can open on long-press for touch devices (Radix Tooltip is hover-only
 * by default — touch users never see hints otherwise).
 */
type TouchTooltipCtx = {
  setOpen: (v: boolean) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
};
const TouchTooltipContext = React.createContext<TouchTooltipCtx | null>(null);

const LONG_PRESS_MS = 450;
const AUTO_CLOSE_MS = 2500;

const Tooltip = ({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) => {
  const [open, setOpen] = React.useState<boolean>(defaultOpen ?? false);
  const isControlled = openProp !== undefined;
  const currentOpen = isControlled ? (openProp as boolean) : open;
  const pressTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);

  const handleOpenChange = (v: boolean) => {
    if (!isControlled) setOpen(v);
    onOpenChange?.(v);
  };

  const clearTimers = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const ctx = React.useMemo<TouchTooltipCtx>(
    () => ({
      setOpen: handleOpenChange,
      onTouchStart: () => {
        clearTimers();
        pressTimer.current = window.setTimeout(() => {
          handleOpenChange(true);
          // Auto-close after a short readable window so it doesn't linger.
          closeTimer.current = window.setTimeout(() => handleOpenChange(false), AUTO_CLOSE_MS);
        }, LONG_PRESS_MS);
      },
      onTouchEnd: () => {
        // If long-press hasn't fired yet, cancel — it was a tap.
        if (pressTimer.current) {
          window.clearTimeout(pressTimer.current);
          pressTimer.current = null;
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isControlled, openProp],
  );

  React.useEffect(() => () => clearTimers(), []);

  return (
    <TouchTooltipContext.Provider value={ctx}>
      <TooltipPrimitive.Root open={currentOpen} onOpenChange={handleOpenChange} {...props} />
    </TouchTooltipContext.Provider>
  );
};

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onTouchStart, onTouchEnd, onTouchCancel, onContextMenu, ...props }, ref) => {
  const ctx = React.useContext(TouchTooltipContext);
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onTouchStart={(e) => {
        ctx?.onTouchStart();
        onTouchStart?.(e);
      }}
      onTouchEnd={(e) => {
        ctx?.onTouchEnd();
        onTouchEnd?.(e);
      }}
      onTouchCancel={(e) => {
        ctx?.onTouchEnd();
        onTouchCancel?.(e);
      }}
      onContextMenu={(e) => {
        // Prevent the iOS/Android long-press context menu from interrupting.
        e.preventDefault();
        onContextMenu?.(e);
      }}
      {...props}
    />
  );
});
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
