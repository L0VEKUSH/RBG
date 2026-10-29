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
            navLinks.classList.toggle('show');
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

    // --- Animated Counters ---
    const counters = document.querySelectorAll('.counter');
    if(counters.length > 0) {
        const counterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if(entry.isIntersecting) {
                    const counter = entry.target;
                    const target = +counter.getAttribute('data-target');
                    const duration = 2000;
                    const increment = target / (duration / 16);
                    let current = 0;
                    
                    const updateCounter = () => {
                        current += increment;
                        if(current < target) {
                            counter.innerText = Math.ceil(current);
                            requestAnimationFrame(updateCounter);
                        } else {
                            counter.innerText = target;
                        }
                    };
                    updateCounter();
                    observer.unobserve(counter);
                }
            });
        }, { threshold: 0.5 });
        
        counters.forEach(counter => counterObserver.observe(counter));
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
                if (data.success && data.data && data.data.length > 0) {
                    renderNotices(data.data, homeNoticesList);
                } else {
                    throw new Error('No notices');
                }
            })
            .catch(err => {
                // Fallback to static
                const staticNotices = [
                    { title: "Admissions Open for 2026-27", date: new Date().toISOString(), type: "Admission" },
                    { title: "Parent-Teacher Meeting for Class X", date: new Date(Date.now() + 86400000*3).toISOString(), type: "Academic" },
                    { title: "Annual Sports Day Schedule", date: new Date(Date.now() + 86400000*7).toISOString(), type: "Events" }
                ];
                renderNotices(staticNotices, homeNoticesList);
            });
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
                if (data.success && data.data && data.data.length > 0) {
                    renderEvents(data.data.slice(0,3), homeEventsList);
                } else {
                    throw new Error('No events');
                }
            })
            .catch(err => {
                // Fallback
                const staticEvents = [
                    { title: "Science Exhibition", startDate: new Date(Date.now() + 86400000*5).toISOString(), description: "Annual science exhibition by middle school." },
                    { title: "Inter-School Debate", startDate: new Date(Date.now() + 86400000*12).toISOString(), description: "Debate competition for secondary section." }
                ];
                renderEvents(staticEvents, homeEventsList);
            });
    }

    // Helpers
    function renderNotices(notices, container) {
        container.innerHTML = '';
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
        events.forEach(ev => {
            const date = new Date(ev.startDate || ev.date);
            const html = `
                <div class="list-item">
                    <div class="date-box">
                        <span class="day">${date.getDate()}</span>
                        <span class="month">${date.toLocaleString('default', { month: 'short' })}</span>
                    </div>
                    <div class="item-content">
                        <h4>${ev.title}</h4>
                        <p>${ev.description ? ev.description.substring(0, 50) + '...' : 'School Event'}</p>
                    </div>
                </div>
            `;
            container.innerHTML += html;
        });
    }
});
