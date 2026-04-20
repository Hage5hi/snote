// Export dropdown: download note as .md/.html/.pdf/.txt, copy as AI context, copy raw URL.
import { Download, FileCode, FileType, Sparkles, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { exportMarkdown, exportPlainText, exportHtml, exportPdf } from "@/lib/export";
import { formatForAI, approxTokens } from "@/lib/ai-format";
import { toast } from "@/hooks/use-toast";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface ExportMenuProps {
  slug: string;
  getContent: () => string;
  isEncrypted: boolean;
}

export function ExportMenu({ slug, getContent, isEncrypted }: ExportMenuProps) {
  const copyAsAI = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: "Note đang trống" });
      return;
    }
    const formatted = formatForAI(slug, text);
    await navigator.clipboard.writeText(formatted);
    toast({ title: "Đã copy cho AI", description: `~${approxTokens(formatted)} tokens` });
  };

  const copyRawUrl = async () => {
    const url = `${SUPABASE_URL}/functions/v1/raw/${slug}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Đã copy raw URL", description: "Dùng cho cURL / wget / Python" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Export">
          <Download className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportMarkdown(slug, getContent())}>
          <Download className="h-3.5 w-3.5" /> Download .md
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportHtml(slug, getContent())}>
          <FileCode className="h-3.5 w-3.5" /> Download .html
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPdf(slug, getContent())}>
          <FileType className="h-3.5 w-3.5" /> Print to PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPlainText(slug, getContent())}>
          <Download className="h-3.5 w-3.5" /> Download .txt
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyAsAI}>
          <Sparkles className="h-3.5 w-3.5" /> Copy as AI context
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={copyRawUrl}
          disabled={isEncrypted}
          title="URL trỏ thẳng edge function — cURL/wget nhận text/plain ngay (không qua SPA)"
        >
          <Terminal className="h-3.5 w-3.5" /> Copy raw URL (cURL)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
