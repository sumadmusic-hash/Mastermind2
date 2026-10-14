import { useEffect } from 'react';
import { Layout } from './components/layout/Layout';
import { ChatPage } from './pages/ChatPage';
import { ResearchPage } from './pages/ResearchPage';
import { ToolsPage } from './pages/ToolsPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAppStore } from './store/useAppStore';

// Import tool registrations (side-effect)
import './services/tools/registerAll';

function App() {
  const { currentPage, loadSettings, loaded } = useAppStore();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm">Lade Einstellungen...</p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'chat': return <ChatPage />;
      case 'research': return <ResearchPage />;
      case 'tools': return <ToolsPage />;
      case 'workflow': return <WorkflowPage />;
      case 'settings': return <SettingsPage />;
      default: return <ChatPage />;
    }
  };

  return <Layout>{renderPage()}</Layout>;
}

export default App;
