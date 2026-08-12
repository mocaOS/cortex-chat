export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  role: "user" | "admin" | "superadmin";
  group: { id: string; name: string; description: string } | null;
  canUpload: boolean;
  // True for the shared demo-mode account: chats live in localStorage and
  // per-user account surfaces (profile, personal souls, projects) are hidden.
  demo?: boolean;
}
