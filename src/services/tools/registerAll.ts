/**
 * Zentrale Registrierung aller Built-in-Tools.
 *
 * Früher standen alle Tool-Definitionen + Execute-Funktionen in dieser einen
 * Datei (>800 Zeilen). Refaktoriert zu "Tool = Modul": Jedes Tool-Set lebt in
 * eigener Datei unter ./builtin/, diese Datei importiert sie nur noch.
 *
 * Reihenfolge der Imports = Reihenfolge der Registrierung (wie zuvor).
 */
import './builtin/searchTools';
import './builtin/financeTools';
import './builtin/knowledgeTools';
import './builtin/dataTools';
import './builtin/memoryTools';
import './builtin/automationTools';
import './builtin/calendarTools';

// --- ADDITIONAL ALIAS-WERKZEUGE ---
// Frühere Alias-Registrierungen von 'web_search' (als Duplikat mit der ID des
// optimierten Wikipedia-Tools) sowie webz_*/gnews_* als reine news_search-
// Durchleister wurden entfernt:
// - Das web_search-Duplikat überschrieb beim Registrieren das echte
//   Optimierungs-Tool und degradierte es auf ddg_web_search.
// - Die Aliase gaben vor, separate Anbieter (Webz/GNews) zu sein, zogen aber
//   alle dieselbe Quelle nach – vier "verschiedene" Tools meldeten deshalb
//   parallel ein und denselben "keine Treffer"-Fehler.
// Auch das news_search-Tool selbst wurde entfernt; die Legacy-Einträge in
// LEGACY_ID_MAP (types/tool.ts) leiten alte Nachrichten-Aufrufe jetzt auf
// die KI-Suche (Jina, ai_search) um.
export {};
