const translations = {
  en: {
    askAi: "Ask AI",
    askAnything: "Ask anything...",
    deepResearchPlaceholder: "Ask a complex question for deep research...",
    chat: "Chat",
    deepResearch: "Deep Research",
    newChat: "New Chat",
    settings: "Settings",
    streamResponses: "Stream responses",
    collectionScope: "Collection scope",
    allCollections: "All collections",
    docs: "docs",
    thinking: "Thinking",
    steps: "steps",
    researchAreas: "Research areas:",
    relevance: "Relevance",
    rerank: "Rerank",
    emptyTitle: "Ask AI",
    emptyDescription:
      "Ask anything about your knowledge base. Switch to Deep Research for complex multi-step questions.",
    today: "Today",
    yesterday: "Yesterday",
    previous7Days: "Previous 7 Days",
    older: "Older",
    deleteChat: "Delete chat",
    untitledChat: "New Chat",
    researching: "Researching...",
    searchingKnowledge: "Searching knowledge base...",
    generatingResponse: "Generating response...",
    searchingAllCollections: "Searching across all collections",
    searchingInCollection: "Searching in:",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
    loginFailed: "Sign in failed",
    profile: "Profile",
    uploadDocuments: "Upload documents",
    admin: "Admin",
    noGroupAssigned:
      "Your account has no group assigned. Ask an administrator to place you in a group to start chatting.",
  },
  de: {
    askAi: "KI fragen",
    askAnything: "Frag etwas...",
    deepResearchPlaceholder: "Stelle eine komplexe Frage für Deep Research...",
    chat: "Chat",
    deepResearch: "Deep Research",
    newChat: "Neuer Chat",
    settings: "Einstellungen",
    streamResponses: "Antworten streamen",
    collectionScope: "Sammlungsbereich",
    allCollections: "Alle Sammlungen",
    docs: "Dok.",
    thinking: "Denkt nach",
    steps: "Schritte",
    researchAreas: "Recherchebereiche:",
    relevance: "Relevanz",
    rerank: "Rerank",
    emptyTitle: "KI fragen",
    emptyDescription:
      "Stelle deine Fragen an die Knowledge Base. Wechsle zu Deep Research für komplexere Anfragen.",
    today: "Heute",
    yesterday: "Gestern",
    previous7Days: "Letzte 7 Tage",
    older: "Älter",
    deleteChat: "Chat löschen",
    untitledChat: "Neuer Chat",
    researching: "Recherchiert...",
    searchingKnowledge: "Durchsuche Wissensdatenbank...",
    generatingResponse: "Antwort wird generiert...",
    searchingAllCollections: "Suche in allen Sammlungen",
    searchingInCollection: "Suche in:",
    email: "E-Mail",
    password: "Passwort",
    signIn: "Anmelden",
    signingIn: "Melde an…",
    signOut: "Abmelden",
    loginFailed: "Anmeldung fehlgeschlagen",
    profile: "Profil",
    uploadDocuments: "Dokumente hochladen",
    admin: "Admin",
    noGroupAssigned:
      "Deinem Konto ist keine Gruppe zugewiesen. Bitte einen Administrator, dich einer Gruppe hinzuzufügen, um zu chatten.",
  },
} as const;

export type Locale = keyof typeof translations;
export type TranslationKey = keyof (typeof translations)["en"];

let currentLocale: Locale = "en";

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey): string {
  return translations[currentLocale][key] || translations.en[key] || key;
}
