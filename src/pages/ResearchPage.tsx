import React, { useState } from 'react';
import { Search, TrendingUp, Building2, Globe } from 'lucide-react';
import { toolRegistry } from '../services/tools/registry';
import '../services/tools/registerAll';

const QUICK_ACTIONS = [
  { id: 'news', label: 'Nachrichten', icon: Globe, toolId: 'ai_search', param: { query: 'Aktuelle Nachrichten' } },
  { id: 'stock', label: 'Aktienkurs', icon: TrendingUp, toolId: 'stock_price', param: { ticker: 'SAP.DE' } },
  { id: 'company', label: 'Unternehmen', icon: Building2, toolId: 'company_lookup', param: { company: 'SAP' } },
  { id: 'weather', label: 'Wetter', icon: Search, toolId: 'weather_lookup', param: { location: 'Berlin' } },
];

export function ResearchPage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuickSearch = async (toolId: string, params: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    setResult('');
    try {
      const res = await toolRegistry.execute(toolId, params, { origin: 'user', sessionId: 'research' });
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult('');
    try {
      const res = await toolRegistry.execute('ddg_web_search', { query }, { origin: 'user', sessionId: 'research' });
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Schnellrecherche</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {QUICK_ACTIONS.map(action => (
          <button
            key={action.id}
            onClick={() => handleQuickSearch(action.toolId, action.param)}
            className="flex flex-col items-center gap-2 p-4 bg-gray-800 border border-gray-700 rounded-xl hover:border-blue-500/50 transition-all"
          >
            <action.icon size={24} className="text-blue-400" />
            <span className="text-sm">{action.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Suchbegriff eingeben..."
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch((e.target as HTMLInputElement).value);
              }
            }}
          />
          <button
            onClick={() => {
              const inp = document.querySelector<HTMLInputElement>('input[placeholder="Suchbegriff eingeben..."]');
              if (inp) handleSearch(inp.value);
            }}
            className="px-4 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Search size={18} />
          </button>
        </div>

        {loading && (
          <div className="text-center py-8 text-gray-400">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mb-2" />
            <p className="text-sm">Suche läuft...</p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-300">
            ❌ {error}
          </div>
        )}

        {result && (
          <div className="mt-4">
            <pre className="text-xs bg-gray-900 rounded-lg p-3 overflow-auto max-h-96 text-gray-300">
              {result}
            </pre>
          </div>
        )}

        {!loading && !result && !error && (
          <div className="text-center py-8 text-gray-500 text-sm">
            Wähle eine Schnellaktion oder gib einen Suchbegriff ein
          </div>
        )}
      </div>
    </div>
  );
}
