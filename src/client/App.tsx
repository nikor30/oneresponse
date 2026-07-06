import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import TargetDetail from './pages/TargetDetail';
import TargetManager from './pages/TargetManager';
import GroupManager from './pages/GroupManager';
import PeerManager from './pages/PeerManager';
import DeviceManager from './pages/DeviceManager';
import Top10Page from './pages/Top10';
import ClientStatus from './pages/ClientStatus';
import SettingsPage from './pages/Settings';
import AdminGate from './components/AdminGate';
import { ThemeProvider } from './theme/ThemeContext';
import { AuthProvider } from './auth/AuthContext';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/top" element={<Top10Page />} />
              <Route path="/status" element={<ClientStatus />} />
              <Route path="/targets/:id" element={<TargetDetail />} />
              <Route path="/targets" element={<AdminGate what="targets"><TargetManager /></AdminGate>} />
              <Route path="/groups"  element={<AdminGate what="groups & SLA"><GroupManager /></AdminGate>} />
              <Route path="/peers"   element={<AdminGate what="peers and API keys"><PeerManager /></AdminGate>} />
              <Route path="/devices" element={<AdminGate what="Cisco devices"><DeviceManager /></AdminGate>} />
              <Route path="/settings" element={<AdminGate what="instance settings"><SettingsPage /></AdminGate>} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
