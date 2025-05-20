import React, { useState } from 'react';

function Settings() {
  const [settings, setSettings] = useState({
    theme: 'dark',
    autoRecord: true,
    maxRecordingDuration: 5,
    maxStorageSize: 1000,
    exportFormat: 'wav',
    databaseType: 'sqlite',
    enableAdvancedFeatures: false,
    enableNotifications: true
  });

  const handleSettingChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSaveSettings = () => {
    // This would save settings to backend in a real implementation
    alert('Settings saved!');
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* General Settings */}
        <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">General Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="flex items-center">
                <span className="mr-3 text-gray-700 dark:text-gray-300">Default Theme</span>
                <select
                  name="theme"
                  value={settings.theme}
                  onChange={handleSettingChange}
                  className="mt-1 block rounded-md border-gray-300 dark:border-gray-700 
                           dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System Default</option>
                </select>
              </label>
            </div>
            
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="enableNotifications"
                  checked={settings.enableNotifications}
                  onChange={handleSettingChange}
                  className="h-4 w-4 text-signal-blue focus:ring-signal-blue border-gray-300 rounded"
                />
                <span className="ml-2 text-gray-700 dark:text-gray-300">
                  Enable Notifications
                </span>
              </label>
            </div>
            
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="enableAdvancedFeatures"
                  checked={settings.enableAdvancedFeatures}
                  onChange={handleSettingChange}
                  className="h-4 w-4 text-signal-blue focus:ring-signal-blue border-gray-300 rounded"
                />
                <span className="ml-2 text-gray-700 dark:text-gray-300">
                  Enable Advanced Features
                </span>
              </label>
            </div>
          </div>
        </div>
        
        {/* Recording Settings */}
        <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Recording Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="autoRecord"
                  checked={settings.autoRecord}
                  onChange={handleSettingChange}
                  className="h-4 w-4 text-signal-blue focus:ring-signal-blue border-gray-300 rounded"
                />
                <span className="ml-2 text-gray-700 dark:text-gray-300">
                  Auto-record Detected Bursts
                </span>
              </label>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Max Recording Duration (seconds)
              </label>
              <input
                type="number"
                name="maxRecordingDuration"
                value={settings.maxRecordingDuration}
                onChange={handleSettingChange}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                         dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Max Storage Size (MB)
              </label>
              <input
                type="number"
                name="maxStorageSize"
                value={settings.maxStorageSize}
                onChange={handleSettingChange}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                         dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Default Export Format
              </label>
              <select
                name="exportFormat"
                value={settings.exportFormat}
                onChange={handleSettingChange}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                         dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
              >
                <option value="wav">WAV</option>
                <option value="bin">Binary (IQ)</option>
                <option value="sigmf">SigMF</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Database Settings */}
        <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Database Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Database Type
              </label>
              <select
                name="databaseType"
                value={settings.databaseType}
                onChange={handleSettingChange}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                         dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
              >
                <option value="sqlite">SQLite (Local)</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </div>
            
            {settings.databaseType === 'postgres' && (
              <div className="space-y-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    PostgreSQL Host
                  </label>
                  <input
                    type="text"
                    placeholder="localhost"
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                              dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    PostgreSQL Port
                  </label>
                  <input
                    type="text"
                    placeholder="5432"
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                              dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Database Name
                  </label>
                  <input
                    type="text"
                    placeholder="rfobserver"
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                              dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Username
                    </label>
                    <input
                      type="text"
                      placeholder="postgres"
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                                dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Password
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 
                                dark:bg-gray-800 shadow-sm focus:border-signal-blue focus:ring-signal-blue"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* System Information */}
        <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">System Information</h2>
          
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Version</span>
              <span>0.1.0</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Backend Status</span>
              <span className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-signal-green mr-2"></div>
                Online
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Database</span>
              <span>SQLite v3.36.0</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Storage Used</span>
              <span>24.5 MB / 1000 MB</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Bursts Logged</span>
              <span>143</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">SDR Library</span>
              <span>pyrtlsdr v0.2.92</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Save Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSaveSettings}
          className="px-4 py-2 bg-signal-blue text-white rounded-md hover:bg-blue-700"
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default Settings; 