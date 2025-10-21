/**
 * FRC Driver Station - Core driver station functionality
 */

class FRCDriverStation {
    constructor() {
        this.updateInterval = null;
        this.logInterval = null;
        this.lastUpdateTime = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.ws = null;
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
            UIManager.displayDriverStationStatus(status);
            UIManager.updateConnectionStatus(true);
            this.retryCount = 0;
            
        } catch (error) {
            console.error('❌ Failed to update driver station status:', error);
            UIManager.updateConnectionStatus(false);
            this.retryCount++;
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
            DashboardManager.updateDashboard(data);
            
        } catch (error) {
            console.error('Error fetching robot data:', error);
            
            // Try to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(() => this.fetchRobotData(), 2000);
            }
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
                        UIManager.updateSystemStats(msg.data);
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
        if (this.ws) {
            this.ws.close();
        }
    }
}
