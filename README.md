# Geolocation-Based Attendance Tracking App

A modern, mobile-first Progressive Web Application (PWA) for tracking employee attendance using geolocation technology.

## Features

### 🎯 Core Functionality
- **Geolocation-based Check-in/Check-out**: Employees can only mark attendance when within the designated office radius
- **Real-time Location Tracking**: Continuous location monitoring with accuracy indicators
- **User Authentication**: Secure login and registration system
- **Attendance History**: View detailed attendance records with filtering options
- **Mobile-First Design**: Responsive design optimized for mobile devices

### 📱 Progressive Web App (PWA)
- **Offline Support**: Works even when internet connection is poor
- **Install on Mobile**: Can be installed on mobile devices like a native app
- **Push Notifications**: (Ready for implementation)
- **Background Sync**: Syncs data when connection is restored

### 🔒 Security Features
- JWT-based authentication
- Password hashing with bcrypt
- Location verification within office radius
- Secure API endpoints

## Technology Stack

### Backend
- **Node.js** with Express.js
- **SQLite** database for data storage
- **JWT** for authentication
- **bcryptjs** for password hashing

### Frontend
- **Vanilla JavaScript** (ES6+)
- **CSS3** with modern features (Grid, Flexbox, CSS Variables)
- **HTML5** with semantic markup
- **Service Worker** for PWA functionality

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Steps

1. **Clone/Navigate to the project directory**
   ```bash
   cd C:\Users\viswa\CascadeProjects\GeolocationAttendanceApp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Access the application**
   Open your browser and go to: `http://localhost:3000`

### Development Mode
For development with auto-restart:
```bash
npm run dev
```

## Usage

### For Employees

1. **Registration/Login**
   - Register with username, email, and password
   - Login with username/email and password

2. **Check-in Process**
   - Allow location access when prompted
   - Ensure you're within the office radius (100m by default)
   - Tap "Check In" button
   - System verifies location and records attendance

3. **Check-out Process**
   - Tap "Check Out" button when leaving
   - System records check-out time and calculates total hours

4. **View History**
   - Navigate to "History" tab
   - Filter records by date range
   - View detailed attendance records

### For Administrators

The current version includes basic admin functionality. Future versions will include:
- Admin dashboard for viewing all employee attendance
- Office location management
- Attendance reports and analytics
- Employee management

## Configuration

### Office Location Settings
The default office location is set in `server.js`:
```javascript
// Default office coordinates (New York City example)
latitude: 40.7128
longitude: -74.0060
radius: 100 // meters
```

To change the office location:
1. Update the coordinates in the database initialization section
2. Restart the server

### Security Settings
- Change the JWT secret in production:
  ```javascript
  const JWT_SECRET = 'your-secure-secret-key';
  ```

## API Endpoints

### Authentication
- `POST /api/register` - User registration
- `POST /api/login` - User login

### Attendance
- `POST /api/checkin` - Check in (requires location)
- `POST /api/checkout` - Check out
- `GET /api/attendance` - Get attendance records
- `GET /api/status` - Get today's attendance status

## Database Schema

### Users Table
- `id` - Unique user identifier
- `username` - User's username
- `email` - User's email address
- `password` - Hashed password
- `role` - User role (employee/admin)
- `created_at` - Account creation timestamp

### Attendance Table
- `id` - Unique attendance record identifier
- `user_id` - Reference to user
- `check_in_time` - Check-in timestamp
- `check_out_time` - Check-out timestamp
- `latitude` - Location latitude
- `longitude` - Location longitude
- `location_name` - Human-readable location name
- `status` - Attendance status
- `date` - Attendance date
- `created_at` - Record creation timestamp

### Office Locations Table
- `id` - Location identifier
- `name` - Location name
- `latitude` - Office latitude
- `longitude` - Office longitude
- `radius` - Allowed radius in meters
- `created_at` - Creation timestamp

## Mobile Installation

### Android
1. Open the app in Chrome
2. Tap the menu (three dots)
3. Select "Add to Home screen"
4. Follow the prompts

### iOS
1. Open the app in Safari
2. Tap the Share button
3. Select "Add to Home Screen"
4. Follow the prompts

## Browser Compatibility

- **Chrome** 60+ ✅
- **Firefox** 55+ ✅
- **Safari** 11+ ✅
- **Edge** 79+ ✅

## Geolocation Requirements

- **HTTPS**: Geolocation requires HTTPS in production
- **User Permission**: Users must grant location access
- **Accuracy**: GPS accuracy varies (typically 3-50 meters)

## Future Enhancements

### Planned Features
- [ ] Admin dashboard
- [ ] Push notifications for check-in reminders
- [ ] Multiple office locations support
- [ ] Attendance analytics and reports
- [ ] Integration with HR systems
- [ ] Facial recognition for additional security
- [ ] Offline attendance with sync
- [ ] Geofencing improvements
- [ ] Time tracking with break management

### Technical Improvements
- [ ] Database migration system
- [ ] API rate limiting
- [ ] Enhanced error handling
- [ ] Unit and integration tests
- [ ] Docker containerization
- [ ] Cloud deployment guides

## Troubleshooting

### Common Issues

1. **Location not working**
   - Ensure HTTPS is enabled
   - Check browser location permissions
   - Verify GPS is enabled on device

2. **Can't check in**
   - Verify you're within office radius
   - Check location accuracy
   - Ensure you haven't already checked in

3. **App not installing**
   - Use supported browser
   - Ensure PWA requirements are met
   - Clear browser cache

### Support
For technical support or feature requests, please create an issue in the project repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Note**: This application is designed for demonstration purposes. For production use, consider additional security measures, scalability improvements, and compliance with local privacy laws regarding location tracking.
