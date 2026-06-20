// public/js/auth.js — Login authentication logic

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorAlert = document.getElementById('errorAlert');
  const submitBtn = document.getElementById('submitBtn');

  // Check URL query parameters for errors
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');
  if (error) {
    if (error === 'oauth_failed') {
      showError('Google OAuth authentication failed. Please try again or use credentials.');
    } else if (error === 'login_failed') {
      showError('Login process failed. Please check your credentials or contact administrator.');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorAlert.style.display = 'none';
    setLoading(true);

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Login success! Redirect to SPA
      window.location.href = '/app.html';
    } catch (err) {
      showError(err.message);
      setLoading(false);
    }
  });

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
  }

  function setLoading(loading) {
    if (loading) {
      submitBtn.disabled = true;
      submitBtn.querySelector('span').textContent = 'Authenticating...';
    } else {
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = 'Sign In to Workspace';
    }
  }
});
