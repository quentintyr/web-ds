/**
 * Dashboard Manager - Handles robot telemetry and dashboard widgets
 */

class DashboardManager {
    static updateDashboard(data) {
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
}

// === Widget Helper Function ===

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
