"""
RTL-SDR Hardware Handler Module
This module provides direct interfaces with physical RTL-SDR devices.
"""

import logging
import numpy as np
import threading
import time
from rtlsdr import RtlSdr
from datetime import datetime
import uuid
import os
import asyncio
import subprocess
import json
import usb.core
import usb.util

logger = logging.getLogger("rf_observer.sdr")

class SDRDevice:
    """
    Handles a physical RTL-SDR device and provides methods for scanning,
    signal detection, and IQ data recording.
    """
    def __init__(self, device_index, config=None):
        self.device_index = device_index
        self.sdr = None
        self.running = False
        self.scan_thread = None
        self.config = config or {}
        self.sample_buffer = []
        self.detected_bursts = []
        self.burst_callbacks = []
        self.fft_callbacks = []
        self.waterfall_data = []
        self.data_dir = os.path.join(os.path.dirname(__file__), 'data')
        os.makedirs(self.data_dir, exist_ok=True)
        # Store device info
        self.device_name = "RTL-SDR"
        self.device_serial = "unknown"
        self.device_connected = False
        
    def connect(self):
        """Connect to the physical RTL-SDR device"""
        try:
            # First check if the device is accessible via USB
            try:
                rtl_devices = list(usb.core.find(find_all=True, idVendor=0x0bda, idProduct=0x2838))
                if not rtl_devices:
                    logger.warning(f"No RTL-SDR devices found on USB bus before connection attempt")
                else:
                    logger.info(f"Found {len(rtl_devices)} RTL-SDR devices on USB bus")
            except Exception as usb_err:
                logger.warning(f"Could not check USB devices: {str(usb_err)}")
        
            # Try to get device info before opening
            try:
                self.device_name = RtlSdr.get_device_name(self.device_index) or "RTL-SDR"
                self.device_serial = RtlSdr.get_device_serial(self.device_index) or "unknown"
                logger.info(f"Found device name: {self.device_name}, serial: {self.device_serial}")
            except Exception as info_err:
                logger.warning(f"Could not get device info for index {self.device_index}: {str(info_err)}")
                # Try command line tools as backup method
                try:
                    result = subprocess.run(['rtl_test', '-d', str(self.device_index)], 
                                           capture_output=True, text=True, timeout=2)
                    if "Found" in result.stderr:
                        # Extract device name from rtl_test output if possible
                        for line in result.stderr.splitlines():
                            if "Found" in line and ":" in line:
                                self.device_name = line.split(":", 1)[1].strip()
                                logger.info(f"Found device via rtl_test: {self.device_name}")
                except Exception as rtl_test_err:
                    logger.warning(f"rtl_test also failed: {str(rtl_test_err)}")
            
            # Open the device with multiple attempts and error handling
            attempt = 0
            max_attempts = 3
            last_error = None
            
            while attempt < max_attempts:
                try:
                    logger.info(f"Attempting to connect to REAL SDR device at index {self.device_index} (attempt {attempt+1}/{max_attempts})")
                    self.sdr = RtlSdr(self.device_index)
                    break  # Successful connection
                except Exception as conn_err:
                    last_error = conn_err
                    logger.warning(f"Connection attempt {attempt+1} failed: {str(conn_err)}")
                    
                    # Check if device was opened by another process
                    if "Resource busy" in str(conn_err):
                        logger.error("Device is busy - it may be used by another program")
                        # Try to kill any rtl_* processes
                        try:
                            subprocess.run(["pkill", "-f", "rtl_"], timeout=1)
                            logger.info("Attempted to terminate competing rtl_ processes")
                        except Exception:
                            pass
                    
                    attempt += 1
                    time.sleep(1.0)
            
            if not self.sdr:
                logger.error(f"All connection attempts failed: {str(last_error)}")
                return False
            
            # Apply configuration
            self.apply_config(self.config)
            
            # Mark as connected
            self.device_connected = True
            
            logger.info(f"Successfully connected to RTL-SDR device {self.device_index} - Name: {self.device_name}, Serial: {self.device_serial}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to RTL-SDR device {self.device_index}: {str(e)}")
            self.device_connected = False
            return False
    
    def apply_config(self, config):
        """Apply configuration to the RTL-SDR device"""
        if not self.sdr:
            return False
        
        try:
            # Get configuration with defaults
            center_freq = config.get("center_frequency", 433.92e6)
            sample_rate = config.get("sample_rate", 2.048e6)
            gain = config.get("gain", 40.0)
            ppm = config.get("ppm", 0)
            
            # Set device parameters
            self.sdr.center_freq = center_freq
            self.sdr.sample_rate = sample_rate
            self.sdr.gain = gain
            self.sdr.freq_correction = ppm
            
            # Store other parameters for signal detection
            self.threshold_dbfs = config.get("threshold_dbfs", -35.0)
            self.min_burst_duration = config.get("min_burst_duration", 0.1)
            
            logger.info(f"RTL-SDR configured: freq={center_freq/1e6}MHz, rate={sample_rate/1e6}MHz, gain={gain}dB")
            return True
        except Exception as e:
            logger.error(f"Failed to configure RTL-SDR: {str(e)}")
            return False
    
    def start_scan(self, config=None):
        """Start scanning with the RTL-SDR device"""
        if config:
            self.config = config
            
        if not self.sdr:
            if not self.connect():
                return False
        else:
            # Re-apply config even if already connected
            self.apply_config(self.config)
        
        if self.running:
            logger.warning("Scan already running, ignoring start request")
            return True
        
        self.running = True
        self.scan_thread = threading.Thread(target=self._scan_loop)
        self.scan_thread.daemon = True
        self.scan_thread.start()
        
        logger.info(f"Started scanning on physical RTL-SDR device {self.device_index}")
        return True
    
    def stop_scan(self):
        """Stop scanning"""
        self.running = False
        if self.scan_thread:
            self.scan_thread.join(timeout=2.0)
            self.scan_thread = None
        
        if self.sdr:
            try:
                self.sdr.close()
                self.sdr = None
                logger.info(f"Closed RTL-SDR device {self.device_index}")
            except Exception as e:
                logger.error(f"Error closing RTL-SDR: {str(e)}")
                
        logger.info(f"Stopped scanning on RTL-SDR device {self.device_index}")
        return True
    
    def register_burst_callback(self, callback):
        """Register a callback for when bursts are detected"""
        self.burst_callbacks.append(callback)
    
    def register_fft_callback(self, callback):
        """Register a callback for FFT data updates"""
        self.fft_callbacks.append(callback)
    
    def _scan_loop(self):
        """Main scanning loop that runs in a separate thread"""
        try:
            logger.info(f"Starting scan loop with REAL RTL-SDR device {self.device_index}")
            reconnect_attempts = 0
            last_successful_read = time.time()
            
            while self.running:
                try:
                    # Read samples from the SDR
                    samples = self.sdr.read_samples(256*1024)
                    
                    # Reset reconnect counter on successful read
                    reconnect_attempts = 0
                    last_successful_read = time.time()
                    
                    # Store a copy of the samples
                    self.sample_buffer.append(samples)
                    if len(self.sample_buffer) > 10:
                        self.sample_buffer.pop(0)
                    
                    # Calculate power spectrum
                    fft_data = self._calculate_fft(samples)
                    
                    # Call any registered FFT callbacks
                    for callback in self.fft_callbacks:
                        try:
                            callback(fft_data)
                        except Exception as e:
                            logger.error(f"Error in FFT callback: {str(e)}")
                    
                    # Update waterfall data
                    self._update_waterfall(fft_data)
                    
                    # Check for signal bursts above threshold
                    self._detect_bursts(fft_data, samples)
                    
                    # Small pause to prevent CPU overload
                    time.sleep(0.01)
                    
                except (IOError, OSError, ValueError, RuntimeError) as io_err:
                    # Handle device I/O errors (typically disconnect or USB issues)
                    reconnect_attempts += 1
                    logger.error(f"I/O error with RTL-SDR device: {str(io_err)}. Attempt {reconnect_attempts}/5")
                    
                    # Check for specific USB error messages
                    if "USB transfer error" in str(io_err) or "No such file or directory" in str(io_err):
                        logger.warning("USB communication issue detected. Device may have been disconnected.")
                    elif "timeout" in str(io_err).lower():
                        logger.warning("USB timeout detected. Device may be busy or unresponsive.")
                    
                    # Check if we've been stuck too long without successful reads
                    current_time = time.time()
                    if current_time - last_successful_read > 30:  # 30 second timeout
                        logger.error(f"No successful reads for 30 seconds. Forcing device reset.")
                        reconnect_attempts = 5  # Force reconnection
                    
                    if reconnect_attempts >= 5:
                        logger.error("Maximum reconnection attempts reached. Attempting hardware reset.")
                        self.running = False
                        
                        # Try to run an external rtl_test command to reset the device
                        try:
                            subprocess.run(["rtl_test", "-t"], timeout=2, capture_output=True)
                            logger.info("Attempted hardware reset via rtl_test")
                        except Exception as reset_err:
                            logger.error(f"Failed to reset device: {str(reset_err)}")
                        
                        # Break out of scan loop after reset attempt
                        break
                    
                    # Try to close and reopen the device
                    try:
                        if self.sdr:
                            self.sdr.close()
                    except Exception as close_err:
                        logger.warning(f"Error closing SDR: {str(close_err)}")
                        
                    self.sdr = None
                    time.sleep(1.0 * reconnect_attempts)  # Incremental backoff
                    
                    # Attempt to reconnect
                    if not self.connect():
                        logger.error("Failed to reconnect to RTL-SDR device")
                        continue
                    
                    # Re-apply configuration after reconnect
                    self.apply_config(self.config)
                    
                except Exception as e:
                    logger.error(f"Unexpected error in scan loop: {str(e)}")
                    time.sleep(1.0)  # Pause briefly on unexpected errors
                    
        except Exception as outer_e:
            logger.error(f"Fatal error in scan loop: {str(outer_e)}")
            self.running = False
    
    def _calculate_fft(self, samples):
        """Calculate FFT from IQ samples"""
        try:
            # Use window function to reduce spectral leakage
            window = np.hamming(len(samples))
            windowed_samples = samples * window
            
            # Compute FFT
            fft_result = np.fft.fftshift(np.fft.fft(windowed_samples))
            
            # Convert to power in dBFS
            power_spectrum = 10*np.log10(np.abs(fft_result)**2)
            
            # Create frequency axis
            freqs = np.fft.fftshift(np.fft.fftfreq(len(samples), 1/self.sdr.sample_rate))
            freqs += self.sdr.center_freq
            
            return {"frequencies": freqs, "power": power_spectrum}
        except Exception as e:
            logger.error(f"Error calculating FFT: {str(e)}")
            # Return empty data if calculation fails
            empty_data = np.full(1024, -100)
            empty_freqs = np.linspace(
                self.sdr.center_freq - self.sdr.sample_rate/2,
                self.sdr.center_freq + self.sdr.sample_rate/2,
                1024
            )
            return {"frequencies": empty_freqs, "power": empty_data}
    
    def _update_waterfall(self, fft_data):
        """Update waterfall display data"""
        # Add the latest FFT row to waterfall data
        self.waterfall_data.append(fft_data["power"])
        
        # Keep only the last 100 rows
        if len(self.waterfall_data) > 100:
            self.waterfall_data.pop(0)
    
    def _detect_bursts(self, fft_data, samples):
        """Detect signal bursts above threshold"""
        # Find peaks above threshold
        above_threshold = fft_data["power"] > self.threshold_dbfs
        
        if np.any(above_threshold):
            # Find the strongest peak
            peak_idx = np.argmax(fft_data["power"])
            peak_freq = fft_data["frequencies"][peak_idx]
            peak_power = fft_data["power"][peak_idx]
            
            # Estimate bandwidth (simple method)
            # Find points 3dB below peak on each side
            half_power_level = peak_power - 3
            
            left_idx = peak_idx
            while left_idx > 0 and fft_data["power"][left_idx] > half_power_level:
                left_idx -= 1
                
            right_idx = peak_idx
            while right_idx < len(fft_data["power"])-1 and fft_data["power"][right_idx] > half_power_level:
                right_idx += 1
                
            bandwidth = fft_data["frequencies"][right_idx] - fft_data["frequencies"][left_idx]
            
            # Create a burst record
            burst_id = f"burst_{uuid.uuid4().hex[:8]}"
            
            # Record IQ data for the burst
            iq_file = self._record_iq(samples, burst_id)
            
            burst = {
                "id": burst_id,
                "frequency": float(peak_freq),
                "power": float(peak_power),
                "timestamp": datetime.now(),
                "duration": float(len(samples) / self.sdr.sample_rate),  # Duration based on samples
                "bandwidth": float(abs(bandwidth)),
                "iq_file": iq_file
            }
            
            # Add to detected bursts list
            self.detected_bursts.append(burst)
            
            # Keep only the last 1000 bursts
            if len(self.detected_bursts) > 1000:
                self.detected_bursts.pop(0)
                
            # Call registered callbacks
            for callback in self.burst_callbacks:
                try:
                    callback(burst)
                except Exception as e:
                    logger.error(f"Error in burst callback: {str(e)}")
            
            logger.debug(f"Detected real burst: {burst_id} at {peak_freq/1e6:.3f} MHz, {peak_power:.1f} dBFS")
    
    def _record_iq(self, samples, burst_id):
        """Record IQ samples to a file"""
        try:
            # Create filename based on burst ID and timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{timestamp}_{burst_id}.iq"
            filepath = os.path.join(self.data_dir, filename)
            
            # Save as raw binary file
            samples.tofile(filepath)
            
            return filename
        except Exception as e:
            logger.error(f"Failed to record IQ data: {str(e)}")
            return None
    
    def get_device_info(self):
        """Get information about the connected device"""
        if not self.sdr:
            if not self.connect():
                return {
                    "index": self.device_index,
                    "name": self.device_name,
                    "serial": self.device_serial,
                    "status": "disconnected"
                }
        
        try:
            return {
                "index": self.device_index,
                "name": self.device_name,
                "serial": self.device_serial,
                "center_freq": self.sdr.center_freq,
                "sample_rate": self.sdr.sample_rate,
                "gain": self.sdr.gain,
                "ppm": self.sdr.freq_correction,
                "threshold_dbfs": self.threshold_dbfs,
                "status": "connected" if self.running else "idle",
                "samples_processed": len(self.sample_buffer),
                "device_type": "RTL-SDR"
            }
        except Exception as e:
            logger.error(f"Error getting device info: {str(e)}")
            return {
                "index": self.device_index,
                "name": self.device_name,
                "serial": self.device_serial,
                "status": "error",
                "error": str(e)
            }
    
    def get_fft_data(self):
        """Get the latest FFT data"""
        if not self.sample_buffer:
            return None
        return self._calculate_fft(self.sample_buffer[-1])
    
    def get_waterfall_data(self):
        """Get waterfall data for display"""
        return self.waterfall_data
    
    def get_burst_list(self):
        """Get the list of detected bursts"""
        return self.detected_bursts
    
    def tune(self, center_freq=None, gain=None, sample_rate=None, ppm=None, threshold_dbfs=None):
        """Tune the device parameters while running"""
        if not self.sdr:
            if not self.connect():
                return False, "Device not connected"
        
        changes = []
        try:
            # Update center frequency if provided
            if center_freq is not None:
                old_freq = self.sdr.center_freq
                self.sdr.center_freq = center_freq
                self.config["center_frequency"] = center_freq
                changes.append(f"Frequency: {old_freq/1e6:.3f}MHz → {center_freq/1e6:.3f}MHz")
                
            # Update gain if provided
            if gain is not None:
                old_gain = self.sdr.gain
                self.sdr.gain = gain
                self.config["gain"] = gain
                changes.append(f"Gain: {old_gain}dB → {gain}dB")
                
            # Update sample rate if provided
            if sample_rate is not None:
                old_rate = self.sdr.sample_rate
                self.sdr.sample_rate = sample_rate
                self.config["sample_rate"] = sample_rate
                changes.append(f"Sample rate: {old_rate/1e6:.3f}MHz → {sample_rate/1e6:.3f}MHz")
                
            # Update frequency correction if provided
            if ppm is not None:
                old_ppm = self.sdr.freq_correction
                self.sdr.freq_correction = ppm
                self.config["ppm"] = ppm
                changes.append(f"PPM: {old_ppm} → {ppm}")
                
            # Update threshold if provided
            if threshold_dbfs is not None:
                old_threshold = self.threshold_dbfs
                self.threshold_dbfs = threshold_dbfs
                self.config["threshold_dbfs"] = threshold_dbfs
                changes.append(f"Threshold: {old_threshold}dBFS → {threshold_dbfs}dBFS")
                
            if changes:
                logger.info(f"Tuned device {self.device_index}: {', '.join(changes)}")
            return True, ', '.join(changes)
            
        except Exception as e:
            logger.error(f"Error tuning device: {str(e)}")
            return False, f"Error: {str(e)}"


class SDRManager:
    """
    Manages multiple SDR devices and provides unified interfaces
    """
    def __init__(self):
        self.devices = {}
        self.scan_for_devices()
    
    def scan_for_devices(self):
        """Scan for available SDR devices"""
        logger.info("Scanning for RTL-SDR devices...")
        # Try to enumerate RTL-SDR devices
        try:
            from rtlsdr import RtlSdr
            
            # First attempt - check USB devices directly
            try:
                logger.info("Checking USB devices for RTL-SDR hardware...")
                result = subprocess.run(['lsusb'], capture_output=True, text=True)
                logger.info(f"USB devices found: \n{result.stdout}")
                
                # Look for RTL-SDR devices in the lsusb output
                rtl_lines = [line for line in result.stdout.splitlines() if "0bda:2838" in line]
                logger.info(f"Found {len(rtl_lines)} potential RTL-SDR devices via lsusb")
                
                # Check if devices are accessible via rtl_test
                try:
                    rtl_test = subprocess.run(['rtl_test'], capture_output=True, text=True)
                    logger.info(f"rtl_test output: \n{rtl_test.stdout}\n{rtl_test.stderr}")
                except:
                    logger.warning("rtl_test not available or failed to run")
            except Exception as usb_err:
                logger.error(f"Error checking USB devices: {str(usb_err)}")
            
            # Second attempt - use librtlsdr to detect devices
            try:
                # Try to detect RTL-SDR devices by examining librtlsdr
                device_count = RtlSdr.get_device_count()
                logger.info(f"RTL-SDR library reports {device_count} devices connected")
                
                # If no devices found, log warning
                if device_count == 0:
                    logger.warning("No RTL-SDR devices found via librtlsdr. Check device connections and permissions.")
            except Exception as count_err:
                logger.error(f"Error getting device count: {str(count_err)}")
            
            # List all available RTL-SDR devices
            for i in range(10):  # Try up to 10 indices
                try:
                    # Try to open the device (will raise if not available)
                    sdr = RtlSdr(i)
                    
                    # Get device information if possible
                    try:
                        device_name = RtlSdr.get_device_name(i)
                    except:
                        device_name = "RTL-SDR"
                        
                    try:
                        device_serial = RtlSdr.get_device_serial(i)
                    except:
                        device_serial = "Unknown"
                    
                    logger.info(f"Found RTL-SDR device at index {i}: {device_name} (Serial: {device_serial})")
                    
                    # Close it immediately
                    sdr.close()
                    
                    # Create SDRDevice instance
                    self.devices[i] = SDRDevice(i)
                except Exception as e:
                    # Log only if it seems like there's a permission issue or actual error
                    if "No such file or directory" not in str(e) and "not found" not in str(e):
                        logger.error(f"Error with RTL-SDR device at index {i}: {str(e)}")
        except Exception as e:
            logger.error(f"Error scanning for RTL-SDR devices: {str(e)}")
            # Check if this is a library loading error
            if "undefined symbol" in str(e) or "cannot open shared object file" in str(e):
                logger.error("This appears to be a library loading error. Make sure librtlsdr is installed and properly linked.")
            
        if not self.devices:
            logger.warning("No RTL-SDR devices were found or accessible")
            # Add a demo device if in development mode
            if os.getenv("DEVELOPMENT"):
                logger.warning("Development mode: Adding test device for development")
                self.devices[0] = SDRDevice(0)
        
        return list(self.devices.keys())
    
    def get_device(self, device_index):
        """Get a specific device by index"""
        return self.devices.get(device_index)
    
    def get_device_list(self):
        """Get list of all available devices"""
        device_list = []
        for idx, device in self.devices.items():
            try:
                info = device.get_device_info()
                device_list.append({
                    "index": idx,
                    "name": info.get("name", "Unknown"),
                    "serial": info.get("serial", "Unknown"),
                    "status": info.get("status", "unknown")
                })
            except Exception as e:
                logger.error(f"Error getting device info for index {idx}: {str(e)}")
        
        return device_list
    
    def start_scan(self, device_index, config):
        """Start scanning on a specific device"""
        device = self.get_device(device_index)
        if device:
            return device.start_scan(config)
        return False
    
    def stop_scan(self, device_index):
        """Stop scanning on a specific device"""
        device = self.get_device(device_index)
        if device:
            return device.stop_scan()
        return False
    
    def register_burst_callback(self, device_index, callback):
        """Register a callback for burst detection on a specific device"""
        device = self.get_device(device_index)
        if device:
            device.register_burst_callback(callback)
            return True
        return False
    
    def register_global_burst_callback(self, callback):
        """Register a callback for all devices"""
        for device in self.devices.values():
            device.register_burst_callback(callback)
        return True
    
    def get_all_bursts(self):
        """Get bursts from all devices"""
        all_bursts = []
        for device in self.devices.values():
            all_bursts.extend(device.get_burst_list())
        
        # Sort by timestamp (newest first)
        all_bursts.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return all_bursts
    
    def tune_device(self, device_index, center_freq=None, gain=None, sample_rate=None, ppm=None, threshold_dbfs=None):
        """Tune parameters for a specific device"""
        device = self.get_device(device_index)
        if device:
            return device.tune(center_freq, gain, sample_rate, ppm, threshold_dbfs)
        return False, f"Device {device_index} not found"
    
    def get_all_device_info(self):
        """Get detailed information for all devices"""
        all_info = []
        for idx, device in self.devices.items():
            try:
                info = device.get_device_info()
                all_info.append(info)
            except Exception as e:
                logger.error(f"Error getting info for device {idx}: {str(e)}")
                all_info.append({
                    "index": idx,
                    "name": "Error",
                    "status": "error",
                    "error": str(e)
                })
        return all_info 