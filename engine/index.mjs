// Portable entry point. No filesystem, server, native bridge or user-data reads.
export { parseSourceContent } from './parse.mjs';
export { buildDocumentLayout, LAYOUT_VERSION } from './layout.mjs';
export { createDocumentFieldDraft } from './fields.mjs';
export { serializeFieldDraft, fieldValueValid } from './field-changes.mjs';
export { createBlockDraft, serializeBlockDraft, serializeSourceDraft } from './source-draft.mjs';
export { prepareMediaDraft, insertStructuredMedia } from './media-insertion.mjs';
export { createProjectModel, validateProjectTypes, validateParserDefinition, LEGACY_PATHS } from './project.mjs';
export { createDocumentStore } from './document-store.mjs';
export { normalizeSourcePath, sourceExtension, sourceFileName } from './source-path.mjs';
export { createWorldProjection, canonicalJson } from './world-projection.mjs';
export { queryWorldProjection, worldCommandDescriptors, validateWorldQuery } from './world-query.mjs';
export { preparePropertySet, validateWorldCommand, worldMutationDescriptors, canSetObjectProperty } from './world-commands.mjs';
export { prepareChangeSet } from './world-changeset.mjs';
export { prepareObjectCreate } from './world-object-create.mjs';
export { prepareSceneCreate } from './world-scene-create.mjs';
export { prepareSceneUpdate, updateSceneContent, appendSceneDependencies } from './world-scene-update.mjs';
export { prepareProjectionCreate } from './world-object-projection.mjs';
export { prepareProjectionUpdate, updateObjectProjectionContent, appendProjectionImageBindings } from './world-projection-update.mjs';
export { getProjectionTemplates, lockProjectionTemplate, deriveProjectionTemplate, validateProjectionTemplate,
  validateProjectionConfiguration, inspectObjectProjection, validateObjectProjection, validateProjectionDependencies,
  projectionRegistration, renderProjectionRuntime, OBJECT_PROJECTION_FORMAT } from './object-projection.mjs';
export { prepareRelationAdd } from './world-relations.mjs';
export { prepareResourceBind } from './world-resources.mjs';
export { validateSceneGroups, buildSceneOutline, SCENE_GROUP_LIMIT, SCENE_GROUP_DEPTH_LIMIT } from './scene-groups.mjs';
export { createSceneStructure, sceneStructureActors } from './scene-structure.mjs';
export { sceneActorIdentity } from './scene-identity.mjs';
export { resolveScene2DModel } from './scene-model.mjs';
export { overlaySceneDraftPreview, validateSceneDraftRequest } from './scene-draft-preview.mjs';
export { MAX_SCENE_DRAFT_BYTES } from './scene-preview-contract.mjs';
export { createSceneSourceLayoutDraft, patchSceneSourcePositions, prepareSceneSourceLayoutApply } from './scene-source-layout.mjs';
export { createScene2DPlan, scene2DModelToPlan, checkBuildCapabilities, SCENE2D_CAPABILITIES } from './build-plan.mjs';
export * from './media-format.mjs';
export * from './document-model.mjs';
export * from './document-values.mjs';
export * from './document-contract.mjs';
export * from './resource-package.mjs';

export { STUDIO_MODULES, validateStudioProfile, validateStudioModuleDescriptor, createStudioModuleRegistry } from './studio-modules.mjs';

export { createSceneCompositionPlacementsDraft, prepareSceneCompositionPlacementsApply } from './scene-composition-placements.mjs';

export { createSceneCompositionGroupsDraft, prepareSceneCompositionGroupsApply } from './scene-composition-groups.mjs';
export { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from './scene-composition-definitions.mjs';
export { parseScene3DSource, createScene3DPlan, MAX_SCENE3D_BYTES } from './scene3d.mjs';
export { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from './scene3d-transform.mjs';
export { createScene3DObjectsProposal, prepareScene3DObjectsApply, isScene3DObjectsProposal } from './scene3d-objects.mjs';

export { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from './scene3d-environment.mjs';
export { createScene3DPropertiesProposal, isScene3DPropertiesProposal, prepareScene3DPropertiesApply } from './scene3d-properties.mjs';
export { createScene3DObjectIndex, queryScene3DObjects, createScene3DSourceLocation, isScene3DSourceLocation, scene3DSourceDisplaySelection } from './scene3d-navigation.mjs';
export { createScene3DTranslationProposal, isScene3DTranslationProposal, prepareScene3DTranslationApply } from './scene3d-translation.mjs';
export { createScene3DAlignmentProposal, isScene3DAlignmentProposal, prepareScene3DAlignmentApply } from './scene3d-alignment.mjs';
export { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from './scene3d-distribution.mjs';
export { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from './scene3d-copy.mjs';
export { createScene3DRemovalProposal, isScene3DRemovalProposal, prepareScene3DRemovalApply } from './scene3d-removal.mjs';
