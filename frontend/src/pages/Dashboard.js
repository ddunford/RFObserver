import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import Plot from 'react-plotly.js';
import io from 'socket.io-client';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7001';
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:7002';

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
  // State for active devices
  const [devices, setDevices] = useState([]);
  const [activeDevices, setActiveDevices] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  
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
    const newSocket = io(SOCKET_URL, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling']
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
      setError(null);
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err);
      setError(`WebSocket connection error: ${err.message}. Check if the backend is running.`);
    });
    
    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });
    
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Attempting to reconnect (${attemptNumber})...`);
    });
    
    newSocket.on('burst_detected', (data) => {
      console.log('Burst detected:', data);
    });
    
    setSocket(newSocket);
    
    // Clean up on unmount
    return () => {
      if (newSocket) {
        console.log('Closing WebSocket connection');
        newSocket.close();
      }
    };
  }, []);
  
  // Handle device-specific FFT data updates
  useEffect(() => {
    if (!socket || !selectedDevice) return;
    
    const handleFFTData = (data) => {
      if (!data || !data.device_index || data.device_index !== selectedDevice) return;
      
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
    
    const fftEventName = `fft_data_${selectedDevice}`;
    socket.on(fftEventName, handleFFTData);
    
    // Subscribe to FFT data for this device
    socket.emit('subscribe_fft', { device_index: selectedDevice });
    console.log(`Subscribed to FFT data for device ${selectedDevice}`);
    
    // Cleanup: remove event listener and unsubscribe
    return () => {
      socket.off(fftEventName);
      socket.emit('unsubscribe_fft', { device_index: selectedDevice });
      console.log(`Unsubscribed from FFT data for device ${selectedDevice}`);
    };
  }, [socket, selectedDevice]);
  
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
  
  // Fetch devices on component mount
  useEffect(() => {
    fetchDevices();
    
    // Poll device status every 5 seconds
    const interval = setInterval(() => {
      fetchActiveDevices();
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Set initial device selection based on route or first available device
  useEffect(() => {
    // Check if a device was selected from the device manager
    if (location.state?.selectedDevice !== undefined) {
      setSelectedDevice(location.state.selectedDevice);
    } else if (devices.length > 0 && !selectedDevice) {
      // Select the first device if none is selected
      setSelectedDevice(devices[0].index);
    }
  }, [devices, selectedDevice, location.state]);
  
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

  // Fetch available devices
  const fetchDevices = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/devices`);
      setDevices(response.data);
      
      // If no device is selected yet, select the first one
      if (response.data.length > 0 && !selectedDevice) {
        setSelectedDevice(response.data[0].index);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('Failed to load devices. Check if the backend is running.');
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch active devices
  const fetchActiveDevices = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/devices/all`);
      const active = {};
      
      // Filter for active devices and create an object keyed by device index
      response.data.forEach(device => {
        if (device.status === 'connected' || device.status === 'idle') {
          active[device.index] = device;
        }
      });
      
      setActiveDevices(active);
    } catch (err) {
      console.error('Error fetching active devices:', err);
    }
  };
  
  // Start a scan on the selected device
  const startScan = async () => {
    try {
      if (!selectedDevice) return;
      
      const config = {
        device_index: selectedDevice,
        center_frequency: tuneFrequency * 1000000,
        sample_rate: 2048000,
        gain: tuneGain,
        ppm: 0,
        threshold_dbfs: -35,
        min_burst_duration: 0.1
      };
      
      await axios.post(`${API_URL}/api/start_scan`, config);
      setTuningStatus("success");
      setTuningMessage(`Started scan on device ${selectedDevice}`);
      setTimeout(() => setTuningStatus(null), 1500);
      
      fetchActiveDevices();
    } catch (err) {
      console.error('Error starting scan:', err);
      setError('Failed to start scan. Check the device configuration.');
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to start scan");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };
  
  // Stop a scan on a device
  const stopScan = async (deviceIndex) => {
    try {
      await axios.post(`${API_URL}/api/stop_scan/${deviceIndex}`);
      setTuningStatus("success");
      setTuningMessage(`Stopped scan on device ${deviceIndex}`);
      setTimeout(() => setTuningStatus(null), 1500);
      
      fetchActiveDevices();
    } catch (err) {
      console.error('Error stopping scan:', err);
      setError('Failed to stop scan.');
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Failed to stop scan");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };
  
  // Tune a device to a new frequency
  const tuneDevice = async () => {
    if (!selectedDevice || !activeDevices[selectedDevice]) return;
    
    try {
      setTuningStatus("tuning");
      const params = {
        center_frequency: tuneFrequency * 1000000,
        gain: tuneGain
      };
      
      await axios.post(`${API_URL}/api/tune/${selectedDevice}`, params);
      setTuningStatus("success");
      setTuningMessage("Frequency tuned successfully");
      setTimeout(() => setTuningStatus(null), 1500);
      
      // Update local state
      fetchActiveDevices();
    } catch (err) {
      console.error('Error tuning device:', err);
      setTuningStatus("error");
      setTuningMessage(err.response?.data?.detail || "Tuning failed");
      setTimeout(() => setTuningStatus(null), 1500);
    }
  };
  
  // Apply a preset frequency
  const applyPreset = (frequency) => {
    setTuneFrequency(frequency);
    if (selectedDevice && activeDevices[selectedDevice] && activeDevices[selectedDevice].status === 'connected') {
      // If device is already active, tune it immediately
      setTimeout(() => tuneDevice(), 100);
    }
  };

  // Format frequency for display
  const formatFrequency = (freqHz) => {
    return (freqHz / 1e6).toFixed(3) + " MHz";
  };

  // Calculate frequency labels for the spectrum plot
  const getFrequencyLabels = () => {
    if (!selectedDevice || !activeDevices[selectedDevice]) return [];
    
    const device = activeDevices[selectedDevice];
    if (!device.center_freq || !device.sample_rate) return [];
    
    const centerFreq = device.center_freq;
    const sampleRate = device.sample_rate;
    
    // Calculate frequency range
    const startFreq = centerFreq - (sampleRate / 2);
    const endFreq = centerFreq + (sampleRate / 2);
    
    // Create labels
    return [
      formatFrequency(startFreq),
      formatFrequency(startFreq + sampleRate * 0.25),
      formatFrequency(centerFreq),
      formatFrequency(endFreq - sampleRate * 0.25),
      formatFrequency(endFreq)
    ];
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
        {/* Device Selection */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-2">Device Selection</h2>
          
          {loading ? (
            <div className="text-center py-2">
              <p className="text-gray-500 dark:text-gray-400">Loading devices...</p>
            </div>
          ) : devices.length === 0 ? (
            <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 text-yellow-800 dark:text-yellow-200 px-4 py-2 rounded">
              <p>No SDR devices found!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={selectedDevice || ''}
                onChange={(e) => setSelectedDevice(Number(e.target.value))}
                className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              >
                {devices.map(device => (
                  <option key={device.index} value={device.index}>
                    {device.name} (Index: {device.index})
                  </option>
                ))}
              </select>
              
              {selectedDevice !== null && (
                <div className="flex space-x-2 pt-2">
                  {activeDevices[selectedDevice]?.status === 'connected' ? (
                    <button
                      onClick={() => stopScan(selectedDevice)}
                      className="w-full px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                    >
                      Stop Scan
                    </button>
                  ) : (
                    <button
                      onClick={startScan}
                      className="w-full px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                    >
                      Start Scan
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Frequency Tuning */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-2">Frequency Tuning</h2>
          
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={tuneFrequency}
                onChange={(e) => setTuneFrequency(parseFloat(e.target.value))}
                className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                step="0.001"
                min="24"
                max="1700"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">MHz</span>
              <button
                onClick={tuneDevice}
                disabled={!selectedDevice || !activeDevices[selectedDevice] || activeDevices[selectedDevice]?.status !== 'connected'}
                className={`px-3 py-1 text-white text-sm rounded ${
                  !selectedDevice || !activeDevices[selectedDevice] || activeDevices[selectedDevice]?.status !== 'connected'
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                Tune
              </button>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {FREQUENCY_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset.frequency)}
                  className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
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
          
          <div className="space-y-4">
            <div>
              <input
                type="range"
                value={tuneGain}
                onChange={(e) => setTuneGain(parseFloat(e.target.value))}
                min="0"
                max="50"
                step="0.1"
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>0 dB</span>
                <span>{tuneGain.toFixed(1)} dB</span>
                <span>50 dB</span>
              </div>
            </div>
            
            <button
              onClick={tuneDevice}
              disabled={!selectedDevice || !activeDevices[selectedDevice] || activeDevices[selectedDevice]?.status !== 'connected'}
              className={`w-full px-3 py-1 text-white text-sm rounded ${
                !selectedDevice || !activeDevices[selectedDevice] || activeDevices[selectedDevice]?.status !== 'connected'
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              Apply Gain
            </button>
          </div>
        </div>
      </div>
      
      {/* Spectrum Display */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">
            Real-Time Spectrum
            {selectedDevice !== null && activeDevices[selectedDevice] && (
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                ({formatFrequency(activeDevices[selectedDevice].center_freq || 0)})
              </span>
            )}
          </h2>
          
          <div className="h-64 w-full">
            <Plot
              data={[
                {
                  x: fftData.x,
                  y: fftData.y,
                  type: 'scatter',
                  mode: 'lines',
                  line: { color: '#4299E1' },
                  name: 'Signal Power'
                }
              ]}
              layout={{
                margin: { l: 60, r: 40, t: 20, b: 40 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'rgba(0,0,0,0.02)',
                font: { color: '#718096' },
                xaxis: {
                  title: 'Frequency',
                  tickvals: [0, 256, 512, 768, 1023],
                  ticktext: getFrequencyLabels(),
                  gridcolor: 'rgba(0,0,0,0.1)'
                },
                yaxis: {
                  title: 'Power (dBFS)',
                  range: [-70, -10],
                  gridcolor: 'rgba(0,0,0,0.1)'
                }
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      </div>
      
      {/* Waterfall Display */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Waterfall</h2>
          
          <div className="h-64 w-full">
            <Plot
              data={[
                {
                  z: waterfallData.z,
                  type: 'heatmap',
                  colorscale: 'Jet',
                  showscale: false,
                  zmin: -70,
                  zmax: -10
                }
              ]}
              layout={{
                margin: { l: 60, r: 40, t: 20, b: 40 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'rgba(0,0,0,0.02)',
                font: { color: '#718096' },
                xaxis: {
                  title: 'Frequency',
                  tickvals: [0, 256, 512, 768, 1023],
                  ticktext: getFrequencyLabels(),
                  gridcolor: 'rgba(0,0,0,0.1)'
                },
                yaxis: {
                  title: 'Time',
                  autorange: 'reversed',
                  showticklabels: false,
                  gridcolor: 'rgba(0,0,0,0.1)'
                }
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      </div>
      
      {/* Active Devices Table */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
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
                    <tr 
                      key={device.index} 
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        selectedDevice === device.index ? 'bg-blue-50 dark:bg-blue-900' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.index}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{device.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {device.center_freq ? formatFrequency(device.center_freq) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {device.sample_rate ? (device.sample_rate / 1e6).toFixed(3) + ' MSPS' : 'N/A'}
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
                          {device.status === 'connected' ? 'Scanning' : 'Ready'}
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
                            onClick={() => {
                              setSelectedDevice(device.index);
                              startScan();
                            }}
                            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                          >
                            Start
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
      
      {/* Recent Bursts */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Recent Signal Bursts</h2>
          
          {bursts.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-500 dark:text-gray-400">No signal bursts detected yet. Start a scan and wait for signals.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Frequency</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Power</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Bandwidth</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Duration</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {bursts.slice(0, 10).map(burst => (
                    <tr key={burst.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{burst.id.substring(0, 8)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatFrequency(burst.frequency)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {burst.power.toFixed(1)} dBFS
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {(burst.bandwidth / 1000).toFixed(1)} kHz
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {burst.duration.toFixed(3)} s
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {new Date(burst.timestamp).toLocaleTimeString()}
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