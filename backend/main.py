from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
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
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize placeholder for SDR Manager
sdr_manager = None
connected_clients = set()

# Routes
@app.get("/")
async def root():
    return {"message": "RF Observer API is running"}

@app.get("/api/devices")
async def get_devices():
    """Get list of available SDR devices"""
    logger.info("API request: Getting device list (SDR DISABLED)")
    # Return dummy data for testing
    devices = [
        {"index": 0, "name": "Dummy SDR Device", "serial": "0000001", "status": "idle"}
    ]
    return devices

@app.get("/api/devices/all")
async def get_all_devices_info():
    """Get information about all devices"""
    logger.info("API request: Getting all device info (SDR DISABLED)")
    # Return dummy data for testing
    return [
        {
            "index": 0,
            "name": "Dummy SDR",
            "serial": "0000001",
            "status": "idle",
            "center_freq": 433920000,
            "sample_rate": 2048000,
            "gain": 40.0
        }
    ]

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7001) 