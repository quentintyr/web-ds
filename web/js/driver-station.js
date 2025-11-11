/**
 * FRC Driver Station - Core driver station functionality
 */

class FRCDriverStation {
    async startRobotCode() {
        try {
            const result = await this.makeRequest('start_robot');
            if (result && result.success) {
                console.log('Robot code started successfully');
            } else {
                alert('Failed to start robot: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Failed to start robot', error);
            alert('Error sending start command: ' + error.message);
        }
    }

    async stopRobotCode() {
        try {
            const result = await this.makeRequest('stop_robot');
            if (result && result.success) {
                console.log('Robot code stopped successfully');
            } else {
                alert('Failed to stop robot: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Failed to stop robot', error);
            alert('Error sending stop command: ' + error.message);
        }
    }

    switchLogSource(source) {
        console.log(`Switching log source to: ${source}`);
        
        // Send message to WebSocket server to switch log source
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'switch_log',
                source: source
            }));
            
            // Clear the log container
            const logContainer = document.getElementById('robot-log');
            if (logContainer) {
                logContainer.innerHTML = 'Loading logs...';
            }
        } else {
            console.error('WebSocket not connected');
            alert('Cannot switch logs - WebSocket not connected');
        }
    }

    constructor() {
        this.updateInterval = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.ws = null;
        
        // Joystick manager
        this.joystickManager = null;
    }
    
    init() {
        console.log('Initializing FRC Web Driver Station & Dashboard');
        
        // Initialize joystick manager
        this.initJoystickManager();
        
        // Start status updates
        this.startStatusUpdates();
        
        // Connect to WebSocket for real-time updates
        this.connectWebSocket();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        console.log('Driver Station initialized');
    }
    
    // === Joystick Manager ===
    
    initJoystickManager() {
        this.joystickManager = new JoystickManager();
        
        // Setup joystick update callback to send data via WebSocket
        this.joystickManager.onJoystickUpdate = (data) => {
            this.sendJoystickData(data);
        };
        
        // Setup joystick count change callback
        this.joystickManager.onJoystickCountChanged = (count) => {
            console.log(`Joystick count changed: ${count}`);
            this.updateJoystickUI();
        };
        
        // Create visual UI for joysticks
        if (typeof JoystickUI !== 'undefined') {
            this.joystickUI = new JoystickUI(this.joystickManager);
            this.joystickUI.init();
            console.log('Joystick UI initialized (Press J to toggle)');
        }
        
        console.log('Joystick Manager initialized');
        console.log('   Physical Joysticks: Connect USB controllers');
    }
    
    sendJoystickData(joystickData) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const message = {
                    type: 'joystick_update',
                    joysticks: joystickData
                };
                
                // Debug: Log joystick data being sent
                const activeJoysticks = joystickData.filter(js => 
                    js.axes.some(a => Math.abs(a) > 0.1) || 
                    js.buttons.some(b => b)
                );
                if (activeJoysticks.length > 0) {
                    console.log(`Sending joystick data: ${joystickData.length} joysticks, ${activeJoysticks.length} active`);
                    activeJoysticks.forEach((js, i) => {
                        const pressedButtons = js.buttons.map((b, idx) => b ? idx : -1).filter(idx => idx >= 0);
                        if (pressedButtons.length > 0 || js.axes.some(a => Math.abs(a) > 0.1)) {
                            console.log(`   JS${i}: Buttons [${pressedButtons.join(',')}], Axes [${js.axes.map(a => a.toFixed(2)).join(',')}]`);
                        }
                    });
                }
                
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Failed to send joystick data:', error);
            }
        } else {
            console.warn('Cannot send joystick data - WebSocket not connected');
        }
    }
    
    updateJoystickUI() {
        // Update joystick status display if you have one
        // For now, just log the change
        if (this.joystickManager) {
            const count = this.joystickManager.getJoystickCount();
            console.log(`Active joysticks: ${count}`);
        }
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
            UIManager.displayDriverStationStatus(status);
            // Show disconnected if robot is not online or code has crashed
            const isConnected = !!(status.connected && status.code_present);
            UIManager.updateConnectionStatus(isConnected);
            this.retryCount = 0;
            
            // SAFETY: Sync joystick manager with robot enabled state
            if (this.joystickManager) {
                this.joystickManager.setRobotEnabled(status.enabled || status.robot_enabled || false);
            }
            
        } catch (error) {
            console.error('Failed to update driver station status:', error);
            UIManager.updateConnectionStatus(false);
            this.retryCount++;
            
            // SAFETY: Disable joysticks if we lost connection
            if (this.joystickManager) {
                this.joystickManager.setRobotEnabled(false);
            }
        }
    }
    
    // === Robot Data Updates ===
    // (Removed: dashboard polling via status.json; now handled by WebSocket)
    
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
                console.log('WebSocket connected for system monitoring');
            };

            this.ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.type === 'system_stats' && msg.data) {
                        UIManager.updateSystemStats(msg.data);
                    } else if (msg.type === 'log' && msg.line) {
                        // Append single log line (real-time)
                        try {
                            const logContainer = document.getElementById('robot-log');
                            if (logContainer) {
                                const html = this.convertAnsiToHtml(String(msg.line) + '\n');
                                // Append and keep auto-scroll behaviour
                                const atBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 5;
                                logContainer.insertAdjacentHTML('beforeend', html);
                                if (atBottom) logContainer.scrollTop = logContainer.scrollHeight;
                            }
                        } catch (e) { console.error('Error appending log line:', e); }
                    } else if (msg.type === 'log_init' && msg.data) {
                        // Full history initialization via WebSocket
                        try {
                            const logContainer = document.getElementById('robot-log');
                            if (logContainer) {
                                const html = this.convertAnsiToHtml(msg.data.join('\n'));
                                logContainer.innerHTML = html;
                                logContainer.scrollTop = logContainer.scrollHeight;
                            }
                        } catch (e) { console.error('Error initializing logs:', e); }
                    } else if (msg.type === 'dashboard' && msg.data) {
                        // Real-time dashboard update
                        DashboardManager.updateDashboard(msg.data);
                    }
                } catch (e) {
                    console.error('WebSocket message error:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected, attempting to reconnect...');
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
            console.log(`API Response for ${action}:`, result);
            
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
            console.error(`Request failed (${action}):`, error);
            throw error;
        }
    }
    
    async enableRobot() {
        try {
            const result = await this.makeRequest('enable');
            console.log('Robot enabled');
            return result;
        } catch (error) {
            console.error('Failed to enable robot', error);
        }
    }
    
    async disableRobot() {
        try {
            const result = await this.makeRequest('disable');
            console.log('Robot disabled');
            return result;
        } catch (error) {
            console.error('Failed to disable robot', error);
        }
    }
    
    async setMode(mode) {
        try {
            const result = await this.makeRequest(mode);
            console.log(`Mode set to ${mode}`);
            return result;
        } catch (error) {
            console.error(`Failed to set ${mode} mode`, error);
        }
    }
    
    async emergencyStop() {
        try {
            const result = await this.makeRequest('estop');
            console.log('Emergency stop activated');
            return result;
        } catch (error) {
            console.error('Failed to activate emergency stop', error);
        }
    }
    
    async setTeamNumber(teamNumber) {
        if (!teamNumber || teamNumber < 1 || teamNumber > 9999) {
            console.error('Invalid team number (must be 1-9999)');
            return;
        }
        
        try {
            const result = await this.makeRequest('set_team', { team: teamNumber });
            console.log(`Team number set to ${teamNumber}`);
            return result;
        } catch (error) {
            console.error(`Failed to set team number to ${teamNumber}`, error);
        }
    }
    
    async setRobotAddress(address) {
        if (!address || !this.isValidIP(address)) {
            console.error('Invalid IP address format');
            return;
        }
        
        try {
            const result = await this.makeRequest('set_address', { address: address });
            console.log(`Robot IP set to ${address}`);
            return result;
        } catch (error) {
            console.error(`Failed to set robot IP to ${address}`, error);
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
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
            
            switch (event.key.toLowerCase()) {
                case 'e':
                    event.preventDefault();
                    enableRobot();  // Use global function
                    break;
                case 'd':
                    event.preventDefault();
                    disableRobot();  // Use global function
                    break;
                case ' ':
                    event.preventDefault();
                    emergencyStop();  // Use global function
                    break;
                case '1':
                    event.preventDefault();
                    setMode('teleop');  // Use global function with safety
                    break;
                case '2':
                    event.preventDefault();
                    setMode('auto');  // Use global function with safety
                    break;
                case '3':
                    event.preventDefault();
                    setMode('test');  // Use global function with safety
                    break;
                case 'j':
                    event.preventDefault();
                    if (this.joystickUI) {
                        this.joystickUI.toggle();
                    }
                    break;
                case 't':
                    event.preventDefault();
                    if (this.joystickManager) {
                        this.testJoysticks();
                    }
                    break;
            }
        });
        
        console.log('Keyboard shortcuts:');
        console.log('   E=Enable, D=Disable, Space=E-Stop');
        console.log('   1=Teleop, 2=Auto, 3=Test');
        console.log('   J=Toggle Joystick UI, T=Test Joysticks');
    }
    
    // === Joystick Testing ===
    
    testJoysticks() {
        if (this.joystickManager) {
            console.log('=== JOYSTICK TEST ===');
            this.joystickManager.printDebugInfo();
            
            const packet = this.joystickManager.encodeJoystickPacket();
            console.log(`Encoded packet (${packet.length} bytes):`, 
                       Array.from(packet).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
        }
    }
    
    // === Cleanup ===
    
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        // No log polling interval to clear
        if (this.ws) {
            this.ws.close();
        }
        if (this.joystickManager) {
            this.joystickManager.destroy();
        }
    }
}
