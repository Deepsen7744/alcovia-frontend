import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function App() {
  const [studentId, setStudentId] = useState('');
  const [status, setStatus] = useState('Normal'); // Normal, Needs Intervention, Remedial
  const [intervention, setIntervention] = useState(null);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [quizScore, setQuizScore] = useState('');
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [successMessage, setSuccessMessage] = useState('');
  const [pollingStopped, setPollingStopped] = useState(false);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Initialize student ID from localStorage or prompt
  useEffect(() => {
    const savedId = localStorage.getItem('student_id');
    if (savedId) {
      setStudentId(savedId);
      fetchStudentStatus(savedId);
    } else {
      const newId = `student_${Date.now()}`;
      setStudentId(newId);
      localStorage.setItem('student_id', newId);
    }
  }, []);

  // Setup WebSocket connection
  useEffect(() => {
    if (studentId) {
      socketRef.current = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });
      
      socketRef.current.on('connect', () => {
        console.log('Connected to server');
        socketRef.current.emit('subscribe', studentId);
      });

      socketRef.current.on('disconnect', () => {
        console.log('Disconnected from server');
      });

      socketRef.current.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
      });

      socketRef.current.on('status_update', (data) => {
        console.log('Status update received:', data);
        setStatus(data.status);
        if (data.task) {
          setIntervention({ task_description: data.task, status: 'Assigned' });
        }
        fetchStudentStatus(studentId);
      });

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, [studentId]);

  // Poll for status updates when locked (fallback if WebSocket fails)
  useEffect(() => {
    if (status === 'Needs Intervention' && studentId && !pollingStopped) {
      // Check if polling is enabled (default: true, can disable via env var)
      const pollingEnabled = process.env.REACT_APP_ENABLE_POLLING !== 'false';
      const maxPollAttempts = parseInt(process.env.REACT_APP_MAX_POLL_ATTEMPTS) || 60; // Default: 60 attempts = 5 minutes
      const pollIntervalMs = parseInt(process.env.REACT_APP_POLL_INTERVAL) || 5000; // Default: 5 seconds
      
      if (!pollingEnabled) {
        console.log('[Polling] Disabled via REACT_APP_ENABLE_POLLING=false');
        return;
      }

      let pollAttempts = 0;
      
      pollIntervalRef.current = setInterval(() => {
        pollAttempts++;
        console.log(`[Polling] Attempt ${pollAttempts}/${maxPollAttempts}`);
        
        // Stop polling after max attempts
        if (pollAttempts >= maxPollAttempts) {
          console.warn('[Polling] Reached maximum poll attempts. Stopping polling.');
          clearInterval(pollIntervalRef.current);
          setPollingStopped(true);
          return;
        }
        
        fetchStudentStatus(studentId);
      }, pollIntervalMs);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          console.log('[Polling] Stopped');
        }
      };
    }
  }, [status, studentId, pollingStopped]);

  // Reset polling stopped when status changes
  useEffect(() => {
    if (status !== 'Needs Intervention') {
      setPollingStopped(false);
    }
  }, [status]);

  const handleStopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setPollingStopped(true);
    console.log('[Polling] Manually stopped by user');
  };

  // Tab visibility detection (Cheater Detection)
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsTabVisible(isVisible);
      
      if (!isVisible && isTimerRunning) {
        // Tab switched away during focus timer
        setTabSwitches(prev => prev + 1);
        if (tabSwitches >= 2) {
          // Too many tab switches - fail the session
          handleTabSwitchPenalty();
        }
      }
    };

    const handleBlur = () => {
      if (isTimerRunning) {
        setTabSwitches(prev => prev + 1);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isTimerRunning, tabSwitches]);

  const fetchStudentStatus = async (id) => {
    try {
      const response = await axios.get(`${API_URL}/student-status/${id}`);
      const newStatus = response.data.status;
      setStatus(newStatus);
      setIntervention(response.data.intervention);
      
      // If status changed from locked to remedial, update intervention
      if (newStatus === 'Remedial' && response.data.intervention) {
        setIntervention(response.data.intervention);
      }
    } catch (error) {
      console.error('Error fetching student status:', error);
      // If student doesn't exist, create them with Normal status
      if (error.response?.status === 404) {
        setStatus('Normal');
        setIntervention(null);
      }
    }
  };

  const handleTabSwitchPenalty = () => {
    // Stop timer and fail the session
    if (timerRef.current) {
      clearInterval(timerRef.current);
      setIsTimerRunning(false);
      setFocusMinutes(0);
    }
    alert('Focus session failed due to multiple tab switches. Please restart.');
  };

  const startFocusTimer = () => {
    if (isTimerRunning) return;

    setIsTimerRunning(true);
    setTabSwitches(0);
    setFocusMinutes(0);

    timerRef.current = setInterval(() => {
      setFocusMinutes(prev => {
        const newMinutes = prev + 1;
        return newMinutes;
      });
    }, 60000); // Update every minute
  };

  const stopFocusTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      setIsTimerRunning(false);
    }
  };

  const handleDailyCheckin = async (e) => {
    e.preventDefault();
    
    if (!quizScore || quizScore < 0 || quizScore > 10) {
      alert('Please enter a valid quiz score (0-10)');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/daily-checkin`, {
        student_id: studentId,
        quiz_score: parseInt(quizScore),
        focus_minutes: focusMinutes
      });

      console.log('Daily check-in response:', response.data);

      if (response.data.status === 'On Track') {
        // Show success message
        console.log('✅ Student is On Track!');
        setSuccessMessage('✅ Great job! You are On Track!');
        setStatus('Normal');
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          setSuccessMessage('');
        }, 5000);
      } else if (response.data.status === 'Pending Mentor Review') {
        console.log('⚠️ Student needs intervention');
        setStatus('Needs Intervention');
        setSuccessMessage(''); // Clear any previous success message
        // Fetch updated status
        await fetchStudentStatus(studentId);
      } else {
        console.log('Unknown status:', response.data.status);
        setStatus('Needs Intervention');
        setSuccessMessage('');
      }

      // Reset form
      setQuizScore('');
      setFocusMinutes(0);
      stopFocusTimer();
    } catch (error) {
      console.error('Error submitting checkin:', error);
      alert('Error submitting daily checkin. Please try again.');
    }
  };

  const handleCompleteIntervention = async () => {
    try {
      await axios.post(`${API_URL}/complete-intervention`, {
        student_id: studentId
      });

      setStatus('Normal');
      setIntervention(null);
      await fetchStudentStatus(studentId);
    } catch (error) {
      console.error('Error completing intervention:', error);
      alert('Error completing intervention. Please try again.');
    }
  };

  const renderNormalState = () => (
    <div className="state-container">
      <h2>Focus Mode</h2>
      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}
      <div className="timer-section">
        <div className="timer-display">
          <span className="timer-value">{focusMinutes}</span>
          <span className="timer-label">minutes</span>
        </div>
        {!isTimerRunning ? (
          <button className="btn btn-primary" onClick={startFocusTimer}>
            Start Focus Timer
          </button>
        ) : (
          <div>
            <button className="btn btn-secondary" onClick={stopFocusTimer}>
              Stop Timer
            </button>
            {!isTabVisible && (
              <div className="warning">⚠️ Tab is not visible - focus session may be invalidated</div>
            )}
            {tabSwitches > 0 && (
              <div className="warning">
                ⚠️ Tab switches detected: {tabSwitches}/3 (Session will fail after 3)
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleDailyCheckin} className="quiz-section">
        <h3>Daily Quiz</h3>
        <div className="input-group">
          <label>Quiz Score (0-10)</label>
          <input
            type="number"
            min="0"
            max="10"
            value={quizScore}
            onChange={(e) => setQuizScore(e.target.value)}
            placeholder="Enter your score"
            required
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Submit Daily Check-in
        </button>
      </form>
    </div>
  );

  const handleTestUnlock = async () => {
    // For development/testing: manually assign a test intervention
    try {
      const response = await axios.post(`${API_URL}/assign-intervention`, {
        student_id: studentId,
        task_description: 'Test Task: Review previous lessons and retake quiz'
      });
      
      if (response.data.success) {
        setStatus('Remedial');
        setIntervention({ 
          task_description: response.data.task_description, 
          status: 'Assigned' 
        });
        await fetchStudentStatus(studentId);
      }
    } catch (error) {
      console.error('Error unlocking:', error);
      alert('Error unlocking. Please check backend connection.');
    }
  };

  const renderLockedState = () => (
    <div className="state-container locked">
      <div className="lock-icon">🔒</div>
      <h2>Analysis in Progress</h2>
      <p className="status-message">Waiting for Mentor...</p>
      {!pollingStopped && <div className="loading-spinner"></div>}
      {pollingStopped && (
        <div style={{ 
          padding: '15px', 
          background: '#fff3cd', 
          borderRadius: '8px', 
          margin: '20px 0',
          color: '#856404'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>
            ⚠️ Status checking paused. Waiting for mentor response.
          </p>
        </div>
      )}
      <p className="info-text">
        Your recent performance has been flagged for review. 
        A mentor will analyze your progress and assign appropriate interventions.
      </p>
      
      {/* Stop Polling Button - Available in Production */}
      {!pollingStopped && (
        <div style={{ marginTop: '20px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={handleStopPolling}
            style={{ width: 'auto', margin: '0 auto', display: 'block' }}
          >
            Stop Checking Status
          </button>
          <p style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', marginTop: '10px' }}>
            You can stop automatic status checking. The page will still update when mentor responds.
          </p>
        </div>
      )}

      {/* Development/Testing: Manual unlock button */}
      {process.env.NODE_ENV === process.env.NODE_ENV && (
        <div style={{ marginTop: '20px', padding: '15px', background: '#f0f0f0', borderRadius: '8px' }}>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '10px' }}>
            <strong>Development Mode:</strong> For testing, you can manually unlock:
          </p>
          <button 
            className="btn btn-secondary" 
            onClick={handleTestUnlock}
            style={{ width: 'auto', margin: '0 auto', display: 'block' }}
          >
            Test Unlock (Assign Sample Task)
          </button>
        </div>
      )}
    </div>
  );

  const renderRemedialState = () => (
    <div className="state-container remedial">
      <h2>Remedial Task Assigned</h2>
      <div className="task-card">
        <h3>Your Task:</h3>
        <p className="task-description">
          {intervention?.task_description || 'No task description available'}
        </p>
      </div>
      <button className="btn btn-primary" onClick={handleCompleteIntervention}>
        Mark Complete
      </button>
    </div>
  );

  return (
    <div className="App">
      <div className="app-container">
        <header>
          <h1>Alcovia - Focus Mode</h1>
          <div className="student-info">
            Student ID: <span>{studentId}</span>
          </div>
        </header>

        <main>
          {status === 'Normal' && renderNormalState()}
          {status === 'Needs Intervention' && renderLockedState()}
          {status === 'Remedial' && renderRemedialState()}
        </main>
      </div>
    </div>
  );
}

export default App;

