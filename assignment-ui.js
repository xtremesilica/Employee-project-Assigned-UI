(() => {
  // Point this to your secured n8n/API domain. Never place secrets in this file.
  const CONFIG = {
    apiBaseUrl: 'https://automation.sionsemi.com',
    extractPath: 'https://automation.sionsemi.com/webhook/assignment/extract',
    confirmPath: 'https://automation.sionsemi.com/webhook/assignment/confirm',
    projectsPath: 'https://automation.sionsemi.com/webhook/api/dashboard/projects',
    // Replace with the authenticated user's ID from your login/session layer.
    getCurrentUserId: () => sessionStorage.getItem('xtreme_user_id') || 'admin-user-id',
    requestTimeoutMs: 20000
  };

  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#assignmentDialog');
  const form = $('#confirmForm');
  const instruction = $('#instruction');
  let latestProjects = [];

  function setStep(step) {
    document.querySelectorAll('[data-step]').forEach(el => { el.hidden = Number(el.dataset.step) !== step; });
    document.querySelectorAll('[data-step-indicator]').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.stepIndicator) <= step);
    });
    hideNotice();
  }

  function showNotice(message, isError = false) {
    const notice = $('#notice');
    notice.textContent = message;
    notice.className = `notice${isError ? ' error' : ''}`;
    notice.hidden = false;
  }
  function hideNotice() { $('#notice').hidden = true; }

  async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    try {
      const response = await fetch(`${CONFIG.apiBaseUrl}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The server took too long to respond. Please try again.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function normalizeExtractResponse(data) {
    // Supports either { extracted: {...}, employees: [], managers: [] } or flat output.
    return { details: data.extracted || data.assignment || data, employees: data.employees || [], managers: data.managers || [] };
  }

  function fillSelect(select, people, selectedId, fallbackName) {
    select.innerHTML = '<option value="">Select</option>';
    people.forEach(person => {
      const option = new Option(person.name, String(person.employee_id ?? person.manager_id ?? person.id));
      select.add(option);
    });
    if (selectedId != null) select.value = String(selectedId);
    if (!select.value && selectedId != null) select.add(new Option(fallbackName || `ID ${selectedId}`, String(selectedId), true, true));
  }

  function populatePreview(data) {
    const { details, employees, managers } = normalizeExtractResponse(data);
    ['project_name', 'task_title', 'task_description', 'priority', 'due_date'].forEach(key => {
      if (form.elements[key] && details[key] != null) form.elements[key].value = details[key];
    });
    fillSelect(form.elements.employee_id, employees, details.employee_id, details.employee_name);
    fillSelect(form.elements.manager_id, managers, details.manager_id, details.manager_name);
  }

  async function refreshDashboardProjects() {
    const result = await apiRequest(CONFIG.projectsPath, { method: 'GET' });
    latestProjects = result.projects || result.data || result;
    // Existing dashboard widgets can subscribe to this event and redraw:
    // Employee tasks, Active projects, Upcoming deadlines, Manager responsibility,
    // Priority tasks and Recently assigned activity.
    window.dispatchEvent(new CustomEvent('dashboard:projects-refreshed', { detail: { projects: latestProjects } }));
    if (typeof window.renderProjectDashboard === 'function') window.renderProjectDashboard(latestProjects);
    return latestProjects;
  }

  $('#openAssignment').addEventListener('click', () => { setStep(1); dialog.showModal(); instruction.focus(); });
  $('#closeAssignment').addEventListener('click', () => dialog.close());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  $('#doneButton').addEventListener('click', () => { dialog.close(); form.reset(); instruction.value = ''; $('#charCount').textContent = '0'; });
  $('#backButton').addEventListener('click', () => setStep(1));
  instruction.addEventListener('input', () => { $('#charCount').textContent = instruction.value.length; });

  $('#extractButton').addEventListener('click', async () => {
    const text = instruction.value.trim();
    if (text.length < 10) return showNotice('Please enter a clearer assignment instruction.', true);
    const button = $('#extractButton');
    button.disabled = true; button.textContent = 'Extracting…'; hideNotice();
    try {
      const data = await apiRequest(CONFIG.extractPath, {
        method: 'POST',
        body: JSON.stringify({ instruction: text })
      });
      populatePreview(data);
      setStep(2);
    } catch (error) { showNotice(error.message, true); }
    finally { button.disabled = false; button.textContent = 'Extract details with AI'; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = $('#confirmButton');
    button.disabled = true; button.textContent = 'Creating task…'; hideNotice();
    const payload = Object.fromEntries(new FormData(form).entries());
    delete payload.managerConfirmation;
    payload.confirmed_by = CONFIG.getCurrentUserId();
    try {
      const result = await apiRequest(CONFIG.confirmPath, { method: 'POST', body: JSON.stringify(payload) });
      if (!result.success) throw new Error(result.message || 'The assignment could not be created.');
      $('#createdProjectId').textContent = result.project_id ?? '—';
      $('#createdTaskId').textContent = result.task_id ?? '—';
      $('#successMessage').textContent = result.message || 'Assignment created successfully.';
      if (result.refresh_required !== false) await refreshDashboardProjects();
      setStep(3);
    } catch (error) { showNotice(error.message, true); }
    finally { button.disabled = false; button.textContent = 'Confirm & create task'; }
  });

  // Optional public hook for refreshing from elsewhere in the dashboard.
  window.refreshXtremeProjects = refreshDashboardProjects;
})();
