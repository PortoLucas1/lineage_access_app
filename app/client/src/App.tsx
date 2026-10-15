/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   lineage/      — Lineage Explorer (graph + access panel + KPI cards)
 *   permissions/  — identity → Unity Catalog effective access
 *   platform/     — Databricks Data + AI pitch page
 *
 * Chrome (sidebar + header) lives in shell/.
 */
import { createBrowserRouter, Navigate, RouterProvider, Outlet } from 'react-router';
import { SidebarInset, SidebarProvider } from '@databricks/appkit-ui/react';

import { AppSidebar } from '@/shell/AppSidebar';
import { AppHeader } from '@/shell/AppHeader';
import { LineageExplorerView } from '@/lineage/LineageExplorerView';
import { PermissionsMappingView } from '@/permissions/PermissionsMappingView';
import { SessionProvider } from '@/lib/api';
import { RouteError } from './RouteError';

function Layout() {
  return (
    <SessionProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  );
}

// When this app runs inside the Demo Prompt Generator's preview proxy, a
// client-side shim publishes `window.__PREVIEW_BASENAME__` (e.g.
// "/preview/<project-id>"). Passing it as `basename` tells react-router to
// strip that prefix before matching routes. Outside the proxy it's undefined
// and the router behaves normally.
declare global {
  interface Window {
    __PREVIEW_BASENAME__?: string;
  }
}
const PREVIEW_BASENAME =
  typeof window !== 'undefined' ? window.__PREVIEW_BASENAME__ : undefined;

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      errorElement: <RouteError />,
      children: [
        { path: '/', element: <LineageExplorerView /> },
        { path: '/lineage', element: <LineageExplorerView /> },
        { path: '/analytics', element: <Navigate to="/" replace /> },
        { path: '/c/:id', element: <Navigate to="/" replace /> },
        { path: '/dashboard', element: <Navigate to="/permissions" replace /> },
        { path: '/permissions', element: <PermissionsMappingView /> },
      ],
    },
  ],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
