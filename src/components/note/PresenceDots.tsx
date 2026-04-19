import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PresenceUser = { clientId: number; name: string; color: string };

export function PresenceDots({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;
  const visible = users.slice(0, 5);
  const extra = users.length - visible.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((u) => (
          <Tooltip key={u.clientId}>
            <TooltipTrigger asChild>
              <div
                className="h-2.5 w-2.5 rounded-full ring-2 ring-background"
                style={{ backgroundColor: u.color }}
                aria-label={u.name}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {u.name}
            </TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <span className="ml-2 text-[11px] text-muted-foreground">+{extra}</span>
        )}
      </div>
    </TooltipProvider>
  );
}
