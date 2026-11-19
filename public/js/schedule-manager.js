'use strict';

(() => {
  const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const EXAM_TYPES = ['Unit Test 1', 'Unit Test 2', 'Unit Test 3', 'Unit Test 4', 'Half Yearly', 'Pre-Board', 'Annual', 'Practical', 'Internal Assessment', 'Class Test', 'Periodic Test'];
  const EXAM_STATUSES = ['Draft', 'Scheduled', 'Ongoing', 'Completed', 'ResultPublished'];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const PERIOD_TYPES = ['Regular', 'Lab', 'Library', 'Sports', 'Break', 'Assembly'];
  const state = { classes: null, faculty: null, exams: [], timetables: [], editingExam: null, editingTimetable: null };

  const examRoot = document.getElementById('examScheduleManager');
  const timetableRoot = document.getElementById('timetableScheduleManager');

  function statusMessage(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message || '';
  }

  function notify(type, title, message, statusId) {
    if (window.CSPToasts && typeof window.CSPToasts[type] === 'function') {
      window.CSPToasts[type](title, message);
    } else {
      statusMessage(statusId, [title, message].filter(Boolean).join(': '));
    }
  }

  function requireApiSuccess(response, label) {
    if (!response || response.success !== true) throw new Error(response?.message || `${label} was not confirmed.`);
    return response;
  }

  async function loadClasses() {
    if (state.classes) return state.classes;
    const response = requireApiSuccess(await apiFetch('/classes'), 'Class list');
    if (!Array.isArray(response.data)) throw new Error('Class list response was invalid.');
    state.classes = response.data;
    return state.classes;
  }

  async function loadFaculty() {
    if (state.faculty) return state.faculty;
    const response = requireApiSuccess(await apiFetch('/faculty?limit=1000'), 'Teacher list');
    if (!Array.isArray(response.data?.faculty)) throw new Error('Teacher list response was invalid.');
    state.faculty = response.data.faculty;
    return state.faculty;
  }

  function pairValue(className, academicYear) {
    return `${encodeURIComponent(className)}|${encodeURIComponent(academicYear)}`;
  }

  function decodePair(value) {
    const [className, academicYear] = String(value || '').split('|');
    if (!className || !academicYear) return null;
    return { className: decodeURIComponent(className), academicYear: decodeURIComponent(academicYear) };
  }

  function classYearPairs() {
    const seen = new Set();
    return (state.classes || []).filter(item => item && CLASS_LEVELS.includes(item.name) && item.academicYear)
      .filter(item => {
        const key = pairValue(item.name, item.academicYear);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function fillClassYearSelect(select, className, academicYear) {
    select.replaceChildren(new Option('Choose class and academic year', ''));
    for (const item of classYearPairs()) {
      const option = new Option(`Class ${item.name} · ${item.academicYear}`, pairValue(item.name, item.academicYear));
      select.add(option);
    }
    if (className && academicYear) select.value = pairValue(className, academicYear);
  }

  function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  }

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(cell);
    return cell;
  }

  function makeAction(label, action, id) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-sm';
    button.textContent = label;
    button.dataset[action] = id;
    return button;
  }

  function examMarkup() {
    examRoot.innerHTML = `
      <div class="section-header">
        <div><h2><i class="fas fa-file-alt"></i> Exam Schedules</h2><p class="text-muted">Create or update class and academic-year exam schedules. Scheduled exams are visible to Students.</p></div>
        <button type="button" class="btn btn-primary" data-open-exam><i class="fas fa-plus"></i> Add exam schedule</button>
      </div>
      <p id="examScheduleStatus" class="text-muted" role="status" aria-live="polite"></p>
      <div class="card"><div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Exam</th><th>Type</th><th>Class / Year</th><th>Dates</th><th>Status</th><th>Action</th></tr></thead>
        <tbody id="examScheduleRows"></tbody>
      </table></div></div>
      <div class="modal-overlay" id="examScheduleModal" aria-hidden="true"><div class="modal">
        <div class="modal-header"><h3 id="examScheduleTitle">Add exam schedule</h3><button type="button" class="btn btn-ghost" data-close-exam aria-label="Close">&times;</button></div>
        <form id="examScheduleForm" class="modal-body">
          <div class="form-group"><label for="scheduleExamName">Exam name</label><input id="scheduleExamName" class="form-control" required maxlength="100"></div>
          <div class="form-grid">
            <div class="form-group"><label for="scheduleExamType">Exam type</label><select id="scheduleExamType" class="form-control" required></select></div>
            <div class="form-group"><label for="scheduleExamClassYear">Class / academic year</label><select id="scheduleExamClassYear" class="form-control" required></select></div>
          </div>
          <div class="form-grid">
            <div class="form-group"><label for="scheduleExamStart">Start date</label><input id="scheduleExamStart" class="form-control" type="date" required></div>
            <div class="form-group"><label for="scheduleExamEnd">End date</label><input id="scheduleExamEnd" class="form-control" type="date" required></div>
          </div>
          <div class="form-grid">
            <div class="form-group"><label for="scheduleExamStatus">Status</label><select id="scheduleExamStatus" class="form-control" required></select></div>
            <div class="form-group"><label for="scheduleExamInstructions">Instructions (optional)</label><input id="scheduleExamInstructions" class="form-control" maxlength="1000"></div>
          </div>
          <h4>Scheduled subjects</h4><div id="examSubjectRows"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-add-exam-subject>Add subject</button>
          <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close-exam>Cancel</button><button type="submit" class="btn btn-primary">Save schedule</button></div>
        </form>
      </div></div>`;

    const type = document.getElementById('scheduleExamType');
    EXAM_TYPES.forEach(value => type.add(new Option(value, value)));
    const status = document.getElementById('scheduleExamStatus');
    EXAM_STATUSES.forEach(value => status.add(new Option(value, value)));
    examRoot.addEventListener('click', onExamClick);
    document.getElementById('examScheduleForm').addEventListener('submit', saveExamSchedule);
  }

  function addExamSubject(values = {}) {
    const row = document.createElement('div');
    row.className = 'card';
    row.dataset.examSubject = '';
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    const fields = [
      ['Subject', 'subject', 'text', values.subject || '', true],
      ['Exam date', 'date', 'date', dateInputValue(values.date), true],
      ['Start time', 'startTime', 'time', values.startTime || '', false],
      ['End time', 'endTime', 'time', values.endTime || '', false],
      ['Maximum marks', 'maxMarks', 'number', values.maxMarks ?? '', true],
      ['Room (optional)', 'room', 'text', values.room || '', false],
    ];
    for (const [labelText, key, type, value, required] of fields) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.className = 'form-control';
      input.type = type;
      input.dataset.field = key;
      input.value = String(value);
      if (required) input.required = true;
      if (key === 'maxMarks') { input.min = '1'; input.step = '0.01'; }
      label.appendChild(input);
      grid.appendChild(label);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-sm';
    remove.textContent = 'Remove subject';
    remove.dataset.removeExamSubject = '';
    row.append(grid, remove);
    document.getElementById('examSubjectRows').appendChild(row);
  }

  async function openExamForm(exam = null) {
    try {
      await loadClasses();
      const form = document.getElementById('examScheduleForm');
      form.reset();
      const select = document.getElementById('scheduleExamClassYear');
      fillClassYearSelect(select, exam?.class, exam?.academicYear);
      state.editingExam = exam?._id || null;
      document.getElementById('examScheduleTitle').textContent = exam ? 'Edit exam schedule' : 'Add exam schedule';
      document.getElementById('scheduleExamName').value = exam?.name || '';
      document.getElementById('scheduleExamType').value = exam?.examType || EXAM_TYPES[0];
      document.getElementById('scheduleExamStart').value = dateInputValue(exam?.startDate);
      document.getElementById('scheduleExamEnd').value = dateInputValue(exam?.endDate);
      document.getElementById('scheduleExamStatus').value = exam?.status || 'Scheduled';
      document.getElementById('scheduleExamInstructions').value = exam?.instructions || '';
      document.getElementById('examSubjectRows').replaceChildren();
      const subjects = Array.isArray(exam?.subjects) ? exam.subjects : [];
      if (subjects.length) subjects.forEach(addExamSubject);
      else addExamSubject();
      window.openModal('examScheduleModal');
    } catch (error) {
      notify('error', 'Exam schedule unavailable', error.message, 'examScheduleStatus');
    }
  }

  async function loadExamSchedules() {
    statusMessage('examScheduleStatus', 'Loading exam schedules…');
    try {
      await loadClasses();
      const response = requireApiSuccess(await apiFetch('/exams'), 'Exam schedule list');
      if (!Array.isArray(response.data)) throw new Error('Exam schedule response was invalid.');
      state.exams = response.data;
      const body = document.getElementById('examScheduleRows');
      body.replaceChildren();
      if (!state.exams.length) {
        const row = document.createElement('tr');
        appendCell(row, 'No exam schedules are configured.');
        const cell = row.cells[0];
        cell.colSpan = 6;
        body.appendChild(row);
      } else {
        for (const exam of state.exams) {
          const row = document.createElement('tr');
          appendCell(row, exam.name);
          appendCell(row, exam.examType);
          appendCell(row, `${exam.class || '—'} · ${exam.academicYear || '—'}`);
          appendCell(row, `${dateInputValue(exam.startDate) || '—'} to ${dateInputValue(exam.endDate) || '—'}`);
          appendCell(row, exam.status);
          const action = document.createElement('td');
          action.appendChild(makeAction('Edit', 'editExam', String(exam._id)));
          row.appendChild(action);
          body.appendChild(row);
        }
      }
      statusMessage('examScheduleStatus', `${state.exams.length} exam schedule${state.exams.length === 1 ? '' : 's'} loaded.`);
    } catch (error) {
      statusMessage('examScheduleStatus', error.message || 'Exam schedules could not be loaded.');
    }
  }

  function onExamClick(event) {
    if (event.target.closest('[data-open-exam]')) openExamForm();
    if (event.target.closest('[data-close-exam]')) window.closeModal('examScheduleModal');
    if (event.target.closest('[data-add-exam-subject]')) addExamSubject();
    const remove = event.target.closest('[data-remove-exam-subject]');
    if (remove) remove.closest('[data-exam-subject]')?.remove();
    const edit = event.target.closest('[data-edit-exam]');
    if (edit) {
      const exam = state.exams.find(item => String(item._id) === edit.dataset.editExam);
      if (exam) openExamForm(exam);
    }
  }

  async function saveExamSchedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const pair = decodePair(document.getElementById('scheduleExamClassYear').value);
    const startDate = document.getElementById('scheduleExamStart').value;
    const endDate = document.getElementById('scheduleExamEnd').value;
    const subjects = [...document.querySelectorAll('#examSubjectRows [data-exam-subject]')].map(row => {
      const values = Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value.trim()]));
      return {
        subject: values.subject,
        date: values.date,
        startTime: values.startTime || undefined,
        endTime: values.endTime || undefined,
        room: values.room || undefined,
        maxMarks: Number(values.maxMarks),
      };
    });
    if (!pair || !startDate || !endDate || startDate > endDate || !subjects.length ||
        subjects.some(subject => !subject.subject || !subject.date || !Number.isFinite(subject.maxMarks) || subject.maxMarks <= 0)) {
      return notify('warning', 'Check exam schedule', 'Choose a class/year, valid date range, and complete subject rows.', 'examScheduleStatus');
    }
    const payload = {
      name: document.getElementById('scheduleExamName').value.trim(),
      examType: document.getElementById('scheduleExamType').value,
      class: pair.className,
      academicYear: pair.academicYear,
      startDate,
      endDate,
      status: document.getElementById('scheduleExamStatus').value,
      instructions: document.getElementById('scheduleExamInstructions').value.trim(),
      subjects,
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const path = state.editingExam ? `/exams/${encodeURIComponent(state.editingExam)}` : '/exams';
      requireApiSuccess(await apiFetch(path, { method: state.editingExam ? 'PUT' : 'POST', body: JSON.stringify(payload) }), 'Exam schedule save');
      window.closeModal('examScheduleModal');
      notify('success', 'Exam schedule saved', 'The schedule was saved.', 'examScheduleStatus');
      await loadExamSchedules();
    } catch (error) {
      notify('error', 'Exam schedule not saved', error.message || 'The schedule could not be saved.', 'examScheduleStatus');
    } finally {
      submit.disabled = false;
    }
  }

  function timetableMarkup() {
    timetableRoot.innerHTML = `
      <div class="section-header">
        <div><h2><i class="fas fa-calendar-alt"></i> Class Timetables</h2><p class="text-muted">Manage one weekday schedule per class and academic year.</p></div>
        <button type="button" class="btn btn-primary" data-open-timetable><i class="fas fa-plus"></i> Add timetable</button>
      </div>
      <p id="timetableManagerStatus" class="text-muted" role="status" aria-live="polite"></p>
      <div class="card"><div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Class / Year</th><th>Weekday</th><th>Periods</th><th>Action</th></tr></thead>
        <tbody id="timetableManagerRows"></tbody>
      </table></div></div>
      <div class="modal-overlay" id="timetableManagerModal" aria-hidden="true"><div class="modal">
        <div class="modal-header"><h3 id="timetableManagerTitle">Add timetable</h3><button type="button" class="btn btn-ghost" data-close-timetable aria-label="Close">&times;</button></div>
        <form id="timetableManagerForm" class="modal-body">
          <div class="form-grid"><div class="form-group"><label for="timetableClassYear">Class / academic year</label><select id="timetableClassYear" class="form-control" required></select></div>
          <div class="form-group"><label for="timetableDay">Weekday</label><select id="timetableDay" class="form-control" required></select></div></div>
          <h4>Periods</h4><div id="timetablePeriodRows"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-add-period>Add period</button>
          <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close-timetable>Cancel</button><button type="submit" class="btn btn-primary">Save timetable</button></div>
        </form>
      </div></div>`;

    const daySelect = document.getElementById('timetableDay');
    DAYS.forEach(day => daySelect.add(new Option(day, day)));
    timetableRoot.addEventListener('click', onTimetableClick);
    document.getElementById('timetableManagerForm').addEventListener('submit', saveTimetable);
  }

  function addPeriod(values = {}) {
    const row = document.createElement('div');
    row.className = 'card';
    row.dataset.timetablePeriod = '';
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    const fields = [
      ['Period number', 'periodNumber', 'number', values.periodNumber ?? ((document.querySelectorAll('[data-timetable-period]').length || 0) + 1)],
      ['Start time', 'startTime', 'time', values.startTime || ''],
      ['End time', 'endTime', 'time', values.endTime || ''],
      ['Subject / activity', 'subject', 'text', values.subject || ''],
      ['Room', 'room', 'text', values.room || ''],
    ];
    for (const [labelText, key, type, value] of fields) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.className = 'form-control';
      input.type = type;
      input.dataset.field = key;
      input.value = String(value);
      if (key === 'periodNumber') { input.min = '1'; input.step = '1'; input.required = true; }
      if (key === 'subject') input.required = true;
      label.appendChild(input);
      grid.appendChild(label);
    }
    const teacherLabel = document.createElement('label');
    teacherLabel.textContent = 'Teacher (optional for breaks/activities)';
    const teacherSelect = document.createElement('select');
    teacherSelect.className = 'form-control';
    teacherSelect.dataset.field = 'teacher';
    teacherSelect.add(new Option('Unassigned', ''));
    for (const teacher of state.faculty || []) {
      const name = teacher.user?.name || teacher.user?.email || teacher.employeeId || 'Teacher';
      teacherSelect.add(new Option(name, String(teacher._id)));
    }
    const teacherId = values.teacher?._id || values.teacher;
    if (teacherId) teacherSelect.value = String(teacherId);
    teacherLabel.appendChild(teacherSelect);
    grid.appendChild(teacherLabel);

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Period type';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-control';
    typeSelect.dataset.field = 'type';
    PERIOD_TYPES.forEach(type => typeSelect.add(new Option(type, type)));
    typeSelect.value = values.type || 'Regular';
    typeLabel.appendChild(typeSelect);
    grid.appendChild(typeLabel);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-sm';
    remove.textContent = 'Remove period';
    remove.dataset.removePeriod = '';
    row.append(grid, remove);
    document.getElementById('timetablePeriodRows').appendChild(row);
  }

  async function openTimetableForm(item = null) {
    try {
      await Promise.all([loadClasses(), loadFaculty()]);
      const form = document.getElementById('timetableManagerForm');
      form.reset();
      fillClassYearSelect(document.getElementById('timetableClassYear'), item?.class, item?.academicYear);
      state.editingTimetable = item?._id || null;
      document.getElementById('timetableManagerTitle').textContent = item ? 'Edit timetable' : 'Add timetable';
      document.getElementById('timetableDay').value = item?.day || DAYS[0];
      const rows = document.getElementById('timetablePeriodRows');
      rows.replaceChildren();
      const periods = Array.isArray(item?.periods) ? item.periods : [];
      if (periods.length) periods.forEach(addPeriod);
      else addPeriod();
      window.openModal('timetableManagerModal');
    } catch (error) {
      notify('error', 'Timetable unavailable', error.message, 'timetableManagerStatus');
    }
  }

  async function loadTimetables() {
    statusMessage('timetableManagerStatus', 'Loading class timetables…');
    try {
      const response = requireApiSuccess(await apiFetch('/timetable'), 'Timetable list');
      if (!Array.isArray(response.data)) throw new Error('Timetable response was invalid.');
      state.timetables = response.data;
      const body = document.getElementById('timetableManagerRows');
      body.replaceChildren();
      if (!state.timetables.length) {
        const row = document.createElement('tr');
        appendCell(row, 'No timetables are configured.');
        row.cells[0].colSpan = 4;
        body.appendChild(row);
      } else {
        for (const item of state.timetables) {
          const row = document.createElement('tr');
          appendCell(row, `${item.class || '—'} · ${item.academicYear || '—'}`);
          appendCell(row, item.day);
          appendCell(row, Array.isArray(item.periods) ? item.periods.length : 0);
          const action = document.createElement('td');
          action.appendChild(makeAction('Edit', 'editTimetable', String(item._id)));
          row.appendChild(action);
          body.appendChild(row);
        }
      }
      statusMessage('timetableManagerStatus', `${state.timetables.length} timetable day${state.timetables.length === 1 ? '' : 's'} loaded.`);
    } catch (error) {
      statusMessage('timetableManagerStatus', error.message || 'Timetables could not be loaded.');
    }
  }

  function onTimetableClick(event) {
    if (event.target.closest('[data-open-timetable]')) openTimetableForm();
    if (event.target.closest('[data-close-timetable]')) window.closeModal('timetableManagerModal');
    if (event.target.closest('[data-add-period]')) addPeriod();
    const remove = event.target.closest('[data-remove-period]');
    if (remove) remove.closest('[data-timetable-period]')?.remove();
    const edit = event.target.closest('[data-edit-timetable]');
    if (edit) {
      const item = state.timetables.find(record => String(record._id) === edit.dataset.editTimetable);
      if (item) openTimetableForm(item);
    }
  }

  async function saveTimetable(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const pair = decodePair(document.getElementById('timetableClassYear').value);
    const periods = [...document.querySelectorAll('#timetablePeriodRows [data-timetable-period]')].map(row => {
      const values = Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value.trim()]));
      return {
        periodNumber: Number(values.periodNumber),
        startTime: values.startTime,
        endTime: values.endTime,
        subject: values.subject,
        room: values.room || undefined,
        teacher: values.teacher || undefined,
        type: values.type,
      };
    });
    if (!pair || !periods.length || periods.some(period => !Number.isInteger(period.periodNumber) || period.periodNumber < 1 || !period.subject) ||
        new Set(periods.map(period => period.periodNumber)).size !== periods.length) {
      return notify('warning', 'Check timetable', 'Choose a class/year and provide unique period numbers and subject/activity names.', 'timetableManagerStatus');
    }
    const payload = { class: pair.className, academicYear: pair.academicYear, day: document.getElementById('timetableDay').value, periods };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const path = state.editingTimetable ? `/timetable/${encodeURIComponent(state.editingTimetable)}` : '/timetable';
      requireApiSuccess(await apiFetch(path, { method: state.editingTimetable ? 'PUT' : 'POST', body: JSON.stringify(payload) }), 'Timetable save');
      window.closeModal('timetableManagerModal');
      notify('success', 'Timetable saved', 'The class timetable was saved.', 'timetableManagerStatus');
      await loadTimetables();
    } catch (error) {
      notify('error', 'Timetable not saved', error.message || 'The timetable could not be saved.', 'timetableManagerStatus');
    } finally {
      submit.disabled = false;
    }
  }

  if (examRoot) {
    examMarkup();
    window.onPanel_exams = loadExamSchedules;
  }
  if (timetableRoot) {
    timetableMarkup();
    window.onPanel_timetable = loadTimetables;
  }
})();
