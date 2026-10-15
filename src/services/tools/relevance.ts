import type { ToolDefinition } from '../../types/tool';

// Core tools always included regardless of relevance
const CORE_TOOL_IDS = ['ddg_web_search', 'url_fetch'];

// Alle Kalender-/Terminverwaltungswerkzeuge (create/list/update/remove/next_free)
const ALL_CALENDAR_TOOLS = ['calendar_create', 'calendar_list', 'calendar_update', 'calendar_remove', 'calendar_next_free'];

// Keywords mapped to tool categories
const KEYWORD_MAP: Record<string, string[]> = {
  search: ['ddg_web_search', 'web_search'],
  web: ['ddg_web_search', 'url_fetch', 'web_search'],
  fetch: ['url_fetch'],
  url: ['url_fetch'],
  // Nur das echte News-Tool anbieten – die webz_*/gnews_*-Aliase waren
  // Deckblätter für dieselbe Quelle und provozierten Mehrfach-Fehlschläge.
  news: ['news_search'],
  aktuell: ['news_search'],
  aktie: ['stock_price', 'stock_analysis'],
  stock: ['stock_price', 'stock_analysis'],
  kurs: ['stock_price'],
  finanz: ['stock_price', 'stock_analysis', 'macro_series', 'economic_calendar', 'currency_convert'],
  währung: ['currency_convert'],
  currency: ['currency_convert'],
  macro: ['macro_series', 'economic_calendar'],
  unternehmen: ['company_lookup'],
  firma: ['company_lookup'],
  company: ['company_lookup'],
  portfolio: ['portfolio_overview', 'portfolio_update'],
  daten: ['data_filter', 'import_file', 'export_file'],
  filter: ['data_filter'],
  zusammenfassung: ['text_summarize'],
  summarize: ['text_summarize'],
  report: ['generate_report'],
  bericht: ['generate_report'],
  chart: ['chart_spec'],
  grafik: ['chart_spec'],
  diagramm: ['chart_spec'],
  rechner: ['calculator'],
  calc: ['calculator'],
  rechnen: ['calculator'],
  übersetzung: ['translate_text'],
  translate: ['translate_text'],
  wetter: ['weather_lookup'],
  weather: ['weather_lookup'],
  erinnerung: ['memory_save', 'memory_recall', 'memory_forget'],
  memory: ['memory_save', 'memory_recall', 'memory_forget'],
  merken: ['memory_save'],
  termin: ALL_CALENDAR_TOOLS,
  termine: ALL_CALENDAR_TOOLS,
  kalender: ALL_CALENDAR_TOOLS,
  appointment: ALL_CALENDAR_TOOLS,
  meeting: ALL_CALENDAR_TOOLS,
  wiederhol: ALL_CALENDAR_TOOLS, // wiederkehrend/wiederholung (Stamm ohne Ende)
  serien: ALL_CALENDAR_TOOLS,
  frei: ALL_CALENDAR_TOOLS,
  free: ALL_CALENDAR_TOOLS,
  plan: ['schedule_create', 'schedule_list', 'schedule_remove'],
  schedule: ['schedule_create', 'schedule_list', 'schedule_remove'],
  export: ['export_file'],
  import: ['import_file'],
  csv: ['export_file', 'import_file'],
};

export function selectRelevantTools(query: string, allTools: ToolDefinition[]): ToolDefinition[] {
  const queryLower = query.toLowerCase();
  const matchedIds = new Set<string>(CORE_TOOL_IDS);

  for (const [keyword, toolIds] of Object.entries(KEYWORD_MAP)) {
    if (queryLower.includes(keyword)) {
      toolIds.forEach(id => matchedIds.add(id));
    }
  }

  const selected = allTools.filter(t => matchedIds.has(t.id) && t.enabled);

  // Ensure at least core tools are present
  for (const coreId of CORE_TOOL_IDS) {
    if (!selected.find(t => t.id === coreId)) {
      const core = allTools.find(t => t.id === coreId);
      if (core) selected.push(core);
    }
  }

  return selected;
}
