import React from 'react';
import { MessageSquare, Search, Wrench, GitBranch, Settings, Menu, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'research', label: 'Recherche', icon: Search },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { currentPage, setCurrentPage, sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-0'} transition-all duration-200 overflow-hidden bg-gray-800 border-r border-gray-700 flex flex-col`}>
        <div className="p-4 border-b border-gray-700 flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">AI</div>
          <span className="font-semibold text-sm">Research Assistant</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                currentPage === item.id
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                  : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
          v1.0.0 • Lokal & Sicher
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 border-b border-gray-700 flex items-center px-4 bg-gray-800/50">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 rounded hover:bg-gray-700">
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <h1 className="ml-3 text-sm font-medium text-gray-300">
            {NAV_ITEMS.find(n => n.id === currentPage)?.label || 'Chat'}
          </h1>
        </header>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
