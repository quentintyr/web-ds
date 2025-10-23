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
        this.virtualJoystickEnabled = false;
        this.blacklistedJoysticks = new Set();
        
        // Virtual joystick state
        this.virtualJoystick = {
            axes: new Array(4).fill(0.0),    // 4 axes (LX, LY, RX, RY)
            buttons: new Array(10).fill(false),  // 10 buttons (0-9 keys)
            povs: [0],  // 1 POV (arrow keys)
            name: 'Virtual Keyboard Joystick'
        };
        
        // Keyboard state for virtual joystick
        this.keysPressed = new Set();
        
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
        console.log('🎮 Initializing Joystick Manager (LibDS-style)');
        
        // Setup gamepad event listeners
        window.addEventListener('gamepadconnected', (e) => this.handleGamepadConnected(e));
        window.addEventListener('gamepaddisconnected', (e) => this.handleGamepadDisconnected(e));
        
        // Setup keyboard for virtual joystick
        this.setupVirtualJoystick();
        
        // Start polling for gamepad updates
        this.startGamepadPolling();
        
        // Check for already-connected gamepads
        this.scanForGamepads();
        
        console.log('✅ Joystick Manager initialized');
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
        console.log(`🎮 Gamepad connected: ${event.gamepad.id}`);
        this.addJoystick(event.gamepad);
    }
    
    handleGamepadDisconnected(event) {
        console.log(`🎮 Gamepad disconnected: ${event.gamepad.id}`);
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
            console.warn(`⚠️ Maximum joysticks (${this.maxJoysticks}) reached, ignoring ${gamepad.id}`);
            return;
        }
        
        // Create joystick object (matches LibDS structure)
        const joystick = {
            id: this.joysticks.length,
            gamepadIndex: gamepad.index,
            name: gamepad.id,
            axes: new Array(Math.min(gamepad.axes.length, this.maxAxes)).fill(0.0),
            buttons: new Array(Math.min(gamepad.buttons.length, this.maxButtons)).fill(false),
            povs: [0],  // Most controllers have 1 POV hat
            blacklisted: false
        };
        
        this.joysticks.push(joystick);
        console.log(`✅ Added joystick ${joystick.id}: ${joystick.name}`);
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
            console.log(`❌ Removed joystick ${joystick.id}: ${joystick.name}`);
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
            
            // Update POV from gamepad axes (usually axes 9 and 10 on Xbox controller)
            // Many gamepads map D-pad to buttons, not POV
            // We'll use button mapping for now
            joystick.povs[0] = this.calculatePOVFromButtons(gamepad);
        }
        
        // Notify listeners
        if (this.onJoystickUpdate) {
            this.onJoystickUpdate(this.getAllJoystickData());
        }
    }
    
    calculatePOVFromButtons(gamepad) {
        // D-pad buttons are typically 12, 13, 14, 15 (Up, Down, Left, Right)
        if (gamepad.buttons.length < 16) return 0;
        
        const up = gamepad.buttons[12]?.pressed || false;
        const down = gamepad.buttons[13]?.pressed || false;
        const left = gamepad.buttons[14]?.pressed || false;
        const right = gamepad.buttons[15]?.pressed || false;
        
        // Calculate angle (FRC standard)
        if (up && !left && !right) return 0;
        if (up && right) return 45;
        if (right && !up && !down) return 90;
        if (down && right) return 135;
        if (down && !left && !right) return 180;
        if (down && left) return 225;
        if (left && !up && !down) return 270;
        if (up && left) return 315;
        
        return 0;  // Centered
    }
    
    // === Virtual Joystick (Keyboard) ===
    
    setupVirtualJoystick() {
        // Keyboard mappings (matches QJoysticks):
        // W,A,S,D - Left Stick
        // I,J,K,L - Right Stick
        // Arrow Keys - POV hat
        // Q,E - Left/Right Trigger
        // 0-9 - Buttons
        
        document.addEventListener('keydown', (e) => this.handleVirtualKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleVirtualKeyUp(e));
    }
    
    handleVirtualKeyDown(event) {
        if (!this.virtualJoystickEnabled) return;
        
        // Don't capture if typing in input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
        
        const key = event.key.toLowerCase();
        this.keysPressed.add(key);
        
        // Update virtual joystick state
        this.updateVirtualJoystick();
        
        // Prevent default for game keys
        if ('wasdijklqe0123456789'.includes(key) || event.key.startsWith('Arrow')) {
            event.preventDefault();
        }
    }
    
    handleVirtualKeyUp(event) {
        if (!this.virtualJoystickEnabled) return;
        
        const key = event.key.toLowerCase();
        this.keysPressed.delete(key);
        
        // Update virtual joystick state
        this.updateVirtualJoystick();
    }
    
    updateVirtualJoystick() {
        // Left stick (WASD)
        let leftX = 0.0, leftY = 0.0;
        if (this.keysPressed.has('a')) leftX -= 1.0;
        if (this.keysPressed.has('d')) leftX += 1.0;
        if (this.keysPressed.has('w')) leftY -= 1.0;  // Y axis inverted
        if (this.keysPressed.has('s')) leftY += 1.0;
        
        // Right stick (IJKL)
        let rightX = 0.0, rightY = 0.0;
        if (this.keysPressed.has('j')) rightX -= 1.0;
        if (this.keysPressed.has('l')) rightX += 1.0;
        if (this.keysPressed.has('i')) rightY -= 1.0;  // Y axis inverted
        if (this.keysPressed.has('k')) rightY += 1.0;
        
        // Triggers (Q, E)
        let leftTrigger = this.keysPressed.has('q') ? 1.0 : 0.0;
        let rightTrigger = this.keysPressed.has('e') ? 1.0 : 0.0;
        
        // Update axes
        this.virtualJoystick.axes[0] = leftX;
        this.virtualJoystick.axes[1] = leftY;
        this.virtualJoystick.axes[2] = rightX;
        this.virtualJoystick.axes[3] = rightY;
        
        // Buttons (0-9 keys)
        for (let i = 0; i < 10; i++) {
            this.virtualJoystick.buttons[i] = this.keysPressed.has(i.toString());
        }
        
        // POV (Arrow keys)
        let povAngle = 0;
        const up = this.keysPressed.has('arrowup');
        const down = this.keysPressed.has('arrowdown');
        const left = this.keysPressed.has('arrowleft');
        const right = this.keysPressed.has('arrowright');
        
        if (up && !left && !right) povAngle = 0;
        else if (up && right) povAngle = 45;
        else if (right && !up && !down) povAngle = 90;
        else if (down && right) povAngle = 135;
        else if (down && !left && !right) povAngle = 180;
        else if (down && left) povAngle = 225;
        else if (left && !up && !down) povAngle = 270;
        else if (up && left) povAngle = 315;
        
        this.virtualJoystick.povs[0] = povAngle;
    }
    
    setVirtualJoystickEnabled(enabled) {
        this.virtualJoystickEnabled = enabled;
        console.log(`🎹 Virtual joystick ${enabled ? 'enabled' : 'disabled'}`);
        
        if (this.onJoystickCountChanged) {
            this.onJoystickCountChanged(this.getJoystickCount());
        }
    }
    
    // === Safety Features (LibDS-compatible) ===
    
    setRobotEnabled(enabled) {
        this.enabled = enabled;
        console.log(`🤖 Robot ${enabled ? 'ENABLED' : 'DISABLED'} - Joystick safety ${enabled ? 'OFF' : 'ON'}`);
    }
    
    setJoystickBlacklisted(joystickId, blacklisted) {
        if (blacklisted) {
            this.blacklistedJoysticks.add(joystickId);
            console.log(`⛔ Joystick ${joystickId} blacklisted`);
        } else {
            this.blacklistedJoysticks.delete(joystickId);
            console.log(`✅ Joystick ${joystickId} whitelisted`);
        }
    }
    
    isJoystickBlacklisted(joystickId) {
        return this.blacklistedJoysticks.has(joystickId);
    }
    
    // === Data Access (LibDS-compatible) ===
    
    getJoystickCount() {
        let count = this.joysticks.length;
        if (this.virtualJoystickEnabled) {
            count++;
        }
        return count;
    }
    
    getJoystickAxis(joystickId, axisId) {
        // SAFETY: Return 0 if robot is disabled (same as LibDS)
        if (!this.enabled) return 0.0;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return 0.0;
        
        // Virtual joystick is always last
        if (this.virtualJoystickEnabled && joystickId === this.joysticks.length) {
            return this.virtualJoystick.axes[axisId] || 0.0;
        }
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return 0.0;
        
        return joystick.axes[axisId] || 0.0;
    }
    
    getJoystickButton(joystickId, buttonId) {
        // SAFETY: Return false if robot is disabled (same as LibDS)
        if (!this.enabled) return false;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return false;
        
        // Virtual joystick is always last
        if (this.virtualJoystickEnabled && joystickId === this.joysticks.length) {
            return this.virtualJoystick.buttons[buttonId] || false;
        }
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return false;
        
        return joystick.buttons[buttonId] || false;
    }
    
    getJoystickPOV(joystickId, povId) {
        // SAFETY: Return 0 if robot is disabled (same as LibDS)
        if (!this.enabled) return 0;
        
        // Check blacklist
        if (this.isJoystickBlacklisted(joystickId)) return 0;
        
        // Virtual joystick is always last
        if (this.virtualJoystickEnabled && joystickId === this.joysticks.length) {
            return this.virtualJoystick.povs[povId] || 0;
        }
        
        const joystick = this.joysticks[joystickId];
        if (!joystick) return 0;
        
        return joystick.povs[povId] || 0;
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
        
        // Add virtual joystick (always last)
        if (this.virtualJoystickEnabled) {
            const id = this.joysticks.length;
            data.push({
                id: id,
                name: this.virtualJoystick.name,
                axes: this.virtualJoystick.axes.map((_, axisId) => this.getJoystickAxis(id, axisId)),
                buttons: this.virtualJoystick.buttons.map((_, btnId) => this.getJoystickButton(id, btnId)),
                povs: this.virtualJoystick.povs.map((_, povId) => this.getJoystickPOV(id, povId)),
                blacklisted: this.isJoystickBlacklisted(id)
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
        console.log('🎮 === Joystick Debug Info ===');
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
        this.keysPressed.clear();
        console.log('🎮 Joystick Manager destroyed');
    }
}
