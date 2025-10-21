"""
System Monitoring Module
Handles CPU, RAM, and client connection monitoring.
"""

import time
import threading
import json
import asyncio

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    print("psutil not available - system monitoring will be disabled")
    PSUTIL_AVAILABLE = False

from .config import Config


class SystemMonitor:
    """System monitoring and statistics management"""
    
    def __init__(self):
        self._clients = set()
        self._system_stats = {
            'cpu_percent': 0.0,
            'ram_percent': 0.0,
            'ram_used_mb': 0,
            'ram_total_mb': 0,
            'connected_clients': 0
        }
        self._ws_loop = None
        self._monitor_thread = None
        self._running = False
    
    def add_client(self, client):
        """Add a WebSocket client"""
        self._clients.add(client)
        self._system_stats['connected_clients'] = len(self._clients)
    
    def remove_client(self, client):
        """Remove a WebSocket client"""
        self._clients.discard(client)
        self._system_stats['connected_clients'] = len(self._clients)
    
    def get_client_count(self) -> int:
        """Get number of connected clients"""
        return len(self._clients)
    
    def set_websocket_loop(self, loop):
        """Set the asyncio loop for WebSocket broadcasting"""
        self._ws_loop = loop
    
    def update_system_stats(self):
        """Update system statistics (CPU, RAM, connected clients)"""
        try:
            if PSUTIL_AVAILABLE:
                # Get CPU usage (non-blocking)
                cpu_percent = psutil.cpu_percent(interval=0.1)
                
                # Get memory usage
                memory = psutil.virtual_memory()
                ram_percent = memory.percent
                ram_used_mb = round(memory.used / 1024 / 1024)
                ram_total_mb = round(memory.total / 1024 / 1024)
                
                # Update system stats
                self._system_stats.update({
                    'cpu_percent': round(cpu_percent, 1),
                    'ram_percent': round(ram_percent, 1),
                    'ram_used_mb': ram_used_mb,
                    'ram_total_mb': ram_total_mb,
                    'connected_clients': len(self._clients)
                })
            else:
                # Fallback when psutil is not available
                self._system_stats.update({
                    'cpu_percent': 0.0,
                    'ram_percent': 0.0,
                    'ram_used_mb': 0,
                    'ram_total_mb': 0,
                    'connected_clients': len(self._clients)
                })
            
        except Exception as e:
            print(f"Error updating system stats: {e}")
    
    def get_system_stats(self) -> dict:
        """Get current system statistics"""
        self.update_system_stats()
        return self._system_stats.copy()
    
    def start_monitoring(self, broadcast_callback=None):
        """Start periodic system monitoring"""
        if not PSUTIL_AVAILABLE and not broadcast_callback:
            print("Cannot start full system monitoring - psutil not available")
        
        def monitor_loop():
            while self._running:
                try:
                    self.update_system_stats()
                    
                    # Broadcast system stats if callback provided
                    if broadcast_callback and self._ws_loop and self._clients:
                        system_data = {
                            'type': 'system_stats',
                            'data': self._system_stats
                        }
                        asyncio.run_coroutine_threadsafe(
                            broadcast_callback(system_data), 
                            self._ws_loop
                        )
                    
                    time.sleep(Config.SYSTEM_UPDATE_INTERVAL)
                except Exception as e:
                    print(f"System monitoring error: {e}")
                    time.sleep(Config.SYSTEM_UPDATE_INTERVAL)
        
        self._running = True
        self._monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        self._monitor_thread.start()
        
        if PSUTIL_AVAILABLE:
            print(f"System monitoring started (updates every {Config.SYSTEM_UPDATE_INTERVAL}s)")
        else:
            print("Basic monitoring started (client counting only)")
    
    def stop_monitoring(self):
        """Stop system monitoring"""
        self._running = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=1.0)
    
    def is_psutil_available(self) -> bool:
        """Check if psutil is available for full monitoring"""
        return PSUTIL_AVAILABLE