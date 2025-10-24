"""
FRC Web Driver Station Server - Main Entry Point
Simplified, modular server implementation.
"""

import socketserver
import threading
import sys
import os

# Import our modular components
from server import Config, FRCDriverStationHandler, WebSocketServer, SystemMonitor


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded TCP server for handling multiple concurrent requests"""
    allow_reuse_address = True
    daemon_threads = True


def main():
    """Main server startup"""
    print("FRC Web Driver Station (Modular)")
    print("=" * 40)
    
    # Check if web directory exists
    if not os.path.exists(Config.WEB_DIR):
        print("Web directory not found!")
        print(f"   Expected at: {Config.WEB_DIR}")
        sys.exit(1)
    
    # Initialize system monitor
    system_monitor = SystemMonitor()
    
    # Initialize WebSocket server
    websocket_server = WebSocketServer(system_monitor)
    websocket_server.init_networktables(Config.get_robot_ip())
    
    # Connect HTTP handler to WebSocket server
    FRCDriverStationHandler.set_websocket_server(websocket_server)
    
    # CRITICAL: Create driver station instance and link it to WebSocket
    # This ensures joystick data can flow from WebSocket to driver station
    print("Initializing FRC Driver Station...")
    driver_station = FRCDriverStationHandler.get_driver_station()
    websocket_server.driver_station = driver_station
    print(f"✅ Driver station linked to WebSocket server")
    print(f"   Driver station ready: {driver_station is not None}")
    team_num = driver_station.team_number if driver_station and hasattr(driver_station, 'team_number') else 'N/A'
    print(f"   Team number: {team_num}")
    
    # Start system monitoring
    def broadcast_callback(data):
        """Callback for broadcasting system stats"""
        return websocket_server._broadcast(data)
    
    if system_monitor.is_psutil_available():
        system_monitor.start_monitoring(broadcast_callback)
        print("System monitoring enabled (CPU/RAM/Clients)")
    else:
        system_monitor.start_monitoring()  # Client counting only
        print("System monitoring disabled (install psutil: pip install psutil)")
    
    # Start WebSocket server in background thread
    ws_thread = threading.Thread(
        target=websocket_server.start_websocket_server, 
        daemon=True
    )
    ws_thread.start()

    try:
        # Start the HTTP server
        with ThreadedTCPServer(("", Config.HTTP_PORT), FRCDriverStationHandler) as httpd:
            print(f"HTTP server running at http://localhost:{Config.HTTP_PORT}")
            print(f"Serving files from: {Config.WEB_DIR}")
            print(f"WebSocket server on port: {Config.WEBSOCKET_PORT}")
            print(f"Using native FRC protocol implementation")
            print()
            print("API Endpoints:")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=status")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=enable")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=disable")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=teleop")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=auto")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=test")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=estop")
            print(f"  http://localhost:{Config.HTTP_PORT}/api/ds?action=set_team&team=1234")
            print()
            print("Press Ctrl+C to stop the server")
            print("=" * 40)
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"❌ Server error: {e}")
    finally:
        # Clean shutdown
        print("Cleaning up...")
        system_monitor.stop_monitoring()
        FRCDriverStationHandler.shutdown_driver_station()


if __name__ == "__main__":
    main()