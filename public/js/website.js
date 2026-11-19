const API_BASE = window.location.origin + '/api/v1';

document.addEventListener('DOMContentLoaded', () => {
    // --- Dark Mode Toggle ---
    const themeToggleBtn = document.getElementById('theme-toggle');
    const body = document.body;
    
    if (localStorage.getItem('theme') === 'dark') {
        body.classList.add('dark');
        if(themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    if(themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            body.classList.toggle('dark');
            if (body.classList.contains('dark')) {
                localStorage.setItem('theme', 'dark');
                themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
            } else {
                localStorage.setItem('theme', 'light');
                themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
            }
        });
    }

    // --- Mobile Menu Toggle ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.getElementById('nav-links');
    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('show');
            mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
        });
    }

    // --- Sticky Nav & Back to Top ---
    const mainNav = document.getElementById('main-nav');
    const backToTop = document.getElementById('back-to-top');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 150) {
            if(mainNav) mainNav.classList.add('scrolled');
            if(backToTop) cspSetVisibility(backToTop, true, 'flex');
        } else {
            if(mainNav) mainNav.classList.remove('scrolled');
            if(backToTop) cspSetVisibility(backToTop, false);
        }
    });

    if(backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // --- Fetch Notices ---
    const homeNoticesList = document.getElementById('home-notices-list');
    if (homeNoticesList) {
        fetch(API_BASE + '/notices/pinned')
            .then(res => {
                if(!res.ok) throw new Error('API not reachable');
                return res.json();
            })
            .then(data => {
                if (data.success && Array.isArray(data.data)) renderNotices(data.data, homeNoticesList);
                else showUnavailable(homeNoticesList, 'Notices are unavailable.');
            })
            .catch(() => showUnavailable(homeNoticesList, 'Notices could not be loaded.'));
    }

    // --- Fetch Events ---
    const homeEventsList = document.getElementById('home-events-list');
    if (homeEventsList) {
        fetch(API_BASE + '/events/public')
            .then(res => {
                if(!res.ok) throw new Error('API not reachable');
                return res.json();
            })
            .then(data => {
                if (data.success && Array.isArray(data.data)) renderEvents(data.data.slice(0, 3), homeEventsList);
                else showUnavailable(homeEventsList, 'Events are unavailable.');
            })
            .catch(() => showUnavailable(homeEventsList, 'Events could not be loaded.'));
    }

    // Helpers
    function renderNotices(notices, container) {
        container.innerHTML = '';
        if (!notices.length) return showUnavailable(container, 'No published notices.');
        notices.forEach(notice => {
            const date = new Date(notice.date || notice.createdAt);
            const html = `
                <div class="list-item">
                    <div class="date-box">
                        <span class="day">${date.getDate()}</span>
                        <span class="month">${date.toLocaleString('default', { month: 'short' })}</span>
                    </div>
                    <div class="item-content">
                        <h4>${notice.title}</h4>
                        <p>${notice.type || 'General'} | ${notice.department || 'School'}</p>
                    </div>
                </div>
            `;
            container.innerHTML += html;
        });
    }

    function renderEvents(events, container) {
        container.innerHTML = '';
        if (!events.length) return showUnavailable(container, 'No upcoming events.');
        events.forEach(ev => {
            const date = new Date(ev.startDate || ev.date);
            const description = typeof ev.description === 'string' ? ev.description.trim() : '';
            const summary = description.length > 50 ? `${description.substring(0, 50)}...` : description;
            const html = `
                <div class="list-item">
                    <div class="date-box">
                        <span class="day">${date.getDate()}</span>
                        <span class="month">${date.toLocaleString('default', { month: 'short' })}</span>
                    </div>
                    <div class="item-content">
                        <h4>${ev.title}</h4>
                        ${summary ? `<p>${summary}</p>` : ''}
                    </div>
                </div>
            `;
            container.innerHTML += html;
        });
    }

    function showUnavailable(container, message) {
        container.textContent = '';
        const state = document.createElement('p');
        state.className = 'empty-state';
        state.textContent = message;
        container.appendChild(state);
    }
});
