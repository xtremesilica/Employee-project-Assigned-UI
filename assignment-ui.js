(() => {
  'use strict';

  const CONFIG = {
    apiBaseUrl: 'https://automation.sionsemi.com',

    extractPath: '/webhook/assignment/extract',
    confirmPath: '/webhook/assignment/confirm',
    projectsPath: '/webhook/dashboard/projects',

    // Audit label only. Manager authorization must be checked in n8n.
    getCurrentUserId: () =>
      sessionStorage.getItem('xtreme_user_id') || 'admin-user-id',

    requestTimeoutMs: 60000
  };

  const $ = (selector) => document.querySelector(selector);

  const dialog = $('#assignmentDialog');
  const form = $('#confirmForm');
  const instruction = $('#instruction');

  let latestProjects = [];
  let extractionRunning = false;
  let confirmationRunning = false;
  let assignmentSaved = false;
  let extractedInstruction = '';

  function setStep(step) {
    document.querySelectorAll('[data-step]').forEach((element) => {
      element.hidden = Number(element.dataset.step) !== step;
    });

    document
      .querySelectorAll('[data-step-indicator]')
      .forEach((element) => {
        element.classList.toggle(
          'active',
          Number(element.dataset.stepIndicator) <= step
        );
      });

    hideNotice();
  }

  function showNotice(message, isError = false) {
    const notice = $('#notice');

    notice.textContent = message;
    notice.className = `notice${isError ? ' error' : ''}`;
    notice.hidden = false;
  }

  function hideNotice() {
    $('#notice').hidden = true;
  }

  function resetAssignment() {
    form.reset();
    instruction.value = '';
    extractedInstruction = '';
    assignmentSaved = false;

    $('#charCount').textContent = '0';
    $('#createdProjectId').textContent = '—';
    $('#createdTaskId').textContent = '—';
    $('#confirmButton').disabled = false;

    setStep(1);
  }

  function getErrorMessage(payload, fallback) {
    const detail = payload?.message || payload?.detail || payload?.error;

    if (typeof detail === 'string') return detail;
    if (detail) return JSON.stringify(detail);

    return fallback;
  }

  async function apiRequest(path, options = {}) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      CONFIG.requestTimeoutMs
    );

    const url = `${CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`;

    try {
      const response = await fetch(url, {
        ...options,

        // This integration does not use cross-domain login cookies.
        // Explicit authentication headers can still be supplied.
        credentials: 'omit',

        headers: {
          Accept: 'application/json',
          ...(options.body
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers
        },

        signal: controller.signal
      });

      const responseText = await response.text();
      let payload;

      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        throw new Error(
          `The server returned a non-JSON response ` +
          `(${response.status}). Check the n8n execution.`
        );
      }

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            `Request failed (${response.status}). Check the webhook URL and n8n execution.`
          )
        );
      }

      if (payload === null) {
        throw new Error(
          'n8n returned an empty response. Check the Respond to Webhook node.'
        );
      }

      if (payload.success === false) {
        throw new Error(
          getErrorMessage(payload, 'The workflow could not complete the request.')
        );
      }

      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(
          'The request timed out. Check n8n Executions before trying again.'
        );
      }

      if (error instanceof TypeError) {
        throw new Error(
          'Cannot read the response from n8n. Check the webhook URL, ' +
          'workflow activation, and browser Console for CORS or connection errors.'
        );
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeExtractResponse(data) {
    return {
      details: data.extracted || data.assignment || data,
      employees: Array.isArray(data.employees) ? data.employees : [],
      managers: Array.isArray(data.managers) ? data.managers : []
    };
  }

  function fillSelect(select, people, selectedId) {
    select.replaceChildren(new Option('Select', ''));

    const seenIds = new Set();

    people.forEach((person) => {
      const id = person.employee_id ?? person.manager_id ?? person.id;

      if (id === undefined || id === null) return;

      const value = String(id);

      if (seenIds.has(value)) return;
      seenIds.add(value);

      select.add(
        new Option(person.name || `ID ${value}`, value)
      );
    });

    if (selectedId !== undefined && selectedId !== null) {
      // Select only IDs supplied by the backend's people list.
      select.value = String(selectedId);
    }
  }

  function populatePreview(data) {
    const { details, employees, managers } =
      normalizeExtractResponse(data);

    if (!details || typeof details !== 'object') {
      throw new Error('The workflow returned an invalid assignment preview.');
    }

    form.reset();

    [
      'project_name',
      'task_title',
      'task_description',
      'due_date'
    ].forEach((key) => {
      if (form.elements[key]) {
        form.elements[key].value = details[key] ?? '';
      }
    });

    const priorities = ['Low', 'Medium', 'High', 'Critical'];

    form.elements.priority.value = priorities.includes(details.priority)
      ? details.priority
      : 'Medium';

    fillSelect(
      form.elements.employee_id,
      employees,
      details.employee_id
    );

    fillSelect(
      form.elements.manager_id,
      managers,
      details.manager_id
    );
  }

  async function refreshDashboardProjects() {
    const result = await apiRequest(CONFIG.projectsPath, {
      method: 'GET'
    });

    const projects = Array.isArray(result)
      ? result
      : result.projects ?? result.data;

    if (!Array.isArray(projects)) {
      throw new Error(
        'The dashboard webhook must return a projects array.'
      );
    }

    latestProjects = projects;

    window.dispatchEvent(
      new CustomEvent('dashboard:projects-refreshed', {
        detail: { projects: latestProjects }
      })
    );

    if (typeof window.renderProjectDashboard === 'function') {
      window.renderProjectDashboard(latestProjects);
    }

    return latestProjects;
  }

  $('#openAssignment').addEventListener('click', () => {
    if (extractionRunning || confirmationRunning) return;

    if (assignmentSaved) {
      setStep(3);
    } else {
      setStep(1);
    }

    dialog.showModal();

    if (!assignmentSaved) instruction.focus();
  });

  function closeDialog() {
    if (extractionRunning || confirmationRunning) {
      showNotice('Please wait for the current request to finish.');
      return;
    }

    dialog.close();
  }

  $('#closeAssignment').addEventListener('click', closeDialog);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', closeDialog);
  });

  dialog.addEventListener('cancel', (event) => {
    if (extractionRunning || confirmationRunning) {
      event.preventDefault();
    }
  });

  $('#doneButton').addEventListener('click', () => {
    dialog.close();
    resetAssignment();
  });

  $('#backButton').addEventListener('click', () => {
    if (!confirmationRunning && !assignmentSaved) {
      setStep(1);
    }
  });

  instruction.addEventListener('input', () => {
    $('#charCount').textContent = String(instruction.value.length);
  });

  $('#extractButton').addEventListener('click', async () => {
    if (extractionRunning || confirmationRunning || assignmentSaved) {
      return;
    }

    const text = instruction.value.trim();

    if (text.length < 10) {
      showNotice(
        'Please enter an assignment instruction of at least 10 characters.',
        true
      );
      return;
    }

    if (text.length > 2000) {
      showNotice(
        'Assignment instructions cannot exceed 2,000 characters.',
        true
      );
      return;
    }

    const button = $('#extractButton');

    extractionRunning = true;
    button.disabled = true;
    button.textContent = 'Extracting…';
    hideNotice();

    try {
      const data = await apiRequest(CONFIG.extractPath, {
        method: 'POST',
        body: JSON.stringify({ instruction: text })
      });

      populatePreview(data);
      extractedInstruction = text;
      setStep(2);

      const missingFields = [
        'project_name',
        'employee_id',
        'manager_id',
        'task_title',
        'task_description',
        'due_date'
      ].filter((key) => !form.elements[key]?.value.trim());

      if (missingFields.length) {
        showNotice(
          'Please complete the missing details and review the assignment before saving.'
        );
      }
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      extractionRunning = false;
      button.disabled = false;
      button.textContent = 'Extract details with AI';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (confirmationRunning || assignmentSaved) return;
    if (!form.reportValidity()) return;

    const payload = Object.fromEntries(
      new FormData(form).entries()
    );

    delete payload.managerConfirmation;

    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') {
        payload[key] = payload[key].trim();
      }
    });

    const requiredFields = [
      'project_name',
      'employee_id',
      'manager_id',
      'task_title',
      'task_description',
      'due_date'
    ];

    if (requiredFields.some((key) => !payload[key])) {
      showNotice('Please complete every required field.', true);
      return;
    }

    payload.confirmed_by = CONFIG.getCurrentUserId();
    payload.instruction_text = extractedInstruction;

    const button = $('#confirmButton');

    confirmationRunning = true;
    button.disabled = true;
    button.textContent = 'Creating task…';
    hideNotice();

    try {
      const result = await apiRequest(CONFIG.confirmPath, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (result.success !== true) {
        throw new Error(
          'The server did not confirm the save. Check n8n Executions before submitting again.'
        );
      }

      assignmentSaved = true;

      $('#createdProjectId').textContent =
        result.project_id ?? '—';

      $('#createdTaskId').textContent =
        result.task_id ?? '—';

      $('#successMessage').textContent =
        result.message || 'Assignment created successfully.';

      setStep(3);

      if (result.refresh_required !== false) {
        try {
          await refreshDashboardProjects();

          $('#successMessage').textContent =
            'Assignment saved successfully and dashboard data refreshed.';
        } catch (error) {
          $('#successMessage').textContent =
            'Assignment saved successfully, but the dashboard could not refresh.';

          showNotice(
            'Do not submit again. Dashboard refresh error: ' +
            error.message,
            true
          );
        }
      }
    } catch (error) {
      showNotice(
        error.message +
        ' If the request reached n8n, check its execution and database records before retrying.',
        true
      );
    } finally {
      confirmationRunning = false;
      button.disabled = assignmentSaved;
      button.textContent = 'Confirm & create task';
    }
  });

  // Refresh dashboard data without creating another assignment.
  window.refreshXtremeProjects = refreshDashboardProjects;
})();
