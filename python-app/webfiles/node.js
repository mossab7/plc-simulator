const express = require('express');
const cors = require('cors');
const { ModbusTCPClient } = require('jsmodbus');
const net = require('net');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const multer = require('multer');
require('dotenv').config();

// Configuration with environment variables and defaults
const config = {
  plcIp: process.env.PLC_IP || '127.0.0.1',
  plcPort: parseInt(process.env.PLC_PORT || '502'),
  unitId: parseInt(process.env.UNIT_ID || '1'),
  serverPort: parseInt(process.env.SERVER_PORT || '3000')
};

// Create Express app
const app = express();
app.use(express.json());
app.use(cors());

// PLC configuration
const plcConfig = {
  host: config.plcIp,  // PLC simulator IP
  port: config.plcPort,          // Modbus TCP port
  unitId: config.unitId           // Default unit ID
};

// Define global variables for connection management
let socket = new net.Socket();
let client = null;
let isConnected = false;
let connectionAttempts = 0;

// Store for last read values (for simulating when disconnected)
let lastReadValues = {
  temp: 25.0,
  pressure: 3.0,
  flow: 0.0,
  timestamp: new Date().toISOString()
};

// Initialize Modbus client
function initializeModbusClient() {
  socket = new net.Socket();
  client = new ModbusTCPClient(socket, plcConfig.unitId);
  
  // Set up socket event handlers
  socket.on('connect', () => {
    console.log(`Modbus TCP connection established after ${connectionAttempts} attempts`);
    connectionAttempts = 0;
    isConnected = true;
  });
  
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
    isConnected = false;
  });
  
  socket.on('close', () => {
    console.log('Modbus TCP connection closed');
    isConnected = false;
    
    // Try to reconnect after 5 seconds
    setTimeout(connectModbus, 5000);
  });
  
  return { socket, client };
}

// Connect to Modbus TCP server (PLC)
function connectModbus() {
  connectionAttempts++;
  console.log(`[Attempt ${connectionAttempts}] Connecting to PLC at ${config.plcIp}:${config.plcPort}...`);
  
  socket.connect({
    host: config.plcIp,
    port: config.plcPort
  });
}

// Create a new Modbus client connection for single transactions
function createModbusClient() {
  const newSocket = new net.Socket();
  const newClient = new ModbusTCPClient(newSocket, plcConfig.unitId);
  
  return { socket: newSocket, client: newClient };
}

// Read all relevant PLC registers
async function readPLCData() {
  const { socket: transactionSocket, client: transactionClient } = createModbusClient();
  
  return new Promise((resolve, reject) => {
    transactionSocket.on('connect', async () => {
      try {
        // Read holding registers from the PLC (registers 1-16)
        const response = await transactionClient.readHoldingRegisters(1, 16);
        
        // Process the values
        const registers = response.response._body.valuesAsArray;
        
        // Extract values from registers
        const values = {
          pumpControl: registers[0],    // Register 1
          pumpStatus: registers[1],     // Register 2
          temp: registers[9] / 10.0,    // Register 10 (Temperature)
          pressure: registers[10] / 100.0, // Register 11 (Pressure)
          flow: registers[11] / 10.0,   // Register 12 (Flow rate)
          staticHead: registers[12] / 10.0, // Register 13
          frictionLosses: registers[13] / 10.0, // Register 14
          suctionDiameter: registers[14], // Register 15
          elevation: registers[15] / 10.0 // Register 16
        };
        
        // Calculate NPSHa and NPSHr based on pump characteristics
        const npsha = calculateNPSHa(values);
        const npshr = calculateNPSHr(values.flow);
        
        transactionSocket.end();
        resolve({
          ...values,
          npsha,
          npshr,
          pumpRunning: values.pumpStatus === 1
        });
      } catch (error) {
        transactionSocket.end();
        reject(error);
      }
    });
    
    transactionSocket.on('error', (err) => {
      transactionSocket.end();
      reject(err);
    });
    
    // Connect to the PLC
    transactionSocket.connect(plcConfig.port, plcConfig.host);
  });
}

// Write to PLC register
async function writePLCRegister(register, value) {
  console.log(`Writing value ${value} to register ${register}`);
  
  try {
    const { socket: transactionSocket, client: transactionClient } = createModbusClient();
    
    // Connect first
    await new Promise((resolve, reject) => {
      transactionSocket.on('connect', () => {
        console.log('Socket connected for write operation');
        resolve();
      });
      
      transactionSocket.on('error', (err) => {
        console.error('Socket connection error during write:', err);
        reject(err);
      });
      
      transactionSocket.connect({ host: config.plcIp, port: config.plcPort });
    });
    
    // FIXED: The Modbus function code and register are now correctly used
    // Adding more detailed error handling and logging
    try {
      // For debugging, show all properties of the client
      console.log('Available client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(transactionClient)));
      
      // Try the write operation - using the correct register address
      const result = await transactionClient.writeSingleRegister(register, value);
      console.log('Write operation complete, full result:', JSON.stringify(result));
      
      // Close the connection properly
      transactionSocket.end();
      return { success: true, result };
    } catch (writeError) {
      console.error('Error during register write operation:', writeError);
      transactionSocket.end();
      throw writeError;
    }
  } catch (error) {
    console.error(`Failed to write ${value} to register ${register}:`, error);
    throw error;
  }
}

// Add the missing function to calculate NPSHa
function calculateNPSHa(values) {
  // NPSHa = (Pressure - Vapor Pressure) + Static Head - Friction Losses
  // Convert pressure from bar to meters of water (same as simulator)
  const pressure_m = values.pressure * 10.2; 
  const vaporPressure = calculateVaporPressure(values.temp);
  
  return pressure_m - vaporPressure + values.staticHead - values.frictionLosses;
}

// Replace the simplified NPSHr calculation with the more accurate curve-based one
function calculateNPSHr(flow) {
  // NPSHr curve data for 8x15DMX-3 pump
  const npshrCurve = [
    { flow: 0,    npshr: 0.5 },
    { flow: 100,  npshr: 3.2 },
    { flow: 200,  npshr: 6.0 },
    { flow: 300,  npshr: 9.1 },
    { flow: 400,  npshr: 12.4 },
    { flow: 480,  npshr: 16.4 },
    { flow: 550,  npshr: 15.8 },
    { flow: 650,  npshr: 15.0 },
    { flow: 750,  npshr: 14.2 },
    { flow: 850,  npshr: 14.0 },
    { flow: 950,  npshr: 14.4 },
    { flow: 1050, npshr: 15.2 },
    { flow: 1100, npshr: 16.0 },
    { flow: 1150, npshr: 17.5 },
    { flow: 1200, npshr: 19.0 },
  ];
  
  // Handle edge cases
  if (flow <= 0) return 0.5;
  if (flow >= 1200) return 19.0 + (flow - 1200) / 100 * 2.0; // Extrapolate beyond 1200
  
  // Find the two closest points for interpolation
  let lowerIndex = 0;
  for (let i = 0; i < npshrCurve.length - 1; i++) {
    if (flow >= npshrCurve[i].flow && flow <= npshrCurve[i+1].flow) {
      lowerIndex = i;
      break;
    }
  }
  
  // Linear interpolation
  const lowerPoint = npshrCurve[lowerIndex];
  const upperPoint = npshrCurve[lowerIndex + 1];
  const ratio = (flow - lowerPoint.flow) / (upperPoint.flow - lowerPoint.flow);
  const npshr = lowerPoint.npshr + ratio * (upperPoint.npshr - lowerPoint.npshr);
  
  return parseFloat(npshr.toFixed(2));
}

// Ensure both use the same vapor pressure calculation
function calculateVaporPressure(tempC) {
  // Same simplified calculation as in PLC simulator
  const vapor_pressure = 0.0061 * (1.8 * tempC + 32) ** 2 / 100;  // in bar
  
  // Convert to meters of water (1 bar = 10.2 meters of water)
  return vapor_pressure * 10.2;
}

// Define API routes
app.post('/plc/start', async (req, res) => {
  try {
    console.log('Received start pump request');
    // Write 1 to register 1 (pump control)
    const result = await writePLCRegister(1, 1);
    console.log('Start pump result:', result);
    res.json({ success: true, message: 'Pump started successfully' });
  } catch (error) {
    console.error('Error starting pump:', error);
    res.status(500).json({
      success: false,
      message: `Error starting pump: ${error.message}`
    });
  }
});

app.post('/plc/stop', async (req, res) => {
  try {
    console.log('Received stop pump request');
    // Write 0 to register 1 (pump control)
    const result = await writePLCRegister(1, 0);
    console.log('Stop pump result:', JSON.stringify(result));
    
    // Verify the write was successful by reading back the register
    try {
      const verifyResult = await client.readHoldingRegisters(1, 1);
      const newValue = verifyResult.response.body.valuesAsArray[0];
      console.log(`Verified pump control register value after write: ${newValue}`);
      
      if (newValue === 0) {
        res.json({ success: true, message: 'Pump stopped successfully' });
      } else {
        res.json({ success: false, message: 'Pump control register was not updated' });
      }
    } catch (verifyError) {
      console.error('Error verifying pump control register:', verifyError);
      res.json({ success: true, message: 'Pump stop requested, but verification failed' });
    }
  } catch (error) {
    console.error('Error stopping pump:', error);
    res.status(500).json({
      success: false,
      message: `Error stopping pump: ${error.message}`
    });
  }
});

app.get('/plc/status', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(503).json({ success: false, message: 'PLC connection not available' });
    }
    
    // Read register 2 to get pump status
    const result = await client.readHoldingRegisters(2, 1);
    const pumpStatus = result.response.body.valuesAsArray[0];
    console.log('Pump status read:', pumpStatus);
    
    res.json({ 
      success: true, 
      status: pumpStatus, 
      running: pumpStatus === 1,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error reading pump status:', error.message);
    res.status(500).json({ success: false, message: `Failed to read pump status: ${error.message}` });
  }
});

// Improved process data endpoint
app.get('/plc/process-data', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(503).json({ success: false, message: 'PLC connection not available' });
    }
    
    // Read multiple registers for temp, pressure, flow, etc. from the PLC
    const tempResult = await client.readHoldingRegisters(10, 1);
    const pressureResult = await client.readHoldingRegisters(11, 1);
    const flowResult = await client.readHoldingRegisters(12, 1);
    const statusResult = await client.readHoldingRegisters(2, 1);
    
    // Scale values appropriately based on PLC scaling
    const temp = tempResult.response._body.valuesAsArray[0] / 10;
    const pressure = pressureResult.response._body.valuesAsArray[0] / 100;
    const flow = flowResult.response._body.valuesAsArray[0] / 10;
    const pumpStatus = statusResult.response._body.valuesAsArray[0];
    
    // Store last read values for simulation during disconnection
    lastReadValues = {
      temp,
      pressure,
      flow,
      pumpStatus,
      timestamp: new Date().toISOString()
    };
    
    // Calculate NPSH values
    const npsha = calculateNPSHa({ temp, pressure, staticHead: 2.0, frictionLosses: 0.5 });
    const npshr = calculateNPSHr(flow);
    
    // Check for cavitation risk and stop pump if needed
    const isCavitationRisk = npsha < npshr;
    let cavitationAction = null;
    
    if (isCavitationRisk && pumpStatus === 1) {
      console.warn(`CAVITATION RISK DETECTED! NPSHa (${npsha.toFixed(2)}m) < NPSHr (${npshr.toFixed(2)}m) - Stopping pump automatically`);
      try {
        // Stop the pump automatically
        const stopResult = await writePLCRegister(1, 0);
        cavitationAction = {
          type: 'emergency_stop',
          reason: 'Cavitation risk detected',
          timestamp: new Date().toISOString(),
          success: stopResult.success
        };
      } catch (stopError) {
        console.error('Failed to stop pump during cavitation protection:', stopError);
        cavitationAction = {
          type: 'emergency_stop_failed',
          reason: 'Cavitation risk detected but stop command failed',
          timestamp: new Date().toISOString(),
          error: stopError.message
        };
      }
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      pumpRunning: cavitationAction?.success === false ? pumpStatus === 1 : pumpStatus === 1 && !isCavitationRisk,
      values: {
        temp,
        pressure,
        flow,
        npsha,
        npshr,
        margin: npsha - npshr,
        safe: !isCavitationRisk
      },
      cavitationProtection: isCavitationRisk ? {
        activated: pumpStatus === 1,
        action: cavitationAction
      } : null
    });
  } catch (error) {
    console.error('Error reading process values:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    modbusConnected: isConnected,
    plcInfo: {
      ip: config.plcIp,
      port: config.plcPort,
      unitId: config.unitId
    },
    uptime: process.uptime(),
    lastReadTime: lastReadValues.timestamp
  });
});

// Test connection endpoint
app.get('/plc/test-connection', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(503).json({ 
        success: false, 
        message: 'PLC connection not available',
        connected: false
      });
    }
    
    // Try to read a single register to verify communication
    const result = await client.readHoldingRegisters(1, 1);
    console.log('Test read successful:', result);
    
    res.json({ 
      success: true, 
      message: 'PLC connection test successful',
      connected: true,
      responseTime: `${result.response.duration}ms`
    });
  } catch (error) {
    console.error('Connection test failed:', error.message);
    isConnected = false; // Update status since we now know it's not working
    
    res.status(500).json({ 
      success: false, 
      message: `Connection test failed: ${error.message}`,
      connected: false
    });
  }
});

// Add this near the top of node.js where other variables are declared
let npshrCurveData = [];

// Simulation endpoint when PLC is unavailable (for development)
app.get('/plc/simulate', (req, res) => {
  // Calculate simulated values
  const temp = parseFloat(req.query.temp) || lastReadValues.temp;
  const pressure = parseFloat(req.query.pressure) || lastReadValues.pressure;
  const flow = parseFloat(req.query.flow) || lastReadValues.flow;
  
  // Calculate NPSH values
  const npsha = calculateNPSHa(temp, pressure);
  const npshr = calculateNPSHr(flow);
  
  res.json({
    success: true,
    simulated: true,
    timestamp: new Date().toISOString(),
    values: {
      temp,
      pressure,
      flow,
      npsha,
      npshr,
      margin: npsha - npshr,
      safe: npsha >= npshr
    }
  });
});

// Improved NPSH Available calculation function
function calculateNPSHA(temperature, pressure) {
  // Convert temperature to vapor pressure using more accurate model
  const vaporPressure = calculateVaporPressure(temperature);
  
  // Convert pressure from bar to Pascal
  const pressurePa = pressure * 100000;
  
  // Static head value (can be made configurable)
  const staticHead = 2.0; // meters
  
  // Friction losses (can be made configurable)
  const frictionLosses = Math.max(0.5, (0.05 * Math.pow(temperature/25, 0.5))); // increases with temp
  
  // Water density (kg/m³) - decreases slightly with temperature
  const density = 1000 - 0.1 * (temperature - 20);
  
  // Gravity (m/s²)
  const g = 9.81;
  
  // Calculate NPSHA in meters
  const npsha = (pressurePa - vaporPressure) / (density * g) + staticHead - frictionLosses;
  
  return Math.max(0, parseFloat(npsha.toFixed(2)));
}

// Improved vapor pressure calculation based on Antoine equation
function calculateVaporPressure(temperature) {
  // More accurate Antoine equation coefficients for water
  // Valid for 1-100°C
  const A = 8.07131;
  const B = 1730.63;
  const C = 233.426;
  
  // Calculate vapor pressure in mmHg
  const vaporPressureMmHg = Math.pow(10, A - (B / (temperature + C)));
  
  // Convert to bar (1 mmHg = 0.00133322 bar)
  const vaporPressureBar = vaporPressureMmHg * 0.00133322;
  
  // Convert to meters of water (1 bar = 10.2 meters of water)
  return vaporPressureBar * 10.2;
}

// Function to load NPSH curve from CSV file - only loading NPSHr curve
function loadNPSHrCurve(pumpType = 'default') {
  return new Promise((resolve, reject) => {
    const curveData = [];
    const filePath = path.join(__dirname, 'curves', `${pumpType}_npshr.csv`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.warn(`NPSH curve file not found: ${filePath}, using default curve`);
      // Return default curve if file doesn't exist
      resolve([
        { flow: 0, npshr: 0.5 },
        { flow: 100, npshr: 2.0 },
        { flow: 200, npshr: 5.5 },
        { flow: 300, npshr: 11.0 },
        { flow: 400, npshr: 18.5 }
      ]);
      return;
    }
    
    // Read and parse the CSV file - assuming simple format with flow,npshr columns
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Only care about flow and npshr columns
        if (row.flow !== undefined && row.npshr !== undefined) {
          curveData.push({
            flow: parseFloat(row.flow),
            npshr: parseFloat(row.npshr)
          });
        }
      })
      .on('end', () => {
        console.log(`Loaded ${curveData.length} points from NPSH curve file: ${filePath}`);
        // Sort by flow to ensure proper interpolation
        curveData.sort((a, b) => a.flow - b.flow);
        resolve(curveData);
      })
      .on('error', (error) => {
        console.error(`Error reading NPSH curve file: ${error.message}`);
        reject(error);
      });
  });
}

// Improved interpolation function with better error handling
function interpolateNPSHr(flow, customCurve = null) {
  // Use provided custom curve, or the globally loaded curve, or a default curve
  const curve = customCurve || npshrCurveData || [
    { flow: 0, npshr: 0.5 },
    { flow: 100, npshr: 2.0 },
    { flow: 200, npshr: 5.5 },
    { flow: 300, npshr: 11.0 },
    { flow: 400, npshr: 18.5 }
  ];
  
  // Handle edge cases
  if (!curve || curve.length === 0) {
    console.error('No NPSH curve data available for interpolation');
    return 0;
  }
  
  if (curve.length === 1) {
    return curve[0].npshr;
  }
  
  // Handle flow outside curve range
  if (flow <= curve[0].flow) return curve[0].npshr;
  if (flow >= curve[curve.length - 1].flow) return curve[curve.length - 1].npshr;
  
  // Find the two closest points for interpolation
  let lowerIndex = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    if (flow >= curve[i].flow && flow <= curve[i+1].flow) {
      lowerIndex = i;
      break;
    }
  }
  
  // Linear interpolation
  const lowerPoint = curve[lowerIndex];
  const upperPoint = curve[lowerIndex + 1];
  const ratio = (flow - lowerPoint.flow) / (upperPoint.flow - lowerPoint.flow);
  const npshr = lowerPoint.npshr + ratio * (upperPoint.npshr - lowerPoint.npshr);
  
  return parseFloat(npshr.toFixed(2));
}

// Add API to get curve data
app.get('/api/curves/:pumpType', async (req, res) => {
  try {
    const pumpType = req.params.pumpType || 'default';
    const curveData = await loadNPSHrCurve(pumpType);
    
    res.json({
      success: true,
      pumpType: pumpType,
      curve: curveData
    });
  } catch (error) {
    console.error(`Error getting curve data for ${req.params.pumpType}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start the server if this file is run directly
if (require.main === module) {
  initializeServer();
}

// Export the app for integration with other routes
module.exports = app;

// File upload handling
const upload = multer({ dest: 'curves/' });

app.post('/api/curves/upload', upload.single('curveFile'), (req, res) => {
  const pumpType = req.body.pumpType || 'default';
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  
  // Rename the file to match the expected format
  const newPath = path.join(__dirname, 'curves', `${pumpType}_npshr.csv`);
  fs.renameSync(file.path, newPath);
  
  // Reload the curve data
  loadNPSHrCurve(pumpType).then(curveData => {
    npshrCurveData = curveData;
    res.json({ 
      success: true, 
      message: `Curve for ${pumpType} uploaded and loaded`,
      points: curveData.length
    });
  }).catch(err => {
    res.status(500).json({ success: false, message: err.message });
  });
});

// Initialize server and Modbus connection
async function initializeServer() {
  try {
    // Initialize the Modbus client
    initializeModbusClient();
    
    // Test connection to PLC simulator
    connectModbus();
    
    // Start the Express server
    app.listen(config.serverPort, () => {
      console.log(`Server running on port ${config.serverPort}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
  }
}