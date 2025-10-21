"""
Configuration and Constants
Central configuration for the FRC Web Driver Station server.
"""

import os

class Config:
    """Configuration settings for the FRC Web Driver Station"""
    
    # Server settings
    HTTP_PORT = 8080
    WEBSOCKET_PORT = 8765
    
    # FRC settings
    DEFAULT_TEAM_NUMBER = int(os.environ.get('TEAM_NUMBER', '1234'))
    
    # File paths
    WEB_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'web')
    
    # System monitoring
    SYSTEM_UPDATE_INTERVAL = 5  # seconds
    MAX_LOG_HISTORY = 500
    
    # WebSocket settings
    WEBSOCKET_HOST = '0.0.0.0'
    
    @classmethod
    def team_to_ip(cls, team: int) -> str:
        """Convert team number to robot IP address"""
        return f"10.{team // 100}.{team % 100}.2"
    
    @classmethod
    def get_robot_ip(cls) -> str:
        """Get the robot IP for the configured team"""
        return cls.team_to_ip(cls.DEFAULT_TEAM_NUMBER)