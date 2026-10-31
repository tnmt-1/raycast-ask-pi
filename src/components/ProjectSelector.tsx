import { Form } from "@raycast/api";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  value?: string;
  onChange: (path: string) => void;
  error?: string;
}

export function ProjectSelector({ projects, value, onChange, error }: Props) {
  return (
    <Form.Dropdown
      id="project"
      title="Project"
      value={value}
      onChange={onChange}
      error={error}
      info="The directory the agent works in. Add more with ⌘⇧N."
      storeValue={false}
    >
      {projects.map((p) => (
        <Form.Dropdown.Item key={p.path} value={p.path} title={p.name} keywords={[p.path]} />
      ))}
    </Form.Dropdown>
  );
}
