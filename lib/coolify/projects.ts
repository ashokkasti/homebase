import { z } from "zod";
import { coolifyRequest } from "./client";
const projectsSchema = z.array(
  z.object({ uuid: z.string(), name: z.string().nullish() }),
);
const environmentsSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]),
    uuid: z.string(),
    name: z.string(),
  }),
);
export type Location = {
  project: string;
  projectName: string;
  environment: string;
  name: string;
};
export async function getLocations() {
  const locations = new Map<string, Location>();
  const projects = projectsSchema.parse(await coolifyRequest("/projects"));
  for (let i = 0; i < projects.length; i += 5) {
    await Promise.all(
      projects.slice(i, i + 5).map(async (project) => {
        const environments = environmentsSchema.parse(
          await coolifyRequest(
            `/projects/${encodeURIComponent(project.uuid)}/environments`,
          ),
        );
        for (const environment of environments)
          locations.set(String(environment.id), {
            project: project.uuid,
            projectName: project.name ?? "",
            environment: environment.uuid,
            name: environment.name,
          });
      }),
    );
  }
  return locations;
}
