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
import threading
import asyncio
import websockets
from networktables import NetworkTables

# Add python directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from frc_protocol import get_driver_station

DEFAULT_TEAM_NUMBER = int(os.environ.get('TEAM_NUMBER', '1234'))


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
        
        # Configure team number - can be overridden with TEAM_NUMBER env var
        TEAM_NUMBER = DEFAULT_TEAM_NUMBER
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
            self._send_json_response(ServerState.get_status())
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
        """Serve robot status JSON from the in-memory ServerState or fallback file"""
        status_file = '/home/lvuser/deploy/status.json'
        
        try:
            # Prefer in-memory status if available
            content = ServerState.get_status_json()
            if content is None:
                # Fallback to file if it exists
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
            if not content or content == '':
                # Send default status if we have nothing
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
            # Prefer in-memory logs first
            content = ServerState.get_log_text()
            if content is None and os.path.exists(log_file):
                with open(log_file, 'r') as f:
                    content = f.read()

            if content is None:
                default_log = f"Robot log not found at {log_file}\nWaiting for robot data..."
                content = default_log

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


class ServerState:
    """Holds in-memory robot status and logs, subscribes to NetworkTables, and broadcasts updates to websockets."""
    _status = None
    _log_lines = []
    _log_lock = threading.Lock()
    _clients = set()
    _nt_initialized = False
    _ws_loop = None

    @classmethod
    def init_networktables(cls, server_ip: str = None):
        if cls._nt_initialized:
            return
        if server_ip is None:
            # Default to local robot address as in ds_server: 10.1234.2 or from config
            server_ip = None
        try:
            if server_ip:
                print(f"🔗 Initializing NetworkTables: connecting to {server_ip}")
                NetworkTables.initialize(server=server_ip)
            else:
                print("🔗 Initializing NetworkTables with default discovery")
                NetworkTables.initialize()

            # Subscribe to a few keys by default
            cls._subscribe_tables()
            cls._nt_initialized = True
        except Exception as e:
            print(f"❌ Failed to init NetworkTables: {e}")

    @classmethod
    def _subscribe_tables(cls):
        def log_listener(*args):
            try:
                _, key, value = args[:3]
            except Exception:
                return
            try:
                print(f"📥 Logs listener: key={key} value={value}")
                with cls._log_lock:
                    cls._log_lines.append(str(value))
                    cls._log_lines = cls._log_lines[-500:]
                if cls._ws_loop:
                    fmt = 'html' if '<' in str(value) else 'ansi'
                    asyncio.run_coroutine_threadsafe(cls._broadcast({'type': 'log', 'line': value, 'format': fmt}), cls._ws_loop)
            except Exception as e:
                print(f"❌ Log listener error: {e}")

        def status_listener(*args):
            try:
                _, key, value = args[:3]
            except Exception:
                return
            try:
                print(f"📥 Dashboard listener: key={key} value={value}")
                if cls._status is None:
                    cls._status = {}
                cls._status[key] = value
                if cls._ws_loop:
                    asyncio.run_coroutine_threadsafe(cls._broadcast({'type': 'status', 'table': 'Dashboard', 'key': key, 'value': value}), cls._ws_loop)
            except Exception as e:
                print(f"❌ Status listener error: {e}")

        # Use an explicit call to add entry listeners per known table
        try:
            logs = NetworkTables.getTable('Logs')
            logs.addEntryListener(log_listener)
            print("🔗 Subscribed to Logs table (NetworkTables)")
        except Exception:
            pass

        # Generic subscription — listen to Dashboard table too
        try:
            dash = NetworkTables.getTable('Dashboard')
            dash.addEntryListener(status_listener)
            print("🔗 Subscribed to Dashboard table (NetworkTables)")
        except Exception:
            pass

    @classmethod
    async def _broadcast(cls, message: dict):
        data = json.dumps(message)
        to_remove = []
        for ws in list(cls._clients):
            try:
                await ws.send(data)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            cls._clients.discard(ws)

    @classmethod
    def get_status_json(cls):
        if cls._status is None:
            return None
        return json.dumps(cls._status)

    @classmethod
    def get_status(cls):
        return cls._status if cls._status is not None else {}

    @classmethod
    def get_log_text(cls):
        with cls._log_lock:
            if not cls._log_lines:
                return None
            return "\n".join(cls._log_lines)

    @classmethod
    async def websocket_handler(cls, websocket, path=None):
        cls._clients.add(websocket)
        print(f"🔌 WebSocket client connected ({len(cls._clients)} total)")
        try:
            # Send initial status and recent logs
            if cls._status:
                await websocket.send(json.dumps({'type': 'status_init', 'data': cls._status}))
            with cls._log_lock:
                if cls._log_lines:
                    await websocket.send(json.dumps({'type': 'log_init', 'data': cls._log_lines}))

            async for msg in websocket:
                # accept ping or commands from client if needed
                pass
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            cls._clients.discard(websocket)
            print(f"🔌 WebSocket client disconnected ({len(cls._clients)} total)")

    @classmethod
    def start_websocket_server(cls, host='0.0.0.0', port=8765):
        async def _ws_main():
            # Store the running loop so other threads can schedule broadcasts
            cls._ws_loop = asyncio.get_running_loop()
            async with websockets.serve(cls.websocket_handler, host, port):
                print(f"🌐 WebSocket server running on ws://{host}:{port}")
                await asyncio.Future()  # run forever

        # Run the websocket server in this thread using asyncio.run
        asyncio.run(_ws_main())

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
    
    # Initialize NetworkTables client in background (connect directly to robot IP)
    def team_to_ip(team: int) -> str:
        return f"10.{team // 100}.{team % 100}.2"

    server_ip = team_to_ip(DEFAULT_TEAM_NUMBER)
    ServerState.init_networktables(server_ip)

    # Start websocket broadcaster thread
    ws_thread = threading.Thread(target=ServerState.start_websocket_server, daemon=True)
    ws_thread.start()

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