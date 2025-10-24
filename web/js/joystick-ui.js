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
        
        console.log('Joystick UI initialized');
    }
    
    createContainer() {
        const container = document.createElement('div');
        container.id = 'joystick-panel';
        container.className = 'joystick-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #20222e;
            border: 1px solid #444;
            border-radius: 0.5rem;
            padding: 1rem;
            min-width: 320px;
            max-width: 400px;
            max-height: 500px;
            overflow-y: auto;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 14px;
            color: #f8f8f8;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.13);
        `;
        
        // Add header
        const header = document.createElement('div');
        header.style.cssText = `
            font-weight: bold;
            font-size: 1.05rem;
            margin-bottom: 0.75rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #444;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #ffcf40;
            letter-spacing: 0.5px;
        `;
        
        const title = document.createElement('span');
        title.textContent = 'JOYSTICKS';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #f8f8f8;
            font-size: 18px;
            cursor: pointer;
            padding: 0 5px;
            transition: color 0.2s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = '#ff5454';
        closeBtn.onmouseout = () => closeBtn.style.color = '#f8f8f8';
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
            content.innerHTML = '<div style="color: #9E9E9E; text-align: center; padding: 1rem;">No joysticks connected</div>';
            return;
        }
        
        let html = '';
        
        for (const js of data) {
            const statusColor = js.blacklisted ? '#ff5454' : '#4CAF50';
            const statusText = js.blacklisted ? 'BLACKLISTED' : 'ACTIVE';
            
            html += `
                <div style="margin-bottom: 1rem; padding: 0.75rem; background: #27293d; border-radius: 0.5rem; border: 1px solid #444;">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; color: #6ec1e4; font-size: 0.95rem;">
                        [${js.id}] ${this.truncateName(js.name)}
                        <span style="color: ${statusColor}; font-size: 0.75rem; font-weight: normal; margin-left: 0.5rem;">${statusText}</span>
                    </div>
                    
                    ${this.renderAxes(js.axes)}
                    ${this.renderButtons(js.buttons)}
                </div>
            `;
        }
        
        content.innerHTML = html;
    }
    
    renderAxes(axes) {
        if (axes.length === 0) return '';
        
        let html = '<div style="margin: 0.5rem 0 0.25rem 0; color: #ffcf40; font-size: 0.85rem; font-weight: 600;">Axes:</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; margin-left: 0.5rem;">';
        
        for (let i = 0; i < axes.length; i++) {
            const value = axes[i];
            const percentage = ((value + 1) / 2 * 100).toFixed(0);
            const barColor = Math.abs(value) > 0.1 ? '#4CAF50' : '#444';
            
            html += `
                <div style="font-size: 0.8rem;">
                    <div style="color: #f8f8f8; margin-bottom: 2px;">A${i}: ${value.toFixed(2)}</div>
                    <div style="width: 100%; height: 5px; background: #1a1c28; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${percentage}%; height: 100%; background: ${barColor}; transition: all 0.1s;"></div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        return html;
    }
    
    renderButtons(buttons) {
        if (buttons.length === 0) return '';
        
        let html = '<div style="margin: 0.5rem 0 0.25rem 0; color: #ffcf40; font-size: 0.85rem; font-weight: 600;">Buttons:</div>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-left: 0.5rem;">';
        
        for (let i = 0; i < buttons.length; i++) {
            const pressed = buttons[i];
            const bgColor = pressed ? '#4CAF50' : '#444';
            const textColor = pressed ? '#fff' : '#9E9E9E';
            
            html += `
                <div style="
                    width: 26px;
                    height: 26px;
                    background: ${bgColor};
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.7rem;
                    font-weight: 600;
                    color: ${textColor};
                    transition: all 0.1s;
                    box-shadow: ${pressed ? '0 0 8px rgba(76, 175, 80, 0.5)' : 'none'};
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
        
        let html = '<div style="margin: 0.5rem 0 0.25rem 0; color: #ffcf40; font-size: 0.85rem; font-weight: 600;">POV (D-Pad):</div>';
        html += '<div style="margin-left: 0.5rem;">';
        
        for (let i = 0; i < povs.length; i++) {
            const angle = povs[i];
            // POV is active when not -1 (FRC standard for "not pressed")
            const active = angle !== -1;
            const displayAngle = angle === -1 ? '--' : `${angle}°`;
            const direction = this.getPOVDirection(angle);
            const textColor = active ? '#4CAF50' : '#9E9E9E';
            html += `<div style="color: ${textColor}; font-size: 0.9rem; padding: 0.2rem 0;">POV${i}: ${displayAngle} ${direction}</div>`;
        }
        
        html += '</div>';
        return html;
    }
    
    getPOVDirection(angle) {
        if (angle === -1) return '';
        if (angle === 0) return '↑';
        if (angle === 45) return '↗';
        if (angle === 90) return '→';
        if (angle === 135) return '↘';
        if (angle === 180) return '↓';
        if (angle === 225) return '↙';
        if (angle === 270) return '←';
        if (angle === 315) return '↖';
        return '';
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
