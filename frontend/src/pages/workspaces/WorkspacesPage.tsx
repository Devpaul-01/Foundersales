import React, { useState } from 'react';
import { Building2, Plus, CheckCircle2, LogIn, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Static demo data                                                   */
/*  (Replaces workspacesApi/useQuery/useWorkspace/etc. for the demo.   */
/*   No network calls — everything below is hardcoded.)                */
/* ------------------------------------------------------------------ */

type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: 'Free' | 'Pro' | 'Business' | 'Enterprise';
  role: 'Owner' | 'Admin' | 'Member';
  created_at: string;
};

const WORKSPACES: Workspace[] = [
  {
    id: 'ws_northwind',
    name: 'Northwind Studio',
    slug: 'northwind-studio',
    plan: 'Business',
    role: 'Owner',
    created_at: '2023-02-14',
  },
  {
    id: 'ws_lumen',
    name: 'Lumen Analytics',
    slug: 'lumen-analytics',
    plan: 'Pro',
    role: 'Admin',
    created_at: '2023-09-01',
  },
  {
    id: 'ws_pinecrest',
    name: 'Pinecrest Collective',
    slug: 'pinecrest-collective',
    plan: 'Free',
    role: 'Member',
    created_at: '2024-05-22',
  },
  {
    id: 'ws_atlas',
    name: 'Atlas & Co.',
    slug: 'atlas-co',
    plan: 'Enterprise',
    role: 'Owner',
    created_at: '2022-11-30',
  },
];

const ACTIVE_WORKSPACE_ID = 'ws_northwind';

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function planBadgeClasses(plan: Workspace['plan']) {
  switch (plan) {
    case 'Enterprise':
      return 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200';
    case 'Business':
      return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200';
    case 'Pro':
      return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200';
    default:
      return 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200';
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function WorkspacesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(ACTIVE_WORKSPACE_ID);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  React.useEffect(() => {
    const derived = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    setSlug(derived);
  }, [name]);

  const handleSwitch = (wsId: string) => {
    if (wsId === activeId) return;
    setSwitchingId(wsId);
    // Simulate a brief, purely-local transition — no network call.
    window.setTimeout(() => {
      setActiveId(wsId);
      setSwitchingId(null);
    }, 550);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateOpen(false);
    setName('');
    setSlug('');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        {/* Logo */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto shadow-sm shadow-indigo-200">
            <Building2 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-3">Your workspaces</h1>
          <p className="text-sm text-gray-500 mt-1">Select a workspace to continue.</p>
        </div>

        {/* Workspace list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {WORKSPACES.map((ws) => {
            const isActive = ws.id === activeId;
            const switching = switchingId === ws.id;
            return (
              <button
                key={ws.id}
                onClick={() => handleSwitch(ws.id)}
                disabled={!!switchingId}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-200 last:border-0 transition-colors text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm shrink-0">
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ws.name}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                        planBadgeClasses(ws.plan)
                      )}
                    >
                      {ws.plan}
                    </span>
                    <span className="text-xs text-gray-500">
                      {ws.role} · {formatShortDate(ws.created_at)}
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  {switching ? (
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-600 animate-spin" />
                  ) : isActive ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : (
                    <LogIn size={14} className="text-gray-400" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
        >
          <Plus size={14} />
          Create new workspace
        </button>
      </div>

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setCreateOpen(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-xl shadow-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Create workspace</h2>
              <button
                onClick={() => setCreateOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Workspace name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Acme Corp"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slug (URL-friendly)
                </label>
                <input
                  type="text"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">Used in URLs — auto-generated from name.</p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
