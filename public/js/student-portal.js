/* ── Student Portal JS ── */
'use strict';

const STUDENT_NAV = [
  { label: 'Learning', items: [
    { icon: 'home', text: 'Dashboard', panel: 'dashboard' },
    { icon: 'clock', text: 'Timetable', panel: 'timetable' },
    { icon: 'book', text: 'Homework', panel: 'homework' },
    { icon: 'file-alt', text: 'Examinations', panel: 'exams' },
    { icon: 'chart-bar', text: 'My Results', panel: 'results' },
    { icon: 'rupee-sign', text: 'Fee Ledger', panel: 'fees' },
  ]},
  { label: 'School Life', items: [
    { icon: 'calendar-check', text: 'Attendance', panel: 'attendance' },
    { icon: 'book-open', text: 'Library', panel: 'library' },
    { icon: 'bus', text: 'Transport', panel: 'transport' },
    { icon: 'bullhorn', text: 'Notices', panel: 'notices' },
    { icon: 'calendar', text: 'Events', panel: 'events' },
  ]},
  { label: 'Account', items: [
    { icon: 'calendar-minus', text: 'My Leave', panel: 'leave' },
    { icon: 'bell', text: 'Notifications', panel: 'notifications' },
    { icon: 'user', text: 'My Profile', panel: 'profile' },
  ]},
];

let _studentData = null;
let _studentId = null;
let _timetableData = null;
let _homeworkAll = [];
let _bookSearchTimer = null;

initPortal({
  role: 'student',
  expectedRoles: ['student'],
  navConfig: STUDENT_NAV,
  onDashboardLoad: loadStudentDashboard
});

// Register panel loaders
window.onPanel_timetable    = loadTimetable;
window.onPanel_homework     = loadHomework;
window.onPanel_exams        = loadExams;
window.onPanel_results      = loadMyResults;
window.onPanel_attendance   = loadMyAttendance;
window.onPanel_library      = loadMyBooks;
window.onPanel_transport    = loadMyTransport;
window.onPanel_notices      = loadNoticesFull;
window.onPanel_events       = loadEvents;
window.onPanel_leave        = loadMyLeaves;

window.onPanel_fees         = loadMyFees;

/* ── Dashboard ── */
async function loadStudentDashboard(user) {
  // Update welcome banner
  const firstName = user.name?.split(' ')[0] || 'Student';
  const av = document.getElementById('welcomeAvatar');
  if (av) av.textContent = getInitials(user.name);

  // Fetch dashboard data
  try {
    const data = await apiFetch('/dashboard/student');
    const d = data.data || {};
    _studentData = d;
    _studentId = typeof d.studentId === 'string' ? d.studentId : null;

    // Student meta (class, roll)
    const meta = document.getElementById('studentMeta');
    if (meta && d.profile) {
      meta.textContent = `Class ${d.profile.class || '—'} · Roll No. ${d.profile.rollNumber || '—'} · Adm. ${d.profile.admissionNumber || '—'}`;
    }

    // Alert banners
    renderAlertBanners(d);

    // Stats
    renderDashboardStats(d);

    // Next Class Widget
    const nextEl = document.getElementById('nextClassWidget');
    if (nextEl) {
        if (d.nextClass) {
            nextEl.innerHTML = `<div class="next-class-highlight">
                <p class="csp-style-2b9640530d">Next Class</p>
                <h3 class="csp-style-6ce1bae5ae">${d.nextClass.subject || '—'}</h3>
                <p class="csp-style-18adc8f2e9"><i class="fas fa-clock"></i> ${d.nextClass.startTime} - ${d.nextClass.endTime} &nbsp;&bull;&nbsp; <i class="fas fa-chalkboard-teacher"></i> ${d.nextClass.teacherName} &nbsp;&bull;&nbsp; <i class="fas fa-map-marker-alt"></i> Room ${d.nextClass.room || '—'}</p>
            </div>`;
        } else {
            nextEl.innerHTML = `<div class="next-class-highlight"><p class="csp-style-6b2a94ea3b">No timetable entry is available for today.</p></div>`;
        }
    }

    // Today's timetable snippet
    loadTodayTimetableWidget(d);

    // Homework widget
    loadHomeworkWidget(d);

    // Upcoming exams widget
    loadExamsWidget(d);

    // Recent results widget
    loadResultsWidget(d);

    // Notices widget
    loadRecentNotices('dashNotices', 4);

  } catch (err) {
    document.getElementById('dashStats').innerHTML =
      `<div class="alert-banner warning"><i class="fas fa-exclamation-triangle"></i><div class="alert-banner-content"><strong>Dashboard Unavailable</strong>${err.message}</div></div>`;
  }
}

function renderAlertBanners(d) {
  const container = document.getElementById('alertBanners');
  if (!container) return;
  let html = '';

  if (d.feeStatus && d.feeStatus.pending > 0) {
    html += `<div class="alert-banner danger">
      <i class="fas fa-exclamation-circle"></i>
      <div class="alert-banner-content">
        <strong>Fee Payment Due</strong>
        ${formatCurrency(d.feeStatus.pending)} is outstanding. Please pay at the fee counter.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" aria-label="Dismiss fee alert" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  if (typeof d.attendancePercentage === 'number' && d.attendancePercentage < 75) {
    html += `<div class="alert-banner warning">
      <i class="fas fa-exclamation-triangle"></i>
      <div class="alert-banner-content">
        <strong>Low Attendance Warning</strong>
        Your attendance is ${d.attendancePercentage.toFixed(1)}%, which is below the required 75%.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" aria-label="Dismiss fee alert" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  if (d.homeworkPending > 0) {
    html += `<div class="alert-banner info">
      <i class="fas fa-book"></i>
      <div class="alert-banner-content">
        <strong>${d.homeworkPending} Homework ${d.homeworkPending > 1 ? 'assignments' : 'assignment'} pending</strong>
        Check the Homework section for details.
      </div>
      <button class="alert-dismiss btn-ghost btn-sm" aria-label="Dismiss fee alert" ${cspActionAttrs("removeParent", [], "click", [], [])}><i class="fas fa-times"></i></button>
    </div>`;
  }

  container.innerHTML = html;
}

function renderDashboardStats(d) {
  const grid = document.getElementById('dashStats');
  if (!grid) return;

  const att = typeof d.attendancePercentage === 'number' ? d.attendancePercentage.toFixed(1) + '%' : 'Unavailable';
  const attColor = typeof d.attendancePercentage !== 'number' ? 'info' : d.attendancePercentage >= 75 ? 'success' : 'danger';

  grid.innerHTML = `
    <div class="stat-card ${attColor}">
      <div class="stat-icon ${attColor}"><i class="fas fa-calendar-check"></i></div>
      <div class="stat-content">
        <div class="stat-value">${att}</div>
        <div class="stat-label">This Month's Attendance</div>
      </div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning"><i class="fas fa-book"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.homeworkPending ?? '—'}</div>
        <div class="stat-label">Homework Pending</div>
      </div>
    </div>
    <div class="stat-card info">
      <div class="stat-icon info"><i class="fas fa-file-alt"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.upcomingExams ?? '—'}</div>
        <div class="stat-label">Upcoming Exams</div>
      </div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple"><i class="fas fa-book-open"></i></div>
      <div class="stat-content">
        <div class="stat-value">${d.booksIssued ?? 'Unavailable'}</div>
        <div class="stat-label">Books Issued</div>
      </div>
    </div>
  `;
}

function loadTodayTimetableWidget(d) {
  const el = document.getElementById('todayTimetable');
  const badge = document.getElementById('todayDayBadge');
  const today = getTodayDayName();
  if (badge) badge.textContent = today;

  const periods = (d.todaysSchedule || []);
  if (!periods.length) {
    setEmptyState(el, 'calendar-day', 'No Classes Today', 'Enjoy your free day!');
    return;
  }

  const now = new Date();
  el.innerHTML = `<div class="schedule-list">` + periods.map(p => {
    const [sh, sm] = (p.startTime || '00:00').split(':').map(Number);
    const [eh, em] = (p.endTime || '00:00').split(':').map(Number);
    const isCurrent = now.getHours() >= sh && (now.getHours() < eh || (now.getHours() === eh && now.getMinutes() <= em));
    const isPast = now.getHours() > eh || (now.getHours() === eh && now.getMinutes() > em);
    return `<div class="schedule-item ${isCurrent ? 'current' : isPast ? 'past' : ''}">
      <span class="schedule-time">${p.startTime} – ${p.endTime}</span>
      <span class="schedule-dot"></span>
      <div>
        <div class="schedule-subject">${p.subject || 'Free Period'}</div>
        <div class="schedule-meta">${p.teacherName ? 'By ' + p.teacherName : ''} ${p.room ? '· Room ' + p.room : ''}</div>
      </div>
      ${isCurrent ? '<span class="badge badge-teal csp-style-ca6fc035af" >Now</span>' : ''}
    </div>`;
  }).join('') + `</div>`;
}

function loadHomeworkWidget(d) {
  const el = document.getElementById('dashHomework');
  if (!Array.isArray(d.pendingHomework)) {
    setEmptyState(el, 'book', 'Unavailable', 'Homework details are not provided by this dashboard.');
    return;
  }
  const hw = d.pendingHomework.slice(0, 5);
  if (!hw.length) {
    setEmptyState(el, 'check-circle', 'All caught up!', 'No pending homework. Keep it up! 🎉');
    return;
  }
  el.innerHTML = hw.map(h => {
    const due = new Date(h.dueDate);
    const isOverdue = due < new Date();
    return `<div class="csp-style-cfb951fb32">
      <span class="badge ${isOverdue ? 'badge-danger' : 'badge-warning'} csp-style-85850cc31c" >${h.subject||'General'}</span>
      <div class="csp-style-286372957b">
        <div class="csp-style-497b459502">${h.title}</div>
      <div class="homework-due-date ${isOverdue ? 'text-danger' : 'text-muted'}">${isOverdue ? '⚠ Overdue · ' : ''}Due ${formatDate(h.dueDate)}</div>
      </div>
    </div>`;
  }).join('') + `<div class="csp-style-7781fa7669"><button class="btn btn-ghost btn-sm" ${cspActionAttrs("showPanel", ['homework'], "click", [], [])}>View All <i class="fas fa-arrow-right"></i></button></div>`;
}

function loadExamsWidget(d) {
  const el = document.getElementById('dashExams');
  if (!Array.isArray(d.upcomingExamsList)) {
    setEmptyState(el, 'file-alt', 'Unavailable', 'Upcoming exam details are not provided by this dashboard.');
    return;
  }
  const exams = d.upcomingExamsList.slice(0, 3);
  if (!exams.length) {
    setEmptyState(el, 'file-alt', 'No Upcoming Exams', 'Sit back and relax!');
    return;
  }
  el.innerHTML = exams.map(ex => `
    <div class="csp-style-4ead2ae2ed">
      <div class="csp-style-1ea921a288">
        <div class="csp-style-8f21177085">${new Date(ex.date).getDate()}</div>
        <div class="csp-style-269e5f225a">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ex.date).getMonth()]}</div>
      </div>
      <div>
        <div class="csp-style-57fea97081">${ex.subject||ex.name}</div>
        <div class="csp-style-35374e0094">${ex.examType||''} · ${daysUntil(ex.date)}</div>
      </div>
    </div>`).join('');
}

function loadResultsWidget(d) {
  const el = document.getElementById('dashResults');
  if (!Array.isArray(d.recentResults)) {
    setEmptyState(el, 'chart-bar', 'Unavailable', 'Recent results are not provided by this dashboard.');
    return;
  }
  const results = d.recentResults.slice(0, 3);
  if (!results.length) {
    setEmptyState(el, 'chart-bar', 'No Results Yet', 'Results will appear here after exams.');
    return;
  }
  el.innerHTML = results.map(r => {
    const pct = r.maxMarks > 0 ? Math.round(r.marksObtained / r.maxMarks * 100) : 0;
    const gradeColor = pct >= 90 ? 'success' : pct >= 75 ? 'info' : pct >= 60 ? 'warning' : 'danger';
    return `<div class="csp-style-4ead2ae2ed">
      <div class="stat-icon ${gradeColor} csp-style-5efcd9d910" >${r.grade||'—'}</div>
      <div class="csp-style-83725d2c6e">
        <div class="csp-style-02a3c7300a">${r.subject}</div>
        <div class="csp-style-35374e0094">${r.marksObtained}/${r.maxMarks} · ${pct}%</div>
      </div>
    </div>`;
  }).join('');
}

/* ── Timetable ── */
function escapeStudentPortalText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function loadTimetable() {
  const content = document.getElementById('timetableContent');
  const tabs = document.getElementById('timetableDayTabs');
  if (!content) return;
  content.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const response = await apiFetch('/timetable/my-timetable');
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Timetable response was invalid.');
    }
    const grouped = Object.fromEntries(days.map(day => [day, []]));
    for (const timetable of response.data) {
      if (!timetable || !Object.prototype.hasOwnProperty.call(grouped, timetable.day) || !Array.isArray(timetable.periods) ||
          timetable.periods.some(period => !period || typeof period !== 'object' || Array.isArray(period))) {
        throw new Error('Timetable contains an invalid weekday schedule.');
      }
      grouped[timetable.day].push(...timetable.periods);
    }
    for (const day of days) {
      grouped[day].sort((left, right) => Number(left?.periodNumber || 0) - Number(right?.periodNumber || 0));
    }
    _timetableData = grouped;
    const today = getTodayDayName();

    // Build day tabs
    tabs.innerHTML = days.map(d =>
      `<button class="tab-btn ${d===today?'active':''}" aria-label="${d}" ${cspActionAttrs("showTimetableDay", ['${d}'], "click", [1], [])}>${d.slice(0,3)}</button>`
    ).join('');

    showTimetableDay(today, tabs.querySelector('.active'));
  } catch (err) {
    setEmptyState(content, 'clock', 'Timetable Unavailable', escapeStudentPortalText(err.message || 'Timetable could not be loaded.'));
  }
}

window.showTimetableDay = function(day, btn) {
  if (btn) {
    document.querySelectorAll('#timetableDayTabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const content = document.getElementById('timetableContent');
  const periods = (_timetableData[day] || []);
  if (!periods.length) {
    setEmptyState(content, 'coffee', 'No Classes', `No periods scheduled for ${day}.`);
    return;
  }

  const now = new Date();
  const isToday = day === getTodayDayName();

  content.innerHTML = `<div class="schedule-list">` + periods.map(p => {
    const [sh] = (p.startTime||'0:0').split(':').map(Number);
    const [eh] = (p.endTime||'0:0').split(':').map(Number);
    const isCurrent = isToday && now.getHours() >= sh && now.getHours() < eh;
    const isPast = isToday && now.getHours() >= eh;
    const teacherName = p.teacher && typeof p.teacher === 'object'
      ? p.teacher.user?.name || p.teacher.name || ''
      : '';
    return `<div class="schedule-item ${isCurrent?'current':isPast?'past':''}">
      <span class="schedule-time">${escapeStudentPortalText(p.startTime || '—')} – ${escapeStudentPortalText(p.endTime || '—')}</span>
      <span class="schedule-dot"></span>
      <div>
        <div class="schedule-subject">${escapeStudentPortalText(p.subject || '—')}</div>
        <div class="schedule-meta">${teacherName ? `By ${escapeStudentPortalText(teacherName)}` : ''} ${p.room ? `· Room ${escapeStudentPortalText(p.room)}` : ''}</div>
      </div>
      ${isCurrent ? '<span class="badge badge-teal csp-style-ca6fc035af" >Now</span>' : ''}
    </div>`;
  }).join('') + `</div>`;
};

/* ── Homework ── */
async function loadHomework() {
  const list = document.getElementById('homeworkList');
  if (!list) return;
  list.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';

  try {
    const data = await apiFetch('/homework/my-homework');
    _homeworkAll = data.data || data.homework || [];
    renderHomeworkList(_homeworkAll);
  } catch (err) {
    setEmptyState(list, 'book', 'Could not load homework', err.message);
  }
}

function filterHomework() {
  const sub = document.getElementById('hwSubjectFilter')?.value || '';
  const status = document.getElementById('hwStatusFilter')?.value || '';
  let filtered = _homeworkAll;
  if (sub)    filtered = filtered.filter(h => h.subject === sub);
  if (status) filtered = filtered.filter(h => (h.status||'pending') === status);
  renderHomeworkList(filtered);
}

function renderHomeworkList(items) {
  const list = document.getElementById('homeworkList');
  if (!items.length) {
    setEmptyState(list, 'check-circle', 'No Homework Found', 'Enjoy your free time! 📚');
    return;
  }

  // Populate subject filter
  const subjects = [...new Set(items.map(h=>h.subject).filter(Boolean))];
  const subSel = document.getElementById('hwSubjectFilter');
  if (subSel && subSel.options.length <= 1) {
    subjects.forEach(s => { const o = new Option(s,s); subSel.add(o); });
  }

  list.innerHTML = items.map(h => {
    const status = String(h.status || 'pending').toLowerCase();
    const isOverdue = new Date(h.dueDate) < new Date() && status === 'pending';
    const statusCls = ['submitted', 'reviewed'].includes(status) ? 'badge-success' :
      (status === 'late' || isOverdue) ? 'badge-danger' : 'badge-warning';
    const statusText = status === 'reviewed' ? 'Reviewed' : status === 'submitted' ? 'Submitted' :
      status === 'late' ? 'Submitted late' : isOverdue ? 'Overdue' : 'Pending';
    return `<div class="card homework-card">
      <div class="card-body">
        <div class="csp-style-407bb517cb">
          <div>
            <span class="badge badge-info csp-style-2867b51660" >${h.subject||'General'}</span>
            <h4 class="csp-style-a1a0dcf46c">${h.title}</h4>
            ${h.description ? `<p class="csp-style-3e5a7aab34">${h.description}</p>` : ''}
          </div>
          <span class="badge ${statusCls}">${statusText}</span>
        </div>
        <div class="csp-style-38befa3929">
          <div class="homework-due-date ${isOverdue ? 'text-danger' : 'text-muted'}">
            <i class="fas fa-calendar-day"></i> Due: ${formatDate(h.dueDate)}
            ${h.teacher ? ` · <i class="fas fa-chalkboard-teacher"></i> ${h.teacher}` : ''}
          </div>
          ${(h.status||'pending') === 'pending' ? `
            <button class="btn btn-primary btn-sm" ${cspActionAttrs('openHomeworkSubmissionForm', [String(h._id)], 'click', [1], [])}><i class="fas fa-upload"></i> Submit</button>
            <div class="homework-submission-form" hidden>
              <label>Written response
                <textarea class="homework-submission-content" rows="3" aria-label="Written homework response"></textarea>
              </label>
              <label>Link name (optional)
                <input class="homework-submission-link-name" type="text" aria-label="Submission link name">
              </label>
              <label>Work link (optional)
                <input class="homework-submission-link-url" type="url" inputmode="url" placeholder="https://…" aria-label="Submission link">
              </label>
              <button class="btn btn-primary btn-sm" ${cspActionAttrs('submitHomework', [String(h._id)], 'click', [1], [])}>Send submission</button>
              <button class="btn btn-secondary btn-sm" ${cspActionAttrs('closeHomeworkSubmissionForm', [], 'click', [1], [])}>Cancel</button>
              <div class="homework-submission-feedback" role="status" aria-live="polite"></div>
            </div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

const _homeworkSubmitting = new Set();
window.openHomeworkSubmissionForm = function(id, button) {
  const card = button?.closest('.homework-card');
  const form = card?.querySelector('.homework-submission-form');
  if (!form) return;
  form.hidden = false;
  button.hidden = true;
  form.querySelector('.homework-submission-content')?.focus();
};

window.closeHomeworkSubmissionForm = function(button) {
  const card = button?.closest('.homework-card');
  const form = card?.querySelector('.homework-submission-form');
  if (!form) return;
  form.hidden = true;
  const openButton = card.querySelector('[data-csp-action-click="openHomeworkSubmissionForm"]');
  if (openButton) openButton.hidden = false;
};

function homeworkSubmissionMatches(submission, payload) {
  if (!submission || !submission.submittedAt ||
      !['submitted', 'late', 'reviewed'].includes(String(submission.status || '').toLowerCase()) ||
      String(submission.content || '') !== payload.content) return false;
  const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
  return attachments.length === payload.attachments.length && payload.attachments.every((attachment, index) =>
    String(attachments[index]?.name || '') === attachment.name &&
    String(attachments[index]?.url || '') === attachment.url
  );
}

window.submitHomework = async function(id, button) {
  const homeworkId = String(id || '');
  if (!homeworkId || _homeworkSubmitting.has(homeworkId)) return;
  const card = button?.closest('.homework-card');
  const form = card?.querySelector('.homework-submission-form');
  const feedback = form?.querySelector('.homework-submission-feedback');
  const content = form?.querySelector('.homework-submission-content')?.value.trim() || '';
  const linkInput = form?.querySelector('.homework-submission-link-url');
  const linkUrl = linkInput?.value.trim() || '';
  const linkName = form?.querySelector('.homework-submission-link-name')?.value.trim() || 'Submission link';
  if (!form || !linkInput || !feedback) return;
  if (!content && !linkUrl) {
    feedback.textContent = 'Enter a written response or provide a link.';
    toast.warning('Submission required', 'Enter a written response or provide a work link.');
    return;
  }
  if (linkUrl && !linkInput.checkValidity()) {
    feedback.textContent = 'Enter a valid HTTP or HTTPS link.';
    toast.warning('Invalid link', 'Check the submission link and try again.');
    return;
  }
  let normalizedLinkUrl = '';
  if (linkUrl) {
    try {
      const parsedLink = new URL(linkUrl);
      if (!['http:', 'https:'].includes(parsedLink.protocol) || parsedLink.username || parsedLink.password) {
        throw new Error('invalid link');
      }
      normalizedLinkUrl = parsedLink.toString();
    } catch (_) {
      feedback.textContent = 'Enter a valid HTTP or HTTPS link.';
      toast.warning('Invalid link', 'Check the submission link and try again.');
      return;
    }
  }
  const payload = {
    content,
    attachments: normalizedLinkUrl ? [{ name: linkName, url: normalizedLinkUrl }] : [],
  };
  _homeworkSubmitting.add(homeworkId);
  if (button) button.disabled = true;
  feedback.textContent = 'Sending submission…';
  try {
    const response = await apiFetch(`/homework/${encodeURIComponent(homeworkId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (response?.success !== true || !homeworkSubmissionMatches(response.data, payload)) {
      throw { status: 503, message: 'The server response did not confirm the saved submission.' };
    }
    feedback.textContent = 'Submission confirmed.';
    toast.success(
      response.data.status === 'late' ? 'Submitted late' : 'Submitted!',
      response.data.status === 'late' ? 'Your work was received after the deadline and marked late.' : 'Your homework submission was saved.'
    );
    await loadHomework();
  } catch (error) {
    if (error.status === 0 || error.status >= 500) {
      try {
        const readback = await apiFetch(`/homework/${encodeURIComponent(homeworkId)}`);
        const confirmed = readback?.success === true && homeworkSubmissionMatches(readback.data?.submission, payload);
        if (confirmed) {
          feedback.textContent = 'Submission confirmed from the saved homework record.';
          const isLate = readback.data.submission.status === 'late';
          toast.success('Submission confirmed', isLate
            ? 'Your saved work was received after the deadline and marked late.'
            : 'Your saved submission was verified.');
          await loadHomework();
          return;
        }
      } catch (_) {
        // The original outcome remains uncertain; preserve the draft for review/retry.
      }
      feedback.textContent = 'Submission status is uncertain. Your draft is preserved; reload this homework before retrying.';
      toast.error('Status not confirmed', 'Your draft is preserved. Reload the homework to check whether it was saved before retrying.');
    } else {
      feedback.textContent = error.message || 'The submission was rejected.';
      toast.error('Submission not accepted', error.message || 'The submission was rejected.');
    }
  } finally {
    _homeworkSubmitting.delete(homeworkId);
    if (button?.isConnected) button.disabled = false;
  }
};

/* ── Exams ── */
async function loadExams() {
  const upEl = document.getElementById('upcomingExamsList');
  const pastEl = document.getElementById('pastExamsList');
  if (!upEl || !pastEl) return;
  upEl.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';
  pastEl.textContent = 'Loading published exam schedules…';

  try {
    const response = await apiFetch('/exams');
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error('Exam response was invalid.');
    }
    const now = new Date();
    const upcoming = [];
    const past = [];
    for (const exam of response.data) {
      const dates = [exam?.startDate, exam?.endDate, ...(Array.isArray(exam?.subjects) ? exam.subjects.map(subject => subject?.date) : [])]
        .map(value => value ? new Date(value) : null)
        .filter(value => value && Number.isFinite(value.getTime()));
      if (!dates.length || dates.some(value => value >= now)) upcoming.push(exam);
      else past.push(exam);
    }
    renderExamList(upEl, upcoming, false);
    renderExamList(pastEl, past, true);
  } catch (err) {
    setEmptyState(upEl, 'file-alt', 'Could not load exams', escapeStudentPortalText(err.message || 'Exam schedules could not be loaded.'));
    setEmptyState(pastEl, 'file-alt', 'Could not load exams', escapeStudentPortalText(err.message || 'Exam schedules could not be loaded.'));
  }
}

function renderExamList(el, items, isPast) {
  if (!items.length) {
    setEmptyState(el, 'check-circle', isPast ? 'No Past Exams' : 'No Upcoming Exams', isPast ? '' : 'Great! No exams coming up.');
    return;
  }
  el.innerHTML = items.map(ex => {
    const now = new Date();
    const dates = [ex.startDate, ...(Array.isArray(ex.subjects) ? ex.subjects.map(subject => subject?.date) : []), ex.endDate]
      .map(value => value ? new Date(value) : null)
      .filter(value => value && Number.isFinite(value.getTime()))
      .sort((left, right) => left - right);
    const displayDate = dates.find(value => value >= now) || dates[0];
    const subjectNames = [...new Set((Array.isArray(ex.subjects) ? ex.subjects : [])
      .map(subject => typeof subject?.subject === 'string' ? subject.subject : subject?.subject?.name)
      .filter(Boolean))];
    const d = displayDate ? daysUntil(displayDate) : '';
    return `<div class="card">
      <div class="card-body csp-style-08b2dfc6e6" >
        <div class="csp-style-707acca9c9">
          <div class="csp-style-a8f751c918">${displayDate ? displayDate.getDate() : '—'}</div>
          <div class="csp-style-a46b5f5398">${displayDate ? displayDate.toLocaleString(undefined, { month: 'short' }) : 'Date unavailable'}</div>
        </div>
        <div class="csp-style-83725d2c6e">
          <div class="csp-style-a1a0dcf46c">${escapeStudentPortalText(ex.name || 'Exam')}</div>
          <div class="csp-style-d8d87b1b9d">${escapeStudentPortalText(ex.examType || 'Exam type unavailable')} · Class ${escapeStudentPortalText(ex.class || '—')} · ${escapeStudentPortalText(ex.academicYear || 'Academic year unavailable')}</div>
          ${subjectNames.length ? `<div>${escapeStudentPortalText(subjectNames.join(', '))}</div>` : ''}
        </div>
        ${!isPast && d ? `<span class="badge badge-info">${escapeStudentPortalText(d)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.switchExamTab = function(tab, btn) {
  document.querySelectorAll('#panel-exams .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#panel-exams .tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('exams-' + tab)?.classList.add('active');
};

/* ── Results ── */
async function loadMyResults() {
  const el = document.getElementById('resultsContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  const examType = document.getElementById('resultExamFilter')?.value || '';
  try {
    const response = await apiFetch('/marks/my-marks' + (examType ? `?examType=${encodeURIComponent(examType)}` : ''));
    const marks = response?.success === true && Array.isArray(response.data?.marks) ? response.data.marks : null;
    if (!marks) throw new Error('Results response was invalid.');

    if (!marks.length) {
      setEmptyState(el, 'chart-bar', 'No Results Yet', 'Results will be published here after exams are assessed.');
      return;
    }

    const records = marks.filter(record => record && Array.isArray(record.subjects));
    if (!records.length) throw new Error('Published marks did not contain subject results.');
    el.innerHTML = `<div class="csp-style-2b8334d34f">
      <a class="btn btn-secondary btn-sm" href="/portal/print/report-card.html">Print my report card</a>
      ${records.map(record => `<div class="card">
        <div class="card-header"><strong>${escapeStudentPortalText(record.examType || 'Exam')}</strong> · ${escapeStudentPortalText(record.academicYear || 'Academic year unavailable')}</div>
        <div class="card-body">
          <p>Recorded total: ${escapeStudentPortalText(record.obtainedMarks ?? 'Unavailable')} / ${escapeStudentPortalText(record.totalMarks ?? 'Unavailable')}
            ${typeof record.percentage === 'number' ? `· ${escapeStudentPortalText(record.percentage)}%` : ''}
            ${record.overallGrade ? `· Grade ${escapeStudentPortalText(record.overallGrade)}` : ''}
            ${record.result ? `· ${escapeStudentPortalText(record.result)}` : ''}</p>
          <div class="table-wrapper"><table class="data-table">
            <thead><tr><th>Subject</th><th>Max Marks</th><th>Obtained</th><th>Grade</th></tr></thead>
            <tbody>${record.subjects.map(subject => `<tr>
              <td class="csp-style-6e8bcfac8d">${escapeStudentPortalText(subject?.subject || '—')}</td>
              <td>${escapeStudentPortalText(subject?.maxMarks ?? 'Unavailable')}</td>
              <td class="csp-style-c6fa01b3f1">${subject?.isAbsent ? 'Absent' : escapeStudentPortalText(subject?.marksObtained ?? 'Unavailable')}</td>
              <td><span class="badge badge-primary">${escapeStudentPortalText(subject?.grade || 'Not recorded')}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`).join('')}
    </div>`;
  } catch (err) {
    setEmptyState(el, 'chart-bar', 'Could not load results', escapeStudentPortalText(err.message || 'Published results could not be loaded.'));
  }
}

/* ── Attendance ── */
async function loadMyAttendance() {
  const sel = document.getElementById('attMonthSel');
  const statsEl = document.getElementById('attStats');
  const calEl = document.getElementById('attCalendar');

  // Populate month selector if empty
  if (sel && sel.options.length === 0) {
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      sel.add(new Option(label, val));
    }
  }

  const [year, month] = (sel?.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`).split('-').map(Number);
  calEl.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    if (!_studentId) throw new Error('Your student attendance identity is unavailable. Reload the dashboard or contact the school office.');
    const data = await apiFetch(`/attendance/student/${encodeURIComponent(_studentId)}/monthly?year=${year}&month=${month}`);
    if (!data || data.success !== true || !Array.isArray(data.data?.records)) {
      throw new Error('Attendance response is unavailable.');
    }
    const days = data.data.records;

    // Stats
    const present = days.filter(d => d.status === 'Present').length;
    const absent  = days.filter(d => d.status === 'Absent').length;
    const late    = days.filter(d => d.status === 'Late').length;
    const total   = days.filter(d => d.status !== 'Holiday').length;
    const pct     = total > 0 ? ((present + late)/total*100).toFixed(1) : '—';

    statsEl.innerHTML = `
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-check"></i></div><div class="stat-content"><div class="stat-value">${pct}%</div><div class="stat-label">Attendance</div></div></div>
      <div class="stat-card success"><div class="stat-icon success"><i class="fas fa-user-check"></i></div><div class="stat-content"><div class="stat-value">${present}</div><div class="stat-label">Present</div></div></div>
      <div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-user-times"></i></div><div class="stat-content"><div class="stat-value">${absent}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-clock"></i></div><div class="stat-content"><div class="stat-value">${late}</div><div class="stat-label">Late</div></div></div>`;

    // Calendar grid
    renderAttCalendar(calEl, year, month, days);

  } catch (err) {
    setEmptyState(calEl, 'calendar', 'Attendance data unavailable', err.message);
    statsEl.innerHTML = '';
  }
}

function renderAttCalendar(el, year, month, records) {
  const dayMap = {};
  records.forEach(r => {
    const d = new Date(r.date);
    dayMap[d.getDate()] = String(r.status || '').toLowerCase();
  });

  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  let startWd = first.getDay(); // 0=Sun
  if (startWd === 0) startWd = 7; // treat Sunday as 7 for Mon-start calendar
  startWd -= 1; // 0-indexed from Monday


  let html = `<div class="attendance-calendar">`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d =>
    html += `<div class="attendance-calendar-weekday">${d}</div>`
  );
  for (let i = 0; i < startWd; i++) html += `<div></div>`;
  for (let d = 1; d <= lastDay; d++) {
    const st = dayMap[d];
    html += `<div class="attendance-calendar-day attendance-calendar-day--${st || 'unmarked'}" title="${st||'—'}">${d}</div>`;
  }
  html += `</div>
    <div class="attendance-calendar-legend">
      <span><span class="attendance-calendar-key attendance-calendar-key--present"></span>Present</span>
      <span><span class="attendance-calendar-key attendance-calendar-key--absent"></span>Absent</span>
      <span><span class="attendance-calendar-key attendance-calendar-key--late"></span>Late</span>
    </div>`;
  el.innerHTML = html;
}

/* ── Library ── */
async function loadMyBooks() {
  const el = document.getElementById('myBooksContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-cbac136be3" ></div>';

  try {
    const data = await apiFetch('/library/my-books');
    const books = data.data || data.books || [];

    if (!books.length) {
      setEmptyState(el, 'book-open', 'No Books Issued', 'You have no books currently issued from the library.');
      return;
    }

    el.innerHTML = `<h4 class="csp-style-68f37cd999">My Issued Books (${books.length})</h4>
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Book Title</th><th>Author</th><th>Issued On</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>${books.map(b => {
              const isOverdue = new Date(b.dueDate) < new Date();
              const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(b.dueDate))/86400000) : 0;
              return `<tr>
                <td class="csp-style-6e8bcfac8d">${b.book?.title || b.title || '—'}</td>
                <td>${b.book?.author || b.author || '—'}</td>
                <td>${formatDate(b.issuedDate || b.createdAt)}</td>
                <td>${formatDate(b.dueDate)}</td>
                <td>${isOverdue
                  ? `<span class="badge badge-danger">Overdue ${daysOverdue}d</span>`
                  : `<span class="badge badge-success">Active</span>`}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    setEmptyState(el, 'book-open', 'Library data unavailable', err.message);
  }
}

function searchBooksDebounced() {
  clearTimeout(_bookSearchTimer);
  _bookSearchTimer = setTimeout(searchBooks, 400);
}

async function searchBooks() {
  const q = document.getElementById('bookSearchInput')?.value.trim();
  const el = document.getElementById('bookSearchResults');
  if (!el) return;
  if (!q || q.length < 2) { el.innerHTML = ''; return; }

  el.innerHTML = '<div class="spinner csp-style-2ebb0dfa7c" ></div>';
  try {
    const data = await apiFetch(`/library/books?search=${encodeURIComponent(q)}&limit=10`);
    const books = data.data || data.books || [];
    if (!books.length) { setEmptyState(el, 'search', 'No Books Found', `No books matching "${q}".`); return; }

    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Available</th></tr></thead>
      <tbody>${books.map(b => `<tr>
        <td class="csp-style-6e8bcfac8d">${b.title}</td>
        <td>${b.author||'—'}</td>
        <td>${b.category||'—'}</td>
        <td>${b.availableCopies > 0
          ? `<span class="badge badge-success">${b.availableCopies} available</span>`
          : `<span class="badge badge-danger">Not available</span>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch (err) {
    el.innerHTML = `<p class="csp-style-f3dff4b30f">${err.message}</p>`;
  }
}

/* ── Transport ── */
async function loadMyTransport() {
  const el = document.getElementById('transportContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';

  try {
    const data = await apiFetch('/transport/my-transport');
    const t = data.data || data.transport;
    if (!t) { setEmptyState(el, 'bus', 'No Transport Assigned', 'You are not assigned to any school bus route.'); return; }

    el.innerHTML = `<div class="csp-style-89c25a0344">
      <div class="stat-card info">
        <div class="stat-icon info"><i class="fas fa-bus"></i></div>
        <div class="stat-content"><div class="stat-value">${t.busNumber||'—'}</div><div class="stat-label">Bus Number</div></div>
      </div>
      <div class="stat-card primary">
        <div class="stat-icon primary"><i class="fas fa-route"></i></div>
        <div class="stat-content"><div class="stat-value">${t.route?.name||t.routeName||'—'}</div><div class="stat-label">Route</div></div>
      </div>
      <div class="stat-card teal">
        <div class="stat-icon teal"><i class="fas fa-map-marker-alt"></i></div>
        <div class="stat-content"><div class="stat-value">${t.pickupStop||t.stop||'—'}</div><div class="stat-label">Pickup Stop</div></div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon warning"><i class="fas fa-clock"></i></div>
        <div class="stat-content"><div class="stat-value">${t.pickupTime||'—'}</div><div class="stat-label">Pickup Time</div></div>
      </div>
    </div>
    ${t.driver ? `<div class="card csp-style-66e6b652a6" ><div class="card-body"><h4 class="csp-style-ce14cdaf2d">Driver Details</h4>
    <p><i class="fas fa-user csp-style-bb6cacc0ad" ></i> ${t.driver.name||t.driverName||'—'}</p>
    <p class="csp-style-4cb9fdd117"><i class="fas fa-phone csp-style-bb6cacc0ad" ></i> ${t.driver.phone||t.driverPhone||'—'}</p>
    </div></div>` : ''}`;
  } catch (err) {
    setEmptyState(el, 'bus', 'Transport data unavailable', err.message);
  }
}

/* ── Notices ── */
async function loadNoticesFull() {
  const el = document.getElementById('noticesList');
  if (!el) return;
  el.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  const type = document.getElementById('noticeTypeFilter')?.value || '';

  try {
    const data = await apiFetch(`/notices?limit=30${type ? '&type='+encodeURIComponent(type) : ''}`);
    const notices = data.data || data.notices || [];

    if (!notices.length) { setEmptyState(el, 'bullhorn', 'No Notices', 'No notices have been posted.'); return; }

    el.innerHTML = notices.map(n => {
      const pBadge = { High:'danger', Urgent:'danger', Low:'secondary', Medium:'info' }[n.priority] || 'info';
      return `<div class="card">
        <div class="card-body">
          <div class="csp-style-fbcd02feea">
            <span class="badge badge-${pBadge}">${n.type||'General'}</span>
            ${n.priority === 'High' || n.priority === 'Urgent' ? '<span class="badge badge-danger">Urgent</span>' : ''}
          </div>
          <h4 class="csp-style-fb324771ea">${n.title}</h4>
          <p class="csp-style-959c8e995c">${n.content||''}</p>
          <p class="csp-style-7465dab738"><i class="fas fa-calendar"></i> ${formatDate(n.createdAt)}</p>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    setEmptyState(el, 'bullhorn', 'Could not load notices', err.message);
  }
}

/* ── Events ── */
async function loadEvents() {
  const el = document.getElementById('eventsList');
  if (!el) return;
  el.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  try {
    const data = await apiFetch('/events?limit=20');
    const events = data.data || data.events || [];
    if (!events.length) { setEmptyState(el, 'calendar', 'No Upcoming Events', 'Check back later for events.'); return; }
    el.innerHTML = events.map(ev => `
      <div class="card">
        <div class="card-body">
          <div class="csp-style-454ef66de1">
            <div class="csp-style-25414abebd">
              <div class="csp-style-34ef9b68d3">${new Date(ev.date||ev.startDate).getDate()}</div>
              <div class="csp-style-269e5f225a">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ev.date||ev.startDate).getMonth()]}</div>
            </div>
            <div>
              <h4 class="csp-style-2c632898ef">${ev.title}</h4>
              <p class="csp-style-d8d87b1b9d">${ev.description||''}</p>
              ${ev.location ? `<p class="csp-style-cb16392b3b"><i class="fas fa-map-marker-alt"></i> ${ev.location}</p>` : ''}
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    setEmptyState(el, 'calendar', 'Could not load events', err.message);
  }
}

/* ── Leave ── */
async function loadMyLeaves() {
  const tbody = document.getElementById('leaveTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="spinner csp-style-cbac136be3" ></div></td></tr>';
  try {
    const data = await apiFetch('/leaves/my-leaves');
    const leaves = data.data || data.leaves || [];
    if (!leaves.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar-minus"></i><h4>No Leave Requests</h4><p>You haven't applied for any leave.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = leaves.map(l => {
      const sc = { Approved:'badge-success', Rejected:'badge-danger', Pending:'badge-warning' }[l.status] || 'badge-secondary';
      return `<tr>
        <td>${formatDate(l.fromDate)}</td>
        <td>${formatDate(l.toDate)}</td>
        <td>${l.leaveType||'—'}</td>
        <td class="csp-style-749cb1d3cf">${l.reason||'—'}</td>
        <td><span class="badge ${sc}">${l.status||'Pending'}</span></td>
        <td>${formatDate(l.createdAt)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="csp-style-650c81a9d9">${err.message}</td></tr>`;
  }
}

async function submitLeaveApplication() {
  const fromDate = document.getElementById('leaveFrom')?.value;
  const toDate   = document.getElementById('leaveTo')?.value;
  const leaveType = document.getElementById('leaveType')?.value;
  const reason   = document.getElementById('leaveReason')?.value.trim();
  const btn = document.getElementById('submitLeaveBtn');

  if (!fromDate || !toDate || !reason) return toast.warning('Required', 'Please fill all required fields.');
  if (new Date(toDate) < new Date(fromDate)) return toast.warning('Invalid Dates', 'To date must be after from date.');

  setButtonLoading(btn, true);
  try {
    await apiFetch('/leaves', { method: 'POST', body: JSON.stringify({ startDate: fromDate, endDate: toDate, fromDate, toDate, leaveType, reason }) });
    toast.success('Leave Applied', 'Your leave request has been submitted for approval.');
    closeModal('applyLeaveModal');
    document.getElementById('leaveFrom').value = '';
    document.getElementById('leaveTo').value = '';
    document.getElementById('leaveReason').value = '';
    loadMyLeaves();
  } catch (err) {
    toast.error('Submission Failed', err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function loadMyFees() {
  const el = document.getElementById('feesContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner csp-style-c4b102f94c" ></div>';
  try {
    const data = await apiFetch('/fees/my-fees');
    const fees = data.data || [];
    if (!fees.length) {
      setEmptyState(el, 'check-circle', 'All Clear!', 'No fees are currently due.');
      return;
    }
    el.innerHTML = `<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Fee Type</th><th>Amount</th><th>Status</th><th>Due Date</th></tr></thead><tbody>${fees.map(f => `<tr><td class="csp-style-6e8bcfac8d">${f.feeType || '—'}</td><td>${formatCurrency(f.amount || 0)}</td><td><span class="badge ${f.status === 'Paid' ? 'badge-success' : 'badge-danger'}">${f.status || 'Pending'}</span></td><td>${formatDate(f.dueDate)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } catch (err) {
    setEmptyState(el, 'rupee-sign', 'Could not load fees', err.message);
  }
}
