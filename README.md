# AI Research Assistant

Ein KI-gestützter Forschungsassistent als vollständig clientseitige Web-App.

## Features

- **Chat mit Agent-Loop**: Multi-Provider-Chat mit Tool-Orchestrierung, Streaming, und automatischem Fallback
- **34 Tools** (registriert in `src/services/tools/registerAll.ts`): Websuche/URL-Abruf, Nachrichten, Finanzen/Kurse, Wetter, Übersetzung, Rechner (sicherer Parser statt `eval`), Datenanalyse/Chart/Report, Datei-/CSV-Import (RFC 4180) & Export, Memory, Kalender/Termine (`calendar_create`/`calendar_list`/`calendar_remove`, lokal in IndexedDB mit Konfliktprüfung), Scheduler-Automation sowie Provider-abhängige Such-/News-/Finanz-Tools. Die Anzahl ist bewusst nicht als Fixwert dokumentiert – maßgeblich ist die Registry (`toolRegistry.getAll()`).
- **Workflow-Builder**: Visueller Editor für Tool-Ketten (Drag & Drop)
- **Scheduler**: Cron-artige geplante Aufgaben (vereinfachter 5-Felder-Cron: `*` oder Zahlen; keine Listen/Bereiche/`*/n`). Ein Scheduler-Consumer (`src/services/agent/schedulerConsumer.ts`, gestartet in `main.tsx`) arbeitet fällige Jobs alle 30s ab; Write-Guard blockiert Schreib-Tools in geplanten Läufen.
- **Lokale Persistenz**: Alle Daten in IndexedDB (Dexie), API-Keys nur im Browser
- **7 Modell-Slots**: 1 Primär + 6 Fallbacks mit automatischem Failover
- **TPM-Budget**: rollierendes 60-Sekunden-Fenster (kumulativ, kein harter Minuten-Reset) in `src/services/tpm/`

## Setup

### Voraussetzungen
- Node.js 18+
- Ein API-Key für mindestens einen Provider:
  - **Groq** (empfohlen): Kostenlos unter [console.groq.com](https://console.groq.com)
  - **OpenRouter**: Unter [openrouter.ai](https://openrouter.ai)
  - **Google Gemini**: Unter [aistudio.google.com](https://aistudio.google.com)
  - **LM Studio**: Lokal unter localhost:1234

### Installation

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Commands

| Befehl | Beschreibung |
|--------|-------------|
| `npm run dev` | Development-Server starten |
| `npm run build` | Produktions-Build |
| `npm run typecheck` | TypeScript-Prüfung |
| `node scripts/check-file-size.js` | Dateigrößen-Check (max 1000 Zeilen) |

Hinweis: Es ist aktuell kein Test-Runner konfiguriert (`npm test` existiert nicht);
Verifikation erfolgt über `typecheck`, `build` und den Dateigrößen-Check.

## Architektur

### Verzeichnisstruktur

```
src/
├── types/              # Typen & Zod-Schemas
├── services/
│   ├── db/             # Dexie/IndexedDB (pro Domain eine Datei)
│   ├── providers/      # Provider-Adapter (Adapter-Pattern)
│   ├── agent/          # Agent-Loop, Orchestrierung
│   ├── tools/          # Tool-Registry + Tool-Implementierungen
│   └── shared/         # Hilfsfunktionen
├── store/              # Zustand Stores
├── components/         # UI-Komponenten
└── pages/              # Seiten-Komposition
```

### Kern-Prinzipien

1. **Keine Datei > 1000 Zeilen** – Automatischer Check im CI
2. **Adapter-Pattern** für Provider – Erweiterbar ohne bestehende Dateien zu ändern
3. **Tool = Modul** – Jedes Tool ist eine eigene Datei mit Definition + Execute
4. **Relevanzselektion** – Nur kontextrelevante Tools pro Anfrage (~7k Token Ersparnis)
5. **Dedup-Cache** – Identische Tool-Calls im selben Turn werden nicht wiederholt
6. **Failover** – Bei Fehlern automatisch nächstes Modell probieren
7. **SSRF-Schutz** – URL-Validierung bei allen externen Fetches

### Provider

| Provider | API | Streaming | Modelle |
|----------|-----|-----------|---------|
| Groq | OpenAI-kompatibel | ✅ SSE | Llama 3.x, Mixtral |
| OpenRouter | OpenAI-kompatibel | ✅ SSE | Multi-Provider |
| Gemini | Eigenes Format | ✅ SSE | Gemini 2.x |
| LM Studio | OpenAI-kompatibel | ✅ SSE | Lokal |

### Sicherheit

- API-Keys nur in IndexedDB (nie auf Server)
- SSRF-Schutz: Block interner IPs/Hostnames
- Schema-Validierung für alle Tool-I/O (Zod)
- Berechtigungsmodell pro Tool (`permissions` in der Tool-Definition, z.B. `network`, `write`)
- Write-Guard für Scheduler-Ausführungen
- Kein `eval`, kein KI-generierter ausführbarer Code – der Rechner-Tool nutzt einen eigenen sicheren Ausdruck-Parser (`src/services/shared/safeMath.ts`), kein `new Function`

## Lizenz

MIT
