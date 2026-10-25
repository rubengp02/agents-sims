import { type ExecuteOptions, ExecutionBlocked } from './types.js';

/** Config is delivered on stdin, never in the process arguments or receipt. */
export function appServerThreadConfig(options: ExecuteOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {
    model_provider: 'openai',
    forced_login_method: 'chatgpt',
    model_providers: {},
    'features.multi_agent': false,
    'features.image_generation': true,
    'features.apps': true,
    'features.plugins': false,
    'features.hooks': false,
    apps: {
      _default: {
        enabled: true,
        default_tools_approval_mode: 'prompt',
        approvals_reviewer: 'user',
      },
    },
    web_search: 'live',
    approval_policy: 'on-request',
    default_permissions: options.allowWrites ? ':workspace' : ':read-only',
    'shell_environment_policy.inherit': 'core',
    'shell_environment_policy.ignore_default_excludes': false,
    'sandbox_workspace_write.network_access': false,
    mcp_servers: {},
  };
  if (process.platform === 'win32') config['windows.sandbox'] = 'elevated';
  if (process.platform === 'win32') config['features.prefer_mxc'] = true;
  if (options.toolServer) {
    const endpoint = new URL(options.toolServer.url);
    if (
      endpoint.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username ||
      endpoint.password
    )
      throw new ExecutionBlocked(
        'invalid_tool_server',
        'El servidor de herramientas debe pertenecer a la oficina local.',
      );
    config.mcp_servers = {
      office: {
        url: endpoint.href,
        http_headers: { Authorization: `Bearer ${options.toolServer.token}` },
        enabled: true,
        required: true,
        tool_timeout_sec: 600,
        // This backend owns the endpoint and enforces each external approval itself.
        // Native prompt-all remains active for connected apps and other integrations.
        default_tools_approval_mode: 'approve',
      },
    };
  }
  return config;
}
