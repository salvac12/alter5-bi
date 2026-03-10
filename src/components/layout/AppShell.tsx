import { ReactNode } from 'react';
import Header from './Header';
import SideNav from './SideNav';
import { colors, layout } from '../../theme/tokens';
import type { ViewId } from '../../types';

interface AppShellProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  search: string;
  onSearchChange: (val: string) => void;
  onOpenCerebro: () => void;
  onExportCSV: () => void;
  filteredCount: number;
  cleanupMode: boolean;
  onToggleCleanup: () => void;
  currentUser: any;
  onOpenSettings: () => void;
  subtitle: string;
  children: ReactNode;
}

export default function AppShell({
  activeView,
  onViewChange,
  search,
  onSearchChange,
  onOpenCerebro,
  onExportCSV,
  filteredCount,
  cleanupMode,
  onToggleCleanup,
  currentUser,
  onOpenSettings,
  subtitle,
  children,
}: AppShellProps) {
  return (
    <div style={{
      minHeight: '100vh',
      background: colors.appBg,
    }}>
      <Header
        activeView={activeView}
        search={search}
        onSearchChange={onSearchChange}
        onOpenCerebro={onOpenCerebro}
        onExportCSV={onExportCSV}
        filteredCount={filteredCount}
        cleanupMode={cleanupMode}
        onToggleCleanup={onToggleCleanup}
        currentUser={currentUser}
        onOpenSettings={onOpenSettings}
        subtitle={subtitle}
      />

      <SideNav
        activeView={activeView}
        onViewChange={onViewChange}
      />

      {/* Content area */}
      <main style={{
        marginLeft: layout.sideNavWidth,
        marginTop: layout.headerHeight,
        minHeight: `calc(100vh - ${layout.headerHeight}px)`,
        background: colors.contentBg,
        borderTopLeftRadius: layout.borderRadius.xl,
        overflow: 'hidden',
      }}>
        {children}
      </main>
    </div>
  );
}
