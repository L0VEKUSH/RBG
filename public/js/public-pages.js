/* admissions.html page behavior */
document.getElementById('admission-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = document.getElementById('btnSubmitAdm');
            const err = document.getElementById('admError');
            const suc = document.getElementById('admSuccess');
            
            cspSetVisibility(err, false);
            cspSetVisibility(suc, false);
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
            
            const payload = {
                studentName: document.getElementById('admStudentName').value,
                dateOfBirth: document.getElementById('admDob').value,
                classApplyingFor: document.getElementById('admClass').value,
                fatherEmail: document.getElementById('admEmail').value,
                fatherPhone: document.getElementById('admPhone').value,
                status: 'Submitted'
            };

            try {
                const res = await fetch('/api/v1/admissions/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to submit application.');
                
                this.reset();
                cspSetVisibility(this, false);
                cspSetVisibility(suc, true, 'block');
            } catch(error) {
                err.textContent = error.message;
                cspSetVisibility(err, true, 'block');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Submit Application';
            }
        });

/* contact.html page behavior */
document.getElementById('contact-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const btn = document.querySelector('#contact-form button[type="submit"]');
            if(btn){ btn.textContent = 'Message Sent'; btn.disabled = true; btn.classList.add('contact-submit-success'); }
document.getElementById('contact-form').reset();
            this.reset();
        });

/* events.html page behavior */
document.addEventListener('DOMContentLoaded', () => {
            const eventsGrid = document.getElementById('events-grid');
            fetch(API_BASE + '/events/public')
                .then(res => res.json())
                .then(data => {
                    if(data.success && data.data && data.data.length > 0) {
                        renderEventsGrid(data.data);
                    } else {
                        throw new Error('No events');
                    }
                })
                .catch(err => {
                    const fallback = [
                        { title: "Science Exhibition", startDate: new Date(Date.now() + 86400000*5).toISOString(), description: "Annual science exhibition by middle school." },
                        { title: "Inter-School Debate", startDate: new Date(Date.now() + 86400000*12).toISOString(), description: "Debate competition for secondary section." },
                        { title: "Annual Sports Meet", startDate: new Date(Date.now() + 86400000*30).toISOString(), description: "Track and field events." }
                    ];
                    renderEventsGrid(fallback);
                });

            function renderEventsGrid(events) {
                eventsGrid.innerHTML = '';
                events.forEach(ev => {
                    const date = new Date(ev.startDate || ev.date).toDateString();
                    eventsGrid.innerHTML += `
                        <div class="card">
                            <h3 class="csp-style-b0e08465c2">${ev.title}</h3>
                            <p class="subtitle"><i class="fas fa-calendar"></i> ${date}</p>
                            <p>${ev.description || 'Join us for this exciting school event.'}</p>
                        </div>
                    `;
                });
            }
        });

/* gallery.html page behavior */
document.querySelectorAll('.filter-tag').forEach(tag => {
            tag.addEventListener('click', function() {
                document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                // Client-side filter would be applied here with real image data
            });
        });

/* notices.html page behavior */
document.addEventListener('DOMContentLoaded', () => {
            const noticesList = document.getElementById('notices-page-list');
            fetch(API_BASE + '/notices') // non-pinned full list
                .then(res => res.json())
                .then(data => {
                    if(data.success && data.data && data.data.length > 0) {
                        renderNoticesFull(data.data);
                    } else {
                        throw new Error('No notices');
                    }
                })
                .catch(err => {
                    const fallback = [
                        { title: "Admissions Open for 2026-27", date: new Date().toISOString(), type: "Admission", content: "We are now accepting applications." },
                        { title: "Parent-Teacher Meeting for Class X", date: new Date(Date.now() + 86400000*3).toISOString(), type: "Academic", content: "Mandatory PTM." },
                        { title: "Annual Sports Day Schedule", date: new Date(Date.now() + 86400000*7).toISOString(), type: "Events", content: "Details of track events." }
                    ];
                    renderNoticesFull(fallback);
                });

            function renderNoticesFull(notices) {
                noticesList.innerHTML = '';
                notices.forEach(notice => {
                    const date = new Date(notice.date || notice.createdAt);
                    noticesList.innerHTML += `
                        <div class="list-item csp-style-3cf8c7bc18" >
                            <div class="date-box csp-style-f87270532f" >
                                <span class="day">${date.getDate()}</span>
                                <span class="month">${date.toLocaleString('default', { month: 'short' })}</span>
                            </div>
                            <div class="item-content">
                                <span class="csp-style-36ead2596f">${notice.type || 'General'}</span>
                                <h4 class="csp-style-04f181fe7c">${notice.title}</h4>
                                <p>${notice.content || 'Please contact school admin for details.'}</p>
                            </div>
                        </div>
                    `;
                });
            }
        });
