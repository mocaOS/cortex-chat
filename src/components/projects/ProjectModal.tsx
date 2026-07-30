"use client";

import { useEffect, useState } from "react";
import { AssistantSummary, Collection, ProjectInfo } from "@/types";
import Modal from "@/components/admin/Modal";
import { Button, ErrorBanner, Input, Select, Textarea } from "@/components/admin/ui";
import { createProject, updateProject } from "@/lib/projects-client";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  open: boolean;
  onClose: () => void;
  // Present = edit mode; absent = create.
  project?: ProjectInfo | null;
  assistants: AssistantSummary[];
  collections: Collection[];
  onSaved: () => void;
}

export default function ProjectModal({
  open,
  onClose,
  project,
  assistants,
  collections,
  onSaved,
}: Props) {
  useLocale();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setInstructions(project?.instructions ?? "");
      setAssistantId(project?.assistantId ?? "");
      setCollectionId(project?.collectionId ?? "");
      setError(null);
    }
  }, [open, project]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        instructions,
        assistantId: assistantId || null,
        collectionId: collectionId || null,
      };
      if (project) {
        await updateProject(project.id, payload);
      } else {
        await createProject(payload);
      }
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
      title={project ? t("projectEditTitle") : t("projectNewTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={!name.trim() || saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <Input
          label={t("projectNameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder={t("projectNamePlaceholder")}
          autoFocus
        />
        <Select
          label={t("projectSoulLabel")}
          value={assistantId}
          onChange={(e) => setAssistantId(e.target.value)}
        >
          <option value="">{t("soulDefault")}</option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          label={t("projectCollectionLabel")}
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
        >
          <option value="">{t("allCollections")}</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Textarea
          label={t("projectInstructionsLabel")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder={t("projectInstructionsPlaceholder")}
        />
        <p className="text-[11.5px] -mt-2" style={{ color: "var(--fg2)" }}>
          {t("projectInstructionsHint")}
        </p>
      </div>
    </Modal>
  );
}
