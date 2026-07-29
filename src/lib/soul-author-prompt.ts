import "server-only";
import type { ChatMessage } from "@/lib/personality-llm";

// Prompts for the personality Generate flow. Architecture borrowed from
// soulweaver: Cortex answers BENIGN research questions (instruction-shaped
// meta-prompts trip its injection defense — instant canned deflection), and
// the SOUL.md is written by a direct LLM call with the findings inlined.
// Server-side only — like email templates, never in i18n.ts.

/** Plain questions Cortex will happily answer — one round-trip each. */
export function buildResearchQuestions(userPrompt: string): string[] {
  const questions = [
    "What is this knowledge base about? Summarize the main topics, projects, organizations and important names it covers.",
    "What kinds of documents does this knowledge base contain, and what questions is it best suited to answer?",
  ];
  // One question targeted at the user's described role — phrased as a
  // question ABOUT the material, not as instructions.
  const topic = userPrompt.replace(/\s+/g, " ").trim().slice(0, 300);
  if (topic) {
    questions.push(
      `Which topics, documents and concrete examples in this knowledge base are most relevant for the following purpose: "${topic}"?`
    );
  }
  return questions;
}

/** Keyword searches for raw snippet context (hybrid search, no LLM). */
export function buildResearchSearchQueries(userPrompt: string): string[] {
  const words = userPrompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(" ");
  const queries = ["overview main topics themes"];
  if (words) queries.push(words);
  return queries;
}

// The Cortex backend answers unanswerable/deflected queries with canned
// text — detect those so they never pollute the findings (soulweaver's
// isKbSilentOrRefusal, adapted).
export function isUsableAnswer(answer: string | undefined | null): boolean {
  const text = (answer ?? "").trim();
  if (text.length < 60) return false;
  return !/^(i'?m here to help|i can only|i'?m sorry|i cannot|kb_silent)/i.test(text);
}

export interface ResearchFindings {
  answers: { question: string; answer: string }[];
  snippets: string[];
}

function findingsBlock(findings: ResearchFindings): string {
  const parts: string[] = [];
  for (const { question, answer } of findings.answers) {
    parts.push(`### ${question}\n${answer.slice(0, 1500)}`);
  }
  if (findings.snippets.length > 0) {
    parts.push(
      `### Raw excerpts from the knowledge base\n${findings.snippets
        .map((s) => `- ${s.replace(/\s+/g, " ").slice(0, 300)}`)
        .join("\n")}`
    );
  }
  return parts.join("\n\n") || "(The knowledge base returned no usable findings.)";
}

const STRUCTURE_CONTRACT = `Write ONLY a complete SOUL.md file in Markdown — no preamble before it and no commentary after it. Structure:

1. YAML frontmatter delimited by --- lines containing exactly: "name:" (a short, characterful persona name — not a job title), "description:" (one line, max 120 characters), and "starters:" (a dash-list of 3-4 questions users of this assistant would actually ask about THIS knowledge base, phrased in the language the user's instructions are written in)
2. A "# <Name>" heading
3. "## Identity" — who this assistant is and its core nature
4. "## Purpose & Expertise" — what it helps with, naming the actual subject matter and document landscape from the research findings
5. "## Voice & Style" — concrete writing habits: tone, rhythm, structure, formatting, language
6. "## Behavioral Directives" — operational rules: cite sources, how to open an answer, what to do when the material is silent
7. "## Boundaries" — what it must never do (inventing facts, overpromising, going off-domain)`;

const QUALITY_BAR = `Quality bar — non-negotiable:
- FORBIDDEN: stock phrases ("You are a helpful assistant", "I'm here to help", "leverage", "delve"), vague filler ("various documents", "relevant information"), and any sentence that could appear in every persona ever written.
- Every section must contain at least one SPECIFIC detail from the research findings — a real name, a real document type, a real topic. Do not invent details that are not in the findings.
- The persona needs a distinctive, memorable character: a specific temperament, concrete verbal habits (sentence length, favorite constructions, what it never says), and opinions about how its work should be done.
- Behavioral directives must be operational, not aspirational: "Open with the answer, then cite" — not "be clear and concise".`;

/** Fresh generation: system carries craft + findings, user carries the brief. */
export function buildWriterMessages(
  userPrompt: string,
  findings: ResearchFindings
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are a SOUL file author. A SOUL file is a portable identity document for an AI assistant — it defines who the assistant IS: its purpose, expertise, voice, and behavioral patterns. It must be immediately usable by any AI framework.

## Knowledge-base research findings

The assistant will serve THIS knowledge base. Ground the persona in these findings — a reader should be able to tell which knowledge base this soul belongs to:

${findingsBlock(findings)}

${QUALITY_BAR}

${STRUCTURE_CONTRACT}`,
    },
    {
      role: "user",
      content: `PRIORITY GUIDANCE — these instructions carry the highest weight and must permeate every section. If they specify a language, tone, or ritual (like always ending with next steps), those must appear verbatim as behavioral directives:

${userPrompt}

Generate the complete SOUL.md now.`,
    },
  ];
}

/** Revision: the requested changes lead and must visibly land. */
export function buildRevisionMessages(
  userPrompt: string,
  previousDraft: string,
  refinement: string
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are a SOUL file editor. Apply requested changes to an existing SOUL.md decisively: rewrite every section the changes touch — the difference must be OBVIOUS — and keep untouched sections exactly as they are.

${QUALITY_BAR}

Output ONLY the complete revised SOUL.md — full file, same structure (frontmatter with name/description/starters, then the sections), no commentary about what changed.`,
    },
    {
      role: "user",
      content: `## Requested changes (highest priority)

${refinement}

## Existing SOUL file

${previousDraft}

## Original brief (context only — the requested changes win on any conflict)

${userPrompt}

Output the full revised SOUL.md now.`,
    },
  ];
}

