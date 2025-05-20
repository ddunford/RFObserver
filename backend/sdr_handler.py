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
import re

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
        # FFT parameters
        self.fft_size = 1024 * 128  # Default FFT size
        
    def connect(self):
        """Connect to the physical RTL-SDR device"""
        try:
            # First check if the device is accessible via USB
            try:
                rtl_devices = list(usb.core.find(find_all=True, idVendor=0x0bda, idProduct=0x2838))
                if not rtl_devices:
                    logger.warning(f"No RTL-SDR devices found on USB bus before connection attempt")
                    return False
                else:
                    logger.info(f"Found {len(rtl_devices)} RTL-SDR devices on USB bus")
            except Exception as usb_err:
                logger.warning(f"Could not check USB devices: {str(usb_err)}")
        
            # First kill any existing rtl processes to free up the device
            try:
                subprocess.run(['pkill', '-f', 'rtl_'], timeout=1)
                logger.info(f"Killed any rtl_ processes before connection attempt for device {self.device_index}")
                time.sleep(0.5)  # Give the system time to release resources
            except Exception as kill_err:
                logger.warning(f"Error killing rtl_ processes: {str(kill_err)}")
        
            # Try to get device info before opening
            try:
                # Try importing the correct RTL-SDR module
                try:
                    from rtlsdr import RtlSdr
                    # If we're here, we're using the normal RtlSdr class
                    self.device_name = RtlSdr.get_device_name(self.device_index) or "RTL-SDR"
                    self.device_serial = RtlSdr.get_device_serial(self.device_index) or "unknown"
                except AttributeError:
                    # The API might be using RtlSdrAio instead which doesn't have these class methods
                    # Just set default values
                    logger.warning("Using RtlSdrAio which doesn't support device info methods")
                    self.device_name = "RTL-SDR"
                    self.device_serial = "unknown"
                    
                logger.info(f"Found device name: {self.device_name}, serial: {self.device_serial}")
            except Exception as info_err:
                logger.warning(f"Could not get device info for index {self.device_index}: {str(info_err)}")
                # Try command line tools as backup method
                try:
                    # First kill any existing rtl_test processes to avoid resource conflicts
                    try:
                        subprocess.run(['pkill', 'rtl_test'], timeout=1)
                    except Exception:
                        pass
                    
                    # Run rtl_test with short timeout to get device info
                    result = subprocess.run(['rtl_test', '-d', str(self.device_index)], 
                                           capture_output=True, text=True, timeout=2)
                    
                    # Kill rtl_test again to make sure it's not running
                    try:
                        subprocess.run(['pkill', 'rtl_test'], timeout=1)
                    except Exception:
                        pass
                                       
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
                            time.sleep(1.0)  # Give the system time to release resources
                        except Exception:
                            pass
                    
                    attempt += 1
                    time.sleep(1.0)
            
            if not self.sdr:
                logger.error(f"All connection attempts failed: {str(last_error)}")
                return False
            
            # Apply configuration with error handling for PPM setting
            config_success = self.apply_config(self.config)
            if not config_success:
                logger.warning("Failed to apply full configuration, but device is connected")
                # Continue anyway since the device is connected
            
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
            
            # Apply settings one by one with error handling
            success = True
            
            # Set center frequency
            try:
                self.sdr.center_freq = center_freq
                logger.info(f"Set center frequency to {center_freq/1e6} MHz")
            except Exception as freq_err:
                logger.error(f"Failed to set center frequency: {str(freq_err)}")
                success = False
            
            # Set sample rate
            try:
                self.sdr.sample_rate = sample_rate
                logger.info(f"Set sample rate to {sample_rate/1e6} MSPS")
            except Exception as rate_err:
                logger.error(f"Failed to set sample rate: {str(rate_err)}")
                success = False
            
            # Set gain
            try:
                self.sdr.gain = gain
                logger.info(f"Set gain to {gain} dB")
            except Exception as gain_err:
                logger.error(f"Failed to set gain: {str(gain_err)}")
                success = False
            
            # Set PPM last with extra error handling
            try:
                # Some RTL-SDR devices have issues with PPM correction
                # Try with 0 first, then with the actual value
                try:
                    self.sdr.freq_correction = 0
                    if ppm != 0:
                        self.sdr.freq_correction = ppm
                except Exception as ppm_inner_err:
                    logger.warning(f"Error setting PPM correction to {ppm}: {str(ppm_inner_err)}")
                    # Continue without applying PPM correction
                    logger.info("Continuing without PPM correction")
            except Exception as ppm_err:
                logger.error(f"Failed to set PPM: {str(ppm_err)}")
                success = False
            
            # Store other parameters for signal detection
            self.threshold_dbfs = config.get("threshold_dbfs", -35.0)
            self.min_burst_duration = config.get("min_burst_duration", 0.1)
            
            logger.info(f"RTL-SDR configured: freq={center_freq/1e6}MHz, rate={sample_rate/1e6}MHz, gain={gain}dB")
            return success
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
        logger.info(f"Stopping scan on RTL-SDR device {self.device_index}")
        was_running = self.running
        self.running = False
        
        # Wait for the scan thread to terminate
        if self.scan_thread:
            try:
                logger.info(f"Waiting for scan thread to terminate for device {self.device_index}")
                self.scan_thread.join(timeout=2.0)
                if self.scan_thread.is_alive():
                    logger.warning(f"Scan thread for device {self.device_index} did not terminate within timeout")
                self.scan_thread = None
            except Exception as thread_err:
                logger.error(f"Error waiting for scan thread: {str(thread_err)}")
        
        # Try to close the device properly
        if self.sdr:
            try:
                logger.info(f"Closing RTL-SDR device {self.device_index}")
                self.sdr.close()
                self.sdr = None
            except Exception as sdr_err:
                logger.error(f"Error closing RTL-SDR device {self.device_index}: {str(sdr_err)}")
        
        # Make sure to kill any RTL processes that might still be using the device
        try:
            subprocess.run(["pkill", "-f", f"rtl_.+{self.device_index}"], timeout=1)
            subprocess.run(["pkill", "-f", "rtl_"], timeout=1)
            logger.info(f"Killed any lingering rtl_ processes for device {self.device_index}")
            time.sleep(0.5)  # Give the system time to release resources
        except Exception as kill_err:
            logger.warning(f"Error killing rtl_ processes: {str(kill_err)}")
        
        # Reset device state
        self.device_connected = False
        if was_running:
            logger.info(f"Successfully stopped scanning on RTL-SDR device {self.device_index}")
        
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
            pll_error_count = 0  # Track PLL lock errors
            
            while self.running:
                try:
                    # Check if too many PLL errors have occurred
                    if pll_error_count > 5:
                        logger.error(f"Too many PLL lock errors (count: {pll_error_count}). Reconnecting device.")
                        pll_error_count = 0
                        # Force reconnection
                        if self.sdr:
                            try:
                                self.sdr.close()
                            except Exception:
                                pass
                            self.sdr = None
                        if not self.connect():
                            logger.error("Failed to reconnect after PLL lock errors")
                            time.sleep(1.0)
                            continue
                    
                    # Check if device is connected
                    if not self.sdr:
                        if not self.connect():
                            logger.error("Failed to reconnect device in scan loop")
                            time.sleep(1.0)
                            continue
                    
                    # Read samples from the RTL-SDR
                    try:
                        samples = self.sdr.read_samples(self.fft_size)
                        # Reset error counter on successful read
                        pll_error_count = 0
                        reconnect_attempts = 0
                        last_successful_read = time.time()
                    except Exception as read_err:
                        # Check for specific error messages that might indicate PLL issues
                        if "PLL" in str(read_err):
                            pll_error_count += 1
                            logger.warning(f"PLL error detected (count: {pll_error_count}): {str(read_err)}")
                        else:
                            logger.error(f"Error reading samples: {str(read_err)}")
                        
                        # If we haven't had a successful read in a while, try to reconnect
                        if time.time() - last_successful_read > 5.0:
                            reconnect_attempts += 1
                            logger.warning(f"No successful read in 5 seconds, reconnecting (attempt {reconnect_attempts})")
                            
                            # Close the current connection
                            try:
                                if self.sdr:
                                    self.sdr.close()
                            except Exception:
                                pass
                            self.sdr = None
                            
                            # Try to reconnect
                            if not self.connect():
                                logger.error("Failed to reconnect device")
                                time.sleep(1.0)
                                continue
                            else:
                                last_successful_read = time.time()  # Reset timer after reconnection
                        
                        time.sleep(0.1)  # Short sleep after error
                        continue
                    
                    # Calculate FFT
                    fft_data = self._calculate_fft(samples)
                    
                    # Store sample data in buffer (limited size)
                    self.sample_buffer.append(samples)
                    if len(self.sample_buffer) > 10:
                        self.sample_buffer.pop(0)
                    
                    # Process FFT data for signal detection
                    if fft_data:
                        self._process_fft_data(fft_data)
                        
                        # Call any registered callbacks
                        for callback in self.fft_callbacks:
                            try:
                                callback(fft_data)
                            except Exception as cb_err:
                                logger.error(f"Error in FFT callback: {str(cb_err)}")
                    
                    # Add a short sleep to prevent 100% CPU usage and allow other threads to run
                    # This also helps reduce FFT data rate to a more reasonable level
                    time.sleep(0.05)
                        
                except Exception as e:
                    logger.error(f"Error in scan loop: {str(e)}")
                    time.sleep(0.1)  # Sleep briefly after an error
            
            logger.info(f"Scan loop exiting for device {self.device_index}")
            
        except Exception as e:
            logger.error(f"Fatal error in scan loop: {str(e)}")
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
            
            # Log some stats for debugging
            logger.debug(f"FFT calculated - samples: {len(samples)}, max power: {np.max(power_spectrum):.1f} dBFS")
            
            # Convert numpy arrays to lists for JSON serialization
            result = {
                "frequencies": freqs.tolist(),
                "power": power_spectrum.tolist(),
                "device_index": self.device_index,
                "timestamp": time.time()
            }
            
            return result
        except Exception as e:
            logger.error(f"Error calculating FFT: {str(e)}")
            # Return empty data if calculation fails
            empty_data = np.full(1024, -100)
            empty_freqs = np.linspace(
                self.sdr.center_freq - self.sdr.sample_rate/2,
                self.sdr.center_freq + self.sdr.sample_rate/2,
                1024
            )
            return {"frequencies": empty_freqs.tolist(), "power": empty_data.tolist(), "device_index": self.device_index}
    
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
    
    def tune_parameters(self, params):
        """Apply tuning parameters from a dictionary"""
        if not self.sdr:
            logger.error("Cannot tune: SDR device not connected")
            return False
        
        try:
            changes = []
            
            # Update center frequency
            if "center_frequency" in params:
                old_freq = self.sdr.center_freq
                new_freq = params["center_frequency"]
                self.sdr.center_freq = new_freq
                self.config["center_frequency"] = new_freq
                logger.info(f"Tuned center frequency: {old_freq/1e6:.3f} MHz → {new_freq/1e6:.3f} MHz")
                changes.append(f"Frequency: {old_freq/1e6:.3f} MHz → {new_freq/1e6:.3f} MHz")
                
            # Update sample rate
            if "sample_rate" in params:
                old_rate = self.sdr.sample_rate
                new_rate = params["sample_rate"]
                self.sdr.sample_rate = new_rate
                self.config["sample_rate"] = new_rate
                logger.info(f"Tuned sample rate: {old_rate/1e6:.3f} MSPS → {new_rate/1e6:.3f} MSPS")
                changes.append(f"Sample rate: {old_rate/1e6:.3f} MSPS → {new_rate/1e6:.3f} MSPS")
                
            # Update gain
            if "gain" in params:
                old_gain = self.sdr.gain
                new_gain = params["gain"]
                self.sdr.gain = new_gain
                self.config["gain"] = new_gain
                logger.info(f"Tuned gain: {old_gain} dB → {new_gain} dB")
                changes.append(f"Gain: {old_gain} dB → {new_gain} dB")
                
            # Update PPM correction
            if "ppm" in params:
                old_ppm = self.sdr.freq_correction
                new_ppm = params["ppm"]
                self.sdr.freq_correction = new_ppm
                self.config["ppm"] = new_ppm
                logger.info(f"Tuned PPM correction: {old_ppm} → {new_ppm}")
                changes.append(f"PPM: {old_ppm} → {new_ppm}")
                
            # Update threshold
            if "threshold_dbfs" in params:
                old_threshold = self.threshold_dbfs
                new_threshold = params["threshold_dbfs"]
                self.threshold_dbfs = new_threshold
                self.config["threshold_dbfs"] = new_threshold
                logger.info(f"Tuned threshold: {old_threshold} dBFS → {new_threshold} dBFS")
                changes.append(f"Threshold: {old_threshold} dBFS → {new_threshold} dBFS")
                
            if changes:
                logger.info(f"Tuned device {self.device_index}: {', '.join(changes)}")
            return True
        except Exception as e:
            logger.error(f"Error tuning device parameters: {str(e)}")
            return False
    
    def _process_fft_data(self, fft_data):
        """Process FFT data for signal detection and waterfall updates"""
        try:
            # Update waterfall data
            self._update_waterfall(fft_data)
            
            # Check for signal bursts above threshold
            if len(self.sample_buffer) > 0:
                self._detect_bursts(fft_data, self.sample_buffer[-1])
                
        except Exception as e:
            logger.error(f"Error processing FFT data: {str(e)}")
            return None


class SDRManager:
    """
    Manages multiple SDR devices and provides unified interfaces
    """
    def __init__(self):
        self.devices = {}
        self.device_lock = threading.Lock()  # Add thread safety
        self.cached_device_info = []  # Cache for device info
        self.scan_for_devices()
    
    def scan_for_devices(self):
        """Scan for available SDR devices"""
        logger.info("Scanning for RTL-SDR devices...")
        
        # Kill any lingering rtl processes that might be holding the device
        try:
            subprocess.run(['pkill', '-f', 'rtl_'], timeout=1)
            logger.info("Killed any lingering rtl_ processes before scanning")
            time.sleep(0.5)  # Give the system time to release resources
        except Exception as kill_err:
            logger.warning(f"Error killing rtl_ processes: {str(kill_err)}")
        
        # Try to enumerate RTL-SDR devices using rtl_test first (most reliable)
        try:
            # Run rtl_test to enumerate all devices, but with a timeout to avoid hanging
            logger.info("Running rtl_test to get accurate device count...")
            rtl_test_output = ""
            try:
                # First kill any existing rtl_test processes
                subprocess.run(['pkill', 'rtl_test'], timeout=1)
                
                # Run rtl_test to get device list
                rtl_test = subprocess.run(['rtl_test'], 
                                          timeout=2, 
                                          capture_output=True, 
                                          text=True)
                rtl_test_output = rtl_test.stdout + rtl_test.stderr
                
                # Output the full rtl_test results to logs
                logger.info(f"rtl_test output: \n{rtl_test_output}")
            except subprocess.TimeoutExpired as timeout_err:
                # Still capture any partial output that might be useful
                if hasattr(timeout_err, 'stdout') and timeout_err.stdout:
                    rtl_test_output = timeout_err.stdout.decode('utf-8', errors='ignore')
                if hasattr(timeout_err, 'stderr') and timeout_err.stderr:
                    rtl_test_output += timeout_err.stderr.decode('utf-8', errors='ignore')
                logger.warning(f"rtl_test timed out, but captured output: \n{rtl_test_output}")
            except Exception as e:
                logger.warning(f"Error running rtl_test: {str(e)}")
            finally:
                # Kill rtl_test to clean up
                subprocess.run(['pkill', 'rtl_test'], timeout=1)
            
            # Parse the rtl_test output to find all devices
            device_indices = []
            if "Found" in rtl_test_output and "device(s)" in rtl_test_output:
                # Extract device count from rtl_test output
                for line in rtl_test_output.splitlines():
                    # Look for lines like "  0:  Realtek, RTL2838UHIDIR, SN: weather"
                    if re.match(r'\s*\d+:\s+.*', line):
                        try:
                            idx = int(line.split(':', 1)[0].strip())
                            device_indices.append(idx)
                            logger.info(f"Found device from rtl_test at index {idx}: {line}")
                        except (ValueError, IndexError):
                            pass
            
            # If no devices found, log a warning
            if not device_indices:
                logger.warning("No devices found in rtl_test output")
            else:
                logger.info(f"Found {len(device_indices)} devices from rtl_test: {device_indices}")
            
            # Store current device indices to track which ones to keep
            existing_devices = list(self.devices.keys())
            found_devices = set()
            
            # Process each device found by rtl_test
            for idx in device_indices:
                found_devices.add(idx)
                # Check if we already have this device
                if idx in self.devices:
                    logger.info(f"Device {idx} already in device list")
                    # Update device info if needed
                else:
                    # Try to create a new device
                    try:
                        # Create new device without connecting yet
                        device = SDRDevice(idx)
                        if device:
                            with self.device_lock:
                                self.devices[idx] = device
                                logger.info(f"Added new device at index {idx}")
                    except Exception as dev_err:
                        logger.error(f"Error creating device {idx}: {str(dev_err)}")
            
            # If no devices found via rtl_test, fall back to pyrtlsdr
            if not found_devices:
                logger.warning("No devices found via rtl_test, trying pyrtlsdr...")
                
                # Try up to 8 device indices to be safe
                for i in range(8):
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
                        
                        # Mark this device as found
                        found_devices.add(i)
                        
                        # Only create new device instances if they don't already exist
                        with self.device_lock:
                            if i not in self.devices:
                                # Create SDRDevice instance
                                self.devices[i] = SDRDevice(i)
                                logger.info(f"Added new device at index {i}")
                    except Exception as e:
                        # Log only if it seems like there's a permission issue or actual error
                        if "No such file or directory" not in str(e) and "not found" not in str(e):
                            logger.error(f"Error with RTL-SDR device at index {i}: {str(e)}")
            
            # Remove device entries that weren't found in this scan
            with self.device_lock:
                for device_idx in list(self.devices.keys()):
                    if device_idx not in found_devices:
                        logger.info(f"Device {device_idx} no longer available, removing from device list")
                        # Stop the device if it's running
                        if self.devices[device_idx].running:
                            self.devices[device_idx].stop_scan()
                        # Remove from our dictionary
                        del self.devices[device_idx]
                        
        except Exception as e:
            logger.error(f"Error scanning for RTL-SDR devices: {str(e)}")
            # Check if this is a library loading error
            if "undefined symbol" in str(e) or "cannot open shared object file" in str(e):
                logger.error("This appears to be a library loading error. Make sure librtlsdr is installed and properly linked.")
            
        if not self.devices:
            logger.warning("No RTL-SDR devices were found or accessible")
        
        # Update the cached device info with the latest device list
        self.get_all_device_info()
        
        # Return the device indices for convenience
        return list(self.devices.keys())
    
    def get_device(self, device_index):
        """Get a specific device by index"""
        with self.device_lock:
            return self.devices.get(device_index)
    
    def get_device_list(self):
        """Get list of all available devices"""
        device_list = []
        with self.device_lock:
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
        # Force a device scan first to make sure we have up-to-date device info
        self.scan_for_devices()
        
        with self.device_lock:
            device = self.devices.get(device_index)
            if device:
                # Kill any RTL processes before starting scan
                try:
                    subprocess.run(['pkill', '-f', 'rtl_'], timeout=1)
                    time.sleep(0.5)  # Give the system time to release resources
                except Exception:
                    pass
                    
                return device.start_scan(config)
            return False
    
    def stop_scan(self, device_index):
        """Stop scanning on a specific device"""
        with self.device_lock:
            device = self.devices.get(device_index)
            if device:
                success = device.stop_scan()
                # Force a device scan after stopping to refresh device state
                self.scan_for_devices()
                return success
            return False
    
    def register_burst_callback(self, device_index, callback):
        """Register a callback for burst detection on a specific device"""
        with self.device_lock:
            device = self.devices.get(device_index)
            if device:
                device.register_burst_callback(callback)
                return True
        return False
    
    def register_global_burst_callback(self, callback):
        """Register a callback for all devices"""
        with self.device_lock:
            for device in self.devices.values():
                device.register_burst_callback(callback)
        return True
    
    def get_all_bursts(self):
        """Get bursts from all devices"""
        all_bursts = []
        with self.device_lock:
            for device in self.devices.values():
                all_bursts.extend(device.get_burst_list())
        
        # Sort by timestamp (newest first)
        all_bursts.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return all_bursts
    
    def tune_device(self, device_index, center_freq=None, gain=None, sample_rate=None, ppm=None, threshold_dbfs=None):
        """Tune parameters for a specific device"""
        with self.device_lock:
            device = self.devices.get(device_index)
            if device:
                return device.tune(center_freq, gain, sample_rate, ppm, threshold_dbfs)
        return False, f"Device {device_index} not found"
    
    def get_all_device_info(self):
        """Get detailed information for all devices"""
        all_info = []
        with self.device_lock:
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
        
        # Cache the results for future use
        self.cached_device_info = all_info
        return all_info
    
    def get_cached_device_info(self):
        """Get cached device info without accessing hardware"""
        # If cache is empty, populate with basic info from devices
        if not self.cached_device_info:
            basic_info = []
            with self.device_lock:
                for idx, device in self.devices.items():
                    basic_info.append({
                        "index": idx,
                        "name": device.device_name,
                        "serial": device.device_serial,
                        "status": "connected" if device.running else "idle",
                        "center_freq": device.config.get("center_frequency", 433920000),
                        "sample_rate": device.config.get("sample_rate", 2048000),
                        "gain": device.config.get("gain", 40.0)
                    })
            self.cached_device_info = basic_info
        
        return self.cached_device_info 