# Xtreme Silica Assignment UI

Drop these three files into the GitHub Pages dashboard and add the button/dialog markup from `index.html` to the existing dashboard page. Keep `styles.css` and `assignment-ui.js` beside it.

## Configure

In `assignment-ui.js`, change `CONFIG.apiBaseUrl` to the secured API or n8n domain. The frontend sends:

- `POST /webhook/assignment/extract` with `{ "instruction": "..." }`
- `POST /webhook/assignment/confirm` only after manager confirmation
- `GET /api/dashboard/projects` immediately after a successful save

Use an authentication/session layer to supply `confirmed_by`. The example reads `xtreme_user_id` from `sessionStorage`; replace this with your real authenticated identity. Do not put API keys or database credentials in frontend code.

## Expected extract response

```json
{
  "extracted": {
    "project_name": "Xtreme Silica Dashboard",
    "employee_id": "91",
    "employee_name": "Karthikeya",
    "manager_id": "5",
    "manager_name": "Girish",
    "task_title": "Dashboard API Integration",
    "task_description": "Connect the dashboard with MySQL and verify the API.",
    "priority": "High",
    "due_date": "2026-09-20"
  },
  "employees": [{ "id": "91", "name": "Karthikeya" }],
  "managers": [{ "id": "5", "name": "Girish" }]
}
```

## Connect existing dashboard widgets

The UI emits `dashboard:projects-refreshed` after the GET request succeeds:

```js
window.addEventListener('dashboard:projects-refreshed', (event) => {
  const projects = event.detail.projects;
  renderEmployeeTasks(projects);
  renderActiveProjects(projects);
  renderUpcomingDeadlines(projects);
  renderManagerResponsibilities(projects);
  renderPriorityTasks(projects);
  renderRecentActivity(projects);
});
```

If the dashboard already has `window.renderProjectDashboard(projects)`, the UI calls it automatically.

## Security requirements

- Restrict CORS to the GitHub Pages origin.
- Authenticate the manager on both webhook endpoints.
- Validate IDs and permissions again inside n8n; never trust frontend values.
- Use prepared SQL parameters in MySQL nodes.
- Add rate limiting to the extraction endpoint.
- Return only employees/managers the signed-in user is permitted to assign.
