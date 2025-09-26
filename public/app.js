// Global variables
let currentUser = null;
let currentLocation = null;
let watchId = null;
let autoRetryIntervalId = null;
let todayStatus = null;
let cachedNearestOffice = { office: null, ts: 0 };
let fallbackTimeoutId = null;

// API base URL
const API_BASE = '/api';

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    // Check if user is already logged in
    const token = localStorage.getItem('authToken');
    if (token) {
        try {
            // Try to read role from JWT so we can show admin tab
            const payload = parseJwt(token);
            if (payload) {
                currentUser = { id: payload.userId, username: payload.username, email: payload.email, role: payload.role };
                setFacultyVisibilityByRole(payload.role);
                setActionButtonsVisibilityByRole(payload.role);
            }

            await loadUserStatus();
            showScreen('dashboard');
            startLocationTracking();
            loadTodayStatus();
            // fallback to default office if location not obtained shortly
            fallbackTimeoutId = setTimeout(() => { if (!currentLocation) useDefaultOfficeLocation(); }, 5000);
        } catch (error) {
            console.error('Auto-login failed:', error);
            localStorage.removeItem('authToken');
            showScreen('login');
        }
    } else {
        showScreen('login');
    }

    // Set up form event listeners
    setupEventListeners();
    
    // Hide loading screen if present
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        setTimeout(() => {
            loadingEl.classList.remove('active');
        }, 1000);
    }
}

function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Register form
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // Set default date range for history
    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    document.getElementById('startDate').value = lastWeek.toISOString().split('T')[0];
}

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showTab(tabId) {
    if (tabId === 'dashboard') {
        showScreen('dashboard');
        loadTodayStatus();
    } else if (tabId === 'history') {
        showScreen('history');
        loadAttendanceHistory();
    } else if (tabId === 'faculty') {
        showScreen('faculty');
        // set default date
        const today = new Date().toISOString().split('T')[0];
        const facDate = document.getElementById('facDate');
        if (facDate && !facDate.value) facDate.value = today;
        loadFacultyStatus();
    }
    
    // Update nav tab active state
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
}

// Authentication functions
function showLogin() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.form').forEach(form => form.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById('loginForm').classList.add('active');
}

function showRegister() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.form').forEach(form => form.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById('registerForm').classList.add('active');
}

async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            currentUser = data.user;
            setFacultyVisibilityByRole(currentUser.role);
            setActionButtonsVisibilityByRole(currentUser.role);
            showToast('Login successful!', 'success');
            showScreen('dashboard');
            startLocationTracking();
            loadTodayStatus();
            setTimeout(() => { if (!currentLocation) useDefaultOfficeLocation(); }, 5000);
            // Attempt auto check-in after login once location is available
            maybeAutoCheckIn();
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const role = document.getElementById('registerRole').value;
    
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password, role })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            currentUser = data.user;
            setFacultyVisibilityByRole(currentUser.role);
            setActionButtonsVisibilityByRole(currentUser.role);
            showToast('Registration successful!', 'success');
            showScreen('dashboard');
            startLocationTracking();
            loadTodayStatus();
            setTimeout(() => { if (!currentLocation) useDefaultOfficeLocation(); }, 5000);
            // Attempt auto check-in after registration once location is available
            maybeAutoCheckIn();
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

function logout() {
    localStorage.removeItem('authToken');
    currentUser = null;
    stopLocationTracking();
    if (autoRetryIntervalId) {
        clearInterval(autoRetryIntervalId);
        autoRetryIntervalId = null;
    }
    showScreen('login');
    showToast('Logged out successfully', 'success');
}
// Location tracking
function startLocationTracking() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by this browser. Using default campus location.', 'error');
        useDefaultOfficeLocation();
        return;
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
    };
    
    // Get initial position
    navigator.geolocation.getCurrentPosition(
        updateLocation,
        handleLocationError,
        options
    );
    
    // Watch position changes
    watchId = navigator.geolocation.watchPosition(
        updateLocation,
        handleLocationError,
        options
    );
}

function stopLocationTracking() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function updateLocation(position) {
    currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
    };
    
    const locationText = document.getElementById('locationText');
    const locationAccuracy = document.getElementById('locationAccuracy');
    
    if (locationText) {
        locationText.textContent = `📍 Location acquired (±${Math.round(position.coords.accuracy)}m)`;
    }
    
    if (locationAccuracy) {
        locationAccuracy.textContent = `Coordinates: ${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
    }

    // Clear any pending fallback to default office since we have a real fix
    if (fallbackTimeoutId) { clearTimeout(fallbackTimeoutId); fallbackTimeoutId = null; }
    // Try auto check-in when we get a good location
    maybeAutoCheckIn();
    // Also try auto check-out if leaving geofence
    maybeAutoCheckOut();
}

function handleLocationError(error) {
    let message = 'Location access denied';
    
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message = 'Location access denied. Please enable location services.';
            break;
        case error.POSITION_UNAVAILABLE:
            message = 'Location information unavailable.';
            break;
        case error.TIMEOUT:
            message = 'Location request timed out.';
            break;
    }
    
    document.getElementById('locationText').textContent = `❌ ${message}. Using default campus location.`;
    // fallback to default office location on error
    useDefaultOfficeLocation();
    showToast(message, 'error');
}

// Manual refresh to force using device current location
function refreshLocation() {
    try {
        if (!navigator.geolocation) {
            showToast('Geolocation not supported. Using default campus location.', 'error');
            useDefaultOfficeLocation();
            return;
        }
        if (fallbackTimeoutId) { clearTimeout(fallbackTimeoutId); fallbackTimeoutId = null; }
        const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
        navigator.geolocation.getCurrentPosition(updateLocation, handleLocationError, opts);
        showToast('Requesting current location...', 'info');
    } catch (e) {
        useDefaultOfficeLocation();
    }
}

// Attendance functions
async function checkIn(silent = false) {
    if (!currentLocation) {
        if (!silent) showToast('Please wait for location to be acquired', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/checkin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                locationName: 'Office Location'
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (!silent) showToast(data.message, 'success');
            loadTodayStatus();
            markAutoCheckInAttempted();
        } else {
            if (!silent) {
                if (response.status === 403) {
                    showToast('Only students can check in.', 'error');
                }
                showToast(data.error || 'Check-in failed', 'error');
                if (data.distance && data.allowedRadius) {
                    showToast(`You are ${data.distance}m away. Required: within ${data.allowedRadius}m`, 'error');
                }
            }
            // If auto attempt failed because out of radius, do not spam
            markAutoCheckInAttempted();
        }
    } catch (error) {
        if (!silent) showToast('Network error. Please try again.', 'error');
    }
}

// Auto check-in logic
function todayKey(suffix) {
    const d = new Date().toISOString().split('T')[0];
    return `auto_${suffix}_${d}`;
}

function markAutoCheckInAttempted() {
    try { localStorage.setItem(todayKey('checkin_attempted'), '1'); } catch {}
}

function hasAutoCheckInAttempted() {
    try { return localStorage.getItem(todayKey('checkin_attempted')) === '1'; } catch { return true; }
}

async function maybeAutoCheckIn() {
    // Only attempt once per day
    if (hasAutoCheckInAttempted()) return;
    // Require a reasonably accurate fix (< 100m) before auto-attempt
    if (!currentLocation || (currentLocation.accuracy != null && currentLocation.accuracy > 100)) return;
    try {
        // Check today's status first
        const resp = await fetch(`${API_BASE}/status`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!resp.ok) return;
        const status = await resp.json();
        if (!status.checkedIn) {
            // Silent auto check-in; server will validate geofence
            await checkIn(true);
        } else {
            markAutoCheckInAttempted();
        }
    } catch (_) {
        // Ignore errors silently
    }
}

async function checkOut() {
    if (!currentLocation) {
        showToast('Please wait for location to be acquired', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(`${data.message} (${data.totalHours} hours)`, 'success');
            loadTodayStatus();
        } else {
            showToast(data.error || 'Check-out failed', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

async function loadTodayStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateStatusDisplay(data);
            // If not already scheduled, set up periodic re-attempt every 10 minutes
            if (!autoRetryIntervalId) {
                autoRetryIntervalId = setInterval(() => {
                    maybeAutoCheckIn();
                    maybeAutoCheckOut();
                }, 10 * 60 * 1000);
            }
        }
    } catch (error) {
        console.error('Failed to load status:', error);
    }
}

function updateStatusDisplay(status) {
    // store globally for auto checkout logic
    todayStatus = status;
    const statusDate = document.getElementById('statusDate');
    const checkInStatus = document.getElementById('checkInStatus');
    const checkOutStatus = document.getElementById('checkOutStatus');
    const locationStatus = document.getElementById('locationStatus');
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    
    // Update date
    statusDate.textContent = new Date(status.date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Update check-in status
    if (status.checkedIn) {
        checkInStatus.textContent = new Date(status.checkInTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        checkInBtn.disabled = true;
        checkInBtn.textContent = '✅ Checked In';
    } else {
        checkInStatus.textContent = 'Not checked in';
        checkInBtn.disabled = false;
        checkInBtn.textContent = '📍 Check In';
    }
    
    // Update check-out status
    if (status.checkedOut) {
        checkOutStatus.textContent = new Date(status.checkOutTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        checkOutBtn.disabled = true;
        checkOutBtn.textContent = '✅ Checked Out';
    } else if (status.checkedIn) {
        checkOutStatus.textContent = 'Not checked out';
        checkOutBtn.disabled = false;
        checkOutBtn.textContent = '📤 Check Out';
    } else {
        checkOutStatus.textContent = 'Not checked out';
        checkOutBtn.disabled = true;
        checkOutBtn.textContent = '📤 Check Out';
    }
    
    // Update location
    locationStatus.textContent = status.location || '-';
}

async function loadAttendanceHistory() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    try {
        let url = `${API_BASE}/attendance`;
        if (startDate && endDate) {
            url += `?startDate=${startDate}&endDate=${endDate}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayAttendanceHistory(data);
        } else {
            showToast('Failed to load attendance history', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

function displayAttendanceHistory(records) {
    const historyList = document.getElementById('historyList');
    
    if (records.length === 0) {
        historyList.innerHTML = '<div class="history-item"><p>No attendance records found for the selected period.</p></div>';
        return;
    }
    
    historyList.innerHTML = records.map(record => {
        const date = new Date(record.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        
        const checkIn = record.check_in_time ? 
            new Date(record.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 
            'Not checked in';
            
        const checkOut = record.check_out_time ? 
            new Date(record.check_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 
            'Not checked out';
            
        const totalHours = record.check_in_time && record.check_out_time ?
            ((new Date(record.check_out_time) - new Date(record.check_in_time)) / (1000 * 60 * 60)).toFixed(2) :
            'Incomplete';
        
        return `
            <div class="history-item">
                <div class="history-date">${date}</div>
                <div class="history-times">
                    <span>In: ${checkIn}</span>
                    <span>Out: ${checkOut}</span>
                    <span>Hours: ${totalHours}</span>
                </div>
                <div class="history-location">📍 ${record.location_name || 'Office'}</div>
            </div>
        `;
    }).join('');
}

async function loadUserStatus() {
    const response = await fetch(`${API_BASE}/status`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
    });
    
    if (!response.ok) {
        throw new Error('Failed to load user status');
    }
    
    return response.json();
}

// Utility functions
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Service Worker Registration (for PWA functionality)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// ---------- Faculty UI logic ----------
function setFacultyVisibilityByRole(role) {
    const facTab = document.getElementById('facultyNavTab');
    if (!facTab) return;
    const r = (role || '').toLowerCase();
    facTab.style.display = (r === 'faculty') ? '' : 'none';
}

async function loadFacultyStatus() {
    const facDate = document.getElementById('facDate');
    const date = facDate && facDate.value ? facDate.value : new Date().toISOString().split('T')[0];
    const tbody = document.getElementById('facultyTbody');
    try {
        const res = await fetch(`${API_BASE}/faculty/attendance/status?date=${encodeURIComponent(date)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="4" class="muted">${data.error || 'Failed to load'}</td></tr>`; return; }
        if (!Array.isArray(data) || !data.length) { tbody.innerHTML = `<tr><td colspan="4" class="muted">No data</td></tr>`; return; }
        tbody.innerHTML = data.map(r => `
            <tr>
                <td>${r.username}</td>
                <td>${r.email}</td>
                <td>${r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '-'}</td>
                <td>${r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '-'}</td>
            </tr>
        `).join('');
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="muted">Network error</td></tr>`;
    }
}

// Use default office location when geolocation is unavailable
async function useDefaultOfficeLocation() {
    try {
        const res = await fetch(`${API_BASE}/office`);
        if (!res.ok) return;
        const office = await res.json();
        currentLocation = { latitude: office.latitude, longitude: office.longitude, accuracy: office.radius || 100 };
        const locationText = document.getElementById('locationText');
        const locationAccuracy = document.getElementById('locationAccuracy');
        if (locationText) locationText.textContent = `📍 Using default campus location (${office.name})`;
        if (locationAccuracy) locationAccuracy.textContent = `Coordinates: ${office.latitude.toFixed(6)}, ${office.longitude.toFixed(6)}`;
        maybeAutoCheckIn();
    } catch (_) { /* ignore */ }
}

// Force use of Presidency University (default office) coordinates for immediate check-in
async function checkInWithCampusLocation() {
    try {
        const res = await fetch(`${API_BASE}/office`);
        if (!res.ok) { showToast('Failed to load campus coordinates', 'error'); return; }
        const office = await res.json();
        currentLocation = { latitude: office.latitude, longitude: office.longitude, accuracy: office.radius || 100 };
        await checkIn(false);
    } catch (e) {
        showToast('Network error. Please try again.', 'error');
    }
}

// ---- Locations Management ----
async function loadLocations() {
    try {
        const res = await fetch(`${API_BASE}/locations`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        const tbody = document.getElementById('locationsTbody');
        if (!tbody) return;
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load locations</td></tr>`;
            return;
        }
        if (!data.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="muted">No locations found.</td></tr>`;
            return;
        }
        tbody.innerHTML = data.map(loc => `
            <tr>
                <td>${loc.name}</td>
                <td>${(+loc.latitude).toFixed(6)}</td>
                <td>${(+loc.longitude).toFixed(6)}</td>
                <td>${loc.radius}</td>
                <td>
                    ${isAdmin() ? `
                    <button class="btn btn-primary" onclick="promptUpdateLocation('${loc.id}', '${loc.name}', ${loc.latitude}, ${loc.longitude}, ${loc.radius})">Edit</button>
                    <button class="btn btn-danger" onclick="deleteLocation('${loc.id}')">Delete</button>
                    ` : '-'}
                </td>
            </tr>
        `).join('');
    } catch (e) {
        const tbody = document.getElementById('locationsTbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load locations</td></tr>`;
        showToast('Failed to load locations', 'error');
    }
}

function isAdmin() { return (currentUser?.role || '').toLowerCase() === 'admin'; }

async function createLocation() {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    const name = document.getElementById('locName').value.trim();
    const latitude = parseFloat(document.getElementById('locLat').value);
    const longitude = parseFloat(document.getElementById('locLng').value);
    const radius = parseInt(document.getElementById('locRadius').value || '100', 10);
    if (!name || Number.isNaN(latitude) || Number.isNaN(longitude)) { showToast('Please fill name, lat, lng', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/locations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ name, latitude, longitude, radius })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Location added', 'success');
            document.getElementById('locName').value='';
            document.getElementById('locLat').value='';
            document.getElementById('locLng').value='';
            document.getElementById('locRadius').value='';
            loadLocations();
        } else {
            showToast(data.error || 'Failed to add location', 'error');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

function promptUpdateLocation(id, name, latitude, longitude, radius) {
    const newName = prompt('Location name:', name);
    const newLat = parseFloat(prompt('Latitude:', latitude));
    const newLng = parseFloat(prompt('Longitude:', longitude));
    const newRadius = parseInt(prompt('Radius (m):', radius), 10);
    updateLocation(id, { name: newName, latitude: newLat, longitude: newLng, radius: newRadius });
}

async function updateLocation(id, payload) {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/locations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) { showToast('Location updated', 'success'); loadLocations(); }
        else { showToast(data.error || 'Failed to update', 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

async function deleteLocation(id) {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    if (!confirm('Delete this location?')) return;
    try {
        const res = await fetch(`${API_BASE}/locations/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        if (res.ok) { showToast('Location deleted', 'success'); loadLocations(); }
        else { showToast(data.error || 'Failed to delete', 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

// ---- Employees Management ----
async function loadEmployees() {
    try {
        const res = await fetch(`${API_BASE}/employees`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        const tbody = document.getElementById('employeesTbody');
        if (!tbody) return;
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="5" class="muted">${data.error || 'Failed to load employees'}</td></tr>`; return; }
        if (!data.length) { tbody.innerHTML = `<tr><td colspan="5" class="muted">No employees found.</td></tr>`; return; }
        tbody.innerHTML = data.map(emp => `
            <tr>
                <td>${emp.username}</td>
                <td>${emp.email}</td>
                <td>${emp.role}</td>
                <td>${emp.id}</td>
                <td>
                    ${isAdmin() ? `
                    <button class="btn btn-primary" onclick="promptUpdateEmployee('${emp.id}', '${emp.username}', '${emp.email}', '${emp.role}')">Edit</button>
                    <button class="btn btn-danger" onclick="deleteEmployee('${emp.id}')">Delete</button>
                    ` : '-'}
                </td>
            </tr>
        `).join('');
    } catch (e) {
        const tbody = document.getElementById('employeesTbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load employees</td></tr>`;
        showToast('Failed to load employees', 'error');
    }
}

async function createEmployee() {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    const username = document.getElementById('empUsername').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const password = document.getElementById('empPassword').value;
    const role = document.getElementById('empRole').value;
    if (!username || !email || !password) { showToast('Fill username, email, password', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/employees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ username, email, password, role })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Employee added', 'success');
            document.getElementById('empUsername').value='';
            document.getElementById('empEmail').value='';
            document.getElementById('empPassword').value='';
            document.getElementById('empRole').value='student';
            loadEmployees();
        } else {
            showToast(data.error || 'Failed to add employee', 'error');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

function promptUpdateEmployee(id, username, email, role) {
    const newUsername = prompt('Username:', username);
    const newEmail = prompt('Email:', email);
    const newRole = prompt("Role (student|faculty|admin):", role);
    const newPassword = prompt('New Password (leave blank to keep same):', '');
    const payload = {};
    if (newUsername && newUsername !== username) payload.username = newUsername;
    if (newEmail && newEmail !== email) payload.email = newEmail;
    if (newRole && newRole !== role) payload.role = newRole;
    if (newPassword) payload.password = newPassword;
    if (Object.keys(payload).length === 0) return;
    updateEmployee(id, payload);
}

async function updateEmployee(id, payload) {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/employees/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) { showToast('Employee updated', 'success'); loadEmployees(); }
        else { showToast(data.error || 'Failed to update', 'error'); }
    } catch (e) { showToast('Network error', 'error'); }
}

async function deleteEmployee(id) {
    if (!isAdmin()) { showToast('Admin only action', 'error'); return; }
    if (!confirm('Delete this employee?')) return;
    try {
        const res = await fetch(`${API_BASE}/employees/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        if (res.ok) { showToast('Employee deleted', 'success'); loadEmployees(); }
        else { showToast(data.error || 'Failed to delete', 'error'); }
    } catch (e) { showToast('Network error', 'error'); }
}

// ---- Attendance Summary ----
async function loadAttendanceSummary() {
    const userId = document.getElementById('sumUserId').value.trim();
    const startDate = document.getElementById('sumStart').value;
    const endDate = document.getElementById('sumEnd').value;
    const params = new URLSearchParams();
    if (userId) params.append('userId', userId);
    if (startDate && endDate) { params.append('startDate', startDate); params.append('endDate', endDate); }
    try {
        const res = await fetch(`${API_BASE}/attendance/summary?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        const target = document.getElementById('summaryResult');
        if (!res.ok) { target.textContent = data.error || 'Failed to load summary'; return; }
        target.innerHTML = `
            <div><strong>User:</strong> ${data.userId}</div>
            <div><strong>From:</strong> ${data.startDate || '-'} <strong>To:</strong> ${data.endDate || '-'}</div>
            <div><strong>Total Hours:</strong> ${data.totalHours}</div>
            <div><strong>Days Count:</strong> ${data.daysCount}</div>
        `;
    } catch (e) { showToast('Network error', 'error'); }
}

// Parse JWT without validation (client-side convenience only)
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) { return null; }
}
