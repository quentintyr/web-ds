/**
 * FRC Web Driver Station & Robot Dashboard JavaScript
 * Integrates LibDS driver station functionality with robot telemetry dashboard
 */

let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

class FRCDriverStation {
    constructor() {
        this.updateInterval = null;
        this.logInterval = null;
        this.lastUpdateTime = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        
        // Initialize the driver station
        this.init();
    }
    
    init() {
        console.log('🚀 Initializing FRC Web Driver Station & Dashboard');
        
        // Start status updates
        this.startStatusUpdates();
        
        // Start robot data updates  
        this.startRobotDataUpdates();

        // Connect to WebSocket for real-time updates
        this.connectWebSocket();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        console.log('✅ Driver Station initialized');
    }
    
    // === Driver Station Status Updates ===
    
    startStatusUpdates() {
        // Update immediately
        this.updateDriverStationStatus();
        
        // Then update every 500ms
        this.updateInterval = setInterval(() => {
            this.updateDriverStationStatus();
        }, 500);
    }
    
    async updateDriverStationStatus() {
        try {
            const response = await fetch('/api/ds?action=status');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const status = await response.json();
            this.displayDriverStationStatus(status);
            this.updateConnectionStatus(true);
            this.retryCount = 0;
            
        } catch (error) {
            console.error('❌ Failed to update driver station status:', error);
            this.updateConnectionStatus(false);
            this.retryCount++;
        }
    }
    
    displayDriverStationStatus(status) {
        // Debug: Log the received mode value
        console.log('📊 Received robot status:', {
            mode: status.mode,
            mode_type: typeof status.mode,
            mode_string: status.mode_string,
            enabled: status.enabled,
            connected: status.connected
        });
        
        // Update robot mode indicator
        const modeEl = document.getElementById('robot-mode');
        if (modeEl) {
            // Handle both numeric and string mode values
            let modeName = 'UNKNOWN';
            if (typeof status.mode === 'string') {
                // String mode from FRC protocol
                const stringModeNames = {
                    'teleop': 'TELEOP',
                    'autonomous': 'AUTONOMOUS', 
                    'test': 'TEST'
                };
                modeName = stringModeNames[status.mode.toLowerCase()] || 'UNKNOWN';
            } else {
                // Numeric mode (legacy)
                const numericModeNames = {
                    0: 'TEST',
                    1: 'AUTONOMOUS',
                    2: 'TELEOP'
                };
                modeName = numericModeNames[status.mode] || 'UNKNOWN';
            }
            
            modeEl.textContent = modeName;
            modeEl.className = `mode-indicator ${modeName.toLowerCase()}`;
        }
        
        // Update mode button states
        this.updateModeButtons(status.mode);
        
        // Update battery widget with driver station voltage
        if (status.voltage !== undefined) {
            let batteryStatus = 'ok';
            if (status.voltage < 11.5) batteryStatus = 'error';        
            else if (status.voltage < 12.0) batteryStatus = 'busy';
            
            updateWidget('battery', batteryStatus, status.voltage.toFixed(1), 'V');
        }
        
        // Debug: Log robot communication status
        console.log('🤖 Robot Status:', {
            robot_communications: status.robot_communications,
            robot_code: status.robot_code,
            team_number: status.team_number,
            can_be_enabled: status.can_be_enabled
        });
        
        // Update system statistics if available
        if (status.cpu_percent !== undefined || status.ram_percent !== undefined || status.connected_clients !== undefined) {
            this.updateSystemStats(status);
        }
        
        // Update enable/disable button states
        this.updateControlButtons(status);
    }
    
    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const statusText = document.getElementById('connection-status');
        
        isConnected = connected;
        
        if (connected) {
            indicator.className = 'connection-indicator connected';
            statusText.textContent = 'Connected';
            reconnectAttempts = 0;
        } else {
            indicator.className = 'connection-indicator disconnected';
            statusText.textContent = 'Disconnected';
        }
    }
    
    updateModeButtons(currentMode) {
        // Remove active class from all mode buttons
        document.querySelectorAll('.btn-mode').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Handle both string and numeric mode values
        let activeButtonId = null;
        
        if (typeof currentMode === 'string') {
            // String mode from FRC protocol
            const stringModeButtons = {
                'teleop': 'teleop-btn',
                'autonomous': 'auto-btn',
                'test': 'test-btn'
            };
            activeButtonId = stringModeButtons[currentMode.toLowerCase()];
        } else {
            // Numeric mode (legacy compatibility)
            const numericModeButtons = {
                0: 'test-btn',
                1: 'auto-btn', 
                2: 'teleop-btn'
            };
            activeButtonId = numericModeButtons[currentMode];
        }
        
        // Add active class to current mode button
        if (activeButtonId) {
            const activeButton = document.getElementById(activeButtonId);
            if (activeButton) {
                activeButton.classList.add('active');
                console.log(`🎮 Mode button activated: ${activeButtonId} (mode: ${currentMode})`);
            }
        } else {
            console.warn(`⚠️ Unknown mode value: ${currentMode} (type: ${typeof currentMode})`);
        }
    }
    
    updateControlButtons(status) {
        const enableBtn = document.getElementById('enable-btn');
        const disableBtn = document.getElementById('disable-btn');
        
        if (enableBtn && disableBtn) {
            // Update button states based on robot status
            if (status.enabled) {
                enableBtn.style.opacity = '0.6';
                disableBtn.style.opacity = '1';
                enableBtn.disabled = false;  // Always allow re-enabling
                disableBtn.disabled = false;
            } else {
                // Allow enabling even if robot isn't fully connected (for testing)
                enableBtn.style.opacity = '1';
                disableBtn.style.opacity = '0.6';
                enableBtn.disabled = false;  // Always allow enabling attempts
                disableBtn.disabled = false;
            }
            
            // Only disable if emergency stopped
            if (status.emergency_stopped) {
                enableBtn.disabled = true;
                enableBtn.style.opacity = '0.3';
            }
        }
    }
    
    // === Robot Data Updates ===
    
    startRobotDataUpdates() {
        // Start data fetching
        this.fetchRobotData();
        this.fetchLogs();
        
        // Set up periodic updates
        setInterval(() => this.fetchRobotData(), 1000);  // Update data every second
        setInterval(() => this.fetchLogs(), 2000);       // Update logs every 2 seconds
    }
    
    async fetchRobotData() {
        try {
            // Fetch from the JSON file your SimpleJsonWriter creates
            const response = await fetch('status.json', {cache: "no-store"});
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.updateDashboard(data);
            
        } catch (error) {
            console.error('Error fetching robot data:', error);
            
            // Try to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(() => this.fetchRobotData(), 2000);
            }
        }
    }
    
    updateDashboard(data) {
        // Update Hardware Widgets (Sensors)
        
        // Ultrasonic Sensors
        if (data.USSensorLeft !== undefined) {
            const leftStatus = data.USSensorLeft > 0 ? 'ok' : 'error';
            updateWidget('sonic-left', leftStatus, data.USSensorLeft, 'cm');
        }
        
        if (data.USSensorRight !== undefined) {
            const rightStatus = data.USSensorRight > 0 ? 'ok' : 'error';
            updateWidget('sonic-right', rightStatus, data.USSensorRight, 'cm');
        }
        
        // IR Sensors
        if (data.IRSensorLeft !== undefined) {
            const leftIRStatus = data.IRSensorLeft > 0 ? 'ok' : 'idle';
            updateWidget('ir-left', leftIRStatus, data.IRSensorLeft, 'cm');
        }
        
        if (data.IRSensorRight !== undefined) {
            const rightIRStatus = data.IRSensorRight > 0 ? 'ok' : 'idle';
            updateWidget('ir-right', rightIRStatus, data.IRSensorRight, 'cm');
        }
        
        // Lidar
        if (data.lidarDistance !== undefined) {
            const lidarStatus = data.lidarStatus || 'idle';
            updateWidget('lidar', lidarStatus, data.lidarDistance, 'cm');
        }
        
        // Update Subsystem Widgets
        
        // Extender
        if (data.extenderStatus !== undefined) {
            updateWidget('extender', data.extenderStatus, data.extenderLength || 0, 'cm');
        }
        
        // Elevator
        if (data.elevatorPosition !== undefined) {
            updateWidget('elevator', 'idle', data.elevatorPosition);
        }
        
        // Gripper
        if (data.gripperStatus !== undefined) {
            const gripperStatus = data.gripperStatus === 'open' ? 'idle' : 'ok';
            updateWidget('gripper', gripperStatus, data.gripperStatus);
        }
        
        // Carriage Position
        if (data.carriagePosition !== undefined) {
            updateWidget('arm', 'idle', data.carriagePosition);
        }
        
        // Line Follower
        if (data.lineFollowerSensor !== undefined) {
            const lineStatus = data.lineFollowerSensor === 'on line' ? 'ok' : 'idle';
            updateWidget('vision', lineStatus, data.lineFollowerSensor);
        }
    }
    
    async fetchLogs() {
        try {
            const response = await fetch('robot.log', {cache: "no-store"});
            const data = await response.text();
            
            const logContainer = document.getElementById('robot-log');
            if (logContainer) {
                // Convert ANSI color codes to HTML
                const htmlContent = this.convertAnsiToHtml(data);
                logContainer.innerHTML = htmlContent;
                
                // Auto-scroll to bottom
                const wasAtBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 5;
                if (wasAtBottom) {
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            const logContainer = document.getElementById('robot-log');
            if (logContainer) {
                logContainer.textContent = "Unable to fetch log";
            }
        }
    }
    
    convertAnsiToHtml(text) {
        // Simple ANSI to HTML conversion
        return text
            .replace(/\[31m/g, '<span class="log-error">')      // Red
            .replace(/\[32m/g, '<span class="log-success">')    // Green  
            .replace(/\[33m/g, '<span class="log-warning">')    // Yellow
            .replace(/\[34m/g, '<span class="log-info">')       // Blue
            .replace(/\[35m/g, '<span class="log-debug">')      // Magenta
            .replace(/\[36m/g, '<span class="log-thread">')     // Cyan
            .replace(/\[0m/g, '</span>')                        // Reset
            .replace(/\n/g, '<br>');
    }

    // === WebSocket Connection ===

    connectWebSocket() {
        try {
            const loc = window.location;
            const wsProtocol = loc.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${wsProtocol}://${loc.hostname}:8765`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('🔌 WebSocket connected for system monitoring');
            };

            this.ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.type === 'system_stats' && msg.data) {
                        this.updateSystemStats(msg.data);
                    } else if (msg.type === 'log' && msg.line) {
                        // Handle individual log lines if needed
                        console.log('📥 Log:', msg.line);
                    }
                } catch (e) {
                    console.error('WebSocket message error:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('🔌 WebSocket disconnected, attempting to reconnect...');
                setTimeout(() => this.connectWebSocket(), 3000);
            };

            this.ws.onerror = (err) => {
                console.error('WebSocket error:', err);
            };

        } catch (e) {
            console.error('Failed to connect WebSocket:', e);
            setTimeout(() => this.connectWebSocket(), 5000);
        }
    }

    updateSystemStats(stats) {
        console.log('📊 System Stats Update:', stats);
        
        // Update CPU widget
        if (stats.cpu_percent !== undefined) {
            let cpuStatus = 'ok';
            if (stats.cpu_percent > 80) cpuStatus = 'error';
            else if (stats.cpu_percent > 60) cpuStatus = 'busy';
            updateWidget('cpu', cpuStatus, `${stats.cpu_percent}%`);
        }
        
        // Update RAM widget
        if (stats.ram_percent !== undefined) {
            let ramStatus = 'ok';
            if (stats.ram_percent > 85) ramStatus = 'error';
            else if (stats.ram_percent > 70) ramStatus = 'busy';
            updateWidget('ram', ramStatus, `${stats.ram_percent}%`);
        }
        
        // Update connected clients widget
        if (stats.connected_clients !== undefined) {
            let clientStatus = 'idle';
            if (stats.connected_clients > 0) clientStatus = 'ok';
            if (stats.connected_clients > 3) clientStatus = 'busy';
            updateWidget('clients', clientStatus, stats.connected_clients);
        }
    }
    
    // === Robot Control Methods ===
    
    async makeRequest(action, params = {}) {
        try {
            const url = new URL('/api/ds', window.location.origin);
            url.searchParams.set('action', action);
            
            // Add additional parameters
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.set(key, value.toString());
            }
            
            const response = await fetch(url, { method: 'POST' });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log(`✅ API Response for ${action}:`, result);
            
            // Check for success field - handle both true/false and missing
            if (result.success !== undefined && result.success === false) {
                throw new Error(result.error || `${action} command failed: ${JSON.stringify(result)}`);
            }
            
            // If no success field, assume success if no error
            if (!result.success && result.success !== undefined) {
                throw new Error(`${action} command failed: ${JSON.stringify(result)}`);
            }
            
            return result;
            
        } catch (error) {
            console.error(`❌ Request failed (${action}):`, error);
            throw error;
        }
    }
    
    async enableRobot() {
        try {
            const result = await this.makeRequest('enable');
            console.log('🟢 Robot enabled');
            return result;
        } catch (error) {
            console.error('❌ Failed to enable robot', error);
        }
    }
    
    async disableRobot() {
        try {
            const result = await this.makeRequest('disable');
            console.log('🔴 Robot disabled');
            return result;
        } catch (error) {
            console.error('❌ Failed to disable robot', error);
        }
    }
    
    async setMode(mode) {
        try {
            const result = await this.makeRequest(mode);
            console.log(`🎮 Mode set to ${mode}`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to set ${mode} mode`, error);
        }
    }
    
    async emergencyStop() {
        try {
            const result = await this.makeRequest('estop');
            console.log('🛑 Emergency stop activated');
            return result;
        } catch (error) {
            console.error('❌ Failed to activate emergency stop', error);
        }
    }
    
    async setTeamNumber(teamNumber) {
        if (!teamNumber || teamNumber < 1 || teamNumber > 9999) {
            console.error('❌ Invalid team number (must be 1-9999)');
            return;
        }
        
        try {
            const result = await this.makeRequest('set_team', { team: teamNumber });
            console.log(`🔢 Team number set to ${teamNumber}`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to set team number to ${teamNumber}`, error);
        }
    }
    
    async setRobotAddress(address) {
        if (!address || !this.isValidIP(address)) {
            console.error('❌ Invalid IP address format');
            return;
        }
        
        try {
            const result = await this.makeRequest('set_address', { address: address });
            console.log(`🌐 Robot IP set to ${address}`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to set robot IP to ${address}`, error);
        }
    }
    
    // === Utility Methods ===
    
    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Only handle shortcuts if not typing in an input
            if (event.target.tagName === 'INPUT') return;
            
            switch (event.key.toLowerCase()) {
                case 'e':
                    event.preventDefault();
                    this.enableRobot();
                    break;
                case 'd':
                    event.preventDefault();
                    this.disableRobot();
                    break;
                case ' ':
                    event.preventDefault();
                    this.emergencyStop();
                    break;
                case '1':
                    event.preventDefault();
                    this.setMode('teleop');
                    break;
                case '2':
                    event.preventDefault();
                    this.setMode('auto');
                    break;
                case '3':
                    event.preventDefault();
                    this.setMode('test');
                    break;
            }
        });
        
        console.log('⌨️ Keyboard shortcuts: E=Enable, D=Disable, Space=E-Stop, 1=Teleop, 2=Auto, 3=Test');
    }
    
    // === Cleanup ===
    
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.logInterval) {
            clearInterval(this.logInterval);
        }
    }
}

// === Widget Helper Functions ===

function updateWidget(id, status, value, unit = '') {
    const widget = document.getElementById(id);
    if (!widget) return;
    
    const statusElement = widget.querySelector('.widget-status');
    const valueElement = widget.querySelector('.widget-value');
    
    // Update status indicator
    if (statusElement) {
        statusElement.className = `widget-status ${status}`;
    }
    
    // Update value
    if (valueElement) {
        if (unit) {
            valueElement.textContent = `${value}${unit}`;
        } else {
            valueElement.textContent = value;
        }
    }
}

// === Global Variables and Functions ===

let ds;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    ds = new FRCDriverStation();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        // Page became visible, resume fetching
        if (ds) {
            ds.fetchRobotData();
        }
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (ds) {
        ds.destroy();
    }
});

// Control functions called by buttons
function enableRobot() {
    console.log('🔧 Enable button clicked');
    if (ds) {
        ds.enableRobot();
    } else {
        console.error('❌ Driver station not initialized');
        alert('Driver station not ready yet, please wait...');
    }
}

function disableRobot() {
    console.log('🔧 Disable button clicked');
    if (ds) {
        ds.disableRobot();
    } else {
        console.error('❌ Driver station not initialized');
        alert('Driver station not ready yet, please wait...');
    }
}

function setMode(mode) {
    // Update button visual state immediately for instant feedback
    document.querySelectorAll('.btn-mode').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Map mode to button ID
    const modeButtons = {
        'teleop': 'teleop-btn',
        'auto': 'auto-btn', 
        'test': 'test-btn'
    };
    
    const buttonId = modeButtons[mode];
    if (buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.classList.add('active');
        }
    }
    
    // Then send to driver station
    if (ds) ds.setMode(mode);
}

function emergencyStop() {
    if (ds) ds.emergencyStop();
}

function setTeamNumber() {
    const teamInput = document.getElementById('team-input');
    const teamNumber = parseInt(teamInput.value);
    if (ds) ds.setTeamNumber(teamNumber);
}

function setRobotAddress() {
    const addressInput = document.getElementById('address-input');
    const address = addressInput.value.trim();
    if (ds) ds.setRobotAddress(address);
}