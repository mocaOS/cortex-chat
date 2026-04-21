"use client";

import Link from "next/link";
import { ChatSession } from "@/types";
import { CurrentUser } from "@/types/auth";
import { t } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  logoUrl: string;
  currentUser?: CurrentUser | null;
  onSignOut?: () => void;
}

function timeLabel(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOf7DaysAgo = startOfToday - 7 * 86400000;

  if (ts >= startOfToday) return t("today");
  if (ts >= startOfYesterday) return t("yesterday");
  if (ts >= startOf7DaysAgo) return t("previous7Days");
  return t("older");
}

function groupSessions(sessions: ChatSession[]) {
  const groups: { label: string; sessions: ChatSession[] }[] = [];
  const map = new Map<string, ChatSession[]>();

  for (const s of sessions) {
    const label = timeLabel(s.updatedAt);
    if (!map.has(label)) {
      map.set(label, []);
      groups.push({ label, sessions: map.get(label)! });
    }
    map.get(label)!.push(s);
  }

  return groups;
}

export default function Sidebar({
  open,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  logoUrl,
  currentUser,
  onSignOut,
}: Props) {
  const groups = groupSessions(sessions);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={`fixed top-0 left-0 h-full w-72 bg-[var(--bg-secondary)] z-50 flex flex-col transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header with logo and close */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <img src={logoUrl} alt="Logo" className="h-7 w-auto" />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-3">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            {t("newChat")}
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                {group.label}
              </div>
              {group.sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                    session.id === activeSessionId
                      ? "bg-[var(--bg-tertiary)]"
                      : "hover:bg-[var(--bg-tertiary)]/50"
                  }`}
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                >
                  <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                    {session.title || t("untitledChat")}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-red-400 transition-all"
                    title={t("deleteChat")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        {currentUser && (
          <div className="border-t border-[var(--border)] px-2 py-2 space-y-0.5">
            <SidebarNavLink
              href="/profile"
              label={t("profile")}
              onNav={onClose}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              rightSlot={
                <span className="text-xs text-[var(--text-secondary)] truncate max-w-[120px]">
                  {currentUser.username || currentUser.email}
                </span>
              }
            />
            {currentUser.canUpload && (
              <SidebarNavLink
                href="/upload"
                label={t("uploadDocuments")}
                onNav={onClose}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                }
              />
            )}
            {currentUser.role === "superadmin" && (
              <SidebarNavLink
                href="/admin"
                label={t("admin")}
                onNav={onClose}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                }
              />
            )}
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="flex-1 text-left">{t("signOut")}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SidebarNavLink({
  href,
  label,
  icon,
  onNav,
  rightSlot,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onNav?: () => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNav}
      className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {rightSlot}
    </Link>
  );
}
