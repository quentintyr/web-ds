"""
WebSocket Server Module
Handles WebSocket connections, broadcasting, and NetworkTables integration.
"""

import json
import threading
import asyncio
import websockets
from networktables import NetworkTables

from .config import Config


class WebSocketServer:
    """WebSocket server for real-time updates"""
    
    def __init__(self, system_monitor):
        self.system_monitor = system_monitor
        self._status = None
        self._log_lines = []
        self._log_lock = threading.Lock()
        self._nt_initialized = False
        self._ws_loop = None
        
    def init_networktables(self, server_ip: str = None):
        """Initialize NetworkTables connection"""
        if self._nt_initialized:
            return
            
        try:
            # Connect as CLIENT to VMX-pi's NetworkTables server
            if server_ip:
                print(f"Connecting to VMX-pi NetworkTables server at {server_ip}")
                NetworkTables.initialize(server=server_ip)
            else:
                print("Connecting to NetworkTables server via discovery")
                NetworkTables.initialize()

            # Subscribe to tables
            self._subscribe_tables()
            self._nt_initialized = True
            
            # Add connection debug info
            print("NetworkTables client initialized successfully")
            print(f"Attempting to connect to VMX-pi at {server_ip if server_ip else 'auto-discover'}")
            
            # Check connection status periodically
            def check_connection():
                import time
                for i in range(10):  # Check for 10 seconds
                    time.sleep(1)
                    if NetworkTables.isConnected():
                        print("Connected to VMX-pi NetworkTables server!")
                        return
                    else:
                        print(f"⏳ Connecting to VMX-pi... ({i+1}/10)")
                print("❌ Failed to connect to VMX-pi NetworkTables server")
                print("   Check if VMX-pi is running and accessible")
            
            connection_thread = threading.Thread(target=check_connection, daemon=True)
            connection_thread.start()
        except Exception as e:
            print(f"❌ Failed to init NetworkTables: {e}")

    def _subscribe_tables(self):
        """Subscribe to NetworkTables for log and status updates"""
        def log_listener(*args):
            try:
                _, key, value = args[:3]
            except Exception:
                return
            try:
                # Debug: Print ALL NetworkTables activity to diagnose connection
                print(f"NetworkTables update: key='{key}' value='{value}'")
                
                # Process both "latest" for real-time updates and "history" for initial load
                if key == "latest":
                    print(f"Processing latest log: {value}")
                    with self._log_lock:
                        self._log_lines.append(str(value))
                        self._log_lines = self._log_lines[-Config.MAX_LOG_HISTORY:]
                    if self._ws_loop:
                        fmt = 'html' if '<' in str(value) else 'ansi'
                        asyncio.run_coroutine_threadsafe(
                            self._broadcast({'type': 'log', 'line': value, 'format': fmt}), 
                            self._ws_loop
                        )
                elif key == "history":
                    print(f"Processing log history: {len(value)} characters")
                    # Split history into individual lines and update our log storage
                    history_lines = [line.strip() for line in str(value).split('\\n') if line.strip()]
                    with self._log_lock:
                        self._log_lines = history_lines[-Config.MAX_LOG_HISTORY:]  # Keep last 500 lines
                    if self._ws_loop:
                        # Send complete history to newly connected clients
                        asyncio.run_coroutine_threadsafe(
                            self._broadcast({'type': 'log_init', 'data': history_lines}), 
                            self._ws_loop
                        )
                else:
                    print(f"Ignoring key: {key}")
            except Exception as e:
                print(f"❌ Log listener error: {e}")

        def status_listener(*args):
            try:
                _, key, value = args[:3]
            except Exception:
                return
            try:
                print(f"Dashboard listener: key={key} value={value}")
                if self._status is None:
                    self._status = {}
                self._status[key] = value
                if self._ws_loop:
                    asyncio.run_coroutine_threadsafe(
                        self._broadcast({'type': 'status', 'table': 'Dashboard', 'key': key, 'value': value}), 
                        self._ws_loop
                    )
            except Exception as e:
                print(f"❌ Status listener error: {e}")

        # Subscribe to logs table
        try:
            logs = NetworkTables.getTable('Logs')
            logs.addEntryListener(log_listener)
            print("🔗 Subscribed to Logs table (NetworkTables)")
        except Exception:
            pass

        # Subscribe to dashboard table
        try:
            dash = NetworkTables.getTable('Dashboard')
            dash.addEntryListener(status_listener)
            print("Subscribed to Dashboard table (NetworkTables)")
        except Exception:
            pass

    async def _broadcast(self, message: dict):
        """Broadcast message to all connected WebSocket clients"""
        data = json.dumps(message)
        to_remove = []
        clients = list(self.system_monitor._clients)  # Get clients from system monitor
        
        for ws in clients:
            try:
                await ws.send(data)
            except Exception:
                to_remove.append(ws)
        
        for ws in to_remove:
            self.system_monitor.remove_client(ws)

    def get_status_json(self):
        """Get status as JSON string"""
        if self._status is None:
            return None
        return json.dumps(self._status)

    def get_status(self):
        """Get current status with system stats"""
        base_status = self._status if self._status is not None else {}
        # Add system monitoring data
        system_stats = self.system_monitor.get_system_stats()
        base_status.update(system_stats)
        return base_status

    def get_log_text(self):
        """Get all logs as text"""
        with self._log_lock:
            if not self._log_lines:
                return None
            return "\\n".join(self._log_lines)

    async def websocket_handler(self, websocket, path=None):
        """Handle WebSocket connections"""
        self.system_monitor.add_client(websocket)
        print(f"WebSocket client connected ({self.system_monitor.get_client_count()} total)")
        
        try:
            # Send initial status and recent logs
            if self._status:
                await websocket.send(json.dumps({'type': 'status_init', 'data': self._status}))
            with self._log_lock:
                if self._log_lines:
                    await websocket.send(json.dumps({'type': 'log_init', 'data': self._log_lines}))
            
            # Send current system stats
            await websocket.send(json.dumps({
                'type': 'system_stats', 
                'data': self.system_monitor.get_system_stats()
            }))

            async for msg in websocket:
                # Accept ping or commands from client if needed
                pass
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            self.system_monitor.remove_client(websocket)
            print(f"WebSocket client disconnected ({self.system_monitor.get_client_count()} total)")

    def start_websocket_server(self, host=None, port=None):
        """Start the WebSocket server"""
        host = host or Config.WEBSOCKET_HOST
        port = port or Config.WEBSOCKET_PORT
        
        async def _ws_main():
            # Store the running loop so other threads can schedule broadcasts
            self._ws_loop = asyncio.get_running_loop()
            self.system_monitor.set_websocket_loop(self._ws_loop)
            
            async with websockets.serve(self.websocket_handler, host, port):
                print(f"WebSocket server running on ws://{host}:{port}")
                await asyncio.Future()  # run forever

        # Run the websocket server in this thread using asyncio.run
        asyncio.run(_ws_main())