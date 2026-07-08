import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Zap, Layers, Dumbbell, MessageCircle,
  Calendar, Users, Target, Send, CheckSquare, TrendingUp,
  BarChart2, Activity, Building2, Settings, ChevronDown,
  ChevronRight, Shield, LogOut, RefreshCw, Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Avatar } from '@/components/ui/Avatar';
import { CountBubble } from '@/components/ui/Badge';
import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { queryKeys } from '@/lib/queryKeys';
import { ROUTES } from '@/lib/constants';

interface NavItemProps {
  to:       string;
  icon:     React.ReactNode;
  label:    string;
  badge?:   number;
  end?:     boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, end, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
          isActive
            ? 'bg-brand-50 text-brand border-l-2 border-brand ml-[-1px]'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        )
      }
    >
      <span className="shrink-0 w-4 h-4">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && <CountBubble count={badge} />}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </p>
  );
}

interface SidebarProps {
  onNavigate?: () => void; // called after nav item click (used to close mobile overlay)
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();
  const { isManager }    = useRole();
  const { activeWorkspace, switchWorkspace, isSwitching } = useWorkspaceContext();
  const { calendarAlertCount, pendingFeedbackCount, followupUnviewedCount } = useNotificationContext();
  const navigate = useNavigate();

  const [teamExpanded,      setTeamExpanded]      = useState(false);
  const [workspacesOpen,    setWorkspacesOpen]     = useState(false);

  const { data: workspacesData } = useQuery({
    queryKey: queryKeys.workspacesList,
    queryFn:  () => workspacesApi.list().then((r) => r.data.workspaces),
    staleTime: 5 * 60_000,
  });

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <div className="flex flex-col h-full w-60 bg-white border-r border-surface-border">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-surface-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <span className="font-bold text-text-primary text-sm tracking-tight">Foundersales</span>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 py-2 border-b border-surface-border shrink-0">
        <button
          onClick={() => setWorkspacesOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors text-left"
        >
          <div className="w-5 h-5 rounded bg-brand-100 flex items-center justify-center text-brand shrink-0">
            <Building2 size={11} />
          </div>
          <span className="flex-1 text-xs font-medium text-text-primary truncate">
            {activeWorkspace?.name ?? 'Select workspace'}
          </span>
          <ChevronDown size={12} className={cn('text-text-muted transition-transform', workspacesOpen && 'rotate-180')} />
        </button>

        {workspacesOpen && workspacesData && (
          <div className="mt-1 space-y-0.5">
            {workspacesData.map((ws) => (
              <button
                key={ws.id}
                disabled={isSwitching}
                onClick={async () => {
                  if (ws.id !== activeWorkspace?.id) await switchWorkspace(ws.id);
                  setWorkspacesOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left',
                  ws.id === activeWorkspace?.id
                    ? 'bg-brand-50 text-brand'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                {isSwitching ? <RefreshCw size={10} className="animate-spin" /> : null}
                <span className="truncate">{ws.name}</span>
                {ws.id === activeWorkspace?.id && (
                  <span className="ml-auto text-[9px] bg-brand text-white px-1 rounded">Active</span>
                )}
              </button>
            ))}
            <button
              onClick={() => { navigate(ROUTES.WORKSPACES); setWorkspacesOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-text-muted hover:bg-surface-hover transition-colors"
            >
              + New workspace
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <NavItem to={ROUTES.HOME} icon={<LayoutDashboard size={16} />} label="Home" end onClick={onNavigate} />
        <NavItem to={ROUTES.OPPORTUNITIES} icon={<Zap size={16} />} label="Opportunities" onClick={onNavigate} />
        <NavItem to={ROUTES.PIPELINE} icon={<Layers size={16} />} label="Pipeline" badge={pendingFeedbackCount} onClick={onNavigate} />
        <NavItem to={ROUTES.PRACTICE} icon={<Dumbbell size={16} />} label="Practice" onClick={onNavigate} />
        <NavItem to={ROUTES.CHAT} icon={<MessageCircle size={16} />} label="Chat" onClick={onNavigate} />

        <SectionLabel>CRM</SectionLabel>
        <NavItem to={ROUTES.CALENDAR} icon={<Calendar size={16} />} label="Calendar" badge={calendarAlertCount} onClick={onNavigate} />
        <NavItem to={ROUTES.PROSPECTS} icon={<Users size={16} />} label="Prospects" onClick={onNavigate} />
        <NavItem to={ROUTES.GOALS} icon={<Target size={16} />} label="Goals" onClick={onNavigate} />
        <NavItem to={ROUTES.FOLLOWUP} icon={<Send size={16} />} label="Follow-up" badge={followupUnviewedCount} onClick={onNavigate} />
        <NavItem to={ROUTES.COMMITMENTS} icon={<CheckSquare size={16} />} label="Commitments" onClick={onNavigate} />

        <SectionLabel>Insights</SectionLabel>
        <NavItem to={ROUTES.GROWTH} icon={<TrendingUp size={16} />} label="Growth" onClick={onNavigate} />
        <NavItem to={ROUTES.INSIGHTS} icon={<BarChart2 size={16} />} label="Insights" onClick={onNavigate} />
        <NavItem to={ROUTES.METRICS} icon={<Activity size={16} />} label="Metrics" onClick={onNavigate} />

        {isManager && (
          <>
            <SectionLabel>Team</SectionLabel>
            <button
              onClick={() => setTeamExpanded((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
            >
              <Shield size={16} className="shrink-0" />
              <span className="flex-1 text-left">Team</span>
              <ChevronRight size={13} className={cn('transition-transform', teamExpanded && 'rotate-90')} />
            </button>
            {teamExpanded && (
              <div className="ml-4 space-y-0.5">
                <NavItem to={ROUTES.TEAM_METRICS}    icon={<Gauge size={14} />}     label="Metrics"     onClick={onNavigate} />

                <NavItem to={ROUTES.TEAM_PIPELINE}    icon={<Layers size={14} />}    label="Pipeline"     onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_OPPS}        icon={<Zap size={14} />}       label="Opportunities" onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_INSIGHTS}    icon={<BarChart2 size={14} />} label="Insights"     onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_ANALYTICS}   icon={<Activity size={14} />}  label="Analytics"    onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_LEADERBOARD} icon={<TrendingUp size={14} />}label="Leaderboard"  onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_COACHING}    icon={<Users size={14} />}     label="Coaching"     onClick={onNavigate} />
                <NavItem to={ROUTES.TEAM_ACTIVITY}    icon={<Activity size={14} />}  label="Activity"     onClick={onNavigate} />
              </div>
            )}
          </>
        )}

        <SectionLabel>Account</SectionLabel>
        <NavItem to={ROUTES.WORKSPACES} icon={<Building2 size={16} />} label="Workspaces" onClick={onNavigate} />
        <NavItem to={ROUTES.SETTINGS}   icon={<Settings size={16} />}  label="Settings"   onClick={onNavigate} />
      </nav>

      {/* User row */}
      <div className="shrink-0 border-t border-surface-border px-3 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user?.name} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-primary truncate">{user?.name ?? user?.email}</p>
            <p className="text-[10px] text-text-muted capitalize">{user?.tier} plan</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-text-muted hover:text-danger transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
