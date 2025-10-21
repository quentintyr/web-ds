#!/usr/bin/env python3
"""
FRC Robot Communication Protocol Implementation
Implements the FRC 2015/2016/2020 UDP protocol for direct robot communication.
Based on LibDS protocol analysis - sends packets every 20ms exactly like official DS.
"""

import socket
import struct
import time
import threading
import logging
from typing import Optional, Dict, Any, Callable
from dataclasses import dataclass
from enum import IntEnum

class ControlMode(IntEnum):
    """FRC Robot control modes"""
    TELEOP = 0x00
    AUTONOMOUS = 0x02  
    TEST = 0x01

class ControlBits(IntEnum):
    """FRC Control byte bit flags"""
    ENABLED = 0x04
    FMS_ATTACHED = 0x08
    EMERGENCY_STOP = 0x80

class RequestCode(IntEnum):
    """FRC Request codes"""
    NORMAL = 0x00
    RESTART_CODE = 0x04
    REBOOT = 0x08

class StationCode(IntEnum):
    """FRC Station codes (Alliance + Position)"""
    RED1 = 0x00
    RED2 = 0x01
    RED3 = 0x02
    BLUE1 = 0x03
    BLUE2 = 0x04
    BLUE3 = 0x05

@dataclass
class RobotStatus:
    """Robot status information"""
    connected: bool = False
    enabled: bool = False
    mode: ControlMode = ControlMode.TELEOP
    voltage: float = 0.0
    code_present: bool = False
    emergency_stopped: bool = False
    cpu_usage: int = 0
    ram_usage: int = 0
    can_utilization: float = 0.0
    packet_count: int = 0

class FRCDriverStation:
    """
    FRC Driver Station Protocol Implementation
    
    Implements the UDP protocol used by FRC Driver Stations to communicate
    with robots. Sends packets every 20ms and handles robot responses.
    """
    
    # Protocol constants from LibDS
    DS_TO_ROBOT_PORT = 1110
    ROBOT_TO_DS_PORT = 1150
    PACKET_INTERVAL = 0.02  # 20ms = 50Hz (critical timing!)
    WATCHDOG_TIMEOUT = 0.15  # 150ms before considering disconnected
    
    def __init__(self, team_number: int = 1234):
        """
        Initialize FRC Driver Station
        
        Args:
            team_number: Your FRC team number (used for robot address)
        """
        self.team_number = team_number
        self.robot_address = f"10.{team_number//100}.{team_number%100}.2"
        
        # Robot state
        self.status = RobotStatus()
        self._mode = ControlMode.TELEOP
        self._enabled = False
        self._emergency_stopped = False
        self._fms_attached = False
        
        # Packet counters (must increment every packet)
        self._sent_packets = 0
        
        # Communication
        self._socket: Optional[socket.socket] = None
        self._running = False
        self._send_thread: Optional[threading.Thread] = None
        self._recv_thread: Optional[threading.Thread] = None
        self._last_response_time = 0.0
        
        # Callbacks for status updates
        self._status_callbacks: list[Callable[[RobotStatus], None]] = []
        
        # Setup logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
        
    def add_status_callback(self, callback: Callable[[RobotStatus], None]):
        """Add callback for robot status updates"""
        self._status_callbacks.append(callback)
    
    def start(self) -> bool:
        """
        Start the driver station communication
        
        Returns:
            True if started successfully
        """
        try:
            # Create UDP socket
            self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._socket.settimeout(0.1)  # Non-blocking with short timeout
            
            # Bind for receiving responses
            self._socket.bind(('0.0.0.0', self.ROBOT_TO_DS_PORT))
            
            self._running = True
            
            # Start communication threads
            self._send_thread = threading.Thread(target=self._send_loop, daemon=True)
            self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
            
            self._send_thread.start()
            self._recv_thread.start()
            
            self.logger.info(f"FRC Driver Station started")
            self.logger.info(f"Target robot: {self.robot_address}:{self.DS_TO_ROBOT_PORT}")
            self.logger.info(f"Packet interval: {self.PACKET_INTERVAL*1000:.0f}ms")
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to start driver station: {e}")
            return False
    
    def stop(self):
        """Stop the driver station communication"""
        self._running = False
        
        if self._send_thread:
            self._send_thread.join(timeout=1.0)
        if self._recv_thread:
            self._recv_thread.join(timeout=1.0)
            
        if self._socket:
            self._socket.close()
            self._socket = None
            
        self.logger.info("FRC Driver Station stopped")
    
    def _send_loop(self):
        """Main packet sending loop - runs every 20ms"""
        next_send_time = time.time()
        
        while self._running:
            current_time = time.time()
            
            if current_time >= next_send_time:
                self._send_robot_packet()
                next_send_time = current_time + self.PACKET_INTERVAL
            
            # Sleep for remaining time, but check _running frequently
            sleep_time = max(0.001, next_send_time - time.time())
            time.sleep(min(sleep_time, 0.005))
    
    def _recv_loop(self):
        """Receive and process robot response packets"""
        while self._running:
            try:
                if self._socket:
                    data, addr = self._socket.recvfrom(1024)
                    if addr[0] == self.robot_address:
                        self._process_robot_response(data)
                        self._last_response_time = time.time()
                        
            except socket.timeout:
                # Check if we've lost communication
                if time.time() - self._last_response_time > self.WATCHDOG_TIMEOUT:
                    if self.status.connected:
                        self._handle_communication_lost()
                continue
            except Exception as e:
                if self._running:  # Only log if we're supposed to be running
                    self.logger.error(f"Receive error: {e}")
                time.sleep(0.01)
    
    def _send_robot_packet(self):
        """Send control packet to robot"""
        if not self._socket:
            return
            
        try:
            # Build packet exactly like LibDS FRC 2015/2020 protocol
            packet = self._build_robot_packet()
            
            # Send to robot
            self._socket.sendto(packet, (self.robot_address, self.DS_TO_ROBOT_PORT))
            self._sent_packets += 1
            
            # Log occasionally for debugging
            if self._sent_packets % 250 == 0:  # Every 5 seconds
                self.logger.debug(f"Sent {self._sent_packets} packets to robot")
                
        except Exception as e:
            self.logger.error(f"Send error: {e}")
    
    def _build_robot_packet(self) -> bytes:
        """
        Build robot control packet matching LibDS FRC protocol
        
        Packet format (minimum 6 bytes):
        [0-1] Packet sequence number (big-endian uint16)
        [2]   Protocol version tag (0x01)
        [3]   Control code (mode + enable + emergency stop bits)
        [4]   Request code (restart/reboot flags)
        [5]   Station code (alliance + position)
        
        Returns:
            Packet bytes
        """
        # Control code byte
        control_code = self._mode.value
        
        if self._enabled and not self._emergency_stopped:
            control_code |= ControlBits.ENABLED
            
        if self._fms_attached:
            control_code |= ControlBits.FMS_ATTACHED
            
        if self._emergency_stopped:
            control_code |= ControlBits.EMERGENCY_STOP
        
        # Build packet
        packet = struct.pack('>H',     # Packet number (big-endian uint16)
                           self._sent_packets & 0xFFFF)
        packet += struct.pack('B',     # Protocol version
                            0x01)
        packet += struct.pack('B',     # Control code  
                            control_code)
        packet += struct.pack('B',     # Request code
                            RequestCode.NORMAL)
        packet += struct.pack('B',     # Station code (Red Alliance, Position 1)
                            StationCode.RED1)
        
        return packet
    
    def _process_robot_response(self, data: bytes):
        """
        Process received robot response packet
        
        Robot response format (minimum 7 bytes):
        [0-1] Packet sequence number
        [2]   Protocol version  
        [3]   Status/control echo
        [4]   Robot status flags
        [5]   Voltage integer part
        [6]   Voltage decimal part  
        [7+]  Extended data (CPU, RAM, etc.)
        """
        try:
            if len(data) < 7:
                return
                
            # Parse basic response
            packet_num = struct.unpack('>H', data[0:2])[0]
            protocol_ver = data[2]
            control_echo = data[3] 
            robot_status = data[4]
            voltage_int = data[5]
            voltage_dec = data[6]
            
            # Calculate voltage
            voltage = voltage_int + (voltage_dec / 256.0)
            
            # Extract status flags
            code_present = bool(robot_status & 0x20)  # Robot code running
            emergency_stopped = bool(control_echo & ControlBits.EMERGENCY_STOP)
            
            # Update status
            old_connected = self.status.connected
            
            self.status.connected = True
            self.status.voltage = voltage
            self.status.code_present = code_present
            self.status.emergency_stopped = emergency_stopped
            self.status.packet_count = packet_num
            self.status.enabled = self._enabled
            self.status.mode = self._mode
            
            # Log connection state changes
            if not old_connected:
                self.logger.info(f"Robot connected at {self.robot_address}")
                self.logger.info(f"Voltage: {voltage:.1f}V, Code: {'✅' if code_present else '❌'}")
            
            # Process extended data if present
            if len(data) > 9:
                self._parse_extended_data(data[8:])
            
            # Notify callbacks
            for callback in self._status_callbacks:
                try:
                    callback(self.status)
                except Exception as e:
                    self.logger.error(f"Status callback error: {e}")
                    
        except Exception as e:
            self.logger.error(f"Error processing robot response: {e}")
    
    def _parse_extended_data(self, data: bytes):
        """Parse extended robot status (CPU, RAM, CAN, etc.)"""
        # This would parse the extended robot status data
        # For now, we'll skip this complex parsing
        pass
    
    def _handle_communication_lost(self):
        """Handle loss of communication with robot"""
        self.logger.warning(f"Lost communication with robot")
        
        # Reset robot state to safe defaults
        old_connected = self.status.connected
        
        self.status.connected = False
        self.status.enabled = False  # Robot auto-disables on comm loss
        self.status.voltage = 0.0
        self.status.code_present = False
        self.status.emergency_stopped = False
        
        # Auto-disable when communication is lost (safety feature)
        self._enabled = False
        
        # Notify callbacks
        for callback in self._status_callbacks:
            try:
                callback(self.status)
            except Exception as e:
                self.logger.error(f"Status callback error: {e}")
    
    # Public control methods
    def set_team_number(self, team_number: int) -> bool:
        """Set team number and update robot address"""
        self.team_number = team_number
        self.robot_address = f"10.{team_number//100}.{team_number%100}.2"
        self.logger.info(f"Team number set to {team_number}, robot at {self.robot_address}")
        return True
    
    def set_robot_address(self, address: str) -> bool:
        """Set custom robot IP address"""
        self.robot_address = address
        self.logger.info(f"Robot address set to {address}")
        return True
    
    def enable_robot(self) -> bool:
        """Enable the robot (if conditions are met)"""
        if not self.status.connected:
            self.logger.warning("Cannot enable robot - no communication")
            return False
            
        if not self.status.code_present:
            self.logger.warning("Cannot enable robot - no robot code detected")
            return False
            
        if self.status.emergency_stopped:
            self.logger.warning("Cannot enable robot - emergency stopped")
            return False
        
        self._enabled = True
        self.logger.info(f"Robot enabled in {self._mode.name} mode")
        return True
    
    def disable_robot(self) -> bool:
        """Disable the robot"""
        self._enabled = False
        self.logger.info("Robot disabled")
        return True
    
    def set_teleop_mode(self) -> bool:
        """Set robot to teleoperated mode"""
        self._mode = ControlMode.TELEOP
        self.logger.info("Mode: Teleoperated")
        return True
    
    def set_autonomous_mode(self) -> bool:
        """Set robot to autonomous mode"""
        self._mode = ControlMode.AUTONOMOUS
        self.logger.info("Mode: Autonomous")
        return True
    
    def set_test_mode(self) -> bool:
        """Set robot to test mode"""
        self._mode = ControlMode.TEST
        self.logger.info("Mode: Test")
        return True
    
    def emergency_stop(self) -> bool:
        """Emergency stop the robot"""
        self._emergency_stopped = True
        self._enabled = False
        self.logger.warning("EMERGENCY STOP")
        return True
    
    def clear_emergency_stop(self) -> bool:
        """Clear emergency stop"""
        self._emergency_stopped = False
        self.logger.info("Emergency stop cleared")
        return True
    
    def get_status(self) -> Dict[str, Any]:
        """Get current robot status as dictionary"""
        return {
            'connected': self.status.connected,
            'robot_communications': self.status.connected,
            'enabled': self.status.enabled,
            'robot_enabled': self.status.enabled,
            'mode': self._mode.name.lower(),
            'control_mode': self._mode.name.lower(),
            'voltage': self.status.voltage,
            'robot_voltage': self.status.voltage,
            'code_present': self.status.code_present,
            'robot_code': self.status.code_present,
            'emergency_stopped': self.status.emergency_stopped,
            'can_be_enabled': (self.status.connected and 
                             self.status.code_present and 
                             not self.status.emergency_stopped),
            'team_number': self.team_number,
            'robot_address': self.robot_address,
            'packet_count': self.status.packet_count,
            'cpu_usage': self.status.cpu_usage,
            'ram_usage': self.status.ram_usage,
            'can_utilization': self.status.can_utilization
        }
    
    def get_mode_string(self) -> str:
        """Get current mode as string"""
        if self.status.emergency_stopped:
            return "Emergency Stopped"
        elif not self.status.connected:
            return "No Communication"
        elif not self.status.code_present:
            return "No Robot Code"
        elif self.status.enabled:
            return f"{self._mode.name} Enabled"
        else:
            return f"{self._mode.name} Disabled"
    
    def is_connected(self) -> bool:
        """Check if robot is connected"""
        return self.status.connected

# Factory function for compatibility
def get_driver_station(team_number: int = 1234) -> FRCDriverStation:
    """Create and return a FRC Driver Station instance"""
    ds = FRCDriverStation(team_number)
    ds.start()
    return ds

if __name__ == "__main__":
    # Test the driver station
    import signal
    import sys
    
    def signal_handler(sig, frame):
        print("\nShutting down...")
        ds.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    # Create driver station
    ds = FRCDriverStation(team_number=1234)
    
    # Add status callback for debugging
    def status_callback(status: RobotStatus):
        if status.connected:
            print(f"Robot: Enabled={status.enabled}, "
                  f"Voltage={status.voltage:.1f}V, "
                  f"Code={'✅' if status.code_present else '❌'}")
    
    ds.add_status_callback(status_callback)
    
    # Start communication
    if ds.start():
        print("Driver Station running. Press Ctrl+C to stop.")
        print("Testing enable/disable every 5 seconds...")
        
        # Test enable/disable cycle
        try:
            while True:
                time.sleep(5)
                if ds.status.connected:
                    if ds.status.enabled:
                        ds.disable_robot()
                    else:
                        ds.enable_robot()
        except KeyboardInterrupt:
            pass
    else:
        print("Failed to start driver station")
    
    ds.stop()