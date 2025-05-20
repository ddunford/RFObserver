#!/bin/bash
set -e

# Run the Socket.IO server in the background on port 7002
echo "Starting Socket.IO server on port 7002..."
python socket_server.py &
SOCKET_PID=$!

# Run the FastAPI app in the foreground on port 7001
echo "Starting FastAPI application on port 7001..."
uvicorn main:app --host 0.0.0.0 --port 7001 --reload

# If uvicorn exits, kill the socket server
kill $SOCKET_PID 