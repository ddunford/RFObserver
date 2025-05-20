import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../utils/api';

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
  const [scanningDevices, setScanningDevices] = useState([]);

  // Debug API connection
useEffect(() => {
  console.log("API_URL:", API_URL);
  
  // Check for common API URL mistakes
  if (API_URL.includes('70001')) {
    console.error("Incorrect port detected in API_URL - should be 7001, not 70001");
  }
  
  // Check if we can connect to the API
  axios.get(`${API_URL}/`)
    .then(response => console.log("API connection check successful:", response.data))
    .catch(err => {
      console.error("API connection failed:", err);
      
      // Detect specific connection issues
      if (err.code === 'ECONNREFUSED') {
        console.error(`Cannot connect to ${API_URL}. Is the backend server running?`);
        setError(`Cannot connect to backend at ${API_URL}. Is the server running?`);
      } else if (err.message.includes('Network Error')) {
        console.error("Network error when connecting to backend. Check URL and CORS settings.");
        setError("Network error when connecting to backend. Check if the URL is correct.");
      }
    });
}, []); // Empty dependency array to run only once

  // Handle error messages more effectively with better descriptions
  const handleFetchErrors = (err, defaultMessage) => {
    if ((err.message && err.message.includes('Device not found')) || 
        (err.response?.data?.detail?.includes('not found'))) {
      return `Device disappeared or was disconnected. Please refresh device list.`;
    } else if ((err.message && err.message.includes('LIBUSB_ERROR_BUSY')) || 
              (err.response?.data?.detail?.includes('Resource busy'))) {
      return `Device is busy or in use by another application. Try disconnecting and reconnecting the device.`;
    } else if ((err.message && err.message.includes('USB transfer error')) || 
              (err.response?.data?.detail?.includes('USB transfer error'))) {
      return `USB communication error. The device might have been disconnected.`;
    } else if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      return `Cannot connect to backend at ${API_URL}. Please make sure the backend server is running.`;
    } else {
      return defaultMessage || `An error occurred. Please try refreshing the device list.`;
    }
  };

  // Fetch available devices with better error handling
  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true);
      console.log("Fetching devices from:", `${API_URL}/api/devices`);
      const response = await axios.get(`${API_URL}/api/devices`);
      console.log("Devices response:", response.data);
      setDevices(response.data);
      
      // Clear error state if successful
      setError(null);
      
      // If we have a device selected, check if it's still in the list
      if (scanConfig.device_index !== null) {
        const deviceExists = response.data.some(d => d.index === scanConfig.device_index);
        if (!deviceExists) {
          if (response.data.length > 0) {
            // Select the first available device
            setScanConfig(prev => ({
              ...prev,
              device_index: response.data[0].index
            }));
            
            // If the previously selected device isn't in the list, show a notification
            if (selectedDeviceInfo) {
              setError(`Device ${selectedDeviceInfo.index} is no longer available. Selected device ${response.data[0].index} instead.`);
              setSelectedDeviceInfo(null);
            }
          } else {
            // No devices available
            setSelectedDeviceInfo(null);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
      console.error('Error details:', err.response?.data || err.message);
      
      // Use the enhanced error handler
      const errorMessage = handleFetchErrors(
        err, 
        'Failed to load devices. Check if the backend is running and the device has proper permissions.'
      );
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [scanConfig.device_index, selectedDeviceInfo]);

  // Fetch active device information
  const fetchActiveDevices = useCallback(async () => {
    try {
      console.log("Fetching active devices from:", `${API_URL}/api/devices/all`);
      const response = await axios.get(`${API_URL}/api/devices/all`);
      console.log("Active devices response:", response.data);
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
      console.error('Error details:', err.response?.data || err.message);
      
      // Don't set an error message for active devices to avoid duplicating error messages
      // We'll let the fetchDevices error handling take care of displaying errors
      if (err.message && err.message.includes('ERR_INSUFFICIENT_RESOURCES')) {
        console.error('USB resource error detected when fetching active devices');
      }
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
    
    // No need to call setRefreshInterval which causes the loop
    
    // Clean up on unmount
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fetchDevices, fetchActiveDevices]);

  // Auto-retry connection when there's an error
  useEffect(() => {
    let retryTimer = null;
    
    if (error) {
      console.log('Error detected, scheduling retry in 5 seconds...');
      retryTimer = setTimeout(() => {
        console.log('Attempting automatic retry...');
        fetchDevices();
      }, 5000);
    }
    
    return () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [error, fetchDevices]);

  // Start a scan on a device with better error handling and fallback mechanism
  const startScan = async () => {
    try {
      setTuningStatus("tuning");
      setTuningMessage("Starting scan...");
      
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      // Make the request with a timeout
      const response = await axios.post(`${API_URL}/api/start_scan`, scanConfig, {
        signal: controller.signal,
        timeout: 10000 // 10 second timeout
      }).catch(error => {
        if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
          // If it's a timeout, assume scan started successfully anyway
          console.log('Start scan request timed out, assuming scan started successfully');
          return { data: { status: "started", device_index: scanConfig.device_index } };
        }
        throw error;
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      console.log('Scan started:', response.data);
      
      // Update active devices list regardless of response
      fetchActiveDevices();
      
      // Fetch the detailed device info
      fetchDeviceDetails(scanConfig.device_index);
      
      // Show success message
      setTuningStatus("success");
      setTuningMessage(`Started scan on device ${scanConfig.device_index}. Navigating to Dashboard...`);
      
      // Automatically navigate to Dashboard after a short delay
      setTimeout(() => {
        navigate('/', { state: { selectedDevice: scanConfig.device_index } });
      }, 1500);
    } catch (err) {
      console.error('Error starting scan:', err);
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to start scan");
      
      // Try to fetch device status anyway, the scan might have started despite the error
      fetchActiveDevices();
    }
  };

  // Stop a scan on a device with better error handling
  const stopScan = async (deviceIndex) => {
    try {
      setTuningStatus("tuning");
      setTuningMessage("Stopping scan...");
      
      const response = await axios.post(`${API_URL}/api/stop_scan`, { device_index: deviceIndex });
      console.log('Scan stopped:', response.data);
      
      // Update active devices list
      fetchActiveDevices();
      fetchDevices(); // Also refresh the device list
      
      // Clear selected device info if it was the current device
      if (selectedDeviceInfo && selectedDeviceInfo.index === deviceIndex) {
        setSelectedDeviceInfo(null);
      }
      
      // Show success message
      setTuningStatus("success");
      setTuningMessage(`Stopped scan on device ${deviceIndex}`);
      setTimeout(() => setTuningStatus(null), 1500);
      
      // Clear any errors
      setError(null);
    } catch (err) {
      console.error('Error stopping scan:', err);
      const errorMessage = handleFetchErrors(err, 'Failed to stop scan. The device may have been disconnected.');
      setError(errorMessage);
      
      // Force a refresh of the device list after a failure
      setTimeout(() => fetchDevices(), 1000);
      
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
    } catch (err) {
      console.error('Error tuning device:', err);
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to tune device");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };

  // Fetch details for a specific device
  const fetchDeviceDetails = async (deviceIndex) => {
    try {
      // Find the device in our existing devices list first
      const existingDevice = devices.find(d => d.index === deviceIndex);
      if (existingDevice) {
        // Use existing device data instead of making an API call
        setSelectedDeviceInfo(existingDevice);
        return;
      }
      
      // Fall back to API call if not found in existing list
      const response = await axios.get(`${API_URL}/api/devices/${deviceIndex}`);
      setSelectedDeviceInfo(response.data);
    } catch (err) {
      console.error('Error fetching device details:', err);
      // If API call fails, still try to use data from existing devices list
      const existingDevice = devices.find(d => d.index === deviceIndex);
      if (existingDevice) {
        setSelectedDeviceInfo(existingDevice);
      }
    }
  };

  // Handle form input changes
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
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Device Management & Configuration</h1>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchDevices}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Refresh Devices
          </button>
          
          <button
            onClick={goToDashboard}
            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            disabled={!Object.keys(activeDevices).length}
          >
            View Dashboard
          </button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
          <div className="flex justify-between items-center">
            <p>{error}</p>
            <button 
              onClick={() => {
                setError(null);
                fetchDevices();
              }}
              className="ml-4 px-2 py-1 bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 text-sm rounded hover:bg-red-300 dark:hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
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
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <h2 className="text-lg font-semibold mb-4">Available RTL-SDR Devices</h2>
        
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Select a device below to configure and start scanning. Once your device is set up, 
            you can view real-time data in the Dashboard.
          </p>
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
              
              {scanningDevices.includes(selectedDeviceInfo.index) && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">Frequency:</dt>
                  <dd className="text-gray-900 dark:text-gray-200">
                    {formatFrequency(activeDevices[selectedDeviceInfo.index]?.center_frequency || 0)}
                  </dd>
                  
                  <dt className="text-gray-500 dark:text-gray-400">Sample Rate:</dt>
                  <dd className="text-gray-900 dark:text-gray-200">
                    {formatSampleRate(activeDevices[selectedDeviceInfo.index]?.sample_rate || 0)}
                  </dd>
                  
                  <dt className="text-gray-500 dark:text-gray-400">Gain:</dt>
                  <dd className="text-gray-900 dark:text-gray-200">
                    {activeDevices[selectedDeviceInfo.index]?.gain || 0} dB
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium mb-3">Frequency Settings</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Center Frequency
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    name="center_frequency"
                    value={scanConfig.center_frequency / 1000000}
                    onChange={(e) => handleConfigChange({
                      target: {
                        name: 'center_frequency',
                        value: e.target.value
                      }
                    })}
                    min="24"
                    max="1700"
                    step="0.001"
                    className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                  <span className="flex items-center text-sm text-gray-500 dark:text-gray-400">MHz</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-1">
                {FREQUENCY_PRESETS.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => applyPreset(preset.frequency)}
                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sample Rate
                </label>
                <div className="flex space-x-2">
                  <select
                    name="sample_rate"
                    value={scanConfig.sample_rate}
                    onChange={handleConfigChange}
                    className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    {SAMPLE_RATE_PRESETS.map(preset => (
                      <option key={preset.rate} value={preset.rate}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-3">Gain & Detection Settings</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Gain ({scanConfig.gain} dB)
                </label>
                <input
                  type="range"
                  name="gain"
                  value={scanConfig.gain}
                  onChange={handleConfigChange}
                  min="0"
                  max="49.6"
                  step="0.1"
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>0 dB</span>
                  <span>49.6 dB</span>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  PPM Correction
                </label>
                <input
                  type="number"
                  name="ppm"
                  value={scanConfig.ppm}
                  onChange={handleConfigChange}
                  min="-100"
                  max="100"
                  className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Detection Threshold ({scanConfig.threshold_dbfs} dBFS)
                </label>
                <input
                  type="range"
                  name="threshold_dbfs"
                  value={scanConfig.threshold_dbfs}
                  onChange={handleConfigChange}
                  min="-70"
                  max="-10"
                  step="1"
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>-70 dB</span>
                  <span>-10 dB</span>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Min Burst Duration (s)
                </label>
                <input
                  type="number"
                  name="min_burst_duration"
                  value={scanConfig.min_burst_duration}
                  onChange={handleConfigChange}
                  min="0.01"
                  max="2"
                  step="0.01"
                  className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-6 flex space-x-3">
          <button
            onClick={startScan}
            disabled={scanningDevices.includes(scanConfig.device_index) || !selectedDeviceInfo}
            className={`px-4 py-2 rounded-md ${
              scanningDevices.includes(scanConfig.device_index) || !selectedDeviceInfo
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            Start Scanning
          </button>
          
          <button
            onClick={() => stopScan(scanConfig.device_index)}
            disabled={!scanningDevices.includes(scanConfig.device_index)}
            className={`px-4 py-2 rounded-md ${
              !scanningDevices.includes(scanConfig.device_index)
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            Stop Scanning
          </button>
          
          <button
            onClick={goToDashboard}
            disabled={!scanningDevices.length}
            className={`px-4 py-2 rounded-md ml-auto ${
              !scanningDevices.length
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            View in Dashboard
          </button>
        </div>
      </div>
      
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <h2 className="text-lg font-semibold mb-4">Active Devices</h2>
        
        {Object.keys(activeDevices).length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400">No active devices. Configure and start a device above to begin monitoring.</p>
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