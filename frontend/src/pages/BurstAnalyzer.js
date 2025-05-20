import React, { useState } from 'react';
import Plot from 'react-plotly.js';

function BurstAnalyzer({ bursts }) {
  const [selectedBurst, setSelectedBurst] = useState(null);

  // Function to generate simulated waveform data for a burst
  const generateWaveformData = (burst) => {
    if (!burst) return { x: [], y: [] };
    
    const samples = Math.floor(burst.duration * 1000); // Number of samples based on duration
    const x = Array.from({ length: samples }, (_, i) => i / 1000); // Time in seconds
    
    // Generate some simulated waveform data
    const y = Array.from({ length: samples }, (_, i) => {
      // Create some base noise
      let value = (Math.random() - 0.5) * 0.2;
      
      // Add simulated signal
      const frequency = 10; // Hz
      const amplitude = 0.8;
      value += amplitude * Math.sin(2 * Math.PI * frequency * (i / 1000));
      
      // Add some amplitude variation
      const envelope = Math.min(1, Math.min(i, samples - i) / (samples * 0.2));
      return value * envelope;
    });
    
    return { x, y };
  };

  // Generate simulated FFT data for a burst
  const generateFFTData = (burst) => {
    if (!burst) return { x: [], y: [] };
    
    const bins = 512;
    const x = Array.from({ length: bins }, (_, i) => burst.frequency - (burst.bandwidth/2) + (i * burst.bandwidth / bins));
    
    // Generate simulated FFT data with a peak at the center frequency
    const y = Array.from({ length: bins }, (_, i) => {
      const distanceFromCenter = Math.abs(i - bins/2) / (bins/2);
      return -100 + (80 * Math.pow(1 - distanceFromCenter, 2)) + (Math.random() * 5);
    });
    
    return { x, y };
  };

  // Handler for selecting a burst
  const handleBurstSelect = (burst) => {
    setSelectedBurst(burst);
  };

  // Format frequency display
  const formatFrequency = (freq) => {
    return (freq / 1000000).toFixed(3);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Burst Analyzer</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Burst List */}
        <div className="lg:col-span-1 bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Detected Bursts</h2>
          
          <div className="h-[calc(100vh-240px)] overflow-y-auto">
            {bursts.length > 0 ? (
              <div className="space-y-2">
                {bursts.slice().reverse().map((burst) => (
                  <div 
                    key={burst.id}
                    className={`p-3 rounded-lg cursor-pointer border transition-colors ${
                      selectedBurst && selectedBurst.id === burst.id
                        ? 'bg-signal-blue bg-opacity-20 border-signal-blue'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => handleBurstSelect(burst)}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{formatFrequency(burst.frequency)} MHz</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(burst.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm">
                      <span>{burst.power.toFixed(1)} dBFS</span>
                      <span>{burst.duration.toFixed(2)}s</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                No bursts detected yet
              </div>
            )}
          </div>
        </div>
        
        {/* Burst Details */}
        <div className="lg:col-span-2">
          {selectedBurst ? (
            <div className="space-y-6">
              {/* Burst Information */}
              <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
                <h2 className="text-lg font-semibold mb-4">Burst Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Frequency</p>
                    <p className="font-medium">{formatFrequency(selectedBurst.frequency)} MHz</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Timestamp</p>
                    <p className="font-medium">{new Date(selectedBurst.timestamp).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Power</p>
                    <p className="font-medium">{selectedBurst.power.toFixed(1)} dBFS</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Duration</p>
                    <p className="font-medium">{selectedBurst.duration.toFixed(3)} seconds</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Bandwidth</p>
                    <p className="font-medium">{(selectedBurst.bandwidth / 1000).toFixed(1)} kHz</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">IQ File</p>
                    <p className="font-medium">{selectedBurst.iq_file || 'Not recorded'}</p>
                  </div>
                </div>
                
                <div className="mt-4 flex justify-end space-x-3">
                  <button 
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                    disabled={!selectedBurst.iq_file}
                  >
                    Download IQ
                  </button>
                  <button className="px-3 py-1 bg-signal-blue text-white text-sm rounded hover:bg-blue-700">
                    Analyze
                  </button>
                </div>
              </div>
              
              {/* FFT Plot */}
              <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
                <h2 className="text-lg font-semibold mb-4">Frequency Spectrum</h2>
                <div className="h-64">
                  <Plot
                    data={[
                      {
                        x: generateFFTData(selectedBurst).x,
                        y: generateFFTData(selectedBurst).y,
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: '#007aff' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      margin: { l: 50, r: 20, t: 20, b: 50 },
                      xaxis: { 
                        title: 'Frequency (Hz)',
                        gridcolor: '#444',
                      },
                      yaxis: { 
                        title: 'Power (dBFS)', 
                        range: [-120, -20],
                        gridcolor: '#444'
                      },
                      font: {
                        color: '#ddd'
                      },
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      plot_bgcolor: 'rgba(0,0,0,0)'
                    }}
                    useResizeHandler={true}
                    style={{ width: '100%', height: '100%' }}
                    config={{ responsive: true, displayModeBar: false }}
                  />
                </div>
              </div>
              
              {/* Waveform Plot */}
              <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
                <h2 className="text-lg font-semibold mb-4">Time Domain</h2>
                <div className="h-64">
                  <Plot
                    data={[
                      {
                        x: generateWaveformData(selectedBurst).x,
                        y: generateWaveformData(selectedBurst).y,
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: '#34c759' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      margin: { l: 50, r: 20, t: 20, b: 50 },
                      xaxis: { 
                        title: 'Time (s)',
                        gridcolor: '#444'
                      },
                      yaxis: { 
                        title: 'Amplitude', 
                        range: [-1, 1],
                        gridcolor: '#444'
                      },
                      font: {
                        color: '#ddd'
                      },
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      plot_bgcolor: 'rgba(0,0,0,0)'
                    }}
                    useResizeHandler={true}
                    style={{ width: '100%', height: '100%' }}
                    config={{ responsive: true, displayModeBar: false }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-8 text-center h-[calc(100vh-240px)] flex flex-col items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400 mb-2">No Burst Selected</h3>
              <p className="text-gray-400 dark:text-gray-500">Select a burst from the list to view its details and analysis.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BurstAnalyzer; 