import { ChatSession } from "@/types";
import { t } from "@/lib/i18n";

// Build a readable Markdown transcript of a chat session. Citation markers
// ([src_N]) are left as-is in the text; each answer's sources are listed as a
// numbered footnote block so the export is self-contained.
export function chatToMarkdown(session: ChatSession): string {
  const lines: string[] = [`# ${session.title || t("untitledChat")}`, ""];
  for (const m of session.messages ?? []) {
    lines.push(
      m.role === "user" ? `## ${t("exportRoleUser")}` : `## ${t("exportRoleAssistant")}`
    );
    lines.push("");
    lines.push(m.content.trim());
    if (m.role === "assistant" && m.sources?.length) {
      lines.push("");
      lines.push(`**${t("sources")}**`);
      m.sources.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.metadata.filename}`);
      });
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadChatMarkdown(session: ChatSession): void {
  const markdown = chatToMarkdown(session);
  const name =
    (session.title || t("untitledChat"))
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 60) || "chat";
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
