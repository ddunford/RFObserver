# RTL-SDR Web Interface - Technical Specification

## Overview

This specification outlines the architecture and implementation details for building a web-based interface that runs RTL-SDR command-line tools (e.g. `rtl_fm`, `rtl_power`) and streams their output (including live audio and spectrum data) to a web frontend. The goal is to allow users to:

* Select frequency, modulation, and sample rate via a UI
* View real-time spectrum/waterfall data in the browser
* Listen to demodulated audio streamed from the SDR

## Technology Stack

### Backend

* **Language**: Python 3.x
* **Frameworks**:

  * FastAPI (REST + WebSocket)
  * `subprocess` module for command execution
  * Optional: ffmpeg, lame for audio encoding

### Frontend

* **Framework**: React (alternatively plain HTML/JS)
* **WebSocket**: for spectrum data
* **HTML5 Audio**: for audio playback
* **Visualisation**: D3.js or Plotly.js for spectrum and waterfall plots

### SDR Tools

* rtl\_fm: for demodulation and audio
* rtl\_power / rtl\_power\_fftw: for FFT spectrum
* SoX/lame/ffmpeg: for audio conversion/streaming

## Backend Design

### API Endpoints

#### `POST /start-stream`

Starts the RTL stream with user-specified parameters.

```json
{
  "frequency": "100.1M",
  "modulation": "wbfm",
  "sample_rate": 200000,
  "output_rate": 48000
}
```

#### `POST /stop-stream`

Stops any currently running RTL command.

### WebSocket: `/ws/spectrum`

Streams parsed FFT or power spectrum data from `rtl_power` output.

### Audio Streaming

* Transcode audio using `ffmpeg` or `lame` from `rtl_fm`
* Stream to browser via:

  * Chunked HTTP
  * WebSocket (binary audio)
  * Icecast for advanced needs

### Command Execution

Use Python’s `subprocess.Popen` to run RTL commands and pipe stdout:

```python
proc = subprocess.Popen([
    'rtl_fm', '-f', frequency, '-M', modulation, '-s', str(sample_rate), '-r', str(output_rate), '-'],
    stdout=subprocess.PIPE)
```

### Preventing Command Blocking and Supporting Concurrent Operations

To ensure that the UI (spectrum, waterfall, and audio) remains responsive and continues running during long-lived RTL command executions:

* **Use Threads or Async I/O**:

  * Launch each command in a dedicated thread or asyncio coroutine
  * Stream stdout asynchronously without blocking the main thread

* **Example with `threading.Thread`**:

```python
import threading

def run_rtl_fm():
    proc = subprocess.Popen([...])
    for line in proc.stdout:
        # process and relay audio
        pass

audio_thread = threading.Thread(target=run_rtl_fm)
audio_thread.start()
```

* **Changing Parameters on the Fly**:

  * To change frequency or modulation, implement a message bus or control API
  * Signal the thread to terminate gracefully
  * Restart a new command instance with updated parameters without stopping other services

* **Isolate Audio and Spectrum Workers**:

  * Run `rtl_fm` and `rtl_power` in independent threads
  * Each maintains its own state and connection (e.g., WebSocket, HTTP)
  * Use shared configuration objects if needed with locks/mutexes

## Frontend Design

### UI Components

* Frequency input (e.g. text or slider)
* Modulation type selector (dropdown)
* Start/Stop stream button
* Audio player
* Waterfall/spectrum chart

### Audio

```html
<audio controls autoplay src="http://localhost:8000/audio"></audio>
```

### Spectrum and Waterfall Plot

* Connect to `/ws/spectrum` via WebSocket
* Incoming messages should contain timestamped FFT data:

  ```json
  {
    "timestamp": 1716200000,
    "data": [
      { "freq": 99.9, "power": -60 },
      { "freq": 100.0, "power": -57 },
      { "freq": 100.1, "power": -59 }
    ]
  }
  ```
* **Spectrum Chart**:

  * Render real-time power vs frequency line chart using Plotly.js or D3.js
* **Waterfall Chart**:

  * Maintain a rolling buffer of previous FFT slices (e.g., last 100 rows)
  * Display as a colour heatmap (freq vs time vs power)
  * Use canvas/WebGL for efficient updates

## Data Format

### Spectrum WebSocket Message

```json
{
  "timestamp": 1716200000,
  "data": [
    { "freq": 99.9, "power": -60 },
    { "freq": 100.0, "power": -57 },
    { "freq": 100.1, "power": -59 }
  ]
}
```

### Audio Stream

* Format: MP3, Opus, or raw PCM
* Sample rate: 48kHz recommended

## Deployment Notes

* Dockerise backend (FastAPI + ffmpeg + rtl\_sdr)
* Expose ports: 8000 (API), 8001 (WebSocket), optional 8002 (audio)
* Run with mounted USB device (RTL-SDR)

```dockerfile
FROM python:3.11
RUN apt update && apt install -y rtl-sdr ffmpeg lame sox
COPY . /app
WORKDIR /app
RUN pip install fastapi uvicorn websockets
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Future Enhancements

* Multi-device support (HackRF, AirSpy)
* IQ data recording
* Machine learning-based signal classification
* Encrypted signal alerts
* User auth and session tracking

---

This document serves as the full technical plan for building a Docker-based web interface to RTL-SDR tools with real-time audio and spectrum display.
