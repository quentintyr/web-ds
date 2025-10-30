/**
 * UI Manager - Handles all UI updates and visual feedback
 */

let isConnected = false;

class UIManager {
    static displayDriverStationStatus(status) {
        // Debug: Log the received mode value
        console.log('Received robot status:', {
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
        console.log('Robot Status:', {
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
    
    static updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const statusText = document.getElementById('connection-status');
        
        isConnected = connected;
        
        if (connected) {
            indicator.className = 'connection-indicator connected';
            statusText.textContent = 'Connected';
        } else {
            indicator.className = 'connection-indicator disconnected';
            statusText.textContent = 'Disconnected';
        }
    }
    
    static updateModeButtons(currentMode) {
        console.log('Updating mode buttons for:', currentMode);
        
        // Remove active class from all mode buttons first
        const teleopBtn = document.getElementById('teleop-btn');
        const autoBtn = document.getElementById('auto-btn');
        const testBtn = document.getElementById('test-btn');
        
        if (teleopBtn) teleopBtn.classList.remove('active');
        if (autoBtn) autoBtn.classList.remove('active');
        if (testBtn) testBtn.classList.remove('active');
        
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
                console.log(`Mode button activated: ${activeButtonId} (mode: ${currentMode})`);
            } else {
                console.warn(`Button not found: ${activeButtonId}`);
            }
        } else {
            console.warn(`Unknown mode value: ${currentMode} (type: ${typeof currentMode})`);
        }
    }
    
    static updateControlButtons(status) {
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

    static updateSystemStats(stats) {
        console.log('System Stats Update:', stats);
        
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

    static showModeChangeNotification(mode) {
        // Create a temporary notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #ff6b35;
            color: white;
            padding: 20px 40px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: fadeInOut 2s ease-in-out;
        `;
        notification.textContent = `Mode: ${mode.toUpperCase()} - Robot DISABLED`;
        document.body.appendChild(notification);
        
        // Remove after 2 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 1700);
    }
}
