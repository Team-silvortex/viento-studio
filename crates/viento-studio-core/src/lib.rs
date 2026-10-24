//! Rendering-independent layout rules, position drafts and bounded history.
//! Hosts retain scene source serialization, filesystem access and guarded saves.

mod animation_state_branches;
mod animation_state_combinations;
mod animation_state_conditions;
mod animation_state_selectors;
mod animation_state_table;
mod layout_draft;
mod layout_save;
mod scene3d;
mod scene3d_alignment_patch;
mod scene3d_copy_patch;
mod scene3d_distribution_patch;
mod scene3d_environment_patch;
mod scene3d_objects_patch;
mod scene3d_particles;
mod scene3d_patch;
mod scene3d_properties_patch;
mod scene3d_removal_patch;
mod scene3d_translation_patch;
mod scene_animation;
mod scene_audio;
mod scene_physics2d;
mod scene_composition;
mod scene_composition_definition_rename;
mod scene_composition_definitions_patch;
mod scene_composition_fragment_patch;
mod scene_composition_groups_patch;
mod scene_composition_patch;
mod scene_composition_placement_patch;
mod scene_composition_placements_patch;
mod scene_composition_structure_patch;
mod scene_layout;
mod scene_source;
mod wasm;

use serde::Serialize;
use serde_json::Value;

pub use layout_draft::{
    LayoutDraft, LayoutDraftResponse, LayoutDraftState, LAYOUT_HISTORY_LIMIT, MAX_LAYOUT_ACTORS,
    MAX_LAYOUT_DRAFTS, MAX_LAYOUT_ID_BYTES,
};
pub use layout_save::{
    LayoutSaveAction, LayoutSaveOutcome, LayoutSavePhase, LayoutSaveResponse, LayoutSaveState,
    LayoutSaveWorkflow,
};
pub use scene_composition::SceneCompositionResponse;
pub use scene_composition_patch::SceneCompositionPatchResponse;
pub use scene_layout::{align_selection, move_selection, validate_batch, PositionChange};
pub use scene_source::SceneSourceResponse;
pub use wasm::{
    viento_core_input, viento_core_output_len, viento_core_protocol_version, viento_core_run,
};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_INPUT_BYTES: usize = 1024 * 1024;

/// Optional feature probe. Protocol-1 cores without this export still support
/// their existing layout operations; hosts gate only source operations on it.
#[no_mangle]
pub extern "C" fn viento_core_scene_source_version() -> u32 {
    1
}

/// Optional feature probe for stateless scene composition.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_version() -> u32 {
    1
}

/// Independent capability: earlier composition cores can still expand recipes.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_patch_version() -> u32 {
    1
}

/// Independent atomic set/reset capability; earlier patch cores remain usable.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_edit_version() -> u32 {
    1
}

/// Independent position-only batch capability; older set/reset cores stay usable.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_positions_version() -> u32 {
    1
}

/// Independent shared fragment actor capability; local override domains stay separate.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_fragment_version() -> u32 {
    1
}

/// Independent shared declaration set/reset capability; set-only cores remain valid.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_fragment_edit_version() -> u32 {
    1
}

/// Independent placement offset capability; actor edit domains remain valid.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_placement_version() -> u32 {
    1
}

/// Independent shared structure capability; existing value domains stay valid.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_structure_version() -> u32 {
    1
}

/// Independent placement add/copy/remove capability.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_placements_version() -> u32 {
    1
}

/// Independent shared organizational group capability.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_groups_version() -> u32 {
    1
}

/// Independent management of unplaced fragment definitions.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_definitions_version() -> u32 {
    1
}

/// Optional fragment identity rename; original definition operations stay usable.
#[no_mangle]
pub extern "C" fn viento_core_scene_composition_definition_rename_version() -> u32 {
    1
}

/// Independent strict 3D primitive source parsing; existing 2D domains remain valid.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_version() -> u32 {
    1
}

/// Optional source-preserving 3D object transforms; parsing remains independent.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_patch_version() -> u32 {
    1
}

/// Optional 3D object inventory edits; source parsing and transforms stay separate.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_objects_version() -> u32 {
    1
}

/// Optional atomic 3D environment leaf edits; all other authoring stays separate.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_environment_version() -> u32 {
    1
}

/// Optional additive fog declaration and source-preserving environment edits.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_fog_version() -> u32 {
    1
}

/// Optional engine-independent animation state declaration indexing.
#[no_mangle]
pub extern "C" fn viento_core_animation_state_table_version() -> u32 {
    1
}

/// Optional event-payload conditions; legacy state table admission is unchanged.
#[no_mangle]
pub extern "C" fn viento_core_animation_state_conditions_version() -> u32 {
    1
}

/// Optional explicitly ordered event branches; old declaration admission stays strict.
#[no_mangle]
pub extern "C" fn viento_core_animation_state_branches_version() -> u32 {
    1
}

/// Optional project-state selectors; older payload-only capabilities remain strict.
#[no_mangle]
pub extern "C" fn viento_core_animation_state_selectors_version() -> u32 {
    1
}

/// Optional bounded single-level all/any event guards.
#[no_mangle]
pub extern "C" fn viento_core_animation_state_combinations_version() -> u32 {
    1
}

/// Optional bounded engine-independent soundtrack inspection and sampling.
#[no_mangle]
pub extern "C" fn viento_core_scene_audio_version() -> u32 {
    1
}

/// Optional engine-independent 2D body declaration inspection.
#[no_mangle]
pub extern "C" fn viento_core_scene_physics2d_version() -> u32 {
    1
}

/// Optional visual animation curves; core ABI and other domains remain independent.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_version() -> u32 {
    1
}

/// Optional regular sprite grids and discrete frame tracks; visual v1 stays compatible.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_sprite_version() -> u32 {
    1
}

/// Optional explicit-clock animation transport; existing samples keep their ABI.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_transport_version() -> u32 {
    1
}

/// Optional named animation windows with isolated local playback clocks.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_clips_version() -> u32 {
    1
}

/// Optional explicit scene/instance animation scope; existing ABI and markers stay unchanged.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_instances_version() -> u32 {
    1
}

/// Optional proportional author-timeline retiming; existing animation calls stay independent.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_retime_version() -> u32 {
    1
}

/// Optional explicit-identity visual track copying; existing editing calls stay independent.
#[no_mangle]
pub extern "C" fn viento_core_scene_animation_track_copy_version() -> u32 {
    1
}

/// Optional bounded field preparation and explicit-time particle sampling.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_particles_version() -> u32 {
    1
}

/// Optional name/color string edits; transforms and environment stay separate.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_properties_version() -> u32 {
    1
}

/// Optional atomic relative position edits across existing primitive instances.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_translation_version() -> u32 {
    1
}

/// Optional world-axis position alignment to an explicit selected reference.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_alignment_version() -> u32 {
    1
}

/// Optional atomic world-axis distribution with original fixed endpoints.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_distribution_version() -> u32 {
    1
}

/// Optional atomic raw copies of existing primitives with fresh identities.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_copy_version() -> u32 {
    1
}

/// Independent atomic multi-object removal capability.
#[no_mangle]
pub extern "C" fn viento_core_scene3d_removal_version() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub error_code: &'static str,
    pub message: &'static str,
}

impl CoreError {
    pub(crate) fn position() -> Self {
        Self {
            error_code: "scene_layout_position_invalid",
            message: "A scene actor requires two finite coordinates from -100000 to 100000.",
        }
    }

    fn request() -> Self {
        Self {
            error_code: "studio_core_request_invalid",
            message: "Expected a supported Viento Studio core protocol request.",
        }
    }

    pub(crate) fn input_limit() -> Self {
        Self {
            error_code: "studio_core_input_limit",
            message: "Studio core input exceeds the 1 MiB limit.",
        }
    }

    pub(crate) fn draft_invalid() -> Self {
        Self {
            error_code: "scene_layout_draft_invalid",
            message: "Expected an active layout draft identifier in this core session.",
        }
    }

    pub(crate) fn draft_limit() -> Self {
        Self {
            error_code: "scene_layout_draft_limit",
            message: "Layout drafts support 32 sessions, 1–128 actors, and nonempty identifiers of at most 128 UTF-8 bytes.",
        }
    }

    pub(crate) fn save_invalid() -> Self {
        Self {
            error_code: "scene_layout_save_invalid",
            message: "The layout save phase, request identifier, or transition input is invalid.",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum CoreResponse {
    Success {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        changes: Vec<PositionChange>,
    },
    DraftSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        draft: LayoutDraftResponse,
    },
    SaveSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        save: LayoutSaveResponse,
    },
    SourceSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        source: SceneSourceResponse,
    },
    CompositionSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        composition: SceneCompositionResponse,
    },
    Scene3DSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        scene3d: scene3d::Scene3DResponse,
    },
    AnimationStateTableSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "animationStateTable")]
        animation_state_table: animation_state_table::AnimationStateTableResponse,
    },
    AnimationStateConditionSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "animationStateCondition")]
        animation_state_condition: animation_state_conditions::AnimationStateConditionResponse,
    },
    SceneAnimationSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "sceneAnimation")]
        scene_animation: scene_animation::SceneAnimationResponse,
    },
    ScenePhysics2DSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scenePhysics2D")]
        scene_physics2d: scene_physics2d::ScenePhysics2DResponse,
    },
    SceneAudioSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "sceneAudio")]
        scene_audio: scene_audio::SceneAudioResponse,
    },
    Scene3DParticlesSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dParticles")]
        scene3d_particles: scene3d_particles::ParticleFieldResponse,
    },
    Scene3DPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dPatch")]
        scene3d_patch: scene3d_patch::Scene3DPatchResponse,
    },
    Scene3DObjectsPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dObjectsPatch")]
        scene3d_objects_patch: scene3d_objects_patch::Scene3DObjectsPatchResponse,
    },
    Scene3DEnvironmentPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dEnvironmentPatch")]
        scene3d_environment_patch: scene3d_environment_patch::Scene3DEnvironmentPatchResponse,
    },
    Scene3DPropertiesPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dPropertiesPatch")]
        scene3d_properties_patch: scene3d_properties_patch::Scene3DPropertiesPatchResponse,
    },
    Scene3DRemovalPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dRemovalPatch")]
        scene3d_removal_patch: scene3d_removal_patch::Scene3DRemovalPatchResponse,
    },
    Scene3DCopyPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dCopyPatch")]
        scene3d_copy_patch: scene3d_copy_patch::Scene3DCopyPatchResponse,
    },
    Scene3DDistributionPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dDistributionPatch")]
        scene3d_distribution_patch: scene3d_distribution_patch::Scene3DDistributionPatchResponse,
    },
    Scene3DAlignmentPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dAlignmentPatch")]
        scene3d_alignment_patch: scene3d_alignment_patch::Scene3DAlignmentPatchResponse,
    },
    Scene3DTranslationPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "scene3dTranslationPatch")]
        scene3d_translation_patch: scene3d_translation_patch::Scene3DTranslationPatchResponse,
    },
    CompositionPatchSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "compositionPatch")]
        composition_patch: SceneCompositionPatchResponse,
    },
    CompositionLocationsSuccess {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(rename = "compositionLocations")]
        composition_locations: scene_composition_definitions_patch::DefinitionLocationsResponse,
    },
    Failure {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        ok: bool,
        #[serde(flatten)]
        error: CoreError,
    },
}

impl CoreResponse {
    pub(crate) fn failure(error: CoreError) -> Self {
        Self::Failure {
            protocol_version: PROTOCOL_VERSION,
            ok: false,
            error,
        }
    }
}

fn dispatch_value(value: &Value) -> Result<CoreResponse, CoreError> {
    if value["operation"].as_str() == Some("animationStateTable.inspectCombined") {
        return Ok(CoreResponse::AnimationStateTableSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_table: animation_state_combinations::dispatch_table(value)?,
        });
    }
    if value["operation"].as_str() == Some("animationStateTable.inspectSelected") {
        return Ok(CoreResponse::AnimationStateTableSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_table: animation_state_selectors::dispatch_table(value)?,
        });
    }
    if value["operation"].as_str() == Some("animationStateTable.inspectBranches") {
        return Ok(CoreResponse::AnimationStateTableSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_table: animation_state_branches::dispatch_table(value)?,
        });
    }
    if value["operation"].as_str() == Some("animationStateTable.inspectConditional") {
        return Ok(CoreResponse::AnimationStateTableSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_table: animation_state_conditions::dispatch_table(value)?,
        });
    }
    if matches!(
        value["operation"].as_str(),
        Some("animationStateCondition.inspect" | "animationStateCondition.evaluate")
    ) {
        return Ok(CoreResponse::AnimationStateConditionSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_condition: animation_state_conditions::dispatch_condition(value)?,
        });
    }
    if value["operation"].as_str() == Some("animationStateTable.inspect") {
        return Ok(CoreResponse::AnimationStateTableSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            animation_state_table: animation_state_table::dispatch(value)?,
        });
    }
    if matches!(
        value["operation"].as_str(),
        Some(
            "sceneAnimation.inspect"
                | "sceneAnimation.sample"
                | "sceneAnimation.transport"
                | "sceneAnimation.sampleClip"
                | "sceneAnimation.clipTransport"
                | "sceneAnimation.retime"
                | "sceneAnimation.copyTrack"
        )
    ) {
        return Ok(CoreResponse::SceneAnimationSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene_animation: scene_animation::dispatch(value)?,
        });
    }
    if value["operation"].as_str() == Some("scenePhysics2D.inspect") {
        return Ok(CoreResponse::ScenePhysics2DSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene_physics2d: scene_physics2d::dispatch(value)?,
        });
    }
    if matches!(
        value["operation"].as_str(),
        Some("sceneAudio.inspect" | "sceneAudio.sample")
    ) {
        return Ok(CoreResponse::SceneAudioSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene_audio: scene_audio::dispatch(value)?,
        });
    }
    if matches!(
        value["operation"].as_str(),
        Some("scene3d.prepareParticleField" | "scene3d.sampleParticleField")
    ) {
        return Ok(CoreResponse::Scene3DParticlesSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_particles: scene3d_particles::dispatch(value)?,
        });
    }
    if !value.is_object() || value["protocolVersion"].as_f64() != Some(f64::from(PROTOCOL_VERSION))
    {
        return Err(CoreError::request());
    }
    let operation = value["operation"].as_str();
    if operation == Some("scene3d.removeObjects") {
        return Ok(CoreResponse::Scene3DRemovalPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_removal_patch: scene3d_removal_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.copyObjects") {
        return Ok(CoreResponse::Scene3DCopyPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_copy_patch: scene3d_copy_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.distributeObjects") {
        return Ok(CoreResponse::Scene3DDistributionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_distribution_patch: scene3d_distribution_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.alignObjects") {
        return Ok(CoreResponse::Scene3DAlignmentPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_alignment_patch: scene3d_alignment_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.translateObjects") {
        return Ok(CoreResponse::Scene3DTranslationPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_translation_patch: scene3d_translation_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.patchProperties") {
        return Ok(CoreResponse::Scene3DPropertiesPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_properties_patch: scene3d_properties_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.patchEnvironment") {
        return Ok(CoreResponse::Scene3DEnvironmentPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_environment_patch: scene3d_environment_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.patchObjects") {
        return Ok(CoreResponse::Scene3DObjectsPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_objects_patch: scene3d_objects_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.patchObjectTransform") {
        return Ok(CoreResponse::Scene3DPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d_patch: scene3d_patch::dispatch(value)?,
        });
    }
    if operation == Some("scene3d.parse") {
        let request = value.as_object().ok_or_else(CoreError::request)?;
        if request.len() != 3 || !request.contains_key("content") {
            return Err(CoreError::request());
        }
        return Ok(CoreResponse::Scene3DSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            scene3d: scene3d::parse(request["content"].as_str().ok_or_else(CoreError::request)?)?,
        });
    }
    if operation == Some("sceneComposition.renameFragmentDefinition") {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_definition_rename::dispatch(value)?,
        });
    }
    if operation == Some("sceneComposition.inspectDefinitionLocations") {
        return Ok(CoreResponse::CompositionLocationsSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_locations: scene_composition_definitions_patch::inspect_locations(value)?,
        });
    }
    if matches!(
        operation,
        Some(
            "sceneComposition.addFragmentGroup"
                | "sceneComposition.editFragmentGroup"
                | "sceneComposition.assignFragmentActorGroup"
                | "sceneComposition.removeFragmentGroup"
        )
    ) {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_groups_patch::dispatch(value)?,
        });
    }
    if matches!(
        operation,
        Some(
            "sceneComposition.addPlacement"
                | "sceneComposition.copyPlacement"
                | "sceneComposition.removePlacement"
        )
    ) {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_placements_patch::dispatch(value)?,
        });
    }
    if matches!(
        operation,
        Some(
            "sceneComposition.addFragmentDefinition"
                | "sceneComposition.copyFragmentDefinition"
                | "sceneComposition.removeFragmentDefinition"
        )
    ) {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_definitions_patch::dispatch(value)?,
        });
    }
    if matches!(
        operation,
        Some("sceneComposition.addFragmentActor" | "sceneComposition.removeFragmentActor")
    ) {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_structure_patch::dispatch(value)?,
        });
    }
    if operation == Some("sceneComposition.editPlacementOffset") {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_placement_patch::dispatch(value)?,
        });
    }
    if operation == Some("sceneComposition.editFragmentActor") {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_fragment_patch::dispatch_edit(value)?,
        });
    }
    if operation == Some("sceneComposition.patchFragmentActor") {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_fragment_patch::dispatch(value)?,
        });
    }
    if operation == Some("sceneComposition.patchPositions") {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_patch::dispatch_positions(value)?,
        });
    }
    if matches!(
        operation,
        Some("sceneComposition.patchOverrides" | "sceneComposition.editOverrides")
    ) {
        return Ok(CoreResponse::CompositionPatchSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition_patch: scene_composition_patch::dispatch(value)?,
        });
    }
    if operation == Some("sceneComposition.expand") {
        return Ok(CoreResponse::CompositionSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            composition: scene_composition::dispatch(value)?,
        });
    }
    if let Some(operation @ ("sceneSource.inspect" | "sceneSource.patch")) = operation {
        return Ok(CoreResponse::SourceSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            source: scene_source::dispatch(operation, value)?,
        });
    }
    if let Some(
        operation @ ("layoutSave.read"
        | "layoutSave.invalidate"
        | "layoutSave.begin"
        | "layoutSave.resolve"
        | "layoutSave.refreshed"),
    ) = operation
    {
        return Ok(CoreResponse::SaveSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            save: layout_draft::dispatch_save(operation, value)?,
        });
    }
    if let Some(
        operation @ ("layoutDraft.create"
        | "layoutDraft.setPositions"
        | "layoutDraft.undo"
        | "layoutDraft.redo"
        | "layoutDraft.reset"
        | "layoutDraft.read"
        | "layoutDraft.close"),
    ) = operation
    {
        return Ok(CoreResponse::DraftSuccess {
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            draft: layout_draft::dispatch_draft(operation, value)?,
        });
    }
    let changes = match operation {
        Some("move") => move_selection(
            &value["actors"],
            &value["ids"],
            &value["delta"],
            value.get("snap"),
        ),
        Some("align") => align_selection(&value["actors"], &value["ids"], &value["alignment"]),
        Some("validateBatch") => validate_batch(&value["actors"], &value["changes"]),
        _ => Err(CoreError::request()),
    }?;
    Ok(CoreResponse::Success {
        protocol_version: PROTOCOL_VERSION,
        ok: true,
        changes,
    })
}

/// The native CLI and WASM ABI both use this exact bounded JSON dispatcher.
pub fn dispatch(input: &[u8]) -> CoreResponse {
    let result = if input.len() > MAX_INPUT_BYTES {
        Err(CoreError::input_limit())
    } else {
        serde_json::from_slice::<Value>(input)
            .map_err(|_| CoreError::request())
            .and_then(|value| {
                if matches!(
                    value["operation"].as_str(),
                    Some(
                        "animationStateTable.inspect"
                            | "animationStateTable.inspectConditional"
                            | "animationStateTable.inspectBranches"
                            | "animationStateTable.inspectSelected"
                            | "animationStateTable.inspectCombined"
                            | "animationStateCondition.inspect"
                            | "animationStateCondition.evaluate"
                    )
                ) {
                    animation_state_table::validate_request_bytes(input)?;
                }
                if matches!(
                    value["operation"].as_str(),
                    Some(
                        "sceneAnimation.inspect"
                            | "sceneAnimation.sample"
                            | "sceneAnimation.transport"
                            | "sceneAnimation.sampleClip"
                            | "sceneAnimation.clipTransport"
                            | "sceneAnimation.retime"
                            | "sceneAnimation.copyTrack"
                    )
                ) {
                    scene_animation::validate_request_bytes(input)?;
                }
                if matches!(
                    value["operation"].as_str(),
                    Some("sceneAudio.inspect" | "sceneAudio.sample")
                ) {
                    scene_audio::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scenePhysics2D.inspect") {
                    scene_physics2d::validate_request_bytes(input)?;
                }
                // Keep legacy request admission unchanged. The new exact DTO
                // also rejects duplicate raw keys before Value can hide them.
                if value["operation"].as_str() == Some("scene3d.patchObjectTransform") {
                    scene3d_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.patchObjects") {
                    scene3d_objects_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.patchEnvironment") {
                    scene3d_environment_patch::validate_request_bytes(input)?;
                }
                if matches!(
                    value["operation"].as_str(),
                    Some("scene3d.prepareParticleField" | "scene3d.sampleParticleField")
                ) {
                    scene3d_particles::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.patchProperties") {
                    scene3d_properties_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.translateObjects") {
                    scene3d_translation_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.alignObjects") {
                    scene3d_alignment_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.distributeObjects") {
                    scene3d_distribution_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.copyObjects") {
                    scene3d_copy_patch::validate_request_bytes(input)?;
                }
                if value["operation"].as_str() == Some("scene3d.removeObjects") {
                    scene3d_removal_patch::validate_request_bytes(input)?;
                }
                dispatch_value(&value)
            })
    };
    match result {
        Ok(response) => response,
        Err(error) => CoreResponse::failure(error),
    }
}

pub fn dispatch_json(input: &[u8]) -> Vec<u8> {
    // Responses contain only validated finite coordinates and constant strings.
    serde_json::to_vec(&dispatch(input)).expect("core response is JSON-compatible")
}

/// An overlong native input line can be rejected without retaining all its bytes.
pub fn input_limit_json() -> Vec<u8> {
    serde_json::to_vec(&CoreResponse::failure(CoreError::input_limit()))
        .expect("core error is JSON-compatible")
}
