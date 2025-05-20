# RF Observer

RF Observer is a modular, web-based RF scanning, signal detection, and protocol analysis platform for Software Defined Radio (SDR) devices.

## Features

- Real-time spectrum visualization and waterfall display
- Automatic signal burst detection and logging
- IQ signal recording for detected bursts
- Multi-device support for RTL-SDR, HackRF, and other SDR hardware
- Frequency presets for common bands (433MHz, 868MHz, etc.)
- Configurable gain, sample rate, and detection threshold

## Project Structure

- `/backend`: Python FastAPI backend with SDR integration
- `/frontend`: React frontend with real-time visualization
- `/database`: Database migrations and initialization scripts
- `/nginx`: Reverse proxy configuration

## Requirements

- Docker and Docker Compose v2
- RTL-SDR, HackRF, or other compatible SDR hardware
- Modern web browser

## Hardware Support

RF Observer is designed to work with real SDR hardware:

- RTL-SDR dongles (RTL2832U chipset)
- HackRF One (future support)
- LimeSDR (future support)

**Important:** RF Observer requires physical SDR hardware to function correctly. Simulation mode is not supported by design.

## Quick Start

### Prerequisites

- Linux system with Docker and Docker Compose installed
- RTL-SDR hardware device connected via USB
- Proper permissions for USB device access

### Running RF Observer

1. Clone the repository:
   ```bash
   git clone https://github.com/ddunford/RFObserver.git
   cd rf-observer
   ```

2. Launch the development environment:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
   ```

3. Access the web interface:
   - Frontend: http://localhost:4444
   - Backend API: http://localhost:8888

## Troubleshooting Hardware Access

If you encounter issues accessing your SDR hardware, try the following:

1. Run the hardware diagnostics tool:
   ```bash
   docker-compose exec backend python utils/test_rtlsdr_access.py
   ```

2. Check USB device permissions:
   ```bash
   lsusb | grep RTL
   ls -l /dev/bus/usb/XXX/YYY  # Replace XXX/YYY with the bus/device from lsusb
   ```

3. Ensure udev rules are properly configured:
   ```bash
   sudo cp backend/udev/rtl-sdr.rules /etc/udev/rules.d/
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

4. Try running the container with host network mode:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend --network host
   ```

## Troubleshooting WebSocket Connection

If you see WebSocket connection errors in the browser console:

1. Verify the backend is running:
   ```bash
   docker-compose ps
   ```

2. Check the API endpoint is accessible:
   ```bash
   curl http://localhost:5000
   ```

3. Restart the application with the correct network configuration:
   ```bash
   ./restart-dev.sh
   ```

4. Check browser console for more specific error messages

5. If you still have connection issues, you may need to modify the API_URL in 
   docker-compose.dev.yml to match your system's network configuration.

## Using the RF Observer

1. **Device Manager**: Select and configure your SDR device
   - Choose from available devices
   - Set frequency, gain, and sample rate
   - Configure threshold settings

2. **Dashboard**: Monitor real-time spectrum
   - View real-time FFT spectrum display
   - See waterfall plot for signal history
   - Monitor detected signal bursts
   - Use frequency presets for quick tuning

3. **Signal Analysis**: Work with detected bursts
   - Review detected signal properties
   - Download IQ data for further analysis
   - Tag and annotate signals

## Development

### Architecture

- **Frontend**: React + Tailwind CSS
- **Backend**: FastAPI (Python) + pyrtlsdr
- **WebSockets**: socket.io for real-time updates
- **Docker**: Containerized deployment

### Building from Source

1. Frontend:
   ```bash
   cd frontend
   npm install
   npm run build
   ```

2. Backend:
   ```bash
   cd backend
   pip install -r requirements.dev.txt
   uvicorn main:app --reload
   ```

## License

[MIT License](LICENSE)

## Acknowledgements

- RTL-SDR project (https://osmocom.org/projects/rtl-sdr)
- pyrtlsdr library
- FastAPI and React frameworks 