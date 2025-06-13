// Global variables
let npshChart = null;
let monitoringInterval = null;
let pumpRunning = false;
let cavitationCountdown = null; // Added for cavitation risk management

// Real-time data management
const realTimeData = {
  isMonitoring: false,
  dataPoints: [],
  maxPoints: 120, // Show last 2 minutes (at 1s interval)
  labels: [],
  npshaValues: [],
  npshrValues: [],
  flowValues: []
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM Content Loaded - Setting up event listeners');
  
  // Debug element presence
  const elements = {
    startBtn: document.getElementById('pumpStartButton'),
    stopBtn: document.getElementById('pumpStopButton'),
    monitorBtn: document.getElementById('monitorToggleButton'),
    exportBtn: document.getElementById('exportDataButton')
  };
  
  // Log which elements were found
  Object.entries(elements).forEach(([name, element]) => {
    console.log(`${name}: ${element ? 'Found' : 'NOT FOUND'}`);
  });
  
  // Set up event listeners with error handling
  if (elements.startBtn) {
    elements.startBtn.addEventListener('click', function() {
      console.log('Start button clicked');
      startPump();
    });
  }
  
  if (elements.stopBtn) {
    elements.stopBtn.addEventListener('click', function() {
      console.log('Stop button clicked');
      stopPump();
    });
  }
  
  if (elements.monitorBtn) {
    elements.monitorBtn.addEventListener('click', function() {
      console.log('Monitor button clicked');
      toggleRealTimeMonitoring();
    });
  }
  
  if (elements.exportBtn) {
    elements.exportBtn.addEventListener('click', function() {
      console.log('Export button clicked');
      exportDataToCsv();
    });
  }
  
  // Initialize chart
  createEmptyChart();
  
  // Start checking connection status
  checkConnectionStatus();
  setInterval(checkConnectionStatus, 5000);
  
  // Auto-start monitoring
  startRealTimeMonitoring();
});

// Create empty chart to be updated later
function createEmptyChart() {
  const ctx = document.getElementById('npshChart').getContext('2d');
  
  npshChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'NPSHa (Available)',
          data: [],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.2)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 1,
          pointBackgroundColor: '#27ae60'
        },
        {
          label: 'NPSHr (Required)',
          data: [],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.2)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 1,
          pointBackgroundColor: '#e74c3c'
        },
        {
          label: 'Flow Rate (m³/h)',
          data: [],
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.2)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 1,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 300 // Fast but visible animation
      },
      plugins: {
        title: {
          display: true,
          text: 'Real-Time NPSH Monitoring',
          font: {
            size: 16,
            weight: 'bold'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'second',
            displayFormats: {
              second: 'HH:mm:ss'
            }
          },
          title: {
            display: true,
            text: 'Time',
            font: { weight: 'bold' }
          }
        },
        y: {
          title: {
            display: true,
            text: 'NPSH (m)',
            font: { weight: 'bold' }
          },
          beginAtZero: false
        },
        y1: {
          position: 'right',
          title: {
            display: true,
            text: 'Flow Rate (m³/h)',
            font: { weight: 'bold' }
          },
          beginAtZero: true,
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

// Start the pump
async function startPump() {
  try {
    console.log('Starting pump...');
    document.getElementById('pumpStartButton').disabled = true;
    
    const response = await fetch('http://localhost:3000/plc/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    console.log('Pump start response:', data);
    
    if (data.success) {
      showAlert('Pump started successfully', 'success');
      pumpRunning = true;
      updatePumpStatusIndicator(true);
      
      // Start monitoring if not already
      if (!realTimeData.isMonitoring) {
        startRealTimeMonitoring();
      } else {
        // Immediately fetch new data to update the UI
        await fetchPLCData();  // Added this line
      }
    } else {
      showAlert(`Failed to start pump: ${data.message}`, 'error');
    }
  } catch (error) {
    console.error('Error starting pump:', error);
    showAlert(`Error starting pump: ${error.message}`, 'error');
  } finally {
    document.getElementById('pumpStartButton').disabled = false;
  }
}

// Stop the pump
async function stopPump() {
  try {
    console.log('Stopping pump...');
    document.getElementById('pumpStopButton').disabled = true;
    
    const response = await fetch('http://localhost:3000/plc/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    console.log('Pump stop response:', data);
    
    if (data.success) {
      showAlert('Pump stopped successfully', 'success');
      pumpRunning = false;
      updatePumpStatusIndicator(false);
      
      // Immediately fetch new data to update the UI
      if (realTimeData.isMonitoring) {
        await fetchPLCData();  // Added this line
      }
    } else {
      showAlert(`Failed to stop pump: ${data.message}`, 'error');
    }
  } catch (error) {
    console.error('Error stopping pump:', error);
    showAlert(`Error stopping pump: ${error.message}`, 'error');
  } finally {
    document.getElementById('pumpStopButton').disabled = false;
  }
}

// Real-time monitoring toggle
function toggleRealTimeMonitoring() {
  console.log('Toggling monitoring. Current state:', realTimeData.isMonitoring);
  if (realTimeData.isMonitoring) {
    stopRealTimeMonitoring();
  } else {
    startRealTimeMonitoring();
  }
}

// Start real-time monitoring
function startRealTimeMonitoring() {
  console.log('Starting real-time monitoring');
  realTimeData.isMonitoring = true;
  monitoringInterval = setInterval(fetchPLCData, 1000);
  
  const monitorBtn = document.getElementById('monitorToggleButton');
  monitorBtn.innerText = '⏹️ Stop Monitoring';
  monitorBtn.classList.add('btn-secondary');
  
  showAlert('Real-time monitoring started', 'success');
}

// Stop real-time monitoring
function stopRealTimeMonitoring() {
  console.log('Stopping real-time monitoring');
  realTimeData.isMonitoring = false;
  clearInterval(monitoringInterval);
  
  const monitorBtn = document.getElementById('monitorToggleButton');
  monitorBtn.innerText = '📊 Start Monitoring';
  monitorBtn.classList.remove('btn-secondary');
  
  showAlert('Real-time monitoring stopped', 'success');
}

// Fetch data from PLC
async function fetchPLCData() {
  try {
    const response = await fetch('http://localhost:3000/plc/process-data');
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      // Update pump metadata if available in the response
      if (data.pumpMetadata) {
        updatePumpMetadata(data.pumpMetadata);
      }
      
      // Add new data point
      addNewDataPoint(data.values);
      
      // Update PLC status display
      updatePLCStatus(data.values);
      
      // Update pump status indicator
      pumpRunning = !!data.pumpRunning;
      updatePumpStatusIndicator(pumpRunning);
      
      // Update connection status
      updateConnectionStatus(true);
    } else {
      console.error('PLC data error:', data.message);
    }
  } catch (error) {
    console.error('Error fetching PLC data:', error);
    updateConnectionStatus(false);
    
    if (realTimeData.isMonitoring) {
      stopRealTimeMonitoring();
      showAlert('Lost connection to PLC: ' + error.message, 'error');
    }
  }
}

// Add new data point to chart
function addNewDataPoint(plcData) {
  const timestamp = new Date();
  
  // Store the data for potential export
  realTimeData.dataPoints.push({
    timestamp,
    npsha: plcData.npsha,
    npshr: plcData.npshr,
    flow: plcData.flow
  });
  
  // Add data to arrays
  realTimeData.labels.push(timestamp);
  realTimeData.npshaValues.push(plcData.npsha);
  realTimeData.npshrValues.push(plcData.npshr);
  realTimeData.flowValues.push(plcData.flow);
  
  // Limit data points to prevent memory issues
  if (realTimeData.labels.length > realTimeData.maxPoints) {
    realTimeData.labels = realTimeData.labels.slice(-realTimeData.maxPoints);
    realTimeData.npshaValues = realTimeData.npshaValues.slice(-realTimeData.maxPoints);
    realTimeData.npshrValues = realTimeData.npshrValues.slice(-realTimeData.maxPoints);
    realTimeData.flowValues = realTimeData.flowValues.slice(-realTimeData.maxPoints);
  }
  
  // Also limit the dataPoints array
  if (realTimeData.dataPoints.length > realTimeData.maxPoints * 2) {
    realTimeData.dataPoints = realTimeData.dataPoints.slice(-realTimeData.maxPoints);
  }
  
  // Update chart with new data
  updateChart();
}

// Update chart with current data
function updateChart() {
  if (!npshChart) {
    console.error('Chart not initialized');
    return;
  }

  // Update chart data
  npshChart.data.labels = realTimeData.labels;
  npshChart.data.datasets[0].data = realTimeData.npshaValues;
  npshChart.data.datasets[1].data = realTimeData.npshrValues;
  npshChart.data.datasets[2].data = realTimeData.flowValues;
  
  // Update the chart - no animation for real-time updates
  npshChart.update('none');
}

// Update PLC status display
function updatePLCStatus(plcData) {
  // Get or create status summary element
  let statusSummary = document.getElementById('plcStatusSummary');
  if (!statusSummary) {
    console.error('Status summary element not found');
    return;
  }
  
  // Safe status class
  const isCavitationRisk = plcData.npsha < plcData.npshr;
  const statusClass = isCavitationRisk ? 'status-warning' : 'status-ok';
  const margin = (plcData.npsha - plcData.npshr).toFixed(2);
  const timestamp = new Date().toLocaleTimeString();
  
  // Handle cavitation risk detection
  if (isCavitationRisk && pumpRunning && !cavitationCountdown) {
    handleCavitationRisk();
  } else if (!isCavitationRisk && cavitationCountdown) {
    // Cancel countdown if condition is resolved
    clearCavitationCountdown();
  }
  
  // Calculate remaining time for display
  let countdownDisplay = '';
  if (cavitationCountdown) {
    const remainingSeconds = Math.ceil((cavitationCountdown.targetTime - Date.now()) / 1000);
    countdownDisplay = `<div class="countdown-warning">⚠️ CAVITATION RISK DETECTED! Pump will stop in ${remainingSeconds} seconds. 
      <button class="btn btn-sm btn-secondary" onclick="clearCavitationCountdown()">Cancel</button></div>`;
  }
  
  // Update status display with improved layout
  statusSummary.innerHTML = `
    <div class="status-header">
      <h3>PLC Status - Updated at ${timestamp}</h3>
      <div class="pump-status ${pumpRunning ? 'status-ok' : 'status-warning'}">
        Pump: ${pumpRunning ? 'RUNNING' : 'STOPPED'}
      </div>
    </div>
    ${countdownDisplay}
    
    <div class="status-panels">
      <div class="status-panel primary-readings">
        <h4>Primary Readings</h4>
        <div class="panel-content">
          <div class="status-item">
            <span class="status-label">Temperature:</span>
            <span class="status-value">${plcData.temp.toFixed(1)} °C</span>
          </div>
          <div class="status-item">
            <span class="status-label">Pressure:</span>
            <span class="status-value">${plcData.pressure.toFixed(2)} bar</span>
          </div>
          <div class="status-item">
            <span class="status-label">Flow Rate:</span>
            <span class="status-value">${plcData.flow.toFixed(1)} m³/h</span>
          </div>
        </div>
      </div>
      
      <div class="status-panel npsh-readings">
        <h4>NPSH Analysis</h4>
        <div class="panel-content">
          <div class="status-item">
            <span class="status-label">NPSHr (Required):</span>
            <span class="status-value">${plcData.npshr.toFixed(2)} m</span>
          </div>
          <div class="status-item">
            <span class="status-label">NPSHa (Available):</span>
            <span class="status-value">${plcData.npsha.toFixed(2)} m</span>
          </div>
          <div class="status-item highlight">
            <span class="status-label">Safety Margin:</span>
            <span class="status-value ${statusClass}">${margin} m ${isCavitationRisk ? '⚠️' : '✅'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Update pump metadata display with data fetched from PLC
function updatePumpMetadata(metadata) {
  const metadataElement = document.getElementById('pumpMetadata');
  if (!metadataElement) {
    console.error('Metadata element not found');
    return;
  }
  
  metadataElement.innerHTML = `
    <div class="metadata-item">
      <span class="metadata-label">Pump Type:</span>
      <span class="metadata-value">${metadata.pumpType || 'Unknown'}</span>
    </div>
    <div class="metadata-item">
      <span class="metadata-label">Rated Flow:</span>
      <span class="metadata-value">${metadata.ratedFlow || '0'} m³/h</span>
    </div>
    <div class="metadata-item">
      <span class="metadata-label">AOR Range:</span>
      <span class="metadata-value">${metadata.aorMin || '0'}-${metadata.aorMax || '0'} m³/h</span>
    </div>
    <div class="metadata-item">
      <span class="metadata-label">POR Range:</span>
      <span class="metadata-value">${metadata.porMin || '0'}-${metadata.porMax || '0'} m³/h</span>
    </div>
    <div class="metadata-item">
      <span class="metadata-label">Rated NPSHr:</span>
      <span class="metadata-value">${metadata.ratedNPSHr || '0'} m</span>
    </div>
  `;
  
  metadataElement.style.display = 'flex';
}

// Update pump status indicator
function updatePumpStatusIndicator(running) {
  const startBtn = document.getElementById('pumpStartButton');
  const stopBtn = document.getElementById('pumpStopButton');
  
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;
}

// Check connection status
async function checkConnectionStatus() {
  try {
    const response = await fetch('http://localhost:3000/status', { method: 'GET' });
    updateConnectionStatus(response.ok);
  } catch (error) {
    updateConnectionStatus(false);
  }
}

// Update connection status display
function updateConnectionStatus(connected) {
  const statusElement = document.getElementById('connectionStatus');
  if (statusElement) {
    statusElement.className = connected ? 'status-ok' : 'status-warning';
    statusElement.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

// Show alert messages
function showAlert(message, type) {
  const alertElement = document.getElementById(type === 'error' ? 'errorAlert' : 'successAlert');
  if (alertElement) {
    alertElement.textContent = message;
    alertElement.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      alertElement.style.display = 'none';
    }, 5000);
  }
}

// Add this new function for CSV export
function exportDataToCsv() {
  console.log('Exporting data to CSV...');
  
  // Check if we have data to export
  if (realTimeData.dataPoints.length === 0) {
    showAlert('No data available to export', 'error');
    return;
  }
  
  // Create CSV content
  let csvContent = 'data:text/csv;charset=utf-8,';
  
  // Add header row
  csvContent += 'Timestamp,NPSHa (m),NPSHr (m),Flow Rate (m³/h),Margin (m),Status\n';
  
  // Add data rows
  for (const point of realTimeData.dataPoints) {
    const timestamp = new Date(point.timestamp).toISOString();
    const npsha = point.npsha;
    const npshr = point.npshr;
    const flow = point.flow;
    const margin = (npsha - npshr).toFixed(2);
    const status = npsha >= npshr ? 'Safe' : 'Cavitation Risk';
    
    csvContent += `${timestamp},${npsha.toFixed(2)},${npshr.toFixed(2)},${flow.toFixed(1)},${margin},${status}\n`;
  }
  
  // Create download link
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `npsh_data_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
  document.body.appendChild(link);
  
  // Trigger download and remove link
  link.click();
  document.body.removeChild(link);
  
  showAlert('CSV file exported successfully', 'success');
}

// Handle cavitation risk detection
function handleCavitationRisk() {
  // Show immediate alert
  showAlert('CAVITATION RISK DETECTED! Pump will automatically stop in 30 seconds.', 'error');
  
  // Play alert sound if available
  const alertSound = document.getElementById('alertSound');
  if (alertSound) {
    alertSound.play().catch(e => console.log('Error playing alert sound:', e));
  }
  
  // Set up countdown
  const targetTime = Date.now() + 30000; // 30 seconds from now
  
  cavitationCountdown = {
    targetTime: targetTime,
    timer: setTimeout(() => {
      // Stop the pump after countdown
      stopPump();
      showAlert('Pump automatically stopped due to cavitation risk', 'error');
      cavitationCountdown = null;
    }, 30000)
  };
  
  // Start a faster interval to update the countdown display
  cavitationCountdown.displayTimer = setInterval(() => {
    // Force update UI to show countdown
    if (realTimeData.isMonitoring) {
      const statusSummary = document.getElementById('plcStatusSummary');
      if (statusSummary && statusSummary.querySelector('.countdown-warning')) {
        const remainingSeconds = Math.ceil((targetTime - Date.now()) / 1000);
        const countdownElement = statusSummary.querySelector('.countdown-warning');
        countdownElement.innerHTML = `⚠️ CAVITATION RISK DETECTED! Pump will stop in ${remainingSeconds} seconds. 
          <button class="btn btn-sm btn-secondary" onclick="clearCavitationCountdown()">Cancel</button>`;
      }
    }
  }, 1000);
}

// Clear cavitation countdown if conditions improve or user cancels
function clearCavitationCountdown() {
  if (cavitationCountdown) {
    clearTimeout(cavitationCountdown.timer);
    clearInterval(cavitationCountdown.displayTimer);
    cavitationCountdown = null;
    showAlert('Automatic pump shutdown canceled', 'success');
  }
}