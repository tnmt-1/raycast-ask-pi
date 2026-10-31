import { Action, ActionPanel, Alert, confirmAlert, Icon, Keyboard, List } from "@raycast/api";
import { existsSync } from "node:fs";
import { ProjectForm } from "./components/ProjectForm";
import { useProjects } from "./hooks";

export default function Command() {
  const { projects, isLoading, filePath, fileError, addLocal, removeLocal, reload } = useProjects();

  const addAction = (
    <Action.Push
      title="Add Project"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<ProjectForm onSave={addLocal} />}
    />
  );
  const fileActions = (
    <>
      {existsSync(filePath) ? <Action.Open title="Open Projects File" icon={Icon.Document} target={filePath} /> : null}
      <Action
        title="Reload Projects File"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={reload}
      />
    </>
  );

  return (
    <List isLoading={isLoading} navigationTitle="Agent Projects">
      {fileError ? (
        <List.Item
          title="Projects file could not be read"
          subtitle={fileError.message}
          icon={Icon.Warning}
          actions={<ActionPanel>{fileActions}</ActionPanel>}
        />
      ) : null}
      <List.EmptyView
        title="No projects yet"
        description={`Press ⌘N to add one, or list projects in ${filePath}`}
        actions={<ActionPanel>{addAction}</ActionPanel>}
      />
      {projects.map((p) => (
        <List.Item
          key={p.path}
          title={p.name}
          subtitle={p.path}
          icon={Icon.Folder}
          accessories={[{ tag: p.source === "file" ? "projects.json" : "Raycast" }]}
          actions={
            <ActionPanel>
              {addAction}
              <Action.ShowInFinder path={p.path} />
              <Action.CopyToClipboard title="Copy Path" content={p.path} />
              {p.source === "local" ? (
                <Action
                  title="Remove Project"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={async () => {
                    const ok = await confirmAlert({
                      title: `Remove “${p.name}”?`,
                      message: "Only the entry in this extension is removed. No files are deleted.",
                      primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
                    });
                    if (ok) await removeLocal(p.path);
                  }}
                />
              ) : null}
              {fileActions}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
