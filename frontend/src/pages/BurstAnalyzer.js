import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { deviceApi } from '../utils/api';

function BurstAnalyzer({ bursts }) {
  const [selectedBurst, setSelectedBurst] = useState(null);
  const [fftData, setFftData] = useState({ x: [], y: [] });
  const [waveformData, setWaveformData] = useState({ x: [], y: [] });
  const [isLoading, setIsLoading] = useState(false);

  // Handler for selecting a burst
  const handleBurstSelect = async (burst) => {
    setSelectedBurst(burst);
    
    if (burst && burst.id) {
      setIsLoading(true);
      
      try {
        // Request the actual FFT data for this burst if it exists
        if (burst.fft_data_id) {
          const fftResponse = await deviceApi.getFftData(burst.fft_data_id);
          if (fftResponse.data && fftResponse.data.frequencies && fftResponse.data.power) {
            setFftData({
              x: fftResponse.data.frequencies,
              y: fftResponse.data.power
            });
          }
        }
        
        // Request the IQ data for this burst if it exists
        if (burst.iq_file) {
          const iqResponse = await deviceApi.getIqPreview(burst.id);
          if (iqResponse.data && iqResponse.data.time && iqResponse.data.amplitude) {
            setWaveformData({
              x: iqResponse.data.time,
              y: iqResponse.data.amplitude
            });
          }
        }
      } catch (error) {
        console.error("Error fetching burst data:", error);
      } finally {
        setIsLoading(false);
      }
    }
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
                    onClick={() => window.location.href = deviceApi.getIqDownloadUrl(selectedBurst.id)}
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
                  {isLoading ? (
                    <div className="h-full flex items-center justify-center">
                      <p>Loading data...</p>
                    </div>
                  ) : fftData.x.length > 0 ? (
                    <Plot
                      data={[
                        {
                          x: fftData.x,
                          y: fftData.y,
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
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <p>FFT data not available for this burst</p>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Waveform Plot */}
              <div className="bg-white dark:bg-darker-bg rounded-lg shadow-md p-4">
                <h2 className="text-lg font-semibold mb-4">Time Domain</h2>
                <div className="h-64">
                  {isLoading ? (
                    <div className="h-full flex items-center justify-center">
                      <p>Loading data...</p>
                    </div>
                  ) : waveformData.x.length > 0 ? (
                    <Plot
                      data={[
                        {
                          x: waveformData.x,
                          y: waveformData.y,
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
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <p>Waveform data not available for this burst</p>
                    </div>
                  )}
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