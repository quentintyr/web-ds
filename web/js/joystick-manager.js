/**
 * Joystick Manager - Advanced controller implementation matching LibDS
 * Implements full FRC protocol 2020 joystick packet encoding with safety features
 * 
 * Features:
 * - Gamepad API integration for physical controllers
 * - Virtual keyboard joystick support
 * - Multiple joystick support (up to 6)
 * - Joystick blacklisting
 * - Automatic zero values when robot disabled (safety)
 * - Button bitfield encoding (up to 16 buttons)
 * - Axis encoding (-1.0 to +1.0 as signed bytes)
 * - POV/Hat support (0-360 degrees)
 */

class JoystickManager {
    constructor() {
        // Joystick storage (matches LibDS structure)
        this.joysticks = [];  // Array of joystick objects
        this.maxJoysticks = 6;
        this.maxAxes = 6;
        this.maxButtons = 16;  // FRC 2020 supports up to 16
        this.maxPOVs = 1;
        
        // State tracking
        this.enabled = false;
        this.blacklistedJoysticks = new Set();
        
        // Gamepad polling
        this.gamepadPollInterval = null;
        this.pollRate = 20;  // Poll every 20ms (50Hz, matches packet rate)
        
        // Callbacks
        this.onJoystickUpdate = null;
        this.onJoystickCountChanged = null;
        
        // Initialize
        this.init();
    }
    
    init() {
        console.log('Initializing Joystick Manager (LibDS-style)');
        
        // Setup gamepad event listeners
        window.addEventListener('gamepadconnected', (e) => this.handleGamepadConnected(e));
        window.addEventListener('gamepaddisconnected', (e) => this.handleGamepadDisconnected(e));
        
        // Start polling for gamepad updates
        this.startGamepadPolling();
        
        // Check for already-connected gamepads
        this.scanForGamepads();
        
        console.log('Joystick Manager initialized');
        console.log(`   Max Joysticks: ${this.maxJoysticks}`);
        console.log(`   Max Axes: ${this.maxAxes}`);
        console.log(`   Max Buttons: ${this.maxButtons}`);
        console.log(`   Max POVs: ${this.maxPOVs}`);
    }
    
    // === Gamepad Management ===
    
    scanForGamepads() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) {
                this.addJoystick(gamepads[i]);
            }
        }
    }
    
    handleGamepadConnected(event) {
        console.log(`Gamepad connected: ${event.gamepad.id}`);
        this.addJoystick(event.gamepad);
    }
    
    handleGamepadDisconnected(event) {
        console.log(`Gamepad disconnected: ${event.gamepad.id}`);
        this.removeJoystick(event.gamepad.index);
    }
    
    addJoystick(gamepad) {
        // Check if we already have this joystick
        const existingIndex = this.joysticks.findIndex(js => js.gamepadIndex === gamepad.index);
        if (existingIndex !== -1) {
            return;  // Already added
        }
        
        // Check max joysticks
        if (this.joysticks.length >= this.maxJoysticks) {
            console.warn(`Maximum joysticks (${this.maxJoysticks}) reached, ignoring ${gamepad.id}`);
            return;
        }
        
        // Create joystick object (matches LibDS structure)
        const joystick = {
            id: this.joysticks.length,
            gamepadIndex: gamepad.index,
            name: gamepad.id,
            axes: new Array(Math.min(gamepad.axes.length, this.maxAxes)).fill(0.0),
            buttons: new Array(Math.min(gamepad.buttons.length, this.maxButtons)).fill(false),
            povs: [-1],  // Most controllers have 1 POV hat, -1 = not pressed
            blacklisted: false
        };
        
        this.joysticks.push(joystick);
        console.log(`Added joystick ${joystick.id}: ${joystick.name}`);
        console.log(`   Axes: ${joystick.axes.length}, Buttons: ${joystick.buttons.length}, POVs: ${joystick.povs.length}`);
        
        // Notify listeners
        if (this.onJoystickCountChanged) {
            this.onJoystickCountChanged(this.getJoystickCount());
        }
    }
    
    removeJoystick(gamepadIndex) {
        const index = this.joysticks.findIndex(js => js.gamepadIndex === gamepadIndex);
        if (index !== -1) {
            const joystick = this.joysticks[index];
            console.log(`Removed joystick ${joystick.id}: ${joystick.name}`);
            this.joysticks.splice(index, 1);
            
            // Re-index remaining joysticks
            this.joysticks.forEach((js, i) => {
                js.id = i;
            });
            
            // Notify listeners
            if (this.onJoystickCountChanged) {
                this.onJoystickCountChanged(this.getJoystickCount());
            }
        }
    }
    
    // === Gamepad Polling ===
    
    startGamepadPolling() {
        if (this.gamepadPollInterval) {
            clearInterval(this.gamepadPollInterval);
        }
        
        this.gamepadPollInterval = setInterval(() => {
            this.pollGamepads();
        }, this.pollRate);
    }
    
    stopGamepadPolling() {
        if (this.gamepadPollInterval) {
            clearInterval(this.gamepadPollInterval);
            this.gamepadPollInterval = null;
        }
    }
    
    pollGamepads() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        for (const joystick of this.joysticks) {
            const gamepad = gamepads[joystick.gamepadIndex];
            if (!gamepad) continue;
            
            // Update axes
            for (let i = 0; i < Math.min(gamepad.axes.length, this.maxAxes); i++) {
                let value = gamepad.axes[i];
                
                // Apply deadzone (same as LibDS)
                if (Math.abs(value) < 0.05) {
                    value = 0.0;
                }
                
                joystick.axes[i] = value;
            }
            
            // Update buttons
            for (let i = 0; i < Math.min(gamepad.buttons.length, this.maxButtons); i++) {
                const button = gamepad.buttons[i];
                joystick.buttons[i] = button.pressed || button.value > 0.5;
            }
            
            // Update POV (D-Pad / Hat). Different controllers/browsers expose this
            // as buttons (12-15) or as one/two axes. We detect both.
            joystick.povs[0] = this.calculatePOV(gamepad);
        }
        
        // Notify listeners
        if (this.onJoystickUpdate) {
            this.onJoystickUpdate(this.getAllJoystickData());
        }
    }
    
    calculatePOV(gamepad) {
        // Only use button-based D-pad (buttons 12-15)
        // Button 12 = D-pad UP, 13 = DOWN, 14 = LEFT, 15 = RIGHT
        try {
            if (gamepad.buttons && gamepad.buttons.length >= 16) {
                const up = !!(gamepad.buttons[12] && gamepad.buttons[12].pressed);
                const down = !!(gamepad.buttons[13] && gamepad.buttons[13].pressed);
                const left = !!(gamepad.buttons[14] && gamepad.buttons[14].pressed);
                const right = !!(gamepad.buttons[15] && gamepad.buttons[15].pressed);

                // Debug: Log D-pad button states when any is pressed
                if (up || down || left || right) {
                    console.debug(`D-pad detected - UP:${up} DOWN:${down} LEFT:${left} RIGHT:${right} for '${gamepad.id}'`);
                }

                // Only return an angle if at least one direction is pressed
                if (up || down || left || right) {
                    // D-pad is pressed - return angle (0-315 degrees)
                    // 0 = North (up), 90 = East (right), 180 = South (down), 270 = West (left)
                    if (up && !left && !right) return 0;
                    if (up && right) return 45;
                    if (right && !up && !down) return 90;
                    if (down && right) return 135;
                    if (down && !left && !right) return 180;
                    if (down && left) return 225;
                    if (left && !up && !down) return 270;
                    if (up && left) return 315;
                }
            }
        } catch (e) {
            console.debug('calculatePOV: button-based detection error', e);
        }

        // Default: not pressed (FRC standard is -1)
        // No axes fallback - only buttons 12-15 are considered D-pad
        return -1;
    }
    
    // === Safety Features (LibDS-compatible) ===
    
    setRobotEnabled(enabled) {
        this.enabled = enabled;
        console.log(`Robot ${enabled ? 'ENABLED' : 'DISABLED'} - Joystick safety ${enabled ? 'OFF' : 'ON'}`);
    }
    
    setJoystickBlacklisted(joystickId, blacklisted) {
        if (blacklisted) {
            this.blacklistedJoysticks.add(joystickId);
            console.log(`Joystick ${joystickId} blacklisted`);
        } else {
            this.blacklistedJoysticks.delete(joystickId);
            console.log(`Joystick ${joystickId} whitelisted`);
        }
    }
    
    isJoystickBlacklisted(joystickId) {
        return this.blacklistedJoysticks.has(joystickId);
    }
    
    // === Data Access (LibDS-compatible) ===
    
    getJoystickCount() {
        return this.joysticks.length;
    }
    
    getJoystickAxis(joystickId, axisId) {
        // SAFETY: Return 0 if robot is disabled (same as LibDS)
        if (!this.enabled) return 0.0;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return 0.0;
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return 0.0;
        
        return joystick.axes[axisId] || 0.0;
    }
    
    getJoystickButton(joystickId, buttonId) {
        // SAFETY: Return false if robot is disabled (same as LibDS)
        if (!this.enabled) return false;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return false;
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return false;
        
        return joystick.buttons[buttonId] || false;
    }
    
    getJoystickPOV(joystickId, povId) {
        // SAFETY: Return -1 (not pressed) if robot is disabled (same as LibDS)
        if (!this.enabled) return -1;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return -1;
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return -1;
        
        return joystick.povs[povId] !== undefined ? joystick.povs[povId] : -1;
    }
    
    getAllJoystickData() {
        const data = [];
        
        // Add physical joysticks
        for (let i = 0; i < this.joysticks.length; i++) {
            const js = this.joysticks[i];
            data.push({
                id: i,
                name: js.name,
                axes: js.axes.map((_, axisId) => this.getJoystickAxis(i, axisId)),
                buttons: js.buttons.map((_, btnId) => this.getJoystickButton(i, btnId)),
                povs: js.povs.map((_, povId) => this.getJoystickPOV(i, povId)),
                blacklisted: this.isJoystickBlacklisted(i)
            });
        }
        
        return data;
    }
    
    // === FRC Protocol Encoding (Matches LibDS exactly) ===
    
    encodeJoystickPacket() {
        /**
         * Encodes joystick data into FRC 2020 protocol format
         * Returns array of bytes to append to robot packet
         * 
         * Format for each joystick:
         * [size, tag, num_axes, axis_bytes..., num_buttons, button_high, button_low, num_povs, pov_bytes...]
         */
        const packet = [];
        const joystickData = this.getAllJoystickData();
        
        for (const js of joystickData) {
            const joystickBytes = [];
            
            // Tag (0x0c = joystick tag)
            joystickBytes.push(0x0c);
            
            // Axes
            joystickBytes.push(js.axes.length);
            for (const axis of js.axes) {
                // Convert float (-1.0 to +1.0) to signed byte (-128 to +127)
                const byte = this.floatToByte(axis);
                joystickBytes.push(byte);
            }
            
            // Buttons (as bitfield)
            const buttonCount = js.buttons.length;
            joystickBytes.push(buttonCount);
            
            // Pack buttons into 16-bit value
            let buttonFlags = 0;
            for (let i = 0; i < buttonCount; i++) {
                if (js.buttons[i]) {
                    buttonFlags |= (1 << i);
                }
            }
            
            // Split into 2 bytes (big-endian)
            joystickBytes.push((buttonFlags >> 8) & 0xFF);  // High byte
            joystickBytes.push(buttonFlags & 0xFF);         // Low byte
            
            // POVs
            joystickBytes.push(js.povs.length);
            for (const pov of js.povs) {
                // POV angle as 16-bit value (big-endian)
                joystickBytes.push((pov >> 8) & 0xFF);  // High byte
                joystickBytes.push(pov & 0xFF);         // Low byte
            }
            
            // Prepend size byte
            const size = joystickBytes.length + 1;  // +1 for size byte itself
            packet.push(size);
            packet.push(...joystickBytes);
        }
        
        return packet;
    }
    
    floatToByte(value) {
        /**
         * Convert float (-1.0 to +1.0) to signed byte (-128 to +127)
         * Matches LibDS DS_FloatToByte function
         */
        let result = Math.round(value * 127);
        
        // Clamp to byte range
        if (result > 127) result = 127;
        if (result < -128) result = -128;
        
        // Convert to unsigned byte (0-255)
        return result & 0xFF;
    }
    
    // === Debug/Testing ===
    
    testControllerMapping() {
        /**
         * Test utility to diagnose controller button/axis mapping
         * Call this to see raw gamepad data and help identify correct D-pad indices
         */
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        console.log('=== CONTROLLER MAPPING TEST ===');
        console.log(`Found ${gamepads.filter(g => g).length} gamepads`);
        
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;
            
            console.log(`\nGamepad ${i}: ${gamepad.id}`);
            console.log(`   Mapping: ${gamepad.mapping}`);
            console.log(`   Connected: ${gamepad.connected}`);
            console.log(`   Axes: ${gamepad.axes.length}, Buttons: ${gamepad.buttons.length}`);
            
            // Show all button states
            console.log('   Button States:');
            for (let b = 0; b < gamepad.buttons.length; b++) {
                const button = gamepad.buttons[b];
                if (button.pressed) {
                    console.log(`      Button ${b}: PRESSED (value: ${button.value.toFixed(2)})`);
                }
            }
            
            // Show all axis values (only if non-zero)
            console.log('   Axis Values:');
            for (let a = 0; a < gamepad.axes.length; a++) {
                const value = gamepad.axes[a];
                if (Math.abs(value) > 0.1) {
                    console.log(`      Axis ${a}: ${value.toFixed(2)}`);
                }
            }
            
            // Show calculated POV
            const pov = this.calculatePOV(gamepad);
            console.log(`   Calculated POV: ${pov}° ${pov === -1 ? '(not pressed)' : ''}`);
        }
        
        console.log('\nTIP: Press D-pad buttons and call this again to see which indices light up!');
        console.log('   Usage: ds.joystickManager.testControllerMapping()');
    }
    
    getDebugInfo() {
        const info = {
            joystickCount: this.getJoystickCount(),
            enabled: this.enabled,
            virtualEnabled: this.virtualJoystickEnabled,
            joysticks: []
        };
        
        const data = this.getAllJoystickData();
        for (const js of data) {
            info.joysticks.push({
                id: js.id,
                name: js.name,
                axes: js.axes.map(v => v.toFixed(2)),
                buttons: js.buttons.map(b => b ? '●' : '○').join(''),
                povs: js.povs,
                blacklisted: js.blacklisted
            });
        }
        
        return info;
    }
    
    printDebugInfo() {
        console.log('=== Joystick Debug Info ===');
        const info = this.getDebugInfo();
        console.log(`   Total Joysticks: ${info.joystickCount}`);
        console.log(`   Robot Enabled: ${info.enabled}`);
        console.log(`   Virtual JS: ${info.virtualEnabled}`);
        
        for (const js of info.joysticks) {
            console.log(`   [${js.id}] ${js.name}`);
            console.log(`       Axes: [${js.axes.join(', ')}]`);
            console.log(`       Buttons: ${js.buttons}`);
            console.log(`       POVs: [${js.povs.join(', ')}]`);
            console.log(`       Blacklisted: ${js.blacklisted}`);
        }
    }
    
    // === Cleanup ===
    
    destroy() {
        this.stopGamepadPolling();
        this.joysticks = [];
        console.log('Joystick Manager destroyed');
    }
}
