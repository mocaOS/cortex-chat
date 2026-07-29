"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatSession, ProjectInfo } from "@/types";
import { CurrentUser } from "@/types/auth";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onExportSession?: (id: string) => void;
  // Team projects — collapsible folders above the flat chat list.
  projects?: ProjectInfo[];
  onNewProject?: () => void;
  onEditProject?: (project: ProjectInfo) => void;
  onShareProject?: (project: ProjectInfo) => void;
  onDeleteProject?: (project: ProjectInfo) => void;
  onNewChatInProject?: (project: ProjectInfo) => void;
  // Drag & drop: move an own chat into a project (or null = flat list).
  onMoveChatToProject?: (chatId: string, projectId: string | null) => void;
  logoUrl: string;
  currentUser?: CurrentUser | null;
  onSignOut?: () => void;
}

const DRAG_MIME = "application/x-cortex-chat-id";

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

  // Pinned chats form their own group above the time-grouped rest.
  const pinned = sessions.filter((s) => s.pinned);
  if (pinned.length > 0) {
    groups.push({ label: t("pinned"), sessions: pinned });
  }

  for (const s of sessions) {
    if (s.pinned) continue;
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
  onTogglePin,
  onExportSession,
  projects,
  onNewProject,
  onEditProject,
  onShareProject,
  onDeleteProject,
  onNewChatInProject,
  onMoveChatToProject,
  logoUrl,
  currentUser,
  onSignOut,
}: Props) {
  useLocale();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Current drop target while dragging a chat: project id or "flat".
  const [dragOver, setDragOver] = useState<string | null>(null);

  const dragProps = (chatId: string) =>
    onMoveChatToProject
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG_MIME, chatId);
            e.dataTransfer.effectAllowed = "move";
          },
        }
      : {};

  const dropProps = (target: string, projectId: string | null) =>
    onMoveChatToProject
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOver(target);
          },
          onDragLeave: () => setDragOver((cur) => (cur === target ? null : cur)),
          onDrop: (e: React.DragEvent) => {
            const chatId = e.dataTransfer.getData(DRAG_MIME);
            setDragOver(null);
            if (chatId) {
              e.preventDefault();
              onMoveChatToProject(chatId, projectId);
            }
          },
        }
      : {};
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter((s) =>
        (s.title || t("untitledChat")).toLowerCase().includes(q)
      )
    : sessions;
  const groups = groupSessions(filtered);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 transition-opacity"
          style={{ background: "oklch(0 0 0 / 0.55)" }}
          onClick={onClose}
        />
      )}

      {/* Sidebar panel — glass per MOCA sidebar pattern */}
      <div
        className={`fixed top-0 left-0 h-full w-72 z-50 flex flex-col transition-transform duration-200 ease-out border-r ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          background: "oklch(0.17 0 0 / 0.85)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderColor: "var(--border)",
        }}
      >
        {/* Header with logo and close */}
        <div
          className="flex items-center justify-between px-4 h-14 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <img src={logoUrl} alt="Logo" className="h-6 w-auto" />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[var(--radius)] flex items-center justify-center text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
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
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius)] border text-sm transition-colors"
            style={{
              borderColor: "var(--border)",
              color: "var(--fg1)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {t("newChat")}
          </button>

          {/* Title search */}
          <div
            className="mt-2 flex items-center gap-2 rounded-[var(--radius)] border px-2.5 h-8"
            style={{ borderColor: "var(--border)", background: "transparent" }}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg3)" }}>
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchChats")}
              className="flex-1 bg-transparent outline-none text-[12.5px] text-[var(--fg1)] placeholder:text-[var(--fg3)] min-w-0"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="flex-shrink-0"
                style={{ color: "var(--fg3)" }}
                aria-label={t("close")}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {/* Projects — collapsible team folders above the personal list */}
          {(projects?.length || onNewProject) && !q ? (
            <div className="mb-3">
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span
                  className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--fg3)" }}
                >
                  {t("projects")}
                </span>
                {onNewProject && (
                  <button
                    onClick={onNewProject}
                    className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                    style={{ color: "var(--fg3)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--fg1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--fg3)";
                    }}
                    title={t("projectNew")}
                    aria-label={t("projectNew")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                )}
              </div>
              {projects?.map((project) => {
                const isOpen = expanded.has(project.id);
                return (
                  <div key={project.id}>
                    <div
                      className="group flex items-center rounded-[var(--radius)] px-2.5 py-2 cursor-pointer transition-colors"
                      style={{
                        background:
                          dragOver === project.id ? "var(--muted)" : "transparent",
                        outline:
                          dragOver === project.id
                            ? "1px dashed var(--ring)"
                            : "none",
                        outlineOffset: -1,
                      }}
                      onMouseEnter={(e) => {
                        if (dragOver !== project.id)
                          e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                      }}
                      onMouseLeave={(e) => {
                        if (dragOver !== project.id)
                          e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => toggleExpanded(project.id)}
                      {...dropProps(project.id, project.id)}
                    >
                      <svg
                        className={`w-3 h-3 mr-1.5 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: "var(--fg3)" }}
                      >
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                      <svg className="w-3.5 h-3.5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg2)" }}>
                        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                      </svg>
                      <span
                        className="flex-1 text-[13px] truncate"
                        style={{ color: "var(--fg1)" }}
                      >
                        {project.name}
                      </span>
                      {onNewChatInProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNewChatInProject(project);
                            onClose();
                          }}
                          className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                          style={{ color: "var(--fg3)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--fg1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--fg3)";
                          }}
                          title={t("projectNewChat")}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                      )}
                      {project.isOwner && onShareProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onShareProject(project);
                          }}
                          className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                          style={{ color: "var(--fg3)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--fg1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--fg3)";
                          }}
                          title={t("projectShare")}
                        >
                          {/* users icon — this is an internal team share */}
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </button>
                      )}
                      {project.isOwner && onEditProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProject(project);
                          }}
                          className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                          style={{ color: "var(--fg3)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--fg1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--fg3)";
                          }}
                          title={t("projectEdit")}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                      )}
                      {project.isOwner && onDeleteProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(project);
                          }}
                          className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                          style={{ color: "var(--fg3)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--destructive)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--fg3)";
                          }}
                          title={t("projectDelete")}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <div className="ml-5 border-l pl-1.5" style={{ borderColor: "var(--border)" }}>
                        {project.chats.length === 0 && (
                          <p className="px-2.5 py-1.5 text-[11.5px]" style={{ color: "var(--fg3)" }}>
                            {t("projectNoChats")}
                          </p>
                        )}
                        {project.chats.map((chat) => {
                          const active = chat.id === activeSessionId;
                          return (
                            <div
                              key={chat.id}
                              className="flex items-center rounded-[var(--radius)] px-2.5 py-1.5 cursor-pointer transition-colors"
                              style={{ background: active ? "var(--muted)" : "transparent" }}
                              {...(chat.isOwn ? dragProps(chat.id) : {})}
                              onMouseEnter={(e) => {
                                if (!active)
                                  e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                              }}
                              onMouseLeave={(e) => {
                                if (!active) e.currentTarget.style.background = "transparent";
                              }}
                              onClick={() => {
                                onSelectSession(chat.id);
                                onClose();
                              }}
                            >
                              <span
                                className="flex-1 text-[12.5px] truncate"
                                style={{ color: "var(--fg1)" }}
                              >
                                {chat.title || t("untitledChat")}
                              </span>
                              {!chat.isOwn && (
                                <span
                                  className="text-[10px] truncate max-w-[80px] flex-shrink-0 ml-1.5"
                                  style={{ color: "var(--fg3)", fontFamily: "var(--font-mono)" }}
                                  title={chat.authorName}
                                >
                                  {chat.authorName}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Flat personal list — also the drop target for dragging a chat
              OUT of a project. min-h keeps it droppable when empty. */}
          <div
            className="min-h-[80px] rounded-[var(--radius)]"
            style={{
              outline: dragOver === "flat" ? "1px dashed var(--ring)" : "none",
              outlineOffset: -1,
            }}
            {...dropProps("flat", null)}
          >
          {q && filtered.length === 0 && (
            <p
              className="px-2.5 py-2 text-[12px]"
              style={{ color: "var(--fg3)" }}
            >
              {t("noChatsFound")}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div
                className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg3)" }}
              >
                {group.label}
              </div>
              {group.sessions.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <div
                    key={session.id}
                    className="group flex items-center rounded-[var(--radius)] px-2.5 py-2 cursor-pointer transition-colors"
                    style={{
                      background: active ? "var(--muted)" : "transparent",
                    }}
                    {...dragProps(session.id)}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = "transparent";
                    }}
                    onClick={() => {
                      onSelectSession(session.id);
                      onClose();
                    }}
                  >
                    <span
                      className="flex-1 text-[13px] truncate"
                      style={{ color: active ? "var(--fg1)" : "var(--fg1)" }}
                    >
                      {session.title || t("untitledChat")}
                    </span>
                    {onTogglePin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(session.id, !session.pinned);
                        }}
                        className={`${
                          session.pinned
                            ? ""
                            : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
                        } w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all`}
                        style={{ color: session.pinned ? "var(--fg2)" : "var(--fg3)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "var(--fg1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = session.pinned
                            ? "var(--fg2)"
                            : "var(--fg3)";
                        }}
                        title={session.pinned ? t("unpinChat") : t("pinChat")}
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill={session.pinned ? "currentColor" : "none"}
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 17v5" />
                          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                        </svg>
                      </button>
                    )}
                    {onExportSession && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onExportSession(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                        style={{ color: "var(--fg3)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "var(--fg1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "var(--fg3)";
                        }}
                        title={t("exportChat")}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="M7 10l5 5 5-5" />
                          <path d="M12 15V3" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded transition-all"
                      style={{ color: "var(--fg3)" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--destructive)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--fg3)";
                      }}
                      title={t("deleteChat")}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </div>

        {currentUser && (
          <div
            className="border-t px-2 py-2 space-y-0.5"
            style={{ borderColor: "var(--border)" }}
          >
            <SidebarNavLink
              href="/profile"
              label={t("profile")}
              onNav={onClose}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
                </svg>
              }
              rightSlot={
                <span
                  className="text-[11px] truncate max-w-[120px]"
                  style={{
                    color: "var(--fg2)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
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
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2v-4" />
                    <path d="M17 8l-5 -5l-5 5" />
                    <path d="M12 3v12" />
                  </svg>
                }
              />
            )}
            {(currentUser.role === "superadmin" ||
              currentUser.role === "admin") && (
              <SidebarNavLink
                href="/admin"
                label={t("admin")}
                onNav={onClose}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                }
              />
            )}
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors"
              style={{ color: "var(--fg2)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--fg1)";
                e.currentTarget.style.background = "var(--muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--fg2)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2h4" />
                <path d="M16 17l5 -5l-5 -5" />
                <path d="M21 12H9" />
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
      className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors"
      style={{ color: "var(--fg1)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--muted)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {rightSlot}
    </Link>
  );
}
