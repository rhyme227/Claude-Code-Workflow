// MCP Manager Component
// Manages MCP server configuration from multiple sources:
// - Enterprise: managed-mcp.json (highest priority)
// - User: ~/.claude.json mcpServers
// - Project: .mcp.json in project root
// - Local: ~/.claude.json projects[path].mcpServers

// ========== MCP State ==========
let mcpConfig = null;
let mcpAllProjects = {};
let mcpGlobalServers = {};
let mcpUserServers = {};
let mcpEnterpriseServers = {};
let mcpCurrentProjectServers = {};
let mcpConfigSources = [];
let mcpCreateMode = 'form'; // 'form' or 'json'

// ========== CLI Toggle State (Claude / Codex) ==========
let currentCliMode = 'claude'; // 'claude' or 'codex'
let codexMcpConfig = null;
let codexMcpServers = {};

// ========== Project Config Type Preference ==========
// 'mcp' = .mcp.json (project root file, recommended)
// 'claude' = claude.json projects[path].mcpServers (shared config)
let preferredProjectConfigType = 'mcp';

// ========== Initialization ==========
function initMcpManager() {
  // Initialize MCP navigation
  document.querySelectorAll('.nav-item[data-view="mcp-manager"]').forEach(item => {
    item.addEventListener('click', () => {
      setActiveNavItem(item);
      currentView = 'mcp-manager';
      currentFilter = null;
      currentLiteType = null;
      currentSessionDetailKey = null;
      updateContentTitle();
      renderMcpManager();
    });
  });
}

// ========== Data Loading ==========
async function loadMcpConfig() {
  try {
    const response = await fetch('/api/mcp-config');
    if (!response.ok) throw new Error('Failed to load MCP config');
    const data = await response.json();
    mcpConfig = data;
    mcpAllProjects = data.projects || {};
    mcpGlobalServers = data.globalServers || {};
    mcpUserServers = data.userServers || {};
    mcpEnterpriseServers = data.enterpriseServers || {};
    mcpConfigSources = data.configSources || [];

    // Load Codex MCP config
    if (data.codex) {
      codexMcpConfig = data.codex;
      codexMcpServers = data.codex.servers || {};
    }

    // Get current project servers
    const currentPath = projectPath.replace(/\//g, '\\');
    mcpCurrentProjectServers = mcpAllProjects[currentPath]?.mcpServers || {};

    // Update badge count
    updateMcpBadge();

    return data;
  } catch (err) {
    console.error('Failed to load MCP config:', err);
    return null;
  }
}

// ========== CLI Mode Toggle ==========
function setCliMode(mode) {
  currentCliMode = mode;
  renderMcpManager();
}

function getCliMode() {
  return currentCliMode;
}

// ========== Codex MCP Functions ==========

/**
 * Add MCP server to Codex config.toml
 */
async function addCodexMcpServer(serverName, serverConfig) {
  try {
    const response = await fetch('/api/codex-mcp-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverName: serverName,
        serverConfig: serverConfig
      })
    });

    if (!response.ok) throw new Error('Failed to add Codex MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(t('mcp.codex.serverAdded', { name: serverName }), 'success');
    } else {
      showRefreshToast(result.error || t('mcp.codex.addFailed'), 'error');
    }
    return result;
  } catch (err) {
    console.error('Failed to add Codex MCP server:', err);
    showRefreshToast(t('mcp.codex.addFailed') + ': ' + err.message, 'error');
    return null;
  }
}

/**
 * Remove MCP server from Codex config.toml
 */
async function removeCodexMcpServer(serverName) {
  try {
    const response = await fetch('/api/codex-mcp-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName })
    });

    if (!response.ok) throw new Error('Failed to remove Codex MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(t('mcp.codex.serverRemoved', { name: serverName }), 'success');
    } else {
      showRefreshToast(result.error || t('mcp.codex.removeFailed'), 'error');
    }
    return result;
  } catch (err) {
    console.error('Failed to remove Codex MCP server:', err);
    showRefreshToast(t('mcp.codex.removeFailed') + ': ' + err.message, 'error');
    return null;
  }
}

/**
 * Toggle Codex MCP server enabled state
 */
async function toggleCodexMcpServer(serverName, enabled) {
  try {
    const response = await fetch('/api/codex-mcp-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName, enabled })
    });

    if (!response.ok) throw new Error('Failed to toggle Codex MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(t('mcp.codex.serverToggled', { name: serverName, state: enabled ? 'enabled' : 'disabled' }), 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to toggle Codex MCP server:', err);
    showRefreshToast(t('mcp.codex.toggleFailed') + ': ' + err.message, 'error');
    return null;
  }
}

/**
 * Copy Claude MCP server to Codex
 */
async function copyClaudeServerToCodex(serverName, serverConfig) {
  return await addCodexMcpServer(serverName, serverConfig);
}

/**
 * Copy Codex MCP server to Claude (global)
 */
async function copyCodexServerToClaude(serverName, serverConfig) {
  // Convert Codex format to Claude format
  const claudeConfig = {
    command: serverConfig.command,
    args: serverConfig.args || [],
  };

  if (serverConfig.env) {
    claudeConfig.env = serverConfig.env;
  }

  // If it's an HTTP server
  if (serverConfig.url) {
    claudeConfig.url = serverConfig.url;
  }

  return await addGlobalMcpServer(serverName, claudeConfig);
}

async function toggleMcpServer(serverName, enable) {
  try {
    const response = await fetch('/api/mcp-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectPath,
        serverName: serverName,
        enable: enable
      })
    });

    if (!response.ok) throw new Error('Failed to toggle MCP server');

    const result = await response.json();
    if (result.success) {
      // Reload config and re-render
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(`MCP server "${serverName}" ${enable ? 'enabled' : 'disabled'}`, 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to toggle MCP server:', err);
    showRefreshToast(`Failed to toggle MCP server: ${err.message}`, 'error');
    return null;
  }
}

async function copyMcpServerToProject(serverName, serverConfig, configType = null) {
  try {
    // If configType not specified, use the preferred config type (toggle setting)
    if (!configType) {
      configType = preferredProjectConfigType;
    }

    const response = await fetch('/api/mcp-copy-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectPath,
        serverName: serverName,
        serverConfig: serverConfig,
        configType: configType  // 'claude' for .claude.json, 'mcp' for .mcp.json
      })
    });

    if (!response.ok) throw new Error('Failed to copy MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      const location = configType === 'mcp' ? '.mcp.json' : '.claude.json';
      showRefreshToast(`MCP server "${serverName}" added to project (${location})`, 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to copy MCP server:', err);
    showRefreshToast(`Failed to add MCP server: ${err.message}`, 'error');
    return null;
  }
}

// Show dialog to let user choose config type
function showConfigTypeDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    dialog.innerHTML = `
      <div class="bg-card border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold mb-4">${t('mcp.chooseInstallLocation')}</h3>
        <div class="space-y-3 mb-6">
          <button class="config-type-option w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-accent hover:border-primary transition-all" data-type="claude">
            <div class="font-medium">${t('mcp.installToClaudeJson')}</div>
            <div class="text-sm text-muted-foreground mt-1">${t('mcp.claudeJsonDesc')}</div>
          </button>
          <button class="config-type-option w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-accent hover:border-primary transition-all" data-type="mcp">
            <div class="font-medium">${t('mcp.installToMcpJson')}</div>
            <div class="text-sm text-muted-foreground mt-1">${t('mcp.mcpJsonDesc')}</div>
          </button>
        </div>
        <button class="cancel-btn w-full px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors">${t('common.cancel')}</button>
      </div>
    `;
    document.body.appendChild(dialog);

    const options = dialog.querySelectorAll('.config-type-option');
    options.forEach(btn => {
      btn.addEventListener('click', () => {
        resolve(btn.dataset.type);
        document.body.removeChild(dialog);
      });
    });

    const cancelBtn = dialog.querySelector('.cancel-btn');
    cancelBtn.addEventListener('click', () => {
      resolve(null);
      document.body.removeChild(dialog);
    });

    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        resolve(null);
        document.body.removeChild(dialog);
      }
    });
  });
}

async function removeMcpServerFromProject(serverName) {
  try {
    const response = await fetch('/api/mcp-remove-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectPath,
        serverName: serverName
      })
    });

    if (!response.ok) throw new Error('Failed to remove MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(`MCP server "${serverName}" removed from project`, 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to remove MCP server:', err);
    showRefreshToast(`Failed to remove MCP server: ${err.message}`, 'error');
    return null;
  }
}

async function addGlobalMcpServer(serverName, serverConfig) {
  try {
    const response = await fetch('/api/mcp-add-global-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverName: serverName,
        serverConfig: serverConfig
      })
    });

    if (!response.ok) throw new Error('Failed to add global MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(`Global MCP server "${serverName}" added`, 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to add global MCP server:', err);
    showRefreshToast(`Failed to add global MCP server: ${err.message}`, 'error');
    return null;
  }
}

async function removeGlobalMcpServer(serverName) {
  try {
    const response = await fetch('/api/mcp-remove-global-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverName: serverName
      })
    });

    if (!response.ok) throw new Error('Failed to remove global MCP server');

    const result = await response.json();
    if (result.success) {
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(`Global MCP server "${serverName}" removed`, 'success');
    }
    return result;
  } catch (err) {
    console.error('Failed to remove global MCP server:', err);
    showRefreshToast(`Failed to remove global MCP server: ${err.message}`, 'error');
    return null;
  }
}

// ========== Badge Update ==========
function updateMcpBadge() {
  const badge = document.getElementById('badgeMcpServers');
  if (badge) {
    // Try both path formats to find the matching key
    const forwardSlashPath = projectPath.replace(/\\/g, '/');
    const backSlashPath = projectPath.replace(/\//g, '\\');

    // Find matching project data using either path format
    const projectData = mcpAllProjects[forwardSlashPath] || mcpAllProjects[backSlashPath] || mcpAllProjects[projectPath];
    const servers = projectData?.mcpServers || {};
    const disabledServers = projectData?.disabledMcpServers || [];

    const totalServers = Object.keys(servers).length;
    const enabledServers = totalServers - disabledServers.length;

    console.log('[MCP Badge]', { projectPath, forwardSlashPath, backSlashPath, totalServers, enabledServers });
    badge.textContent = `${enabledServers}/${totalServers}`;
  }
}

// ========== Helpers ==========

/**
 * Generate a unique key for MCP server config comparison
 * Used to distinguish servers with same name but different configurations
 */
function getMcpConfigHash(config) {
  const cmd = config.command || '';
  const args = (config.args || []).join('|');
  const envKeys = Object.keys(config.env || {}).sort().join(',');
  return `${cmd}::${args}::${envKeys}`;
}

/**
 * Get all available MCP servers from all sources
 * Supports servers with same name but different configurations from different projects
 */
function getAllAvailableMcpServers() {
  const allServers = {};
  const configHashes = {}; // Track unique configs per server name

  // Collect global servers first
  for (const [name, serverConfig] of Object.entries(mcpGlobalServers)) {
    const hash = getMcpConfigHash(serverConfig);
    allServers[name] = {
      config: serverConfig,
      usedIn: [],
      isGlobal: true,
      configHash: hash
    };
    configHashes[name] = { [hash]: name };
  }

  // Collect servers from all projects - handle same name with different configs
  for (const [path, config] of Object.entries(mcpAllProjects)) {
    const servers = config.mcpServers || {};
    for (const [name, serverConfig] of Object.entries(servers)) {
      const hash = getMcpConfigHash(serverConfig);

      if (!configHashes[name]) {
        // First occurrence of this server name
        configHashes[name] = {};
      }

      if (!configHashes[name][hash]) {
        // New unique configuration for this server name
        // Use suffixed key if name already exists with different config
        let serverKey = name;
        if (allServers[name] && allServers[name].configHash !== hash) {
          // Generate unique key: name@project-folder
          const projectFolder = path.split('\\').pop() || path.split('/').pop() || 'unknown';
          serverKey = `${name}@${projectFolder}`;
          // Avoid collisions
          let suffix = 1;
          while (allServers[serverKey]) {
            serverKey = `${name}@${projectFolder}-${suffix++}`;
          }
        }

        configHashes[name][hash] = serverKey;

        if (!allServers[serverKey]) {
          allServers[serverKey] = {
            config: serverConfig,
            usedIn: [],
            isGlobal: false,
            configHash: hash,
            originalName: name, // Store original name for installation
            sourceProject: path  // Store source project for reference
          };
        }
      }

      // Track which projects use this config
      const serverKey = configHashes[name][hash];
      if (allServers[serverKey]) {
        allServers[serverKey].usedIn.push(path);
      }
    }
  }

  return allServers;
}

function isServerEnabledInCurrentProject(serverName) {
  const currentPath = projectPath.replace(/\//g, '\\');
  const projectData = mcpAllProjects[currentPath];
  if (!projectData) return false;

  const disabledServers = projectData.disabledMcpServers || [];
  return !disabledServers.includes(serverName);
}

function isServerInCurrentProject(serverName) {
  const currentPath = projectPath.replace(/\//g, '\\');
  const projectData = mcpAllProjects[currentPath];
  if (!projectData) return false;

  const servers = projectData.mcpServers || {};
  return serverName in servers;
}

// Generate install command for MCP server
function generateMcpInstallCommand(serverName, serverConfig, scope = 'project') {
  const command = serverConfig.command || '';
  const args = serverConfig.args || [];

  // Check if it's an npx-based package
  if (command === 'npx' && args.length > 0) {
    const packageName = args[0];
    // Check if it's a scoped package or standard package
    if (packageName.startsWith('@') || packageName.includes('/')) {
      const scopeFlag = scope === 'global' ? ' --global' : '';
      return `claude mcp add ${packageName}${scopeFlag}`;
    }
  }

  // For custom servers, return JSON configuration
  const scopeFlag = scope === 'global' ? ' --global' : '';
  return `claude mcp add ${serverName}${scopeFlag}`;
}

// Copy install command to clipboard
async function copyMcpInstallCommand(serverName, serverConfig, scope = 'project') {
  try {
    const command = generateMcpInstallCommand(serverName, serverConfig, scope);
    await navigator.clipboard.writeText(command);
    showRefreshToast(t('mcp.installCmdCopied'), 'success');
  } catch (error) {
    console.error('Failed to copy install command:', error);
    showRefreshToast(t('mcp.installCmdFailed'), 'error');
  }
}

// ========== MCP Create Modal ==========
function openMcpCreateModal(scope = 'project') {
  const modal = document.getElementById('mcpCreateModal');
  if (modal) {
    modal.classList.remove('hidden');
    // Reset to form mode
    mcpCreateMode = 'form';
    switchMcpCreateTab('form');
    // Clear form
    document.getElementById('mcpServerName').value = '';
    document.getElementById('mcpServerCommand').value = '';
    document.getElementById('mcpServerArgs').value = '';
    document.getElementById('mcpServerEnv').value = '';
    // Clear JSON input
    document.getElementById('mcpServerJson').value = '';
    document.getElementById('mcpJsonPreview').classList.add('hidden');
    // Set scope (global or project)
    const scopeSelect = document.getElementById('mcpServerScope');
    if (scopeSelect) {
      scopeSelect.value = scope;
    }
    // Focus on name input
    document.getElementById('mcpServerName').focus();
    // Setup JSON input listener
    setupMcpJsonListener();
  }
}

function closeMcpCreateModal() {
  const modal = document.getElementById('mcpCreateModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function switchMcpCreateTab(tab) {
  mcpCreateMode = tab;
  const formMode = document.getElementById('mcpFormMode');
  const jsonMode = document.getElementById('mcpJsonMode');
  const tabForm = document.getElementById('mcpTabForm');
  const tabJson = document.getElementById('mcpTabJson');

  if (tab === 'form') {
    formMode.classList.remove('hidden');
    jsonMode.classList.add('hidden');
    tabForm.classList.add('active');
    tabJson.classList.remove('active');
  } else {
    formMode.classList.add('hidden');
    jsonMode.classList.remove('hidden');
    tabForm.classList.remove('active');
    tabJson.classList.add('active');
  }
}

function setupMcpJsonListener() {
  const jsonInput = document.getElementById('mcpServerJson');
  if (jsonInput && !jsonInput.hasAttribute('data-listener-attached')) {
    jsonInput.setAttribute('data-listener-attached', 'true');
    jsonInput.addEventListener('input', () => {
      updateMcpJsonPreview();
    });
  }
}

function parseMcpJsonConfig(jsonText) {
  if (!jsonText.trim()) {
    return { servers: {}, error: null };
  }

  try {
    const parsed = JSON.parse(jsonText);
    let servers = {};

    // Support multiple formats:
    // 1. {"servers": {...}} format (claude desktop style)
    // 2. {"mcpServers": {...}} format (claude.json style)
    // 3. {"serverName": {command, args}} format (direct server config)
    // 4. {command, args} format (single server without name)

    if (parsed.servers && typeof parsed.servers === 'object') {
      servers = parsed.servers;
    } else if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      servers = parsed.mcpServers;
    } else if (parsed.command && typeof parsed.command === 'string') {
      // Single server without name - will prompt for name
      servers = { '__unnamed__': parsed };
    } else {
      // Check if all values are server configs (have 'command' property)
      const isDirectServerConfig = Object.values(parsed).every(
        v => v && typeof v === 'object' && v.command
      );
      if (isDirectServerConfig && Object.keys(parsed).length > 0) {
        servers = parsed;
      } else {
        return { servers: {}, error: 'Invalid MCP server JSON format' };
      }
    }

    // Validate each server config
    for (const [name, config] of Object.entries(servers)) {
      if (!config.command || typeof config.command !== 'string') {
        return { servers: {}, error: `Server "${name}" missing required "command" field` };
      }
      if (config.args && !Array.isArray(config.args)) {
        return { servers: {}, error: `Server "${name}" has invalid "args" (must be array)` };
      }
      if (config.env && typeof config.env !== 'object') {
        return { servers: {}, error: `Server "${name}" has invalid "env" (must be object)` };
      }
    }

    return { servers, error: null };
  } catch (e) {
    return { servers: {}, error: 'Invalid JSON: ' + e.message };
  }
}

function updateMcpJsonPreview() {
  const jsonInput = document.getElementById('mcpServerJson');
  const previewContainer = document.getElementById('mcpJsonPreview');
  const previewContent = document.getElementById('mcpJsonPreviewContent');

  const jsonText = jsonInput.value;
  const { servers, error } = parseMcpJsonConfig(jsonText);

  if (!jsonText.trim()) {
    previewContainer.classList.add('hidden');
    return;
  }

  previewContainer.classList.remove('hidden');

  if (error) {
    previewContent.innerHTML = `<div class="text-destructive">${escapeHtml(error)}</div>`;
    return;
  }

  const serverCount = Object.keys(servers).length;
  if (serverCount === 0) {
    previewContent.innerHTML = `<div class="text-muted-foreground">No servers found</div>`;
    return;
  }

  const previewHtml = Object.entries(servers).map(([name, config]) => {
    const displayName = name === '__unnamed__' ? '(will prompt for name)' : name;
    const argsPreview = config.args ? config.args.slice(0, 2).join(' ') + (config.args.length > 2 ? '...' : '') : '';
    return `
      <div class="flex items-center gap-2 p-2 bg-background rounded">
        <span class="text-success">+</span>
        <span class="font-medium">${escapeHtml(displayName)}</span>
        <span class="text-muted-foreground text-xs">${escapeHtml(config.command)} ${escapeHtml(argsPreview)}</span>
      </div>
    `;
  }).join('');

  previewContent.innerHTML = previewHtml;
}

async function submitMcpCreate() {
  if (mcpCreateMode === 'json') {
    await submitMcpCreateFromJson();
  } else {
    await submitMcpCreateFromForm();
  }
}

async function submitMcpCreateFromForm() {
  const name = document.getElementById('mcpServerName').value.trim();
  const command = document.getElementById('mcpServerCommand').value.trim();
  const argsText = document.getElementById('mcpServerArgs').value.trim();
  const envText = document.getElementById('mcpServerEnv').value.trim();
  const scopeSelect = document.getElementById('mcpServerScope');
  const scope = scopeSelect ? scopeSelect.value : 'project';

  // Validate required fields
  if (!name) {
    showRefreshToast('Server name is required', 'error');
    document.getElementById('mcpServerName').focus();
    return;
  }

  if (!command) {
    showRefreshToast('Command is required', 'error');
    document.getElementById('mcpServerCommand').focus();
    return;
  }

  // Parse args (one per line)
  const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(a => a) : [];

  // Parse env vars (KEY=VALUE per line)
  const env = {};
  if (envText) {
    envText.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes('=')) {
        const eqIndex = trimmed.indexOf('=');
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        if (key) {
          env[key] = value;
        }
      }
    });
  }

  // Build server config
  const serverConfig = {
    command: command,
    args: args
  };

  // Only add env if there are values
  if (Object.keys(env).length > 0) {
    serverConfig.env = env;
  }

  await createMcpServerWithConfig(name, serverConfig, scope);
}

async function submitMcpCreateFromJson() {
  const jsonText = document.getElementById('mcpServerJson').value.trim();

  if (!jsonText) {
    showRefreshToast('Please enter JSON configuration', 'error');
    document.getElementById('mcpServerJson').focus();
    return;
  }

  const { servers, error } = parseMcpJsonConfig(jsonText);

  if (error) {
    showRefreshToast(error, 'error');
    return;
  }

  if (Object.keys(servers).length === 0) {
    showRefreshToast('No valid servers found in JSON', 'error');
    return;
  }

  // Handle unnamed server case
  if (servers['__unnamed__']) {
    const serverName = prompt('Enter a name for this MCP server:');
    if (!serverName || !serverName.trim()) {
      showRefreshToast('Server name is required', 'error');
      return;
    }
    servers[serverName.trim()] = servers['__unnamed__'];
    delete servers['__unnamed__'];
  }

  // Add all servers
  let successCount = 0;
  let failCount = 0;
  const serverNames = Object.keys(servers);

  for (const [name, config] of Object.entries(servers)) {
    try {
      const response = await fetch('/api/mcp-copy-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          serverName: name,
          serverConfig: config
        })
      });

      if (!response.ok) throw new Error('Failed to create MCP server');

      const result = await response.json();
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(`Failed to create MCP server "${name}":`, err);
      failCount++;
    }
  }

  closeMcpCreateModal();
  await loadMcpConfig();
  renderMcpManager();

  if (failCount === 0) {
    showRefreshToast(`${successCount} MCP server${successCount > 1 ? 's' : ''} created successfully`, 'success');
  } else if (successCount > 0) {
    showRefreshToast(`${successCount} created, ${failCount} failed`, 'warning');
  } else {
    showRefreshToast('Failed to create MCP servers', 'error');
  }
}

async function createMcpServerWithConfig(name, serverConfig, scope = 'project') {
  // Submit to API
  try {
    let response;
    let scopeLabel;

    if (scope === 'codex') {
      // Create in Codex config.toml
      response = await fetch('/api/codex-mcp-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: name,
          serverConfig: serverConfig
        })
      });
      scopeLabel = 'Codex';
    } else if (scope === 'global') {
      response = await fetch('/api/mcp-add-global-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: name,
          serverConfig: serverConfig
        })
      });
      scopeLabel = 'global';
    } else {
      response = await fetch('/api/mcp-copy-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          serverName: name,
          serverConfig: serverConfig
        })
      });
      scopeLabel = 'project';
    }

    if (!response.ok) throw new Error('Failed to create MCP server');

    const result = await response.json();
    if (result.success) {
      closeMcpCreateModal();
      await loadMcpConfig();
      renderMcpManager();
      showRefreshToast(`MCP server "${name}" created in ${scopeLabel} scope`, 'success');
    } else {
      showRefreshToast(result.error || 'Failed to create MCP server', 'error');
    }
  } catch (err) {
    console.error('Failed to create MCP server:', err);
    showRefreshToast(`Failed to create MCP server: ${err.message}`, 'error');
  }
}

// ========== CCW Tools MCP Installation ==========

// Get selected tools from checkboxes
function getSelectedCcwTools() {
  const checkboxes = document.querySelectorAll('.ccw-tool-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.tool);
}

// Select tools by category
function selectCcwTools(type) {
  const checkboxes = document.querySelectorAll('.ccw-tool-checkbox');
  const coreTools = ['write_file', 'edit_file', 'codex_lens', 'smart_search'];

  checkboxes.forEach(cb => {
    if (type === 'all') {
      cb.checked = true;
    } else if (type === 'none') {
      cb.checked = false;
    } else if (type === 'core') {
      cb.checked = coreTools.includes(cb.dataset.tool);
    }
  });
}

// Get CCW path settings from input fields
function getCcwPathConfig() {
  const projectRootInput = document.querySelector('.ccw-project-root-input');
  const allowedDirsInput = document.querySelector('.ccw-allowed-dirs-input');
  return {
    projectRoot: projectRootInput?.value || '',
    allowedDirs: allowedDirsInput?.value || ''
  };
}

// Set CCW_PROJECT_ROOT to current project path
function setCcwProjectRootToCurrent() {
  const input = document.querySelector('.ccw-project-root-input');
  if (input && projectPath) {
    input.value = projectPath;
  }
}

// Build CCW Tools config with selected tools
// Uses globally installed ccw-mcp command (from claude-code-workflow package)
function buildCcwToolsConfig(selectedTools, pathConfig = {}) {
  const { projectRoot, allowedDirs } = pathConfig;
  // Use npx to execute ccw-mcp from the package
  // This works without requiring global installation
  const config = {
    command: "npx",
    args: ["-y", "ccw-mcp"]
  };

  // Add env if not all tools or not default 4 core tools
  const coreTools = ['write_file', 'edit_file', 'codex_lens', 'smart_search'];
  const isDefault = selectedTools.length === 4 &&
    coreTools.every(t => selectedTools.includes(t)) &&
    selectedTools.every(t => coreTools.includes(t));

  // Initialize env if needed
  if (selectedTools.length === 15) {
    config.env = { CCW_ENABLED_TOOLS: 'all' };
  } else if (!isDefault && selectedTools.length > 0) {
    config.env = { CCW_ENABLED_TOOLS: selectedTools.join(',') };
  }

  // Add path settings if provided
  if (!config.env) {
    config.env = {};
  }

  if (projectRoot && projectRoot.trim()) {
    config.env.CCW_PROJECT_ROOT = projectRoot.trim();
  }
  if (allowedDirs && allowedDirs.trim()) {
    config.env.CCW_ALLOWED_DIRS = allowedDirs.trim();
  }

  // Remove env object if empty
  if (config.env && Object.keys(config.env).length === 0) {
    delete config.env;
  }

  return config;
}

async function installCcwToolsMcp(scope = 'workspace') {
  const selectedTools = getSelectedCcwTools();

  if (selectedTools.length === 0) {
    showRefreshToast('Please select at least one tool', 'warning');
    return;
  }

  const pathConfig = getCcwPathConfig();
  const ccwToolsConfig = buildCcwToolsConfig(selectedTools, pathConfig);

  try {
    const scopeLabel = scope === 'global' ? 'globally' : 'to workspace';
    showRefreshToast(`Installing CCW Tools MCP ${scopeLabel}...`, 'info');

    if (scope === 'global') {
      // Install to global (~/.claude.json mcpServers)
      const response = await fetch('/api/mcp-add-global-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: 'ccw-tools',
          serverConfig: ccwToolsConfig
        })
      });

      if (!response.ok) throw new Error('Failed to install CCW Tools MCP globally');

      const result = await response.json();
      if (result.success) {
        await loadMcpConfig();
        renderMcpManager();
        showRefreshToast(`CCW Tools installed globally (${selectedTools.length} tools)`, 'success');
      } else {
        showRefreshToast(result.error || 'Failed to install CCW Tools MCP globally', 'error');
      }
    } else {
      // Install to workspace (use preferredProjectConfigType)
      const configType = preferredProjectConfigType;
      const response = await fetch('/api/mcp-copy-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          serverName: 'ccw-tools',
          serverConfig: ccwToolsConfig,
          configType: configType
        })
      });

      if (!response.ok) throw new Error('Failed to install CCW Tools MCP to workspace');

      const result = await response.json();
      if (result.success) {
        await loadMcpConfig();
        renderMcpManager();
        const location = configType === 'mcp' ? '.mcp.json' : 'claude.json';
        showRefreshToast(`CCW Tools installed to ${location} (${selectedTools.length} tools)`, 'success');
      } else {
        showRefreshToast(result.error || 'Failed to install CCW Tools MCP to workspace', 'error');
      }
    }
  } catch (err) {
    console.error('Failed to install CCW Tools MCP:', err);
    showRefreshToast(`Failed to install CCW Tools MCP: ${err.message}`, 'error');
  }
}

async function updateCcwToolsMcp(scope = 'workspace') {
  const selectedTools = getSelectedCcwTools();

  if (selectedTools.length === 0) {
    showRefreshToast('Please select at least one tool', 'warning');
    return;
  }

  const pathConfig = getCcwPathConfig();
  const ccwToolsConfig = buildCcwToolsConfig(selectedTools, pathConfig);

  try {
    const scopeLabel = scope === 'global' ? 'globally' : 'in workspace';
    showRefreshToast(`Updating CCW Tools MCP ${scopeLabel}...`, 'info');

    if (scope === 'global') {
      // Update global (~/.claude.json mcpServers)
      const response = await fetch('/api/mcp-add-global-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: 'ccw-tools',
          serverConfig: ccwToolsConfig
        })
      });

      if (!response.ok) throw new Error('Failed to update CCW Tools MCP globally');

      const result = await response.json();
      if (result.success) {
        await loadMcpConfig();
        renderMcpManager();
        showRefreshToast(`CCW Tools updated globally (${selectedTools.length} tools)`, 'success');
      } else {
        showRefreshToast(result.error || 'Failed to update CCW Tools MCP globally', 'error');
      }
    } else {
      // Update workspace (use preferredProjectConfigType)
      const configType = preferredProjectConfigType;
      const response = await fetch('/api/mcp-copy-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          serverName: 'ccw-tools',
          serverConfig: ccwToolsConfig,
          configType: configType
        })
      });

      if (!response.ok) throw new Error('Failed to update CCW Tools MCP in workspace');

      const result = await response.json();
      if (result.success) {
        await loadMcpConfig();
        renderMcpManager();
        const location = configType === 'mcp' ? '.mcp.json' : 'claude.json';
        showRefreshToast(`CCW Tools updated in ${location} (${selectedTools.length} tools)`, 'success');
      } else {
        showRefreshToast(result.error || 'Failed to update CCW Tools MCP in workspace', 'error');
      }
    }
  } catch (err) {
    console.error('Failed to update CCW Tools MCP:', err);
    showRefreshToast(`Failed to update CCW Tools MCP: ${err.message}`, 'error');
  }
}

// ========================================
// CCW Tools MCP for Codex
// ========================================

// Get selected tools from Codex checkboxes
function getSelectedCcwToolsCodex() {
  const checkboxes = document.querySelectorAll('.ccw-tool-checkbox-codex:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.tool);
}

// Select tools by category for Codex
function selectCcwToolsCodex(type) {
  const checkboxes = document.querySelectorAll('.ccw-tool-checkbox-codex');
  const coreTools = ['write_file', 'edit_file', 'codex_lens', 'smart_search'];

  checkboxes.forEach(cb => {
    if (type === 'all') {
      cb.checked = true;
    } else if (type === 'none') {
      cb.checked = false;
    } else if (type === 'core') {
      cb.checked = coreTools.includes(cb.dataset.tool);
    }
  });
}

// Install/Update CCW Tools MCP to Codex
async function installCcwToolsMcpToCodex() {
  const selectedTools = getSelectedCcwToolsCodex();

  if (selectedTools.length === 0) {
    showRefreshToast('Please select at least one tool', 'warning');
    return;
  }

  const pathConfig = getCcwPathConfig();
  const ccwToolsConfig = buildCcwToolsConfig(selectedTools, pathConfig);

  try {
    const isUpdate = codexMcpServers && codexMcpServers['ccw-tools'];
    const actionLabel = isUpdate ? 'Updating' : 'Installing';
    showRefreshToast(`${actionLabel} CCW Tools MCP to Codex...`, 'info');

    await addCodexMcpServer('ccw-tools', ccwToolsConfig);

    // Reload MCP configuration and refresh the view
    await loadMcpConfig();
    renderMcpManager();

    const resultLabel = isUpdate ? 'updated in' : 'installed to';
    showRefreshToast(`CCW Tools ${resultLabel} Codex (${selectedTools.length} tools)`, 'success');
  } catch (err) {
    console.error('Failed to install CCW Tools MCP to Codex:', err);
    showRefreshToast(`Failed to install CCW Tools MCP to Codex: ${err.message}`, 'error');
  }
}

// ========== Project Config Type Toggle ==========
function toggleProjectConfigType() {
  preferredProjectConfigType = preferredProjectConfigType === 'mcp' ? 'claude' : 'mcp';
  console.log('[MCP] Preferred project config type changed to:', preferredProjectConfigType);
  // Re-render to update toggle display
  renderMcpManager();
}

function getPreferredProjectConfigType() {
  return preferredProjectConfigType;
}

function setPreferredProjectConfigType(type) {
  if (type === 'mcp' || type === 'claude') {
    preferredProjectConfigType = type;
    console.log('[MCP] Preferred project config type set to:', preferredProjectConfigType);
  }
}

// ========== Global Exports for onclick handlers ==========
// Expose functions to global scope to support inline onclick handlers
window.setCliMode = setCliMode;
window.getCliMode = getCliMode;
window.selectCcwTools = selectCcwTools;
window.selectCcwToolsCodex = selectCcwToolsCodex;
window.openMcpCreateModal = openMcpCreateModal;
window.toggleProjectConfigType = toggleProjectConfigType;
window.getPreferredProjectConfigType = getPreferredProjectConfigType;
window.setPreferredProjectConfigType = setPreferredProjectConfigType;
window.setCcwProjectRootToCurrent = setCcwProjectRootToCurrent;
