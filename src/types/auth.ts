export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  role: "user" | "superadmin";
  group: { id: string; name: string; description: string } | null;
  canUpload: boolean;
}
