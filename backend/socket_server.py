import socketio
import uvicorn
import logging
import asyncio
import numpy as np
import os
import concurrent.futures
import threading
import time
import queue
from datetime import datetime
from socketio import AsyncServer

# Import SDR handler
from sdr_handler import SDRManager

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
sio = AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=cors_allowed_origins,
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25
)

# Use the ASGI app without mixing with uvicorn's websocket protocol
app = socketio.ASGIApp(sio, socketio_path='socket.io', other_asgi_app=None)

# Initialize SDR Manager
sdr_manager = SDRManager()

# Thread pool for callback processing
callback_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

# Event queues for each client to avoid directly calling socket operations from SDR thread
# This will be a dictionary of {sid: queue.Queue()}
client_queues = {}
client_queue_lock = threading.Lock()

# Track client tasks
client_tasks = {}
client_connections = set()

# Background task to process queued events
async def process_event_queues():
    """Process events from all client queues and emit them via WebSockets"""
    while True:
        try:
            # Make a copy of the queues to avoid modification during iteration
            with client_queue_lock:
                current_queues = {sid: q for sid, q in client_queues.items()}
            
            for sid, event_queue in current_queues.items():
                try:
                    # Process up to 10 events per client per iteration to ensure fairness
                    for _ in range(10):
                        try:
                            # Non-blocking get with timeout
                            event_data = event_queue.get(block=False)
                            event_type, data = event_data
                            
                            # Emit the event
                            await sio.emit(event_type, data, room=sid)
                            
                            # Mark task as done
                            event_queue.task_done()
                        except queue.Empty:
                            # No more events for this client
                            break
                except Exception as e:
                    logger.error(f"Error processing events for client {sid}: {str(e)}")
            
            # Short sleep to prevent CPU hogging
            await asyncio.sleep(0.05)
        except Exception as e:
            logger.error(f"Error in event queue processing: {str(e)}")
            await asyncio.sleep(0.1)  # Longer sleep on error

# Event handler for client connection
@sio.event
async def connect(sid, environ):
    client_ip = environ.get('REMOTE_ADDR', 'unknown')
    origin = environ.get('HTTP_ORIGIN', 'unknown')
    logger.info(f"Client connected: {sid} from origin: {origin}")
    
    # Create a queue for this client
    with client_queue_lock:
        client_queues[sid] = queue.Queue()
    
    client_connections.add(sid)
    await sio.emit("connection_status", {"status": "connected"}, room=sid)

# Event handler for client disconnection
@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")
    client_connections.remove(sid) if sid in client_connections else None
    
    # Clean up the client's queue
    with client_queue_lock:
        if sid in client_queues:
            del client_queues[sid]
    
    # Clean up any tasks
    if sid in client_tasks:
        for task in client_tasks[sid]:
            if not task.done():
                task.cancel()
        del client_tasks[sid]

# Event handler for FFT subscription
@sio.on("subscribe_fft")
async def handle_subscribe_fft(sid, data):
    try:
        device_index = data.get("device_index", 0)
        logger.info(f"Client {sid} subscribing to FFT data for device {device_index}")
        
        # Initialize client task list if not exists
        if sid not in client_tasks:
            client_tasks[sid] = []
            
        # Check if device exists
        if device_index not in sdr_manager.devices:
            logger.warning(f"Device {device_index} not found, scanning for devices")
            sdr_manager.scan_for_devices()
            
        # Get or create device
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            
            # Create a throttled callback for FFT data
            def fft_callback(fft_data):
                try:
                    # Add device_index to the FFT data
                    fft_data["device_index"] = device_index
                    
                    # Downsample data for bandwidth efficiency
                    downsample_factor = max(1, len(fft_data["frequencies"]) // 1024)
                    
                    if downsample_factor > 1:
                        frequencies = fft_data["frequencies"][::downsample_factor]
                        power = fft_data["power"][::downsample_factor]
                    else:
                        frequencies = fft_data["frequencies"]
                        power = fft_data["power"]
                    
                    # Create a smaller data packet
                    streamlined_data = {
                        "frequencies": frequencies,
                        "power": power,
                        "device_index": device_index,
                        "timestamp": time.time()
                    }
                    
                    # Only include max 1024 points for efficient transport
                    logger.debug(f"FFT data prepared: freqs={len(streamlined_data['frequencies'])}, power={len(streamlined_data['power'])}")
                    
                    # Queue the event instead of directly emitting it
                    with client_queue_lock:
                        if sid in client_queues:
                            # Use put_nowait to avoid blocking the SDR thread
                            try:
                                client_queues[sid].put_nowait((f"fft_data_{device_index}", streamlined_data))
                            except queue.Full:
                                # Queue is full, drop this sample
                                pass
                except Exception as e:
                    logger.error(f"Error in FFT callback queueing: {str(e)}")
            
            # Register callback for burst detection
            def burst_callback(burst_data):
                try:
                    # Queue the event instead of directly emitting it
                    with client_queue_lock:
                        if sid in client_queues:
                            try:
                                client_queues[sid].put_nowait(("burst_detected", burst_data))
                            except queue.Full:
                                # Queue is full, might need to drop this event
                                pass
                except Exception as e:
                    logger.error(f"Error in burst callback queueing: {str(e)}")
            
            # Register callbacks with a unique identifier for this client
            device.register_fft_callback(fft_callback)
            device.register_burst_callback(burst_callback)
            
            # Start scanning if not already
            if not device.running:
                logger.info(f"Starting scan on device {device_index} for client {sid}")
                try:
                    device.start_scan()
                    logger.info(f"Successfully started scan on device {device_index}")
                except Exception as e:
                    logger.error(f"Failed to start scan on device {device_index}: {str(e)}")
                    await sio.emit("subscribe_status", {"status": "error", "message": f"Failed to start scan: {str(e)}"}, room=sid)
                    return
            else:
                logger.info(f"Device {device_index} is already scanning for client {sid}")
                
            # Send a success message immediately
            await sio.emit("subscribe_status", {"status": "subscribed", "device_index": device_index}, room=sid)
            
            # Send a test FFT data packet to confirm subscription is working
            test_fft = {"frequencies": [433.9e6], "power": [-50.0], "device_index": device_index, "test": True}
            await sio.emit(f"fft_data_{device_index}", test_fft, room=sid)
        else:
            # No physical devices found, try to scan for devices again
            logger.error(f"No physical SDR device found at index {device_index}")
            # Try to scan for devices explicitly
            sdr_manager.scan_for_devices()
            
            # Check if scanning helped
            if device_index in sdr_manager.devices:
                device = sdr_manager.devices[device_index]
                
                # Register callbacks
                device.register_fft_callback(fft_callback)
                device.register_burst_callback(burst_callback)
                
                # Start scanning if not already
                if not device.running:
                    device.start_scan()
                    
                await sio.emit("subscribe_status", {"status": "subscribed", "device_index": device_index}, room=sid)
            else:
                # Still no device found
                await sio.emit("subscribe_status", {
                    "status": "error", 
                    "message": f"No physical SDR device found at index {device_index}. Please check device connection."
                }, room=sid)
        
    except Exception as e:
        logger.error(f"Error in subscribe_fft: {str(e)}")
        await sio.emit("subscribe_status", {"status": "error", "message": str(e)}, room=sid)

# Event handler for unsubscribing
@sio.on("unsubscribe_fft")
async def handle_unsubscribe_fft(sid, data):
    try:
        device_index = data.get("device_index", 0)
        logger.info(f"Client {sid} unsubscribing from FFT data for device {device_index}")
        
        # Cancel tasks if needed
        if sid in client_tasks and device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            # We can't easily remove specific callbacks, but we can stop scanning if no clients are subscribed
            # This is a simplified approach - a more complex one would track callbacks per client
            
        await sio.emit("subscribe_status", {"status": "unsubscribed", "device_index": device_index}, room=sid)
    except Exception as e:
        logger.error(f"Error in unsubscribe_fft: {str(e)}")
        await sio.emit("subscribe_status", {"status": "error", "message": str(e)}, room=sid)

# Start the event queue processor when the server starts
@sio.on("connect")
async def start_queue_processor(sid, environ):
    # Only start the queue processor once
    if not hasattr(start_queue_processor, "started"):
        start_queue_processor.started = True
        asyncio.create_task(process_event_queues())

if __name__ == "__main__":
    logger.info(f"Starting Socket.IO server on port 7002 with CORS: {cors_allowed_origins}")
    uvicorn.run(app, host="0.0.0.0", port=7002, log_level="info") 