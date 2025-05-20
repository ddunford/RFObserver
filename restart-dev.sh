#!/bin/bash
# Restart the RF Observer development environment

echo "Stopping any running containers..."
docker compose down

echo "Rebuilding containers with latest code..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml build

echo "Starting containers in development mode..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d