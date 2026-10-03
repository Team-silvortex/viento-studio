import fs from 'node:fs';
import { createProjectModel } from '../../engine/project.mjs';
export { LEGACY_PATHS, validateParserDefinition, validateProjectTypes } from '../../engine/project.mjs';

// Only the Node adapter loads the application defaults from disk.
export const WORKSPACE_LAYOUT = JSON.parse(fs.readFileSync(new URL('./workspace-layout.json', import.meta.url), 'utf8'));
export const PROJECT_TEMPLATE_CATALOG = JSON.parse(fs.readFileSync(new URL('./project-templates.json', import.meta.url), 'utf8'));
// Only implicit historical projects use these types. New projects copy their
// chosen package into workspace.json and templates/, then own that snapshot.
const legacy = [...PROJECT_TEMPLATE_CATALOG.templates, ...(PROJECT_TEMPLATE_CATALOG.compatibilityTemplates || [])]
  .find((item) => item.packageId === PROJECT_TEMPLATE_CATALOG.legacyTemplate);
export const PROJECT_DEFAULTS = { ...WORKSPACE_LAYOUT, documentTypes: legacy.documentTypes, templates: legacy.templates };
export const { workspacePaths, projectDefinition, resolveDocumentDefinition, projectDocumentDefaults } = createProjectModel(PROJECT_DEFAULTS);
