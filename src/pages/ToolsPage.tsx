import React, { useState, useEffect } from 'react';
import { toolRegistry } from '../services/tools/registry';
import '../services/tools/registerAll';
import type { ToolDefinition } from '../types/tool';

export function ToolsPage() {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [testArgs, setTestArgs] = useState('{}');
  const [testResult, setTestResult] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setTools(toolRegistry.getAll());
  }, []);

  const filteredTools = tools.filter(t =>
    t.id.toLowerCase().includes(filter.toLowerCase()) ||
    t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.category.toLowerCase().includes(filter.toLowerCase())
  );

  const categories = [...new Set(tools.map(t => t.category))];

  const handleTest = async () => {
    if (!selectedTool) return;
    setTesting(true);
    try {
      const args = JSON.parse(testArgs);
      const result = await toolRegistry.execute(selectedTool, args, {
        origin: 'user', sessionId: 'test',
      });
      setTestResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setTestResult(JSON.stringify({ error: (err as Error).message }, null, 2));
    }
    setTesting(false);
  };

  const selected = tools.find(t => t.id === selectedTool);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Tool-Registry ({tools.length} Tools)</h2>

      <div className="flex gap-4">
        {/* Tool list */}
        <div className="w-80 shrink-0">
          <input
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-blue-500"
          />

          {categories.map(cat => (
            <div key={cat} className="mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">{cat}</h3>
              {filteredTools.filter(t => t.category === cat).map(tool => (
                <button
                  key={tool.id}
                  onClick={() => { setSelectedTool(tool.id); setTestResult(''); }}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                    selectedTool === tool.id
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                      : 'text-gray-400 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{tool.name}</span>
                    <span className={`w-2 h-2 rounded-full ${tool.enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
                  </div>
                  <span className="text-gray-600 font-mono">{tool.id}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Tool detail */}
        <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl p-4">
          {selected ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  selected.enabled ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                }`}>
                  {selected.enabled ? 'Aktiv' : 'Inaktiv'}
                </span>
                <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-400">{selected.category}</span>
              </div>
              <p className="text-sm text-gray-400 mb-4">{selected.description}</p>

              <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                <div className="bg-gray-900 rounded p-2">
                  <span className="text-gray-500">Version:</span> {selected.version}
                </div>
                <div className="bg-gray-900 rounded p-2">
                  <span className="text-gray-500">Max Dauer:</span> {selected.maxDuration}ms
                </div>
                <div className="bg-gray-900 rounded p-2">
                  <span className="text-gray-500">Permissions:</span> {selected.permissions.join(', ') || 'keine'}
                </div>
                <div className="bg-gray-900 rounded p-2">
                  <span className="text-gray-500">Builtin:</span> {selected.builtin ? 'Ja' : 'Nein'}
                </div>
              </div>

              <div className="mb-4">
                <h4 className="text-sm font-medium mb-2">Input Schema</h4>
                <pre className="bg-gray-900 rounded p-3 text-xs overflow-auto max-h-40">
                  {JSON.stringify(selected.inputSchema, null, 2)}
                </pre>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <h4 className="text-sm font-medium mb-2">Test</h4>
                <textarea
                  value={testArgs}
                  onChange={e => setTestArgs(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-xs font-mono h-20 resize-none focus:outline-none focus:border-blue-500"
                  placeholder='{"query": "test"}'
                />
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm transition-colors"
                >
                  {testing ? 'Teste...' : 'Ausführen'}
                </button>

                {testResult && (
                  <div className="mt-3">
                    <pre className="bg-gray-900 rounded p-3 text-xs overflow-auto max-h-60">
                      {testResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Wähle ein Tool aus der Liste
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
