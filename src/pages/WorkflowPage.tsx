import React, { useState, useEffect } from 'react';
import { listWorkflows, createWorkflow, saveWorkflow, deleteWorkflow } from '../services/db/workflows';
import type { WorkflowDefinition, WorkflowNode } from '../types/workflow';
import { toolRegistry } from '../services/tools/registry';
import '../services/tools/registerAll';
import { Plus, Trash2, Save } from 'lucide-react';

export function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [activeWf, setActiveWf] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    listWorkflows().then(setWorkflows);
  }, []);

  const handleNewWorkflow = async () => {
    const wf = await createWorkflow('Neuer Workflow');
    setWorkflows(prev => [wf, ...prev]);
    setActiveWf(wf);
    setNodes([]);
  };

  const handleSelectWorkflow = (wf: WorkflowDefinition) => {
    setActiveWf(wf);
    setNodes(wf.nodes);
  };

  const handleAddNode = (toolId: string) => {
    const newNode: WorkflowNode = {
      id: `node_${Date.now()}`,
      type: 'tool',
      toolId,
      position: { x: 100 + nodes.length * 150, y: 100 },
      data: {},
      label: toolId,
    };
    setNodes(prev => [...prev, newNode]);
  };

  const handleSave = async () => {
    if (!activeWf) return;
    const updated = { ...activeWf, nodes, updatedAt: Date.now() };
    await saveWorkflow(updated);
    setActiveWf(updated);
    setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w));
  };

  const handleDelete = async (id: string) => {
    await deleteWorkflow(id);
    setWorkflows(prev => prev.filter(w => w.id !== id));
    if (activeWf?.id === id) {
      setActiveWf(null);
      setNodes([]);
    }
  };

  const tools = toolRegistry.getAll();

  return (
    <div className="flex h-full">
      {/* Workflow list */}
      <div className="w-56 border-r border-gray-700 bg-gray-800/30 overflow-y-auto">
        <div className="p-2">
          <button
            onClick={handleNewWorkflow}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center"
          >
            <Plus size={14} /> Neuer Workflow
          </button>
        </div>
        <div className="space-y-0.5 px-2">
          {workflows.map(wf => (
            <div key={wf.id} className="flex items-center gap-1">
              <button
                onClick={() => handleSelectWorkflow(wf)}
                className={`flex-1 text-left px-3 py-2 rounded text-xs truncate transition-colors ${
                  activeWf?.id === wf.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/50'
                }`}
              >
                {wf.name}
              </button>
              <button onClick={() => handleDelete(wf.id)} className="p-1 text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Workflow editor */}
      <div className="flex-1 flex flex-col">
        {activeWf ? (
          <>
            <div className="p-3 border-b border-gray-700 flex items-center gap-3">
              <input
                value={activeWf.name}
                onChange={e => setActiveWf({ ...activeWf, name: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">{nodes.length} Nodes</span>
              <div className="flex-1" />
              <button onClick={handleSave} className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs flex items-center gap-1">
                <Save size={12} /> Speichern
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Tool palette */}
              <div className="w-48 border-r border-gray-700 overflow-y-auto p-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Tools</h3>
                {tools.map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => handleAddNode(tool.id)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors mb-0.5 truncate"
                    title={tool.description}
                  >
                    {tool.name}
                  </button>
                ))}
              </div>

              {/* Canvas */}
              <div className="flex-1 bg-gray-900/50 relative overflow-auto">
                {nodes.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Füge Tools aus der Palette hinzu (links)
                  </div>
                ) : (
                  <div className="relative min-h-full min-w-full p-8">
                    {nodes.map(node => (
                      <div
                        key={node.id}
                        onClick={() => setSelectedNode(node.id)}
                        className={`absolute cursor-move border rounded-lg px-3 py-2 text-xs transition-all ${
                          selectedNode === node.id
                            ? 'border-blue-500 bg-blue-900/30 shadow-lg shadow-blue-500/20'
                            : 'border-gray-600 bg-gray-800 hover:border-gray-500'
                        }`}
                        style={{ left: node.position.x, top: node.position.y }}
                      >
                        <div className="font-medium text-blue-400">{node.label || node.toolId}</div>
                        <div className="text-gray-500 mt-0.5">{node.toolId}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm12-6a3 3 0 100-6 3 3 0 000 6zm0 0v6a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              <p className="mt-2">Wähle oder erstelle einen Workflow</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
