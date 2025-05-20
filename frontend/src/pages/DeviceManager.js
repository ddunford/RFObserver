import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7000';

// Common frequency ranges for quick tuning
const FREQUENCY_PRESETS = [
  { name: "ISM 433 MHz", frequency: 433.92 },
  { name: "ISM 868 MHz", frequency: 868.3 },
  { name: "ISM 915 MHz", frequency: 915.0 },
  { name: "Weather", frequency: 162.55 },
  { name: "FM Radio", frequency: 100.1 },
  { name: "Air Band", frequency: 118.0 },
  { name: "VHF Marine", frequency: 156.8 },
  { name: "PMR446", frequency: 446.0 }
];

// Sample rate presets
const SAMPLE_RATE_PRESETS = [
  { name: "2.048 MSPS", rate: 2048000 },
  { name: "1.024 MSPS", rate: 1024000 },
  { name: "1.4 MSPS", rate: 1400000 },
  { name: "2.4 MSPS", rate: 2400000 },
  { name: "3.2 MSPS", rate: 3200000 }
];

function DeviceManager({ socket }) {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [activeDevices, setActiveDevices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanConfig, setScanConfig] = useState({
    device_index: 0,
    center_frequency: 433920000, // 433.92 MHz
    sample_rate: 2048000,
    gain: 40,
    ppm: 0,
    threshold_dbfs: -35,
    min_burst_duration: 0.1
  });
  const [tuningStatus, setTuningStatus] = useState(null);
  const [tuningMessage, setTuningMessage] = useState("");
  const [selectedDeviceInfo, setSelectedDeviceInfo] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(null);
  const [scanningDevices, setScanningDevices] = useState([]);

  // Fetch available devices
  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/devices`);
      setDevices(response.data);
      setError(null);
      
      // If we have a device selected, check if it's still in the list
      if (scanConfig.device_index !== null) {
        const deviceExists = response.data.some(d => d.index === scanConfig.device_index);
        if (!deviceExists && response.data.length > 0) {
          // Select the first available device
          setScanConfig(prev => ({
            ...prev,
            device_index: response.data[0].index
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('Failed to load devices. Check if the backend is running.');
    } finally {
      setLoading(false);
    }
  }, [scanConfig.device_index]);

  // Fetch active device information
  const fetchActiveDevices = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/devices/all`);
      const active = {};
      const scanningIndices = [];
      
      // Filter for active devices and create an object keyed by device index
      response.data.forEach(device => {
        if (device.status === 'connected' || device.status === 'idle') {
          active[device.index] = device;
          
          // Track which devices are actually scanning
          if (device.status === 'connected') {
            scanningIndices.push(device.index);
          }
        }
      });
      
      setScanningDevices(scanningIndices);
      setActiveDevices(active);
    } catch (err) {
      console.error('Error fetching active devices:', err);
    }
  }, []);

  // Set up polling for active devices
  useEffect(() => {
    // Initial fetch
    fetchDevices();
    fetchActiveDevices();
    
    // Set up polling interval (every 3 seconds)
    const interval = setInterval(() => {
      fetchActiveDevices();
    }, 3000);
    
    setRefreshInterval(interval);
    
    // Clean up on unmount
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fetchDevices, fetchActiveDevices, refreshInterval]);

  // Start a scan on a device
  const startScan = async () => {
    try {
      const response = await axios.post(`${API_URL}/api/start_scan`, scanConfig);
      console.log('Scan started:', response.data);
      
      // Update active devices list
      fetchActiveDevices();
      
      // Fetch the detailed device info
      fetchDeviceDetails(scanConfig.device_index);
      
      // Show success message
      setTuningStatus("success");
      setTuningMessage(`Started scan on device ${scanConfig.device_index}`);
      setTimeout(() => setTuningStatus(null), 1500);
    } catch (err) {
      console.error('Error starting scan:', err);
      setError('Failed to start scan. Check the device configuration.');
      
      // Show error message
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to start scan");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };

  // Stop a scan on a device
  const stopScan = async (deviceIndex) => {
    try {
      const response = await axios.post(`${API_URL}/api/stop_scan/${deviceIndex}`);
      console.log('Scan stopped:', response.data);
      
      // Update active devices list
      fetchActiveDevices();
      
      // Clear selected device info if it was the current device
      if (selectedDeviceInfo && selectedDeviceInfo.index === deviceIndex) {
        setSelectedDeviceInfo(null);
      }
      
      // Show success message
      setTuningStatus("success");
      setTuningMessage(`Stopped scan on device ${deviceIndex}`);
      setTimeout(() => setTuningStatus(null), 1500);
    } catch (err) {
      console.error('Error stopping scan:', err);
      setError('Failed to stop scan.');
      
      // Show error message
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to stop scan");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };

  // Tune a device in real-time
  const tuneDevice = async (deviceIndex, tuneParams) => {
    try {
      setTuningStatus("tuning");
      const response = await axios.post(`${API_URL}/api/tune/${deviceIndex}`, tuneParams);
      
      // Update the active device config
      if (deviceIndex in activeDevices) {
        setActiveDevices(prev => ({
          ...prev,
          [deviceIndex]: {
            ...prev[deviceIndex],
            ...tuneParams
          }
        }));
      }
      
      setTuningMessage(response.data.changes || "Tuning successful");
      setTuningStatus("success");
      setTimeout(() => setTuningStatus(null), 1500);
      console.log('Tuning successful:', response.data);
      
      // Refresh device details
      fetchDeviceDetails(deviceIndex);
    } catch (err) {
      console.error('Error tuning device:', err);
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Tuning failed");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };

  // Fetch detailed device information
  const fetchDeviceDetails = async (deviceIndex) => {
    try {
      const response = await axios.get(`${API_URL}/api/device/${deviceIndex}`);
      setSelectedDeviceInfo(response.data);
    } catch (err) {
      console.error('Error fetching device details:', err);
    }
  };

  // Handle input change for config form
  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    let parsedValue = value;
    
    // Convert numeric inputs to numbers
    if (name !== 'device_index' && !isNaN(value) && value !== '') {
      parsedValue = name === 'center_frequency' ? parseInt(value) * 1000000 : parseFloat(value);
    }
    
    setScanConfig(prev => ({
      ...prev,
      [name]: parsedValue
    }));
  };

  // Handle real-time tuning
  const handleTuning = (name, value) => {
    // Only apply tuning for active devices
    if (scanConfig.device_index in activeDevices) {
      let parsedValue = value;
      
      // Convert numeric inputs to numbers
      if (name !== 'device_index' && !isNaN(value) && value !== '') {
        parsedValue = name === 'center_frequency' ? parseInt(value) * 1000000 : parseFloat(value);
      }
      
      // Create tune parameters object
      const tuneParams = {
        [name]: parsedValue
      };
      
      // Call the tune API
      tuneDevice(scanConfig.device_index, tuneParams);
    }
  };

  // Apply a preset frequency
  const applyPreset = (freq) => {
    // Update the form value
    setScanConfig(prev => ({
      ...prev,
      center_frequency: freq * 1000000
    }));
    
    // If device is already scanning, tune it immediately
    if (scanningDevices.includes(scanConfig.device_index)) {
      tuneDevice(scanConfig.device_index, { center_frequency: freq * 1000000 });
    }
  };

  // Apply a preset sample rate
  const applySampleRate = (rate) => {
    // Update the form value
    setScanConfig(prev => ({
      ...prev,
      sample_rate: rate
    }));
    
    // If device is already scanning, tune it immediately
    if (scanningDevices.includes(scanConfig.device_index)) {
      tuneDevice(scanConfig.device_index, { sample_rate: rate });
    }
  };

  // Handle device selection
  const handleDeviceSelect = (deviceIndex) => {
    setScanConfig(prev => ({
      ...prev,
      device_index: deviceIndex
    }));
    
    // Fetch detailed device info when selected
    fetchDeviceDetails(deviceIndex);
  };

  // Go to dashboard with selected device
  const goToDashboard = () => {
    navigate('/', { state: { selectedDevice: scanConfig.device_index } });
  };

  // Format frequency for display
  const formatFrequency = (freqHz) => {
    return (freqHz / 1e6).toFixed(3) + " MHz";
  };

  // Format sample rate for display
  const formatSampleRate = (rateHz) => {
    return (rateHz / 1e6).toFixed(3) + " MSPS";
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">RTL-SDR Device Manager</h1>
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-6">
          <p>{error}</p>
        </div>
      )}
      
      {tuningStatus && (
        <div className={`fixed top-4 right-4 px-4 py-2 rounded-md shadow-lg ${
          tuningStatus === "success" ? "bg-green-500" : 
          tuningStatus === "error" ? "bg-red-500" : "bg-blue-500"
        } text-white z-50`}>
          {tuningStatus === "tuning" ? "Tuning device..." : tuningMessage}
        </div>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Available RTL-SDR Devices</h2>
          
          <div className="mb-4">
            <button 
              onClick={fetchDevices}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-600 mr-2"
            >
              Refresh Devices
            </button>
            
            <button
              onClick={goToDashboard}
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            >
              Go to Dashboard
            </button>
          </div>
          
          {loading ? (
            <div className="text-center py-4">
              <p className="text-gray-500 dark:text-gray-400">Scanning for SDR devices...</p>
            </div>
          ) : devices.length === 0 ? (
            <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded">
              <p className="font-bold">No SDR devices found!</p>
              <p>Make sure your RTL-SDR device is connected and has proper permissions.</p>
              <div className="mt-2">
                <button 
                  onClick={fetchDevices} 
                  className="px-3 py-1 bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded hover:bg-yellow-300 dark:hover:bg-yellow-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Index</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Serial</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {devices.map(device => (
                    <tr 
                      key={device.index}
                      className={`${device.index === scanConfig.device_index ? "bg-blue-50 dark:bg-blue-900" : ""} hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer`}
                      onClick={() => handleDeviceSelect(device.index)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.index}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{device.serial}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          device.status === 'connected' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                          device.status === 'idle' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 
                          device.status === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 
                          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {device.status === 'connected' ? 'Active' : 
                           device.status === 'idle' ? 'Ready' :
                           device.status === 'error' ? 'Error' : 'Disconnected'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {scanningDevices.includes(device.index) ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              stopScan(device.index);
                            }}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeviceSelect(device.index);
                            }}
                            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                          >
                            Select
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {/* Device Configuration */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">
            {selectedDeviceInfo ? `Configure Device ${selectedDeviceInfo.index}: ${selectedDeviceInfo.name}` : 'Configure Device'}
          </h2>
          
          {selectedDeviceInfo && (
            <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <h3 className="font-medium mb-2">Device Information</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500 dark:text-gray-400">Name:</dt>
                <dd className="text-gray-900 dark:text-gray-200">{selectedDeviceInfo.name}</dd>
                
                <dt className="text-gray-500 dark:text-gray-400">Serial:</dt>
                <dd className="text-gray-900 dark:text-gray-200">{selectedDeviceInfo.serial}</dd>
                
                <dt className="text-gray-500 dark:text-gray-400">Status:</dt>
                <dd className="text-gray-900 dark:text-gray-200">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    selectedDeviceInfo.status === 'connected' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                    selectedDeviceInfo.status === 'idle' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 
                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {selectedDeviceInfo.status === 'connected' ? 'Scanning' : 
                     selectedDeviceInfo.status === 'idle' ? 'Ready' : 'Disconnected'}
                  </span>
                </dd>
                
                {selectedDeviceInfo.center_freq && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Frequency:</dt>
                    <dd className="text-gray-900 dark:text-gray-200">{formatFrequency(selectedDeviceInfo.center_freq)}</dd>
                  </>
                )}
                
                {selectedDeviceInfo.sample_rate && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Sample Rate:</dt>
                    <dd className="text-gray-900 dark:text-gray-200">{formatSampleRate(selectedDeviceInfo.sample_rate)}</dd>
                  </>
                )}
                
                {selectedDeviceInfo.gain !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Gain:</dt>
                    <dd className="text-gray-900 dark:text-gray-200">{selectedDeviceInfo.gain} dB</dd>
                  </>
                )}
                
                {selectedDeviceInfo.threshold_dbfs !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Threshold:</dt>
                    <dd className="text-gray-900 dark:text-gray-200">{selectedDeviceInfo.threshold_dbfs} dBFS</dd>
                  </>
                )}
              </dl>
            </div>
          )}
          
          <form className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Frequency (MHz)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  name="center_frequency"
                  value={scanConfig.center_frequency / 1000000}
                  onChange={handleConfigChange}
                  className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                  step="0.001"
                  min="24"
                  max="1700"
                />
                {scanningDevices.includes(scanConfig.device_index) && (
                  <button
                    type="button"
                    onClick={() => handleTuning('center_frequency', scanConfig.center_frequency / 1000000)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    Tune
                  </button>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Frequency Presets
              </label>
              <div className="flex flex-wrap gap-2">
                {FREQUENCY_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset.frequency)}
                    className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sample Rate
              </label>
              <div className="flex items-center space-x-2">
                <select
                  name="sample_rate"
                  value={scanConfig.sample_rate}
                  onChange={handleConfigChange}
                  className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                >
                  {SAMPLE_RATE_PRESETS.map(preset => (
                    <option key={preset.name} value={preset.rate}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                {scanningDevices.includes(scanConfig.device_index) && (
                  <button
                    type="button"
                    onClick={() => handleTuning('sample_rate', scanConfig.sample_rate)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Gain (dB)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  name="gain"
                  value={scanConfig.gain}
                  onChange={handleConfigChange}
                  min="0"
                  max="50"
                  step="0.1"
                  className="block w-full"
                />
                <span className="w-12 text-center text-sm">{scanConfig.gain}</span>
                {scanningDevices.includes(scanConfig.device_index) && (
                  <button
                    type="button"
                    onClick={() => handleTuning('gain', scanConfig.gain)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Signal Threshold (dBFS)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  name="threshold_dbfs"
                  value={scanConfig.threshold_dbfs}
                  onChange={handleConfigChange}
                  min="-60"
                  max="-10"
                  step="1"
                  className="block w-full"
                />
                <span className="w-12 text-center text-sm">{scanConfig.threshold_dbfs}</span>
                {scanningDevices.includes(scanConfig.device_index) && (
                  <button
                    type="button"
                    onClick={() => handleTuning('threshold_dbfs', scanConfig.threshold_dbfs)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                PPM Correction
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  name="ppm"
                  value={scanConfig.ppm}
                  onChange={handleConfigChange}
                  className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                  step="1"
                  min="-100"
                  max="100"
                />
                {scanningDevices.includes(scanConfig.device_index) && (
                  <button
                    type="button"
                    onClick={() => handleTuning('ppm', scanConfig.ppm)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
            
            <div className="pt-4">
              {scanningDevices.includes(scanConfig.device_index) ? (
                <button
                  type="button"
                  onClick={() => stopScan(scanConfig.device_index)}
                  className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  Stop Scanning
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startScan}
                  className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Start Scanning
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
      
      {/* Active Devices Table */}
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <h2 className="text-lg font-semibold mb-4">Active Devices</h2>
        
        {Object.keys(activeDevices).length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400">No active devices. Start a scan to begin monitoring.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Index</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Frequency</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Sample Rate</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Gain</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {Object.values(activeDevices).map(device => (
                  <tr key={device.index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.index}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {device.center_freq ? formatFrequency(device.center_freq) : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {device.sample_rate ? formatSampleRate(device.sample_rate) : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {device.gain !== undefined ? `${device.gain} dB` : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        device.status === 'connected' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                        device.status === 'idle' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 
                        'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {device.status === 'connected' ? 'Scanning' : 
                         device.status === 'idle' ? 'Ready' : 'Disconnected'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {device.status === 'connected' ? (
                        <button
                          onClick={() => stopScan(device.index)}
                          className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeviceSelect(device.index)}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                          Configure
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default DeviceManager; 