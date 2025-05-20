#!/usr/bin/env python3
"""
RTL-SDR Hardware Access Test Utility

This script tests access to RTL-SDR devices and provides diagnostics
for troubleshooting hardware access issues.
"""

import os
import sys
import subprocess
import time
import logging
import argparse
from rtlsdr import RtlSdr

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("rtlsdr_test")

def check_udev_rules():
    """Check if udev rules for RTL-SDR are installed"""
    rules_file = "/etc/udev/rules.d/rtl-sdr.rules"
    rules_exist = os.path.exists(rules_file)
    logger.info(f"Checking for udev rules: {rules_file} {'exists' if rules_exist else 'does not exist'}")
    
    if not rules_exist:
        logger.warning("RTL-SDR udev rules not found. This may cause permission issues.")
        logger.info("Recommended fix: Install rtl-sdr package or create udev rules manually")

def check_usb_devices():
    """Check for RTL-SDR devices on the USB bus"""
    logger.info("Checking for RTL-SDR devices on USB bus")
    
    # Use lsusb to find devices
    try:
        result = subprocess.run(['lsusb'], capture_output=True, text=True)
        if result.returncode == 0:
            logger.info("USB devices found:")
            for line in result.stdout.splitlines():
                logger.info(f"  {line}")
                
            # Check for RTL-SDR vendor/product IDs
            rtl_sdr_lines = [line for line in result.stdout.splitlines() 
                            if "0bda:2838" in line  # Most common RTL-SDR
                            or "1d50:6089" in line  # HackRF One
                            ]
            
            if rtl_sdr_lines:
                logger.info(f"Found {len(rtl_sdr_lines)} potential SDR devices:")
                for line in rtl_sdr_lines:
                    logger.info(f"  {line}")
            else:
                logger.warning("No RTL-SDR devices found in lsusb output")
                logger.info("Possible causes: Device not connected, power issues, or hardware failure")
        else:
            logger.error(f"lsusb command failed: {result.stderr}")
    except FileNotFoundError:
        logger.error("lsusb command not found. Please install usbutils package")

def check_device_nodes():
    """Check for RTL-SDR device nodes"""
    logger.info("Checking for RTL-SDR device nodes")
    
    # Check /dev for rtl-sdr devices
    dev_list = os.listdir('/dev')
    rtl_devices = [d for d in dev_list if d.startswith('rtl')]
    
    if rtl_devices:
        logger.info(f"Found RTL-SDR device nodes: {', '.join(rtl_devices)}")
        
        # Check permissions
        for dev in rtl_devices:
            try:
                stat_info = os.stat(f"/dev/{dev}")
                permissions = oct(stat_info.st_mode)[-3:]
                owner = stat_info.st_uid
                group = stat_info.st_gid
                logger.info(f"  /dev/{dev}: permissions={permissions}, owner={owner}, group={group}")
            except Exception as e:
                logger.error(f"Error checking /dev/{dev}: {str(e)}")
    else:
        logger.warning("No RTL-SDR device nodes found in /dev")

def test_librtlsdr():
    """Test librtlsdr functionality"""
    logger.info("Testing librtlsdr functionality")
    
    try:
        # Try to get device count
        device_count = RtlSdr.get_device_count()
        logger.info(f"RTL-SDR devices found: {device_count}")
        
        if device_count == 0:
            logger.warning("No RTL-SDR devices detected by librtlsdr")
            return False
        
        # List device names
        for i in range(device_count):
            try:
                device_name = RtlSdr.get_device_name(i)
                device_serial = "unknown"
                try:
                    device_serial = RtlSdr.get_device_serial(i)
                except:
                    pass
                
                logger.info(f"Device {i}: Name={device_name}, Serial={device_serial}")
            except Exception as e:
                logger.error(f"Error getting device {i} info: {str(e)}")
        
        return True
    except Exception as e:
        logger.error(f"Error testing librtlsdr: {str(e)}")
        return False

def test_device_read(device_index=0):
    """Test reading samples from RTL-SDR device"""
    logger.info(f"Testing sample acquisition from device {device_index}")
    
    try:
        # Try to open and read from the device
        sdr = RtlSdr(device_index)
        
        # Configure device
        sdr.sample_rate = 2.048e6
        sdr.center_freq = 433.92e6
        sdr.gain = 40
        
        logger.info(f"Device configured: freq=433.92MHz, rate=2.048MHz, gain=40dB")
        
        # Try to read samples
        logger.info("Reading samples...")
        samples = sdr.read_samples(1024 * 256)
        
        logger.info(f"Successfully read {len(samples)} samples")
        
        # Calculate signal power
        import numpy as np
        power_db = 10 * np.log10(np.mean(np.abs(samples)**2))
        logger.info(f"Average signal power: {power_db:.2f} dB")
        
        # Close device
        sdr.close()
        
        return True
    except Exception as e:
        logger.error(f"Error reading from device: {str(e)}")
        return False

def run_rtl_test():
    """Run rtl_test command-line utility"""
    logger.info("Running rtl_test utility")
    
    try:
        # Run rtl_test with a timeout
        result = subprocess.run(['rtl_test', '-t'], 
                               timeout=5,
                               capture_output=True, 
                               text=True)
        
        if result.returncode == 0:
            logger.info("rtl_test successful")
            for line in result.stdout.splitlines():
                if line.strip():
                    logger.info(f"  {line}")
        else:
            logger.error(f"rtl_test failed with return code {result.returncode}")
            logger.error(result.stderr)
    except FileNotFoundError:
        logger.error("rtl_test not found. Please install rtl-sdr package")
    except subprocess.TimeoutExpired:
        logger.error("rtl_test timed out after 5 seconds")

def main():
    parser = argparse.ArgumentParser(description='Test RTL-SDR hardware access')
    parser.add_argument('-d', '--device', type=int, default=0,
                        help='RTL-SDR device index to test (default: 0)')
    parser.add_argument('-a', '--all', action='store_true',
                        help='Run all tests')
    parser.add_argument('-u', '--usb', action='store_true',
                        help='Check USB devices only')
    parser.add_argument('-r', '--read', action='store_true',
                        help='Test sample reading only')
    
    args = parser.parse_args()
    
    print("=== RTL-SDR Hardware Access Test Utility ===")
    print(f"System: {os.uname().sysname} {os.uname().release}")
    print()
    
    if args.all or not (args.usb or args.read):
        check_udev_rules()
        print()
        
        check_usb_devices()
        print()
        
        check_device_nodes()
        print()
        
        has_devices = test_librtlsdr()
        print()
        
        if has_devices:
            test_device_read(args.device)
            print()
            
            run_rtl_test()
    elif args.usb:
        check_usb_devices()
    elif args.read:
        test_device_read(args.device)
    
    print()
    print("=== RTL-SDR Hardware Access Test Complete ===")

if __name__ == "__main__":
    main() 