"""
FRC Web Driver Station Server
HTTP server with extended query parameter support for FRC robot control.
Uses Python's built-in http.server for minimal overhead on VMX-pi.
"""

import http.server
import socketserver
import json
import urllib.parse
import os
import time
import sys
from pathlib import Path

# Add python directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from frc_protocol import get_driver_station

class FRCDriverStationHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler for FRC Driver Station web interface"""
    
    # Class-level driver station instance (shared across requests)
    _driver_station = None
    
    @classmethod
    def get_driver_station(cls):
        """Get or create the shared driver station instance"""
        if cls._driver_station is None:
            cls._driver_station = get_driver_station()
        return cls._driver_station
    
    @classmethod 
    def shutdown_driver_station(cls):
        """Shutdown the driver station"""
        if cls._driver_station is not None:
            cls._driver_station.stop()
            cls._driver_station = None
    
    def __init__(self, *args, **kwargs):
        # Initialize driver station
        self.ds = self.get_driver_station()
        
        # Set web directory as the document root
        web_dir = os.path.join(os.path.dirname(__file__), '..', 'web')
        self.web_root = os.path.abspath(web_dir)
        
        # Configure team number - CHANGE THIS TO YOUR TEAM NUMBER  
        TEAM_NUMBER = 1234  # Matches your network IP 10.12.34.2
        print(f"🔧 Setting team number to: {TEAM_NUMBER}")
        self.ds.set_team_number(TEAM_NUMBER)
        
        super().__init__(*args, directory=self.web_root, **kwargs)
    
    def log_message(self, format, *args):
        """Custom logging with timestamps and emojis"""
        import time
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}] 🌐 {format % args}")
    
    def do_GET(self):
        """Handle GET requests for both API and static files"""
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == '/api/ds':
            self._handle_api_request(parsed_path)
        elif parsed_path.path == '/api/ds/status':
            self._send_json_response(self.ds.get_status())
        elif parsed_path.path == '/status.json':
            self._serve_robot_status()
        elif parsed_path.path == '/robot.log':
            self._serve_robot_log()
        else:
            # Handle static files
            if parsed_path.path == '/':
                self.path = '/index.html'
            super().do_GET()
    
    def do_POST(self):
        """Handle POST requests for robot control"""
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path.startswith('/api/ds'):
            self._handle_api_request(parsed_path)
        else:
            self.send_error(404, "Endpoint not found")
    
    def _handle_api_request(self, parsed_path):
        """Handle API requests with query parameters"""
        try:
            # Parse query parameters
            params = urllib.parse.parse_qs(parsed_path.query)
            action = params.get('action', [None])[0]
            
            if not action:
                self._send_json_response({'error': 'No action specified'}, 400)
                return
            
            response = self._execute_action(action, params)
            self._send_json_response(response)
            
        except Exception as e:
            self.log_message(f"❌ API Error: {e}")
            self._send_json_response({'error': str(e)}, 500)
    
    def _execute_action(self, action, params):
        """Execute the requested action"""
        
        if action == 'enable':
            print(f"🔧 Processing enable command...")
            
            # Get current status first
            current_status = self.ds.get_status()
            print(f"📊 Pre-enable status: comms={current_status.get('robot_communications', False)}, "
                  f"code={current_status.get('robot_code', False)}, "
                  f"can_enable={current_status.get('can_be_enabled', False)}")
            
            success = self.ds.enable_robot()
            
            if not success:
                # If enable failed, provide more details
                error_msg = "Cannot enable robot - check robot code and communications"
                if not current_status.get('robot_communications', False):
                    error_msg = "No communication with robot"
                elif not current_status.get('robot_code', False):
                    error_msg = "Robot code not detected"
                elif current_status.get('emergency_stopped', False):
                    error_msg = "Robot is emergency stopped"
                
                print(f"⚠️ {error_msg}")
                result = {'status': 'failed', 'success': False, 'error': error_msg}
            else:
                result = {'status': 'enabled', 'success': True}
            
            print(f"🔧 Enable result: {result}")
            return result
        
        elif action == 'disable':
            success = self.ds.disable_robot()
            return {'status': 'disabled' if success else 'failed', 'success': success}
        
        elif action == 'teleop':
            success = self.ds.set_teleop_mode()
            return {'mode': 'teleoperated', 'success': success}
        
        elif action == 'auto':
            success = self.ds.set_autonomous_mode()
            return {'mode': 'autonomous', 'success': success}
        
        elif action == 'test':
            success = self.ds.set_test_mode()
            return {'mode': 'test', 'success': success}
        
        elif action == 'estop':
            success = self.ds.emergency_stop()
            return {'status': 'emergency_stopped', 'success': success}
        
        elif action == 'clear_estop':
            success = self.ds.clear_emergency_stop()
            return {'status': 'estop_cleared', 'success': success}
        
        elif action == 'set_team':
            team = params.get('team', [None])[0]
            if not team:
                return {'error': 'Team number required'}
            
            try:
                team_number = int(team)
                success = self.ds.set_team_number(team_number)
                return {'team': team_number, 'success': success}
            except ValueError:
                return {'error': 'Invalid team number'}
        
        elif action == 'set_address':
            address = params.get('address', [None])[0]
            if not address:
                return {'error': 'IP address required'}
            
            success = self.ds.set_robot_address(address)
            return {'address': address, 'success': success}
        
        elif action == 'status':
            status = self.ds.get_status()
            status['mode_string'] = self.ds.get_mode_string()
            status['connected'] = self.ds.is_connected()
            return status
        
        else:
            return {'error': f'Unknown action: {action}'}
    
    def _send_json_response(self, data, status_code=200):
        """Send JSON response with proper headers"""
        try:
            response = json.dumps(data, indent=2).encode('utf-8')
            
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()
            
            self.wfile.write(response)
            
        except Exception as e:
            self.log_message(f"❌ Response Error: {e}")
            super().send_error(500, "Internal server error")
    
    def _serve_robot_status(self):
        """Serve robot status JSON from /home/lvuser/deploy/status.json"""
        status_file = '/home/lvuser/deploy/status.json'
        
        try:
            if os.path.exists(status_file):
                with open(status_file, 'r') as f:
                    content = f.read().strip()
                
                # Check if file is empty or invalid JSON
                if not content or content == '':
                    content = self._get_default_robot_status()
                else:
                    # Try to parse JSON to validate it
                    try:
                        json.loads(content)
                    except json.JSONDecodeError:
                        content = self._get_default_robot_status()
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                self.wfile.write(content.encode('utf-8'))
            else:
                # Send default status if file doesn't exist
                default_status = self._get_default_robot_status()
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(default_status)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                self.wfile.write(default_status.encode('utf-8'))
                
        except Exception as e:
            self.log_message(f"❌ Error serving robot status: {e}")
            self.send_error(500, "Error reading robot status")
    
    def _serve_robot_log(self):
        """Serve robot log from /home/lvuser/deploy/robot.log"""
        log_file = '/home/lvuser/deploy/robot.log'
        
        try:
            if os.path.exists(log_file):
                with open(log_file, 'r') as f:
                    content = f.read()
                
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                self.wfile.write(content.encode('utf-8'))
            else:
                # Send default message if log file doesn't exist
                default_log = f"Robot log not found at {log_file}\nWaiting for robot data..."
                
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(default_log)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                self.wfile.write(default_log.encode('utf-8'))
                
        except Exception as e:
            self.log_message(f"❌ Error serving robot log: {e}")
            self.send_error(500, "Error reading robot log")
    
    def _get_default_robot_status(self):
        """Generate default robot status JSON"""
        import time
        default_status = {
            "timestamp": time.time(),
            "status": "no_robot_data",
            "USSensorLeft": 0.0,
            "USSensorRight": 0.0,
            "IRSensorLeft": 0.0,
            "IRSensorRight": 0.0,
            "lidarDistance": 0.0,
            "lidarStatus": "idle",
            "extenderStatus": "idle",
            "extenderLength": 0,
            "elevatorPosition": 0,
            "gripperStatus": "unknown",
            "carriagePosition": "unknown",
            "lineFollowerSensor": "off line",
            "batteryVoltage": 0.0,
            "batteryStatus": "unknown"
        }
        return json.dumps(default_status)
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded TCP server for handling multiple concurrent requests"""
    allow_reuse_address = True
    daemon_threads = True

def main():
    """Main server startup"""
    PORT = 8080
    
    print("🤖 FRC Web Driver Station")
    print("=" * 40)
    
    # Check if web directory exists
    web_dir = os.path.join(os.path.dirname(__file__), '..', 'web')
    if not os.path.exists(web_dir):
        print("❌ Web directory not found!")
        print(f"   Expected at: {web_dir}")
        sys.exit(1)
    
    try:
        # Start the server
        with ThreadedTCPServer(("", PORT), FRCDriverStationHandler) as httpd:
            print(f"🌐 Server running at http://localhost:{PORT}")
            print(f"📁 Serving files from: {web_dir}")
            print(f"📡 Using native FRC protocol implementation")
            print()
            print("API Endpoints:")
            print(f"  http://localhost:{PORT}/api/ds?action=status")
            print(f"  http://localhost:{PORT}/api/ds?action=enable")
            print(f"  http://localhost:{PORT}/api/ds?action=disable")
            print(f"  http://localhost:{PORT}/api/ds?action=teleop")
            print(f"  http://localhost:{PORT}/api/ds?action=auto")
            print(f"  http://localhost:{PORT}/api/ds?action=test")
            print(f"  http://localhost:{PORT}/api/ds?action=estop")
            print(f"  http://localhost:{PORT}/api/ds?action=set_team&team=1234")
            print()
            print("💡 Press Ctrl+C to stop the server")
            print("=" * 40)
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n🛑 Server stopped by user")
    except Exception as e:
        print(f"❌ Server error: {e}")
    finally:
        # Clean shutdown of driver station
        print("🧹 Cleaning up driver station...")
        FRCDriverStationHandler.shutdown_driver_station()

if __name__ == "__main__":
    main()