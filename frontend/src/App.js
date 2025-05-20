import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import socket from './utils/socketio_client';

// Pages
import Dashboard from './pages/Dashboard';
import DeviceManager from './pages/DeviceManager';
import BurstAnalyzer from './pages/BurstAnalyzer';
import Settings from './pages/Settings';

// Components
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';

// Set up API URL
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7001';

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [bursts, setBursts] = useState([]);

  useEffect(() => {
    // Socket.io event handlers
    socket.on('connect', () => {
      console.log('Connected to WebSocket server');
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setSocketConnected(false);
    });

    socket.on('burst_detected', (burst) => {
      console.log('Burst detected:', burst);
      setBursts(prev => [...prev, burst].slice(-100)); // Keep last 100 bursts
    });

    // Cleanup on unmount
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('burst_detected');
    };
  }, []);

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    if (darkMode) {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  };

  useEffect(() => {
    // Initialize dark mode
    if (darkMode) {
      document.documentElement.classList.add('dark');
    }
  }, [darkMode]);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className={`flex h-screen ${darkMode ? 'dark bg-dark-bg text-white' : 'bg-gray-50 text-gray-900'}`}>
        <Sidebar darkMode={darkMode} socketConnected={socketConnected} />
        
        <div className="flex flex-col flex-1 overflow-hidden">
          <Navbar darkMode={darkMode} toggleDarkMode={toggleDarkMode} socketConnected={socketConnected} />
          
          <main className="flex-1 overflow-x-hidden overflow-y-auto">
            <div className="container px-6 py-8 mx-auto">
              <Routes>
                <Route path="/" element={<Dashboard bursts={bursts} />} />
                <Route path="/devices" element={<DeviceManager socket={socket} />} />
                <Route path="/bursts" element={<BurstAnalyzer bursts={bursts} />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </Router>
  );
}

export default App; 