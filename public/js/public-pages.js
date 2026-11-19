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

/* No contact-message endpoint is registered; do not claim that a message was sent. */
document.getElementById('contact-form').addEventListener('submit', function(e) {
            e.preventDefault();
            let status = this.querySelector('[data-contact-status]');
            if (!status) {
                status = document.createElement('p');
                status.dataset.contactStatus = 'true';
                status.setAttribute('role', 'status');
                this.appendChild(status);
            }
            status.textContent = 'This contact form is unavailable. Please use the school contact details on this page.';
        });

/* events.html page behavior */
document.addEventListener('DOMContentLoaded', () => {
            const eventsGrid = document.getElementById('events-grid');
            fetch(API_BASE + '/events/public')
                .then(res => res.json())
                .then(data => {
                    if (data.success && Array.isArray(data.data)) renderEventsGrid(data.data);
                    else showListState(eventsGrid, 'Events are unavailable.');
                })
                .catch(() => showListState(eventsGrid, 'Events could not be loaded.'));

            function renderEventsGrid(events) {
                eventsGrid.innerHTML = '';
                if (!events.length) return showListState(eventsGrid, 'No published events.');
                events.forEach(ev => {
                    const date = new Date(ev.startDate || ev.date).toDateString();
                    const description = typeof ev.description === 'string' ? ev.description.trim() : '';
                    eventsGrid.innerHTML += `
                        <div class="card">
                            <h3 class="csp-style-b0e08465c2">${ev.title}</h3>
                            <p class="subtitle"><i class="fas fa-calendar"></i> ${date}</p>
                            ${description ? `<p>${description}</p>` : ''}
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
                    if (data.success && Array.isArray(data.data)) renderNoticesFull(data.data);
                    else showListState(noticesList, 'Notices are unavailable.');
                })
                .catch(() => showListState(noticesList, 'Notices could not be loaded.'));

            function renderNoticesFull(notices) {
                noticesList.innerHTML = '';
                if (!notices.length) return showListState(noticesList, 'No published notices.');
                notices.forEach(notice => {
                    const date = new Date(notice.date || notice.createdAt);
                    const content = typeof notice.content === 'string' ? notice.content.trim() : '';
                    noticesList.innerHTML += `
                        <div class="list-item csp-style-3cf8c7bc18" >
                            <div class="date-box csp-style-f87270532f" >
                                <span class="day">${date.getDate()}</span>
                                <span class="month">${date.toLocaleString('default', { month: 'short' })}</span>
                            </div>
                            <div class="item-content">
                                <span class="csp-style-36ead2596f">${notice.type || 'General'}</span>
                                <h4 class="csp-style-04f181fe7c">${notice.title}</h4>
                                ${content ? `<p>${content}</p>` : ''}
                            </div>
                        </div>
                    `;
                });
            }
        });

function showListState(container, message) {
    if (!container) return;
    container.textContent = '';
    const state = document.createElement('p');
    state.className = 'empty-state';
    state.textContent = message;
    container.appendChild(state);
}
