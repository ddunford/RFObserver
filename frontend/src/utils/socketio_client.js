import io from 'socket.io-client';

// Determine the Socket.IO URL - try to get from nginx proxy first
const getSocketUrl = () => {
  // Current hostname (allows working through nginx)
  const currentHost = window.location.hostname;
  
  // Environment variable or default based on deployment
  if (process.env.REACT_APP_SOCKET_URL) {
    return process.env.REACT_APP_SOCKET_URL;
  }

  // If we're accessing through nginx (production)
  if (window.location.port === '80' || window.location.port === '443' || window.location.port === '') {
    return `${window.location.protocol}//${currentHost}/socket.io`;
  }

  // Development fallbacks
  if (currentHost === 'localhost') {
    return 'http://localhost:7002';
  }
  
  // Docker network fallback
  return `${window.location.protocol}//${currentHost}:7002`;
};

// Configure and create socket instance
const socket = io(getSocketUrl(), {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  autoConnect: true
});

// Debug connection issues
socket.on('connect', () => {
  console.log('Socket connected successfully to', getSocketUrl());
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err);
  console.log('Attempted to connect to:', getSocketUrl());
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
});

export default socket; 