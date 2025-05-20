import React from 'react';
import { NavLink } from 'react-router-dom';

function Sidebar({ darkMode, socketConnected }) {
  return (
    <aside className={`w-64 ${darkMode ? 'bg-darker-bg' : 'bg-white'} shadow-md`}>
      <div className="p-6">
        <div className="flex items-center space-x-2 mb-8">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-signal-blue">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          <h1 className="text-2xl font-bold">RF Observer</h1>
        </div>
        
        <nav className="space-y-2">
          <NavLink
            to="/"
            className={({ isActive }) => 
              `flex items-center p-3 rounded-lg transition-colors ${
                isActive 
                  ? `${darkMode ? 'bg-gray-700' : 'bg-blue-100'} text-signal-blue` 
                  : `${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`
              }`
            }
            end
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
            </svg>
            Dashboard
          </NavLink>
          
          <NavLink
            to="/devices"
            className={({ isActive }) => 
              `flex items-center p-3 rounded-lg transition-colors ${
                isActive 
                  ? `${darkMode ? 'bg-gray-700' : 'bg-blue-100'} text-signal-blue` 
                  : `${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`
              }`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
            </svg>
            Devices
          </NavLink>
          
          <NavLink
            to="/bursts"
            className={({ isActive }) => 
              `flex items-center p-3 rounded-lg transition-colors ${
                isActive 
                  ? `${darkMode ? 'bg-gray-700' : 'bg-blue-100'} text-signal-blue` 
                  : `${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`
              }`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Burst Analyzer
          </NavLink>
          
          <NavLink
            to="/settings"
            className={({ isActive }) => 
              `flex items-center p-3 rounded-lg transition-colors ${
                isActive 
                  ? `${darkMode ? 'bg-gray-700' : 'bg-blue-100'} text-signal-blue` 
                  : `${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`
              }`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </NavLink>
        </nav>
      </div>
      
      {/* Status footer */}
      <div className={`p-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} mt-4`}>
        <div className="flex items-center">
          <div className={`h-3 w-3 rounded-full mr-2 ${socketConnected ? 'bg-signal-green' : 'bg-signal-red'}`}></div>
          <span className="text-sm">{socketConnected ? 'Server Connected' : 'Server Disconnected'}</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar; 