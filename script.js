const loginForm = document.querySelector('#login-panel form');
const signupForm = document.querySelector('#signup-panel form');

const showMessage = (message, isError = false) => {
  const existing = document.querySelector('.form-status');
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.className = 'form-status';
  box.textContent = message;
  box.style.color = isError ? '#c0392b' : '#1f7a58';
  box.style.marginTop = '0.75rem';
  box.style.fontWeight = '600';
  box.style.fontSize = '0.9rem';

  const target = document.querySelector('.auth-card');
  target.appendChild(box);
};

const submitAuth = async (form, endpoint, payload) => {
  try {
    const response = await fetch(`${window.location.origin}/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'No se pudo completar la solicitud');
    }

    showMessage('Autenticación exitosa.');
    sessionStorage.setItem('studytrack_token', data.token || '');
    console.log('Token guardado:', data.token);

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 700);
  } catch (error) {
    showMessage(error.message || 'Hubo un error al autenticarte.', true);
    console.error(error);
  }
};

if (loginForm) {
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    submitAuth(loginForm, 'login', { email, password });
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value.trim();

    submitAuth(signupForm, 'register', { name, email, password });
  });
}
