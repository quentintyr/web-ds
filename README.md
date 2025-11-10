
# FRC Drive Station Web Dashboard
### Dashboard when the Robot is not connected
![alt text](https://github.com/quentintyr/web-ds/blob/master/docs/dashboard.png?raw=true)


This project provides a simple web-based dashboard for monitoring and controlling an FRC robot. It displays real-time telemetry and subsystem status using interactive widgets with the custom Logging System
```
https://github.com/quentintyr/web-ds-logger
```
which is currently only tested in c++

### To display data on the dashboard, use the following widget IDs in NetworkTables

**Hardware Widgets:**
- `USSensorLeft`  (Ultrasonic Left)
- `USSensorRight` (Ultrasonic Right)
- `IRSensorLeft`     (IR Left)
- `IRSensorRight`    (IR Right)
- `lidarDistance`       (Lidar)
- `Battery`     (Battery)

**Subsystem Widgets:**
- `extenderStatus`    (Extender)
- `elevatorPosition`    (Elevator)
- `gripperStatus`     (Gripper)
- `carriagePosition`         (Arm/Carriage)
- `lineFollowerSensor`      (Line Follower / Vision)

**Robot Mode**

Periodic HTTP requests to /api/ds?action=status. The backend responds with a JSON object containing the robot's current mode (e.g., "teleop", "autonomous", "test"), which is extracted from the robot status

### Example Code
The Dashboard needs Periodic Updates. Recommended to Update in RobotPeriodic()
```
void UpdateLogging(SensorManager *sensorManager)
{
    // check battery voltage
    auto dashboard = nt::NetworkTableInstance::GetDefault().GetTable("Dashboard");
    double batteryVoltage = frc::RobotController::GetInputVoltage();
    dashboard->PutNumber("Battery", batteryVoltage);

    if (sensorManager && sensorManager->GetUltrasonicSubsystem())
    {
        auto ultraSonic = sensorManager->GetUltrasonicSubsystem();
        dashboard->PutNumber("USSensorLeft", roundTo2Decimals(ultraSonic->GetLeftDistance()));
        dashboard->PutNumber("USSensorRight", roundTo2Decimals(ultraSonic->GetRightDistance()));
    }

    if (sensorManager && sensorManager->GetIRRangeSubsystem())
    {
        auto irSensor = sensorManager->GetIRRangeSubsystem();
        dashboard->PutNumber("IRSensorLeft", roundTo2Decimals(irSensor->GetIRLeftDistance()));
        dashboard->PutNumber("IRSensorRight", roundTo2Decimals(irSensor->GetIRRightDistance()));
    }

    if (sensorManager)
    {
        auto lidarSensor = sensorManager->GetLidarSubsystem();
        if (lidarSensor)
        {
            dashboard->PutNumber("lidarDistance", roundTo2Decimals(lidarSensor->GetDistanceAtAngle(0)));
        }
    }
}
```

### Joysticks
Can be displayed when pressing "J" on the Keyboard, or each restart

### Issues
The FRC Shuffleboard can start to freeze and / or have long loading times when the log has to many entries.
