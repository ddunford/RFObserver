-- RF Observer Database Schema

-- Create tables
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_index INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    serial VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bursts (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL,
    frequency BIGINT NOT NULL,
    power FLOAT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    duration FLOAT NOT NULL,
    bandwidth FLOAT NOT NULL,
    iq_file VARCHAR(255),
    device_id INTEGER REFERENCES devices(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX bursts_frequency_idx ON bursts (frequency);
CREATE INDEX bursts_timestamp_idx ON bursts (timestamp);
CREATE INDEX bursts_device_id_idx ON bursts (device_id);

-- Insert default settings
INSERT INTO settings (key, value) VALUES 
('general', '{"theme": "dark", "enableNotifications": true, "enableAdvancedFeatures": false}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES 
('recording', '{"autoRecord": true, "maxRecordingDuration": 5, "maxStorageSize": 1000, "exportFormat": "wav"}')
ON CONFLICT (key) DO NOTHING;

-- Insert sample devices (for development)
INSERT INTO devices (device_index, name, serial) VALUES 
(0, 'RTL-SDR', '00000001'),
(1, 'HackRF One', '00000002')
ON CONFLICT DO NOTHING; 