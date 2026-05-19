import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import TargetDetail from './pages/TargetDetail';
import TargetManager from './pages/TargetManager';
import GroupManager from './pages/GroupManager';
import PeerManager from './pages/PeerManager';
import { ThemeProvider } from './theme/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/targets" element={<TargetManager />} />
            <Route path="/targets/:id" element={<TargetDetail />} />
            <Route path="/groups" element={<GroupManager />} />
            <Route path="/peers" element={<PeerManager />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  );
}
