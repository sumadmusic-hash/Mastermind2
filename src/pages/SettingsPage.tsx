import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getAdapter, resolveEndpoint } from '../services/providers/registry';
import { MODEL_CATALOG } from '../services/providers/modelCatalog';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { ProviderId, ModelSlot } from '../types/provider';

export function SettingsPage() {
  const { settings, setProviderKey, setModelSlots, updateSettings } = useAppStore();
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, boolean | null>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});

  const handleTestConnection = async (providerId: string) => {
    setTesting(providerId);
    const key = keyInputs[providerId] || settings.providers[providerId]?.apiKey || '';
    const baseUrl = resolveEndpoint(providerId as ProviderId);
    try {
      const adapter = getAdapter(providerId);
      const ok = await adapter.testConnection(key, baseUrl);
      setTestResult(prev => ({ ...prev, [providerId]: ok }));
      if (ok && keyInputs[providerId]) {
        await setProviderKey(providerId, keyInputs[providerId]);
      }
    } catch {
      setTestResult(prev => ({ ...prev, [providerId]: false }));
    }
    setTesting(null);
  };

  const handleSlotChange = (slotIndex: number, field: keyof ModelSlot, value: string | boolean) => {
    const newSlots = [...settings.modelSlots];
    newSlots[slotIndex] = { ...newSlots[slotIndex], [field]: value };
    setModelSlots(newSlots);
  };

  const providers: Array<{ id: ProviderId; name: string; description: string }> = [
    { id: 'groq', name: 'Groq', description: 'Schnelle Inferenz mit Llama-Modellen' },
    { id: 'openrouter', name: 'OpenRouter', description: 'Multi-Provider Gateway' },
    { id: 'gemini', name: 'Google Gemini', description: 'Gemini-Modelle von Google' },
    { id: 'lmstudio', name: 'LM Studio', description: 'Lokale Modelle (localhost)' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h2 className="text-xl font-semibold">Einstellungen</h2>

      {/* Provider Configuration */}
      <section>
        <h3 className="text-lg font-medium mb-4">Provider & API-Keys</h3>
        <div className="space-y-4">
          {providers.map(provider => (
            <div key={provider.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-medium">{provider.name}</h4>
                  <p className="text-xs text-gray-500">{provider.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {testResult[provider.id] === true && <CheckCircle size={16} className="text-green-400" />}
                  {testResult[provider.id] === false && <XCircle size={16} className="text-red-400" />}
                  {testing === provider.id && <Loader2 size={16} className="animate-spin text-blue-400" />}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="API-Key eingeben..."
                  defaultValue={settings.providers[provider.id]?.apiKey || ''}
                  onChange={e => setKeyInputs(prev => ({ ...prev, [provider.id]: e.target.value }))}
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => handleTestConnection(provider.id)}
                  disabled={testing === provider.id}
                  className="px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm transition-colors"
                >
                  Test
                </button>
              </div>
              {provider.id === 'lmstudio' && (
                <input
                  type="text"
                  placeholder="Base URL (default: http://localhost:1234/v1)"
                  defaultValue={settings.providers[provider.id]?.baseUrl || ''}
                  className="mt-2 w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Model Slots */}
      <section>
        <h3 className="text-lg font-medium mb-4">Modell-Slots (7 Slots: 1 Primär + 6 Fallbacks)</h3>
        <div className="space-y-2">
          {settings.modelSlots.map((slot, i) => (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
              <span className="text-xs text-gray-500 w-20">{slot.label}</span>
              <select
                value={slot.providerId}
                onChange={e => handleSlotChange(i, 'providerId', e.target.value)}
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="text"
                list={`model-catalog-${i}`}
                value={slot.modelId}
                onChange={e => handleSlotChange(i, 'modelId', e.target.value)}
                placeholder="Modell-ID eingeben..."
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
              <datalist id={`model-catalog-${i}`}>
                {(MODEL_CATALOG[slot.providerId as ProviderId] || []).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </datalist>
              {slot.isPrimary && <span className="text-xs bg-blue-600/30 text-blue-400 px-2 py-0.5 rounded">Primär</span>}
            </div>
          ))}
        </div>
      </section>

      {/* General Settings */}
      <section>
        <h3 className="text-lg font-medium mb-4">Allgemein</h3>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">TPM-Limit (Tokens pro Minute)</label>
            <input
              type="number"
              value={settings.tpmLimit}
              onChange={e => updateSettings({ tpmLimit: parseInt(e.target.value) || 60000 })}
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Proxy Base URL (für CORS-Probleme)</label>
            <input
              type="text"
              value={settings.proxyBaseUrl}
              onChange={e => updateSettings({ proxyBaseUrl: e.target.value })}
              placeholder="z.B. https://your-cors-proxy.com"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </section>

      {/* Info */}
      <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-2">ℹ️ Hinweise</h3>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>• API-Keys werden nur lokal in IndexedDB gespeichert</li>
          <li>• Keine Daten werden an Dritte gesendet (außer an den gewählten Provider)</li>
          <li>• Groq bietet kostenlose API-Keys unter console.groq.com</li>
          <li>• LM Studio muss lokal laufen (localhost:1234)</li>
          <li>• Fallback-Slots werden bei Fehlern automatisch durchprobiert</li>
        </ul>
      </section>
    </div>
  );
}
