import React, { useState, useEffect } from 'react';
import { Clock, Users, FileText, LogOut, Shield, Database, Download } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Get Supabase credentials from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function App() {
  // State management
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [view, setView] = useState('login');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);
  const [timeEntries, setTimeEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [adminView, setAdminView] = useState('dashboard');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [exportStartDate, setExportStartDate] = useState(
    new Date(new Date().setDate(new Date().getDate() - 14)).toISOString().split('T')[0]
  );
  const [exportEndDate, setExportEndDate] = useState(new Date().toISOString().split('T')[0]);

  const [punchConfirmation, setPunchConfirmation] = useState(null);
  // Alert helper
  const showAlert = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 4000);
  };

  const showPunchConfirmation = (action, breakType = null, wasOnBreak = false) => {
    let message = '';
    let icon = '';
    
    if (action === 'in') {
      if (breakType === 'meal') {
        message = 'Meal Break Started';
        icon = '🍽️';
      } else if (breakType === 'rest') {
        message = 'Rest Break Started';
        icon = '☕';
      } else {
        message = 'Clocked In';
        icon = '✅';
      }
    } else {
      if (wasOnBreak) {
        message = 'Break Ended - Resumed Work';
        icon = '💼';
      } else {
        message = 'Clocked Out';
        icon = '👋';
      }
    }

    setPunchConfirmation({ message, icon, time: new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })});

    setTimeout(() => setPunchConfirmation(null), 2000);
  };

  // Login handler
  const handleLogin = async () => {
    if (!employeeNumber) {
      showAlert('error', 'Please enter employee number');
      return;
    }

    if (employeeNumber.toLowerCase() === 'admin' && (!password || password !== '9999')) {
      showAlert('error', 'Admin requires password');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('employee_login', {
        p_employee_number: employeeNumber,
        p_password: password || null
      });

      if (error) throw error;

      const result = data;
      
      if (!result.success) {
        showAlert('error', result.error);
        setLoading(false);
        return;
      }

      setCurrentUser({
        id: result.employee_id,
        name: result.name,
        employeeNumber: result.employee_number,
        role: result.role,
        hourlyRate: result.hourly_rate
      });
      setSessionToken(result.session_token);
      setEmployeeNumber('');
      setPassword('');

      if (result.role === 'admin') {
        await loadAdminData();
        setView('admin');
      } else {
        await loadEmployeeData(result.employee_id);
        setView('employee');
      }

      showAlert('success', `Welcome, ${result.name}!`);
    } catch (error) {
      showAlert('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    if (sessionToken) {
      await supabase.from('sessions').delete().eq('session_token', sessionToken);
    }
    setCurrentUser(null);
    setSessionToken(null);
    setView('login');
    setTimeEntries([]);
    setEmployees([]);
  };

  // Load employee data
  const loadEmployeeData = async (employeeId) => {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('clock_in', today + 'T00:00:00')
      .order('clock_in', { ascending: false });

    if (data) setTimeEntries(data);
  };

  // Load admin data
  const loadAdminData = async () => {
    const [entriesResult, employeesResult] = await Promise.all([
      supabase.from('time_entries').select('*').order('clock_in', { ascending: false }).limit(100),
      supabase.from('employees').select('*').eq('active', true).order('name')
    ]);

    if (entriesResult.data) setTimeEntries(entriesResult.data);
    if (employeesResult.data) setEmployees(employeesResult.data);
  };

  // Clock in/out handler
  const handleClockAction = async (action, breakType = null) => {
    setLoading(true);
    
    // Determine if currently on break before making changes
    const openEntry = timeEntries.find(e => 
      e.employee_id === currentUser.id && !e.clock_out
    );
    const wasOnBreak = openEntry?.break_type !== null && openEntry?.break_type !== undefined;
    
    try {
      if (action === 'in') {
        // Check if there's an open work entry when starting a break
        if (breakType) {
          const openWork = timeEntries.find(e => 
            e.employee_id === currentUser.id && 
            !e.clock_out && 
            !e.break_type
          );

          if (openWork) {
            await supabase
              .from('time_entries')
              .update({ clock_out: new Date().toISOString() })
              .eq('id', openWork.id);
          }
        }

        // Create new entry
        const { error } = await supabase.from('time_entries').insert({
          employee_id: currentUser.id,
          clock_in: new Date().toISOString(),
          break_type: breakType
        });

        if (error) throw error;
        showPunchConfirmation('in', breakType, false);
      } else {
        // Clock out
        if (!openEntry) {
          showAlert('error', 'No open time entry');
          setLoading(false);
          return;
        }

        // Auto-logout after 60 seconds of inactivity
useEffect(() => {
  if (view === 'employee' && currentUser) {
    let timer = null;
    
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        showAlert('info', 'Auto-logout due to inactivity');
        setTimeout(() => handleLogout(), 500);
      }, 60000);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'mousemove'];
    events.forEach(event => window.addEventListener(event, resetTimer));
    resetTimer();

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }
}, [view, currentUser]);

// Keyboard shortcuts
useEffect(() => {
  const handleKeyPress = (e) => {
    if (view !== 'employee' || loading || e.target.tagName === 'INPUT') return;

    const status = getCurrentStatus(currentUser?.id);
    const isClockedIn = status !== 'Clocked Out';
    const isOnBreak = status.includes('Break');

    switch(e.key) {
      case '1':
        if (!isClockedIn || (!isOnBreak && isClockedIn)) handleClockAction(isClockedIn ? 'out' : 'in');
        break;
      case '2':
        if (isClockedIn && !isOnBreak) handleClockAction('in', 'meal');
        break;
      case '3':
        if (isClockedIn && !isOnBreak) handleClockAction('in', 'rest');
        break;
      case '4':
        if (isOnBreak) handleClockAction('out');
        break;
      case '0':
      case 'Escape':
        handleLogout();
        break;
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, [view, currentUser, loading, timeEntries]);

        const { error } = await supabase
          .from('time_entries')
          .update({ clock_out: new Date().toISOString() })
          .eq('id', openEntry.id);

        if (error) throw error;

        // If ending a break, clock back into work
        if (openEntry.break_type) {
          await supabase.from('time_entries').insert({
            employee_id: currentUser.id,
            clock_in: new Date().toISOString(),
            break_type: null
          });
        }
        
        showPunchConfirmation('out', null, wasOnBreak);
      }

      await loadEmployeeData(currentUser.id);
    } catch (error) {
      showAlert('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Get current status
  const getCurrentStatus = (employeeId) => {
    const openEntry = timeEntries.find(e => e.employee_id === employeeId && !e.clock_out);
    if (!openEntry) return 'Clocked Out';
    if (openEntry.break_type === 'meal') return 'Meal Break';
    if (openEntry.break_type === 'rest') return 'Rest Break';
    return 'Working';
  };

  // Format time
  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    return new Date(dateString).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // Format duration
  // Calculate daily and weekly progress
  const calculateProgress = (employeeId) => {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = timeEntries.filter(e => 
      e.employee_id === employeeId && 
      e.clock_in.startsWith(today)
    );

    // Calculate today's hours (work time only, excluding breaks)
    let todayHours = 0;
    let currentlyWorking = false;
    let currentWorkStart = null;

    todayEntries.forEach(entry => {
      if (!entry.break_type) { // Only count work time
        if (entry.clock_out) {
          const hours = (new Date(entry.clock_out) - new Date(entry.clock_in)) / (1000 * 60 * 60);
          todayHours += hours;
        } else {
          // Currently clocked in
          currentlyWorking = true;
          currentWorkStart = entry.clock_in;
          const hours = (new Date() - new Date(entry.clock_in)) / (1000 * 60 * 60);
          todayHours += hours;
        }
      }
    });

    // Calculate weekly hours (work time only)
    const weekStart = getWeekStart(today);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekEntries = timeEntries.filter(e => {
      const entryDate = new Date(e.clock_in);
      return e.employee_id === employeeId && 
             entryDate >= new Date(weekStart) && 
             entryDate < weekEnd;
    });

    let weekHours = 0;
    weekEntries.forEach(entry => {
      if (!entry.break_type && entry.clock_out) {
        const hours = (new Date(entry.clock_out) - new Date(entry.clock_in)) / (1000 * 60 * 60);
        weekHours += hours;
      }
    });

    // Add current work session to weekly total if working
    if (currentlyWorking && currentWorkStart) {
      const currentHours = (new Date() - new Date(currentWorkStart)) / (1000 * 60 * 60);
      weekHours += currentHours;
    }

    // Calculate expected hours based on schedule (7am-4pm with 1hr lunch = 8hrs/day)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, etc.
    const currentTime = now.getHours() + now.getMinutes() / 60;

    // Calculate how many hours should be worked today based on time
    let expectedTodayHours = 0;
    if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Monday-Friday
      if (currentTime < 7) {
        expectedTodayHours = 0; // Before work starts
      } else if (currentTime <= 12) {
        // 7am-12pm: 5 hours max
        expectedTodayHours = Math.min(currentTime - 7, 5);
      } else if (currentTime <= 13) {
        // 12pm-1pm: lunch hour, stay at 5 hours
        expectedTodayHours = 5;
      } else if (currentTime < 16) {
        // 1pm-4pm: add hours after lunch
        expectedTodayHours = 5 + (currentTime - 13);
      } else {
        // After 4pm: full 8 hours
        expectedTodayHours = 8;
      }
    }

    // Calculate expected weekly hours (days worked this week * 8)
    let completedWorkDays = 0;
    for (let d = 0; d < 7; d++) {
      const checkDate = new Date(weekStart);
      checkDate.setDate(checkDate.getDate() + d);
      const checkDay = checkDate.getDay();
      
      if (checkDay >= 1 && checkDay <= 5) { // Monday-Friday
        if (checkDate < now) {
          completedWorkDays++;
        } else if (checkDate.toDateString() === now.toDateString()) {
          // Today counts as partial day based on time
          completedWorkDays += expectedTodayHours / 8;
        }
      }
    }

    const expectedWeekHours = completedWorkDays * 8;

    return {
      todayHours,
      expectedTodayHours,
      todayDifference: todayHours - expectedTodayHours,
      weekHours,
      expectedWeekHours,
      weekDifference: weekHours - expectedWeekHours,
      currentlyWorking
    };
  };

  const formatHoursMinutes = (hours) => {
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    return `${h}h ${m}m`;
  };

  const formatDuration = (start, end) => {
    if (!end) return 'In Progress';
    const hours = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
    return `${hours.toFixed(2)} hrs`;
  };

  // Export to QuickBooks
  const exportToQuickBooks = () => {
    const start = new Date(exportStartDate);
    const end = new Date(exportEndDate);
    end.setHours(23, 59, 59, 999);

    const exportEntries = timeEntries.filter(e => {
      const entryDate = new Date(e.clock_in);
      return e.clock_out && !e.break_type && entryDate >= start && entryDate <= end;
    });

    const groupedData = {};
    exportEntries.forEach(entry => {
      const employee = employees.find(emp => emp.id === entry.employee_id);
      if (!employee) return;

      const date = new Date(entry.clock_in).toLocaleDateString('en-US');
      const key = `${employee.id}_${date}`;

      if (!groupedData[key]) {
        groupedData[key] = { employeeName: employee.name, date: date, hours: 0 };
      }

      const hours = (new Date(entry.clock_out) - new Date(entry.clock_in)) / (1000 * 60 * 60);
      groupedData[key].hours += hours;
    });

    let csv = '!TIMERHDR\tVER\tREL\tCOMPANYNAME\tIMPORTEDBEFORE\n';
    csv += '!TIMERHDR\t8\t0\t\tN\n';
    csv += '!TIMEACT\tDATE\tJOB\tEMP\tITEM\tPITEM\tDURATION\tNOTE\n';

    Object.values(groupedData).forEach(data => {
      const formattedDate = new Date(data.date).toLocaleDateString('en-US', { 
        month: '2-digit', day: '2-digit', year: 'numeric' 
      });
      csv += `TIMEACT\t${formattedDate}\t\t${data.employeeName}\t\t\t${data.hours.toFixed(2)}\tImported from TimeClock\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `quickbooks_time_${exportStartDate}_to_${exportEndDate}.iif`;
    link.click();

    showAlert('success', 'QuickBooks file downloaded!');
  };

  // Export to CSV
  const exportToCSV = () => {
    const start = new Date(exportStartDate);
    const end = new Date(exportEndDate);
    end.setHours(23, 59, 59, 999);

    const exportEntries = timeEntries.filter(e => {
      const entryDate = new Date(e.clock_in);
      return e.clock_out && entryDate >= start && entryDate <= end;
    });

    let csv = 'Employee Number,Employee Name,Date,Clock In,Clock Out,Type,Duration (Hours)\n';

    exportEntries.forEach(entry => {
      const employee = employees.find(emp => emp.id === entry.employee_id);
      if (!employee) return;

      const date = new Date(entry.clock_in).toLocaleDateString('en-US');
      const clockIn = formatTime(entry.clock_in);
      const clockOut = formatTime(entry.clock_out);
      const duration = ((new Date(entry.clock_out) - new Date(entry.clock_in)) / (1000 * 60 * 60)).toFixed(2);
      const type = entry.break_type ? 
        entry.break_type.charAt(0).toUpperCase() + entry.break_type.slice(1) + ' Break' : 
        'Work';

      csv += `${employee.employee_number},"${employee.name}","${date}","${clockIn}","${clockOut}","${type}",${duration}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `timeclock_export_${exportStartDate}_to_${exportEndDate}.csv`;
    link.click();

    showAlert('success', 'CSV file downloaded!');
  };

  // Calculate weekly hours
  const calculateWeeklyHours = (employeeId, weekStart) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekEntries = timeEntries.filter(e => {
      const entryDate = new Date(e.clock_in);
      return e.employee_id === employeeId && 
             e.clock_out && 
             !e.break_type &&
             entryDate >= new Date(weekStart) && 
             entryDate < weekEnd;
    });

    let totalHours = 0;
    weekEntries.forEach(entry => {
      const hours = (new Date(entry.clock_out) - new Date(entry.clock_in)) / (1000 * 60 * 60);
      totalHours += hours;
    });

    const regularHours = Math.min(totalHours, 40);
    const overtimeHours = Math.max(totalHours - 40, 0);

    return { totalHours, regularHours, overtimeHours };
  };

  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  };

  // LOGIN VIEW
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-md mx-auto mt-20">
          <div className="bg-white rounded-xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="flex justify-center items-center mb-4">
                <Shield className="w-12 h-12 text-indigo-600 mr-2" />
                <Clock className="w-12 h-12 text-indigo-600" />
              </div>
              <h1 className="text-3xl font-bold text-gray-800">TimeClock Pro</h1>
              <p className="text-gray-600 mt-2">Oregon Compliant · Supabase Powered</p>
            </div>

            {alert && (
              <div className={`mb-4 p-3 rounded-lg ${
                alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {alert.message}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Employee Number
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none text-center text-2xl tracking-wider"
                  placeholder="Enter number"
                  disabled={loading}
                  autoFocus
                />
              </div>

              {employeeNumber.toLowerCase() === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Admin Password
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none text-center text-2xl"
                    placeholder="Password"
                    disabled={loading}
                  />
                </div>
              )}

              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-4 rounded-lg font-semibold text-lg hover:bg-indigo-700 transition disabled:bg-gray-400"
              >
                {loading ? 'Please Wait...' : 
                 employeeNumber.toLowerCase() === 'admin' ? 'Admin Login' : 'Clock In/Out'}
              </button>
            </div>

            <div className="mt-8 p-4 bg-blue-50 rounded-lg">
              <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center">
                <Shield className="w-4 h-4 mr-1" />
                Instructions:
              </p>
              <div className="text-xs text-gray-600 space-y-1">
                <p><strong>Employees:</strong> Enter your employee number to clock in/out</p>
                <p><strong>Administrators:</strong> Enter "admin" for management access</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // EMPLOYEE VIEW
  if (view === 'employee') {
    const status = getCurrentStatus(currentUser.id);
    const isClockedIn = status !== 'Clocked Out';
    const isOnBreak = status.includes('Break');

    const todayEntries = timeEntries.filter(e => 
      e.employee_id === currentUser.id && 
      e.clock_in.startsWith(new Date().toISOString().split('T')[0])
    );

    const progress = calculateProgress(currentUser.id);

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-2xl mx-auto">
          {/* Punch Confirmation Popup */}
          {punchConfirmation && (
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 animate-bounce">
              <div className="bg-white rounded-2xl shadow-2xl p-8 border-4 border-green-500 text-center min-w-[300px]">
                <div className="text-6xl mb-4">{punchConfirmation.icon}</div>
                <div className="text-2xl font-bold text-gray-800 mb-2">{punchConfirmation.message}</div>
                <div className="text-lg text-gray-600">{punchConfirmation.time}</div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">{currentUser.name}</h2>
                <p className={`text-lg font-semibold ${
                  isClockedIn ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {status}
                </p>
                <p className="text-xs text-gray-400 mt-1">Auto-logout in 60s of inactivity</p>
              </div>
              <button
                onClick={handleLogout}
                className="text-gray-600 hover:text-gray-800"
              >
                <LogOut className="w-6 h-6" />
              </button>
            </div>

            {alert && (
              <div className={`mb-4 p-3 rounded-lg ${
                alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {alert.message}
              </div>
            )}

            {/* Progress Summary */}
            <div className="mb-6 grid grid-cols-2 gap-4">
              {/* Today's Progress */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border-2 border-blue-200">
                <div className="text-xs font-semibold text-blue-800 mb-2">TODAY'S PROGRESS</div>
                <div className="flex items-baseline mb-2">
                  <span className="text-2xl font-bold text-blue-900">
                    {formatHoursMinutes(progress.todayHours)}
                  </span>
                  <span className="text-sm text-blue-700 ml-2">of 8h 0m</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((progress.todayHours / 8) * 100, 100)}%` }}
                  ></div>
                </div>
                {progress.todayDifference !== 0 && (
                  <div className={`text-xs font-semibold ${
                    progress.todayDifference > 0 ? 'text-green-700' : 'text-orange-700'
                  }`}>
                    {progress.todayDifference > 0 ? '▲' : '▼'} {formatHoursMinutes(progress.todayDifference)} {progress.todayDifference > 0 ? 'ahead' : 'behind'} schedule
                  </div>
                )}
              </div>

              {/* Week's Progress */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border-2 border-purple-200">
                <div className="text-xs font-semibold text-purple-800 mb-2">THIS WEEK</div>
                <div className="flex items-baseline mb-2">
                  <span className="text-2xl font-bold text-purple-900">
                    {formatHoursMinutes(progress.weekHours)}
                  </span>
                  <span className="text-sm text-purple-700 ml-2">of 40h 0m</span>
                </div>
                <div className="w-full bg-purple-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((progress.weekHours / 40) * 100, 100)}%` }}
                  ></div>
                </div>
                {progress.weekDifference !== 0 && (
                  <div className={`text-xs font-semibold ${
                    progress.weekDifference > 0 ? 'text-green-700' : 'text-orange-700'
                  }`}>
                    {progress.weekDifference > 0 ? '▲' : '▼'} {formatHoursMinutes(progress.weekDifference)} {progress.weekDifference > 0 ? 'ahead' : 'behind'}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              {!isClockedIn ? (
                <button
                  onClick={() => handleClockAction('in')}
                  disabled={loading}
                  className="col-span-2 bg-green-600 text-white py-4 rounded-lg font-semibold text-lg hover:bg-green-700 transition disabled:bg-gray-400"
                >
                  {loading ? 'Processing...' : 'Clock In'}
                  <span className="ml-2 text-sm opacity-75">[Press 1]</span>
                </button>
              ) : isOnBreak ? (
                <button
                  onClick={() => handleClockAction('out')}
                  disabled={loading}
                  className="col-span-2 bg-green-600 text-white py-4 rounded-lg font-semibold text-lg hover:bg-green-700 transition disabled:bg-gray-400"
                >
                  {loading ? 'Processing...' : 'End Break & Resume Work'}
                  <span className="ml-2 text-sm opacity-75">[Press 4]</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleClockAction('in', 'meal')}
                    disabled={loading}
                    className="bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-400"
                  >
                    <div>Take Meal Break</div>
                    <div className="text-xs opacity-75">[Press 2]</div>
                  </button>
                  <button
                    onClick={() => handleClockAction('in', 'rest')}
                    disabled={loading}
                    className="bg-blue-500 text-white py-3 rounded-lg font-semibold hover:bg-blue-600 transition disabled:bg-gray-400"
                  >
                    <div>Take Rest Break</div>
                    <div className="text-xs opacity-75">[Press 3]</div>
                  </button>
                  <button
                    onClick={() => handleClockAction('out')}
                    disabled={loading}
                    className="col-span-2 bg-red-600 text-white py-4 rounded-lg font-semibold text-lg hover:bg-red-700 transition disabled:bg-gray-400"
                  >
                    {loading ? 'Processing...' : 'Clock Out'}
                    <span className="ml-2 text-sm opacity-75">[Press 1]</span>
                  </button>
                </>
              )}
            </div>

            <div className="border-t pt-4 mb-4">
              <h3 className="font-semibold text-gray-700 mb-3">Today's Time</h3>
              <h3 className="font-semibold text-gray-700 mb-3">Today's Time</h3>
              {todayEntries.length === 0 ? (
                <p className="text-gray-500 text-sm">No punches today</p>
              ) : (
                <div className="space-y-2">
                  {todayEntries.map(entry => (
                    <div key={entry.id} className="flex justify-between items-center text-sm bg-gray-50 p-3 rounded">
                      <div>
                        <span className="font-medium">
                          {entry.break_type ? 
                            `${entry.break_type.charAt(0).toUpperCase() + entry.break_type.slice(1)} Break` : 
                            'Work'}
                        </span>
                        <span className="text-gray-500 ml-2">
                          {formatTime(entry.clock_in)} - {formatTime(entry.clock_out)}
                        </span>
                      </div>
                      <span className="text-gray-700 font-medium">
                        {formatDuration(entry.clock_in, entry.clock_out)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-xs font-semibold text-gray-700 mb-1">Oregon Break Requirements:</p>
              <ul className="text-xs text-gray-600 space-y-0.5">
                <li>• Rest breaks: 10 minutes for every 4 hours worked or major fraction thereof (paid)</li>
                <li>• Meal breaks: 1 hour for shifts over 6 hours (unpaid)</li>
                <li>• Major fraction = 2+ hours (e.g., 6 hours = 2 rest breaks)</li>
              </ul>
            </div>

            <div className="mt-3 p-3 bg-gray-50 rounded-lg border-l-4 border-indigo-500">
              <p className="text-xs font-semibold text-gray-700 mb-1">⌨️ Keyboard Shortcuts:</p>
              <ul className="text-xs text-gray-600 space-y-0.5">
                <li>• Press <strong>1</strong> to Clock In/Out</li>
                <li>• Press <strong>2</strong> for Meal Break</li>
                <li>• Press <strong>3</strong> for Rest Break</li>
                <li>• Press <strong>4</strong> to End Break</li>
                <li>• Press <strong>0</strong> or <strong>ESC</strong> to Logout</li>
              </ul>
              <div className="mt-2 pt-2 border-t border-gray-300 text-xs text-gray-500">
                Schedule: Mon-Fri 7am-4pm (8 hours) with 1-hour lunch
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ADMIN VIEW
  if (view === 'admin') {
    if (adminView === 'dashboard') {
      return (
        <div className="min-h-screen bg-gray-50 p-4">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
                <button
                  onClick={handleLogout}
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
                >
                  <LogOut className="w-4 h-4 inline mr-2" />
                  Logout
                </button>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setAdminView('dashboard')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Users className="w-4 h-4 inline mr-2" />
                  Dashboard
                </button>
                <button
                  onClick={() => setAdminView('reports')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Reports
                </button>
                <button
                  onClick={() => setAdminView('export')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Download className="w-4 h-4 inline mr-2" />
                  Export
                </button>
              </div>
            </div>

            {alert && (
              <div className={`mb-4 p-4 rounded-lg ${
                alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {alert.message}
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Current Employee Status</h2>
              <div className="space-y-3">
                {employees.map(emp => {
                  const status = getCurrentStatus(emp.id);
                  return (
                    <div key={emp.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-gray-800">{emp.name}</p>
                        <p className={`text-sm ${
                          status === 'Clocked Out' ? 'text-gray-500' : 'text-green-600'
                        }`}>
                          {status}
                        </p>
                      </div>
                      <span className="text-sm text-gray-600">${emp.hourly_rate}/hr</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (adminView === 'reports') {
      const currentWeekStart = getWeekStart(selectedDate);

      return (
        <div className="min-h-screen bg-gray-50 p-4">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold text-gray-800">Reports</h1>
                <button
                  onClick={handleLogout}
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
                >
                  <LogOut className="w-4 h-4 inline mr-2" />
                  Logout
                </button>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setAdminView('dashboard')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Users className="w-4 h-4 inline mr-2" />
                  Dashboard
                </button>
                <button
                  onClick={() => setAdminView('reports')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Reports
                </button>
                <button
                  onClick={() => setAdminView('export')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Download className="w-4 h-4 inline mr-2" />
                  Export
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">Weekly Time Report</h2>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Employee</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Regular Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Overtime Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {employees.map(emp => {
                      const { totalHours, regularHours, overtimeHours } = 
                        calculateWeeklyHours(emp.id, currentWeekStart);
                      const regularPay = regularHours * emp.hourly_rate;
                      const overtimePay = overtimeHours * emp.hourly_rate * 1.5;
                      const grossPay = regularPay + overtimePay;

                      return (
                        <tr key={emp.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{emp.name}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-700">{regularHours.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-700">
                            {overtimeHours > 0 ? (
                              <span className="text-orange-600 font-semibold">{overtimeHours.toFixed(2)}</span>
                            ) : (
                              '0.00'
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                            {totalHours.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                            ${grossPay.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 p-4 bg-green-50 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2 flex items-center">
                  <Shield className="w-5 h-5 mr-2 text-green-600" />
                  Oregon Labor Law Compliance
                </h3>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>✓ Overtime calculated at 1.5x after 40 hours/week</li>
                  <li>✓ Meal breaks tracked (1 hour for 6+ hour shifts)</li>
                  <li>✓ Rest breaks tracked (10min per 4 hours or major fraction - 2+ hours)</li>
                  <li>✓ All time entries include audit trail</li>
                  <li>✓ Records maintained with timestamp accuracy</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (adminView === 'export') {
      return (
        <div className="min-h-screen bg-gray-50 p-4">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold text-gray-800">Export Time Data</h1>
                <button
                  onClick={handleLogout}
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
                >
                  <LogOut className="w-4 h-4 inline mr-2" />
                  Logout
                </button>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setAdminView('dashboard')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Users className="w-4 h-4 inline mr-2" />
                  Dashboard
                </button>
                <button
                  onClick={() => setAdminView('reports')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Reports
                </button>
                <button
                  onClick={() => setAdminView('export')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  <Download className="w-4 h-4 inline mr-2" />
                  Export
                </button>
              </div>
            </div>

            {alert && (
              <div className={`mb-4 p-4 rounded-lg ${
                alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {alert.message}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {/* QuickBooks Export */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center mb-4">
                  <FileText className="w-8 h-8 text-green-600 mr-3" />
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">QuickBooks Desktop</h2>
                    <p className="text-sm text-gray-600">IIF format for time activities</p>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                    <input
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                </div>

                <button
                  onClick={exportToQuickBooks}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
                >
                  Download QuickBooks IIF File
                </button>

                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <h3 className="font-semibold text-gray-800 mb-2 text-sm">Import Instructions:</h3>
                  <ol className="text-xs text-gray-700 space-y-1 list-decimal list-inside">
                    <li>Open QuickBooks Desktop</li>
                    <li>Go to File → Utilities → Import → IIF Files</li>
                    <li>Select the downloaded .iif file</li>
                    <li>Review and confirm the import</li>
                  </ol>
                </div>
              </div>

              {/* Standard CSV Export */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center mb-4">
                  <Database className="w-8 h-8 text-indigo-600 mr-3" />
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Standard CSV</h2>
                    <p className="text-sm text-gray-600">Detailed timesheet data</p>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                    <input
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                </div>

                <button
                  onClick={exportToCSV}
                  className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
                >
                  Download CSV File
                </button>

                <div className="mt-4 p-4 bg-indigo-50 rounded-lg">
                  <h3 className="font-semibold text-gray-800 mb-2 text-sm">File Contents:</h3>
                  <ul className="text-xs text-gray-700 space-y-1">
                    <li>✓ Employee number and name</li>
                    <li>✓ Date, clock in/out times</li>
                    <li>✓ Entry type (Work/Break)</li>
                    <li>✓ Duration in decimal hours</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  return null;
}
