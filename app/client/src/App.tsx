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
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, Outlet } from 'react-router';
import { SidebarInset, SidebarProvider } from '@databricks/appkit-ui/react';

import { AppSidebar } from '@/shell/AppSidebar';
import { AppHeader } from '@/shell/AppHeader';
import { LineageExplorerView } from '@/lineage/LineageExplorerView';
import { PermissionsMappingView } from '@/permissions/PermissionsMappingView';
import { TerraformSourceView } from '@/setup/TerraformSourceView';
import { SessionProvider } from '@/lib/api';
import { isSetupComplete, readSetupState } from '@/lib/setup';
import { RouteError } from './RouteError';

function Layout() {
  useEffect(() => {
    const state = readSetupState();
    if (state.status !== 'configured' || !state.path) return;
    void fetch('/api/terraform/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.path }),
    });
  }, []);

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

function HomeRedirect() {
  return <Navigate to={isSetupComplete() ? '/lineage' : '/setup'} replace />;
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
        { path: '/', element: <HomeRedirect /> },
        { path: '/lineage', element: <LineageExplorerView /> },
        { path: '/analytics', element: <Navigate to="/lineage" replace /> },
        { path: '/c/:id', element: <Navigate to="/lineage" replace /> },
        { path: '/dashboard', element: <Navigate to="/permissions" replace /> },
        { path: '/permissions', element: <PermissionsMappingView /> },
        { path: '/setup', element: <TerraformSourceView /> },
      ],
    },
  ],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
