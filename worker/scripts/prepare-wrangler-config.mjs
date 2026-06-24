import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DATABASE_ID_PLACEHOLDER = "__D1_DATABASE_ID__";
const D1_DATABASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function prepareWranglerConfig({
  databaseId,
  templatePath,
  outputPath,
}) {
  const normalizedDatabaseId = databaseId?.trim();

  if (!normalizedDatabaseId) {
    throw new Error(
      "D1_DATABASE_ID is required. Add it as a Cloudflare Workers Builds secret or set it in your local environment.",
    );
  }

  if (!D1_DATABASE_ID_PATTERN.test(normalizedDatabaseId)) {
    throw new Error("D1_DATABASE_ID must be a valid D1 database UUID.");
  }

  const template = await readFile(templatePath, "utf8");
  const placeholderCount = template.split(DATABASE_ID_PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) {
    throw new Error(
      `Expected exactly one ${DATABASE_ID_PLACEHOLDER} placeholder in ${templatePath}.`,
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    template.replace(DATABASE_ID_PLACEHOLDER, normalizedDatabaseId),
    { encoding: "utf8", mode: 0o600 },
  );
}
