from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
import os
import json
import numpy as np
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from datetime import datetime
import threading
import uuid
import glob
import subprocess
import concurrent.futures
import time

# Import SDR handler
from sdr_handler import SDRManager

# Helper worker functions for thread pool
def _start_scan_worker(config):
    """Worker function to start scanning on a device"""
    try:
        device_index = config.device_index
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            
            # Convert config to dict for the device
            config_dict = {
                "center_frequency": config.center_frequency,
                "sample_rate": config.sample_rate,
                "gain": config.gain,
                "ppm": config.ppm,
                "threshold_dbfs": config.threshold_dbfs,
                "min_burst_duration": config.min_burst_duration
            }
            
            # Start scanning with the config
            # The SDRDevice.start_scan method accepts a config parameter
            device.start_scan(config_dict)
            return True
    except Exception as e:
        logger.error(f"Error in _start_scan_worker: {str(e)}")
    return False

def _stop_scan_worker(device_index):
    """Worker function to stop scanning on a device"""
    try:
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            device.stop_scan()
            return True
    except Exception as e:
        logger.error(f"Error in _stop_scan_worker: {str(e)}")
    return False

def _tune_device_worker(device_index, changes):
    """Worker function to tune device parameters"""
    try:
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            device.tune_parameters(changes)
            return True
    except Exception as e:
        logger.error(f"Error in _tune_device_worker: {str(e)}")
    return False

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("rf_observer")

# Initialize SDR Manager
sdr_manager = SDRManager()
# Scan for devices immediately during startup
sdr_manager.scan_for_devices()
connected_clients = set()

# Data directory for IQ files
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Create thread pool executor for non-blocking operations
thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)

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

class StopRequest(BaseModel):
    device_index: int

# Create FastAPI app
app = FastAPI(
    title="RF Observer API",
    description="Backend API for RF Observer SDR scanning platform",
    version="0.1.0",
)

# Setup CORS
cors_origins_env = os.environ.get('CORS_ORIGINS', '*')
if cors_origins_env == '*':
    cors_allowed_origins = ['*']
else:
    cors_allowed_origins = cors_origins_env.split(',')

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
@app.get("/")
async def root():
    return {"message": "RF Observer API is running"}

@app.get("/api/devices")
async def get_devices():
    """Get list of available SDR devices"""
    logger.info("API request: Getting device list")
    
    # First, kill any stray rtl processes that might be holding device resources
    try:
        subprocess.run(['pkill', '-f', 'rtl_'], timeout=1)
        logger.info("Killed any lingering rtl_ processes before device scan")
        await asyncio.sleep(0.5)  # Give the system time to release resources
    except Exception as e:
        logger.warning(f"Error killing rtl processes: {str(e)}")
    
    # Run device scan in a background task with timeout
    try:
        # Use a timeout to prevent hanging
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                thread_pool,
                sdr_manager.scan_for_devices
            ),
            timeout=2.0  # 2 second timeout
        )
    except asyncio.TimeoutError:
        logger.warning("Timeout when scanning for devices, using cached device list")
    except Exception as e:
        logger.error(f"Error scanning for devices: {str(e)}")
    
    # Now get the device list (this is fast as it doesn't access hardware)
    devices = []
    for idx, device in sdr_manager.devices.items():
        devices.append({
            "index": idx,
            "name": device.device_name,
            "serial": device.device_serial,
            "status": "connected" if device.running else "idle"
        })
    
    if not devices:
        logger.warning("No RTL-SDR devices were found after multiple attempts")
    else:
        logger.info(f"Found {len(devices)} available RTL-SDR devices")
    
    return devices

@app.get("/api/devices/all")
async def get_all_devices_info():
    """Get information about all devices"""
    logger.info("API request: Getting all device info")
    
    # Run device info gathering in a background task with timeout
    try:
        # Use a timeout to prevent hanging
        devices_info = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                thread_pool,
                sdr_manager.get_all_device_info
            ),
            timeout=2.0  # 2 second timeout
        )
        return devices_info
    except asyncio.TimeoutError:
        logger.warning("Timeout when getting device info, returning cached data")
        # Return whatever info we have without waiting
        return sdr_manager.get_cached_device_info()
    except Exception as e:
        logger.error(f"Error getting all device info: {str(e)}")
        # Return an empty list if there's an error
        return []

@app.get("/api/devices/{device_index}")
async def get_device_by_index(device_index: int):
    """Get detailed information about a specific device"""
    logger.info(f"API request: Getting device info for device {device_index}")
    
    try:
        # Convert string to int if needed
        if isinstance(device_index, str) and device_index.isdigit():
            device_index = int(device_index)
            
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            config = device.config or {}
            
            return {
                "index": device_index,
                "name": device.device_name,
                "serial": device.device_serial,
                "status": "connected" if device.running else "idle",
                "center_frequency": config.get("center_frequency", 433920000),
                "sample_rate": config.get("sample_rate", 2048000),
                "gain": config.get("gain", 40.0),
                "ppm": config.get("ppm", 0),
                "threshold_dbfs": config.get("threshold_dbfs", -35.0),
                "capabilities": {
                    "tunable": True,
                    "min_freq": 24000000,
                    "max_freq": 1700000000
                }
            }
        else:
            # Return 404 if device not found
            raise HTTPException(status_code=404, detail=f"Device {device_index} not found")
    except Exception as e:
        logger.error(f"Error retrieving device info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving device info: {str(e)}")

@app.get("/api/fft_data/{fft_data_id}")
async def get_fft_data(fft_data_id: str):
    """Get FFT data for a specific burst capture"""
    logger.info(f"API request: Getting FFT data for ID {fft_data_id}")
    
    try:
        # Look for FFT data in device's capture history
        for device_idx, device in sdr_manager.devices.items():
            # Check if device has detected bursts with this ID
            for burst in device.detected_bursts:
                if burst.get("id") == fft_data_id or burst.get("fft_data_id") == fft_data_id:
                    # Get the FFT data if available
                    if "fft_data" in burst:
                        return burst["fft_data"]
                    
                    # Or check if a file exists (example path: data/fft_a1b2c3.json)
                    fft_file = os.path.join(DATA_DIR, f"fft_{fft_data_id}.json")
                    if os.path.exists(fft_file):
                        with open(fft_file, 'r') as f:
                            return json.load(f)
        
        # If not found in memory, check all JSON files in data directory
        fft_files = glob.glob(os.path.join(DATA_DIR, "fft_*.json"))
        for file in fft_files:
            if fft_data_id in file:
                with open(file, 'r') as f:
                    return json.load(f)
                    
        # If nothing found, return empty data
        return {"frequencies": [], "power": []}
    except Exception as e:
        logger.error(f"Error retrieving FFT data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving FFT data: {str(e)}")

@app.get("/api/iq_preview/{burst_id}")
async def get_iq_preview(burst_id: str):
    """Get IQ data preview for visualization"""
    logger.info(f"API request: Getting IQ preview for burst {burst_id}")
    
    try:
        # Find the burst in device history
        for device_idx, device in sdr_manager.devices.items():
            for burst in device.detected_bursts:
                if burst.get("id") == burst_id:
                    # Get IQ filename if available
                    iq_file = burst.get("iq_file")
                    if iq_file and os.path.exists(iq_file):
                        # Load the IQ file (just a small portion for preview)
                        samples = np.fromfile(iq_file, dtype=np.complex64, count=10000)
                        if len(samples) > 0:
                            # Generate time domain data
                            time_values = np.arange(len(samples)) / device.config.get("sample_rate", 2.048e6)
                            # Get the amplitude (I component for simplicity in preview)
                            amplitude = np.real(samples)
                            
                            # Normalize if needed
                            if np.max(np.abs(amplitude)) > 0:
                                amplitude = amplitude / np.max(np.abs(amplitude))
                                
                            return {
                                "time": time_values.tolist(),
                                "amplitude": amplitude.tolist()
                            }
        
        # If not found or no data, return empty arrays
        return {"time": [], "amplitude": []}
    except Exception as e:
        logger.error(f"Error generating IQ preview: {str(e)}")
        return {"time": [], "amplitude": [], "error": str(e)}

@app.get("/api/download_iq/{burst_id}")
async def download_iq_file(burst_id: str):
    """Download IQ data file for a burst"""
    logger.info(f"API request: Downloading IQ file for burst {burst_id}")
    
    try:
        # Find the burst in device history
        for device_idx, device in sdr_manager.devices.items():
            for burst in device.detected_bursts:
                if burst.get("id") == burst_id:
                    # Get IQ filename if available
                    iq_file = burst.get("iq_file")
                    if iq_file and os.path.exists(iq_file):
                        # Read the file content
                        with open(iq_file, 'rb') as f:
                            file_content = f.read()
                            
                        # Create filename from burst info
                        filename = f"burst_{burst_id}_{int(burst.get('frequency', 0)/1e6)}MHz.iq"
                        
                        # Return file as download
                        return Response(
                            content=file_content,
                            media_type="application/octet-stream",
                            headers={"Content-Disposition": f"attachment; filename={filename}"}
                        )
        
        # If file not found
        raise HTTPException(status_code=404, detail="IQ file not found")
    except Exception as e:
        logger.error(f"Error downloading IQ file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error downloading IQ file: {str(e)}")

# Start/stop scan endpoints
@app.post("/api/start_scan")
async def start_scan(config: DeviceConfig):
    """Start scanning on specified device with configuration"""
    device_index = config.device_index
    logger.info(f"API request: Starting scan on device {device_index}")
    
    if device_index not in sdr_manager.devices:
        sdr_manager.scan_for_devices()
    
    if device_index in sdr_manager.devices:
        device = sdr_manager.devices[device_index]
        
        # Convert config to dict for the device
        config_dict = {
            "center_frequency": config.center_frequency,
            "sample_rate": config.sample_rate,
            "gain": config.gain,
            "ppm": config.ppm,
            "threshold_dbfs": config.threshold_dbfs,
            "min_burst_duration": config.min_burst_duration
        }
        
        # Launch scan in background without waiting for completion
        asyncio.create_task(
            asyncio.get_event_loop().run_in_executor(
                thread_pool, 
                _start_scan_worker,
                config
            )
        )
        
        # Return success immediately without waiting
        logger.info(f"Initiated scan on device {device_index}")
        return {"status": "initiated", "device_index": device_index}
    else:
        raise HTTPException(status_code=404, detail=f"Device {device_index} not found")

@app.post("/api/stop_scan")
async def stop_scan(request: StopRequest):
    """Stop scanning on specified device"""
    device_index = request.device_index
    
    if device_index in sdr_manager.devices:
        # Run in thread pool to avoid blocking
        success = await asyncio.get_event_loop().run_in_executor(
            thread_pool, 
            _stop_scan_worker,
            device_index
        )
        
        if success:
            return {"status": "stopped", "device_index": device_index}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to stop scanning on device {device_index}")
    else:
        raise HTTPException(status_code=404, detail=f"Device {device_index} not found")

@app.post("/api/tune/{device_index}")
async def tune_device(device_index: int, tune_config: TuneConfig):
    """Tune parameters on a running device"""
    logger.info(f"API request: Tuning device {device_index}")
    
    try:
        # Convert string to int if needed
        if isinstance(device_index, str) and device_index.isdigit():
            device_index = int(device_index)
            
        if device_index in sdr_manager.devices:
            device = sdr_manager.devices[device_index]
            
            # Create a dict of changes
            changes = {}
            change_descriptions = []
            
            if tune_config.center_frequency is not None:
                changes["center_frequency"] = tune_config.center_frequency
                change_descriptions.append(f"frequency to {tune_config.center_frequency/1e6:.3f} MHz")
                
            if tune_config.sample_rate is not None:
                changes["sample_rate"] = tune_config.sample_rate
                change_descriptions.append(f"sample rate to {tune_config.sample_rate/1e6:.3f} MSPS")
                
            if tune_config.gain is not None:
                changes["gain"] = tune_config.gain
                change_descriptions.append(f"gain to {tune_config.gain} dB")
                
            if tune_config.ppm is not None:
                changes["ppm"] = tune_config.ppm
                change_descriptions.append(f"PPM to {tune_config.ppm}")
                
            if tune_config.threshold_dbfs is not None:
                changes["threshold_dbfs"] = tune_config.threshold_dbfs
                change_descriptions.append(f"threshold to {tune_config.threshold_dbfs} dBFS")
            
            # Run in thread pool to avoid blocking
            success = await asyncio.get_event_loop().run_in_executor(
                thread_pool, 
                _tune_device_worker,
                device_index,
                changes
            )
            
            if success:
                return {
                    "status": "tuned", 
                    "device_index": device_index,
                    "changes": f"Changed {', '.join(change_descriptions)}"
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to tune device parameters")
        else:
            raise HTTPException(status_code=404, detail=f"Device {device_index} not found")
    except Exception as e:
        logger.error(f"Error tuning device parameters: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error tuning device parameters: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7001) 