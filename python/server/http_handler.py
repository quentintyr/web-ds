"""
HTTP Request Handler Module
Handles all HTTP requests for the FRC Web Driver Station.
"""

import http.server
import urllib.parse
import json
import os
import sys

from .config import Config

# Add python directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from frc_protocol_2020 import get_driver_station
except ImportError:
    print("Could not import frc_protocol_2020 - make sure it's in the python directory")
    sys.exit(1)


class FRCDriverStationHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler for FRC Driver Station web interface"""
    
    # Class-level instances (shared across requests)
    _driver_station = None
    _websocket_server = None
    
    @classmethod
    def set_websocket_server(cls, websocket_server):
        """Set the WebSocket server instance"""
        cls._websocket_server = websocket_server
    
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
        web_dir = Config.WEB_DIR
        self.web_root = os.path.abspath(web_dir)
        
        # Configure team number
        print(f"🔧 Setting team number to: {Config.DEFAULT_TEAM_NUMBER}")
        self.ds.set_team_number(Config.DEFAULT_TEAM_NUMBER)

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
            self._serve_status_json()
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
    
    def _serve_status_json(self):
        """Serve robot status from WebSocket server"""
        try:
            if self._websocket_server:
                status = self._websocket_server.get_status()
                self._send_json_response(status)
            else:
                self._send_json_response({'error': 'WebSocket server not available'}, 500)
        except Exception as e:
            self.log_message(f"❌ Error serving status: {e}")
            self.send_error(500, "Error reading robot status")
    
    def _serve_robot_log(self):
        """Serve robot log from WebSocket server"""
        try:
            if self._websocket_server:
                content = self._websocket_server.get_log_text()
                if content is None:
                    content = "No robot logs available yet..."
            else:
                content = "WebSocket server not available"

            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            self.wfile.write(content.encode('utf-8'))
                
        except Exception as e:
            self.log_message(f"❌ Error serving robot log: {e}")
            self.send_error(500, "Error reading robot log")
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()