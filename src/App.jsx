
import React, { useState, useEffect, useMemo } from 'react';
import {
  MinusCircle, CheckCircle, Clock, XCircle, Pencil, Trash2, Plus, FileText, Settings2,
  ChevronDown, Check, CalendarDays, PlusCircle, CalendarX, Edit, Search, ChevronLeft,
  ChevronRight, BrainCircuit, MessageSquarePlus, AreaChart, CircleSlash, Undo, LayoutGrid,
  Users, Printer, RotateCw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// --- Firebase (safe init for Vite hot-reload) ---
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore, collection, doc, addDoc, setDoc, deleteDoc, onSnapshot,
  query, where, getDocs, updateDoc, deleteField, writeBatch
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// Initialize Firebase safely (prevents “already exists” during dev)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Utility function to convert minutes to a human-readable format
const formatMinutes = (totalMinutes) => {
  if (totalMinutes <= 0) return 'On Time';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let result = [];
  if (hours > 0) result.push(`${hours}h`);
  if (minutes > 0) result.push(`${minutes}m`);
  return result.join(' ');
};

// --- New Helper function to get today's date string reliably ---
const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// --- Helper function to get the active section based on current time ---
const getActiveSectionId = (sections, dailyOverrides, selectedDate) => {
  const now = new Date();
  const todayString = getTodayString();
  if (selectedDate !== todayString) return null; // Only auto-select for today
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const sectionsWithOverrides = sections.map(sec => {
    const override = dailyOverrides.find(o => o.sectionId === sec.id && o.date === selectedDate);
    return {
      ...sec,
      startTime: override ? override.newTime : sec.startTime,
    };
  });

  // Find the latest section that has already started
  let activeSectionId = null;
  for (let i = 0; i < sectionsWithOverrides.length; i++) {
    const [startHour, startMinute] = sectionsWithOverrides[i].startTime.split(':').map(Number);
    const sectionTime = startHour * 60 + startMinute;
    if (currentTime >= sectionTime) {
      activeSectionId = sectionsWithOverrides[i].id;
    }
  }
  return activeSectionId;
};

// --- Helper function to generate a UUID-like string ---
const generateId = () => Math.random().toString(36).substring(2, 9);

// Check if a person is marked out for a given date and section
const isPersonMarkedOut = (personId, date, sectionId, sections, outRecords) => {
  const checkDate = new Date(date);
  checkDate.setUTCHours(0,0,0,0); // Normalize to start of day UTC
  const sectionIndex = sections.findIndex(s => s.id === sectionId);

  return outRecords.some(record => {
    if (record.personId !== personId) return false;

    const recordStartDate = new Date(record.startDate);
    recordStartDate.setUTCHours(0,0,0,0);
    const recordEndDate = new Date(record.endDate);
    recordEndDate.setUTCHours(0,0,0,0);

    const startSectionIndex = sections.findIndex(s => s.id === record.startSectionId);
    const endSectionIndex = sections.findIndex(s => s.id === record.endSectionId);

    // Check if the date is within the range (inclusive)
    if (checkDate < recordStartDate || checkDate > recordEndDate) return false;

    // Check if the section is within the range
    if (recordStartDate.getTime() === recordEndDate.getTime()) { // Single day
      return sectionIndex >= startSectionIndex && sectionIndex <= endSectionIndex;
    } else if (checkDate.getTime() === recordStartDate.getTime()) { // First day of multi-day
      return sectionIndex >= startSectionIndex;
    } else if (checkDate.getTime() === recordEndDate.getTime()) { // Last day of multi-day
      return sectionIndex <= endSectionIndex;
    } else { // A full day in between
      return true;
    }
  });
};

// A simple utility to get the Hebrew date string
const getHebrewDate = (gregorianDate) => {
  try {
    const date = new Date(gregorianDate);
    // Adjust for timezone to prevent off-by-one day errors
    const adjustedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
    const hDate = new Intl.DateTimeFormat('en-u-ca-hebrew', {
      dateStyle: 'full'
    }).format(adjustedDate);

    // Format to be more readable
    const parts = hDate.split(', ');
    return parts.slice(1).join(', ');
  } catch (e) {
    console.error("Error formatting Hebrew date:", e);
    return "Invalid Date";
  }
};

// --- Reusable Calculation Logic ---
const calculateSummaryStats = (personId, allAttendanceData, sections, dailyScheduleOverrides, startDate, endDate, outRecords) => {
  const todayString = getTodayString();
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  let totalMinutesPossible = 0;
  let totalMinutesAttended = 0;
  const perClassStats = {};

  sections.forEach(s => {
    perClassStats[s.id] = { totalMinutesPossible: 0, totalMinutesAttended: 0, percentage: "N/A" };
  });

  const datesToProcess = Object.keys(allAttendanceData).filter(date => {
    const currentDateObj = new Date(date);
    const currentDate = new Date(currentDateObj.valueOf() + currentDateObj.getTimezoneOffset() * 60 * 1000);
    if (startDate && currentDate < startDate) return false;
    if (endDate && currentDate > endDate) return false;
    return true;
  });

  datesToProcess.forEach(date => {
    const dayRecords = allAttendanceData[date] || {};
    const sectionsForThisDay = sections.map(sec => {
      const override = dailyScheduleOverrides.find(o => o.sectionId === sec.id && o.date === date);
      return { ...sec, startTime: override ? override.newTime : sec.startTime };
    });

    sectionsForThisDay.forEach(section => {
      const [startHour, startMinute] = section.startTime.split(':').map(Number);
      const sectionTime = startHour * 60 + startMinute;
      const isPast = new Date(date) < new Date(todayString) || (date === todayString && currentTime >= sectionTime + section.duration);
      const isActive = date === todayString && currentTime >= sectionTime && currentTime < sectionTime + section.duration;

      if (isPast || isActive) {
        const wasClassHeldForAnyStudent = Object.values(dayRecords).some(personRecords => personRecords[section.id]);
        if (wasClassHeldForAnyStudent) {
          const record = dayRecords[personId]?.[section.id];
          const isOut = isPersonMarkedOut(personId, date, section.id, sections, outRecords);

          if (isOut || record?.status === 'Excused') {
            // Excused, do nothing.
          } else if (record && (record.status === 'On Time' || record.status === 'Late')) {
            totalMinutesPossible += section.duration;
            perClassStats[section.id].totalMinutesPossible += section.duration;
            const attended = record.status === 'On Time'
              ? section.duration
              : Math.max(0, section.duration - (record.minutesLate || 0));
            totalMinutesAttended += attended;
            perClassStats[section.id].totalMinutesAttended += attended;
          } else if (record && record.status === 'Absent') {
            totalMinutesPossible += section.duration;
            perClassStats[section.id].totalMinutesPossible += section.duration;
          } else if (!record) { // Not marked
            if (isActive) {
              // Implicitly absent for active classes
              totalMinutesPossible += section.duration;
              perClassStats[section.id].totalMinutesPossible += section.duration;
            }
          }
        }
      }
    });
  });

  for (const sectionId in perClassStats) {
    const classData = perClassStats[sectionId];
    if (classData.totalMinutesPossible > 0) {
      classData.percentage = ((classData.totalMinutesAttended / classData.totalMinutesPossible) * 100).toFixed(1);
    }
  }

  const presentPercentage = totalMinutesPossible > 0
    ? ((totalMinutesAttended / totalMinutesPossible) * 100).toFixed(1)
    : "N/A";

  const totalMinutesLate = datesToProcess
    .flatMap(date => Object.values(allAttendanceData[date]?.[personId] || {}))
    .filter(rec => rec.status === 'Late')
    .reduce((sum, rec) => sum + (rec.minutesLate || 0), 0);

  return { presentPercentage, totalMinutesLate, perClassStats };
};

const getPercentageColor = (percentage) => {
  const p = parseFloat(percentage);
  if (isNaN(p)) return 'text-gray-400';
  if (p < 60) return 'text-red-400';
  if (p < 80) return 'text-yellow-400';
  return 'text-green-400';
};

const GroupAbsenceModal = ({ people, sections, outRecords, onClose, onSave, onDelete }) => {
  const [mode, setMode] = useState('list');
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [formState, setFormState] = useState({
    startDate: getTodayString(),
    endDate: getTodayString(),
    startSectionId: sections.length > 0 ? sections[0].id : '',
    endSectionId: sections.length > 0 ? sections[sections.length - 1].id : '',
    note: '',
  });
  const [validationError, setValidationError] = useState('');
  const [activeTab, setActiveTab] = useState('upcoming');

  const groupAbsences = useMemo(() => {
    const groups = {};
    if (outRecords) {
      outRecords.forEach(record => {
        if (record.groupId) {
          if (!groups[record.groupId]) {
            groups[record.groupId] = { ...record, people: [] };
          }
          groups[record.groupId].people.push(record.personId);
        }
      });
    }
    return Object.values(groups);
  }, [outRecords]);

  const { upcomingAbsences, pastAbsences } = useMemo(() => {
    const today = getTodayString();
    const upcoming = groupAbsences.filter(g => g.endDate >= today);
    const past = groupAbsences.filter(g => g.endDate < today);
    return { upcomingAbsences: upcoming, pastAbsences: past };
  }, [groupAbsences]);

  const filteredPeopleForGroupModal = useMemo(() => {
    if (!groupSearchQuery) return people;
    const lowerCaseQuery = groupSearchQuery.toLowerCase();
    return people.filter(p =>
      p.firstName.toLowerCase().includes(lowerCaseQuery) ||
      p.lastName.toLowerCase().includes(lowerCaseQuery)
    );
  }, [groupSearchQuery, people]);

  const handlePersonSelection = (personId) => {
    setSelectedPeopleIds(prev => prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]);
  };

  const handleSelectAll = () => {
    const filteredIds = filteredPeopleForGroupModal.map(p => p.id);
    const allFilteredSelected = filteredIds.every(id => selectedPeopleIds.includes(id));
    if (allFilteredSelected) {
      setSelectedPeopleIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      setSelectedPeopleIds(prev => [...new Set([...prev, ...filteredIds])]);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveClick = () => {
    if (selectedPeopleIds.length === 0) {
      setValidationError("Please select at least one person.");
      return;
    }
    if (new Date(formState.startDate) > new Date(formState.endDate)) {
      setValidationError("End date cannot be before start date.");
      return;
    }
    const groupId = editingGroupId || generateId();
    const newRecords = selectedPeopleIds.map(personId => ({ ...formState, personId, id: generateId(), groupId }));
    onSave({ records: newRecords, groupIdToEdit: editingGroupId });
    onClose();
  };

  const handleAddNew = () => {
    setEditingGroupId(null);
    setSelectedPeopleIds([]);
    setFormState({
      startDate: getTodayString(),
      endDate: getTodayString(),
      startSectionId: sections.length > 0 ? sections[0].id : '',
      endSectionId: sections.length > 0 ? sections[sections.length - 1].id : '',
      note: '',
    });
    setMode('form');
  };

  const handleEdit = (group) => {
    setEditingGroupId(group.groupId);
    setSelectedPeopleIds(group.people);
    setFormState({
      startDate: group.startDate,
      endDate: group.endDate,
      startSectionId: group.startSectionId,
      endSectionId: group.endSectionId,
      note: group.note,
    });
    setMode('form');
  };

  const renderAbsenceList = (absences) => (
    <ul className="space-y-2">
      {absences.map(group => (
        <li key={group.groupId} className="bg-gray-700 p-3 rounded-md">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-semibold">{group.note || "Group Absence"}</p>
              <p className="text-sm text-gray-300">{new Date(group.startDate).toLocaleDateString()} to {new Date(group.endDate).toLocaleDateString()}</p>
              <p className="text-xs text-gray-400">{group.people.length} people</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(group)} className="text-yellow-400 hover:text-yellow-300"><Pencil size={18}/></button>
              <button onClick={() => onDelete(group.groupId)} className="text-red-400 hover:text-red-300"><Trash2 size={18}/></button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Manage Group Absences</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XCircle size={24}/></button>
        </div>
        {mode === 'list' ? (
          <>
            <div className="flex border-b border-gray-700 mb-4">
              <button onClick={() => setActiveTab('upcoming')} className={`px-4 py-2 ${activeTab === 'upcoming' ? 'border-b-2 border-blue-500 text-white' : 'text-gray-400'}`}>Active & Upcoming</button>
              <button onClick={() => setActiveTab('past')} className={`px-4 py-2 ${activeTab === 'past' ? 'border-b-2 border-blue-500 text-white' : 'text-gray-400'}`}>Past History</button>
            </div>
            <div className="flex-grow overflow-y-auto">
              {activeTab === 'upcoming' && (
                <>
                  {renderAbsenceList(upcomingAbsences)}
                  {upcomingAbsences.length === 0 && <p className="text-center text-gray-400 py-8">No active or upcoming group absences.</p>}
                </>
              )}
              {activeTab === 'past' && (
                <>
                  {renderAbsenceList(pastAbsences)}
                  {pastAbsences.length === 0 && <p className="text-center text-gray-400 py-8">No past group absences.</p>}
                </>
              )}
            </div>
            <button onClick={handleAddNew} className="mt-4 w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">Add New Group Absence</button>
          </>
        ) : (
          <>
            <div className="flex-grow overflow-y-auto space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Select People</h4>
                <div className="relative mb-2">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search people..."
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    className="w-full bg-gray-700 border-gray-600 rounded-lg pl-10 pr-4 py-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button onClick={handleSelectAll} className="mb-2 px-3 py-1 text-sm bg-blue-600 rounded-md hover:bg-blue-700">
                  {selectedPeopleIds.length === filteredPeopleForGroupModal.length ? 'Deselect All' : 'Select All'} ({selectedPeopleIds.length}/{people.length})
                </button>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-900/50 rounded-md">
                  {filteredPeopleForGroupModal.map(person => (
                    <label key={person.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPeopleIds.includes(person.id)}
                        onChange={() => handlePersonSelection(person.id)}
                        className="form-checkbox h-5 w-5 bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span>{`${person.firstName} ${person.lastName}`}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Start Date</label>
                  <input type="date" name="startDate" value={formState.startDate} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">End Date</label>
                  <input type="date" name="endDate" value={formState.endDate} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2"/>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Start Class</label>
                  <select name="startSectionId" value={formState.startSectionId} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2">
                    {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">End Class</label>
                  <select name="endSectionId" value={formState.endSectionId} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2">
                    {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Note (Reason)</label>
                <textarea name="note" value={formState.note} onChange={handleFormChange} placeholder="e.g., Wedding, Shabbaton" className="w-full bg-gray-700 rounded-md p-2 h-20"></textarea>
              </div>
              {validationError && <p className="text-red-400 text-sm">{validationError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setMode('list')} className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-700">Cancel</button>
              <button onClick={handleSaveClick} className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700">Save Group Absence</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ================== MAIN APP COMPONENT ==================
const App = () => {
  // --- Firebase/Auth ---
  const [userId, setUserId] = useState(null);

  // Sign in anonymously (no login UI)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error("Anonymous sign-in failed:", e);
        }
      }
    });
    return () => unsub();
  }, []);

  // Use a unique ID for the app, or a default
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  // --- App State ---
  const [people, setPeople] = useState([]);
  const [sections, setSections] = useState([]);

  // State for the currently selected day's attendance records.
  const [dailyAttendance, setDailyAttendance] = useState({});
  // State for ALL attendance data, used for reports.
  const [allAttendanceData, setAllAttendanceData] = useState({});

  // NEW: State for Undo/Redo
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);

  const students = useMemo(() => people.filter(p => p.type === 'student'), [people]);
  const shluchim = useMemo(() => people.filter(p => p.type === 'shliach'), [people]);

  const [dailyScheduleOverrides, setDailyScheduleOverrides] = useState([]);

  // NEW: State for persistent, per-class notes
  const [persistentNotes, setPersistentNotes] = useState({});
  const [editingPersistentNote, setEditingPersistentNote] = useState(null); // { personId, sectionId }

  // NEW: State for multi-day/multi-section absences
  const [outRecords, setOutRecords] = useState([]);

  const [showSettings, setShowSettings] = useState(false);
  const [editingPerson, setEditingPerson] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [currentDate, setCurrentDate] = useState('');
  const [hebrewDate, setHebrewDate] = useState(''); // State for Hebrew date

  // State for the current view, selected person, and selected date
  const [view, setView] = useState('main'); // 'main', 'summary', 'reportsDashboard'
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [currentSectionId, setCurrentSectionId] = useState(null);
  // New state for the date, initialized to today
  const [selectedDate, setSelectedDate] = useState(getTodayString());

  // State for the search query
  const [searchQuery, setSearchQuery] = useState('');

  // NEW: State for the absence management modal
  const [managingAbsences, setManagingAbsences] = useState({ isOpen: false, personId: null });
  const [isGroupAbsenceModalOpen, setIsGroupAbsenceModalOpen] = useState(false);

  // NEW: State for the daily schedule override modal
  const [scheduleOverrideModal, setScheduleOverrideModal] = useState({
    isOpen: false,
    sectionId: null,
    newTime: '',
    date: selectedDate, // Add a date to the override modal state
  });

  // NEW: State for sorting
  const [sortField, setSortField] = useState('lastName'); // 'firstName', 'lastName', 'note'
  const [savedSortField, setSavedSortField] = useState('note'); // To remember preference

  // NEW: State for period filter
  const [selectedPeriodFilter, setSelectedPeriodFilter] = useState('all');
  const [emailFrequency, setEmailFrequency] = useState('weekly');

  const todayString = getTodayString();

  // Filtered people list based on search query
  const filteredPeople = useMemo(() => {
    if (!searchQuery) return people;
    const lowerCaseQuery = searchQuery.toLowerCase();
    return people.filter(p =>
      p.firstName.toLowerCase().includes(lowerCaseQuery) ||
      p.lastName.toLowerCase().includes(lowerCaseQuery)
    );
  }, [searchQuery, people]);

  // Separate filtered lists for students and shluchim
  const filteredStudents = useMemo(() => filteredPeople.filter(p => p.type === 'student'), [filteredPeople]);
  const filteredShluchim = useMemo(() => filteredPeople.filter(p => p.type === 'shliach'), [filteredPeople]);

  // Sorted students list based on sort field
  const sortedStudents = useMemo(() => {
    const sorted = [...filteredStudents];
    sorted.sort((a, b) => {
      if (sortField === 'note' && selectedPeriodFilter !== 'all') {
        const noteA = persistentNotes[a.id]?.[selectedPeriodFilter] || '';
        const noteB = persistentNotes[b.id]?.[selectedPeriodFilter] || '';
        if (noteA && !noteB) return -1;
        if (!noteA && noteB) return 1;
        return noteA.localeCompare(noteB);
      }
      const aName = a[sortField]?.toLowerCase() || a.lastName.toLowerCase();
      const bName = b[sortField]?.toLowerCase() || b.lastName.toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });
    return sorted;
  }, [filteredStudents, sortField, persistentNotes, selectedPeriodFilter]);

  // Sorted shluchim list
  const sortedShluchim = useMemo(() => {
    const sorted = [...filteredShluchim];
    sorted.sort((a, b) => {
      if (sortField === 'note' && selectedPeriodFilter !== 'all') {
        const noteA = persistentNotes[a.id]?.[selectedPeriodFilter] || '';
        const noteB = persistentNotes[b.id]?.[selectedPeriodFilter] || '';
        if (noteA && !noteB) return -1;
        if (!noteA && noteB) return 1;
        return noteA.localeCompare(noteB);
      }
      const aName = a[sortField]?.toLowerCase() || a.lastName.toLowerCase();
      const bName = b[sortField]?.toLowerCase() || b.lastName.toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });
    return sorted;
  }, [filteredShluchim, sortField, persistentNotes, selectedPeriodFilter]);

  const activeSection = sections.find(s => s.id === currentSectionId);
  const sectionsWithOverrides = useMemo(() => {
    return sections.map(sec => {
      const override = dailyScheduleOverrides.find(o => o.sectionId === sec.id && o.date === selectedDate);
      return {
        ...sec,
        startTime: override ? override.newTime : sec.startTime
      };
    });
  }, [sections, dailyScheduleOverrides, selectedDate]);

  const activeSectionWithOverride = sectionsWithOverrides.find(s => s.id === currentSectionId);
  const overrideForActiveSection = dailyScheduleOverrides.find(o => o.sectionId === activeSection?.id && o.date === selectedDate);

  // NEW: Memo for filtered sections for the grid view
  const filteredSectionsForView = useMemo(() => {
    if (selectedPeriodFilter === 'all') {
      return sectionsWithOverrides;
    }
    return sectionsWithOverrides.filter(s => s.id === selectedPeriodFilter);
  }, [selectedPeriodFilter, sectionsWithOverrides]);

  // --- Firestore Effects (read) ---

  // People
  useEffect(() => {
    if (!userId) return;
    const peopleCollectionPath = `/artifacts/${appId}/users/${userId}/people`;
    const peopleQuery = query(collection(db, peopleCollectionPath));
    const unsubscribe = onSnapshot(peopleQuery, (querySnapshot) => {
      const peopleData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPeople(peopleData);
    }, (error) => console.error("Error fetching people:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // Sections
  useEffect(() => {
    if (!userId) return;
    const sectionsCollectionPath = `/artifacts/${appId}/users/${userId}/sections`;
    const sectionsQuery = query(collection(db, sectionsCollectionPath));
    const unsubscribe = onSnapshot(sectionsQuery, (querySnapshot) => {
      const sectionsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sectionsData.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setSections(sectionsData);
    }, (error) => console.error("Error fetching sections:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // Daily attendance (selectedDate)
  useEffect(() => {
    if (!userId || !selectedDate) return;
    const attendanceDocPath = `/artifacts/${appId}/users/${userId}/attendance/${selectedDate}`;
    const docRef = doc(db, attendanceDocPath);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      setDailyAttendance(docSnap.exists() ? docSnap.data() : {});
    }, (error) => console.error("Error fetching daily attendance:", error));
    return () => unsubscribe();
  }, [userId, selectedDate, appId]);

  // All attendance
  useEffect(() => {
    if (!userId) return;
    const attendanceCollectionPath = `/artifacts/${appId}/users/${userId}/attendance`;
    const attendanceQuery = query(collection(db, attendanceCollectionPath));
    const unsubscribe = onSnapshot(attendanceQuery, (querySnapshot) => {
      const allData = {};
      querySnapshot.forEach(doc => {
        allData[doc.id] = doc.data();
      });
      setAllAttendanceData(allData);
    }, (error) => console.error("Error fetching all attendance data:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // Out records (absences)
  useEffect(() => {
    if (!userId) return;
    const outRecordsCollectionPath = `/artifacts/${appId}/users/${userId}/outRecords`;
    const outRecordsQueryRef = query(collection(db, outRecordsCollectionPath));
    const unsubscribe = onSnapshot(outRecordsQueryRef, (querySnapshot) => {
      const recordsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOutRecords(recordsData);
    }, (error) => console.error("Error fetching out records:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // Persistent notes
  useEffect(() => {
    if (!userId) return;
    const notesCollectionPath = `/artifacts/${appId}/users/${userId}/persistentNotes`;
    const notesQueryRef = query(collection(db, notesCollectionPath));
    const unsubscribe = onSnapshot(notesQueryRef, (querySnapshot) => {
      const notesData = {};
      querySnapshot.forEach(doc => {
        notesData[doc.id] = doc.data();
      });
      setPersistentNotes(notesData);
    }, (error) => console.error("Error fetching persistent notes:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // User settings (sort field)
  useEffect(() => {
    if (!userId) return;
    const settingsDocPath = `/artifacts/${appId}/users/${userId}/settings/userPreferences`;
    const unsubscribe = onSnapshot(doc(db, settingsDocPath), (docSnap) => {
      if (docSnap.exists() && docSnap.data().sortField) {
        setSortField(docSnap.data().sortField);
        setSavedSortField(docSnap.data().sortField);
      }
    }, (error) => console.error("Error fetching settings:", error));
    return () => unsubscribe();
  }, [userId, appId]);

  // Schedule overrides for selected date
  useEffect(() => {
    if (!userId || !selectedDate) return;
    const overridesCollectionPath = `/artifacts/${appId}/users/${userId}/dailyScheduleOverrides`;
    const q = query(collection(db, overridesCollectionPath), where("date", "==", selectedDate));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const overridesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDailyScheduleOverrides(overridesData);
    }, (error) => console.error("Error fetching schedule overrides:", error));
    return () => unsubscribe();
  }, [userId, selectedDate, appId]);

  // --- UI/Derived Effects ---
  useEffect(() => {
    // Set today's date string for display
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateObj = new Date(selectedDate);
    const timezoneOffset = dateObj.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(dateObj.getTime() + timezoneOffset);

    setCurrentDate(adjustedDate.toLocaleDateString('en-US', options));
    setHebrewDate(getHebrewDate(selectedDate)); // Set the Hebrew date

    // Set initial active section and update every minute
    const updateActiveSectionId = () => {
      setCurrentSectionId(getActiveSectionId(sections, dailyScheduleOverrides, selectedDate));
    };
    updateActiveSectionId();
    const intervalId = setInterval(updateActiveSectionId, 60000); // Check every minute
    return () => clearInterval(intervalId);
  }, [sections, selectedDate, dailyScheduleOverrides]); // Rerun effect if sections, selectedDate, or overrides change

  // Effect to set the initial period filter to the current class on today's date
  useEffect(() => {
    if (sections.length > 0 && selectedDate === todayString) {
      const activeId = getActiveSectionId(sections, dailyScheduleOverrides, todayString);
      if (activeId) {
        setSelectedPeriodFilter(activeId);
        handleSortChange('note');
      }
    }
  }, [sections, dailyScheduleOverrides, selectedDate, todayString]);

  // NEW: Effect to reset sort field if period filter changes to "all"
  useEffect(() => {
    if (selectedPeriodFilter === 'all') {
      setSortField('lastName');
    } else {
      setSortField(savedSortField);
    }
  }, [selectedPeriodFilter, savedSortField]);

  // NEW: Reset history when date changes
  useEffect(() => {
    setAttendanceHistory([]);
    setRedoHistory([]);
  }, [selectedDate]);

  // --- Attendance Logic ---
  const handleAttendanceChange = async (personId, sectionId, status, note = null, minutesLate = 0) => {
    if (!userId) return;
    if (isPersonMarkedOut(personId, selectedDate, sectionId, sections, outRecords)) return;

    // Save current state for undo
    setAttendanceHistory(prev => [...prev, dailyAttendance]);
    setRedoHistory([]); // Clear redo history on new action

    const attendanceDocPath = `/artifacts/${appId}/users/${userId}/attendance/${selectedDate}`;
    const docRef = doc(db, attendanceDocPath);

    const fieldPath = `${personId}.${sectionId}`;

    if (status === 'Not Marked') {
      await updateDoc(docRef, { [fieldPath]: deleteField() }).catch(e => console.error("Error removing attendance field:", e));
    } else {
      const section = sectionsWithOverrides.find(s => s.id === sectionId);
      const sectionStartTime = section ? section.startTime : '00:00';
      const now = new Date();

      if (status === 'Late' && minutesLate === 0) {
        if (selectedDate === todayString) {
          const [startHour, startMinute] = sectionStartTime.split(':').map(Number);
          const sectionStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute, 0);
          const diffInMs = now.getTime() - sectionStart.getTime();
          minutesLate = Math.max(0, Math.floor(diffInMs / (1000 * 60)));
        } else {
          minutesLate = Math.floor(section.duration / 4);
        }
      }

      if (status === 'Late') {
        minutesLate = Math.min(minutesLate, 50);
      }

      const newRecord = {
        status,
        timestamp: now.toISOString(),
        note: status === 'Excused' ? note : null,
        minutesLate: minutesLate > 0 ? minutesLate : 0,
      };

      await setDoc(docRef, { [personId]: { [sectionId]: newRecord } }, { merge: true }).catch(e => console.error("Error saving attendance:", e));
    }
  };

  const getAttendanceStatus = (personId, section, date, dailyAttendanceForDate) => {
    const isOut = isPersonMarkedOut(personId, date, section.id, sections, outRecords);
    if (isOut) {
      const outRecord = outRecords.find(record => record.personId === personId && isPersonMarkedOut(personId, date, section.id, sections, outRecords));
      return { status: 'Excused', minutesLate: 0, note: outRecord?.note, isDailyNote: true };
    }

    const singleClassRecord = dailyAttendanceForDate[personId]?.[section.id];
    if (singleClassRecord) return singleClassRecord;

    // Logic for past classes
    const now = new Date();
    const todayString2 = getTodayString();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMinute] = section.startTime.split(':').map(Number);
    const sectionTime = startHour * 60 + startMinute;
    const isPast = new Date(date) < new Date(todayString2) || (date === todayString2 && currentTime >= sectionTime + section.duration);

    if (isPast) {
      const isAnyStudentMarked = Object.values(dailyAttendanceForDate).some(personRecords => personRecords[section.id]);
      if (!isAnyStudentMarked) {
        return { status: 'Unmarked', minutesLate: 0, note: null };
      } else {
        // If some are marked, default to Excused, but show as Unmarked
        return { status: 'Unmarked', minutesLate: 0, note: 'Excused by default' };
      }
    }

    return { status: 'Not Marked', minutesLate: 0, note: null };
  };

  const handleUnmarkAll = async (sectionId) => {
    if (!userId || !dailyAttendance) return;

    setAttendanceHistory(prev => [...prev, dailyAttendance]);
    setRedoHistory([]);

    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/attendance/${selectedDate}`);
    const updates = {};
    Object.keys(dailyAttendance).forEach(personId => {
      if (dailyAttendance[personId][sectionId]) {
        updates[`${personId}.${sectionId}`] = deleteField();
      }
    });
    if (Object.keys(updates).length > 0) {
      await updateDoc(docRef, updates);
    }
  };

  const handleUndo = async () => {
    if (attendanceHistory.length === 0 || !userId) return;
    const lastState = attendanceHistory[attendanceHistory.length - 1];
    setRedoHistory(prev => [...prev, dailyAttendance]);
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/attendance/${selectedDate}`);
    await setDoc(docRef, lastState); // Overwrite with the previous state
    setAttendanceHistory(prev => prev.slice(0, -1));
  };

  const handleRedo = async () => {
    if (redoHistory.length === 0 || !userId) return;
    const nextState = redoHistory[redoHistory.length - 1];
    setAttendanceHistory(prev => [...prev, dailyAttendance]);
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/attendance/${selectedDate}`);
    await setDoc(docRef, nextState); // Overwrite with the redone state
    setRedoHistory(prev => prev.slice(0, -1));
  };

  // --- Persistent Note Logic ---
  const handlePersistentNoteSave = async (personId, sectionId, note) => {
    if (!userId) return;
    const noteDocRef = doc(db, `/artifacts/${appId}/users/${userId}/persistentNotes`, personId);
    try {
      await setDoc(noteDocRef, { [sectionId]: note }, { merge: true });
    } catch (e) {
      console.error("Error saving persistent note:", e);
    }
    setEditingPersistentNote(null);
  };

  // --- Absence Management Logic ---
  const handleAbsenceSave = async (record) => {
    if (!userId) return;
    const outRecordsCollectionPath = `/artifacts/${appId}/users/${userId}/outRecords`;
    if (record.id) {
      const docRef = doc(db, outRecordsCollectionPath, record.id);
      await updateDoc(docRef, record);
    } else {
      await addDoc(collection(db, outRecordsCollectionPath), record);
    }
  };

  const handleGroupAbsenceSave = async ({ records, groupIdToEdit }) => {
    if (!userId) return;
    const outRecordsCollectionPath = `/artifacts/${appId}/users/${userId}/outRecords`;
    const batch = writeBatch(db);

    if (groupIdToEdit) {
      const q = query(collection(db, outRecordsCollectionPath), where("groupId", "==", groupIdToEdit));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((d) => {
        batch.delete(d.ref);
      });
    }

    records.forEach(record => {
      const newDocRef = doc(collection(db, outRecordsCollectionPath));
      batch.set(newDocRef, record);
    });

    await batch.commit();
  };

  const handleAbsenceRemove = async (recordId) => {
    if (!userId) return;
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/outRecords`, recordId);
    await deleteDoc(docRef);
  };

  const handleGroupAbsenceDelete = async (groupId) => {
    if (!userId) return;
    const outRecordsCollectionPath = `/artifacts/${appId}/users/${userId}/outRecords`;
    const q = query(collection(db, outRecordsCollectionPath), where("groupId", "==", groupId));
    const querySnapshot = await getDocs(q);
    const batch = writeBatch(db);
    querySnapshot.forEach((d) => {
      batch.delete(d.ref);
    });
    await batch.commit();
  };

  // --- Settings Logic (People) ---
  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!userId) return;

    const nameInput = e.target.name.value.trim().split(' ');
    const firstName = nameInput.shift() || '';
    const lastName = nameInput.join(' ');

    const newPerson = {
      firstName: firstName,
      lastName: lastName,
      type: e.target.type.value,
      email: e.target.email.value,
    };

    try {
      const peopleCollectionPath = `/artifacts/${appId}/users/${userId}/people`;
      await addDoc(collection(db, peopleCollectionPath), newPerson);
      e.target.reset();
    } catch (error) {
      console.error("Error adding person to Firestore:", error);
    }
  };

  const handleEditPerson = async (e, id) => {
    e.preventDefault();
    if (!userId) return;

    const nameInput = e.target.name.value.trim().split(' ');
    const firstName = nameInput.shift() || '';
    const lastName = nameInput.join(' ');

    const updatedPersonData = {
      firstName: firstName,
      lastName: lastName,
      type: e.target.type.value,
      email: e.target.email.value,
    };

    try {
      const personDocRef = doc(db, `/artifacts/${appId}/users/${userId}/people`, id);
      await updateDoc(personDocRef, updatedPersonData);
      setEditingPerson(null);
    } catch (error) {
      console.error("Error updating person:", error);
    }
  };

  const handleRemovePerson = async (id) => {
    if (!userId) return;
    try {
      const personDocRef = doc(db, `/artifacts/${appId}/users/${userId}/people`, id);
      await deleteDoc(personDocRef);
    } catch (error) {
      console.error("Error removing person:", error);
    }
  };

  // --- Settings Logic (Sections) ---
  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!userId) return;

    const newSection = {
      name: e.target.name.value,
      startTime: e.target.startTime.value,
      duration: parseInt(e.target.duration.value, 10) || 60,
    };

    try {
      const sectionsCollectionPath = `/artifacts/${appId}/users/${userId}/sections`;
      await addDoc(collection(db, sectionsCollectionPath), newSection);
      e.target.reset();
    } catch (error) {
      console.error("Error adding section:", error);
    }
  };

  const handleEditSection = async (e, id) => {
    e.preventDefault();
    if (!userId) return;

    const updatedSectionData = {
      name: e.target.name.value,
      startTime: e.target.startTime.value,
      duration: parseInt(e.target.duration.value, 10) || 60,
    };

    try {
      const sectionDocRef = doc(db, `/artifacts/${appId}/users/${userId}/sections`, id);
      await updateDoc(sectionDocRef, updatedSectionData);
      setEditingSection(null);
    } catch (error) {
      console.error("Error updating section:", error);
    }
  };

  const handleRemoveSection = async (id) => {
    if (!userId) return;
    try {
      const sectionDocRef = doc(db, `/artifacts/${appId}/users/${userId}/sections`, id);
      await deleteDoc(sectionDocRef);
    } catch (error) {
      console.error("Error removing section:", error);
    }
  };

  // --- Daily Schedule Overrides Logic ---
  const openOverrideModal = (sectionId, currentTime) => {
    setScheduleOverrideModal({
      isOpen: true,
      sectionId: sectionId,
      newTime: currentTime || '',
      date: selectedDate, // Initialize with the currently selected date
    });
  };

  const handleSaveOverride = async () => {
    const { sectionId, newTime, date } = scheduleOverrideModal;
    if (!userId || !sectionId || !newTime || !date) return;
    const overrideId = `${date}_${sectionId}`;
    const overrideDocRef = doc(db, `/artifacts/${appId}/users/${userId}/dailyScheduleOverrides`, overrideId);
    try {
      await setDoc(overrideDocRef, { date, sectionId, newTime });
      setScheduleOverrideModal({ isOpen: false, sectionId: null, newTime: '', date: '' });
    } catch (error) {
      console.error("Error saving schedule override:", error);
    }
  };

  const handleRemoveOverride = async (sectionId, date) => {
    if (!userId) return;
    const overrideId = `${date}_${sectionId}`;
    const overrideDocRef = doc(db, `/artifacts/${appId}/users/${userId}/dailyScheduleOverrides`, overrideId);
    try {
      await deleteDoc(overrideDocRef);
      setScheduleOverrideModal({ isOpen: false, sectionId: null, newTime: '', date: '' });
    } catch (error) {
      console.error("Error removing schedule override:", error);
    }
  };

  const handleDateChange = (days) => {
    const currentDateObj = new Date(selectedDate);
    currentDateObj.setUTCDate(currentDateObj.getUTCDate() + days);
    setSelectedDate(currentDateObj.toISOString().split('T')[0]);
  };

  const handlePrint = (elementId) => {
    const printElement = document.getElementById(elementId);
    if (!printElement) {
      console.error("Element to print not found:", elementId);
      return;
    }

    const printContents = printElement.innerHTML;
    const printWindow = window.open('', '', 'height=800,width=1000');

    printWindow.document.write('<html><head><title>Print Report</title>');

    printWindow.document.write(`
      <style>
        body { font-family: sans-serif; background-color: #ffffff !important; color: #111827 !important; }
        .no-print { display: none !important; }
        .printable-container { background-color: #ffffff !important; border: 1px solid #e5e7eb; border-radius: 0.5rem !important; padding: 1.5rem !important; }
        h2 { font-size: 1.75rem; font-weight: bold; margin-bottom: 1.5rem; }
        h3 { font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem; color: #111827 !important;}
        .font-bold { font-weight: 700 !important; }
        #dashboard-report-printable ul { list-style: none; padding: 0; }
        #dashboard-report-printable li { background-color: #f9fafb !important; border: 1px solid #e5e7eb !important; border-radius: 0.375rem !important; padding: 1rem !important; margin-bottom: 0.75rem !important; }
        #dashboard-report-printable li button { display: flex !important; justify-content: space-between !important; align-items: center; width: 100% !important; background-color: transparent !important; border: none !important; padding: 0 !important; font-size: 1rem; }
        #comprehensive-report-printable .summary-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 1rem !important; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem; }
        #comprehensive-report-printable .summary-grid > div { text-align: center; }
        #comprehensive-report-printable .summary-grid .stat-label { font-size: 0.875rem; color: #6b7280; }
        #comprehensive-report-printable .summary-grid .stat-value { font-size: 1.875rem; font-weight: bold; }
        #comprehensive-report-printable .per-class-list { list-style: none; padding: 0; }
        #comprehensive-report-printable .per-class-list li { background-color: #f9fafb !important; border: 1px solid #e5e7eb !important; border-radius: 0.375rem !important; padding: 0.75rem !important; margin-bottom: 0.5rem !important; display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; align-items: center; }
        .recharts-cartesian-axis-tick-value, .recharts-legend-item-text, .recharts-tooltip-label, .recharts-tooltip-item { fill: #374151 !important; }
        .recharts-cartesian-grid-line, .recharts-line-line { stroke: #d1d5db !important; }
      </style>
    `);

    printWindow.document.write('</head><body>');
    printWindow.document.write(printContents);
    printWindow.document.write('</body></html>');
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  const handleSortChange = async (newSortField) => {
    setSortField(newSortField);
    setSavedSortField(newSortField);
    if (!userId) return;
    const settingsDocRef = doc(db, `/artifacts/${appId}/users/${userId}/settings/userPreferences`);
    try {
      await setDoc(settingsDocRef, { sortField: newSortField }, { merge: true });
    } catch (e) {
      console.error("Error saving sort preference:", e);
    }
  };

  // --- UI Components ---
  const AttendanceStatusSelector = ({ personId, sectionId, date, onAttendanceChange, initialStatus, isPast }) => {
    const { status, minutesLate: initialMinutesLate, note: initialNote, isDailyNote } = initialStatus;

    const [isEditingNote, setIsEditingNote] = useState(false);
    const [tempNoteText, setTempNoteText] = useState(initialNote || '');
    useEffect(() => { setTempNoteText(initialNote || ''); }, [initialNote]);

    const [isEditingLateness, setIsEditingLateness] = useState(false);
    const [manualMinutesLate, setManualMinutesLate] = useState(initialMinutesLate);
    useEffect(() => { setManualMinutesLate(initialMinutesLate); }, [initialMinutesLate]);

    const [isExpanded, setIsExpanded] = useState(initialStatus.status !== 'Unmarked' && (initialStatus.status !== 'Not Marked' || !isPast));

    if (isDailyNote) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-600 bg-opacity-100 text-white flex items-center gap-1" title={initialNote || 'Excused'}>
            <MinusCircle size={16} /> <span className="hidden sm:inline">Excused</span>
          </span>
          {initialNote && <p className="mt-1 text-xs text-blue-300 max-w-[100px] truncate" title={initialNote}>{initialNote}</p>}
        </div>
      );
    }

    if (!isExpanded) {
      return (
        <button onClick={() => setIsExpanded(true)} className="px-3 py-1 rounded-full text-sm font-medium bg-gray-600 text-gray-300 hover:bg-gray-500 flex items-center gap-1">
          <CircleSlash size={16} /> <span className="hidden sm:inline">{status === 'Unmarked' ? 'Unmarked' : 'Mark'}</span>
        </button>
      )
    }

    const handleExcusedNoteSave = () => {
      onAttendanceChange(personId, sectionId, 'Excused', tempNoteText);
      setIsEditingNote(false);
      setIsExpanded(false);
    };

    const handleEditNoteOpen = () => {
      setTempNoteText(initialNote || '');
      setIsEditingNote(true);
    };

    const handleLatenessSave = () => {
      let newMinutes = parseInt(manualMinutesLate, 10) || 0;
      newMinutes = Math.min(newMinutes, 50);
      onAttendanceChange(personId, sectionId, 'Late', null, newMinutes);
      setIsEditingLateness(false);
      setIsExpanded(false);
    };

    const handleStatusClick = (newStatus) => {
      const finalStatus = status === newStatus ? 'Not Marked' : newStatus;
      onAttendanceChange(personId, sectionId, finalStatus, finalStatus === 'Excused' ? initialNote : null);
      setIsEditingNote(false);
      if (initialStatus.status === 'Unmarked' || initialStatus.status === 'Not Marked') setIsExpanded(false);
    };

    const StatusButton = ({ s, label, icon, className }) => (
      <button onClick={() => handleStatusClick(s)} className={`px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 ${status === s ? `bg-opacity-100 text-white ${className}` : `bg-gray-700 bg-opacity-50 text-gray-400 hover:bg-opacity-70`} flex items-center gap-1`}>
        {icon} <span className="hidden sm:inline">{label}</span>
      </button>
    );

    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="relative flex items-center space-x-1">
          <StatusButton s="On Time" label="On Time" icon={<CheckCircle size={16} />} className="bg-green-600" />
          <StatusButton s="Late" label="Late" icon={<Clock size={16} />} className="bg-yellow-500" />
          <StatusButton s="Excused" label="Excused" icon={<MinusCircle size={16} />} className="bg-blue-600" />
          {isPast && <StatusButton s="Absent" label="Absent" icon={<XCircle size={16} />} className="bg-red-600" />}
          {status === 'Excused' && (
            <div className="relative">
              <button onClick={handleEditNoteOpen} className={`p-2 rounded-full transition-colors ${isEditingNote ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`} title="Edit Excused Note"><Pencil size={16} /></button>
              {isEditingNote && (
                <div className="absolute z-20 right-0 top-full mt-2 p-3 bg-gray-800 rounded-lg shadow-lg w-64 border border-gray-700">
                  <textarea className="w-full h-16 p-2 text-sm bg-gray-900 text-white rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Add excused note..." value={tempNoteText} onChange={(e) => setTempNoteText(e.target.value)}></textarea>
                  <button onClick={handleExcusedNoteSave} className="mt-2 w-full bg-blue-600 text-white py-1 rounded-md text-sm hover:bg-blue-700 transition-colors">Save Note</button>
                </div>
              )}
            </div>
          )}
          {status === 'Late' && (
            <div className="relative">
              <button onClick={() => setIsEditingLateness(!isEditingLateness)} className={`p-2 rounded-full transition-colors ${isEditingLateness ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`} title="Edit Lateness">
                <span className="text-xs font-bold">{initialMinutesLate > 0 ? formatMinutes(initialMinutesLate) : <Clock size={16} />}</span>
              </button>
              {isEditingLateness && (
                <div className="absolute z-20 right-0 top-full mt-2 p-3 bg-gray-800 rounded-lg shadow-lg w-48 border border-gray-700">
                  <label className="block text-xs text-gray-400 mb-1">Minutes Late</label>
                  <input type="number" className="w-full p-2 text-sm bg-gray-900 text-white rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-500" value={manualMinutesLate} onChange={(e) => setManualMinutesLate(e.target.value)} />
                  <button onClick={handleLatenessSave} className="mt-2 w-full bg-yellow-600 text-white py-1 rounded-md text-sm hover:bg-yellow-700 transition-colors">Save</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Main App Render ---
  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* --- Header --- */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 no-print">
          <div>
            <h1 className="text-3xl font-bold text-white">{currentDate}</h1>
            <p className="text-lg text-gray-400">{hebrewDate}</p>
          </div>
          <div className="flex items-center gap-2 mt-4 sm:mt-0">
            {view === 'main' ? (
              <button onClick={() => setView('reportsDashboard')} className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
                <AreaChart size={20} />
                <span>Reports</span>
              </button>
            ) : (
              <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
                <LayoutGrid size={20} />
                <span>Back to Main</span>
              </button>
            )}
            <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
              <Settings2 size={20} />
              <span>Settings</span>
            </button>
          </div>
        </header>

        {/* --- Controls --- */}
        {view === 'main' && (
          <div className="bg-gray-800 p-4 rounded-lg mb-6 flex flex-col md:flex-row items-center justify-between gap-4 flex-wrap no-print">
            <div className="flex items-center gap-2">
              <button onClick={() => handleDateChange(-1)} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600"><ChevronLeft size={20}/></button>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-gray-700 border-gray-600 rounded-lg px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500" />
              <button onClick={() => handleDateChange(1)} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600"><ChevronRight size={20}/></button>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="period-filter" className="text-gray-400 text-sm">Period:</label>
              <select id="period-filter" value={selectedPeriodFilter} onChange={(e) => setSelectedPeriodFilter(e.target.value)} className="bg-gray-700 border-gray-600 rounded-lg px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500">
                <option value="all">All Periods</option>
                {sections.map(s => (<option key={s.id} value={s.id}>{`${s.name} (${s.startTime})`}</option>))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="sort-filter" className="text-gray-400 text-sm">Sort By:</label>
              <select id="sort-filter" value={sortField} onChange={(e) => handleSortChange(e.target.value)} className="bg-gray-700 border-gray-600 rounded-lg px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500">
                <option value="lastName">Last Name</option>
                <option value="firstName">First Name</option>
                <option value="note" disabled={selectedPeriodFilter === 'all'}>Note</option>
              </select>
            </div>
            <div className="relative w-full md:w-auto">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search names..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-gray-700 border-gray-600 rounded-lg pl-10 pr-4 py-2 w-full md:w-64 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => setIsGroupAbsenceModalOpen(true)} className="flex items-center gap-2 px-3 py-1 bg-gray-700 rounded-full hover:bg-gray-600"><Users size={16} /> Group Absence</button>
              <button onClick={handleUndo} disabled={attendanceHistory.length === 0} className="flex items-center gap-2 px-3 py-1 bg-gray-700 rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"><Undo size={16} /> Undo</button>
              <button onClick={handleRedo} disabled={redoHistory.length === 0} className="flex items-center gap-2 px-3 py-1 bg-gray-700 rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"><RotateCw size={16} /> Redo</button>
            </div>
          </div>
        )}

        {/* --- Main Content: Grid or Summary --- */}
        {view === 'main' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-800">
                <tr>
                  <th className="sticky left-0 bg-gray-800 py-3.5 px-4 text-left text-sm font-semibold text-white z-10">Name</th>
                  {filteredSectionsForView.map(section => {
                    const now = new Date();
                    const todayString2 = getTodayString();
                    const currentTime = now.getHours() * 60 + now.getMinutes();
                    const [startHour, startMinute] = section.startTime.split(':').map(Number);
                    const sectionTime = startHour * 60 + startMinute;
                    const isPast = new Date(selectedDate) < new Date(todayString2) || (selectedDate === todayString2 && currentTime >= sectionTime + section.duration);
                    return (
                      <th key={section.id} className={`py-3.5 px-4 text-center text-sm font-semibold text-white ${section.id === currentSectionId ? 'bg-blue-900' : ''}`}>
                        <div className="flex flex-col items-center">
                          <span>{section.name}</span>
                          <span className={`text-xs ${overrideForActiveSection && overrideForActiveSection.sectionId === section.id ? 'text-yellow-400' : 'text-gray-400'}`}>{section.startTime}</span>
                          <button onClick={() => openOverrideModal(section.id, section.startTime)} className="text-gray-500 hover:text-yellow-400"><Pencil size={12}/></button>
                          {isPast && (
                            <button onClick={() => handleUnmarkAll(section.id)} className="mt-1 text-xs bg-gray-600 hover:bg-gray-500 px-2 py-0.5 rounded-md">
                              Unmark All
                            </button>
                          )}
                        </div>
                      </th>
                    )
                  })}
                  <th className="py-3.5 px-4 text-left text-sm font-semibold text-white">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-800/50">
                {sortedStudents.map(person => (
                  <tr key={person.id} className="hover:bg-gray-700/50">
                    <td className="sticky left-0 bg-gray-800/50 py-4 px-4 text-sm font-medium text-white whitespace-nowrap z-10">{`${person.firstName} ${person.lastName}`}</td>
                    {filteredSectionsForView.map(section => {
                      const now = new Date();
                      const todayString2 = getTodayString();
                      const currentTime = now.getHours() * 60 + now.getMinutes();
                      const [startHour, startMinute] = section.startTime.split(':').map(Number);
                      const sectionTime = startHour * 60 + startMinute;
                      const isPast = new Date(selectedDate) < new Date(todayString2) || (selectedDate === todayString2 && currentTime >= sectionTime + section.duration);
                      return (
                        <td key={section.id} className="py-2 px-2 text-sm text-gray-300 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <AttendanceStatusSelector personId={person.id} sectionId={section.id} date={selectedDate} onAttendanceChange={handleAttendanceChange} initialStatus={getAttendanceStatus(person.id, section, selectedDate, dailyAttendance)} isPast={isPast} />
                            <button onClick={() => setEditingPersistentNote({personId: person.id, sectionId: section.id})} className="text-gray-500 hover:text-blue-400" title="Add/Edit Persistent Note"><MessageSquarePlus size={16} /></button>
                          </div>
                          {persistentNotes[person.id]?.[section.id] && <p className="mt-1 text-xs text-cyan-400 bg-gray-900/50 rounded-md px-2 py-0.5 max-w-xs mx-auto truncate" title={persistentNotes[person.id][section.id]}>{persistentNotes[person.id][section.id]}</p>}
                        </td>
                      )})}
                    <td className="py-4 px-4 text-sm font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setManagingAbsences({ isOpen: true, personId: person.id })} className="p-2 text-gray-400 hover:text-blue-400" title="Manage Absences"><CalendarX size={18} /></button>
                        <button onClick={() => { setView('summary'); setSelectedPersonId(person.id); }} className="p-2 text-gray-400 hover:text-green-400" title="View Summary"><FileText size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={filteredSectionsForView.length + 2} className="py-2 bg-gray-800 text-center font-bold text-gray-400">Shluchim</td></tr>
                {sortedShluchim.map(person => (
                  <tr key={person.id} className="hover:bg-gray-700/50">
                    <td className="sticky left-0 bg-gray-800/50 py-4 px-4 text-sm font-medium text-white whitespace-nowrap z-10">{`${person.firstName} ${person.lastName}`}</td>
                    {filteredSectionsForView.map(section => {
                      const now = new Date();
                      const todayString2 = getTodayString();
                      const currentTime = now.getHours() * 60 + now.getMinutes();
                      const [startHour, startMinute] = section.startTime.split(':').map(Number);
                      const sectionTime = startHour * 60 + startMinute;
                      const isPast = new Date(selectedDate) < new Date(todayString2) || (selectedDate === todayString2 && currentTime >= sectionTime + section.duration);
                      return (
                        <td key={section.id} className="py-2 px-2 text-sm text-gray-300 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <AttendanceStatusSelector personId={person.id} sectionId={section.id} date={selectedDate} onAttendanceChange={handleAttendanceChange} initialStatus={getAttendanceStatus(person.id, section, selectedDate, dailyAttendance)} isPast={isPast} />
                            <button onClick={() => setEditingPersistentNote({personId: person.id, sectionId: section.id})} className="text-gray-500 hover:text-blue-400" title="Add/Edit Persistent Note"><MessageSquarePlus size={16} /></button>
                          </div>
                          {persistentNotes[person.id]?.[section.id] && <p className="mt-1 text-xs text-cyan-400 bg-gray-900/50 rounded-md px-2 py-0.5 max-w-xs mx-auto truncate" title={persistentNotes[person.id][section.id]}>{persistentNotes[person.id][section.id]}</p>}
                        </td>
                      )})}
                    <td className="py-4 px-4 text-sm font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setManagingAbsences({ isOpen: true, personId: person.id })} className="p-2 text-gray-400 hover:text-blue-400" title="Manage Absences"><CalendarX size={18} /></button>
                        <button onClick={() => { setView('summary'); setSelectedPersonId(person.id); }} className="p-2 text-gray-400 hover:text-green-400" title="View Summary"><FileText size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'reportsDashboard' && (
          <ReportsDashboard
            people={people}
            sections={sections}
            attendanceData={allAttendanceData}
            outRecords={outRecords}
            dailyScheduleOverrides={dailyScheduleOverrides}
            onSelectPerson={(personId) => {
              setSelectedPersonId(personId);
              setView('summary');
            }}
            onBack={() => setView('main')}
            onPrint={handlePrint}
          />
        )}

        {view === 'summary' && selectedPersonId && (
          <ComprehensiveStudentReport
            personId={selectedPersonId}
            people={people}
            sections={sections}
            persistentNotes={persistentNotes}
            attendanceData={allAttendanceData}
            outRecords={outRecords}
            dailyScheduleOverrides={dailyScheduleOverrides}
            onBack={() => setView('reportsDashboard')}
            onPrint={handlePrint}
          />
        )}

        {isGroupAbsenceModalOpen && (
          <GroupAbsenceModal
            people={people}
            sections={sections}
            outRecords={outRecords}
            onClose={() => setIsGroupAbsenceModalOpen(false)}
            onSave={handleGroupAbsenceSave}
            onDelete={handleGroupAbsenceDelete}
          />
        )}

        {managingAbsences.isOpen && (
          <AbsenceManagementModal
            person={people.find(p => p.id === managingAbsences.personId)}
            sections={sections}
            personRecords={outRecords.filter(r => r.personId === managingAbsences.personId)}
            onClose={() => setManagingAbsences({ isOpen: false, personId: null })}
            onSave={handleAbsenceSave}
            onDelete={handleAbsenceRemove}
          />
        )}

        {editingPersistentNote && (
          <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-xl font-bold mb-4">
                Persistent Note for {people.find(p => p.id === editingPersistentNote.personId)?.firstName}
                <br/>
                in {sections.find(s => s.id === editingPersistentNote.sectionId)?.name}
              </h3>
              <textarea
                defaultValue={persistentNotes[editingPersistentNote.personId]?.[editingPersistentNote.sectionId] || ''}
                onBlur={(e) => handlePersistentNoteSave(editingPersistentNote.personId, editingPersistentNote.sectionId, e.target.value)}
                placeholder="e.g., Goes to Rabbi Goodman"
                className="w-full bg-gray-700 rounded-md p-2 h-24 text-white"
              />
              <div className="mt-4 flex justify-end">
                <button onClick={() => setEditingPersistentNote(null)} className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700">Done</button>
              </div>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-70 z-40 flex justify-center items-center p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-gray-700"><XCircle size={24}/></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Manage People */}
                <div>
                  <h3 className="text-xl font-semibold mb-3">Manage People</h3>
                  <form onSubmit={handleAddPerson} className="space-y-4 bg-gray-700/50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                      <input name="name" type="text" placeholder="e.g., Rivka Cohen" required className="w-full bg-gray-700 rounded-md p-2"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                      <textarea name="email" placeholder="e.g., student@example.com, parent@example.com" required className="w-full bg-gray-700 rounded-md p-2 h-20"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
                      <select name="type" className="w-full bg-gray-700 rounded-md p-2">
                        <option value="student">Student</option>
                        <option value="shliach">Shliach</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full flex justify-center items-center gap-2 bg-blue-600 p-2 rounded-md hover:bg-blue-700">
                      <Plus size={20}/> Add Person
                    </button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {people.map(p => (
                      <div key={p.id} className="bg-gray-700 p-3 rounded-md">
                        {editingPerson === p.id ? (
                          <form onSubmit={(e) => handleEditPerson(e, p.id)} className="w-full space-y-3">
                            <div>
                              <label className="text-xs text-gray-400">Full Name</label>
                              <input name="name" defaultValue={`${p.firstName} ${p.lastName}`} className="w-full bg-gray-900 rounded-md p-2 text-sm"/>
                            </div>
                            <div>
                              <label className="text-xs text-gray-400">Email</label>
                              <textarea name="email" defaultValue={p.email} className="w-full bg-gray-900 rounded-md p-2 text-sm h-20"/>
                            </div>
                            <div>
                              <label className="text-xs text-gray-400">Type</label>
                              <select name="type" defaultValue={p.type} className="w-full bg-gray-900 rounded-md p-2 text-sm">
                                <option value="student">Student</option>
                                <option value="shliach">Shliach</option>
                              </select>
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                              <button type="button" onClick={() => setEditingPerson(null)} className="px-3 py-1 bg-gray-600 rounded-md text-sm">Cancel</button>
                              <button type="submit" className="px-3 py-1 bg-green-600 rounded-md text-sm">Save</button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex justify-between items-center">
                            <span>{`${p.firstName} ${p.lastName}`} <span className="text-xs text-gray-400">({p.type})</span></span>
                            <div className="flex gap-2">
                              <button onClick={() => setEditingPerson(p.id)} className="text-gray-400 hover:text-yellow-400"><Pencil size={18}/></button>
                              <button onClick={() => handleRemovePerson(p.id)} className="text-gray-400 hover:text-red-400"><Trash2 size={18}/></button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Manage Sections */}
                <div>
                  <h3 className="text-xl font-semibold mb-3">Manage Schedule Sections</h3>
                  <form onSubmit={handleAddSection} className="space-y-4 bg-gray-700/50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Section Name</label>
                      <input name="name" type="text" placeholder="e.g., Class 1" required className="w-full bg-gray-700 rounded-md p-2"/>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Start Time</label>
                        <input name="startTime" type="time" required className="w-full bg-gray-700 rounded-md p-2"/>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Duration (min)</label>
                        <input name="duration" type="number" placeholder="e.g., 50" required className="w-full bg-gray-700 rounded-md p-2"/>
                      </div>
                    </div>
                    <button type="submit" className="w-full flex justify-center items-center gap-2 bg-blue-600 p-2 rounded-md hover:bg-blue-700">
                      <Plus size={20}/> Add Section
                    </button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {sections.map(s => (
                      <div key={s.id} className="bg-gray-700 p-3 rounded-md">
                        {editingSection === s.id ? (
                          <form onSubmit={(e) => handleEditSection(e, s.id)} className="w-full space-y-3">
                            <div>
                              <label className="text-xs text-gray-400">Section Name</label>
                              <input name="name" defaultValue={s.name} className="w-full bg-gray-900 rounded-md p-2 text-sm"/>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-400">Start Time</label>
                                <input name="startTime" type="time" defaultValue={s.startTime} className="w-full bg-gray-900 rounded-md p-2 text-sm"/>
                              </div>
                              <div>
                                <label className="text-xs text-gray-400">Duration</label>
                                <input name="duration" type="number" defaultValue={s.duration} className="w-full bg-gray-900 rounded-md p-2 text-sm"/>
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                              <button type="button" onClick={() => setEditingSection(null)} className="px-3 py-1 bg-gray-600 rounded-md text-sm">Cancel</button>
                              <button type="submit" className="px-3 py-1 bg-green-600 rounded-md text-sm">Save</button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex justify-between items-center">
                            <span>{s.name} ({s.startTime}) - {s.duration} min</span>
                            <div className="flex gap-2">
                              <button onClick={() => setEditingSection(s.id)} className="text-gray-400 hover:text-yellow-400"><Pencil size={18}/></button>
                              <button onClick={() => handleRemoveSection(s.id)} className="text-gray-400 hover:text-red-400"><Trash2 size={18}/></button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <h3 className="text-xl font-semibold mt-8 mb-3">Email Settings</h3>
                  <div className="space-y-4 bg-gray-700/50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Report Frequency</label>
                      <select value={emailFrequency} onChange={(e) => setEmailFrequency(e.target.value)} className="w-full bg-gray-700 rounded-md p-2">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="never">Never</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {scheduleOverrideModal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6">
              <h3 className="text-xl font-bold mb-4">Change Time for {sections.find(s => s.id === scheduleOverrideModal.sectionId)?.name}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduleOverrideModal.date}
                    onChange={(e) => setScheduleOverrideModal(prev => ({...prev, date: e.target.value}))}
                    className="w-full bg-gray-700 rounded-md p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">New Start Time</label>
                  <input
                    type="time"
                    value={scheduleOverrideModal.newTime}
                    onChange={(e) => setScheduleOverrideModal(prev => ({...prev, newTime: e.target.value}))}
                    className="w-full bg-gray-700 rounded-md p-2"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-between items-center">
                <button onClick={() => handleRemoveOverride(scheduleOverrideModal.sectionId, scheduleOverrideModal.date)} className="text-red-400 hover:text-red-500 text-sm">Remove Override</button>
                <div className="flex gap-3">
                  <button onClick={() => setScheduleOverrideModal({isOpen: false, sectionId: null, newTime: '', date: ''})} className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-700">Cancel</button>
                  <button onClick={handleSaveOverride} className="px-4 py-2 bg-yellow-600 rounded-lg hover:bg-yellow-700">Save Time</button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// --- New Comprehensive Student Report Component ---
const ComprehensiveStudentReport = ({ personId, people, sections, persistentNotes, attendanceData, outRecords, onBack, dailyScheduleOverrides, onPrint }) => {
  const person = people.find(p => p.id === personId);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  const summaryStats = useMemo(() => {
    return calculateSummaryStats(personId, attendanceData, sections, dailyScheduleOverrides, startDate, endDate, outRecords);
  }, [personId, attendanceData, sections, dailyScheduleOverrides, startDate, endDate, outRecords]);

  const weeklyPerformanceData = useMemo(() => {
    const getWeekIdentifier = (dateStr) => {
      const date = new Date(dateStr);
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    };

    const weeklyStats = {};

    const datesToProcess = Object.keys(attendanceData).filter(date => {
      const currentDateObj = new Date(date);
      const currentDate = new Date(currentDateObj.valueOf() + currentDateObj.getTimezoneOffset() * 60 * 1000);
      if (startDate && currentDate < startDate) return false;
      if (endDate && currentDate > endDate) return false;
      return true;
    });

    datesToProcess.forEach(date => {
      const personDayData = attendanceData[date]?.[personId];
      const weekId = getWeekIdentifier(date);
      if (!weeklyStats[weekId]) {
        weeklyStats[weekId] = { totalMinutesPossible: 0, totalMinutesAttended: 0, week: weekId };
      }

      const sectionsForThisDay = sections.map(sec => {
        const override = dailyScheduleOverrides.find(o => o.sectionId === sec.id && o.date === date);
        return { ...sec, startTime: override ? override.newTime : sec.startTime };
      });

      sectionsForThisDay.forEach(section => {
        const wasClassHeldForAnyStudent = attendanceData[date] && Object.values(attendanceData[date]).some(personRecords => personRecords[section.id]);
        if (wasClassHeldForAnyStudent) {
          const record = personDayData?.[section.id];
          const isOut = isPersonMarkedOut(personId, date, section.id, sections, outRecords);

          if (!isOut && record?.status !== 'Excused') {
            weeklyStats[weekId].totalMinutesPossible += section.duration;
            if (record && record.status === 'On Time') {
              weeklyStats[weekId].totalMinutesAttended += section.duration;
            } else if (record && record.status === 'Late') {
              weeklyStats[weekId].totalMinutesAttended += Math.max(0, section.duration - (record.minutesLate || 0));
            }
          }
        }
      });
    });

    return Object.values(weeklyStats)
      .filter(stats => stats.totalMinutesPossible > 0)
      .map((stats) => ({
        week: stats.week,
        percentage: (stats.totalMinutesAttended / stats.totalMinutesPossible) * 100,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

  }, [personId, attendanceData, sections, dailyScheduleOverrides, outRecords, startDate, endDate]);

  const handlePresetSelect = (preset) => {
    let start, end;
    const today = new Date();
    end = today;

    switch(preset) {
      case 'week':
        start = new Date(today);
        start.setDate(today.getDate() - today.getDay()); // Sunday
        break;
      case 'month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      default: // all
        start = null;
        end = null;
    }
    setStartDate(start);
    setEndDate(end);
  };

  if (!person) {
    return <div>Loading...</div>;
  }

  return (
    <div id="comprehensive-report-printable" className="bg-gray-800 p-6 rounded-lg printable-container">
      <div className="flex justify-between items-center mb-6 no-print">
        <h2 className="text-2xl font-bold">Report for {person.firstName} {person.lastName}</h2>
        <div className="flex gap-2">
          <button onClick={() => onPrint('comprehensive-report-printable')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700">
            <Printer size={20} />
            <span>Print</span>
          </button>
          <button onClick={onBack} className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600">Back to Reports</button>
        </div>
      </div>

      <div className="bg-gray-900/50 p-4 rounded-lg mb-6 flex flex-col md:flex-row items-center justify-between gap-4 flex-wrap no-print">
        <div className="flex items-center gap-2">
          <label className="text-sm">From:</label>
          <input type="date" value={startDate ? startDate.toISOString().split('T')[0] : ''} onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : null)} className="bg-gray-700 rounded-md p-2"/>
          <label className="text-sm">To:</label>
          <input type="date" value={endDate ? endDate.toISOString().split('T')[0] : ''} onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : null)} className="bg-gray-700 rounded-md p-2"/>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handlePresetSelect('week')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">This Week</button>
          <button onClick={() => handlePresetSelect('month')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">This Month</button>
          <button onClick={() => handlePresetSelect('all')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">All Time</button>
        </div>
      </div>

      <div className="bg-gray-900 p-4 rounded-lg mb-6 summary-grid">
        <div className="text-center">
          <p className="text-sm text-gray-400 stat-label">Percentage of Minutes Present</p>
          <p className={`text-3xl font-bold ${getPercentageColor(summaryStats.presentPercentage)} stat-value`}>
            {summaryStats.presentPercentage === "N/A" ? "N/A" : `${summaryStats.presentPercentage}%`}
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-400 stat-label">Total Minutes Late</p>
          <p className={`text-3xl font-bold text-yellow-400 stat-value`}>{summaryStats.totalMinutesLate}</p>
        </div>
      </div>

      <h3 className="text-xl font-bold mb-4 mt-8">Weekly Performance Trend</h3>
      <div className="bg-gray-900/50 p-4 rounded-lg h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={weeklyPerformanceData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="week" stroke="#A0AEC0" />
            <YAxis unit="%" domain={[0, 100]} stroke="#A0AEC0"/>
            <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568' }}/>
            <Legend />
            <Line type="monotone" dataKey="percentage" stroke="#63B3ED" name="Attendance %" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3 className="text-xl font-bold mb-4 mt-8">Per-Class Report</h3>
      <div className="bg-gray-900/50 p-4 rounded-lg">
        <ul className="space-y-2 per-class-list">
          {sections.map((section) => {
            const pNote = persistentNotes[personId]?.[section.id];
            const classStats = summaryStats.perClassStats[section.id];
            return (
              <li key={section.id}>
                <div className="text-left">
                  <span className="font-semibold">{section.name} ({section.startTime})</span>
                </div>
                <div className="text-center">
                  {pNote && <span className="text-xs text-cyan-400 italic">{pNote}</span>}
                </div>
                <div className="text-right">
                  <span className={`text-lg font-bold ${getPercentageColor(classStats?.percentage)}`}>
                    {classStats?.percentage === "N/A" ? "N/A" : `${classStats?.percentage}%`}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// --- New Reports Dashboard Component ---
const ReportsDashboard = ({ people, sections, attendanceData, outRecords, onSelectPerson, onBack, dailyScheduleOverrides, onPrint }) => {
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  const handlePresetSelect = (preset) => {
    let start, end;
    const today = new Date();
    end = today;

    switch(preset) {
      case 'week':
        start = new Date(today);
        start.setDate(today.getDate() - today.getDay()); // Sunday
        break;
      case 'month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      default: // all
        start = null;
        end = null;
    }
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div id="dashboard-report-printable" className="bg-gray-800 p-6 rounded-lg printable-container">
      <div className="flex justify-between items-center mb-6 no-print">
        <h2 className="text-2xl font-bold">Reports Dashboard</h2>
        <div className="flex gap-2">
          <button onClick={() => onPrint('dashboard-report-printable')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700">
            <Printer size={20} />
            <span>Print</span>
          </button>
          <button onClick={onBack} className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600">Back to Grid</button>
        </div>
      </div>

      <div className="bg-gray-900/50 p-4 rounded-lg mb-6 flex flex-col md:flex-row items-center justify-between gap-4 flex-wrap no-print">
        <div className="flex items-center gap-2">
          <label className="text-sm">From:</label>
          <input type="date" value={startDate ? startDate.toISOString().split('T')[0] : ''} onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : null)} className="bg-gray-700 rounded-md p-2"/>
          <label className="text-sm">To:</label>
          <input type="date" value={endDate ? endDate.toISOString().split('T')[0] : ''} onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : null)} className="bg-gray-700 rounded-md p-2"/>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handlePresetSelect('week')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">This Week</button>
          <button onClick={() => handlePresetSelect('month')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">This Month</button>
          <button onClick={() => handlePresetSelect('all')} className="px-3 py-1 text-sm bg-gray-700 rounded-md hover:bg-gray-600">All Time</button>
        </div>
      </div>

      <div className="bg-gray-900/50 p-4 rounded-lg">
        <ul className="space-y-2">
          {people.map(person => {
            const { presentPercentage } = calculateSummaryStats(person.id, attendanceData, sections, dailyScheduleOverrides, startDate, endDate, outRecords);
            return (
              <li key={person.id}>
                <button
                  onClick={() => onSelectPerson(person.id)}
                  className="w-full text-left p-3 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors flex justify-between items-center"
                >
                  <span>{person.firstName} {person.lastName}</span>
                  <span className={`font-bold ${getPercentageColor(presentPercentage)}`}>
                    {presentPercentage === "N/A" ? "N/A" : `${presentPercentage}%`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  );
};

// --- New Absence Management Modal ---
const AbsenceManagementModal = ({ person, sections, personRecords, onClose, onSave, onDelete }) => {
  const [mode, setMode] = useState('list'); // 'list' or 'form'
  const [currentRecord, setCurrentRecord] = useState(null);
  const [formState, setFormState] = useState({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    startSectionId: sections.length > 0 ? sections[0].id : '',
    endSectionId: sections.length > 0 ? sections[sections.length - 1].id : '',
    note: '',
  });
  const [validationError, setValidationError] = useState('');

  const handleEdit = (record) => {
    setCurrentRecord(record);
    setFormState(record);
    setMode('form');
  };

  const handleAddNew = () => {
    setCurrentRecord(null);
    setFormState({
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      startSectionId: sections.length > 0 ? sections[0].id : '',
      endSectionId: sections.length > 0 ? sections[sections.length - 1].id : '',
      note: '',
    });
    setMode('form');
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveClick = () => {
    if (new Date(formState.startDate) > new Date(formState.endDate)) {
      setValidationError("End date cannot be before start date.");
      return;
    }
    const recordToSave = currentRecord ? { ...formState, id: currentRecord.id } : { ...formState, personId: person.id };
    onSave(recordToSave);
    setMode('list');
    setValidationError('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Manage Absences for {person.firstName}</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XCircle size={24}/></button>
        </div>

        {mode === 'list' && (
          <div className="flex-grow overflow-y-auto">
            <ul className="space-y-2">
              {personRecords.sort((a,b) => new Date(b.startDate) - new Date(a.startDate)).map(record => (
                <li key={record.id} className="bg-gray-700 p-3 rounded-md flex justify-between items-center">
                  <div>
                    <p className="font-semibold">
                      {new Date(record.startDate).toLocaleDateString()} to {new Date(record.endDate).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-gray-300">{record.note}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(record)} className="text-yellow-400 hover:text-yellow-300"><Pencil size={18}/></button>
                    <button onClick={() => onDelete(record.id)} className="text-red-400 hover:text-red-300"><Trash2 size={18}/></button>
                  </div>
                </li>
              ))}
            </ul>
            {personRecords.length === 0 && <p className="text-center text-gray-400 py-8">No absences recorded.</p>}
            <button onClick={handleAddNew} className="mt-4 w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">Add New Absence</button>
          </div>
        )}

        {mode === 'form' && (
          <div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Start Date</label>
                  <input type="date" name="startDate" value={formState.startDate} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">End Date</label>
                  <input type="date" name="endDate" value={formState.endDate} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2"/>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Start Class</label>
                  <select name="startSectionId" value={formState.startSectionId} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2">
                    {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">End Class</label>
                  <select name="endSectionId" value={formState.endSectionId} onChange={handleFormChange} className="w-full bg-gray-700 rounded-md p-2">
                    {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Note (Reason)</label>
                <textarea name="note" value={formState.note} onChange={handleFormChange} placeholder="e.g., Doctor's appointment" className="w-full bg-gray-700 rounded-md p-2 h-20"></textarea>
              </div>
              {validationError && <p className="text-red-400 text-sm">{validationError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setMode('list')} className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-700">Cancel</button>
              <button onClick={handleSaveClick} className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700">Save Absence</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default App;
