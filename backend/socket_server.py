import socketio
import uvicorn
import logging
import asyncio
import numpy as np
import os
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("socket_server")

# Get CORS origins from environment or use defaults
cors_origins_env = os.environ.get('CORS_ORIGINS', '*')
if cors_origins_env == '*':
    cors_allowed_origins = ['*']
else:
    cors_allowed_origins = cors_origins_env.split(',')
    
logger.info(f"CORS allowed origins: {cors_allowed_origins}")

# Create Socket.IO server with correct ASGI settings
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=cors_allowed_origins,
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25
)

# Use the ASGI app without mixing with uvicorn's websocket protocol
app = socketio.ASGIApp(sio, socketio_path='socket.io', other_asgi_app=None)

# Connection event handlers
@sio.event
async def connect(sid, environ):
    client_origin = environ.get('HTTP_ORIGIN', 'Unknown')
    logger.info(f"Client connected: {sid} from origin: {client_origin}")
    # Notify client of successful connection
    await sio.emit('connection_status', {'status': 'connected'}, room=sid)

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

# Event handler for FFT subscription
@sio.on("subscribe_fft")
async def handle_subscribe_fft(sid, data):
    try:
        device_index = data.get("device_index", 0)
        logger.info(f"Client {sid} subscribing to FFT data for device {device_index}")
        await sio.emit("subscribe_status", {"status": "subscribed", "device_index": device_index}, room=sid)
        
        # Send dummy FFT data for testing
        asyncio.create_task(send_dummy_fft(sid, device_index))
        
    except Exception as e:
        logger.error(f"Error in subscribe_fft: {str(e)}")
        await sio.emit("subscribe_status", {"status": "error", "message": str(e)}, room=sid)

# Event handler for unsubscribing
@sio.on("unsubscribe_fft")
async def handle_unsubscribe_fft(sid, data):
    try:
        device_index = data.get("device_index", 0)
        logger.info(f"Client {sid} unsubscribing from FFT data for device {device_index}")
        await sio.emit("subscribe_status", {"status": "unsubscribed", "device_index": device_index}, room=sid)
    except Exception as e:
        logger.error(f"Error in unsubscribe_fft: {str(e)}")

# Send dummy FFT data for testing purposes
async def send_dummy_fft(sid, device_index):
    try:
        count = 0
        while True:
            # Generate dummy data
            freqs = np.linspace(430e6, 440e6, 1024)
            # Create a power spectrum with a peak
            power = -80 + 10 * np.exp(-((freqs - 433.92e6) / 1e5) ** 2)
            # Add some noise
            power += np.random.normal(0, 1, size=1024)

            # Send the data
            data = {
                "device_index": device_index,
                "frequencies": freqs.tolist(),
                "power": power.tolist(),
                "timestamp": datetime.now().isoformat()
            }
            
            # Emit to the specific client
            event_name = f"fft_data_{device_index}"
            await sio.emit(event_name, data, room=sid)
            
            # Occasional burst detection
            if count % 20 == 0:
                burst = {
                    "id": f"dummy-{count}",
                    "frequency": 433.92e6,
                    "power": -30.0,
                    "timestamp": datetime.now().isoformat(),
                    "duration": 0.25,
                    "bandwidth": 50000.0
                }
                await sio.emit("burst_detected", burst, room=sid)
            
            count += 1
            await asyncio.sleep(0.2)  # 5 updates per second
    
    except asyncio.CancelledError:
        logger.info(f"Dummy FFT task for client {sid} cancelled")
    except Exception as e:
        logger.error(f"Error in dummy FFT task: {str(e)}")

if __name__ == "__main__":
    logger.info(f"Starting Socket.IO server on port 7002 with CORS: {cors_allowed_origins}")
    uvicorn.run(app, host="0.0.0.0", port=7002, log_level="info") 