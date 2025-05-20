import axios from 'axios';

// Get API URL from environment or fallback to default
export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7001';
export const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:7002';

console.log('API URL:', API_URL);
console.log('Socket URL:', SOCKET_URL);

// Create Axios client with base URL and timeout
const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,  // Increase timeout to 30 seconds
  headers: {
    'Content-Type': 'application/json'
  }
});

// Device API functions
export const deviceApi = {
  // Get list of available devices
  getDevices: () => apiClient.get('/api/devices', { 
    timeout: 15000,
    retry: 3,
    retryDelay: 1000
  }),
  
  // Get detailed information for all devices
  getAllDeviceInfo: () => apiClient.get('/api/devices/all', { 
    timeout: 15000,
    retry: 3,
    retryDelay: 1000
  }),
  
  // Start scanning on a device
  startScan: (config) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    return apiClient.post('/api/start_scan', config, { 
      timeout: 10000,
      signal: controller.signal
    }).finally(() => {
      clearTimeout(timeoutId);
    }).catch(error => {
      // If it's a timeout, the scan might have started anyway
      if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
        console.log('Start scan request timed out, assuming success');
        return { data: { status: "started", device_index: config.device_index } };
      }
      throw error;
    });
  },
  
  // Stop scanning on a device
  stopScan: (deviceIndex) => apiClient.post('/api/stop_scan', { device_index: deviceIndex }, { 
    timeout: 10000 
  }),
  
  // Tune device parameters
  tuneDevice: (deviceIndex, params) => apiClient.post(`/api/tune/${deviceIndex}`, params, { 
    timeout: 10000 
  }),
  
  // Get FFT data for a specific burst
  getFftData: (fftDataId) => apiClient.get(`/api/fft_data/${fftDataId}`, { 
    timeout: 10000 
  }),
  
  // Get IQ preview data for visualization
  getIqPreview: (burstId) => apiClient.get(`/api/iq_preview/${burstId}`, { 
    timeout: 10000 
  }),
  
  // Get download URL for IQ file
  getIqDownloadUrl: (burstId) => `${API_URL}/api/download_iq/${burstId}`
};

// Socket functions (documentation only, actual implementation is in components)
export const socketEvents = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECTION_ERROR: 'connect_error',
  CONNECTION_STATUS: 'connection_status',
  SUBSCRIBE_FFT: 'subscribe_fft',
  UNSUBSCRIBE_FFT: 'unsubscribe_fft',
  BURST_DETECTED: 'burst_detected',
  SUBSCRIBE_STATUS: 'subscribe_status'
}; 