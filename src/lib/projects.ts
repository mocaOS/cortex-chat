import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  chatSessions,
  projects,
  projectShares,
  users,
  groups,
  type ChatSessionRow,
  type Project,
  type User,
} from "@/lib/db/schema";

/** Owner or covered by a share (direct user grant or the user's group). */
export function isProjectMember(user: User, project: Project): boolean {
  if (project.ownerId === user.id) return true;
  const share = db
    .select({ id: projectShares.id })
    .from(projectShares)
    .where(
      and(
        eq(projectShares.projectId, project.id),
        or(
          eq(projectShares.userId, user.id),
          user.groupId ? eq(projectShares.groupId, user.groupId) : eq(projectShares.id, "")
        )
      )
    )
    .get();
  return !!share;
}

export function getAccessibleProject(user: User, id: string): Project | null {
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return null;
  return isProjectMember(user, project) ? project : null;
}

/** All projects the user owns or is shared into, newest first. */
export function listAccessibleProjects(user: User): Project[] {
  const shareRows = db
    .select({ projectId: projectShares.projectId })
    .from(projectShares)
    .where(
      or(
        eq(projectShares.userId, user.id),
        user.groupId ? eq(projectShares.groupId, user.groupId) : eq(projectShares.id, "")
      )
    )
    .all();
  const sharedIds = [...new Set(shareRows.map((r) => r.projectId))];

  const rows = db
    .select()
    .from(projects)
    .where(
      sharedIds.length > 0
        ? or(eq(projects.ownerId, user.id), inArray(projects.id, sharedIds))
        : eq(projects.ownerId, user.id)
    )
    .all();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Read access to a chat: its author, or any member of the project it lives
 * in. Write access (continue/rename/delete) remains author-only — enforced
 * by the callers.
 */
export function canReadChatSession(user: User, session: ChatSessionRow): boolean {
  if (session.userId === user.id) return true;
  if (!session.projectId) return false;
  return !!getAccessibleProject(user, session.projectId);
}

export interface ProjectShareInfo {
  id: string;
  groupId: string | null;
  groupName: string | null;
  userId: string | null;
  userEmail: string | null;
  username: string | null;
}

export function listProjectShares(projectId: string): ProjectShareInfo[] {
  return db
    .select({
      id: projectShares.id,
      groupId: projectShares.groupId,
      groupName: groups.name,
      userId: projectShares.userId,
      userEmail: users.email,
      username: users.username,
    })
    .from(projectShares)
    .leftJoin(groups, eq(groups.id, projectShares.groupId))
    .leftJoin(users, eq(users.id, projectShares.userId))
    .where(eq(projectShares.projectId, projectId))
    .all();
}

export interface ProjectChatInfo {
  id: string;
  title: string;
  updatedAt: number;
  authorId: string;
  authorName: string;
  isOwn: boolean;
}

/** Every chat in the project, all members' — newest first, with author info. */
export function listProjectChats(projectId: string, viewerId: string): ProjectChatInfo[] {
  const rows = db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      updatedAt: chatSessions.updatedAt,
      authorId: chatSessions.userId,
      email: users.email,
      username: users.username,
    })
    .from(chatSessions)
    .leftJoin(users, eq(users.id, chatSessions.userId))
    .where(eq(chatSessions.projectId, projectId))
    .all();
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt,
      authorId: r.authorId,
      authorName: r.username || r.email || "?",
      isOwn: r.authorId === viewerId,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
