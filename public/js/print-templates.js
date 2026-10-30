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
        const studentId = params.get('id') || 'STU001';
        setTimeout(() => {
            const data = {
                name: 'John Doe',
                roll: '45',
                class: 'X-A',
                admissionNo: studentId,
                dob: '15-08-2010',
                attendance: '95%',
                overall: 'A',
                remarks: 'Excellent performance. Keep it up!',
                marks: [
                    { subject: 'English', t1: 45, t2: 48, total: 93, grade: 'A1' },
                    { subject: 'Mathematics', t1: 49, t2: 50, total: 99, grade: 'A1' },
                    { subject: 'Science', t1: 42, t2: 46, total: 88, grade: 'A2' },
                    { subject: 'Social Studies', t1: 40, t2: 45, total: 85, grade: 'A2' }
                ]
            };

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setText('studentName', data.name);
            setText('rollNo', data.roll);
            setText('className', data.class);
            setText('admissionNo', data.admissionNo);
            setText('dob', data.dob);
            setText('attendance', data.attendance);
            setText('overallGrade', data.overall);
            setText('remarks', data.remarks);

            const marksBody = document.getElementById('marksBody');
            if (marksBody) {
                marksBody.innerHTML = '';
                data.marks.forEach(m => {
                    const tr = document.createElement('tr');
                    const fields = [m.subject, m.t1, m.t2, m.total, m.grade];
                    fields.forEach(val => {
                        const td = document.createElement('td');
                        td.textContent = String(val);
                        tr.appendChild(td);
                    });
                    marksBody.appendChild(tr);
                });
            }
        }, 300);
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
                lastResult: 'Passed CBSE Board Examination',
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
