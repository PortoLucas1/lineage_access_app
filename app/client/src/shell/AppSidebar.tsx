import { NavLink, useLocation } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@databricks/appkit-ui/react';
import { Network } from 'lucide-react';
import { useSession } from '@/lib/api';

const navItems = [
  { to: '/', label: 'Lineage Explorer', icon: Network, end: true },
];

export function AppSidebar() {
  const { config } = useSession();
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <NavLink to="/" onClick={closeOnMobile} className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-sidebar-accent transition-colors">
          <div
            className="flex aspect-square size-8 items-center justify-center rounded-md text-primary-foreground font-semibold shrink-0"
            style={{ background: 'var(--primary)' }}
          >
            {(config?.branding.appName ?? '•')[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col leading-tight overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold truncate">
              {config?.branding.appName ?? 'Loading…'}
            </span>
          </div>
        </NavLink>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <NavLink to={item.to} end={item.end} onClick={closeOnMobile}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        isActive={
                          item.to === '/'
                            ? isActive || location.pathname.startsWith('/lineage')
                            : isActive
                        }
                        tooltip={item.label}
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
