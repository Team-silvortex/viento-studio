//! Authoritative position drafts and bounded undo history, independent of hosts.
#![forbid(unsafe_code)]

use crate::{
    CoreError, LayoutSaveAction, LayoutSaveOutcome, LayoutSaveResponse, LayoutSaveState,
    LayoutSaveWorkflow, PositionChange,
};
use serde::Serialize;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};

pub const MAX_LAYOUT_DRAFTS: usize = 32;
pub const MAX_LAYOUT_ACTORS: usize = 128;
pub const MAX_LAYOUT_ID_BYTES: usize = 128;
pub const LAYOUT_HISTORY_LIMIT: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDraftState {
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug)]
struct Edit {
    index: usize,
    before: [f64; 2],
    after: [f64; 2],
}

/// An ordered, fixed-identity actor set. Only validated atomic position batches
/// enter history; the initial baseline survives history truncation and reset.
#[derive(Debug)]
pub struct LayoutDraft {
    initial: Vec<PositionChange>,
    positions: Vec<PositionChange>,
    indices: HashMap<String, usize>,
    history: VecDeque<Vec<Edit>>,
    future: Vec<Vec<Edit>>,
    save: LayoutSaveWorkflow,
}

fn valid_position(position: [f64; 2]) -> Result<(), CoreError> {
    if position
        .iter()
        .any(|number| !number.is_finite() || number.abs() > 100_000.0)
    {
        return Err(CoreError::position());
    }
    Ok(())
}

fn valid_id(id: &str) -> Result<(), CoreError> {
    if id.is_empty() || id.len() > MAX_LAYOUT_ID_BYTES {
        return Err(CoreError::draft_limit());
    }
    Ok(())
}

impl LayoutDraft {
    pub fn new(actors: Vec<PositionChange>) -> Result<Self, CoreError> {
        if actors.is_empty() || actors.len() > MAX_LAYOUT_ACTORS {
            return Err(CoreError::draft_limit());
        }
        let mut indices = HashMap::with_capacity(actors.len());
        for (index, actor) in actors.iter().enumerate() {
            valid_id(&actor.object_id)?;
            valid_position(actor.position)?;
            if indices.insert(actor.object_id.clone(), index).is_some() {
                return Err(CoreError::position());
            }
        }
        Ok(Self {
            initial: actors.clone(),
            positions: actors,
            indices,
            history: VecDeque::new(),
            future: Vec::new(),
            save: LayoutSaveWorkflow::default(),
        })
    }

    /// Returns an owned snapshot; callers cannot mutate the authoritative draft.
    pub fn positions(&self) -> Vec<PositionChange> {
        self.positions.clone()
    }

    pub fn state(&self) -> LayoutDraftState {
        LayoutDraftState {
            dirty: self.positions != self.initial,
            can_undo: !self.history.is_empty(),
            can_redo: !self.future.is_empty(),
        }
    }

    pub fn save_state(&self) -> LayoutSaveState {
        self.save.state()
    }

    pub fn invalidate_save(&mut self) -> Result<(), CoreError> {
        self.save.invalidate()
    }

    pub fn begin_save(
        &mut self,
        action: LayoutSaveAction,
        editable: bool,
        input_pending: bool,
    ) -> Result<(), CoreError> {
        self.save
            .begin(action, self.state().dirty, editable, input_pending)
    }

    pub fn resolve_save(
        &mut self,
        request_id: &str,
        outcome: LayoutSaveOutcome,
        error_code: Option<&str>,
    ) -> Result<(), CoreError> {
        self.save.resolve(request_id, outcome, error_code)
    }

    pub fn refreshed_save(&mut self, request_id: &str) -> Result<(), CoreError> {
        self.save.refreshed(request_id)
    }

    pub fn set_positions(&mut self, changes: &[PositionChange]) -> Result<bool, CoreError> {
        self.save.ensure_editable()?;
        if changes.len() > MAX_LAYOUT_ACTORS {
            return Err(CoreError::draft_limit());
        }
        let mut seen = HashSet::with_capacity(changes.len());
        let mut step = Vec::with_capacity(changes.len());
        for change in changes {
            valid_id(&change.object_id)?;
            valid_position(change.position)?;
            let index = *self
                .indices
                .get(&change.object_id)
                .ok_or_else(CoreError::position)?;
            if !seen.insert(index) {
                return Err(CoreError::position());
            }
            let before = self.positions[index].position;
            if before != change.position {
                step.push(Edit {
                    index,
                    before,
                    after: change.position,
                });
            }
        }
        // Validation and no-op detection precede every state mutation, including
        // redo invalidation. A rejected or unchanged batch preserves the future.
        if step.is_empty() {
            return Ok(false);
        }
        for edit in &step {
            self.positions[edit.index].position = edit.after;
        }
        self.future.clear();
        self.history.push_back(step);
        if self.history.len() > LAYOUT_HISTORY_LIMIT {
            self.history.pop_front();
        }
        self.save.invalidate()?;
        Ok(true)
    }

    pub fn undo(&mut self) -> Result<bool, CoreError> {
        self.save.ensure_editable()?;
        let Some(step) = self.history.pop_back() else {
            return Ok(false);
        };
        for edit in &step {
            self.positions[edit.index].position = edit.before;
        }
        self.future.push(step);
        self.save.invalidate()?;
        Ok(true)
    }

    pub fn redo(&mut self) -> Result<bool, CoreError> {
        self.save.ensure_editable()?;
        let Some(step) = self.future.pop() else {
            return Ok(false);
        };
        for edit in &step {
            self.positions[edit.index].position = edit.after;
        }
        self.history.push_back(step);
        self.save.invalidate()?;
        Ok(true)
    }

    /// Restore the original baseline and discard both history directions.
    /// `true` also covers clearing history when positions already match baseline.
    pub fn reset(&mut self) -> Result<bool, CoreError> {
        self.save.ensure_editable()?;
        let state = self.state();
        let changed = state.dirty || state.can_undo || state.can_redo;
        self.positions.clone_from(&self.initial);
        self.history.clear();
        self.future.clear();
        if changed {
            self.save.invalidate()?;
        }
        Ok(changed)
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LayoutDraftResponse {
    Snapshot {
        #[serde(rename = "draftId")]
        draft_id: String,
        positions: Vec<PositionChange>,
        state: LayoutDraftState,
        changed: bool,
    },
    Closed {
        #[serde(rename = "draftId")]
        draft_id: String,
        closed: bool,
    },
}

struct DraftRegistry {
    drafts: HashMap<u64, LayoutDraft>,
    next_id: Option<u64>,
}

impl Default for DraftRegistry {
    fn default() -> Self {
        Self {
            drafts: HashMap::new(),
            next_id: Some(1),
        }
    }
}

thread_local! {
    // Each native thread / WASM instance owns a bounded, independent session.
    static DRAFTS: RefCell<DraftRegistry> = RefCell::new(DraftRegistry::default());
}

fn read_changes(value: &Value, allow_empty: bool) -> Result<Vec<PositionChange>, CoreError> {
    let changes = value.as_array().ok_or_else(CoreError::position)?;
    if (!allow_empty && changes.is_empty()) || changes.len() > MAX_LAYOUT_ACTORS {
        return Err(CoreError::draft_limit());
    }
    changes
        .iter()
        .map(|change| {
            let change = change
                .as_object()
                .filter(|object| object.len() == 2)
                .ok_or_else(CoreError::position)?;
            let id = change
                .get("objectId")
                .and_then(Value::as_str)
                .ok_or_else(CoreError::position)?;
            valid_id(id)?;
            let coordinates = change
                .get("position")
                .and_then(Value::as_array)
                .filter(|values| values.len() == 2)
                .ok_or_else(CoreError::position)?;
            let position = [
                coordinates[0].as_f64().ok_or_else(CoreError::position)?,
                coordinates[1].as_f64().ok_or_else(CoreError::position)?,
            ];
            valid_position(position)?;
            Ok(PositionChange {
                object_id: id.into(),
                position,
            })
        })
        .collect()
}

fn draft_id(value: &Value) -> Result<u64, CoreError> {
    let string = value.as_str().ok_or_else(CoreError::draft_invalid)?;
    let id = string
        .parse::<u64>()
        .ok()
        .filter(|id| *id != 0 && id.to_string() == string)
        .ok_or_else(CoreError::draft_invalid)?;
    Ok(id)
}

fn snapshot(id: u64, draft: &LayoutDraft, changed: bool) -> LayoutDraftResponse {
    LayoutDraftResponse::Snapshot {
        draft_id: id.to_string(),
        positions: draft.positions(),
        state: draft.state(),
        changed,
    }
}

pub(crate) fn dispatch_draft(
    operation: &str,
    value: &Value,
) -> Result<LayoutDraftResponse, CoreError> {
    DRAFTS.with(|registry| {
        let mut registry = registry.borrow_mut();
        if operation == "layoutDraft.create" {
            if registry.drafts.len() >= MAX_LAYOUT_DRAFTS {
                return Err(CoreError::draft_limit());
            }
            let id = registry.next_id.ok_or_else(CoreError::draft_limit)?;
            let draft = LayoutDraft::new(read_changes(&value["actors"], false)?)?;
            let response = snapshot(id, &draft, false);
            registry.drafts.insert(id, draft);
            registry.next_id = id.checked_add(1);
            return Ok(response);
        }
        let id = draft_id(&value["draftId"])?;
        let draft = registry
            .drafts
            .get_mut(&id)
            .ok_or_else(CoreError::draft_invalid)?;
        if matches!(
            operation,
            "layoutDraft.setPositions"
                | "layoutDraft.undo"
                | "layoutDraft.redo"
                | "layoutDraft.reset"
        ) {
            draft.save.ensure_editable()?;
        }
        let changed = match operation {
            "layoutDraft.setPositions" => {
                draft.set_positions(&read_changes(&value["changes"], true)?)?
            }
            "layoutDraft.undo" => draft.undo()?,
            "layoutDraft.redo" => draft.redo()?,
            "layoutDraft.reset" => draft.reset()?,
            "layoutDraft.read" => false,
            "layoutDraft.close" => {
                registry.drafts.remove(&id);
                return Ok(LayoutDraftResponse::Closed {
                    draft_id: id.to_string(),
                    closed: true,
                });
            }
            _ => return Err(CoreError::request()),
        };
        Ok(snapshot(id, draft, changed))
    })
}

pub(crate) fn dispatch_save(
    operation: &str,
    value: &Value,
) -> Result<LayoutSaveResponse, CoreError> {
    DRAFTS.with(|registry| {
        let mut registry = registry.borrow_mut();
        let id = draft_id(&value["draftId"])?;
        let draft = registry
            .drafts
            .get_mut(&id)
            .ok_or_else(CoreError::draft_invalid)?;
        match operation {
            "layoutSave.read" => {}
            "layoutSave.invalidate" => draft.invalidate_save()?,
            "layoutSave.begin" => {
                let action = match value["action"].as_str() {
                    Some("preview") => LayoutSaveAction::Preview,
                    Some("apply") => LayoutSaveAction::Apply,
                    Some("verify") => LayoutSaveAction::Verify,
                    _ => return Err(CoreError::save_invalid()),
                };
                let editable = value["editable"]
                    .as_bool()
                    .ok_or_else(CoreError::save_invalid)?;
                let input_pending = value["inputPending"]
                    .as_bool()
                    .ok_or_else(CoreError::save_invalid)?;
                draft.begin_save(action, editable, input_pending)?;
            }
            "layoutSave.resolve" => {
                let request_id = value["requestId"]
                    .as_str()
                    .ok_or_else(CoreError::save_invalid)?;
                let outcome = match value["outcome"].as_str() {
                    Some("accepted") => LayoutSaveOutcome::Accepted,
                    Some("different") => LayoutSaveOutcome::Different,
                    Some("error") => LayoutSaveOutcome::Error,
                    _ => return Err(CoreError::save_invalid()),
                };
                let error_code = match value.get("errorCode") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(code)) if code.len() <= 128 => Some(code.as_str()),
                    _ => return Err(CoreError::save_invalid()),
                };
                draft.resolve_save(request_id, outcome, error_code)?;
            }
            "layoutSave.refreshed" => {
                let request_id = value["requestId"]
                    .as_str()
                    .ok_or_else(CoreError::save_invalid)?;
                draft.refreshed_save(request_id)?;
            }
            _ => return Err(CoreError::request()),
        }
        Ok(LayoutSaveResponse {
            draft_id: id.to_string(),
            state: draft.save_state(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn handle_exhaustion_never_wraps_or_reuses_closed_identifiers() {
        let old = DRAFTS.with(|registry| {
            registry.replace(DraftRegistry {
                drafts: HashMap::new(),
                next_id: Some(u64::MAX),
            })
        });
        let actors = json!({"actors":[{"objectId":"a","position":[0,0]}]});
        let response = dispatch_draft("layoutDraft.create", &actors).unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["draftId"], u64::MAX.to_string());
        assert_eq!(
            dispatch_draft("layoutDraft.create", &actors)
                .unwrap_err()
                .error_code,
            "scene_layout_draft_limit"
        );
        let handle = json!({"draftId":u64::MAX.to_string()});
        assert!(dispatch_draft("layoutDraft.read", &handle).is_ok());
        assert!(dispatch_draft("layoutDraft.close", &handle).is_ok());
        assert_eq!(
            dispatch_draft("layoutDraft.create", &actors)
                .unwrap_err()
                .error_code,
            "scene_layout_draft_limit"
        );
        DRAFTS.with(|registry| registry.replace(old));
    }
}
