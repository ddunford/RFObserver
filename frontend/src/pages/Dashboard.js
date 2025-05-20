import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Plot from 'react-plotly.js';
import io from 'socket.io-client';
import { API_URL, SOCKET_URL, deviceApi } from '../utils/api';

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

function Dashboard({ bursts }) {
  const location = useLocation();
  const navigate = useNavigate();
  // State for active devices
  const [activeDevices, setActiveDevices] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  
  // Burst detection state
  const [burstList, setBurstList] = useState([]);
  
  // Tuning state
  const [tuneFrequency, setTuneFrequency] = useState(433.92);
  const [tuneGain, setTuneGain] = useState(40);
  const [tuningStatus, setTuningStatus] = useState(null);
  const [tuningMessage, setTuningMessage] = useState("");
  
  // State for the spectrum display
  const [fftData, setFftData] = useState({
    x: Array.from({ length: 1024 }, (_, i) => i), // Default x values
    y: Array.from({ length: 1024 }, () => -100),  // Default y values
    centerFreq: 0,
    sampleRate: 0
  });

  // Waterfall data
  const [waterfallData, setWaterfallData] = useState({
    z: Array.from({ length: 100 }, () => 
      Array.from({ length: 1024 }, () => -100)
    ),
    x: Array.from({ length: 1024 }, (_, i) => i), 
    y: Array.from({ length: 100 }, (_, i) => i),
  });

  // Ref for tracking waterfall rows
  const waterfallRowRef = useRef(0);
  
  // Set up Socket.IO connection
  useEffect(() => {
    // Only attempt to connect if we don't already have an active socket
    if (socket) return;
    
    console.log("Connecting to WebSocket server at:", SOCKET_URL);
    
    // Initialize Socket.IO with reconnection settings
    const newSocket = io(SOCKET_URL, {
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      timeout: 20000,
      transports: ['websocket'],
      forceNew: true,
      upgrade: false
    });
    
    // Connection events
    newSocket.on('connect', () => {
      console.log("Connected to WebSocket server with ID:", newSocket.id);
      setSocketConnected(true);
      setConnectionError(null);
      
      // Subscribe to FFT data for the selected device if available
      if (selectedDevice !== null) {
        console.log(`Automatically subscribing to device ${selectedDevice} on connect`);
        setTimeout(() => subscribeToDevice(newSocket, selectedDevice), 500);
      }
    });
    
    newSocket.on('connect_error', (error) => {
      console.error("WebSocket connection error:", error);
      setSocketConnected(false);
      setConnectionError(`Failed to connect to WebSocket server: ${error.message}`);
    });
    
    newSocket.on('disconnect', (reason) => {
      console.warn("WebSocket disconnected:", reason);
      setSocketConnected(false);
      
      if (reason === 'io server disconnect' || reason === 'transport close') {
        // Server disconnected us, try to reconnect immediately
        console.log("Attempting immediate reconnection...");
        newSocket.connect();
      }
    });
    
    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`Successfully reconnected on attempt ${attemptNumber}`);
    });
    
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Reconnection attempt ${attemptNumber}...`);
    });
    
    newSocket.on('reconnect_failed', () => {
      console.error("Failed to reconnect after maximum attempts");
      setConnectionError("Failed to reconnect to server after multiple attempts. Please refresh the page.");
    });
    
    // Set socket reference
    setSocket(newSocket);
    
    // Cleanup on unmount
    return () => {
      console.log("Cleaning up WebSocket connection");
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);
  
  // Handle device-specific FFT data updates
  useEffect(() => {
    if (!socket || !selectedDevice) return;
    
    // Debug log
    console.log(`Setting up listeners for device ${selectedDevice}`);
    
    // Handler for FFT data
    const handleFFTData = (data) => {
      console.log(`Received FFT data for device ${selectedDevice}:`, data);
      
      // Validate data structure before processing
      if (!Array.isArray(data.frequencies) || !Array.isArray(data.power) || 
          data.frequencies.length === 0 || data.power.length === 0) {
        console.warn('Received invalid FFT data format:', data);
        return;
      }
      
      // Limit data points for performance on slower devices
      const downsampleFactor = Math.floor(data.frequencies.length / 1024) || 1;
      const frequencies = downsampleFactor > 1 
        ? data.frequencies.filter((_, i) => i % downsampleFactor === 0)
        : data.frequencies;
      const powerValues = downsampleFactor > 1
        ? data.power.filter((_, i) => i % downsampleFactor === 0)
        : data.power;
        
      // Apply smoothing to reduce noise in the display (moving average)
      const smoothedPower = [];
      const smoothingWindow = 3;
      
      for (let i = 0; i < powerValues.length; i++) {
        let sum = 0;
        let count = 0;
        
        for (let j = Math.max(0, i - smoothingWindow); j <= Math.min(powerValues.length - 1, i + smoothingWindow); j++) {
          sum += powerValues[j];
          count++;
        }
        
        smoothedPower.push(sum / count);
      }
      
      // Update FFT data
      setFftData({
        x: frequencies,
        y: smoothedPower,
        centerFreq: frequencies[Math.floor(frequencies.length / 2)],
        sampleRate: Math.abs(frequencies[frequencies.length - 1] - frequencies[0])
      });
      
      // Update waterfall
      updateWaterfall(smoothedPower);
    };
    
    // Handler for burst detection
    const handleBurstDetected = (burstData) => {
      console.log("Burst detected:", burstData);
      
      // Add to burst list if not already present
      setBurstList(prevList => {
        if (!prevList.some(burst => burst.id === burstData.id)) {
          return [...prevList, burstData];
        }
        return prevList;
      });
    };
    
    // Listen for device-specific FFT data
    socket.on(`fft_data_${selectedDevice}`, handleFFTData);
    
    // Listen for burst detection
    socket.on('burst_detected', handleBurstDetected);
    
    // Listen for subscription status
    socket.on('subscribe_status', (status) => {
      console.log("Subscribe status:", status);
      if (status.status === 'subscribed' && status.device_index === selectedDevice) {
        console.log(`Successfully subscribed to device ${selectedDevice}`);
      } else if (status.status === 'error') {
        console.error(`Error subscribing to device ${selectedDevice}:`, status.message);
      }
    });
    
    // Subscribe to FFT data for this device
    subscribeToDevice(socket, selectedDevice);
    
    // Cleanup listeners on unmount or device change
    return () => {
      socket.off(`fft_data_${selectedDevice}`, handleFFTData);
      socket.off('burst_detected', handleBurstDetected);
      socket.off('subscribe_status');
    };
  }, [socket, selectedDevice]);
  
  // Function to subscribe to a device's FFT data
  const subscribeToDevice = (socketInstance, deviceIndex) => {
    if (!socketInstance || !socketInstance.connected) {
      console.warn("Cannot subscribe: Socket not connected");
      return;
    }
    
    console.log(`Subscribing to FFT data for device ${deviceIndex}`);
    socketInstance.emit('subscribe_fft', { device_index: deviceIndex });
  };
  
  // Update waterfall with new FFT data
  const updateWaterfall = (powerData) => {
    // Update waterfall
    setWaterfallData(prev => {
      // Create a new z matrix (deep copy)
      const newZ = [...prev.z];
      
      // Row to update (cyclic buffer)
      const rowToUpdate = waterfallRowRef.current;
      
      // Update the row with new data
      newZ[rowToUpdate] = [...powerData];
      
      // Increment row counter for next update
      waterfallRowRef.current = (waterfallRowRef.current + 1) % 100;
      
      // For the x-axis (frequency), use the current FFT data frequencies
      return {
        ...prev,
        z: newZ
      };
    });
  };
  
  // Get device information on component mount and set up polling
  useEffect(() => {
    // Initial fetch of active devices
    fetchActiveDevices();
    
    // Poll active devices every 5 seconds
    const interval = setInterval(() => {
      fetchActiveDevices();
    }, 5000);
    
    // Check for device in location state (from DeviceManager)
    if (location.state?.selectedDevice !== undefined) {
      setSelectedDevice(location.state.selectedDevice);
    }
    
    return () => clearInterval(interval);
  }, [location.state]);
  
  // When a new device is selected, update tuning controls
  useEffect(() => {
    if (selectedDevice && activeDevices[selectedDevice]) {
      const deviceConfig = activeDevices[selectedDevice];
      if (deviceConfig.center_freq) {
        setTuneFrequency(deviceConfig.center_freq / 1000000);
      }
      if (deviceConfig.gain !== undefined) {
        setTuneGain(deviceConfig.gain);
      }
    }
  }, [selectedDevice, activeDevices]);
  
  // Fetch active devices
  const fetchActiveDevices = async () => {
    try {
      const response = await deviceApi.getAllDeviceInfo();
      const active = {};
      
      // Filter for active devices and create an object keyed by device index
      response.data.forEach(device => {
        if (device.status === 'connected' || device.status === 'idle') {
          active[device.index] = device;
        }
      });
      
      setActiveDevices(active);
      
      // If no devices are active, clear selected device
      if (Object.keys(active).length === 0) {
        setSelectedDevice(null);
      } 
      // If a device is selected but no longer active, clear selection
      else if (selectedDevice && !active[selectedDevice]) {
        setSelectedDevice(null);
      }
      // If no device is selected but active devices exist, select the first one
      else if (selectedDevice === null && Object.keys(active).length > 0) {
        setSelectedDevice(Number(Object.keys(active)[0]));
      }
      
      setLoading(false);
      
    } catch (err) {
      console.error('Error fetching active devices:', err);
      setLoading(false);
    }
  };
  
  // Tune the currently selected device
  const tuneDevice = async () => {
    if (!selectedDevice) return;
    
    try {
      setTuningStatus("tuning");
      
      // Convert MHz to Hz for the API
      const freqHz = tuneFrequency * 1000000;
      
      await deviceApi.tuneDevice(selectedDevice, {
        center_frequency: freqHz,
        gain: tuneGain
      });
      
      setTuningMessage("Device tuned successfully");
      setTuningStatus("success");
      setTimeout(() => setTuningStatus(null), 1500);
    } catch (err) {
      console.error('Error tuning device:', err);
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to tune device");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };
  
  // Apply a preset frequency
  const applyPreset = (frequency) => {
    setTuneFrequency(frequency);
    // If a device is selected, immediately apply the tuning
    if (selectedDevice) {
      tuneDevice();
    }
  };
  
  // Format frequency for display
  const formatFrequency = (freqHz) => {
    return (freqHz / 1e6).toFixed(3) + " MHz";
  };
  
  // Get frequency labels for the FFT plot
  const getFrequencyLabels = () => {
    if (!fftData.x.length) return [];
    
    const centerFreq = fftData.centerFreq;
    const sampleRate = fftData.sampleRate;
    
    if (!centerFreq || !sampleRate) return fftData.x;
    
    return fftData.x.map(x => (centerFreq - sampleRate/2) + (x / fftData.x.length) * sampleRate);
  };
  
  // Navigate to device manager
  const goToDeviceManager = () => {
    navigate('/devices');
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">RF Observer Dashboard</h1>
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
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
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {/* Device Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Active Device</h2>
          
          {loading ? (
            <div className="text-center py-2">
              <p className="text-gray-500 dark:text-gray-400">Loading devices...</p>
            </div>
          ) : Object.keys(activeDevices).length === 0 ? (
            <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 text-yellow-800 dark:text-yellow-200 px-4 py-2 rounded">
              <p>No active SDR devices!</p>
              <button 
                onClick={goToDeviceManager}
                className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              >
                Configure Devices
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={selectedDevice || ''}
                onChange={(e) => setSelectedDevice(Number(e.target.value))}
                className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              >
                {Object.values(activeDevices).map(device => (
                  <option key={device.index} value={device.index}>
                    {device.name} ({formatFrequency(device.center_freq)})
                  </option>
                ))}
              </select>
              
              <button 
                onClick={goToDeviceManager}
                className="w-full px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              >
                Manage Devices
              </button>
            </div>
          )}
        </div>
        
        {/* Frequency Tuning */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Frequency Tuning</h2>
          
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={tuneFrequency}
                onChange={(e) => setTuneFrequency(parseFloat(e.target.value))}
                step="0.01"
                min="24"
                max="1700"
                disabled={!selectedDevice}
                className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">MHz</span>
            </div>
            
            <button
              onClick={tuneDevice}
              disabled={!selectedDevice}
              className={`w-full px-3 py-1 ${
                !selectedDevice 
                  ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed' 
                  : 'bg-green-500 hover:bg-green-600'
              } text-white text-sm rounded`}
            >
              Tune Device
            </button>
            
            <div className="grid grid-cols-2 gap-1 mt-2">
              {FREQUENCY_PRESETS.map((preset, index) => (
                <button
                  key={index}
                  onClick={() => applyPreset(preset.frequency)}
                  disabled={!selectedDevice}
                  className={`px-2 py-1 text-xs ${
                    !selectedDevice 
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed' 
                      : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800'
                  } rounded`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {/* Gain Control */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Gain Control</h2>
          
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="49.6"
                step="0.1"
                value={tuneGain}
                onChange={(e) => setTuneGain(parseFloat(e.target.value))}
                disabled={!selectedDevice}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">{tuneGain} dB</span>
            </div>
            
            <button
              onClick={tuneDevice}
              disabled={!selectedDevice}
              className={`w-full px-3 py-1 ${
                !selectedDevice 
                  ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed' 
                  : 'bg-green-500 hover:bg-green-600'
              } text-white text-sm rounded`}
            >
              Set Gain
            </button>
            
            <div className="grid grid-cols-3 gap-1 mt-2">
              {[0, 20, 40].map((gain) => (
                <button
                  key={gain}
                  onClick={() => {
                    setTuneGain(gain);
                    if (selectedDevice) tuneDevice();
                  }}
                  disabled={!selectedDevice}
                  className={`px-2 py-1 text-xs ${
                    !selectedDevice 
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed' 
                      : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800'
                  } rounded`}
                >
                  {gain} dB
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {/* Device Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Device Status</h2>
          
          {selectedDevice && activeDevices[selectedDevice] ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm">
                <div className="text-gray-500 dark:text-gray-400">Name:</div>
                <div className="text-gray-900 dark:text-gray-200">{activeDevices[selectedDevice].name}</div>
                
                <div className="text-gray-500 dark:text-gray-400">Frequency:</div>
                <div className="text-gray-900 dark:text-gray-200">
                  {formatFrequency(activeDevices[selectedDevice].center_freq)}
                </div>
                
                <div className="text-gray-500 dark:text-gray-400">Sample Rate:</div>
                <div className="text-gray-900 dark:text-gray-200">
                  {(activeDevices[selectedDevice].sample_rate / 1e6).toFixed(3)} MSPS
                </div>
                
                <div className="text-gray-500 dark:text-gray-400">Gain:</div>
                <div className="text-gray-900 dark:text-gray-200">
                  {activeDevices[selectedDevice].gain} dB
                </div>
                
                <div className="text-gray-500 dark:text-gray-400">Status:</div>
                <div className="text-gray-900 dark:text-gray-200">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    activeDevices[selectedDevice].status === 'connected' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                  }`}>
                    {activeDevices[selectedDevice].status === 'connected' ? 'Scanning' : 'Ready'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-2">
              <p className="text-gray-500 dark:text-gray-400">No device selected</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Spectrum Display */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Real-time Spectrum</h2>
          
          {selectedDevice ? (
            <Plot
              data={[
                {
                  x: getFrequencyLabels(),
                  y: fftData.y,
                  type: 'scatter',
                  mode: 'lines',
                  marker: { color: '#4299e1' },
                  hoverinfo: 'x+y',
                  name: 'Power (dBFS)'
                }
              ]}
              layout={{
                autosize: true,
                height: 300,
                margin: { l: 60, r: 40, t: 30, b: 40 },
                xaxis: {
                  title: 'Frequency (MHz)',
                  tickformat: '.3f',
                  gridcolor: '#2d3748',
                  zerolinecolor: '#718096'
                },
                yaxis: {
                  title: 'Power (dBFS)',
                  range: [-100, 0],
                  gridcolor: '#2d3748',
                  zerolinecolor: '#718096'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: {
                  color: '#e2e8f0'
                },
                hovermode: 'closest',
                showlegend: false
              }}
              config={{
                responsive: true,
                displayModeBar: false
              }}
              className="w-full"
            />
          ) : (
            <div className="flex items-center justify-center h-[300px] bg-gray-100 dark:bg-gray-700 rounded">
              <p className="text-gray-500 dark:text-gray-400">Select a device to view spectrum</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Waterfall Display */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Waterfall</h2>
          
          {selectedDevice ? (
            <Plot
              data={[
                {
                  z: waterfallData.z,
                  x: getFrequencyLabels(),
                  y: waterfallData.y,
                  type: 'heatmap',
                  colorscale: 'Jet',
                  zmin: -100,
                  zmax: -20,
                  hoverinfo: 'x+y+z'
                }
              ]}
              layout={{
                autosize: true,
                height: 300,
                margin: { l: 60, r: 40, t: 10, b: 40 },
                xaxis: {
                  title: 'Frequency (MHz)',
                  tickformat: '.3f',
                  gridcolor: '#2d3748',
                  zerolinecolor: '#718096'
                },
                yaxis: {
                  title: 'Time',
                  autorange: 'reversed',
                  gridcolor: '#2d3748',
                  zerolinecolor: '#718096'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: {
                  color: '#e2e8f0'
                }
              }}
              config={{
                responsive: true,
                displayModeBar: false
              }}
              className="w-full"
            />
          ) : (
            <div className="flex items-center justify-center h-[300px] bg-gray-100 dark:bg-gray-700 rounded">
              <p className="text-gray-500 dark:text-gray-400">Select a device to view waterfall</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Recent Bursts */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Recent Signal Bursts</h2>
          
          {bursts.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-500 dark:text-gray-400">No signal bursts detected yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Time</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Device</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Frequency</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Duration</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Peak Power</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {bursts.slice(-10).reverse().map((burst, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                        {new Date(burst.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {burst.device_index}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatFrequency(burst.center_freq)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {burst.duration.toFixed(3)} s
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {burst.peak_power.toFixed(1)} dBFS
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;