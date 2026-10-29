const API = '/api/v1';

    // Auto-redirect if already logged in
    if (localStorage.getItem('token') && localStorage.getItem('user')) {
      const user = JSON.parse(localStorage.getItem('user'));
      redirectUser(user.role);
    }

    function togglePassword() {
      const pw = document.getElementById('password');
      const icon = document.getElementById('pwIcon');
      if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
      else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
    }

    function fillDemo(e, p) {
      document.getElementById('email').value = e;
      document.getElementById('password').value = p;
    }

    function redirectUser(role) {
      const r = (role || '').toLowerCase();
      const map = {
        'super_admin': '/portal/admin.html',
        'school_admin': '/portal/admin.html',
        'admin': '/portal/admin.html', // Legacy fallback
        
        'principal': '/portal/principal.html',
        'vice_principal': '/portal/vice_principal.html',
        
        'academic_coordinator': '/portal/academic.html',
        
        'class_teacher': '/portal/teacher.html',
        'teacher': '/portal/teacher.html',
        'faculty': '/portal/teacher.html', // Legacy fallback
        
        'student': '/portal/student.html',
        'parent': '/portal/parent.html',
        
        'accountant': '/portal/finance.html',
        'librarian': '/portal/library.html',
        
        'admission_officer': '/portal/admissions.html',
        'exam_coordinator': '/portal/exam.html',
        
        'transport_admin': '/portal/driver.html', // Assuming transport admin uses driver portal temporarily or needs a separate one
        'driver': '/portal/driver.html',
        
        'receptionist': '/portal/reception.html',
        'hr': '/portal/hr.html',
        
        'staff': '/portal/staff.html',
        'nurse': '/portal/staff.html'
      };
      
      window.location.href = map[r] || '/portal/staff.html';
    }

    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const errEl = document.getElementById('loginError');
      const errMsg = document.getElementById('loginErrorMsg');
      const btn = document.getElementById('btnLogin');
      
      cspSetVisibility(errEl, false);
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
      
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      
      try {
        const res = await fetch(API + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Login failed. Invalid credentials.');
        }
        
        const token = data.data?.token || data.token;
        const user = data.data?.user || data.user || data.data;
        
        if (!token) throw new Error('Authentication error. No token received.');
        
        // Save using keys expected by portal-core.js
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        
        redirectUser(user.role);
        
      } catch (err) {
        cspSetVisibility(errEl, true, 'flex');
        errMsg.textContent = err.message || 'Network error.';
        btn.disabled = false;
        btn.innerHTML = 'Sign In <i class="fas fa-arrow-right"></i>';
      }
    });
