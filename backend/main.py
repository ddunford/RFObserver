from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import socketio
import asyncio
import logging
import os
import json
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from datetime import datetime

# Import the real SDR handler
from sdr_handler import SDRManager

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("rf_observer")

# Create FastAPI app
app = FastAPI(
    title="RF Observer API",
    description="Backend API for RF Observer SDR scanning platform",
    version="0.1.0",
)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode="asgi", 
    cors_allowed_origins=["*"]
)
socket_app = socketio.ASGIApp(sio)

# Mount the Socket.IO app
app.mount("/ws", socket_app)

# Data models
class DeviceConfig(BaseModel):
    device_index: int
    center_frequency: int
    sample_rate: int
    gain: float
    ppm: int = 0
    threshold_dbfs: float = -35.0
    min_burst_duration: float = 0.1

class TuneConfig(BaseModel):
    center_frequency: Optional[int] = None
    sample_rate: Optional[int] = None
    gain: Optional[float] = None
    ppm: Optional[int] = None
    threshold_dbfs: Optional[float] = None

class BurstData(BaseModel):
    id: str
    frequency: float
    power: float
    timestamp: datetime
    duration: float
    bandwidth: float
    iq_file: Optional[str] = None

# Initialize the SDR Manager with real hardware
sdr_manager = SDRManager()
connected_clients = set()

# Store FFT update tasks
fft_update_tasks = {}

# WebSocket handler for real-time burst data
async def broadcast_burst(burst):
    """Send burst data to all connected WebSocket clients"""
    # Make the datetime JSON serializable
    if isinstance(burst["timestamp"], datetime):
        burst["timestamp"] = burst["timestamp"].isoformat()
    
    await sio.emit("burst_detected", burst)
    logger.debug(f"Real burst detected: {burst['id']} at {burst['frequency']/1e6:.3f} MHz, {burst['power']:.1f} dBFS")

# Register the broadcast callback for all devices
sdr_manager.register_global_burst_callback(broadcast_burst)

# FFT data callback for real-time updates
async def broadcast_fft(device_index, fft_data):
    """Send FFT data to connected clients for a specific device"""
    try:
        # Convert numpy arrays to lists for JSON serialization
        data_to_send = {
            "device_index": device_index,
            "frequencies": fft_data["frequencies"].tolist(),
            "power": fft_data["power"].tolist(),
            "timestamp": datetime.now().isoformat()
        }
        
        await sio.emit(f"fft_data_{device_index}", data_to_send)
    except Exception as e:
        logger.error(f"Error broadcasting FFT data: {str(e)}")

# Start FFT data streaming for a device
async def start_fft_streaming(device_index):
    """Start streaming FFT data for a specific device"""
    if device_index in fft_update_tasks and not fft_update_tasks[device_index].done():
        logger.info(f"FFT streaming already running for device {device_index}")
        return
    
    # Create async task for FFT updates
    async def fft_update_loop():
        logger.info(f"Starting FFT update loop for device {device_index}")
        error_count = 0
        max_errors = 10
        try:
            while True:
                try:
                    device = sdr_manager.get_device(device_index)
                    if not device:
                        logger.warning(f"Device {device_index} not found, pausing FFT updates")
                        await asyncio.sleep(1.0)
                        continue
                    
                    if not device.running:
                        # Device is not actively scanning
                        await asyncio.sleep(0.5)
                        continue
                    
                    # Check if device is connected and has samples
                    if not device.sample_buffer:
                        await asyncio.sleep(0.1)
                        continue
                        
                    # Get current FFT data
                    fft_data = device.get_fft_data()
                    if fft_data and isinstance(fft_data, dict) and 'frequencies' in fft_data and 'power' in fft_data:
                        await broadcast_fft(device_index, fft_data)
                        # Reset error count on successful processing
                        error_count = 0
                    else:
                        error_count += 1
                        logger.warning(f"Invalid FFT data from device {device_index}, attempt {error_count}/{max_errors}")
                        if error_count >= max_errors:
                            logger.error(f"Too many FFT errors for device {device_index}, stopping FFT stream")
                            break
                
                    # Adaptive update rate based on client count
                    client_count = len(await sio.get_session_count())
                    
                    # More clients = slower updates to reduce bandwidth
                    delay = min(0.1 * (1 + (client_count // 5)), 0.5)
                    
                    # Update at reasonable rate (adaptive between 2-10 FPS)
                    await asyncio.sleep(delay)
                    
                except asyncio.CancelledError:
                    logger.info(f"FFT update loop for device {device_index} cancelled")
                    raise
                except Exception as e:
                    error_count += 1
                    logger.error(f"Error in FFT update loop for device {device_index}: {str(e)}")
                    
                    if error_count >= max_errors:
                        logger.error(f"Too many errors in FFT streaming for device {device_index}, stopping")
                        break
                        
                    # Gradually increase sleep time on repeated errors
                    await asyncio.sleep(min(0.5 * error_count, 5.0))
        
        except asyncio.CancelledError:
            logger.info(f"FFT update loop for device {device_index} cancelled")
        except Exception as e:
            logger.error(f"Fatal error in FFT update loop for device {device_index}: {str(e)}")
    
    # Store and start the task
    fft_update_tasks[device_index] = asyncio.create_task(fft_update_loop())
    
    # Create a watchdog task to restart the FFT stream if it crashes
    async def fft_watchdog():
        while True:
            await asyncio.sleep(5.0)  # Check every 5 seconds
            
            if device_index not in fft_update_tasks or fft_update_tasks[device_index].done():
                if device_index in fft_update_tasks and fft_update_tasks[device_index].done():
                    # Try to get exception info if available
                    try:
                        exc = fft_update_tasks[device_index].exception()
                        if exc:
                            logger.error(f"FFT task for device {device_index} failed with: {str(exc)}")
                    except (asyncio.InvalidStateError, Exception) as e:
                        pass
                
                logger.warning(f"FFT stream for device {device_index} stopped, restarting...")
                fft_update_tasks[device_index] = asyncio.create_task(fft_update_loop())
    
    # Start the watchdog
    asyncio.create_task(fft_watchdog())

# Stop FFT data streaming for a device
async def stop_fft_streaming(device_index):
    """Stop streaming FFT data for a specific device"""
    if device_index in fft_update_tasks and not fft_update_tasks[device_index].done():
        fft_update_tasks[device_index].cancel()
        try:
            await fft_update_tasks[device_index]
        except asyncio.CancelledError:
            pass
        logger.info(f"Stopped FFT streaming for device {device_index}")

# Routes
@app.get("/")
async def root():
    return {"message": "RF Observer API is running with Real RTL-SDR Support"}

@app.get("/api/devices")
async def get_devices():
    """Get list of available SDR devices"""
    try:
        # Force a rescan of devices with timeout
        logger.info("API request: Getting device list")
        
        # Use a timeout to prevent hanging
        async def scan_devices_with_timeout():
            # Run the scan_for_devices method in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, sdr_manager.scan_for_devices)
        
        try:
            # Set a timeout of 5 seconds for the scan
            devices_indices = await asyncio.wait_for(scan_devices_with_timeout(), timeout=5.0)
            
            # Get device info for each found device
            devices = []
            for idx in devices_indices:
                try:
                    device = sdr_manager.get_device(idx)
                    if device:
                        info = device.get_device_info()
                        devices.append({
                            "index": idx,
                            "name": info.get("name", "Unknown"),
                            "serial": info.get("serial", "Unknown"),
                            "status": info.get("status", "unknown")
                        })
                except Exception as device_error:
                    logger.error(f"Error getting info for device {idx}: {str(device_error)}")
                    devices.append({
                        "index": idx,
                        "name": "Error",
                        "serial": "Error",
                        "status": "error",
                        "error": str(device_error)
                    })
            
            logger.info(f"Returning {len(devices)} RTL-SDR devices")
            return devices
        
        except asyncio.TimeoutError:
            logger.error("Timeout while scanning for devices")
            return {"error": "Timeout while scanning for devices"}
        
    except Exception as e:
        logger.error(f"Error getting devices: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get devices: {str(e)}")

@app.post("/api/start_scan")
async def start_scan(config: DeviceConfig):
    """Start scanning with a specific SDR device"""
    try:
        # Convert the model to a dict for the SDR manager
        config_dict = config.dict()
        
        # Use a timeout to prevent hanging
        async def start_scan_with_timeout():
            # Run the start_scan method in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, 
                lambda: sdr_manager.start_scan(config.device_index, config_dict)
            )
        
        try:
            # Set a timeout of 10 seconds for starting the scan
            success = await asyncio.wait_for(start_scan_with_timeout(), timeout=10.0)
            
            if not success:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Failed to start scan on device {config.device_index}"
                )
            
            # Start FFT streaming for this device
            await start_fft_streaming(config.device_index)
                
            logger.info(f"Starting scan on real device with config: {config}")
            return {"status": "started", "device": config.device_index}
            
        except asyncio.TimeoutError:
            logger.error(f"Timeout while starting scan on device {config.device_index}")
            raise HTTPException(
                status_code=504,
                detail=f"Timeout while starting scan on device {config.device_index}"
            )
            
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error starting scan: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error starting scan: {str(e)}"
        )

@app.post("/api/stop_scan/{device_index}")
async def stop_scan(device_index: int):
    """Stop scanning on a specific device"""
    try:
        success = sdr_manager.stop_scan(device_index)
        
        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Device {device_index} not found or not active"
            )
        
        # Stop FFT streaming for this device    
        await stop_fft_streaming(device_index)
            
        return {"status": "stopped", "device": device_index}
    except Exception as e:
        logger.error(f"Error stopping scan: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error stopping scan: {str(e)}"
        )

@app.get("/api/bursts")
async def get_bursts():
    """Get all detected bursts"""
    try:
        bursts = sdr_manager.get_all_bursts()
        
        # Make datetime JSON serializable
        for burst in bursts:
            if isinstance(burst["timestamp"], datetime):
                burst["timestamp"] = burst["timestamp"].isoformat()
                
        return bursts
    except Exception as e:
        logger.error(f"Error getting bursts: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error getting bursts: {str(e)}"
        )

@app.get("/api/download/{filename}")
async def download_iq_file(filename: str):
    """Download IQ data file"""
    try:
        from fastapi.responses import FileResponse
        
        # Validate filename (security check)
        if ".." in filename or "/" in filename:
            raise HTTPException(
                status_code=400,
                detail="Invalid filename"
            )
            
        # Build path to the file
        filepath = os.path.join(os.path.dirname(__file__), 'data', filename)
        
        if not os.path.exists(filepath):
            raise HTTPException(
                status_code=404,
                detail=f"File {filename} not found"
            )
            
        return FileResponse(filepath, media_type="application/octet-stream", filename=filename)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading file: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error downloading file: {str(e)}"
        )

@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    
    try:
        while True:
            # Keep connection alive, handle client messages
            data = await websocket.receive_text()
            await websocket.send_text(f"Message received: {data}")
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        if websocket in connected_clients:
            connected_clients.remove(websocket)

@sio.event
async def connect(sid, environ):
    logger.info(f"Socket.IO client connected: {sid}")
    
@sio.event
async def disconnect(sid):
    logger.info(f"Socket.IO client disconnected: {sid}")

@app.on_event("startup")
async def startup_event():
    logger.info("Starting RF Observer Backend with real SDR support")
    # Perform initial device scan at startup
    devices = sdr_manager.scan_for_devices()
    logger.info(f"Found {len(devices)} RTL-SDR devices on startup")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down RF Observer Backend")
    # Stop all FFT streaming tasks
    for device_index, task in fft_update_tasks.items():
        if not task.done():
            task.cancel()
            try:
                # Wait for cancellation to complete with timeout
                await asyncio.wait_for(asyncio.shield(task), timeout=1.0)
            except asyncio.TimeoutError:
                logger.warning(f"FFT task for device {device_index} did not stop in time")
            except asyncio.CancelledError:
                pass
    
    # Stop all active scans
    for device_index in sdr_manager.devices.keys():
        try:
            sdr_manager.stop_scan(device_index)
        except Exception as e:
            logger.error(f"Error stopping device {device_index} during shutdown: {str(e)}")

@app.post("/api/tune/{device_index}")
async def tune_device(device_index: int, tune_config: TuneConfig):
    """Tune a specific device in real-time"""
    try:
        async def tune_with_timeout():
            # Run the tune_device method in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                lambda: sdr_manager.tune_device(
                    device_index,
                    tune_config.center_frequency,
                    tune_config.gain,
                    tune_config.sample_rate,
                    tune_config.ppm,
                    tune_config.threshold_dbfs
                )
            )
        
        try:
            # Set a timeout for tuning
            success, message = await asyncio.wait_for(tune_with_timeout(), timeout=5.0)
            
            if not success:
                raise HTTPException(
                    status_code=400,
                    detail=message
                )
                
            # Notify clients about the tune change
            device_info = sdr_manager.get_device(device_index).get_device_info()
            await sio.emit("device_tuned", {
                "device_index": device_index,
                "center_freq": device_info.get("center_freq"),
                "gain": device_info.get("gain"),
                "sample_rate": device_info.get("sample_rate"),
                "timestamp": datetime.now().isoformat()
            })
                
            return {"status": "tuned", "device": device_index, "changes": message}
            
        except asyncio.TimeoutError:
            logger.error(f"Timeout while tuning device {device_index}")
            raise HTTPException(
                status_code=504,
                detail=f"Timeout while tuning device {device_index}"
            )
            
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error tuning device: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error tuning device: {str(e)}"
        )

@app.get("/api/device/{device_index}")
async def get_device_info(device_index: int):
    """Get detailed information about a specific device"""
    try:
        async def get_info_with_timeout():
            # Run the get_device_info method in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            device = sdr_manager.get_device(device_index)
            if not device:
                return None
            return await loop.run_in_executor(None, device.get_device_info)
        
        try:
            # Set a timeout for getting device info
            device_info = await asyncio.wait_for(get_info_with_timeout(), timeout=5.0)
            
            if device_info is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Device {device_index} not found"
                )
                
            return device_info
            
        except asyncio.TimeoutError:
            logger.error(f"Timeout while getting info for device {device_index}")
            raise HTTPException(
                status_code=504,
                detail=f"Timeout while getting device info"
            )
            
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error getting device info: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error getting device info: {str(e)}"
        )

@app.get("/api/devices/all")
async def get_all_devices_info():
    """Get information about all devices"""
    try:
        async def get_all_info_with_timeout():
            # Run the get_all_device_info method in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, sdr_manager.get_all_device_info)
        
        try:
            # Set a timeout for getting all device info
            all_devices_info = await asyncio.wait_for(get_all_info_with_timeout(), timeout=5.0)
            return all_devices_info
            
        except asyncio.TimeoutError:
            logger.error("Timeout while getting all device info")
            raise HTTPException(
                status_code=504,
                detail="Timeout while getting all device info"
            )
            
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error getting all device info: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error getting all device info: {str(e)}"
        )

# Socket.IO event handler for subscribing to device FFT data
@sio.on("subscribe_fft")
async def handle_subscribe_fft(sid, data):
    try:
        device_index = int(data.get("device_index", 0))
        # Start FFT streaming for the device if not already running
        await start_fft_streaming(device_index)
        await sio.emit("subscribe_status", {"status": "subscribed", "device_index": device_index}, room=sid)
    except Exception as e:
        logger.error(f"Error in subscribe_fft: {str(e)}")
        await sio.emit("subscribe_status", {"status": "error", "message": str(e)}, room=sid)

# Socket.IO event handler for unsubscribing from device FFT data
@sio.on("unsubscribe_fft")
async def handle_unsubscribe_fft(sid, data):
    try:
        device_index = int(data.get("device_index", 0))
        # We don't stop streaming here as other clients might be using it
        # Just acknowledge the unsubscribe
        await sio.emit("subscribe_status", {"status": "unsubscribed", "device_index": device_index}, room=sid)
    except Exception as e:
        logger.error(f"Error in unsubscribe_fft: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7001) 