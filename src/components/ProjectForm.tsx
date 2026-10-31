import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { useState } from "react";
import type { Project } from "../types";

const ABOUT_PROJECT =
  "A project is the directory the agent works in. It reads and edits files there, like running `pi` in that directory from a terminal. Choose the repository you want to ask about.";

interface Props {
  onSave: (project: Omit<Project, "source">) => Promise<void> | void;
  /** Shown as the first screen when no project is registered; stays on screen after saving. */
  onboarding?: boolean;
  notice?: string;
}

export function ProjectForm({ onSave, onboarding = false, notice }: Props) {
  const { pop } = useNavigation();
  const [error, setError] = useState<string>();

  return (
    <Form
      navigationTitle={onboarding ? "Ask Pi: Add a Project" : "Add Project"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add Project"
            icon={Icon.Plus}
            onSubmit={async ({ name, path }: { name: string; path: string[] }) => {
              const dir = path[0];
              if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
                setError("Choose a directory");
                return;
              }
              const normalized = dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
              await onSave({ name: name.trim() || basename(normalized), path: normalized });
              if (!onboarding) pop();
            }}
          />
        </ActionPanel>
      }
    >
      {onboarding ? <Form.Description title="No projects yet" text={ABOUT_PROJECT} /> : null}
      {notice ? <Form.Description title="Projects file" text={notice} /> : null}
      <Form.FilePicker
        id="path"
        title="Directory"
        info={ABOUT_PROJECT}
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        error={error}
        onChange={() => setError(undefined)}
      />
      <Form.TextField id="name" title="Name" placeholder="Defaults to the directory name" />
    </Form>
  );
}
