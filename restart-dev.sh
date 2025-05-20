#!/bin/bash
# Restart the RF Observer development environment

# Stop running containers
echo "Stopping running containers..."
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down

# Build and start containers
echo "Starting development environment..."
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# To run in background, use:
# docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d 