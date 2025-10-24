/**
 * Controls - Button handlers and user interaction functions
 */

// Global driver station instance
let ds = null;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    ds = new FRCDriverStation();
    ds.init();
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

// === Control Functions ===

function enableRobot() {
    console.log('Enable button clicked');
    if (ds) {
        ds.enableRobot();
    } else {
        console.error('Driver station not initialized');
        alert('Driver station not ready yet, please wait...');
    }
}

function disableRobot() {
    console.log('Disable button clicked');
    if (ds) {
        ds.disableRobot();
    } else {
        console.error('Driver station not initialized');
        alert('Driver station not ready yet, please wait...');
    }
}

async function setMode(mode) {
    if (!ds) {
        console.error('Driver station not initialized');
        return;
    }
    
    try {
        console.log(`Switching mode to ${mode.toUpperCase()}`);
        
        // SAFETY: Disable robot before mode switch
        console.log('Disabling robot for safe mode switch...');
        
        // Update UI to show disabling
        const enableBtn = document.getElementById('enable-btn');
        const disableBtn = document.getElementById('disable-btn');
        if (enableBtn && disableBtn) {
            enableBtn.style.opacity = '1';
            disableBtn.style.opacity = '0.6';
        }
        
        // Disable the robot first
        await ds.disableRobot();
        
        // Small delay to ensure disable command is processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Now switch the mode
        await ds.setMode(mode);
        
        // Update button visual state
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
        
        // Show notification
        UIManager.showModeChangeNotification(mode);
        
        console.log(`Mode switched to ${mode.toUpperCase()} - Robot DISABLED`);
        console.log('Click ENABLE to activate robot in new mode');
        
    } catch (error) {
        console.error('Error switching mode:', error);
    }
}

function emergencyStop() {
    console.log('Emergency stop button clicked');
    if (ds) {
        ds.emergencyStop();
    }
}

function setTeamNumber() {
    const teamInput = document.getElementById('team-input');
    const teamNumber = parseInt(teamInput.value);
    if (ds) {
        ds.setTeamNumber(teamNumber);
    }
}

function setRobotAddress() {
    const addressInput = document.getElementById('address-input');
    const address = addressInput.value.trim();
    if (ds) {
        ds.setRobotAddress(address);
    }
}
