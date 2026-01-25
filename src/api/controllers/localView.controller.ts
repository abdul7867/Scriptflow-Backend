import { Request, Response } from 'express';
import { Script } from '../../db/models';
import { config } from '../../config';

/**
 * GET /local-dashboard
 *
 * A simple dashboard to view the latest generated scripts locally.
 * This is useful for debugging and seeing what's happening without
 * needing to check the database manually.
 */
export const localDashboardHandler = async (req: Request, res: Response) => {
    try {
        // Fetch the last 50 scripts
        const scripts = await Script.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        const scriptsRows = scripts.map(script => {
            const date = script.createdAt ? new Date(script.createdAt).toLocaleString() : 'N/A';
            // Truncate idea
            const idea = script.userIdea.length > 50
                ? script.userIdea.substring(0, 50) + '...'
                : script.userIdea;

            const viewLink = script.publicId
                ? `<a href="/s/${script.publicId}" target="_blank" class="view-btn">View Script</a>`
                : '<span class="no-link">No Public ID</span>';

            const format = script.storyFormat || 'Default';
            const variant = script.variationIndex || 0;

            return `
        <tr>
          <td>${date}</td>
          <td title="${script.userIdea}">${idea}</td>
          <td><span class="badge ${format.toLowerCase()}">${format}</span></td>
          <td>${variant}</td>
          <td>${script.manychatUserId}</td>
          <td>${viewLink}</td>
        </tr>
      `;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30"> <!-- Auto refresh every 30s -->
  <title>Local ScriptFlow Dashboard</title>
  <style>
    :root {
      --bg: #0f0f12;
      --card-bg: #18181b;
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --accent: #8b5cf6;
      --border: rgba(255,255,255,0.1);
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    
    h1 {
      margin: 0;
      font-size: 24px;
    }
    
    h1 span {
      color: var(--accent);
    }
    
    .refresh-btn {
      background: var(--card-bg);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      text-decoration: none;
    }
    
    .refresh-btn:hover {
      background: #27272a;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
    }
    
    th {
      text-align: left;
      padding: 12px 16px;
      background: #27272a;
      color: var(--text-muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    tr:hover {
      background: rgba(255,255,255,0.02);
    }
    
    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
      text-transform: uppercase;
      background: #3f3f46;
    }
    
    .badge.story { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge.edgy { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .badge.tutorial { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .badge.default { background: rgba(168, 162, 158, 0.2); color: #d6d3d1; }
    
    .view-btn {
      display: inline-block;
      background: var(--accent);
      color: white;
      text-decoration: none;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .view-btn:hover {
      opacity: 0.9;
    }
    
    .no-link {
      color: var(--text-muted);
      font-style: italic;
      font-size: 12px;
    }
    
    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Script<span>Flow</span> Local Dashboard</h1>
      <a href="/local-dashboard" class="refresh-btn">Refresh</a>
    </header>
    
    ${scripts.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Idea</th>
            <th>Format</th>
            <th>Var</th>
            <th>User ID</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${scriptsRows}
        </tbody>
      </table>
    ` : `
      <div class="empty-state">
        <p>No scripts found yet. Generate one to see it here!</p>
      </div>
    `}
  </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        res.status(500).send('Error loading dashboard: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
};
