# Product Requirements Document: RF Observer

**Product Name:** RF Observer
**Prepared by:** Dan Dunford
**Version:** 1.0
**Date:** 20 May 2025

---

## Overview

RF Observer is a modular, web-based RF scanning, signal detection, and protocol analysis platform. It enables users to monitor and analyse RF activity in real time using SDR devices including RTL-SDR and HackRF. Designed with a focus on flexibility, extensibility, and future AI integration, it supports burst detection, spectrum analysis, IQ recording, signal classification, and user-defined decoding workflows.

---

## Goals

* Provide a user-friendly web interface for configuring, scanning, and visualising RF activity
* Support multiple SDR devices concurrently (RTL-SDR, HackRF, LimeSDR, etc.)
* Detect signal bursts and log frequency, strength, duration, and pattern
* Record IQ data for offline inspection and replay
* Enable visual spectrum and waterfall displays
* Provide real-time signal classification and tagging workflows
* Allow future expansion with AI/ML-based modulation and protocol detection
* Allow exporting signals to external tools like URH, Inspectrum, GNU Radio

---

## Core Features

### 1. **Device Support and Management**

* Plug-and-play recognition of supported SDRs (RTL-SDR, HackRF, etc.)
* Support multiple devices concurrently
* Assign scanning roles to each device (wideband sweep, fixed monitor, IQ capture)
* Device status dashboard (online, frequency, gain, temp, IQ capture state)

### 2. **Signal Scanning & Detection**

* Frequency range scanning with adjustable steps and resolution bandwidth
* Real-time FFT analysis and dBFS detection
* Configurable signal threshold and minimum burst duration
* Logging of all detected bursts with timestamp, frequency, gain, and power
* Burst clustering by frequency and periodicity

### 3. **IQ Capture & Replay**

* Automatic IQ recording of signal bursts above threshold
* Manual recording from user UI
* Tagging and metadata storage for each capture
* Export IQ data as `.bin`, `.wav`, `.sigmf`, `.json`
* Future: replay through HackRF (TX support)

### 4. **Web Interface (React + Tailwind)**

* Frequency, gain, threshold config panel
* Start/stop scan controls per device
* Live updating signal event log (WebSocket-powered)
* Real-time FFT and waterfall display (plotly.js or WebGL-based)
* Burst browser: list, tag, delete, download IQ files
* Spectrogram and power-over-time viewer per burst
* Dark mode + responsive layout

### 5. **API (FastAPI backend)**

* `/start_scan`, `/stop_scan`, `/set_config`, `/device_status`
* `/ws/events`: live push of burst data
* `/record_iq`, `/list_captures`, `/download/:id`
* `/classify` (future ML classifier endpoint)
* `/export/:format` (URH, Inspectrum, SigMF JSON)

### 6. **WebSocket Real-Time Layer**

* Live push of:

  * Detected bursts
  * Device health (sample rate, overload, etc.)
  * IQ status
  * Live FFT data for spectrum plotting
  * Waterfall frame updates for visual real-time monitoring

### 7. **Modular Signal Classification (Future)**

* Integrate TensorFlow/PyTorch model to classify modulation (OOK, FSK, etc.)
* Optional LLM assistant for burst summarisation:

  * "Signal at 433.92 MHz appears to be periodic OOK, likely a garage remote"
* Pretrained CNN support (e.g. from RadioML or DeepSig datasets)

### 8. **User Workspace Features**

* Burst tagging and notes
* Custom protocol templates (bit slicer config, decoder logic)
* Export workspace as zip or JSON
* Dashboard widgets (e.g. "most common frequencies", "active time slots")

### 9. **Access Control (Future)**

* Multi-user support with login
* Admin/user roles
* API key generation for automation

---

## Technical Stack

* **Frontend**: React + Tailwind CSS + socket.io-client + plotly.js
* **Backend**: FastAPI (Python) + pyrtlsdr + socket.io (asyncio) + numpy/scipy
* **Docker**: Containerised backend and frontend with optional reverse proxy (nginx)
* **Storage**: File-based storage for IQ files + SQLite/PostgreSQL for metadata
* **Hardware**: RTL-SDR, HackRF One, HackRF H4M, LimeSDR Mini (via SoapySDR bridge)

---

## Milestones

| Milestone                                  | Target Date |
| ------------------------------------------ | ----------- |
| Initial SDR scan & burst detect backend    | Week 1      |
| WebSocket + React UI integration           | Week 2      |
| IQ capture, logging, and download support  | Week 3      |
| Spectrogram viewer                         | Week 4      |
| Multi-device support (RTL + HackRF)        | Week 5      |
| Export to URH / Inspectrum format          | Week 6      |
| Signal tagging + burst history UI          | Week 7      |
| ML classifier proof-of-concept integration | Week 8      |

---

## Out of Scope (Initial Release)

* Full protocol decoding (e.g. reversing rolling codes)
* Signal replay/transmission (requires HackRF TX, phase 2)
* SDR hardware tuning (LNA bias, filter chains)
* Encrypted TETRA or GSM decoding

---

## Future Considerations

* Mobile-optimised dashboard
* Scheduled scanning and cron-like automation
* AI-assisted protocol decoder (LLM + DSP)
* Cloud-hosted dashboard with secure access to local SDRs

---

## Summary

RF Observer aims to be the most user-friendly and powerful open-source platform for SDR-based signal monitoring. It is built to scale from a simple home automation sniffer to a powerful RF surveillance and research toolkit, with extensibility for AI, classification, and real-time alerting.
