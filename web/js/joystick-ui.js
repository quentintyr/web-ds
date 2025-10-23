/**
 * Joystick UI Manager - Visual feedback for controllers
 * Displays joystick status, axes, buttons, and POVs in real-time
 */

class JoystickUI {
    constructor(joystickManager) {
        this.joystickManager = joystickManager;
        this.container = null;
        this.updateInterval = null;
    }
    
    init(containerId = 'joystick-panel') {
        // Create or find container
        this.container = document.getElementById(containerId);
        if (!this.container) {
            this.container = this.createContainer();
            document.body.appendChild(this.container);
        }
        
        // Start updating UI
        this.startUpdating();
        
        console.log('✅ Joystick UI initialized');
    }
    
    createContainer() {
        const container = document.createElement('div');
        container.id = 'joystick-panel';
        container.className = 'joystick-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(20, 20, 30, 0.95);
            border: 2px solid #00ff88;
            border-radius: 10px;
            padding: 15px;
            min-width: 300px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #00ff88;
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
        `;
        
        // Add header
        const header = document.createElement('div');
        header.style.cssText = `
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 1px solid #00ff88;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const title = document.createElement('span');
        title.textContent = '🎮 JOYSTICKS';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #00ff88;
            font-size: 16px;
            cursor: pointer;
            padding: 0 5px;
        `;
        closeBtn.onclick = () => this.hide();
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);
        
        // Add content area
        const content = document.createElement('div');
        content.id = 'joystick-content';
        container.appendChild(content);
        
        return container;
    }
    
    startUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        // Update UI every 50ms (20 FPS)
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 50);
    }
    
    stopUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    updateDisplay() {
        if (!this.container || !this.joystickManager) return;
        
        const content = this.container.querySelector('#joystick-content');
        if (!content) return;
        
        const data = this.joystickManager.getAllJoystickData();
        
        if (data.length === 0) {
            content.innerHTML = '<div style="color: #ff6b35;">No joysticks connected</div>';
            return;
        }
        
        let html = '';
        
        for (const js of data) {
            const statusColor = js.blacklisted ? '#ff6b35' : '#00ff88';
            const statusText = js.blacklisted ? 'BLACKLISTED' : 'ACTIVE';
            
            html += `
                <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 255, 136, 0.05); border-radius: 5px;">
                    <div style="font-weight: bold; margin-bottom: 5px;">
                        [${js.id}] ${this.truncateName(js.name)}
                        <span style="color: ${statusColor}; font-size: 10px;">${statusText}</span>
                    </div>
                    
                    ${this.renderAxes(js.axes)}
                    ${this.renderButtons(js.buttons)}
                    ${this.renderPOVs(js.povs)}
                </div>
            `;
        }
        
        content.innerHTML = html;
    }
    
    renderAxes(axes) {
        if (axes.length === 0) return '';
        
        let html = '<div style="margin: 5px 0;">Axes:</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; margin-left: 10px;">';
        
        for (let i = 0; i < axes.length; i++) {
            const value = axes[i];
            const percentage = ((value + 1) / 2 * 100).toFixed(0);
            const barColor = Math.abs(value) > 0.1 ? '#00ff88' : '#444';
            
            html += `
                <div style="font-size: 10px;">
                    <div>A${i}: ${value.toFixed(2)}</div>
                    <div style="width: 100%; height: 4px; background: #222; border-radius: 2px;">
                        <div style="width: ${percentage}%; height: 100%; background: ${barColor}; border-radius: 2px;"></div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        return html;
    }
    
    renderButtons(buttons) {
        if (buttons.length === 0) return '';
        
        let html = '<div style="margin: 5px 0;">Buttons:</div>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 3px; margin-left: 10px;">';
        
        for (let i = 0; i < buttons.length; i++) {
            const pressed = buttons[i];
            const color = pressed ? '#00ff88' : '#444';
            const symbol = pressed ? '●' : '○';
            
            html += `
                <div style="
                    width: 22px;
                    height: 22px;
                    background: ${color};
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 8px;
                    font-weight: bold;
                    color: ${pressed ? '#000' : '#666'};
                ">
                    ${i}
                </div>
            `;
        }
        
        html += '</div>';
        return html;
    }
    
    renderPOVs(povs) {
        if (povs.length === 0) return '';
        
        let html = '<div style="margin: 5px 0;">POV:</div>';
        html += '<div style="margin-left: 10px;">';
        
        for (let i = 0; i < povs.length; i++) {
            const angle = povs[i];
            const active = angle !== 0;
            html += `<div style="color: ${active ? '#00ff88' : '#666'};">POV${i}: ${angle}°</div>`;
        }
        
        html += '</div>';
        return html;
    }
    
    truncateName(name) {
        if (name.length > 25) {
            return name.substring(0, 22) + '...';
        }
        return name;
    }
    
    show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }
    
    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
    
    toggle() {
        if (this.container) {
            if (this.container.style.display === 'none') {
                this.show();
            } else {
                this.hide();
            }
        }
    }
    
    destroy() {
        this.stopUpdating();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }
}

// Make it globally accessible for testing
window.JoystickUI = JoystickUI;
