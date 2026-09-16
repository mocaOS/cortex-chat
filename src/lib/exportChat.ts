import { ChatMessage, ChatSession } from "@/types";
import { t } from "@/lib/i18n";

// Render one message as a Markdown block: a role heading, the content verbatim
// (citation markers like [src_N] are left in place), and — for answers — a
// numbered footnote list of the cited sources so the block is self-contained.
function messageLines(m: ChatMessage): string[] {
  const lines: string[] = [
    m.role === "user" ? `## ${t("exportRoleUser")}` : `## ${t("exportRoleAssistant")}`,
    "",
    m.content.trim(),
  ];
  if (m.role === "assistant" && m.sources?.length) {
    lines.push("");
    lines.push(`**${t("sources")}**`);
    m.sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.metadata.filename}`);
    });
  }
  return lines;
}

// Build a readable Markdown transcript of a chat session.
export function chatToMarkdown(session: ChatSession): string {
  const lines: string[] = [`# ${session.title || t("untitledChat")}`, ""];
  for (const m of session.messages ?? []) {
    lines.push(...messageLines(m), "");
  }
  return lines.join("\n");
}

// A single message in the same format as the full transcript (one section).
export function messageToMarkdown(message: ChatMessage): string {
  return messageLines(message).join("\n") + "\n";
}

// Filesystem-safe basename derived from free text (title or message opening).
function safeFilename(text: string, fallback: string): string {
  return (
    text
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || fallback
  );
}

function triggerDownload(name: string, markdown: string): void {
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

export function downloadChatMarkdown(session: ChatSession): void {
  triggerDownload(
    safeFilename(session.title || t("untitledChat"), "chat"),
    chatToMarkdown(session)
  );
}

// Download one message as its own .md file. The filename comes from the first
// line of the message so several downloads from one chat stay tellable apart.
export function downloadMessageMarkdown(message: ChatMessage): void {
  const firstLine = message.content.trim().split("\n")[0] ?? "";
  triggerDownload(
    safeFilename(firstLine, message.role === "user" ? "question" : "answer"),
    messageToMarkdown(message)
  );
}
