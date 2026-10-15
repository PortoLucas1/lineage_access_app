/**
 * Top bar — current user and workspace context.
 */
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  SidebarTrigger,
} from '@databricks/appkit-ui/react';
import { AlertTriangle, Moon, Sun } from 'lucide-react';
import { useSession } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export function AppHeader() {
  const { me, meError, configError, retry: retryBoot } = useSession();
  const { theme, toggle: toggleTheme } = useTheme();
  const bootError = meError ?? configError;

  const initials = (me?.userName ?? '?')
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="flex-1" />
      {bootError && (
        <button
          type="button"
          onClick={retryBoot}
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/15 transition-colors"
          title={`Backend error: ${bootError}\nClick to retry /api/me + /api/config.`}
        >
          <AlertTriangle className="size-3.5" />
          Backend error — click to retry
        </button>
      )}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full hover:bg-muted px-2 py-1 transition-colors"
            aria-label="User menu"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials || '?'}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:inline">
              {me?.userName ?? '…'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="font-medium">{me?.userName ?? '—'}</div>
            {me?.userEmail && (
              <div className="text-xs text-muted-foreground font-normal">
                {me.userEmail}
              </div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-xs">
            {me?.isUserContext ? 'OBO (user) auth' : 'Service principal auth'}
          </DropdownMenuItem>
          {me?.workspaceUrl && (
            <DropdownMenuItem asChild>
              <a href={me.workspaceUrl} target="_blank" rel="noopener noreferrer">
                Open workspace ↗
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
