"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Button, ErrorBanner, Textarea } from "@/components/admin/ui";
import { fetchSoul, updateAssistantContent } from "@/lib/assistants-client";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  open: boolean;
  onClose: () => void;
  // Personality to edit; null while closed.
  assistantId: string | null;
  // Admin surface edits any tier via the admin endpoints; the user surface
  // edits own personal personalities only.
  admin?: boolean;
  onSaved: () => void;
}

/**
 * Edit a personality after creation by editing its SOUL.md directly —
 * frontmatter (name, description, starters, collection) re-derives on save,
 * so adjusting the example questions is just editing the `starters:` list.
 */
export default function SoulEditModal({
  open,
  onClose,
  assistantId,
  admin = false,
  onSaved,
}: Props) {
  useLocale();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !assistantId) return;
    setLoading(true);
    setError(null);
    setContent("");
    fetchSoul(assistantId, admin)
      .then((a) => {
        setContent(a.soul);
        setName(a.name);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("failedToLoad"))
      )
      .finally(() => setLoading(false));
  }, [open, assistantId, admin]);

  async function save() {
    if (!assistantId || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateAssistantContent(assistantId, content, admin);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("soulEditTitle")}${name ? `: ${name}` : ""}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={loading || saving || !content.trim()}>
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} />
        {loading ? (
          <p className="text-[13px]" style={{ color: "var(--fg2)" }}>
            {t("loading")}
          </p>
        ) : (
          <>
            <Textarea
              label={t("soulContentLabel")}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              maxLength={64_000}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fieldSizing: "content",
                minHeight: "240px",
              } as React.CSSProperties}
            />
            <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
              {t("soulEditHint")}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
