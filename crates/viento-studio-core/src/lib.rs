//! Rendering-independent layout rules, position drafts and bounded history.
//! Hosts retain scene source serialization, filesystem access and guarded saves.

mod layout_draft;
mod layout_save;
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
    if !value.is_object() || value["protocolVersion"].as_f64() != Some(f64::from(PROTOCOL_VERSION))
    {
        return Err(CoreError::request());
    }
    let operation = value["operation"].as_str();
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
        serde_json::from_slice(input)
            .map_err(|_| CoreError::request())
            .and_then(|value| dispatch_value(&value))
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
