/**
 * RBG School — Print Templates Client Script
 * Externalized to comply with strict Content Security Policy
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // ── Universal Print Trigger ───────────────────────────────────
    const printButtons = document.querySelectorAll('.btn-print');
    printButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            window.print();
        });
    });

    const params = new URLSearchParams(window.location.search);

    // ── 1. Fee Receipt Hydration ──────────────────────────────────
    const receiptTable = document.getElementById('particularsBody');
    if (receiptTable) {
        const receiptId = params.get('id') || 'REC-9923';
        setTimeout(() => {
            const data = {
                receiptNo: receiptId,
                date: new Date().toLocaleDateString(),
                studentName: 'Alice Smith',
                admissionNo: 'ADM-2022-5678',
                className: 'VIII-B',
                paymentMethod: 'Credit Card',
                particulars: [
                    { name: 'Tuition Fee (Term 1)', amount: 1200 },
                    { name: 'Library Fee', amount: 150 },
                    { name: 'Transport Fee', amount: 300 }
                ],
                subtotal: 1650,
                discount: 50,
                totalPaid: 1600,
                balance: 0,
                amountWords: 'One Thousand Six Hundred Dollars Only.'
            };

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setText('receiptNo', data.receiptNo);
            setText('receiptDate', data.date);
            setText('studentName', data.studentName);
            setText('admissionNo', data.admissionNo);
            setText('className', data.className);
            setText('paymentMethod', data.paymentMethod);

            receiptTable.innerHTML = '';
            data.particulars.forEach((p, i) => {
                const tr = document.createElement('tr');
                const tdNum = document.createElement('td');
                tdNum.textContent = String(i + 1);
                const tdName = document.createElement('td');
                tdName.textContent = p.name;
                const tdAmt = document.createElement('td');
                tdAmt.className = 'text-right';
                tdAmt.textContent = p.amount.toFixed(2);
                tr.appendChild(tdNum);
                tr.appendChild(tdName);
                tr.appendChild(tdAmt);
                receiptTable.appendChild(tr);
            });

            setText('subtotal', data.subtotal.toFixed(2));
            setText('discount', data.discount.toFixed(2));
            setText('totalPaid', data.totalPaid.toFixed(2));
            setText('balance', data.balance.toFixed(2));
            setText('amountWords', data.amountWords);
        }, 300);
    }

    // ── 2. Student ID Card Hydration ──────────────────────────────
    const idCard = document.querySelector('.id-card');
    if (idCard) {
        setTimeout(() => {
            const data = {
                name: 'Emma Watson',
                id: params.get('id') || 'STU-2023-445',
                className: 'IX-C',
                dob: '12-May-2009',
                bloodGroup: 'O+',
                contact: '9876543210'
            };

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setText('studentName', data.name);
            setText('studentId', data.id);
            setText('className', data.className);
            setText('dob', data.dob);
            setText('bloodGroup', data.bloodGroup);
            setText('contact', data.contact);
        }, 300);
    }

    // ── 3. Report Card Hydration ──────────────────────────────────
    const reportCard = document.getElementById('reportCardContent');
    if (reportCard) {
        hydrateReportCard(reportCard);
    }

    // ── 4. Transfer Certificate Hydration ─────────────────────────
    const tcNo = document.getElementById('tcNo');
    if (tcNo) {
        setTimeout(() => {
            const data = {
                tcNo: params.get('tc') || 'TC-2023-089',
                admNo: params.get('adm') || 'ADM-2018-990',
                pupilName: 'Michael Johnson',
                fatherName: 'Robert Johnson',
                motherName: 'Sarah Johnson',
                nationality: 'American',
                firstAdmission: '01-Apr-2018, Class V',
                dob: '22-Oct-2008 (Twenty Second October Two Thousand Eight)',
                lastClass: 'X (Tenth)',
                lastResult: 'PassedUP Board Board Examination',
                failed: 'No',
                subjects: 'English, Math, Science, Social Studies, Computer',
                promotion: 'Yes, to Class XI',
                duesPaid: 'March 2024',
                conduct: 'Good',
                appDate: '15-Mar-2024',
                issueDate: '05-Apr-2024',
                reason: 'Relocation of Parents'
            };

            for (const key in data) {
                const el = document.getElementById(key);
                if (el) el.textContent = data[key];
            }
        }, 300);
    }
});

async function fetchReportCardData(path) {
    const response = await fetch(`/api/v1${path}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* handled by the status check */ }
    if (!response.ok || payload.success !== true) {
        throw new Error(payload.message || (response.status === 401 ? 'Please sign in to view your report card.' : 'Report card data could not be loaded.'));
    }
    return payload.data;
}

function reportCardText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === '' ? 'Unavailable' : String(value);
}

function reportCardDate(value) {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'Unavailable';
}

async function hydrateReportCard(reportCard) {
    const status = document.getElementById('reportCardStatus');
    const printButton = document.getElementById('reportCardPrint');
    try {
        const [profileData, marksData, dashboardResult] = await Promise.all([
            fetchReportCardData('/students/my-profile'),
            fetchReportCardData('/marks/my-marks'),
            fetchReportCardData('/dashboard/student').then(data => ({ data })).catch(error => ({ error })),
        ]);
        const student = profileData?.student;
        const marks = marksData?.marks;
        if (!student || !Array.isArray(marks)) throw new Error('The authorized student profile or published results were not returned.');

        const user = student.user || {};
        const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ');
        reportCardText('studentName', name || 'Unavailable');
        reportCardText('rollNo', student.rollNumber);
        reportCardText('className', student.class);
        reportCardText('admissionNo', student.admissionNumber);
        reportCardText('dob', reportCardDate(user.dateOfBirth));

        const attendance = dashboardResult.data?.attendancePercentage;
        reportCardText('attendance', typeof attendance === 'number' ? `${attendance}%` : 'Unavailable');

        const years = [...new Set(marks.map(record => record?.academicYear).filter(Boolean))];
        reportCardText('academicYear', years.length ? years.join(', ') : student.academicYear || 'Unavailable');
        const gradeSummaries = marks
            .filter(record => record?.overallGrade)
            .map(record => `${record.examType || 'Exam'}: ${record.overallGrade}`);
        reportCardText('overallGrade', gradeSummaries.length ? gradeSummaries.join('; ') : 'No published grade');
        const remarks = marks
            .filter(record => typeof record?.remarks === 'string' && record.remarks.trim())
            .map(record => `${record.examType || 'Exam'}: ${record.remarks.trim()}`);
        reportCardText('remarks', remarks.length ? remarks.join('; ') : 'No remarks recorded');

        const body = document.getElementById('marksBody');
        if (body) {
            body.replaceChildren();
            const rows = marks.flatMap(record => (Array.isArray(record?.subjects) ? record.subjects : []).map(subject => ({ record, subject })));
            if (!rows.length) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.textContent = 'No published subject marks are available.';
                row.appendChild(cell);
                body.appendChild(row);
            } else {
                for (const { record, subject } of rows) {
                    const row = document.createElement('tr');
                    const values = [
                        `${record.examType || 'Exam'} / ${record.academicYear || 'Year unavailable'}`,
                        subject?.subject || 'Unavailable',
                        subject?.maxMarks ?? 'Unavailable',
                        subject?.isAbsent ? 'Absent' : subject?.marksObtained ?? 'Unavailable',
                        subject?.grade || 'Not recorded',
                    ];
                    for (const value of values) {
                        const cell = document.createElement('td');
                        cell.textContent = String(value);
                        row.appendChild(cell);
                    }
                    body.appendChild(row);
                }
            }
        }

        if (status) status.textContent = marks.length ? 'Published results loaded.' : 'Profile loaded; no published marks are available.';
        if (printButton) printButton.disabled = false;
    } catch (error) {
        reportCardText('studentName', 'Unavailable');
        reportCardText('academicYear', 'Unavailable');
        reportCardText('rollNo', 'Unavailable');
        reportCardText('className', 'Unavailable');
        reportCardText('admissionNo', 'Unavailable');
        reportCardText('dob', 'Unavailable');
        reportCardText('attendance', 'Unavailable');
        reportCardText('overallGrade', 'Unavailable');
        reportCardText('remarks', 'Unavailable');
        const body = document.getElementById('marksBody');
        if (body) body.replaceChildren();
        if (status) status.textContent = error.message || 'Report card could not be loaded.';
        if (printButton) printButton.disabled = true;
        reportCard.setAttribute('data-load-error', 'true');
    }
}
