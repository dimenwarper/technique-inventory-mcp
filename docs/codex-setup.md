# Connect the inventory to Codex

Register this server in your user-level Codex configuration to make one inventory available across local projects and tasks. Codex launches the server as a child process and communicates over standard input/output (stdio); it does not need a web server, port, or separately running terminal. Each connected client can launch its own server process, all pointing at the same inventory directory.

## Build and choose stable paths

Install dependencies and build the server using the repository's README. Keep the checkout and inventory at stable absolute paths. The examples below use these placeholders:

- `/absolute/path/to/node`: your Node.js executable. Run `command -v node` to find it.
- `/absolute/path/to/technique-inventory-mcp`: this repository's checkout.
- `/absolute/path/to/technique-inventory-mcp/inventory`: the readable, Git-tracked inventory directory.

Use an absolute Node.js path because desktop applications may have a different `PATH` from your terminal. Rebuild after changing TypeScript source; Codex runs the compiled `dist/cli.js` file.

## Register with the CLI

With a working Codex CLI, run:

```sh
codex mcp add technique_inventory -- \
  /absolute/path/to/node \
  /absolute/path/to/technique-inventory-mcp/dist/cli.js \
  serve --data-dir /absolute/path/to/technique-inventory-mcp/inventory
```

Quote any path containing spaces. This command changes your local Codex configuration; it does not publish the server or its inventory.

The installed desktop app may bundle a working CLI even if a separate `codex` installation is broken. On the machine used for initial setup, the following executable and its `mcp add --help` command were verified on 2026-10-09:

```sh
/Applications/ChatGPT.app/Contents/Resources/codex mcp add --help
```

App names and bundle paths can change; verify the path on your own machine. If necessary, substitute that full executable path for `codex` above.

## Alternative: edit the configuration

Add this table to `~/.codex/config.toml`, replacing the placeholder paths. If the table already exists, update it instead of adding a duplicate.

```toml
[mcp_servers.technique_inventory]
command = "/absolute/path/to/node"
args = [
  "/absolute/path/to/technique-inventory-mcp/dist/cli.js",
  "serve",
  "--data-dir",
  "/absolute/path/to/technique-inventory-mcp/inventory",
]
```

The user-level configuration is shared by local Codex clients on the same host. A project-level `.codex/config.toml` limits availability to that trusted project, so use the user-level file for this cross-project inventory. Keep machine-specific paths out of the repository. See the [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Reload and verify

In the desktop app, open **Settings → MCP servers**, locate `technique_inventory`, and select **Restart** after saving configuration changes. Then open a new local task and ask it to list or search the inventory. The official documentation also describes `/mcp` for inspecting connected servers. If the running app has not picked up an external configuration edit, quit and reopen the app, then try a new task.

In a terminal, `codex mcp list` confirms registration. Registration alone does not prove the MCP handshake or a tool call succeeds; verify a real inventory search from a new task. The desktop restart workflow is documented in [OpenAI's MCP setup guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli#configure-in-the-chatgpt-desktop-app).

Useful prompts include:

> Search my technique inventory for exact certificate verification methods that might help with this project.

> Save this reusable technique in my inventory, including its assumptions, limitations, provenance, and what was verified.

## Troubleshooting

- **Executable or module not found:** check the absolute Node.js and `dist/cli.js` paths, install dependencies, and rebuild. Do not rely on a shell alias for Node.js.
- **Server starts but no tools appear:** restart the connection and try a new local task. Check the app's MCP connection error. A stdio server must reserve stdout for protocol messages; diagnostic messages belong on stderr.
- **Different inventories appear in different tasks:** compare each client's `--data-dir`; every client should point to the same absolute directory.
- **Inventory writes fail:** confirm that directory exists and the local account can write to it. Fix the directory's permissions instead of running the server as administrator.
- **After moving the repository:** update both the compiled script path and the inventory directory path, then restart the connection.
- **A CLI wrapper fails before showing help:** use a working CLI installation, the verified app-bundled binary when available, or the configuration-file method above.

To disable the connection temporarily, add `enabled = false` to its TOML table and restart it from the app. Disabling the connection preserves the inventory files.

This registration targets local Codex clients on the configured computer. Publishing the repository to GitHub later lets others install their own copy; it does not turn your local inventory into a remotely accessible service.
