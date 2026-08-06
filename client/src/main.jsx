import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { PremiumProvider } from './context/PremiumContext';
import { AppProvider } from './context/AppContext';
import { PermissionProvider } from './context/PermissionContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <PremiumProvider>
            <AppProvider>
              <PermissionProvider>
                <App />
              </PermissionProvider>
            </AppProvider>
          </PremiumProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
